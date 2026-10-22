"use client";

import { ArrowRight, CheckCircle2, Download, Lock, ShieldCheck, Truck } from "lucide-react";
import { ActionBadge, Button, Callout, Card, EmptyState, MiniStat, PageHeader } from "@/components/ui";
import { ts, useWs } from "@/components/workspace";

export function PurchaseOrders() {
  const ws = useWs();
  const { run, po, poUnits, g1, g2, rows, dataset } = ws;
  const distributors = new Map((dataset?.skus ?? []).map((s) => [s.distributor?.id ?? "", s.distributor]));
  const groups = [...new Set(po.map((p) => p.distributorId))].map((id) => ({
    id,
    info: distributors.get(id),
    lines: po.filter((p) => p.distributorId === id),
  }));
  const locked = !g1.complete;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase orders"
        box={[8]}
        sub="The final reorder list after Raghav's review. Procurement signs off, then exports it for Zoho — nothing is ordered automatically."
      />
      {!run ? (
        <Card>
          <EmptyState icon={<Truck className="h-5 w-5" />} title="No forecast yet" body="The PO list appears here after the forecast runs." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            {locked && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3">
                <p className="flex items-center gap-2 text-sm font-medium text-violet-900">
                  <Lock className="h-4 w-4" /> Draft — {g1.total - g1.resolved} exception{g1.total - g1.resolved === 1 ? "" : "s"} still waiting for Raghav.
                </p>
                <Button variant="violet" size="sm" onClick={() => ws.setTab("exceptions")}>Review exceptions <ArrowRight className="h-3.5 w-3.5" /></Button>
              </div>
            )}
            {groups.length === 0 ? (
              <Card><EmptyState icon={<Truck className="h-5 w-5" />} title="No reorder lines" body="No SKU needs a purchase order this cycle." /></Card>
            ) : (
              groups.map((g) => (
                <Card
                  key={g.id}
                  title={g.info?.name ?? g.id}
                  sub={`${g.id}${g.info?.region ? ` · ${g.info.region}` : ""}${g.info?.status ? ` · ${g.info.status}` : ""}`}
                  icon={<Truck className="h-4 w-4" />}
                  right={<span className="text-sm font-semibold tabular-nums text-slate-900">{g.lines.reduce((a, l) => a + l.qty, 0).toLocaleString("en-IN")} units</span>}
                  bodyClassName="p-0"
                >
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50/80 text-left text-[11px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-5 py-2 font-semibold">Product</th>
                          <th className="px-3 py-2 font-semibold">Action</th>
                          <th className="px-3 py-2 text-right font-semibold">Rule qty</th>
                          <th className="px-5 py-2 text-right font-semibold">Final qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {g.lines.map((l) => {
                          const rule = rows.find((r) => r.skuId === l.skuId);
                          return (
                            <tr key={l.skuId} className="cursor-pointer hover:bg-slate-50" onClick={() => ws.setDrawerSku(l.skuId)}>
                              <td className="px-5 py-2.5">
                                <p className="whitespace-nowrap font-medium text-slate-900">{l.name.replace("Freshroots ", "")}</p>
                                <p className="text-[11px] text-slate-500">{l.skuId}</p>
                              </td>
                              <td className="px-3 py-2.5"><ActionBadge action={l.action} /></td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{rule?.qty ?? "—"}</td>
                              <td className="px-5 py-2.5 text-right font-semibold tabular-nums">
                                {l.qty}
                                {l.overridden && <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">override</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ))
            )}
          </div>

          {/* Sign-off panel */}
          <div className="xl:sticky xl:top-24 xl:self-start">
            <Card title="Procurement sign-off" sub="Second human approval" icon={<ShieldCheck className="h-4 w-4" />}>
              <div className="grid grid-cols-3 gap-2">
                <MiniStat label="Lines" value={po.length} />
                <MiniStat label="Units" value={poUnits.toLocaleString("en-IN")} />
                <MiniStat label="Suppliers" value={groups.length} />
              </div>
              <ol className="mt-4 space-y-2 text-sm">
                <Gate done={g1.complete} label="Raghav reviewed exceptions" detail={`${g1.resolved}/${g1.total} resolved by ${ws.g1Name || "planner"}`} />
                <Gate done={!!g2} label="Procurement approved" detail={g2 ? `${g2.by} · ${ts(g2.at)}` : "Waiting"} />
                <Gate done={ws.poDownloaded} label="Exported for Zoho" detail={ws.poDownloaded ? "CSV downloaded" : "Manual upload"} />
              </ol>
              <div className="mt-4 space-y-2">
                <input
                  value={ws.g2Name}
                  onChange={(e) => ws.setG2Name(e.target.value)}
                  disabled={!!g2}
                  placeholder="Procurement approver name"
                  className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-50"
                />
                <Button variant="dark" className="w-full" onClick={ws.approveFinal} disabled={locked || !ws.g2Name.trim() || !!g2}>
                  <ShieldCheck className="h-4 w-4" /> Approve final list
                </Button>
                <Button className="w-full" onClick={ws.downloadPo} disabled={!g2}>
                  <Download className="h-4 w-4" /> Download PO list (CSV)
                </Button>
              </div>
              {locked && <p className="mt-3 text-xs text-violet-700">Approval unlocks once every exception is reviewed.</p>}
              {!locked && !g2 && !ws.g2Name.trim() && <p className="mt-3 text-xs text-slate-500">Enter the approver&apos;s name to sign off.</p>}
              {g2 && <Callout tone="green">Signed off by <b>{g2.by}</b>. Raghav&apos;s decisions are locked for this cycle.</Callout>}
              <p className="mt-3 text-[11px] text-slate-400">Only REORDER lines with qty &gt; 0 are included. The CSV stands in for Zoho; nothing is auto-ordered.</p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Gate({ done, label, detail }: { done: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${done ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-400 ring-1 ring-inset ring-slate-200"}`}>
        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />}
      </span>
      <span>
        <span className={`block font-medium ${done ? "text-slate-900" : "text-slate-500"}`}>{label}</span>
        <span className="block text-xs text-slate-500">{detail}</span>
      </span>
    </li>
  );
}
