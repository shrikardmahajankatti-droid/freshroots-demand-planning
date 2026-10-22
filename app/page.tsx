"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  ClipboardCheck,
  Cpu,
  Database,
  Download,
  FileSpreadsheet,
  Gauge,
  Leaf,
  Lock,
  Menu,
  PackageCheck,
  PauseCircle,
  Play,
  RefreshCw,
  Repeat2,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Upload,
  UserCheck,
  X,
} from "lucide-react";
import { CoverChart, TrendChart } from "@/components/Charts";
import ShinyText from "@/components/reactbits/ShinyText/ShinyText";
import { ActionBadge, BoxCard, Button, Callout, Chip, Kpi, StatRow, Toasts, type ToastMsg, type Tone } from "@/components/ui";
import { downloadCsv, parseCsv, type LoadedFile } from "@/lib/csv";
import {
  FILE_NAMES,
  KILL_CRITERION_OVERRIDE_RATE,
  RULES,
  buildDataset,
  explainPayload,
  finalRow,
  fmt,
  gate1Progress,
  isReorder,
  loadSummary,
  overrideStats,
  poRows,
  runRules,
  templateExplanation,
  toCsv,
  validateOverride,
  type Decision,
  type Explanation,
  type FileKind,
  type RunResult,
  type SkuResult,
  type UpliftMode,
} from "@/lib/rules";

// Heavy WebGL background: client-only, behind a static dark fallback.
const Aurora = dynamic(() => import("@/components/reactbits/Aurora/Aurora"), { ssr: false });

interface OverrideLogEntry {
  runAt: string;
  sku: string;
  originalAction: string;
  originalQty: number;
  overrideQty: number;
  reason: string;
  by: string;
  at: string;
}

type StepState = "done" | "attention" | "ready" | "locked" | "error";
type TableFilter = "all" | "reorder" | "pause" | "hold" | "exceptions";

const KINDS: FileKind[] = ["sales", "inventory", "skuMaster", "calendar", "distributors"];
const FILE_LABEL: Record<FileKind, string> = {
  sales: "Weekly sales",
  inventory: "Current inventory",
  skuMaster: "SKU master",
  calendar: "Festival calendar",
  distributors: "Distributor master",
};

const ts = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
const monthName = (ym: string | null | undefined) =>
  ym ? new Date(`${ym}-01T00:00:00`).toLocaleString("en-IN", { month: "long", year: "numeric" }) : "Current";

/** Next Monday or Thursday at 06:00 local time — the schedule Box 1 stands in for. */
function nextScheduledRun(now = new Date()) {
  for (let i = 0; i < 8; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    d.setHours(6, 0, 0, 0);
    if ((d.getDay() === 1 || d.getDay() === 4) && d > now) return d;
  }
  return now;
}

