"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { downloadCsv, parseCsv, parseUploads, validate, type LoadedFile, type UploadItem } from "@/lib/csv";
import {
  FILE_NAMES,
  buildDataset,
  explainPayload,
  fmt,
  gate1Progress,
  isReorder,
  loadSummary,
  overrideStats,
  poRows,
  runRules,
  templateExplanation,
  toCsv,
  type Decision,
  type Explanation,
  type FileKind,
  type RawInputs,
  type RawRow,
  type RunResult,
  type SkuResult,
  type UpliftMode,
  DEFAULT_LEAD_DAYS,
} from "@/lib/rules";
import type { ToastMsg, Tone } from "@/components/ui";

export type ActionFilter = "all" | "reorder" | "pause" | "hold" | "exceptions";
export type Tab = "overview" | "exceptions" | "actions" | "orders" | "calendar" | "rules" | "data";

export interface HubspotOrder {
  distributorId: string;
  distributorName: string;
  orderId: string;
  url: string | null;
  lines: number;
  units: number;
  status: "created" | "existing";
}
export type DbStatus =
  | { state: "checking" }
  | { state: "off" }
  | { state: "ok"; savedAt: string | null; saving: number }
  | { state: "error"; error: string };

/** One saved forecast run, as listed in history. */
export interface SavedRun {
  id: number;
  run_at: string;
  uplift_mode: string;
  festival_on: boolean;
  sku_count: number;
  reorder_count: number;
  reorder_units: number;
  pause_count: number;
  exception_count: number;
  ai_source: string | null;
  batch_id: number;
  source: "demo" | "upload";
  as_of_date: string | null;
  decided: number;
  overrides: number;
  approved_by: string | null;
  approved_at: string | null;
  po_lines: number | null;
  po_units: number | null;
  hubspot_orders: number;
}
export interface SavedBatch {
  id: number;
  created_at: string;
  source: "demo" | "upload";
  as_of_date: string | null;
  sku_count: number;
  distributor_count: number;
  sales_rows: number;
  inventory_rows: number;
  rejected_rows: number;
}

export type HubspotSync =
  | { state: "idle" }
  | { state: "syncing" }
  | { state: "done"; results: HubspotOrder[]; at: string }
  | { state: "error"; error: string; missingScopes: string[]; configured: boolean };

export interface OverrideLogEntry {
  runAt: string;
  sku: string;
  originalAction: string;
  originalQty: number;
  overrideQty: number;
  reason: string;
  by: string;
  at: string;
}

export const KINDS: FileKind[] = ["sales", "inventory", "skuMaster", "calendar", "distributors"];
export const FILE_LABEL: Record<FileKind, string> = {
  sales: "Weekly sales",
  inventory: "Current inventory",
  skuMaster: "SKU master",
  calendar: "Festival calendar",
  distributors: "Distributor master",
};

export const ts = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
export const monthName = (ym: string | null | undefined) =>
  ym ? new Date(`${ym}-01T00:00:00`).toLocaleString("en-IN", { month: "long", year: "numeric" }) : "Current";

/** Next Monday or Thursday at 06:00 local time — the schedule "Run forecast" stands in for. */
export function nextScheduledRun(now = new Date()) {
  for (let i = 0; i < 8; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    d.setHours(6, 0, 0, 0);
    if ((d.getDay() === 1 || d.getDay() === 4) && d > now) return d;
  }
  return now;
}

