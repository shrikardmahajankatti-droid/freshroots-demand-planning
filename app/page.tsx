"use client";

import { useMemo, useRef, useState } from "react";
import { CoverChart, TrendChart } from "@/components/Charts";
import { downloadCsv, parseCsv, type LoadedFile } from "@/lib/csv";
import {
  FILE_NAMES,
  KILL_CRITERION_OVERRIDE_RATE,
  RULES,
  buildDataset,
  explainPayload,
  finalRow,
  fmt,
  formatPct,
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

const KINDS: FileKind[] = ["sales", "inventory", "skuMaster", "calendar", "distributors"];

const BOXES = [
  [1, "Trigger"],
  [2, "Input"],
  [3, "Context"],
  [4, "Processing"],
  [5, "AI Layer"],
  [6, "Output"],
  [7, "Gate 1 · Raghav"],
  [8, "Gate 2 · Procurement"],
] as const;

const ts = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

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
  const [demoError, setDemoError] = useState<string | null>(null);
  const trendRef = useRef<HTMLDivElement>(null);

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

  const rows = run?.result.rows ?? [];
  const fest = run?.result.festival;
  const exceptions = rows.filter((r) => r.isException);
  const g1 = gate1Progress(rows, decisions);
  const stats = overrideStats(rows, decisions);
  const po = poRows(rows, decisions);
  const selectedRow = rows.find((r) => r.skuId === selected) ?? null;

  // ---- loading -----------------------------------------------------------
  async function onFile(kind: FileKind, f: File | undefined) {
    if (!f) return;
    const text = await f.text();
    setFiles((prev) => ({ ...prev, [kind]: parseCsv(kind, f.name, text) }));
  }

  async function loadDemo() {
    setDemoError(null);
    try {
      const loaded = await Promise.all(
        KINDS.map(async (k) => {
          const res = await fetch(`/demo/${FILE_NAMES[k]}`);
          if (!res.ok) throw new Error(`${FILE_NAMES[k]}: HTTP ${res.status}`);
          return parseCsv(k, FILE_NAMES[k], await res.text());
        }),
      );
      setFiles(Object.fromEntries(loaded.map((l) => [l.kind, l])));
    } catch (e) {
      setDemoError(`Could not load demo data (${(e as Error).message}).`);
    }
  }

  // ---- BOX 1 → 5 ---------------------------------------------------------
  async function runForecast() {
    if (!dataset) return;
    const result = runRules(dataset, mode);
    const at = new Date().toISOString();
    setRun({ result, at, mode });
    setDecisions({});
    setG2(null);
    setSelected(result.rows.find((r) => r.isException)?.skuId ?? result.rows[0]?.skuId ?? null);
    // Templates first so the page is complete offline; AI replaces them if valid.
    const templates = Object.fromEntries(result.rows.map((r) => [r.skuId, templateExplanation(r, result.festival)]));
    setExpl(templates);
    setExplStatus({ source: "pending", note: "Asking Claude for reasons…" });
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
          // Exceptions must carry a "check"; keep the template's if the AI left it blank.
          merged[r.skuId] = { ...a, check: r.isException ? a.check || templates[r.skuId].check : "" };
        }
        setExpl(merged);
        setExplStatus({
          source: "ai",
          note: `Reasons by Claude (${data.model})${missing ? `; ${missing} SKU(s) fell back to templates` : ""}.`,
        });
      } else {
        setExplStatus({ source: "template", note: data.error ?? "AI unavailable — using template reasons." });
      }
    } catch {
      setExplStatus({ source: "template", note: "AI call failed — using template reasons." });
    }
  }

  // ---- BOX 7 -------------------------------------------------------------
  function approve(r: SkuResult) {
    setDecisions((d) => ({ ...d, [r.skuId]: { type: "approve", at: new Date().toISOString() } }));
  }
  function override(r: SkuResult, qty: number, reason: string) {
    const at = new Date().toISOString();
    setDecisions((d) => ({ ...d, [r.skuId]: { type: "override", qty, reason, at } }));
    setLog((l) => [
      ...l.filter((e) => !(e.runAt === run!.at && e.sku === r.skuId)),
      { runAt: run!.at, sku: r.skuId, originalAction: r.action, originalQty: r.qty, overrideQty: qty, reason, by: g1Name, at },
    ]);
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

  const stale = run && run.mode !== mode;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Freshroots Demand Planning</h1>
          <p className="text-sm text-gray-600">
            Raghav&apos;s documented rules, run in code. AI explains exceptions only. Two humans approve before any PO exists.
          </p>
        </div>
        <button onClick={loadDemo} className="rounded-lg border border-emerald-600 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">
          Load demo data
        </button>
      </header>
      {demoError && <Alert tone="red">{demoError}</Alert>}

      {/* Component map */}
      <nav className="mb-6 flex flex-wrap items-center gap-1 text-xs">
        {BOXES.map(([n, name], i) => (
          <span key={n} className="flex items-center gap-1">
            <a href={`#box-${n}`} className="rounded-md border border-gray-300 bg-white px-2 py-1 font-medium text-gray-700 hover:border-gray-500">
              {n} · {name}
            </a>
            {i < BOXES.length - 1 && <span className="text-gray-400">→</span>}
          </span>
        ))}
        <a href="#feedback" className="ml-2 rounded-md border border-dashed border-gray-400 px-2 py-1 text-gray-600">↺ Feedback 8 → 3</a>
      </nav>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* BOX 1 */}
        <Box n={1} name="Trigger" hint="Stands in for the Mon + Thu 6 AM schedule">
          <button
            onClick={runForecast}
            disabled={!allLoaded}
            className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            Run forecast
          </button>
          <p className="mt-2 text-sm text-gray-600">
            Last run: <b>{run ? ts(run.at) : "never"}</b>
          </p>
          {!allLoaded && <p className="mt-1 text-xs text-gray-500">Load all 5 files (Boxes 2 and 3) to enable.</p>}
          {stale && <Alert tone="amber">Uplift setting changed since the last run. Run again to apply it.</Alert>}
        </Box>

        {/* BOX 2 */}
        <Box n={2} name="Input" hint="Sales + inventory">
          {(["sales", "inventory"] as FileKind[]).map((k) => (
            <FileSlot key={k} kind={k} file={files[k]} onFile={onFile} />
          ))}
          {summary && (
            <div className="mt-3 space-y-1 text-sm">
              <Stat label="SKUs loaded" value={summary.skusLoaded} />
              <Stat label="Inventory as-of" value={summary.asOfDate ?? "missing"} />
              <Stat label="Rows rejected" value={summary.rejected.length} tone={summary.rejected.length ? "red" : undefined} />
              <details className="text-xs text-gray-600">
                <summary className="cursor-pointer">Weeks of history per SKU</summary>
                <ul className="mt-1 grid grid-cols-2 gap-x-3">
                  {summary.weeksPerSku.map((w) => (
                    <li key={w.skuId} className={w.weeks < RULES.longWindow ? "font-semibold text-amber-700" : ""}>
                      {w.skuId}: {w.weeks} wks {w.first ? `(${w.first.slice(5)}–${w.last!.slice(5)})` : ""}
                    </li>
                  ))}
                </ul>
              </details>
              {summary.rejected.length > 0 && (
                <details open className="text-xs text-red-700">
                  <summary className="cursor-pointer">Rejected rows and why</summary>
                  <ul className="mt-1 list-disc pl-4">
                    {summary.rejected.map((r, i) => (
                      <li key={i}>
                        {FILE_NAMES[r.file]} row {r.row}
                        {r.skuId ? ` (${r.skuId})` : ""}: {r.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {summary.warnings.map((w) => (
                <Alert key={w} tone="amber">{w}</Alert>
              ))}
            </div>
          )}
        </Box>

        {/* BOX 3 */}
        <Box n={3} name="Context" hint="Masters, calendar, Rules v1">
          {(["skuMaster", "calendar", "distributors"] as FileKind[]).map((k) => (
            <FileSlot key={k} kind={k} file={files[k]} onFile={onFile} />
          ))}
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
            <p className="mb-1 font-semibold text-gray-900">Rules v1 (read-only)</p>
            <ol className="space-y-1">
              <li><b>R1 Festival uplift:</b> if the inventory As_Of_Date month has Is_Festival_Month = TRUE, expected weekly demand = 12-wk avg × {RULES.festivalUplift}; else = 12-wk avg. Applied before any threshold.</li>
              <li><b>R2 High demand:</b> 4-wk avg &gt; 12-wk avg × {RULES.highDemandRatio} → HIGH_DEMAND (raw averages, no uplift).</li>
              <li><b>R3 Stockout:</b> weeks of cover &lt; min window → STOCKOUT.</li>
              <li><b>R4 Overstock:</b> weeks of cover &gt; max window → OVERSTOCK.</li>
              <li><b>R5 Windows:</b> High perishability → {RULES.windows.High.min}–{RULES.windows.High.max} wks; Low → {RULES.windows.Low.min}–{RULES.windows.Low.max} wks.</li>
            </ol>
            <p className="mt-2 border-t border-gray-200 pt-2">
              <b>Assumption:</b> weeks of cover = Units_On_Hand ÷ expected weekly demand. There is no open-PO data, so stock on order is not counted.
            </p>
            {dataset && (
              <p className="mt-1">
                Calendar says <b>{dataset.asOfMonth ?? "?"}</b> is{" "}
                <b>{dataset.asOfMonth && dataset.festivalMonths.has(dataset.asOfMonth) ? "a festival month" : "not a festival month"}</b>.
              </p>
            )}
            <label className="mt-2 flex items-center gap-2">
              <span>What-if uplift:</span>
              <select value={mode} onChange={(e) => setMode(e.target.value as UpliftMode)} className="rounded border border-gray-300 bg-white px-1 py-0.5">
                <option value="auto">Auto (from calendar)</option>
                <option value="off">Force OFF</option>
                <option value="on">Force ON</option>
              </select>
            </label>
          </div>
        </Box>

        {/* BOX 4 */}
        <Box n={4} name="Processing" hint="Pure code, no AI">
          <p className="text-xs text-gray-600">
            Per SKU: avg_4w, avg_12w, expected weekly demand, weeks of cover, max week-on-week % change (last 4 transitions). Fixed order R5 → R1 → R2 → R3 → R4 → action.
          </p>
          <table className="mt-2 w-full text-xs">
            <tbody className="divide-y divide-gray-100">
              <ActionRule when="STOCKOUT + HIGH_DEMAND" action="REORDER_NOW" qty="1.5 × std" count={rows.filter((r) => r.action === "REORDER_NOW" && r.flags.includes("HIGH_DEMAND")).length} run={!!run} />
              <ActionRule when="STOCKOUT only" action="REORDER_NOW" qty="std" count={rows.filter((r) => r.action === "REORDER_NOW" && !r.flags.includes("HIGH_DEMAND")).length} run={!!run} />
              <ActionRule when="HIGH_DEMAND (no overstock)" action="REORDER_1.5X" qty="1.5 × std" count={rows.filter((r) => r.action === "REORDER_1.5X").length} run={!!run} />
              <ActionRule when="OVERSTOCK only" action="PAUSE" qty="0" count={rows.filter((r) => r.action === "PAUSE").length} run={!!run} />
              <ActionRule when="No flag / conflict / missing data" action="HOLD" qty="0" count={rows.filter((r) => r.action === "HOLD").length} run={!!run} />
            </tbody>
          </table>
          <p className="mt-2 text-xs text-gray-500">Quantities are rounded up to whole units. The AI never sets or edits a quantity.</p>
        </Box>

        {/* BOX 5 */}
        <Box n={5} name="AI Layer" hint="Claude via /api/explain — exceptions + reasons only">
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-gray-600">
            <li>&lt; {RULES.longWindow} weeks of history (new launch)</li>
            <li>Any week-on-week change &gt; {RULES.swingThreshold * 100}% in last {RULES.swingTransitions} transitions (distributor-swing proxy)</li>
            <li>Conflicting flags (HIGH_DEMAND or STOCKOUT with OVERSTOCK)</li>
            <li>Missing or invalid data in any required field</li>
          </ul>
          {run && (
            <>
              <Stat label="Exceptions" value={`${exceptions.length} of ${rows.length}`} tone={exceptions.length ? "amber" : undefined} />
              {explStatus && (
                <Alert tone={explStatus.source === "ai" || explStatus.note.startsWith("Free mode") ? "green" : explStatus.source === "pending" ? "gray" : "amber"}>
                  {explStatus.source === "template" && !explStatus.note.startsWith("Free mode") && <b>Template fallback: </b>}
                  {explStatus.note}
                </Alert>
              )}
            </>
          )}
          <p className="mt-2 text-xs text-gray-500">All SKUs go in one batched request. Reply is validated as JSON; anything invalid falls back to templates.</p>
        </Box>
      </div>

      {/* BOX 6 */}
      <div className="mt-4">
        <Box n={6} name="Output" hint="Summary, dashboard, exception queue, SKU action list">
          {!run ? (
            <p className="text-sm text-gray-500">Run the forecast (Box 1) to see output.</p>
          ) : (
            <>
              {/* Summary strip */}
              <div className="flex flex-wrap gap-2 text-xs">
                <Chip tone="red">HIGH_DEMAND {run.result.summary.flagCounts.HIGH_DEMAND}</Chip>
                <Chip tone="red">STOCKOUT {run.result.summary.flagCounts.STOCKOUT}</Chip>
                <Chip tone="amber">OVERSTOCK {run.result.summary.flagCounts.OVERSTOCK}</Chip>
                <Chip tone="purple">Exceptions {exceptions.length}</Chip>
                <Chip tone={fest!.on ? "green" : "gray"}>
                  Festival uplift {fest!.on ? "ON" : "OFF"} · {fest!.month ?? "?"}
                  {fest!.mode !== "auto" ? " (what-if)" : ""}
                </Chip>
              </div>

              {/* KPI tiles */}
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
                <Kpi label="SKUs reviewed" value={rows.length} />
                <Kpi label="Reorders" value={rows.filter((r) => isReorder(r.action)).length} sub={`${run.result.summary.reorderUnits.toLocaleString("en-IN")} units`} tone="red" />
                <Kpi label="Pauses" value={run.result.summary.actionCounts.PAUSE} tone="amber" />
                <Kpi label="Exceptions open" value={g1.total - g1.resolved} sub={`of ${g1.total}`} tone="purple" />
                <Kpi label="Festival uplift" value={fest!.on ? "ON" : "OFF"} sub={`${fest!.month} · ×${fest!.on ? RULES.festivalUplift : 1}`} tone={fest!.on ? "green" : undefined} />
              </div>

              {/* Charts */}
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <h3 className="text-sm font-semibold text-gray-800">Weeks of cover by SKU</h3>
                  <Legendish />
                  <CoverChart rows={rows} perishability="Low" onSelect={setSelected} selected={selected} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">&nbsp;</h3>
                  <div className="h-[18px]" />
                  <CoverChart rows={rows} perishability="High" onSelect={setSelected} selected={selected} />
                </div>
              </div>
              <div ref={trendRef} className="mt-4 rounded-lg border border-gray-200 p-3">
                <h3 className="text-sm font-semibold text-gray-800">
                  Sales trend {selectedRow ? `· ${selectedRow.skuId} ${selectedRow.name}` : ""}
                </h3>
                {selectedRow ? (
                  <>
                    <p className="text-xs text-gray-500">
                      Last {selectedRow.history.length} weeks. Dashed: 4-wk avg {fmt(selectedRow.avg4w)}, 12-wk avg {fmt(selectedRow.avg12w)}. Shaded: festival-month weeks.
                    </p>
                    <TrendChart row={selectedRow} />
                  </>
                ) : (
                  <p className="text-sm text-gray-500">Click a SKU row or bar to see its trend.</p>
                )}
              </div>

              {/* Exception queue */}
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-gray-800">Exception Queue ({exceptions.length})</h3>
                {exceptions.length === 0 ? (
                  <p className="text-sm text-gray-500">No exceptions this run.</p>
                ) : (
                  <ul className="mt-2 grid gap-2 md:grid-cols-2">
                    {exceptions.map((r) => (
                      <li key={r.skuId} className="rounded-lg border border-purple-200 bg-purple-50 p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <button onClick={() => { setSelected(r.skuId); trendRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }} className="font-semibold text-purple-900 hover:underline">
                            {r.skuId} · {r.name || "(no name)"}
                          </button>
                          <span className="flex gap-1">
                            {r.exceptionCodes.map((c) => <Chip key={c} tone="purple">{c}</Chip>)}
                          </span>
                        </div>
                        <p className="mt-1 text-gray-800"><b>Why:</b> {expl[r.skuId]?.reason}</p>
                        <p className="mt-1 text-gray-800"><b>Check:</b> {expl[r.skuId]?.check}</p>
                        <p className="mt-1 text-xs text-gray-600">
                          Rule result: <ActionBadge action={r.action} /> qty {r.qty} ·{" "}
                          {decisions[r.skuId] ? <b className="text-emerald-700">resolved in Box 7</b> : <a href="#box-7" className="text-purple-800 underline">resolve in Box 7</a>}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* SKU Action List */}
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800">SKU Action List</h3>
                  <button onClick={downloadActionList} className="text-xs text-emerald-700 underline">Download CSV</button>
                </div>
                <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50 text-left text-gray-600">
                      <tr>
                        {["SKU", "Name", "Distributor", "Perish.", "Stock", "avg_4w", "avg_12w", "Expected/wk", "Cover (wks)", "Flags", "Action", "Qty", "Reason"].map((h) => (
                          <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.map((r) => {
                        const f = finalRow(r, decisions[r.skuId]);
                        return (
                          <tr
                            key={r.skuId}
                            onClick={() => { setSelected(r.skuId); trendRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }}
                            className={`cursor-pointer hover:bg-emerald-50 ${selected === r.skuId ? "bg-emerald-50" : ""}`}
                          >
                            <td className="whitespace-nowrap px-2 py-1.5 font-medium">
                              {r.skuId} {r.isException && <span title={r.exceptionNotes.join("; ")} className="text-purple-700">⚠</span>}
                            </td>
                            <td className="px-2 py-1.5">{r.name}</td>
                            <td className="px-2 py-1.5">{r.distributorName || r.distributorId}</td>
                            <td className="px-2 py-1.5">{r.perishability ?? "—"}</td>
                            <td className="px-2 py-1.5 text-right">{r.unitsOnHand ?? "—"}</td>
                            <td className="px-2 py-1.5 text-right">{fmt(r.avg4w)}</td>
                            <td className="px-2 py-1.5 text-right">{fmt(r.avg12w)}</td>
                            <td className="px-2 py-1.5 text-right">{fmt(r.expectedWeeklyDemand)}</td>
                            <td className="px-2 py-1.5 text-right font-medium">{fmt(r.weeksOfCover, 2)}</td>
                            <td className="whitespace-nowrap px-2 py-1.5">{r.flags.join(", ") || "—"}</td>
                            <td className="px-2 py-1.5"><ActionBadge action={r.action} /></td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right">
                              {r.qty}
                              {f.overridden && <span className="block text-purple-700">→ {f.qty} (override)</span>}
                            </td>
                            <td className="min-w-[260px] px-2 py-1.5 text-gray-700">{expl[r.skuId]?.reason}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </Box>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* BOX 7 */}
        <Box n={7} name="Human Gate 1 — Raghav" hint="Approve or override every exception">
          {!run ? (
            <p className="text-sm text-gray-500">Waiting for a run.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-sm">
                  Planner:{" "}
                  <input value={g1Name} onChange={(e) => setG1Name(e.target.value)} disabled={!!g2} className="rounded border border-gray-300 px-2 py-1 text-sm" />
                </label>
                <span className={`rounded-full px-3 py-1 text-sm font-semibold ${g1.complete ? "bg-emerald-100 text-emerald-800" : "bg-purple-100 text-purple-800"}`}>
                  Resolved {g1.resolved}/{g1.total}
                </span>
              </div>
              {exceptions.length === 0 && <p className="mt-3 text-sm text-gray-600">No exceptions — Gate 1 has nothing to review.</p>}
              <ul className="mt-3 space-y-3">
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
        </Box>

        {/* BOX 8 */}
        <Box n={8} name="Human Gate 2 — Procurement" hint="Stands in for Zoho — nothing is auto-ordered">
          {!run ? (
            <p className="text-sm text-gray-500">Waiting for a run.</p>
          ) : (
            <>
              <p className="text-sm text-gray-700">
                Final PO list: <b>{po.length}</b> REORDER line(s), <b>{po.reduce((a, p) => a + p.qty, 0).toLocaleString("en-IN")}</b> units.
              </p>
              <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 text-left text-gray-600">
                    <tr>{["SKU", "Name", "Distributor", "Action", "Final qty"].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {po.map((p) => (
                      <tr key={p.skuId}>
                        <td className="px-2 py-1">{p.skuId}</td>
                        <td className="px-2 py-1">{p.name}</td>
                        <td className="px-2 py-1">{p.distributorId}</td>
                        <td className="px-2 py-1"><ActionBadge action={p.action} /></td>
                        <td className="px-2 py-1 text-right">{p.qty}{p.overridden ? " *" : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {po.some((p) => p.overridden) && <p className="mt-1 text-xs text-gray-500">* quantity set by Gate 1 override</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={g2Name}
                  onChange={(e) => setG2Name(e.target.value)}
                  disabled={!!g2}
                  placeholder="Procurement approver name"
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
                <button
                  onClick={() => setG2({ by: g2Name.trim(), at: new Date().toISOString() })}
                  disabled={!g1.complete || !g2Name.trim() || !!g2}
                  className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  Approve final list
                </button>
                <button
                  onClick={downloadPo}
                  disabled={!g2}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  Download PO list
                </button>
              </div>
              {!g1.complete && <p className="mt-2 text-xs text-purple-700">Locked: {g1.total - g1.resolved} exception(s) still open in Gate 1.</p>}
              {g1.complete && !g2Name.trim() && !g2 && <p className="mt-2 text-xs text-gray-500">Enter the approver&apos;s name to approve.</p>}
              {g2 && <Alert tone="green">Approved by {g2.by} at {ts(g2.at)}. Gate 1 decisions are now locked.</Alert>}
            </>
          )}
        </Box>
      </div>

      {/* FEEDBACK LOOP */}
      <section id="feedback" className="mt-4 rounded-xl border-2 border-dashed border-gray-300 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">
          <span className="mr-2 rounded bg-gray-800 px-2 py-0.5 text-xs font-bold text-white">FEEDBACK LOOP · 8 → 3</span>
          Overrides feed back into Rules v1
        </h2>
        {stats.killCriterion && (
          <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-800">
            Rules may need re-documenting (kill criterion): override rate {Math.round(stats.overrideRate * 100)}% is above {KILL_CRITERION_OVERRIDE_RATE * 100}%.
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Override rate" value={stats.resolved ? `${Math.round(stats.overrideRate * 100)}%` : "—"} sub={`${stats.overrides} of ${stats.resolved} resolved`} tone={stats.killCriterion ? "red" : undefined} />
          <Kpi label="Acceptance rate" value={stats.resolved ? `${Math.round(stats.acceptanceRate * 100)}%` : "—"} sub={`${stats.approvals} approved as-is`} tone="green" />
          <Kpi label="Kill threshold" value={`${KILL_CRITERION_OVERRIDE_RATE * 100}%`} sub="override rate" />
          <Kpi label="Override log" value={log.length} sub="entries this session" />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={downloadLog} disabled={!log.length} className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40">
            Download override log CSV
          </button>
          <span className="text-xs text-gray-500">Rates are for the current run&apos;s exceptions. The log keeps every override from this session (in memory only).</span>
        </div>
        {log.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-gray-700">
            {log.map((e) => (
              <li key={`${e.runAt}-${e.sku}`}>
                <b>{e.sku}</b>: {e.originalAction} {e.originalQty} → {e.overrideQty} · “{e.reason}” · {e.by}, {ts(e.at)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-6 text-center text-xs text-gray-400">
        Class prototype · no database · state lives in this browser tab · swing = {formatPct(RULES.swingThreshold)} threshold
      </footer>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------------

function Box({ n, name, hint, children }: { n: number; name: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={`box-${n}`} className="scroll-mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-gray-900">
          <span className="mr-2 rounded bg-emerald-700 px-2 py-0.5 text-xs font-bold tracking-wide text-white">BOX {n}</span>
          {name.toUpperCase()}
        </h2>
        {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

function FileSlot({ kind, file, onFile }: { kind: FileKind; file?: LoadedFile; onFile: (k: FileKind, f: File | undefined) => void }) {
  return (
    <div className="mb-2">
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="font-mono text-xs text-gray-700">{FILE_NAMES[kind]}</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => { onFile(kind, e.target.files?.[0]); e.target.value = ""; }}
          className="w-44 text-xs file:mr-2 file:rounded file:border-0 file:bg-gray-100 file:px-2 file:py-1 file:text-xs"
        />
      </label>
      {file && !file.error && <p className="text-xs text-emerald-700">✓ {file.fileName}: {file.rows.length} rows</p>}
      {file?.error && <p className="text-xs font-medium text-red-700">✗ {file.fileName}: {file.error}</p>}
    </div>
  );
}

function ExceptionDecision({
  row, decision, locked, onApprove, onOverride, onReopen,
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
    <li className={`rounded-lg border p-3 text-sm ${decision ? "border-emerald-200 bg-emerald-50" : "border-purple-200"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{row.skuId} · {row.name}</span>
        <span className="text-xs">Rule: <ActionBadge action={row.action} /> qty <b>{row.qty}</b></span>
      </div>
      <p className="mt-1 text-xs text-gray-600">{row.exceptionNotes.join(" · ")}</p>
      {decision ? (
        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-emerald-800">
            {decision.type === "approve" ? `✓ Approved as-is (qty ${row.qty})` : `✎ Overridden to qty ${decision.qty} — “${decision.reason}”`}
          </span>
          {!locked && <button onClick={onReopen} className="text-gray-600 underline">Reopen</button>}
        </div>
      ) : open ? (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-2">
            <label className="text-xs">New qty (≥ 0)
              <input type="number" min={0} step={1} value={qty} onChange={(e) => setQty(e.target.value)} className="ml-1 w-24 rounded border border-gray-300 px-2 py-1" />
            </label>
          </div>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you overriding? (required)" rows={2} className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
          {err && <p className="text-xs text-red-700">{err}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => {
                const e = validateOverride(qty, reason);
                setErr(e);
                if (!e) onOverride(Number(qty), reason.trim());
              }}
              className="rounded bg-purple-700 px-3 py-1 text-xs font-semibold text-white"
            >
              Save override
            </button>
            <button onClick={() => { setOpen(false); setErr(null); }} className="text-xs text-gray-600 underline">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <button onClick={onApprove} disabled={locked} className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white disabled:bg-gray-300">Approve</button>
          <button onClick={() => setOpen(true)} disabled={locked} className="rounded border border-purple-700 px-3 py-1 text-xs font-semibold text-purple-700 disabled:opacity-40">Override</button>
        </div>
      )}
    </li>
  );
}

function ActionRule({ when, action, qty, count, run }: { when: string; action: string; qty: string; count: number; run: boolean }) {
  return (
    <tr>
      <td className="py-1 pr-2 text-gray-700">{when}</td>
      <td className="py-1 pr-2"><ActionBadge action={action} /></td>
      <td className="py-1 pr-2 text-gray-600">{qty}</td>
      <td className="py-1 text-right font-semibold">{run ? count : ""}</td>
    </tr>
  );
}

function ActionBadge({ action }: { action: string }) {
  const cls = isReorder(action) ? "bg-red-100 text-red-800" : action === "PAUSE" ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-700";
  return <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>{action}</span>;
}

const TONES = {
  red: "bg-red-50 text-red-800 border-red-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  green: "bg-emerald-50 text-emerald-800 border-emerald-200",
  purple: "bg-purple-50 text-purple-800 border-purple-200",
  gray: "bg-gray-50 text-gray-700 border-gray-200",
} as const;
type Tone = keyof typeof TONES;

function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`rounded-full border px-2.5 py-0.5 font-medium ${TONES[tone]}`}>{children}</span>;
}

function Alert({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <div className={`mt-2 rounded-md border px-2 py-1.5 text-xs ${TONES[tone]}`}>{children}</div>;
}

function Kpi({ label, value, sub, tone = "gray" }: { label: string; value: React.ReactNode; sub?: string; tone?: Tone }) {
  return (
    <div className={`rounded-lg border p-3 ${TONES[tone]}`}>
      <p className="text-xs opacity-80">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs opacity-80">{sub}</p>}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: Tone }) {
  return (
    <p className={`mt-1 flex justify-between text-sm ${tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-gray-700"}`}>
      <span>{label}</span>
      <b>{value}</b>
    </p>
  );
}

function Legendish() {
  return (
    <p className="mb-1 flex gap-3 text-xs text-gray-600">
      <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-600" />REORDER</span>
      <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-600" />PAUSE</span>
      <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-gray-400" />HOLD</span>
      <span>Dashed lines = min / max window</span>
    </p>
  );
}
