"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { TrendChart } from "@/components/Charts";
import { ActionBadge, Chip, MiniStat } from "@/components/ui";
import { useWs } from "@/components/workspace";
import { CoverGauge, DecisionControls, RuleTrace, exceptionLabel, swingText } from "@/components/views/shared";
import { finalRow, fmt } from "@/lib/rules";

/** Slide-over with everything about one SKU: trend, numbers, rule trace, reason, decision. */
export function SkuDrawer() {
  const ws = useWs();
  const row = ws.rows.find((r) => r.skuId === ws.drawerSku) ?? null;
  const open = !!row;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && ws.setDrawerSku(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ws]);

  const f = row ? finalRow(row, ws.decisions[row.skuId]) : null;

  return (
    <>
      <div className={`fixed inset-0 z-[60] bg-slate-950/30 backdrop-blur-[2px] transition-opacity ${open ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={() => ws.setDrawerSku(null)} />
      <aside
        className={`fixed inset-y-0 right-0 z-[70] flex w-full max-w-xl flex-col bg-white shadow-2xl transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}
        aria-hidden={!open}
      >
        {row && ws.fest && f && (
          <>
            <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">{row.skuId} · {row.category} · {row.distributorName}</p>
                <h2 className="text-lg font-semibold text-slate-900">{row.name}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <ActionBadge action={f.action} />
                  <Chip>{row.perishability ?? "?"} perishability</Chip>
                  {row.exceptionCodes.map((c) => <Chip key={c} tone="violet" dot>{exceptionLabel[c]}</Chip>)}
                </div>
              </div>
              <button onClick={() => ws.setDrawerSku(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MiniStat label="Recommended" value={f.qty} hint={f.overridden ? `rule said ${row.qty}` : "units"} tone={f.overridden ? "violet" : undefined} />
                <MiniStat label="On hand" value={row.unitsOnHand?.toLocaleString("en-IN") ?? "—"} />
                <MiniStat label="Expected / wk" value={fmt(row.expectedWeeklyDemand)} />
                <MiniStat label="Max swing" value={swingText(row)} />
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-600">Weeks of cover</span>
                  <span className="font-semibold tabular-nums text-slate-900">{fmt(row.weeksOfCover, 2)} wks <span className="font-normal text-slate-400">· window {row.minWindow}–{row.maxWindow}</span></span>
                </div>
                <CoverGauge row={row} />
              </div>

              <section>
                <h3 className="mb-1 text-sm font-semibold text-slate-900">Sales trend</h3>
                <p className="mb-2 text-xs text-slate-500">Last {row.history.length} weeks · dashed lines = 4-wk and 12-wk averages · shaded = festival-month weeks</p>
                <TrendChart row={row} />
              </section>

              <section className="rounded-2xl border border-slate-200 p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-900">How the rules decided</h3>
                <RuleTrace row={row} fest={ws.fest} />
                <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-600">
                  Result: <ActionBadge action={row.action} /> <b>qty {row.qty}</b>
                  {row.standardReorderQty ? <span className="text-slate-400"> · standard reorder qty {row.standardReorderQty}</span> : null}
                </p>
              </section>

              <section className="rounded-2xl bg-slate-50 p-4 text-sm">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Reason</p>
                <p className="mt-1 text-slate-700">{ws.expl[row.skuId]?.reason}</p>
                {ws.expl[row.skuId]?.check && (
                  <>
                    <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">What to check</p>
                    <p className="mt-1 text-slate-700">{ws.expl[row.skuId]?.check}</p>
                  </>
                )}
              </section>

              {row.isException && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">Your decision</h3>
                  <DecisionControls
                    key={`${ws.run?.at}-${row.skuId}`}
                    row={row}
                    decision={ws.decisions[row.skuId]}
                    locked={!!ws.g2}
                    onApprove={() => ws.approve(row)}
                    onOverride={(q, why) => ws.override(row, q, why)}
                    onReopen={() => ws.reopen(row)}
                  />
                </section>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
