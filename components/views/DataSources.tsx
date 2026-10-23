"use client";

import { Boxes, Cloud, Database, History, RefreshCw, UploadCloud } from "lucide-react";
import { Button, Callout, Card, Chip, MiniStat, PageHeader, StatRow } from "@/components/ui";
import { ts, useWs } from "@/components/workspace";
import { FileRow } from "@/components/views/shared";
import { FILE_NAMES, RULES, type FileKind } from "@/lib/rules";

export function DataSources() {
  const ws = useWs();
  const { files, summary, dataset } = ws;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Data sources"
        box={[2, 3]}
        sub="The five inputs the forecast reads, as CSV or Excel. Drop new files on Upload new data, or replace one input at a time below."
        right={
          <>
            <Button variant="secondary" size="sm" onClick={() => ws.loadDemo(true)}>
              <RefreshCw className="h-3.5 w-3.5" /> Reload demo data
            </Button>
            <Button size="sm" onClick={() => ws.setUploadOpen(true)}>
              <UploadCloud className="h-3.5 w-3.5" /> Upload new data
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Sales & inventory" sub="Refreshed every cycle" icon={<Database className="h-4 w-4" />} box={2}>
          <div className="space-y-2">
            {(["sales", "inventory"] as FileKind[]).map((k) => <FileRow key={k} kind={k} file={files[k]} onFile={ws.onFile} />)}
          </div>
        </Card>
        <Card title="Master data & calendar" sub="Changes rarely" icon={<Boxes className="h-4 w-4" />} box={3}>
          <div className="space-y-2">
            {(["skuMaster", "calendar", "distributors"] as FileKind[]).map((k) => <FileRow key={k} kind={k} file={files[k]} onFile={ws.onFile} />)}
          </div>
        </Card>
      </div>

      {summary && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card title="Load summary" box={2}>
            <StatRow label="SKUs loaded" value={summary.skusLoaded} />
            <StatRow label="Sales rows" value={summary.salesRows} />
            <StatRow label="Inventory rows" value={summary.inventoryRows} />
            <StatRow label="Inventory as-of" value={summary.asOfDate ?? "missing"} tone={summary.asOfDate ? undefined : "red"} />
            <StatRow label="Festival month?" value={dataset?.asOfMonth && dataset.festivalMonths.has(dataset.asOfMonth) ? `Yes · ${dataset.asOfMonth}` : "No"} tone="green" />
            <StatRow label="Rows rejected" value={summary.rejected.length} tone={summary.rejected.length ? "red" : "green"} />
            {summary.warnings.map((w) => <Callout key={w} tone="amber">{w}</Callout>)}
          </Card>
          <Card title="Weeks of history per SKU" sub={`Fewer than ${RULES.longWindow} weeks is treated as a new launch and sent for review.`} box={2}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {summary.weeksPerSku.map((w) => (
                <div key={w.skuId} className={`rounded-xl border px-3 py-2 ${w.weeks < RULES.longWindow ? "border-amber-200 bg-amber-50" : "border-slate-200"}`}>
                  <p className="text-[11px] font-medium text-slate-500">{w.skuId}</p>
                  <p className={`text-base font-semibold tabular-nums ${w.weeks < RULES.longWindow ? "text-amber-700" : "text-slate-900"}`}>{w.weeks} wks</p>
                  <p className="text-[10px] text-slate-400">{w.first ? `${w.first.slice(5)}–${w.last!.slice(5)}` : "none"}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {summary && (
        <Card title="Rejected rows" sub="Rows that failed validation. The SKU is sent for review instead of guessed." box={2}>
          {summary.rejected.length === 0 ? (
            <p className="text-sm text-emerald-700">No rows rejected — every row passed validation.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr><th className="px-3 py-2">File</th><th className="px-3 py-2">Row</th><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Reason</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.rejected.map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-mono text-xs">{FILE_NAMES[r.file]}</td>
                      <td className="px-3 py-2 tabular-nums">{r.row}</td>
                      <td className="px-3 py-2">{r.skuId ?? "—"}</td>
                      <td className="px-3 py-2 text-red-700">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <SavedInNeon />
    </div>
  );
}

function SavedInNeon() {
  const { dbStatus, history, refreshHistory } = useWs();
  if (dbStatus.state === "off")
    return (
      <Card title="Saved history" icon={<History className="h-4 w-4" />}>
        <p className="text-sm text-slate-500">No database is configured (DATABASE_URL), so runs and uploads live only in this browser tab.</p>
      </Card>
    );
  if (dbStatus.state === "error")
    return (
      <Card title="Saved history" icon={<History className="h-4 w-4" />}>
        <Callout tone="red">Neon could not be reached: {dbStatus.error}. The app works, but nothing is being saved.</Callout>
      </Card>
    );
  const { runs, batches } = history;
  const approved = runs.filter((r) => r.approved_by).length;
  return (
    <Card
      title="Saved in Neon"
      sub="Every upload and forecast run, with its decisions, approvals and HubSpot orders. Reloading the page restores the latest run."
      icon={<Cloud className="h-4 w-4" />}
      right={<Button variant="ghost" size="sm" onClick={refreshHistory}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniStat label="Uploads saved" value={batches.length} hint={batches[0] ? `latest ${ts(batches[0].created_at)}` : "none yet"} />
        <MiniStat label="SKUs in latest upload" value={batches[0]?.sku_count ?? "—"} hint={batches[0] ? `${batches[0].distributor_count} distributors · ${batches[0].sales_rows} sales rows` : undefined} />
        <MiniStat label="Forecast runs" value={runs.length} hint={`${approved} approved by procurement`} />
        <MiniStat label="Overrides logged" value={runs.reduce((a, r) => a + r.overrides, 0)} hint="across saved runs" />
      </div>

      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Forecast runs</h3>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              {["Run", "Data", "SKUs", "Reorders", "Paused", "Exceptions", "Raghav", "Procurement", "HubSpot"].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {runs.map((r, i) => (
              <tr key={r.id} className={i === 0 ? "bg-emerald-50/40" : ""}>
                <td className="whitespace-nowrap px-3 py-2">
                  <p className="font-medium text-slate-900">#{r.id} {i === 0 && <Chip tone="green">latest</Chip>}</p>
                  <p className="text-[11px] text-slate-500">{ts(r.run_at)}</p>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">
                  {r.source === "demo" ? "Demo" : "Upload"} #{r.batch_id}
                  <span className="block text-[11px] text-slate-400">as of {r.as_of_date ?? "?"} · uplift {r.festival_on ? "ON" : "OFF"}{r.uplift_mode !== "auto" ? " (what-if)" : ""}</span>
                </td>
                <td className="px-3 py-2 tabular-nums">{r.sku_count}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.reorder_count} <span className="text-xs text-slate-400">· {r.reorder_units.toLocaleString("en-IN")} u</span></td>
                <td className="px-3 py-2 tabular-nums">{r.pause_count}</td>
                <td className="px-3 py-2 tabular-nums">{r.exception_count}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  {r.exception_count === 0 ? <span className="text-slate-400">nothing to review</span> : `${r.decided}/${r.exception_count} reviewed`}
                  {r.overrides > 0 && <span className="block text-violet-700">{r.overrides} override{r.overrides === 1 ? "" : "s"}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  {r.approved_by ? (
                    <>
                      <span className="font-medium text-emerald-700">{r.approved_by}</span>
                      <span className="block text-[11px] text-slate-400">{r.po_lines} lines · {r.po_units?.toLocaleString("en-IN")} u</span>
                    </>
                  ) : (
                    <span className="text-slate-400">not approved</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">{r.hubspot_orders ? <Chip tone="green">{r.hubspot_orders} orders</Chip> : <span className="text-slate-400">—</span>}</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">No runs saved yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Uploads</h3>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>{["Upload", "Source", "As of", "SKUs", "Distributors", "Sales rows", "Inventory rows", "Rejected"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {batches.map((b) => (
              <tr key={b.id}>
                <td className="whitespace-nowrap px-3 py-2"><p className="font-medium text-slate-900">#{b.id}</p><p className="text-[11px] text-slate-500">{ts(b.created_at)}</p></td>
                <td className="px-3 py-2"><Chip tone={b.source === "demo" ? "slate" : "blue"}>{b.source === "demo" ? "Demo" : "Upload"}</Chip></td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{b.as_of_date ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">{b.sku_count}</td>
                <td className="px-3 py-2 tabular-nums">{b.distributor_count}</td>
                <td className="px-3 py-2 tabular-nums">{b.sales_rows}</td>
                <td className="px-3 py-2 tabular-nums">{b.inventory_rows}</td>
                <td className={`px-3 py-2 tabular-nums ${b.rejected_rows ? "text-red-600" : ""}`}>{b.rejected_rows}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
