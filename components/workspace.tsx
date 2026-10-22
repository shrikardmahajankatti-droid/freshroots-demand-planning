"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { downloadCsv, parseCsv, type LoadedFile } from "@/lib/csv";
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
  type RunResult,
  type SkuResult,
  type UpliftMode,
} from "@/lib/rules";
import type { ToastMsg, Tone } from "@/components/ui";

export type ActionFilter = "all" | "reorder" | "pause" | "hold" | "exceptions";
export type Tab = "overview" | "exceptions" | "actions" | "orders" | "rules" | "data";

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
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [autoRun, setAutoRun] = useState(false);
  const toastId = useRef(0);

  const toast = useCallback((tone: Tone, title: string, body?: string) => {
    setToasts((t) => [...t.slice(-2), { id: ++toastId.current, tone, title, body }]);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

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
    const parsed = parseCsv(kind, f.name, await f.text());
    setFiles((prev) => ({ ...prev, [kind]: parsed }));
    setIsDemo(false);
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
        if (thenRun) setAutoRun(true);
      } catch (e) {
        toast("red", "Could not load demo data", (e as Error).message);
      }
    },
    [toast],
  );

  // First visit: open the demo workspace already populated.
  useEffect(() => {
    loadDemo(true);
  }, [loadDemo]);

  const runForecast = useCallback(async () => {
    if (!dataset) return;
    const result = runRules(dataset, mode);
    const at = new Date().toISOString();
    setRun({ result, at, mode });
    setDecisions({});
    setG2(null);
    setDrawerSku(null);
    setPoDownloaded(false);
    const templates = Object.fromEntries(result.rows.map((r) => [r.skuId, templateExplanation(r, result.festival)]));
    setExpl(templates);
    setExplStatus({ source: "pending", note: "Asking Claude for reasons…" });
    toast("green", "Forecast complete", `${result.rows.length} SKUs checked · ${result.summary.exceptions} need your review`);
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
        setExplStatus({ source: "ai", note: `Reasons by Claude (${data.model})${missing ? `; ${missing} SKU(s) fell back to templates` : ""}.` });
      } else {
        setExplStatus({ source: "template", note: data.error ?? "AI unavailable — using template reasons." });
      }
    } catch {
      setExplStatus({ source: "template", note: "AI call failed — using template reasons." });
    }
  }, [dataset, mode, toast]);

  useEffect(() => {
    if (autoRun && dataset) {
      setAutoRun(false);
      runForecast();
    }
  }, [autoRun, dataset, runForecast]);

  function approve(r: SkuResult) {
    setDecisions((d) => ({ ...d, [r.skuId]: { type: "approve", at: new Date().toISOString() } }));
    toast("green", `${r.skuId} approved`, `${r.action} · qty ${r.qty}`);
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
  }
  function reopen(r: SkuResult) {
    if (!run) return;
    setDecisions((d) => {
      const n = { ...d };
      delete n[r.skuId];
      return n;
    });
    setLog((l) => l.filter((e) => !(e.runAt === run.at && e.sku === r.skuId)));
  }
  function approveFinal() {
    setG2({ by: g2Name.trim(), at: new Date().toISOString() });
    toast("green", "Purchase orders approved", "Raghav's decisions are now locked. PO download is enabled.");
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