/** All app state and actions. Views read it through useWs(). */
export function useWorkspaceState() {
  const [tab, setTabState] = useState<Tab>("overview");
  const setTab = useCallback((t: Tab) => setTabState(t), []);
  const [files, setFiles] = useState<Partial<Record<FileKind, LoadedFile>>>({});
  const [mode, setMode] = useState<UpliftMode>("auto");
  const [run, setRun] = useState<{ result: RunResult; at: string; mode: UpliftMode } | null>(null);
  const [expl, setExpl] = useState<Record<string, Explanation>>({});
  const [explStatus, setExplStatus] = useState<{ source: "ai" | "template" | "pending"; note: string } | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [g1Name, setG1Name] = useState("Raghav");
  const [g2Name, setG2Name] = useState("");
  const [g2, setG2] = useState<{ by: string; at: string } | null>(null);
  const [log, setLog] = useState<OverrideLogEntry[]>([]);
  const [drawerSku, setDrawerSku] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [showBoxes, setShowBoxes] = useState(false);
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [poDownloaded, setPoDownloaded] = useState(false);
  const [hubspot, setHubspot] = useState<HubspotSync>({ state: "idle" });
  const [leadDays, setLeadDays] = useState(DEFAULT_LEAD_DAYS);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [autoRun, setAutoRun] = useState(false);
  const [dbStatus, setDbStatus] = useState<DbStatus>({ state: "checking" });
  const [history, setHistory] = useState<{ runs: SavedRun[]; batches: SavedBatch[] }>({ runs: [], batches: [] });
  const [restored, setRestored] = useState(false);
  const toastId = useRef(0);
  // Persistence bookkeeping (refs so async callbacks see the latest values).
  const dbOn = useRef(false);
  const batchIdRef = useRef<number | null>(null);
  const sourceRef = useRef<"demo" | "upload">("demo");
  const runIdPromise = useRef<Promise<number | null>>(Promise.resolve(null));

  const toast = useCallback((tone: Tone, title: string, body?: string) => {
    setToasts((t) => [...t.slice(-2), { id: ++toastId.current, tone, title, body }]);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  /** Writes one step to Neon. No-op when no database is configured. */
  const dbPost = useCallback(
    async <T,>(op: string, payload: Record<string, unknown>): Promise<T | null> => {
      if (!dbOn.current) return null;
      setDbStatus((s) => (s.state === "ok" ? { ...s, saving: s.saving + 1 } : s));
      try {
        const res = await fetch("/api/db", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, ...payload }) });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? "Save failed");
        setDbStatus((s) => (s.state === "ok" ? { state: "ok", savedAt: new Date().toISOString(), saving: Math.max(0, s.saving - 1) } : s));
        return data as T;
      } catch (e) {
        setDbStatus((s) => (s.state === "ok" ? { ...s, saving: Math.max(0, s.saving - 1) } : s));
        toast("red", "Could not save to Neon", `${op}: ${(e as Error).message}. The app keeps working; this step is not saved.`);
        return null;
      }
    },
    [toast],
  );

  /** Runs `fn` once the current run has a Neon id (no-op without a database). */
  const withRun = (fn: (runId: number) => unknown) => {
    runIdPromise.current.then((id) => {
      if (id) fn(id);
    });
  };

  const refreshHistory = useCallback(async () => {
    if (!dbOn.current) return;
    const data = await fetch("/api/db?view=history").then((r) => r.json()).catch(() => null);
    if (data?.ok) setHistory({ runs: data.history, batches: data.batches });
  }, []);

  const allLoaded = KINDS.every((k) => files[k] && !files[k]!.error);
  const raw = useMemo(
    () =>
      allLoaded
        ? {
            sales: files.sales!.rows,
            inventory: files.inventory!.rows,
            skuMaster: files.skuMaster!.rows,
            calendar: files.calendar!.rows,
            distributors: files.distributors!.rows,
          }
        : null,
    [allLoaded, files],
  );
  const dataset = useMemo(() => (raw ? buildDataset(raw) : null), [raw]);
  const summary = useMemo(() => (dataset && raw ? loadSummary(dataset, raw) : null), [dataset, raw]);

  const rows = useMemo(() => run?.result.rows ?? [], [run]);
  const fest = run?.result.festival ?? null;
  const exceptions = rows.filter((r) => r.isException);
  const g1 = gate1Progress(rows, decisions);
  const stats = overrideStats(rows, decisions);
  const po = poRows(rows, decisions);
  const poUnits = po.reduce((a, p) => a + p.qty, 0);
  const stale = !!run && run.mode !== mode;
  const freeMode = explStatus?.note.startsWith("Free mode") ?? false;
  const distributorCount = new Set(rows.map((r) => r.distributorId).filter(Boolean)).size;

  async function onFile(kind: FileKind, f: File | undefined) {
    if (!f) return;
    let parsed: LoadedFile;
    if (/\.xlsx$/i.test(f.name)) {
      // A workbook dropped on one slot: use the sheet whose headers match this input.
      const items = await parseUploads([f]);
      const hit = items.find((i) => i.loaded?.kind === kind);
      parsed = hit?.loaded ?? { kind, fileName: f.name, rows: [], fields: items[0]?.fields ?? [], error: items[0]?.problem ?? `No sheet in ${f.name} matches ${FILE_NAMES[kind]}.` };
    } else {
      parsed = parseCsv(kind, f.name, await f.text());
    }
    setFiles((prev) => ({ ...prev, [kind]: parsed }));
    setIsDemo(false);
    batchIdRef.current = null;
    sourceRef.current = "upload";
    if (parsed.error) toast("red", `${FILE_NAMES[kind]} rejected`, parsed.error);
    else toast("green", `${FILE_LABEL[kind]} loaded`, `${parsed.rows.length} rows from ${f.name}. Run the forecast to use it.`);
  }

  const loadDemo = useCallback(
    async (thenRun: boolean) => {
      try {
        const loaded = await Promise.all(
          KINDS.map(async (k) => {
            const res = await fetch(`/demo/${FILE_NAMES[k]}`);
            if (!res.ok) throw new Error(`${FILE_NAMES[k]}: HTTP ${res.status}`);
            return parseCsv(k, FILE_NAMES[k], await res.text());
          }),
        );
        setFiles(Object.fromEntries(loaded.map((l) => [l.kind, l])));
        setIsDemo(true);
        batchIdRef.current = null;
        sourceRef.current = "demo";
        if (thenRun) setAutoRun(true);
      } catch (e) {
        toast("red", "Could not load demo data", (e as Error).message);
      }
    },
    [toast],
  );

  // Start-up: restore the last saved workspace from Neon; otherwise open the demo, populated.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/db").then((r) => r.json()).catch(() => null);
      if (cancelled) return;
      if (!res?.configured || !res.ok) {
        setDbStatus(res?.configured ? { state: "error", error: res.error ?? "Neon unavailable" } : { state: "off" });
        setRestored(true);
        loadDemo(true);
        return;
      }
      dbOn.current = true;
      setDbStatus({ state: "ok", savedAt: null, saving: 0 });
      setHistory({ runs: res.history, batches: res.batches });
      const st = res.settings ?? {};
      if (typeof st.leadDays === "number") setLeadDays(st.leadDays);
      if (typeof st.plannerName === "string" && st.plannerName) setG1Name(st.plannerName);
      if (typeof st.approverName === "string") setG2Name(st.approverName);
      if (st.upliftMode === "auto" || st.upliftMode === "on" || st.upliftMode === "off") setMode(st.upliftMode);
      setLog(
        (res.overrides ?? []).map((o: Record<string, unknown>) => ({
          runAt: String(o.run_at), sku: String(o.sku_id), originalAction: String(o.original_action), originalQty: Number(o.original_qty),
          overrideQty: Number(o.final_qty), reason: String(o.reason ?? ""), by: String(o.decided_by), at: String(o.decided_at),
        })),
      );
      if (!res.batch) {
        setRestored(true);
        loadDemo(true);
        return;
      }
      restore(res);
      setRestored(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Rebuilds the workspace from a saved batch and run — no AI call, no new run. */
  function restore(res: {
    batch: { id: number; source: "demo" | "upload"; file_names: Record<FileKind, string>; created_at: string };
    inputs: Record<FileKind, RawRow[]>;
    run: null | {
      id: number; run_at: string; uplift_mode: UpliftMode; ai_source: string | null; ai_model: string | null;
      results: { sku_id: string; action: string; qty: number; reason: string | null; check_note: string | null }[];
      decisions: { sku_id: string; decision: "approve" | "override"; final_qty: number; reason: string | null; decided_at: string }[];
      approval: { approved_by: string; approved_at: string } | null;
      hubspot: { distributor_id: string; distributor_name: string; order_id: string; url: string | null; line_count: number; units: number; status: string; synced_at: string }[];
    };
  }) {
    const loaded = Object.fromEntries(
      KINDS.map((k) => {
        const rows = res.inputs[k] ?? [];
        return [k, validate(k, res.batch.file_names?.[k] ?? FILE_NAMES[k], rows[0] ? Object.keys(rows[0]) : [], rows)];
      }),
    ) as Record<FileKind, LoadedFile>;
    setFiles(loaded);
    setIsDemo(res.batch.source === "demo");
    batchIdRef.current = Number(res.batch.id); // bigint ids arrive as strings
    sourceRef.current = res.batch.source;
    const r = res.run;
    if (!r) {
      setAutoRun(true);
      return;
    }
    const ds = buildDataset(Object.fromEntries(KINDS.map((k) => [k, loaded[k].rows])) as unknown as RawInputs);
    const result = runRules(ds, r.uplift_mode);
    setMode(r.uplift_mode);
    setRun({ result, at: r.run_at, mode: r.uplift_mode });
    runIdPromise.current = Promise.resolve(Number(r.id));
    const saved = new Map(r.results.map((x) => [x.sku_id, x]));
    setExpl(
      Object.fromEntries(
        result.rows.map((row) => {
          const t = templateExplanation(row, result.festival);
          const x = saved.get(row.skuId);
          return [row.skuId, { sku: row.skuId, reason: x?.reason || t.reason, check: x?.check_note ?? t.check }];
        }),
      ),
    );
    setExplStatus(
      r.ai_source === "ai"
        ? { source: "ai", note: `Reasons by Gemini (${r.ai_model ?? "model"}), restored from Neon.` }
        : { source: "template", note: "Template reasons, restored from Neon." },
    );
    setDecisions(
      Object.fromEntries(
        r.decisions.map((d) => [d.sku_id, d.decision === "override" ? { type: "override", qty: d.final_qty, reason: d.reason ?? "", at: d.decided_at } : { type: "approve", at: d.decided_at }]),
      ),
    );
    setG2(r.approval ? { by: r.approval.approved_by, at: r.approval.approved_at } : null);
    if (r.approval?.approved_by) setG2Name(r.approval.approved_by);
    setHubspot(
      r.hubspot.length
        ? {
            state: "done",
            at: r.hubspot.map((h) => h.synced_at).sort().pop()!,
            results: r.hubspot.map((h) => ({ distributorId: h.distributor_id, distributorName: h.distributor_name, orderId: h.order_id, url: h.url, lines: h.line_count, units: h.units, status: h.status as HubspotOrder["status"] })),
          }
        : { state: "idle" },
    );
    const drift = result.rows.filter((row) => {
      const x = saved.get(row.skuId);
      return x && (x.action !== row.action || x.qty !== row.qty);
    }).length;
    toast(
      drift ? "amber" : "green",
      "Workspace restored from Neon",
      drift ? `${drift} SKU(s) differ from the saved run — the rules changed. Re-run to refresh.` : `Run of ${ts(r.run_at)} · ${result.rows.length} SKUs · ${r.decisions.length} decision(s)`,
    );
  }

  // Remember names, lead time and uplift mode in Neon (debounced).
  useEffect(() => {
    if (!restored || !dbOn.current) return;
    const t = setTimeout(() => dbPost("settings", { settings: { leadDays, plannerName: g1Name, approverName: g2Name, upliftMode: mode } }), 900);
    return () => clearTimeout(t);
  }, [restored, leadDays, g1Name, g2Name, mode, dbPost]);

  const runForecast = useCallback(async () => {
    if (!dataset) return;
    const result = runRules(dataset, mode);
    const at = new Date().toISOString();
    setRun({ result, at, mode });
    setDecisions({});
    setG2(null);
    setDrawerSku(null);
    setPoDownloaded(false);
    setHubspot({ state: "idle" });
    const templates = Object.fromEntries(result.rows.map((r) => [r.skuId, templateExplanation(r, result.festival)]));
    setExpl(templates);
    setExplStatus({ source: "pending", note: "Asking Gemini for reasons…" });
    toast("green", "Forecast complete", `${result.rows.length} SKUs checked · ${result.summary.exceptions} need your review`);

    // Save the inputs (once per upload) and this run to Neon.
    runIdPromise.current = (async () => {
      if (!dbOn.current) return null;
      if (!batchIdRef.current) {
        const b = await dbPost<{ batchId: number }>("saveBatch", {
          batch: {
            source: sourceRef.current,
            asOfDate: dataset.asOfDate,
            skuCount: dataset.skus.length,
            distributorCount: new Set(dataset.skus.map((k) => k.master?.distributorId).filter(Boolean)).size,
            rejectedRows: dataset.rejected.length,
            fileNames: Object.fromEntries(KINDS.map((k) => [k, files[k]?.fileName ?? FILE_NAMES[k]])),
            inputs: Object.fromEntries(KINDS.map((k) => [k, files[k]?.rows ?? []])),
          },
        });
        if (!b) return null;
        batchIdRef.current = b.batchId;
      }
      const saved = await dbPost<{ runId: number }>("saveRun", {
        run: {
          batchId: batchIdRef.current,
          runAt: at,
          upliftMode: mode,
          festivalOn: result.festival.on,
          festivalMonth: result.festival.month,
          counts: {
            skus: result.rows.length,
            reorder: result.rows.filter((r) => isReorder(r.action)).length,
            reorderUnits: result.summary.reorderUnits,
            pause: result.summary.actionCounts.PAUSE,
            hold: result.summary.actionCounts.HOLD,
            exceptions: result.summary.exceptions,
          },
          results: result.rows.map((r) => ({
            sku_id: r.skuId, sku_name: r.name, distributor_id: r.distributorId, perishability: r.perishability,
            units_on_hand: r.unitsOnHand, avg_4w: r.avg4w, avg_12w: r.avg12w, expected_weekly_demand: r.expectedWeeklyDemand,
            weeks_of_cover: r.weeksOfCover, flags: r.flags, action: r.action, qty: r.qty, is_exception: r.isException,
            exception_codes: r.exceptionCodes, reason: templates[r.skuId].reason, check_note: templates[r.skuId].check,
          })),
        },
      });
      refreshHistory();
      return saved?.runId ?? null;
    })();

    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skus: result.rows.map((r) => explainPayload(r, result.festival)) }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.items)) {
        const ai = Object.fromEntries((data.items as Explanation[]).map((e) => [e.sku, e]));
        const merged = { ...templates };
        let missing = 0;
        for (const r of result.rows) {
          const a = ai[r.skuId];
          if (!a) {
            missing++;
            continue;
          }
          merged[r.skuId] = { ...a, check: r.isException ? a.check || templates[r.skuId].check : "" };
        }
        setExpl(merged);
        setExplStatus({ source: "ai", note: `Reasons by Gemini (${data.model})${missing ? `; ${missing} SKU(s) fell back to templates` : ""}.` });
        withRun((runId) => dbPost("saveExplanations", { runId, source: "ai", model: data.model, items: Object.values(merged) }));
      } else {
        setExplStatus({ source: "template", note: data.error ?? "AI unavailable — using template reasons." });
      }
    } catch {
      setExplStatus({ source: "template", note: "AI call failed — using template reasons." });
    }
  }, [dataset, mode, toast, files, dbPost, refreshHistory]);

  useEffect(() => {
    if (autoRun && dataset) {
      setAutoRun(false);
      runForecast();
    }
  }, [autoRun, dataset, runForecast]);

  function approve(r: SkuResult) {
    const at = new Date().toISOString();
    setDecisions((d) => ({ ...d, [r.skuId]: { type: "approve", at } }));
    toast("green", `${r.skuId} approved`, `${r.action} · qty ${r.qty}`);
    withRun((runId) => dbPost("decide", { decision: { runId, skuId: r.skuId, decision: "approve", originalAction: r.action, originalQty: r.qty, finalQty: r.qty, reason: null, decidedBy: g1Name, decidedAt: at } }).then(refreshHistory),
    );
  }
  function override(r: SkuResult, qty: number, reason: string) {
    if (!run) return;
    const at = new Date().toISOString();
    setDecisions((d) => ({ ...d, [r.skuId]: { type: "override", qty, reason, at } }));
    setLog((l) => [
      ...l.filter((e) => !(e.runAt === run.at && e.sku === r.skuId)),
      { runAt: run.at, sku: r.skuId, originalAction: r.action, originalQty: r.qty, overrideQty: qty, reason, by: g1Name, at },
    ]);
    toast("violet", `${r.skuId} overridden`, `qty ${r.qty} → ${qty}. Logged for rule review.`);
    withRun((runId) => dbPost("decide", { decision: { runId, skuId: r.skuId, decision: "override", originalAction: r.action, originalQty: r.qty, finalQty: qty, reason, decidedBy: g1Name, decidedAt: at } }).then(refreshHistory),
    );
  }
  function reopen(r: SkuResult) {
    if (!run) return;
    setDecisions((d) => {
      const n = { ...d };
      delete n[r.skuId];
      return n;
    });
    setLog((l) => l.filter((e) => !(e.runAt === run.at && e.sku === r.skuId)));
    withRun((runId) => dbPost("undo", { runId, skuId: r.skuId }).then(refreshHistory));
  }
  /** Replaces the inputs that matched (others are kept) and re-runs the forecast. */
  function applyUploads(items: UploadItem[]) {
    const matched = items.filter((i) => i.loaded && !i.loaded.error).map((i) => i.loaded!);
    if (!matched.length) return;
    setFiles((prev) => ({ ...prev, ...Object.fromEntries(matched.map((l) => [l.kind, l])) }));
    setIsDemo(false);
    batchIdRef.current = null;
    sourceRef.current = "upload";
    setUploadOpen(false);
    setAutoRun(true);
    toast("green", `${matched.length} input${matched.length === 1 ? "" : "s"} updated`, "Re-running the forecast with the new data…");
  }

  /** Sends the approved PO to HubSpot: one Order per distributor, SKUs as line items. */
  async function syncHubspot(approvedBy: string) {
    if (!run || !po.length) return;
    setHubspot({ state: "syncing" });
    const names = new Map((dataset?.skus ?? []).map((k) => [k.master?.distributorId ?? "", k.distributor?.name ?? ""]));
    const orders = [...new Set(po.map((p) => p.distributorId))].map((id) => ({
      distributorId: id,
      distributorName: names.get(id) || id,
      lines: po.filter((p) => p.distributorId === id).map((p) => ({ skuId: p.skuId, name: p.name, qty: p.qty, action: p.action })),
    }));
    try {
      const res = await fetch("/api/hubspot/po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycle: monthName(dataset?.asOfMonth), runAt: run.at, approvedBy: `${g1Name} (Gate 1); ${approvedBy} (Gate 2)`, orders }),
      });
      const data = await res.json();
      if (data.ok) {
        setHubspot({ state: "done", results: data.results, at: new Date().toISOString() });
        withRun((runId) => dbPost("hubspot", { runId, orders: data.results }).then(refreshHistory));
        const created = (data.results as HubspotOrder[]).filter((r) => r.status === "created").length;
        toast("green", "Purchase orders created in HubSpot", `${data.results.length} order${data.results.length === 1 ? "" : "s"} · ${created} new`);
      } else {
        setHubspot({ state: "error", error: data.error ?? "HubSpot sync failed.", missingScopes: data.missingScopes ?? [], configured: data.configured !== false });
        toast(data.configured === false ? "slate" : "red", data.configured === false ? "HubSpot not connected" : "HubSpot sync failed", data.error);
      }
    } catch {
      setHubspot({ state: "error", error: "Could not reach the server.", missingScopes: [], configured: true });
      toast("red", "HubSpot sync failed", "Could not reach the server.");
    }
  }

  function approveFinal() {
    const by = g2Name.trim();
    const at = new Date().toISOString();
    setG2({ by, at });
    withRun((runId) => dbPost("approve", { approval: { runId, approvedBy: by, approvedAt: at, poLines: po.length, poUnits } }).then(refreshHistory));
    toast("green", "Purchase orders approved", "Raghav's decisions are now locked. Sending to HubSpot…");
    syncHubspot(by);
  }

  function downloadActionList() {
    if (!run) return;
    downloadCsv(
      `freshroots_action_list_${run.at.slice(0, 10)}.csv`,
      toCsv(
        ["SKU_ID", "SKU_Name", "Distributor_ID", "Perishability", "Units_On_Hand", "Avg_4w", "Avg_12w", "Expected_Weekly_Demand", "Weeks_Of_Cover", "Flags", "Action", "Qty", "Exception", "Reason", "Check"],
        rows.map((r) => [
          r.skuId, r.name, r.distributorId, r.perishability, r.unitsOnHand, fmt(r.avg4w), fmt(r.avg12w),
          fmt(r.expectedWeeklyDemand), fmt(r.weeksOfCover, 2), r.flags.join("|"), r.action, r.qty,
          r.isException ? "YES" : "", expl[r.skuId]?.reason ?? "", expl[r.skuId]?.check ?? "",
        ]),
      ),
    );
  }
  function downloadPo() {
    if (!g2) return;
    const by = `${g1Name} (Gate 1); ${g2.by} (Gate 2)`;
    downloadCsv(
      `freshroots_po_list_${g2.at.slice(0, 10)}.csv`,
      toCsv(
        ["SKU_ID", "SKU_Name", "Distributor_ID", "Action", "Final_Qty", "Approved_By", "Timestamp"],
        po.map((p) => [p.skuId, p.name, p.distributorId, p.action, p.qty, by, g2.at]),
      ),
    );
    setPoDownloaded(true);
    toast("green", "PO list downloaded", `${po.length} lines · ${poUnits.toLocaleString("en-IN")} units. Upload to Zoho manually.`);
  }
  function downloadLog() {
    downloadCsv(
      "freshroots_override_log.csv",
      toCsv(
        ["SKU", "Original_Action", "Original_Qty", "Override_Qty", "Reason", "Overridden_By", "Timestamp", "Run_Timestamp"],
        log.map((e) => [e.sku, e.originalAction, e.originalQty, e.overrideQty, e.reason, e.by, e.at, e.runAt]),
      ),
    );
  }

  const counts = {
    reorder: rows.filter((r) => isReorder(r.action)).length,
    pause: rows.filter((r) => r.action === "PAUSE").length,
    hold: rows.filter((r) => r.action === "HOLD").length,
  };

  return {
    tab, setTab,
    files, onFile, loadDemo, isDemo, allLoaded, dataset, summary,
    mode, setMode, stale,
    run, rows, fest, exceptions, counts, distributorCount, runForecast,
    expl, explStatus, freeMode,
    decisions, approve, override, reopen, g1, g1Name, setG1Name,
    g2, g2Name, setG2Name, approveFinal, po, poUnits,
    log, stats, downloadActionList, downloadPo, downloadLog,
    drawerSku, setDrawerSku, actionFilter, setActionFilter, poDownloaded,
    hubspot, retryHubspot: () => g2 && syncHubspot(g2.by),
    leadDays, setLeadDays,
    uploadOpen, setUploadOpen, applyUploads,
    dbStatus, history, refreshHistory,
    showBoxes, setShowBoxes,
    toasts, toast, dismissToast,
  };
}

export type Workspace = ReturnType<typeof useWorkspaceState>;

export const WsContext = createContext<Workspace | null>(null);

export function useWs(): Workspace {
  const ws = useContext(WsContext);
  if (!ws) throw new Error("useWs must be used inside <WsContext.Provider>");
  return ws;
}
