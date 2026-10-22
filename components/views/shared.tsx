"use client";

import { useState, type ReactNode } from "react";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { Check, CheckCircle2, FileSpreadsheet, Minus, Upload } from "lucide-react";
import { ACTION_COLOR } from "@/components/Charts";
import { Button, Chip } from "@/components/ui";
import { FILE_LABEL } from "@/components/workspace";
import type { LoadedFile } from "@/lib/csv";
import {
  FILE_NAMES,
  RULES,
  fmt,
  formatPct,
  validateOverride,
  type Decision,
  type FestivalStatus,
  type FileKind,
  type SkuResult,
} from "@/lib/rules";

/** Horizontal gauge: where weeks of cover sits against the SKU's min–max window. */
export function CoverGauge({ row, scaleMax }: { row: SkuResult; scaleMax?: number }) {
  if (row.weeksOfCover === null || row.minWindow === null || row.maxWindow === null)
    return <div className="h-2 rounded-full bg-slate-100" title="Cover unavailable" />;
  const max = scaleMax ?? Math.max(row.maxWindow * 2, row.weeksOfCover * 1.1);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <div className="relative h-2 rounded-full bg-slate-100" title={`${fmt(row.weeksOfCover, 2)} weeks vs ${row.minWindow}–${row.maxWindow} window`}>
      <div className="absolute inset-y-0 rounded-full bg-emerald-200/70" style={{ left: pct(row.minWindow), width: `calc(${pct(row.maxWindow)} - ${pct(row.minWindow)})` }} />
      <div
        className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-slate-900/10"
        style={{ left: pct(row.weeksOfCover), background: ACTION_COLOR(row.action) === "#cbd5e1" ? "#64748b" : ACTION_COLOR(row.action) }}
      />
    </div>
  );
}

/** Tiny 16-week sales line. */
export function Sparkline({ row, height = 40 }: { row: SkuResult; height?: number }) {
  const data = row.history.map((h) => ({ u: h.units }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 2, left: 2, bottom: 4 }}>
        <YAxis hide domain={["dataMin - 5", "dataMax + 5"]} />
        <Line type="monotone" dataKey="u" stroke="#059669" strokeWidth={1.75} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Step-by-step explanation of how code reached the action (no AI). */
export function RuleTrace({ row, fest }: { row: SkuResult; fest: FestivalStatus }) {
  const steps: { id: string; label: string; detail: ReactNode; hit?: boolean }[] = [];
  if (row.minWindow !== null)
    steps.push({ id: "R5", label: "Cover window", detail: <>{row.perishability} perishability → {row.minWindow}–{row.maxWindow} weeks</> });
  if (row.avg12w !== null)
    steps.push({
      id: "R1",
      label: "Expected demand",
      detail: fest.on ? (
        <>12-wk avg {fmt(row.avg12w)} × {RULES.festivalUplift} festival uplift = <b>{fmt(row.expectedWeeklyDemand)}</b>/wk</>
      ) : (
        <>12-wk avg = <b>{fmt(row.expectedWeeklyDemand)}</b>/wk (no festival uplift)</>
      ),
    });
  if (row.weeksOfCover !== null)
    steps.push({ id: "=", label: "Weeks of cover", detail: <>{row.unitsOnHand?.toLocaleString("en-IN")} on hand ÷ {fmt(row.expectedWeeklyDemand)} = <b>{fmt(row.weeksOfCover, 2)}</b> weeks</> });
  if (row.avg4w !== null && row.avg12w !== null)
    steps.push({
      id: "R2",
      label: "High demand?",
      detail: <>4-wk avg {fmt(row.avg4w)} vs 12-wk avg × {RULES.highDemandRatio} = {fmt(row.avg12w * RULES.highDemandRatio)}</>,
      hit: row.flags.includes("HIGH_DEMAND"),
    });
  if (row.weeksOfCover !== null && row.minWindow !== null) {
    steps.push({ id: "R3", label: "Stockout risk?", detail: <>{fmt(row.weeksOfCover, 2)} &lt; {row.minWindow} min</>, hit: row.flags.includes("STOCKOUT") });
    steps.push({ id: "R4", label: "Overstock?", detail: <>{fmt(row.weeksOfCover, 2)} &gt; {row.maxWindow} max</>, hit: row.flags.includes("OVERSTOCK") });
  }
  return (
    <ol className="space-y-2">
      {steps.map((s) => (
        <li key={s.id} className="flex items-start gap-3 text-xs">
          <span className="mt-px grid h-5 w-7 shrink-0 place-items-center rounded bg-slate-900 text-[10px] font-bold text-white">{s.id}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-800">{s.label}</p>
            <p className="text-slate-600">{s.detail}</p>
          </div>
          {s.hit !== undefined &&
            (s.hit ? (
              <span className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700"><Check className="h-3 w-3" />Yes</span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500"><Minus className="h-3 w-3" />No</span>
            ))}
        </li>
      ))}
      {row.dataIssues.length > 0 && (
        <li className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">Missing data: {row.dataIssues.join("; ")}. No recommendation made.</li>
      )}
    </ol>
  );
}

/** Approve / Override controls for one exception (Gate 1). */
export function DecisionControls({
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

  if (decision)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-xs ring-1 ring-inset ring-emerald-600/15">
        <span className="flex items-center gap-1.5 font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          {decision.type === "approve" ? `Approved as-is · qty ${row.qty}` : `Overridden to qty ${decision.qty} — “${decision.reason}”`}
        </span>
        {!locked && (
          <button onClick={onReopen} className="font-semibold text-slate-500 hover:text-slate-800">Undo</button>
        )}
      </div>
    );

  if (open)
    return (
      <div className="space-y-2 rounded-xl bg-slate-50 p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="text-xs font-medium text-slate-600">
            New quantity
            <input type="number" min={0} step={1} value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 block h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm sm:w-28" />
          </label>
          <label className="flex-1 text-xs font-medium text-slate-600">
            Reason (required)
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. New launch, trial order only" rows={2} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm" />
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
    );

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={onApprove} disabled={locked}>
        <CheckCircle2 className="h-3.5 w-3.5" /> Approve {row.qty > 0 ? `qty ${row.qty}` : row.action.toLowerCase()}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} disabled={locked}>Override</Button>
    </div>
  );
}

export function FileRow({ kind, file, onFile }: { kind: FileKind; file?: LoadedFile; onFile: (k: FileKind, f: File | undefined) => void }) {
  const state = !file ? "missing" : file.error ? "error" : "ok";
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${state === "error" ? "border-red-200 bg-red-50/50" : "border-slate-200 bg-white"}`}>
      <div className="flex items-center gap-3">
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${state === "ok" ? "bg-emerald-50 text-emerald-600" : state === "error" ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-400"}`}>
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

export const exceptionLabel: Record<string, string> = {
  NEW_LAUNCH: "New launch",
  SWING: "Demand swing",
  CONFLICT: "Conflicting flags",
  DATA: "Missing data",
};

export const swingText = (r: SkuResult) => (r.maxWowChange === null ? "—" : `${formatPct(r.maxWowChange)}`);
