"use client";

import { ArrowRight, CheckCircle2, Download, ExternalLink, Loader2, Lock, RefreshCw, ShieldCheck, Truck } from "lucide-react";
import { ActionBadge, Button, Callout, Card, EmptyState, MiniStat, PageHeader } from "@/components/ui";
import { ts, useWs } from "@/components/workspace";

export function PurchaseOrders() {
  const ws = useWs();
  const { run, po, poUnits, g1, g2, rows, dataset, hubspot } = ws;
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
        sub="The final reorder list after Raghav's review. When procurement approves, one Order per distributor is created in HubSpot."
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
                <Gate
                  done={hubspot.state === "done"}
                  label="Created in HubSpot"
                  detail={
                    hubspot.state === "done"
                      ? `${hubspot.results.length} order${hubspot.results.length === 1 ? "" : "s"} · ${ts(hubspot.at)}`
                      : hubspot.state === "syncing"
                        ? "Sending…"
                        : hubspot.state === "error"
                          ? hubspot.configured ? "Failed — see below" : "Not connected"
                          : "On approval"
                  }
                />
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
                  <ShieldCheck className="h-4 w-4" /> Approve &amp; create in HubSpot
                </Button>
                <Button variant="secondary" className="w-full" onClick={ws.downloadPo} disabled={!g2}>
                  <Download className="h-4 w-4" /> Download PO list (CSV)
                </Button>
              </div>
              {locked && <p className="mt-3 text-xs text-violet-700">Approval unlocks once every exception is reviewed.</p>}
              {!locked && !g2 && !ws.g2Name.trim() && <p className="mt-3 text-xs text-slate-500">Enter the approver&apos;s name to sign off.</p>}
              {g2 && <Callout tone="green">Signed off by <b>{g2.by}</b>. Raghav&apos;s decisions are locked for this cycle.</Callout>}
              {g2 && <HubspotPanel />}
              <p className="mt-3 text-[11px] text-slate-400">Only REORDER lines with qty &gt; 0 are included. Orders are created in HubSpot only after both approvals; nothing is sent to suppliers automatically.</p>
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

function HubspotPanel() {
  const { hubspot, retryHubspot } = useWs();
  if (hubspot.state === "idle") return null;
  return (
    <div className="mt-3 rounded-xl border border-slate-200 p-3">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <span className="grid h-5 w-5 place-items-center rounded bg-[#ff7a59] text-[10px] font-bold text-white">H</span> HubSpot
      </p>
      {hubspot.state === "syncing" && (
        <p className="mt-2 flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Creating orders in HubSpot…</p>
      )}
      {hubspot.state === "done" && (
        <ul className="mt-2 space-y-1.5">
          {hubspot.results.map((r) => (
            <li key={r.orderId} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-900">{r.distributorName}</span>
                <span className="block text-[11px] text-slate-500">Order {r.orderId} · {r.lines} lines · {r.units.toLocaleString("en-IN")} units{r.status === "existing" ? " · already existed" : ""}</span>
              </span>
              {r.url && (
                <a href={r.url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-xs font-semibold text-[#ff5c35] hover:underline">
                  Open <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {hubspot.state === "error" && (
        <div className="mt-2 space-y-2 text-xs">
          <p className={hubspot.configured ? "text-red-700" : "text-slate-600"}>{hubspot.error}</p>
          {hubspot.missingScopes.length > 0 && (
            <div className="rounded-lg bg-red-50 p-2 text-red-800">
              Add these scopes to the HubSpot private app, then retry:
              <ul className="mt-1 list-disc pl-4 font-mono text-[11px]">{hubspot.missingScopes.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          )}
          {hubspot.configured && (
            <Button variant="secondary" size="sm" onClick={retryHubspot}><RefreshCw className="h-3.5 w-3.5" /> Retry HubSpot</Button>
          )}
        </div>
      )}
    </div>
  );
}
