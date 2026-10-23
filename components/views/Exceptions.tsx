"use client";

import { ArrowRight, CheckCircle2, Lock, Sparkles, UserCheck } from "lucide-react";
import { ActionBadge, Button, Callout, Card, Chip, EmptyState, MiniStat, PageHeader, ProgressBar } from "@/components/ui";
import { useWs } from "@/components/workspace";
import { DecisionControls, Sparkline, exceptionLabel, swingText } from "@/components/views/shared";
import { fmt } from "@/lib/rules";

export function Exceptions() {
  const ws = useWs();
  const { run, exceptions, decisions, g1, g2, expl } = ws;
  const open = exceptions.filter((r) => !decisions[r.skuId]);
  const done = exceptions.filter((r) => decisions[r.skuId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exceptions review"
        box={[5, 7]}
        sub="The rules flagged these SKUs as unusual. Approve the rule result, or override it with a quantity and a reason."
        right={
          run && (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <ProgressBar value={g1.total ? g1.resolved / g1.total : 1} tone={g1.complete ? "green" : "violet"} className="w-24" />
              <span className={`text-sm font-semibold tabular-nums ${g1.complete ? "text-emerald-700" : "text-violet-700"}`}>
                {g1.resolved}/{g1.total} resolved
              </span>
            </div>
          )
        }
      />

      {!run ? (
        <Card>
          <EmptyState icon={<UserCheck className="h-5 w-5" />} title="No forecast yet" body="Exceptions appear here after the forecast runs." />
        </Card>
      ) : exceptions.length === 0 ? (
        <Card>
          <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="No exceptions this cycle" body="Every SKU followed the documented rules cleanly. Procurement can sign off straight away." action={<Button onClick={() => ws.setTab("orders")}>Go to purchase orders</Button>} />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Reviewing as
              <input value={ws.g1Name} onChange={(e) => ws.setG1Name(e.target.value)} disabled={!!g2} className="h-8 rounded-lg border border-slate-300 px-2.5 text-sm font-medium text-slate-900 disabled:bg-slate-50" />
            </label>
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
              {ws.explStatus?.source === "ai" ? "Reasons written by Gemini." : "Reasons generated from the rules."} Quantities always come from code.
            </p>
          </div>

          {g2 && <Callout tone="green">Procurement approved the final list. Decisions are locked for this cycle.</Callout>}

          {open.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Waiting for you · {open.length}</h2>
              {open.map((r) => <ExceptionCard key={`${run.at}-${r.skuId}`} skuId={r.skuId} />)}
            </section>
          )}

          {g1.complete && !g2 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-medium text-emerald-900"><CheckCircle2 className="h-4 w-4" /> All exceptions reviewed. Hand over to procurement.</p>
              <Button size="sm" onClick={() => ws.setTab("orders")}>Purchase orders <ArrowRight className="h-3.5 w-3.5" /></Button>
            </div>
          )}

          {done.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Reviewed · {done.length}</h2>
              {done.map((r) => <ExceptionCard key={`${run.at}-${r.skuId}`} skuId={r.skuId} />)}
            </section>
          )}
        </>
      )}
    </div>
  );

}

function ExceptionCard({ skuId }: { skuId: string }) {
    const ws = useWs();
    const { exceptions, decisions, g2, expl } = ws;
    const r = exceptions.find((x) => x.skuId === skuId)!;
    const d = decisions[skuId];
    return (
      <Card bodyClassName="p-0" className={d ? "opacity-95" : "ring-1 ring-violet-200"}>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-slate-500">{r.skuId} · {r.distributorName}</p>
                <button onClick={() => ws.setDrawerSku(r.skuId)} className="text-left text-base font-semibold text-slate-900 hover:underline">{r.name}</button>
              </div>
              <div className="flex flex-wrap gap-1">
                {r.exceptionCodes.map((c) => <Chip key={c} tone="violet" dot>{exceptionLabel[c]}</Chip>)}
              </div>
            </div>
            <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
              <p className="text-slate-700"><span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Why it&apos;s unusual</span>{expl[r.skuId]?.reason}</p>
              <p className="text-slate-700"><span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">What to check</span>{expl[r.skuId]?.check}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              Rule recommends <ActionBadge action={r.action} /> <b className="text-sm text-slate-900">qty {r.qty}</b>
              {g2 && <Lock className="h-3.5 w-3.5" />}
            </div>
            <DecisionControls
              row={r}
              decision={d}
              locked={!!g2}
              onApprove={() => ws.approve(r)}
              onOverride={(q, why) => ws.override(r, q, why)}
              onReopen={() => ws.reopen(r)}
            />
          </div>
          <div className="space-y-3 border-t border-slate-100 bg-slate-50/50 p-5 lg:border-l lg:border-t-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Last {r.history.length} weeks</p>
            <Sparkline row={r} height={56} />
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="On hand" value={r.unitsOnHand?.toLocaleString("en-IN") ?? "—"} />
              <MiniStat label="Cover" value={`${fmt(r.weeksOfCover, 1)} wk`} hint={r.minWindow !== null ? `window ${r.minWindow}–${r.maxWindow}` : undefined} />
              <MiniStat label="History" value={`${r.weeksOfHistory} wk`} />
              <MiniStat label="Max swing" value={swingText(r)} hint={r.maxWowLabel?.replace(/2026-/g, "") ?? undefined} />
            </div>
            <button onClick={() => ws.setDrawerSku(r.skuId)} className="flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-900">
              Full rule trace <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </Card>
    );
  }
