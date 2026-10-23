"use client";

import { useMemo, useState } from "react";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Info, PackagePlus, PlayCircle, RotateCcw, TriangleAlert } from "lucide-react";
import { Button, Card, Chip, EmptyState, MiniStat, PageHeader } from "@/components/ui";
import { monthName, useWs } from "@/components/workspace";
import { downloadCsv } from "@/lib/csv";
import { addDays, diffDays, planCalendar, toIcs, type PlanEvent } from "@/lib/rules";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDay = (iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", opts);
const short = (name: string) => name.replace("Freshroots ", "");

export function Calendar() {
  const ws = useWs();
  const { run, rows, dataset, g2, hubspot } = ws;
  const today = localToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [picked, setPicked] = useState<string | null>(null);
  const [showStockouts, setShowStockouts] = useState(true);

  const events = useMemo(
    () => (run && dataset?.asOfDate ? planCalendar(rows, dataset.asOfDate, { today, leadDays: ws.leadDays }) : []),
    [run, rows, dataset?.asOfDate, today, ws.leadDays],
  );
  const visible = events.filter((e) => showStockouts || e.kind !== "stockout");
  const byDay = useMemo(() => {
    const m = new Map<string, PlanEvent[]>();
    for (const e of visible) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [visible]);

  const orders = events.filter((e) => e.kind === "order");
  const inPo = orders.filter((e) => e.inCurrentPo);
  const thisWeek = orders.filter((e) => !e.inCurrentPo && diffDays(e.date, today) >= 0 && diffDays(e.date, today) <= 7);
  const next30 = orders.filter((e) => !e.inCurrentPo && diffDays(e.date, today) > 7 && diffDays(e.date, today) <= 30);
  const risks = events.filter((e) => e.kind === "stockout" && diffDays(e.date, today) <= 30);

  // Month grid (Monday first)
  const first = `${month}-01`;
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(first, -lead);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const shiftMonth = (n: number) => {
    const d = new Date(`${month}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
    setPicked(null);
  };

  const agenda = (picked ? visible.filter((e) => e.date === picked) : visible.filter((e) => e.inCurrentPo || diffDays(e.date, today) >= -1)).slice(0, picked ? 50 : 40);
  const poState = g2 ? (hubspot.state === "done" ? "In HubSpot" : "Approved") : "Awaiting approval";

  function exportIcs() {
    const blob = toIcs(events, new Date().toISOString());
    downloadCsv("freshroots_po_calendar.ics", blob);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="PO calendar"
        box={[6, 8]}
        sub="When to raise the next purchase order for each SKU, projected from today's cover and expected demand. The rules still decide every actual order."
        right={
          run && (
            <>
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600">
                Supplier lead time
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={ws.leadDays}
                  onChange={(e) => ws.setLeadDays(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
                  className="h-7 w-14 rounded-lg border border-slate-300 px-2 text-sm font-semibold text-slate-900"
                />
                days
              </label>
              <Button variant="secondary" size="sm" onClick={exportIcs}>
                <CalendarPlus className="h-3.5 w-3.5" /> Add to calendar (.ics)
              </Button>
            </>
          )
        }
      />

      {!run ? (
        <Card>
          <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="No forecast yet" body="Run the forecast to project order dates." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MiniStat label="In this cycle's PO" value={inPo.length} hint={poState} tone="red" />
            <MiniStat label="Order at next run" value={thisWeek.length} hint="within 7 days" tone="amber" />
            <MiniStat label="Next 8–30 days" value={next30.length} hint="upcoming orders" tone="green" />
            <MiniStat label="Stockout risks" value={risks.length} hint="within 30 days if not ordered" tone="violet" />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            {/* Month grid */}
            <Card bodyClassName="p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <div className="flex items-center gap-1">
                  <button onClick={() => shiftMonth(-1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
                  <h2 className="min-w-[140px] text-center text-base font-semibold text-slate-900">{monthName(month)}</h2>
                  <button onClick={() => shiftMonth(1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
                  <Button variant="ghost" size="sm" onClick={() => { setMonth(today.slice(0, 7)); setPicked(null); }}>Today</Button>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                  <Legend cls="bg-red-500" label="Order (this PO)" />
                  <Legend cls="bg-emerald-500" label="Order by" />
                  <Legend cls="bg-violet-500" label="Stock runs out" />
                  <Legend cls="bg-amber-500" label="Resume" />
                  <span className="flex items-center gap-1"><PlayCircle className="h-3 w-3 text-sky-600" />Forecast run</span>
                  {dataset?.festivalMonths.has(month) && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">Festival month</span>}
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={showStockouts} onChange={(e) => setShowStockouts(e.target.checked)} className="accent-violet-600" />
                    Stockouts
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/70 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {DOW.map((d) => <div key={d} className="py-2">{d}</div>)}
              </div>
              <div className="grid grid-cols-7">
                {days.map((d, i) => {
                  const inMonth = d.slice(0, 7) === month;
                  const evs = byDay.get(d) ?? [];
                  const dow = i % 7;
                  const isRun = dow === 0 || dow === 3;
                  const festival = dataset?.festivalMonths.has(d.slice(0, 7));
                  const isToday = d === today;
                  return (
                    <button
                      key={d}
                      onClick={() => setPicked(picked === d ? null : d)}
                      className={`relative flex min-h-[64px] flex-col gap-1 border-b border-r border-slate-100 p-1.5 text-left transition-colors sm:min-h-[104px] ${i % 7 === 6 ? "border-r-0" : ""} ${
                        !inMonth ? "bg-slate-50/60 text-slate-300" : festival ? "bg-amber-50/40" : "bg-white"
                      } ${picked === d ? "ring-2 ring-inset ring-emerald-500" : "hover:bg-slate-50"}`}
                    >
                      <span className="flex items-center justify-between">
                        <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${isToday ? "bg-emerald-600 text-white" : inMonth ? "text-slate-700" : ""}`}>
                          {Number(d.slice(8))}
                        </span>
                        {isRun && inMonth && <PlayCircle className="h-3 w-3 text-sky-500" aria-label="Forecast run" />}
                      </span>
                      {/* Desktop: labelled chips. Mobile: dots. */}
                      <span className="hidden flex-col gap-0.5 sm:flex">
                        {evs.slice(0, 3).map((e) => (
                          <span key={`${e.kind}-${e.skuId}`} className={`truncate rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight ${chipClass(e)}`}>
                            {e.kind === "order" ? `${short(e.name)} · ${e.qty}` : e.kind === "stockout" ? `Out: ${short(e.name)}` : `Resume: ${short(e.name)}`}
                          </span>
                        ))}
                        {evs.length > 3 && <span className="px-1 text-[10px] font-medium text-slate-500">+{evs.length - 3} more</span>}
                      </span>
                      <span className="flex flex-wrap gap-0.5 sm:hidden">
                        {evs.slice(0, 4).map((e) => <span key={`${e.kind}-${e.skuId}`} className={`h-1.5 w-1.5 rounded-full ${dotClass(e)}`} />)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* Agenda */}
            <Card
              title={picked ? fmtDay(picked, { weekday: "long", day: "numeric", month: "long" }) : "What's coming up"}
              sub={picked ? `${agenda.length} item${agenda.length === 1 ? "" : "s"} on this day` : "Orders to place, in date order"}
              icon={<CalendarDays className="h-4 w-4" />}
              right={picked ? <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>Show all</Button> : undefined}
              bodyClassName="max-h-[640px] overflow-y-auto px-3 py-2"
            >
              {agenda.length === 0 ? (
                <p className="px-2 py-8 text-center text-sm text-slate-400">Nothing scheduled{picked ? " on this day" : ""}.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {agenda.map((e) => (
                    <li key={`${e.kind}-${e.skuId}-${e.date}`}>
                      <button onClick={() => ws.setDrawerSku(e.skuId)} className="flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-slate-50">
                        <span className="w-11 shrink-0 rounded-lg border border-slate-200 bg-white py-1 text-center leading-none">
                          <span className="block text-[10px] font-semibold uppercase text-slate-400">{fmtDay(e.date, { month: "short" })}</span>
                          <span className="block text-base font-semibold text-slate-900">{Number(e.date.slice(8))}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start gap-1.5 text-sm font-medium leading-snug text-slate-900">
                            {e.kind === "order" ? <PackagePlus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : e.kind === "stockout" ? <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600" /> : <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />}
                            <span>
                              {e.kind === "order" ? `Order ${short(e.name)}` : e.kind === "stockout" ? `${short(e.name)} runs out` : `Resume ${short(e.name)}`}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {e.kind === "order" && <b className="text-slate-700">{e.qty} units · </b>}
                            {e.skuId} · {e.distributorId}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">
                            {e.inCurrentPo && poState !== "Awaiting approval" ? (poState === "In HubSpot" ? "In this cycle's PO — order created in HubSpot" : "In this cycle's PO — approved by both gates") : e.note}
                          </span>
                        </span>
                        <span className="shrink-0">{statusChip(e, today, poState)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <p className="flex items-start gap-2 text-xs text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Projection assumes demand stays at each SKU&apos;s expected weekly demand
            {ws.fest?.on ? " (with the festival uplift)" : ""} and uses stock on hand only. Order-by = the day cover drops below the minimum window, minus the {ws.leadDays}-day lead time.
            If that day has already passed for a SKU on HOLD, it is shown on the next Monday/Thursday run, when the rules will re-check it.
          </p>
        </>
      )}
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return <span className="flex items-center gap-1"><span className={`h-2 w-2 rounded-sm ${cls}`} />{label}</span>;
}

function chipClass(e: PlanEvent) {
  if (e.kind === "stockout") return "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200";
  if (e.kind === "resume") return "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200";
  return e.inCurrentPo ? "bg-red-500 text-white" : "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200";
}
function dotClass(e: PlanEvent) {
  return e.kind === "stockout" ? "bg-violet-500" : e.kind === "resume" ? "bg-amber-500" : e.inCurrentPo ? "bg-red-500" : "bg-emerald-500";
}
function statusChip(e: PlanEvent, today: string, poState: string) {
  if (e.inCurrentPo) return <Chip tone={poState === "Awaiting approval" ? "red" : "green"} dot>{poState}</Chip>;
  const d = diffDays(e.date, today);
  if (e.kind === "stockout") return <Chip tone="violet">{d <= 0 ? "Today" : `in ${d}d`}</Chip>;
  if (d <= 0) return <Chip tone="amber" dot>Today</Chip>;
  if (d <= 7) return <Chip tone="amber" dot>{`in ${d}d`}</Chip>;
  return <Chip tone="slate">{`in ${d}d`}</Chip>;
}
