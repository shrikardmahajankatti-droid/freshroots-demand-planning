"use client";

import { Download, ListChecks, Search } from "lucide-react";
import { useState } from "react";
import { ActionBadge, Button, Card, Chip, EmptyState, PageHeader } from "@/components/ui";
import { useWs, type ActionFilter } from "@/components/workspace";
import { CoverGauge } from "@/components/views/shared";
import { finalRow, fmt, isReorder } from "@/lib/rules";

const FILTERS: { id: ActionFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "reorder", label: "Reorder" },
  { id: "pause", label: "Paused" },
  { id: "hold", label: "Hold" },
  { id: "exceptions", label: "Exceptions" },
];

export function ActionList() {
  const ws = useWs();
  const { run, rows, decisions, expl, actionFilter: filter, setActionFilter: setFilter } = ws;
  const [query, setQuery] = useState("");

  const counts: Record<ActionFilter, number> = {
    all: rows.length,
    reorder: ws.counts.reorder,
    pause: ws.counts.pause,
    hold: ws.counts.hold,
    exceptions: ws.exceptions.length,
  };
  const shown = rows.filter((r) => {
    const q = query.trim().toLowerCase();
    if (q && !`${r.skuId} ${r.name} ${r.distributorName}`.toLowerCase().includes(q)) return false;
    if (filter === "reorder") return isReorder(r.action);
    if (filter === "pause") return r.action === "PAUSE";
    if (filter === "hold") return r.action === "HOLD";
    if (filter === "exceptions") return r.isException;
    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="SKU action list"
        box={[4, 6]}
        sub="Every SKU, the numbers behind it and what the rules recommend. Click a row for the full rule trace and sales trend."
        right={
          run && (
            <Button variant="secondary" size="sm" onClick={ws.downloadActionList}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          )
        }
      />
      {!run ? (
        <Card>
          <EmptyState icon={<ListChecks className="h-5 w-5" />} title="No forecast yet" body="Run the forecast to see recommendations." />
        </Card>
      ) : (
        <Card bodyClassName="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="flex max-w-full overflow-x-auto rounded-xl bg-slate-100 p-0.5 text-xs font-medium">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`whitespace-nowrap rounded-[10px] px-3 py-1.5 transition ${filter === f.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                >
                  {f.label} <span className="ml-0.5 text-slate-400">{counts[f.id]}</span>
                </button>
              ))}
            </div>
            <label className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search SKU, product or distributor"
                className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50/80 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Product</th>
                  <th className="px-3 py-2.5 font-semibold">Distributor</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Stock</th>
                  <th className="px-3 py-2.5 text-right font-semibold">avg 4w</th>
                  <th className="px-3 py-2.5 text-right font-semibold">avg 12w</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Expected/wk</th>
                  <th className="min-w-[170px] px-3 py-2.5 font-semibold">Weeks of cover</th>
                  <th className="px-3 py-2.5 font-semibold">Flags</th>
                  <th className="px-3 py-2.5 font-semibold">Action</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                  <th className="min-w-[280px] px-4 py-2.5 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((r) => {
                  const f = finalRow(r, decisions[r.skuId]);
                  return (
                    <tr key={r.skuId} onClick={() => ws.setDrawerSku(r.skuId)} className={`cursor-pointer transition-colors hover:bg-emerald-50/40 ${ws.drawerSku === r.skuId ? "bg-emerald-50/60" : ""}`}>
                      <td className="px-4 py-3">
                        <p className="flex items-center gap-1.5 font-medium text-slate-900">
                          <span className="whitespace-nowrap">{r.name.replace("Freshroots ", "") || r.skuId}</span>
                          {r.isException && <Chip tone="violet">Review</Chip>}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {r.skuId} · <span className={r.perishability === "High" ? "font-medium text-sky-700" : ""}>{r.perishability ?? "?"} perishability</span>
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500">{r.distributorName || r.distributorId}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.unitsOnHand?.toLocaleString("en-IN") ?? "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600">{fmt(r.avg4w)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600">{fmt(r.avg12w)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600">{fmt(r.expectedWeeklyDemand)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="w-10 text-right font-semibold tabular-nums text-slate-900">{fmt(r.weeksOfCover, 2)}</span>
                          <div className="flex-1"><CoverGauge row={r} /></div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">{r.flags.length ? r.flags.join(", ") : <span className="text-slate-300">—</span>}</td>
                      <td className="px-3 py-3"><ActionBadge action={r.action} /></td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
                        {r.qty}
                        {f.overridden && <span className="block text-[11px] font-medium text-violet-700">→ {f.qty} override</span>}
                      </td>
                      <td className="max-w-[420px] px-4 py-3 text-xs text-slate-600">
                        <span className="line-clamp-2" title={expl[r.skuId]?.reason}>{expl[r.skuId]?.reason}</span>
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr><td colSpan={11} className="px-4 py-12 text-center text-sm text-slate-400">No SKUs match this filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
            Green band = the SKU&apos;s cover window. Dot colour = action. Quantities are set by code and rounded up; the AI never edits them.
          </p>
        </Card>
      )}
    </div>
  );
}
