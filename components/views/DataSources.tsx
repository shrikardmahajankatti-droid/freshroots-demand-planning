"use client";

import { Boxes, Database, RefreshCw } from "lucide-react";
import { Button, Callout, Card, PageHeader, StatRow } from "@/components/ui";
import { useWs } from "@/components/workspace";
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
        sub="The five CSVs the forecast reads. Upload your own or reload the demo set; headers are checked on upload."
        right={
          <Button variant="secondary" size="sm" onClick={() => ws.loadDemo(true)}>
            <RefreshCw className="h-3.5 w-3.5" /> Reload demo data
          </Button>
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
    </div>
  );
}
