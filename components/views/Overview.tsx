"use client";

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { ArrowRight, Check, UploadCloud, ClipboardCheck, Database, FileDown, Gauge, PackageCheck, PauseCircle, Play, ShieldCheck, Sparkles, TriangleAlert, UserCheck } from "lucide-react";
import { CoverChart } from "@/components/Charts";
import ShinyText from "@/components/reactbits/ShinyText/ShinyText";
import { ActionBadge, BoxTag, Button, Card, EmptyState, Kpi } from "@/components/ui";
import { monthName, nextScheduledRun, ts, useWs, type Tab } from "@/components/workspace";
import { CoverGauge, exceptionLabel } from "@/components/views/shared";
import { RULES, fmt, isReorder, type SkuResult } from "@/lib/rules";

const Aurora = dynamic(() => import("@/components/reactbits/Aurora/Aurora"), { ssr: false });

export function Overview() {
  const ws = useWs();
  const [allStock, setAllStock] = useState(false);
  const { run, rows, fest, exceptions, counts, g1, g2, poDownloaded, dataset, summary } = ws;
  const next = nextScheduledRun();
  const reorderRows = rows.filter((r) => isReorder(r.action));
  const pauseRows = rows.filter((r) => r.action === "PAUSE");
  const healthy = rows.filter((r) => r.action === "HOLD" && !r.isException);
  const reorderDistributors = new Set(reorderRows.map((r) => r.distributorId)).size;

  const steps: { label: string; detail: string; done: boolean; active: boolean; tab: Tab; icon: ReactNode }[] = [
    { label: "Data loaded", detail: summary ? `${summary.skusLoaded} SKUs · as of ${summary.asOfDate}` : "5 files needed", done: ws.allLoaded, active: !ws.allLoaded, tab: "data", icon: <Database className="h-3.5 w-3.5" /> },
    { label: "Forecast run", detail: run ? ts(run.at) : "Not run yet", done: !!run, active: ws.allLoaded && !run, tab: "actions", icon: <Gauge className="h-3.5 w-3.5" /> },
    { label: "Raghav review", detail: run ? `${g1.resolved}/${g1.total} exceptions` : "—", done: !!run && g1.complete, active: !!run && !g1.complete, tab: "exceptions", icon: <UserCheck className="h-3.5 w-3.5" /> },
    { label: "Procurement sign-off", detail: g2 ? `by ${g2.by}` : "Waiting", done: !!g2, active: !!run && g1.complete && !g2, tab: "orders", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
    {
      label: "Sent to HubSpot",
      detail: ws.hubspot.state === "done" ? `${ws.hubspot.results.length} orders created` : ws.hubspot.state === "error" ? "Needs attention" : poDownloaded ? "CSV downloaded" : "On approval",
      done: ws.hubspot.state === "done",
      active: !!g2 && ws.hubspot.state !== "done",
      tab: "orders",
      icon: <FileDown className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-slate-950 text-white shadow-xl shadow-slate-900/10">
        <div className="pointer-events-none absolute inset-0">
          <Aurora colorStops={["#047857", "#34d399", "#0ea5e9"]} amplitude={1.1} blend={0.55} speed={0.6} brightness={1.2} height={0.75} mouseInteraction={false} />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-slate-950/85 via-slate-950/40 to-transparent" />
        <div className="relative p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-200 ring-1 ring-inset ring-white/15">
                  Planning cycle
                </span>
                <BoxTag n={1} />
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
                <ShinyText text={`${monthName(dataset?.asOfMonth)} demand cycle`} color="#ffffff" shineColor="#6ee7b7" speed={3.5} />
              </h1>
              <p className="mt-2 text-sm text-slate-300">
                Good to see you, {ws.g1Name || "Raghav"}. {run ? `Forecast refreshed ${ts(run.at)}.` : "Run the forecast to refresh recommendations."} Next automatic run{" "}
                {next.toLocaleString("en-IN", { weekday: "long", day: "numeric", month: "short" })}, 6:00 AM.
              </p>
            </div>
            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              <Button size="lg" onClick={ws.runForecast} disabled={!ws.allLoaded} className="!bg-white !text-slate-900 hover:!bg-emerald-50 disabled:!bg-white/20 disabled:!text-white/50">
                <Play className="h-4 w-4 fill-current" /> {run ? "Re-run forecast" : "Run forecast"}
              </Button>
              <button onClick={() => ws.setUploadOpen(true)} className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-white/90 ring-1 ring-inset ring-white/25 hover:bg-white/10">
                <UploadCloud className="h-3.5 w-3.5" /> Upload new data
              </button>
              {ws.stale && <p className="text-xs text-amber-200">Uplift setting changed — re-run to apply.</p>}
            </div>
          </div>

          {/* Cycle progress */}
          <ol className="mt-7 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {steps.map((s, i) => (
              <li key={s.label}>
                <button
                  onClick={() => ws.setTab(s.tab)}
                  className={`flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left ring-1 ring-inset transition ${
                    s.done ? "bg-emerald-400/10 ring-emerald-300/25" : s.active ? "bg-white/10 ring-white/30" : "bg-white/[0.03] ring-white/10"
                  } hover:bg-white/15`}
                >
                  <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${s.done ? "bg-emerald-400 text-slate-950" : s.active ? "bg-white text-slate-900" : "bg-white/10 text-white/60"}`}>
                    {s.done ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-white">{s.label}</span>
                    <span className="block truncate text-[11px] text-slate-300">{s.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {!run ? (
        <Card>
          <EmptyState icon={<Gauge className="h-5 w-5" />} title="No forecast yet" body="Load the five CSVs in Data sources, then run the forecast." />
        </Card>
      ) : (
        <>
          {/* KPIs */}
          <div key={run.at} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Kpi label="SKUs reviewed" value={rows.length} icon={<ClipboardCheck className="h-4 w-4" />} sub={`${ws.distributorCount} distributors`} />
            <Kpi label="Reorder now" value={counts.reorder} icon={<PackageCheck className="h-4 w-4" />} tone="red" sub={<><b className="text-slate-700">{run.result.summary.reorderUnits.toLocaleString("en-IN")}</b> units suggested</>} />
            <Kpi label="Paused" value={counts.pause} icon={<PauseCircle className="h-4 w-4" />} tone="amber" sub="Overstocked" />
            <Kpi label="Needs your review" value={g1.total - g1.resolved} suffix={`/ ${g1.total}`} icon={<TriangleAlert className="h-4 w-4" />} tone="violet" sub={g1.complete ? "All reviewed" : "Open exceptions"} />
            <Kpi label="Festival uplift" text={fest!.on ? "ON" : "OFF"} icon={<Sparkles className="h-4 w-4" />} tone={fest!.on ? "green" : "slate"} sub={`${monthName(fest!.month)} · ×${fest!.on ? RULES.festivalUplift : 1}`} />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_1fr]">
            {/* Briefing */}
            <Card title="This cycle at a glance" sub="What the rules recommend, in plain English" icon={<Sparkles className="h-4 w-4" />} box={6}>
              <ul className="space-y-3">
                <Brief
                  tone="red"
                  icon={<PackageCheck className="h-4 w-4" />}
                  title={`${counts.reorder} SKUs need reordering`}
                  body={`${run.result.summary.reorderUnits.toLocaleString("en-IN")} units across ${reorderDistributors} distributor${reorderDistributors === 1 ? "" : "s"}. Lowest cover: ${lowest(reorderRows)}.`}
                  action={{ label: "See reorders", onClick: () => { ws.setActionFilter("reorder"); ws.setTab("actions"); } }}
                />
                <Brief
                  tone="violet"
                  icon={<UserCheck className="h-4 w-4" />}
                  title={g1.complete ? "All exceptions reviewed" : `${g1.total - g1.resolved} exception${g1.total - g1.resolved === 1 ? "" : "s"} need your decision`}
                  body={exceptions.length ? exceptions.map((e) => `${e.skuId} (${e.exceptionCodes.map((c) => exceptionLabel[c]).join(", ")})`).join(" · ") : "Nothing unusual this cycle."}
                  action={{ label: g1.complete ? "View decisions" : "Review now", onClick: () => ws.setTab("exceptions") }}
                />
                <Brief
                  tone="amber"
                  icon={<PauseCircle className="h-4 w-4" />}
                  title={`${counts.pause} SKU${counts.pause === 1 ? "" : "s"} paused for overstock`}
                  body={pauseRows.length ? pauseRows.map((r) => `${r.name.replace("Freshroots ", "")} at ${fmt(r.weeksOfCover, 1)} wks`).join(" · ") : "No overstock."}
                  action={{ label: "See pauses", onClick: () => { ws.setActionFilter("pause"); ws.setTab("actions"); } }}
                />
                <Brief
                  tone="green"
                  icon={<Check className="h-4 w-4" />}
                  title={`${healthy.length} SKUs are healthy`}
                  body={`Cover inside their window — no action needed.${fest!.on ? ` Forecasts include the ${monthName(fest!.month)} festival uplift (+25%).` : ""}`}
                />
              </ul>
            </Card>

            {/* Stock health */}
            <Card
              title="Stock health"
              sub="Weeks of cover against each SKU's window (green band). Most urgent first."
              icon={<Gauge className="h-4 w-4" />}
              box={6}
              bodyClassName="px-2 py-2"
            >
              <ul className="divide-y divide-slate-100">
                {[...rows].sort(urgency).slice(0, allStock ? rows.length : 8).map((r) => (
                  <li key={r.skuId}>
                    <button onClick={() => ws.setDrawerSku(r.skuId)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-slate-50 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_40px_auto]">
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                          <span className="truncate">{r.name.replace("Freshroots ", "")}</span>
                          {r.isException && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" title="Exception" />}
                        </span>
                        <span className="block text-[11px] text-slate-500">{r.skuId} · {r.perishability ?? "?"} perishability</span>
                      </span>
                      <span className="hidden sm:block"><CoverGauge row={r} /></span>
                      <span className="hidden text-right text-sm font-semibold tabular-nums text-slate-800 sm:block">{fmt(r.weeksOfCover, 1)}</span>
                      <span className="flex justify-end"><ActionBadge action={r.action} /></span>
                    </button>
                  </li>
                ))}
              </ul>
              {rows.length > 8 && (
                <button onClick={() => setAllStock((v) => !v)} className="w-full rounded-xl px-3 py-2 text-center text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
                  {allStock ? "Show fewer" : `Show all ${rows.length} SKUs`}
                </button>
              )}
            </Card>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="Weeks of cover · Low perishability" sub={`Shaded band = ${RULES.windows.Low.min}–${RULES.windows.Low.max} week window. Click a bar for details.`} right={<ChartLegend />} box={6}>
              <CoverChart rows={rows} perishability="Low" onSelect={ws.setDrawerSku} selected={ws.drawerSku} />
            </Card>
            <Card title="Weeks of cover · Perishables" sub={`High perishability: ${RULES.windows.High.min}–${RULES.windows.High.max} week window`} box={6}>
              <CoverChart rows={rows} perishability="High" onSelect={ws.setDrawerSku} selected={ws.drawerSku} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Brief({ tone, icon, title, body, action }: { tone: "red" | "violet" | "amber" | "green"; icon: ReactNode; title: string; body: string; action?: { label: string; onClick: () => void } }) {
  const t = {
    red: "bg-red-50 text-red-600",
    violet: "bg-violet-50 text-violet-600",
    amber: "bg-amber-50 text-amber-600",
    green: "bg-emerald-50 text-emerald-600",
  }[tone];
  return (
    <li className="flex items-start gap-3 rounded-xl border border-slate-100 p-3">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${t}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{body}</p>
      </div>
      {action && (
        <button onClick={action.onClick} className="flex shrink-0 items-center gap-1 self-center whitespace-nowrap text-xs font-semibold text-emerald-700 hover:text-emerald-900">
          {action.label} <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
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

const rank = (r: SkuResult) => (isReorder(r.action) ? 0 : r.isException ? 1 : r.action === "PAUSE" ? 2 : 3);
function urgency(a: SkuResult, b: SkuResult) {
  return rank(a) - rank(b) || (a.weeksOfCover ?? 0) / (a.minWindow ?? 1) - (b.weeksOfCover ?? 0) / (b.minWindow ?? 1);
}

function lowest(rows: SkuResult[]) {
  const r = [...rows].sort((a, b) => (a.weeksOfCover ?? 99) - (b.weeksOfCover ?? 99))[0];
  return r ? `${r.name.replace("Freshroots ", "")} at ${fmt(r.weeksOfCover, 1)} weeks` : "—";
}