export default function Page() {
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
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<TableFilter>("all");
  const [query, setQuery] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [autoRun, setAutoRun] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const trendRef = useRef<HTMLDivElement>(null);
  const toastId = useRef(0);

  const toast = useCallback((tone: Tone, title: string, body?: string) => {
    setToasts((t) => [...t.slice(-2), { id: ++toastId.current, tone, title, body }]);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

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
  const fest = run?.result.festival;
  const exceptions = rows.filter((r) => r.isException);
  const g1 = gate1Progress(rows, decisions);
  const stats = overrideStats(rows, decisions);
  const po = poRows(rows, decisions);
  const poUnits = po.reduce((a, p) => a + p.qty, 0);
  const selectedRow = rows.find((r) => r.skuId === selected) ?? null;
  const stale = !!run && run.mode !== mode;
  const freeMode = explStatus?.note.startsWith("Free mode") ?? false;
  const distributorCount = new Set(rows.map((r) => r.distributorId).filter(Boolean)).size;

  // ---- loading -----------------------------------------------------------
  async function onFile(kind: FileKind, f: File | undefined) {
    if (!f) return;
    const parsed = parseCsv(kind, f.name, await f.text());
    setFiles((prev) => ({ ...prev, [kind]: parsed }));
    setIsDemo(false);
    if (parsed.error) toast("red", `${FILE_NAMES[kind]} rejected`, parsed.error);
    else toast("green", `${FILE_LABEL[kind]} loaded`, `${parsed.rows.length} rows from ${f.name}`);
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
        else toast("green", "Demo data loaded", "5 files · 16 SKUs incl. test SKU016. Run the forecast when ready.");
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

  // ---- BOX 1 → 5 ---------------------------------------------------------
  const runForecast = useCallback(async () => {
    if (!dataset) return;
    const result = runRules(dataset, mode);
    const at = new Date().toISOString();
    setRun({ result, at, mode });
    setDecisions({});
    setG2(null);
    setFilter("all");
    setSelected(result.rows.find((r) => r.isException)?.skuId ?? result.rows[0]?.skuId ?? null);
    const templates = Object.fromEntries(result.rows.map((r) => [r.skuId, templateExplanation(r, result.festival)]));
    setExpl(templates);
    setExplStatus({ source: "pending", note: "Asking Claude for reasons…" });
    toast("green", "Forecast complete", `${result.rows.length} SKUs · ${result.summary.exceptions} exception(s) for Gate 1`);
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

  // ---- BOX 7 -------------------------------------------------------------
  function approve(r: SkuResult) {
    setDecisions((d) => ({ ...d, [r.skuId]: { type: "approve", at: new Date().toISOString() } }));
    toast("green", `${r.skuId} approved`, `${r.action} · qty ${r.qty}`);
  }
  function override(r: SkuResult, qty: number, reason: string) {
    const at = new Date().toISOString();
    setDecisions((d) => ({ ...d, [r.skuId]: { type: "override", qty, reason, at } }));
    setLog((l) => [
      ...l.filter((e) => !(e.runAt === run!.at && e.sku === r.skuId)),
      { runAt: run!.at, sku: r.skuId, originalAction: r.action, originalQty: r.qty, overrideQty: qty, reason, by: g1Name, at },
    ]);
    toast("violet", `${r.skuId} overridden`, `qty ${r.qty} → ${qty}. Logged to the feedback loop.`);
  }
  function reopen(r: SkuResult) {
    setDecisions((d) => {
      const n = { ...d };
      delete n[r.skuId];
      return n;
    });
    setLog((l) => l.filter((e) => !(e.runAt === run!.at && e.sku === r.skuId)));
  }

  // ---- downloads ---------------------------------------------------------
  function downloadActionList() {
    downloadCsv(
      `freshroots_action_list_${run!.at.slice(0, 10)}.csv`,
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
    const by = `${g1Name} (Gate 1); ${g2!.by} (Gate 2)`;
    downloadCsv(
      `freshroots_po_list_${g2!.at.slice(0, 10)}.csv`,
      toCsv(
        ["SKU_ID", "SKU_Name", "Distributor_ID", "Action", "Final_Qty", "Approved_By", "Timestamp"],
        po.map((p) => [p.skuId, p.name, p.distributorId, p.action, p.qty, by, g2!.at]),
      ),
    );
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

  function focusSku(sku: string) {
    setSelected(sku);
    trendRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ---- pipeline status (sidebar + stepper) --------------------------------
  const okKinds = (ks: FileKind[]) => (ks.some((k) => files[k]?.error) ? "error" : ks.every((k) => files[k]) ? "done" : "ready");
  const steps: { n: number; name: string; icon: ReactNode; state: StepState; meta?: string }[] = [
    { n: 1, name: "Trigger", icon: <CalendarClock className="h-4 w-4" />, state: run ? "done" : allLoaded ? "ready" : "locked", meta: run ? "ran" : undefined },
    { n: 2, name: "Input", icon: <Database className="h-4 w-4" />, state: okKinds(["sales", "inventory"]) },
    { n: 3, name: "Context", icon: <Boxes className="h-4 w-4" />, state: okKinds(["skuMaster", "calendar", "distributors"]) },
    { n: 4, name: "Processing", icon: <Cpu className="h-4 w-4" />, state: run ? "done" : "locked" },
    { n: 5, name: "AI Layer", icon: <Sparkles className="h-4 w-4" />, state: !run ? "locked" : explStatus?.source === "pending" ? "ready" : "done" },
    { n: 6, name: "Output", icon: <Gauge className="h-4 w-4" />, state: run ? "done" : "locked" },
    { n: 7, name: "Gate 1 · Raghav", icon: <UserCheck className="h-4 w-4" />, state: !run ? "locked" : g1.complete ? "done" : "attention", meta: run ? `${g1.resolved}/${g1.total}` : undefined },
    { n: 8, name: "Gate 2 · Procurement", icon: <ShieldCheck className="h-4 w-4" />, state: g2 ? "done" : run && g1.complete ? "ready" : "locked" },
  ];

  const tableRows = rows.filter((r) => {
    const q = query.trim().toLowerCase();
    if (q && !`${r.skuId} ${r.name} ${r.distributorName}`.toLowerCase().includes(q)) return false;
    if (filter === "reorder") return isReorder(r.action);
    if (filter === "pause") return r.action === "PAUSE";
    if (filter === "hold") return r.action === "HOLD";
    if (filter === "exceptions") return r.isException;
    return true;
  });
  const filterCounts: Record<TableFilter, number> = {
    all: rows.length,
    reorder: rows.filter((r) => isReorder(r.action)).length,
    pause: rows.filter((r) => r.action === "PAUSE").length,
    hold: rows.filter((r) => r.action === "HOLD").length,
    exceptions: exceptions.length,
  };

  const next = nextScheduledRun();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* ===== Sidebar ===== */}
      <div className={`fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm transition-opacity lg:hidden ${navOpen ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={() => setNavOpen(false)} />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-slate-950 text-slate-300 transition-transform duration-300 lg:w-64 lg:translate-x-0 ${navOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-16 items-center justify-between gap-2 px-5">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-500/20">
              <Leaf className="h-4 w-4" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-white">Freshroots</p>
              <p className="text-[11px] text-slate-400">Demand Planner</p>
            </div>
          </div>
          <button className="text-slate-400 lg:hidden" onClick={() => setNavOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mx-4 mb-4 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wider text-slate-500">Workspace</p>
          <p className="truncate text-sm font-medium text-slate-200">Pune Central Warehouse</p>
          <p className="text-[11px] text-slate-500">{isDemo ? "Demo dataset" : "Uploaded data"} · Rules v1</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-3">
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Pipeline</p>
          <ol className="space-y-0.5">
            {steps.map((s) => (
              <li key={s.n}>
                <a
                  href={`#box-${s.n}`}
                  onClick={() => setNavOpen(false)}
                  className="group flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/5 text-[11px] font-semibold text-slate-400 group-hover:text-white">{s.n}</span>
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <StepDot state={s.state} meta={s.meta} />
                </a>
              </li>
            ))}
          </ol>
          <a
            href="#feedback"
            onClick={() => setNavOpen(false)}
            className="mt-3 flex items-center gap-3 rounded-lg border border-dashed border-white/10 px-2 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white"
          >
            <Repeat2 className="h-4 w-4 text-slate-500" />
            <span className="flex-1">Feedback 8 → 3</span>
            {stats.killCriterion ? <span className="h-2 w-2 rounded-full bg-red-500" /> : null}
          </a>
        </nav>

        <div className="space-y-3 border-t border-white/5 p-4">
          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 ring-1 ring-inset ring-emerald-500/20">
            <Sparkles className="h-3.5 w-3.5" />
            {explStatus?.source === "ai" ? "Claude connected" : "Free mode · no paid API"}
          </div>
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-slate-700 to-slate-800 text-sm font-semibold text-white">
              {(g1Name.trim()[0] ?? "R").toUpperCase()}
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-medium text-white">{g1Name || "Planner"}</p>
              <p className="text-[11px] text-slate-500">Senior Demand Planner</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ===== Main column ===== */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <button className="-ml-1 rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <nav className="flex min-w-0 items-center gap-1.5 text-sm text-slate-500">
            <span className="hidden sm:inline">Planning</span>
            <ChevronRight className="hidden h-3.5 w-3.5 sm:inline" />
            <span className="truncate font-semibold text-slate-900">{monthName(dataset?.asOfMonth)} cycle</span>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {fest && (
              <span className="hidden md:inline-flex">
                <Chip tone={fest.on ? "green" : "slate"} dot>
                  Festival uplift {fest.on ? "ON" : "OFF"}
                </Chip>
              </span>
            )}
            {run && (
              <span className="hidden md:inline-flex">
                <Chip tone={g1.complete ? "green" : "violet"} dot>
                  {g1.complete ? "Gate 1 clear" : `${g1.total - g1.resolved} to review`}
                </Chip>
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={() => loadDemo(false)}>
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Load demo data</span>
              <span className="sm:hidden">Demo</span>
            </Button>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          {/* ===== BOX 1 · TRIGGER (hero) ===== */}
          <section id="box-1" className="relative scroll-mt-20 overflow-hidden rounded-3xl bg-slate-950 text-white shadow-xl shadow-slate-900/10">
            <div className="pointer-events-none absolute inset-0">
              <Aurora colorStops={["#047857", "#34d399", "#0ea5e9"]} amplitude={1.1} blend={0.55} speed={0.6} brightness={1.2} height={0.75} mouseInteraction={false} />
            </div>
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-slate-950/85 via-slate-950/35 to-transparent" />
            <div className="relative grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-end">
              <div className="max-w-2xl">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-200 ring-1 ring-inset ring-white/15">
                  Box 1 · Trigger
                </span>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
                  <ShinyText text={`${monthName(dataset?.asOfMonth)} demand cycle`} color="#ffffff" shineColor="#6ee7b7" speed={3.5} />
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-300">
                  Raghav&apos;s documented rules run in code every Monday and Thursday at 6 AM. AI only explains exceptions, and two people approve before any PO exists.
                </p>
                <dl className="mt-6 grid max-w-xl grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                  <HeroStat label="SKUs" value={summary?.skusLoaded ?? "—"} />
                  <HeroStat label="Distributors" value={distributorCount || (dataset ? new Set(dataset.skus.map((s) => s.master?.distributorId)).size : "—")} />
                  <HeroStat label="Stock as-of" value={summary?.asOfDate ?? "—"} />
                  <HeroStat label="Uplift" value={fest ? (fest.on ? "×1.25 ON" : "OFF") : dataset?.asOfMonth && dataset.festivalMonths.has(dataset.asOfMonth) ? "×1.25 ON" : "—"} />
                </dl>
              </div>
              <div className="flex flex-col gap-3 rounded-2xl bg-white/[0.06] p-4 ring-1 ring-inset ring-white/10 backdrop-blur-sm lg:w-80">
                <Button size="lg" onClick={runForecast} disabled={!allLoaded} className="!bg-white !text-slate-900 hover:!bg-emerald-50 disabled:!bg-white/20 disabled:!text-white/50">
                  <Play className="h-4 w-4 fill-current" />
                  Run forecast
                </Button>
                <div className="space-y-1 text-xs text-slate-300">
                  <p className="flex justify-between gap-3">
                    <span className="text-slate-400">Last run</span>
                    <span className="font-medium text-white">{run ? ts(run.at) : "Never"}</span>
                  </p>
                  <p className="flex justify-between gap-3">
                    <span className="text-slate-400">Next scheduled</span>
                    <span className="font-medium text-white">{next.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short" })}, 6:00 AM</span>
                  </p>
                </div>
                {!allLoaded && <p className="text-xs text-amber-200">Load all 5 files in Boxes 2 and 3 to enable.</p>}
                {stale && <p className="text-xs text-amber-200">Uplift setting changed. Run again to apply it.</p>}
              </div>
            </div>
          </section>

          {/* Mobile pipeline stepper */}
          <div className="-mx-4 overflow-x-auto px-4 lg:hidden">
            <ol className="flex w-max gap-2">
              {steps.map((s) => (
                <li key={s.n}>
                  <a href={`#box-${s.n}`} className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">
                    <span className="text-slate-400">{s.n}</span>
                    {s.name}
                    <StepDot state={s.state} />
                  </a>
                </li>
              ))}
            </ol>
          </div>

          {/* ===== BOX 2 + BOX 3 ===== */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <BoxCard n={2} name="Input" hint="Sales history and stock on hand" icon={<Database className="h-4 w-4" />}>
              <div className="space-y-2">
                {(["sales", "inventory"] as FileKind[]).map((k) => (
                  <FileRow key={k} kind={k} file={files[k]} onFile={onFile} />
                ))}
              </div>
              {summary && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 px-4 py-2">
                    <StatRow label="SKUs loaded" value={summary.skusLoaded} />
                    <StatRow label="Sales rows" value={summary.salesRows} />
                    <StatRow label="Inventory as-of" value={summary.asOfDate ?? "missing"} tone={summary.asOfDate ? undefined : "red"} />
                    <StatRow label="Rows rejected" value={summary.rejected.length} tone={summary.rejected.length ? "red" : "green"} />
                  </div>
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <p className="mb-2 text-xs font-medium text-slate-500">Weeks of history per SKU</p>
                    <div className="flex flex-wrap gap-1">
                      {summary.weeksPerSku.map((w) => (
                        <span
                          key={w.skuId}
                          title={w.first ? `${w.first} → ${w.last}` : "no history"}
                          className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${w.weeks < RULES.longWindow ? "bg-amber-100 text-amber-800" : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200"}`}
                        >
                          {w.skuId.replace("SKU", "")}·{w.weeks}w
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {summary && summary.rejected.length > 0 && (
                <Callout tone="red">
                  <p className="font-semibold">Rejected rows</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {summary.rejected.map((r, i) => (
                      <li key={i}>
                        {FILE_NAMES[r.file]} row {r.row}
                        {r.skuId ? ` (${r.skuId})` : ""}: {r.reason}
                      </li>
                    ))}
                  </ul>
                </Callout>
              )}
              {summary?.warnings.map((w) => (
                <Callout key={w} tone="amber">{w}</Callout>
              ))}
            </BoxCard>

            <BoxCard n={3} name="Context" hint="Master data, festival calendar and Rules v1" icon={<Boxes className="h-4 w-4" />}>
              <div className="space-y-2">
                {(["skuMaster", "calendar", "distributors"] as FileKind[]).map((k) => (
                  <FileRow key={k} kind={k} file={files[k]} onFile={onFile} />
                ))}
              </div>
              <div className="mt-4 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Lock className="h-3.5 w-3.5 text-slate-400" /> Rules v1
                  </p>
                  <Chip>read-only</Chip>
                </div>
                <dl className="divide-y divide-slate-100 text-xs">
                  <Rule id="R1" name="Festival uplift">If the inventory As_Of_Date month is a festival month, expected weekly demand = 12-wk avg × {RULES.festivalUplift}; otherwise = 12-wk avg. Applied before any threshold.</Rule>
                  <Rule id="R2" name="High demand">4-wk avg &gt; 12-wk avg × {RULES.highDemandRatio} → HIGH_DEMAND. Raw averages, no uplift.</Rule>
                  <Rule id="R3" name="Stockout risk">Weeks of cover &lt; min window → STOCKOUT.</Rule>
                  <Rule id="R4" name="Overstock">Weeks of cover &gt; max window → OVERSTOCK.</Rule>
                  <Rule id="R5" name="Windows">High perishability {RULES.windows.High.min}–{RULES.windows.High.max} wks · Low {RULES.windows.Low.min}–{RULES.windows.Low.max} wks.</Rule>
                </dl>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 text-xs">
                  <span className="text-slate-600">
                    {dataset ? (
                      <>
                        Calendar: <b>{dataset.asOfMonth}</b> is {dataset.asOfMonth && dataset.festivalMonths.has(dataset.asOfMonth) ? <b className="text-emerald-700">a festival month</b> : <b>not a festival month</b>}
                      </>
                    ) : (
                      "Calendar not loaded"
                    )}
                  </span>
                  <label className="flex items-center gap-2 text-slate-600">
                    What-if uplift
                    <select value={mode} onChange={(e) => setMode(e.target.value as UpliftMode)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700">
                      <option value="auto">Auto (calendar)</option>
                      <option value="off">Force OFF</option>
                      <option value="on">Force ON</option>
                    </select>
                  </label>
                </div>
              </div>
              <Callout tone="blue">
                <b>Assumption:</b> weeks of cover = Units_On_Hand ÷ expected weekly demand. There is no open-PO data, so stock already on order is not counted.
              </Callout>
            </BoxCard>
          </div>

          {/* ===== BOX 4 + BOX 5 ===== */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <BoxCard n={4} name="Processing" hint="Pure code, no AI · fixed rule order" icon={<Cpu className="h-4 w-4" />}>
              <ol className="mb-4 flex flex-wrap items-center gap-1.5 text-xs">
                {["R5 windows", "R1 uplift", "R2 demand", "R3 stockout", "R4 overstock", "Action"].map((s, i, a) => (
                  <li key={s} className="flex items-center gap-1.5">
                    <span className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700">{s}</span>
                    {i < a.length - 1 && <ChevronRight className="h-3 w-3 text-slate-300" />}
                  </li>
                ))}
              </ol>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">When</th>
                      <th className="px-3 py-2 font-medium">Action</th>
                      <th className="px-3 py-2 font-medium">Qty</th>
                      <th className="px-3 py-2 text-right font-medium">SKUs</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <ActionRule when="STOCKOUT + HIGH_DEMAND" action="REORDER_NOW" qty="1.5 × std" count={rows.filter((r) => r.action === "REORDER_NOW" && r.flags.includes("HIGH_DEMAND")).length} run={!!run} />
                    <ActionRule when="STOCKOUT only" action="REORDER_NOW" qty="std" count={rows.filter((r) => r.action === "REORDER_NOW" && !r.flags.includes("HIGH_DEMAND")).length} run={!!run} />
                    <ActionRule when="HIGH_DEMAND, not overstock" action="REORDER_1.5X" qty="1.5 × std" count={rows.filter((r) => r.action === "REORDER_1.5X").length} run={!!run} />
                    <ActionRule when="OVERSTOCK only" action="PAUSE" qty="0" count={rows.filter((r) => r.action === "PAUSE").length} run={!!run} />
                    <ActionRule when="No flag · conflict · missing data" action="HOLD" qty="0" count={rows.filter((r) => r.action === "HOLD").length} run={!!run} />
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Per SKU: avg_4w, avg_12w, expected weekly demand, weeks of cover and max week-on-week change over the last 4 transitions. Quantities round up to whole units. The AI never sets or edits a quantity.
              </p>
            </BoxCard>

            <BoxCard
              n={5}
              name="AI Layer"
              hint="Claude via /api/explain · flags and explains, never decides"
              icon={<Sparkles className="h-4 w-4" />}
              right={run ? <Chip tone={exceptions.length ? "violet" : "green"} dot>{exceptions.length} of {rows.length} exceptions</Chip> : undefined}
            >
              <p className="mb-2 text-xs font-medium text-slate-500">A SKU is an exception when any of these is true</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Trigger icon={<CircleDashed className="h-3.5 w-3.5" />} title="New launch" desc={`< ${RULES.longWindow} weeks of history`} count={rows.filter((r) => r.exceptionCodes.includes("NEW_LAUNCH")).length} run={!!run} />
                <Trigger icon={<Activity className="h-3.5 w-3.5" />} title="Distributor swing" desc={`WoW change > ${RULES.swingThreshold * 100}% (last ${RULES.swingTransitions})`} count={rows.filter((r) => r.exceptionCodes.includes("SWING")).length} run={!!run} />
                <Trigger icon={<TriangleAlert className="h-3.5 w-3.5" />} title="Conflicting flags" desc="HIGH_DEMAND / STOCKOUT + OVERSTOCK" count={rows.filter((r) => r.exceptionCodes.includes("CONFLICT")).length} run={!!run} />
                <Trigger icon={<Database className="h-3.5 w-3.5" />} title="Missing data" desc="Any required field invalid" count={rows.filter((r) => r.exceptionCodes.includes("DATA")).length} run={!!run} />
              </div>
              {explStatus && (
                <Callout tone={explStatus.source === "ai" || freeMode ? "green" : explStatus.source === "pending" ? "slate" : "amber"}>
                  {explStatus.source === "template" && !freeMode && <b>Template fallback: </b>}
                  {explStatus.note}
                </Callout>
              )}
              <p className="mt-3 text-xs text-slate-500">All SKUs go in one batched request. The reply is validated as JSON; anything invalid falls back to templates.</p>
            </BoxCard>
          </div>

          {/* ===== BOX 6 · OUTPUT ===== */}
          <BoxCard
            n={6}
            name="Output"
            hint="Summary, dashboard, exception queue and SKU action list"
            icon={<Gauge className="h-4 w-4" />}
            right={
              run ? (
                <Button variant="secondary" size="sm" onClick={downloadActionList}>
                  <Download className="h-3.5 w-3.5" /> Action list CSV
                </Button>
              ) : undefined
            }
          >
            {!run ? (
              <EmptyState icon={<Gauge className="h-5 w-5" />} title="No forecast yet" body="Run the forecast in Box 1 to populate the dashboard." />
            ) : (
              <div className="space-y-6">
                {/* Summary strip */}
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone="red" dot>HIGH_DEMAND · {run.result.summary.flagCounts.HIGH_DEMAND}</Chip>
                  <Chip tone="red" dot>STOCKOUT · {run.result.summary.flagCounts.STOCKOUT}</Chip>
                  <Chip tone="amber" dot>OVERSTOCK · {run.result.summary.flagCounts.OVERSTOCK}</Chip>
                  <Chip tone="violet" dot>Exceptions · {exceptions.length}</Chip>
                  <Chip tone={fest!.on ? "green" : "slate"} dot>
                    Festival uplift {fest!.on ? "ON" : "OFF"} · {fest!.month ?? "?"}
                    {fest!.mode !== "auto" ? " (what-if)" : ""}
                  </Chip>
                </div>

                {/* KPI tiles */}
                <div key={run.at} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                  <Kpi label="SKUs reviewed" value={rows.length} icon={<ClipboardCheck className="h-4 w-4" />} sub={`${distributorCount} distributors`} />
                  <Kpi label="Reorders" value={filterCounts.reorder} icon={<PackageCheck className="h-4 w-4" />} tone="red" sub={<><b className="text-slate-700">{run.result.summary.reorderUnits.toLocaleString("en-IN")}</b> units suggested</>} />
                  <Kpi label="Pauses" value={filterCounts.pause} icon={<PauseCircle className="h-4 w-4" />} tone="amber" sub="Overstocked, stop reordering" />
                  <Kpi label="Exceptions open" value={g1.total - g1.resolved} suffix={`/ ${g1.total}`} icon={<TriangleAlert className="h-4 w-4" />} tone="violet" sub={g1.complete ? "All resolved" : "Waiting on Gate 1"} />
                  <Kpi label="Festival uplift" text={fest!.on ? "ON" : "OFF"} icon={<Sparkles className="h-4 w-4" />} tone={fest!.on ? "green" : "slate"} sub={`${monthName(fest!.month)} · ×${fest!.on ? RULES.festivalUplift : 1}`} />
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                  <Panel
                    className="xl:col-span-2"
                    title="Weeks of cover · Low perishability"
                    sub={`Shaded band = ${RULES.windows.Low.min}–${RULES.windows.Low.max} wk window. Click a bar for its trend.`}
                    right={<ChartLegend />}
                  >
                    <CoverChart rows={rows} perishability="Low" onSelect={focusSku} selected={selected} />
                  </Panel>
                  <Panel title="Weeks of cover · High perishability" sub={`Perishables: ${RULES.windows.High.min}–${RULES.windows.High.max} wk window`}>
                    <CoverChart rows={rows} perishability="High" onSelect={focusSku} selected={selected} />
                  </Panel>
                </div>

                <div ref={trendRef}>
                  <Panel
                    title={selectedRow ? `Sales trend · ${selectedRow.skuId} ${selectedRow.name}` : "Sales trend"}
                    sub={
                      selectedRow
                        ? `Last ${selectedRow.history.length} weeks · 4-wk avg ${fmt(selectedRow.avg4w)} · 12-wk avg ${fmt(selectedRow.avg12w)} · shaded = festival-month weeks`
                        : "Click a SKU row or bar to see its trend."
                    }
                    right={selectedRow ? <ActionBadge action={selectedRow.action} /> : undefined}
                  >
                    {selectedRow ? (
                      <>
                        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <MiniStat label="On hand" value={selectedRow.unitsOnHand?.toLocaleString("en-IN") ?? "—"} />
                          <MiniStat label="Expected / wk" value={fmt(selectedRow.expectedWeeklyDemand)} />
                          <MiniStat label="Weeks of cover" value={fmt(selectedRow.weeksOfCover, 2)} />
                          <MiniStat label="Max WoW change" value={selectedRow.maxWowChange === null ? "—" : `${selectedRow.maxWowChange >= 0 ? "+" : ""}${Math.round(selectedRow.maxWowChange * 100)}%`} />
                        </div>
                        <TrendChart row={selectedRow} />
                      </>
                    ) : (
                      <EmptyState icon={<Activity className="h-5 w-5" />} title="Pick a SKU" body="Select a row in the action list or a bar above." />
                    )}
                  </Panel>
                </div>

                {/* Exception queue */}
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      Exception queue <Chip tone="violet">{exceptions.length}</Chip>
                    </h3>
                    <a href="#box-7" className="text-xs font-medium text-violet-700 hover:underline">Resolve in Gate 1 →</a>
                  </div>
                  {exceptions.length === 0 ? (
                    <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="No exceptions" body="Every SKU followed the documented rules cleanly." />
                  ) : (
                    <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {exceptions.map((r) => (
                        <li key={r.skuId} className="rounded-2xl border border-violet-200/70 bg-gradient-to-br from-violet-50/80 to-white p-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <button onClick={() => focusSku(r.skuId)} className="text-left">
                              <p className="text-xs font-medium text-violet-700">{r.skuId}</p>
                              <p className="text-sm font-semibold text-slate-900 hover:underline">{r.name || "(no name)"}</p>
                            </button>
                            <div className="flex flex-wrap gap-1">
                              {r.exceptionCodes.map((c) => <Chip key={c} tone="violet">{c.replace("_", " ")}</Chip>)}
                            </div>
                          </div>
                          <div className="mt-3 space-y-2 text-sm">
                            <p className="text-slate-700"><span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Why</span>{expl[r.skuId]?.reason}</p>
                            <p className="text-slate-700"><span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Check</span>{expl[r.skuId]?.check}</p>
                          </div>
                          <div className="mt-3 flex items-center justify-between border-t border-violet-100 pt-3 text-xs">
                            <span className="flex items-center gap-2 text-slate-500">Rule result <ActionBadge action={r.action} /> <b className="text-slate-800">qty {r.qty}</b></span>
                            {decisions[r.skuId] ? <Chip tone="green" dot>Resolved</Chip> : <Chip tone="violet" dot>Open</Chip>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* SKU Action List */}
                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-900">SKU action list</h3>
                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                      <div className="flex max-w-full overflow-x-auto rounded-xl bg-slate-100 p-0.5 text-xs font-medium">
                        {(["all", "reorder", "pause", "hold", "exceptions"] as TableFilter[]).map((f) => (
                          <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`rounded-[10px] px-2.5 py-1.5 capitalize transition ${filter === f ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                          >
                            {f} <span className="text-slate-400">{filterCounts[f]}</span>
                          </button>
                        ))}
                      </div>
                      <label className="relative flex-1 sm:flex-none">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Search SKU, name, distributor"
                          className="h-8 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 text-xs outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 sm:w-56"
                        />
                      </label>
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-2xl border border-slate-200">
                    <table className="min-w-full text-xs">
                      <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                        <tr>
                          {["SKU", "Name", "Distributor", "Perish.", "Stock", "avg_4w", "avg_12w", "Exp./wk", "Cover", "Flags", "Action", "Qty", "Reason"].map((h, i) => (
                            <th key={h} className={`whitespace-nowrap px-3 py-2.5 font-semibold ${i >= 4 && i <= 8 ? "text-right" : ""} ${i === 11 ? "text-right" : ""}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {tableRows.map((r) => {
                          const f = finalRow(r, decisions[r.skuId]);
                          const coverTone =
                            r.weeksOfCover === null || r.minWindow === null ? "text-slate-400" : r.weeksOfCover < r.minWindow ? "text-red-600" : r.weeksOfCover > r.maxWindow! ? "text-amber-600" : "text-emerald-700";
                          return (
                            <tr
                              key={r.skuId}
                              onClick={() => focusSku(r.skuId)}
                              className={`cursor-pointer transition-colors hover:bg-emerald-50/50 ${selected === r.skuId ? "bg-emerald-50/70" : ""}`}
                            >
                              <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-slate-900">
                                <span className="flex items-center gap-1.5">
                                  {r.skuId}
                                  {r.isException && <span title={r.exceptionNotes.join("; ")} className="h-1.5 w-1.5 rounded-full bg-violet-500" />}
                                </span>
                              </td>
                              <td className="min-w-[160px] px-3 py-2.5 text-slate-700">{r.name}</td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">{r.distributorName || r.distributorId}</td>
                              <td className="px-3 py-2.5">{r.perishability ? <Chip tone={r.perishability === "High" ? "blue" : "slate"}>{r.perishability}</Chip> : "—"}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{r.unitsOnHand?.toLocaleString("en-IN") ?? "—"}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.avg4w)}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.avg12w)}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.expectedWeeklyDemand)}</td>
                              <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${coverTone}`}>{fmt(r.weeksOfCover, 2)}</td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{r.flags.length ? r.flags.join(", ") : <span className="text-slate-300">—</span>}</td>
                              <td className="px-3 py-2.5"><ActionBadge action={r.action} /></td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums">
                                {r.qty}
                                {f.overridden && <span className="block text-[11px] font-medium text-violet-700">→ {f.qty} override</span>}
                              </td>
                              <td className="min-w-[300px] max-w-[420px] px-3 py-2.5 text-slate-600">
                                <span className="line-clamp-2" title={expl[r.skuId]?.reason}>{expl[r.skuId]?.reason}</span>
                              </td>
                            </tr>
                          );
                        })}
                        {tableRows.length === 0 && (
                          <tr>
                            <td colSpan={13} className="px-3 py-10 text-center text-sm text-slate-400">No SKUs match this filter.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </BoxCard>

          {/* ===== BOX 7 + BOX 8 ===== */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <BoxCard
              n={7}
              name="Human Gate 1 — Raghav"
              hint="Approve or override every exception"
              icon={<UserCheck className="h-4 w-4" />}
              right={run ? <ProgressPill done={g1.resolved} total={g1.total} /> : undefined}
            >
              {!run ? (
                <EmptyState icon={<UserCheck className="h-5 w-5" />} title="Waiting for a run" body="Exceptions land here after the forecast runs." />
              ) : (
                <>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    Planner
                    <input value={g1Name} onChange={(e) => setG1Name(e.target.value)} disabled={!!g2} className="h-8 rounded-lg border border-slate-300 px-2.5 text-sm text-slate-900 disabled:bg-slate-50" />
                  </label>
                  {exceptions.length === 0 && <Callout tone="green">No exceptions — Gate 1 has nothing to review.</Callout>}
                  <ul className="mt-4 space-y-3">
                    {exceptions.map((r) => (
                      <ExceptionDecision
                        key={`${run.at}-${r.skuId}`}
                        row={r}
                        decision={decisions[r.skuId]}
                        locked={!!g2}
                        onApprove={() => approve(r)}
                        onOverride={(q, why) => override(r, q, why)}
                        onReopen={() => reopen(r)}
                      />
                    ))}
                  </ul>
                </>
              )}
            </BoxCard>

            <BoxCard
              n={8}
              name="Human Gate 2 — Procurement"
              hint="Stands in for Zoho — nothing is auto-ordered"
              icon={<ShieldCheck className="h-4 w-4" />}
              right={g2 ? <Chip tone="green" dot>Approved</Chip> : run ? <Chip tone={g1.complete ? "amber" : "slate"} dot>{g1.complete ? "Ready for approval" : "Locked"}</Chip> : undefined}
            >
              {!run ? (
                <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="Waiting for a run" body="The final PO list appears here." />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <MiniStat label="PO lines" value={po.length} />
                    <MiniStat label="Total units" value={poUnits.toLocaleString("en-IN")} />
                  </div>
                  <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full text-xs">
                      <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                        <tr>{["SKU", "Name", "Distributor", "Action", "Final qty"].map((h, i) => <th key={h} className={`px-3 py-2 font-semibold ${i === 4 ? "text-right" : ""}`}>{h}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {po.map((p) => (
                          <tr key={p.skuId}>
                            <td className="px-3 py-2 font-semibold">{p.skuId}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-slate-600">{p.name}</td>
                            <td className="px-3 py-2 text-slate-500">{p.distributorId}</td>
                            <td className="px-3 py-2"><ActionBadge action={p.action} /></td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">
                              {p.qty}
                              {p.overridden && <span className="ml-1 text-violet-600">*</span>}
                            </td>
                          </tr>
                        ))}
                        {po.length === 0 && (
                          <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">No reorder lines.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {po.some((p) => p.overridden) && <p className="mt-1.5 text-xs text-slate-500"><span className="text-violet-600">*</span> quantity set by a Gate 1 override</p>}

                  <div className="mt-4 rounded-xl bg-slate-50 p-3">
                    <div className="flex flex-col gap-2">
                      <input
                        value={g2Name}
                        onChange={(e) => setG2Name(e.target.value)}
                        disabled={!!g2}
                        placeholder="Procurement approver name"
                        className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-100"
                      />
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Button
                        variant="dark"
                        onClick={() => {
                          setG2({ by: g2Name.trim(), at: new Date().toISOString() });
                          toast("green", "Final list approved", "Gate 1 decisions are now locked. PO download enabled.");
                        }}
                        disabled={!g1.complete || !g2Name.trim() || !!g2}
                      >
                        <ShieldCheck className="h-4 w-4" /> Approve final list
                      </Button>
                      <Button onClick={downloadPo} disabled={!g2}>
                        <Download className="h-4 w-4" /> Download PO list
                      </Button>
                      </div>
                    </div>
                    {!g1.complete && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-violet-700">
                        <Lock className="h-3 w-3" /> Locked: {g1.total - g1.resolved} exception(s) still open in Gate 1.
                      </p>
                    )}
                    {g1.complete && !g2Name.trim() && !g2 && <p className="mt-2 text-xs text-slate-500">Enter the approver&apos;s name to approve.</p>}
                  </div>
                  {g2 && <Callout tone="green">Approved by <b>{g2.by}</b> at {ts(g2.at)}. Gate 1 decisions are locked.</Callout>}
                </>
              )}
            </BoxCard>
          </div>

          {/* ===== FEEDBACK LOOP ===== */}
          <section id="feedback" className="scroll-mt-20 rounded-2xl border border-dashed border-slate-300 bg-white">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-600"><Repeat2 className="h-4 w-4" /></div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Feedback loop · 8 → 3</p>
                  <h2 className="text-[15px] font-semibold text-slate-900">Overrides feed back into Rules v1</h2>
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={downloadLog} disabled={!log.length}>
                <Download className="h-3.5 w-3.5" /> Override log CSV
              </Button>
            </header>
            <div className="p-5">
              {stats.killCriterion && (
                <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <p><b>Rules may need re-documenting (kill criterion).</b> Override rate is {Math.round(stats.overrideRate * 100)}%, above the {KILL_CRITERION_OVERRIDE_RATE * 100}% threshold.</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <RateTile label="Override rate" value={stats.resolved ? stats.overrideRate : null} sub={`${stats.overrides} of ${stats.resolved} resolved`} bad={stats.killCriterion} />
                <RateTile label="Acceptance rate" value={stats.resolved ? stats.acceptanceRate : null} sub={`${stats.approvals} approved as-is`} />
                <MiniStat label="Kill threshold" value={`${KILL_CRITERION_OVERRIDE_RATE * 100}%`} hint="override rate" />
                <MiniStat label="Override log" value={log.length} hint="entries this session" />
              </div>
              {log.length > 0 ? (
                <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 text-xs">
                  {log.map((e) => (
                    <li key={`${e.runAt}-${e.sku}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        <b className="text-slate-900">{e.sku}</b>
                        <ActionBadge action={e.originalAction} />
                        <span className="tabular-nums text-slate-500">{e.originalQty} → <b className="text-violet-700">{e.overrideQty}</b></span>
                      </span>
                      <span className="text-slate-600">“{e.reason}”</span>
                      <span className="text-slate-400">{e.by} · {ts(e.at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-xs text-slate-500">No overrides yet. Rates use the current run&apos;s resolved exceptions; the log keeps every override from this session (in memory only).</p>
              )}
            </div>
          </section>

          <footer className="flex flex-wrap items-center justify-between gap-2 pb-4 text-xs text-slate-400">
            <span>Freshroots Demand Planner · class prototype · no database, state lives in this tab</span>
            <span>Rules run in code · AI explains · humans decide</span>
          </footer>
        </main>
      </div>

      <Toasts items={toasts} onDismiss={dismiss} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local components
// ---------------------------------------------------------------------------

function StepDot({ state, meta }: { state: StepState; meta?: string }) {
  if (meta && state === "attention") return <span className="rounded-full bg-violet-500/15 px-1.5 text-[10px] font-semibold text-violet-300 ring-1 ring-inset ring-violet-400/30">{meta}</span>;
  const cls = { done: "bg-emerald-400", attention: "bg-violet-400", ready: "bg-amber-400", locked: "bg-slate-600", error: "bg-red-500" }[state];
  return <span className={`h-2 w-2 shrink-0 rounded-full ${cls}`} title={state} />;
}

function HeroStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums text-white">{value}</dd>
    </div>
  );
}

function FileRow({ kind, file, onFile }: { kind: FileKind; file?: LoadedFile; onFile: (k: FileKind, f: File | undefined) => void }) {
  const state = !file ? "missing" : file.error ? "error" : "ok";
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${state === "error" ? "border-red-200 bg-red-50/50" : "border-slate-200"}`}>
      <div className="flex items-center gap-3">
        <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${state === "ok" ? "bg-emerald-50 text-emerald-600" : state === "error" ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-400"}`}>
          <FileSpreadsheet className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">{FILE_LABEL[kind]}</p>
          <p className="truncate font-mono text-[11px] text-slate-500">
            {file ? `${file.fileName}${state === "ok" ? ` · ${file.rows.length} rows` : ""}` : FILE_NAMES[kind]}
          </p>
        </div>
        {state === "ok" && <Chip tone="green" dot>Loaded</Chip>}
        {state === "error" && <Chip tone="red" dot>Invalid</Chip>}
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50">
          <Upload className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{file ? "Replace" : "Upload"}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              onFile(kind, e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {file?.error && <p className="mt-2 text-xs font-medium text-red-700">{file.error}</p>}
    </div>
  );
}

function Rule({ id, name, children }: { id: string; name: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 px-4 py-2.5">
      <dt className="w-24 shrink-0">
        <span className="mr-1.5 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{id}</span>
        <span className="font-semibold text-slate-800">{name}</span>
      </dt>
      <dd className="text-slate-600">{children}</dd>
    </div>
  );
}

function ActionRule({ when, action, qty, count, run }: { when: string; action: string; qty: string; count: number; run: boolean }) {
  return (
    <tr>
      <td className="px-3 py-2 text-slate-700">{when}</td>
      <td className="px-3 py-2"><ActionBadge action={action} /></td>
      <td className="whitespace-nowrap px-3 py-2 text-slate-500">{qty}</td>
      <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{run ? count : "—"}</td>
    </tr>
  );
}

function Trigger({ icon, title, desc, count, run }: { icon: ReactNode; title: string; desc: string; count: number; run: boolean }) {
  const hit = run && count > 0;
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border p-3 ${hit ? "border-violet-200 bg-violet-50/60" : "border-slate-200"}`}>
      <span className={`mt-0.5 ${hit ? "text-violet-600" : "text-slate-400"}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-800">{title}</p>
        <p className="text-[11px] text-slate-500">{desc}</p>
      </div>
      {run && <span className={`text-sm font-semibold tabular-nums ${hit ? "text-violet-700" : "text-slate-300"}`}>{count}</span>}
    </div>
  );
}

function Panel({ title, sub, right, className = "", children }: { title: string; sub?: string; right?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-2xl border border-slate-200 p-4 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function ChartLegend() {
  return (
    <div className="flex gap-3 text-[11px] text-slate-500">
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-500" />Reorder</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-500" />Pause</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-300" />Hold</span>
    </div>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function RateTile({ label, value, sub, bad }: { label: string; value: number | null; sub: string; bad?: boolean }) {
  const pct = value === null ? 0 : Math.round(value * 100);
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${bad ? "text-red-600" : "text-slate-900"}`}>{value === null ? "—" : `${pct}%`}</p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full transition-all ${bad ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{sub}</p>
    </div>
  );
}

function ProgressPill({ done, total }: { done: number; total: number }) {
  const pct = total ? (done / total) * 100 : 100;
  const complete = done === total;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full transition-all ${complete ? "bg-emerald-500" : "bg-violet-500"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-semibold tabular-nums ${complete ? "text-emerald-700" : "text-violet-700"}`}>Resolved {done}/{total}</span>
    </div>
  );
}

function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-400">{icon}</div>
      <p className="mt-3 text-sm font-semibold text-slate-700">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{body}</p>
    </div>
  );
}

function ExceptionDecision({
  row,
  decision,
  locked,
  onApprove,
  onOverride,
  onReopen,
}: {
  row: SkuResult;
  decision?: Decision;
  locked: boolean;
  onApprove: () => void;
  onOverride: (qty: number, reason: string) => void;
  onReopen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(String(row.qty));
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <li className={`rounded-2xl border p-4 transition-colors ${decision ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-slate-500">{row.skuId}</p>
          <p className="text-sm font-semibold text-slate-900">{row.name}</p>
        </div>
        <span className="flex items-center gap-2 text-xs text-slate-500">
          <ActionBadge action={row.action} /> qty <b className="text-slate-900">{row.qty}</b>
        </span>
      </div>
      <p className="mt-2 text-xs text-slate-600">{row.exceptionNotes.join(" · ")}</p>
      {decision ? (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-emerald-100 pt-3 text-xs">
          <span className="flex items-center gap-1.5 font-medium text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {decision.type === "approve" ? `Approved as-is (qty ${row.qty})` : `Overridden to qty ${decision.qty} — “${decision.reason}”`}
          </span>
          {!locked && (
            <button onClick={onReopen} className="font-medium text-slate-500 hover:text-slate-800">Reopen</button>
          )}
        </div>
      ) : open ? (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="text-xs font-medium text-slate-600">
              New qty (≥ 0)
              <input type="number" min={0} step={1} value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 block h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm sm:w-28" />
            </label>
            <label className="flex-1 text-xs font-medium text-slate-600">
              Reason (required)
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you overriding?" rows={2} className="mt-1 block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
            </label>
          </div>
          {err && <p className="text-xs font-medium text-red-700">{err}</p>}
          <div className="flex gap-2">
            <Button
              variant="violet"
              size="sm"
              onClick={() => {
                const e = validateOverride(qty, reason);
                setErr(e);
                if (!e) onOverride(Number(qty), reason.trim());
              }}
            >
              Save override
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setOpen(false); setErr(null); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
          <Button size="sm" onClick={onApprove} disabled={locked}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Approve
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)} disabled={locked}>
            Override
          </Button>
        </div>
      )}
    </li>
  );
}
