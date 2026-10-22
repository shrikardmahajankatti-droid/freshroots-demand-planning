"use client";

import type { ReactNode } from "react";
import { Ban, BookOpen, Download, Flag, Gavel, Power, Scale, Settings2, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { ActionBadge, Button, Callout, Card, Chip, MiniStat, PageHeader, ProgressBar } from "@/components/ui";
import { monthName, ts, useWs } from "@/components/workspace";
import { exceptionLabel } from "@/components/views/shared";
import { KILL_CRITERION_OVERRIDE_RATE, RULES, fmt, type ExceptionCode, type SkuResult, type UpliftMode } from "@/lib/rules";

const SECTIONS = [
  ["rubric", "Rules rubric"],
  ["actions", "Action matrix"],
  ["review", "Review criteria"],
  ["rejection", "Data rejection"],
  ["kill", "Kill switch"],
  ["guardrails", "Guardrails"],
  ["settings", "Settings"],
] as const;

export function RulesSettings() {
  const ws = useWs();
  const { rows, fest, dataset, stats, log, summary } = ws;
  const has = rows.length > 0;
  const by = (pred: (r: SkuResult) => boolean) => rows.filter(pred);
  const ex = (r?: SkuResult) => (r ? `${r.skuId} ${r.name.replace("Freshroots ", "")}` : "");

  const festival = fest?.on ?? (!!dataset?.asOfMonth && dataset.festivalMonths.has(dataset.asOfMonth));
  const hi = by((r) => r.flags.includes("HIGH_DEMAND"));
  const so = by((r) => r.flags.includes("STOCKOUT"));
  const os = by((r) => r.flags.includes("OVERSTOCK"));
  const sample = rows.find((r) => r.skuId === "SKU001") ?? rows[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rules & settings"
        box={[3]}
        sub="How every recommendation is made: the documented rules, what sends a SKU to human review, what data is rejected, and when the rules themselves should be questioned."
      />

      <nav className="sticky top-16 z-20 -mx-4 overflow-x-auto bg-slate-50/90 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <ol className="flex w-max gap-1.5">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#rules-${id}`} className="block rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900">
                {label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* Rubric */}
      <Anchor id="rubric">
        <Card title="Rules v1 rubric" sub="Raghav's documented rules, run in this fixed order for every SKU. Read-only." icon={<BookOpen className="h-4 w-4" />} box={[3, 4]} right={<Chip>v1 · read-only</Chip>}>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <RuleCard
              id="R5"
              order={1}
              title="Cover windows"
              rule={<>Perishability <b>High</b> → {RULES.windows.High.min}–{RULES.windows.High.max} weeks. <b>Low</b> → {RULES.windows.Low.min}–{RULES.windows.Low.max} weeks.</>}
              threshold={`${RULES.windows.High.min}–${RULES.windows.High.max} / ${RULES.windows.Low.min}–${RULES.windows.Low.max} wks`}
              live={has ? `${by((r) => r.perishability === "High").length} perishable SKUs, ${by((r) => r.perishability === "Low").length} non-perishable.` : undefined}
            />
            <RuleCard
              id="R1"
              order={2}
              title="Festival uplift"
              rule={<>If the inventory as-of month is a festival month, expected weekly demand = 12-week avg × <b>{RULES.festivalUplift}</b>. Otherwise = 12-week avg. Applied before any threshold.</>}
              threshold={`×${RULES.festivalUplift}`}
              live={
                dataset?.asOfMonth
                  ? `${monthName(dataset.asOfMonth)} is ${festival ? "a festival month — uplift ON" : "not a festival month — uplift OFF"}.${sample && festival ? ` e.g. ${sample.skuId}: ${fmt(sample.avg12w)} × 1.25 = ${fmt(sample.expectedWeeklyDemand)}/wk.` : ""}`
                  : undefined
              }
            />
            <RuleCard
              id="R2"
              order={3}
              title="High demand"
              rule={<>4-week avg &gt; 12-week avg × <b>{RULES.highDemandRatio}</b> → flag HIGH_DEMAND. Compares raw averages; no uplift.</>}
              threshold={`+${Math.round((RULES.highDemandRatio - 1) * 100)}%`}
              live={has ? (hi.length ? `${hi.length} flagged: ${hi.map((r) => `${r.skuId} (${fmt(r.avg4w)} > ${fmt((r.avg12w ?? 0) * RULES.highDemandRatio)})`).join(", ")}.` : "None flagged this cycle.") : undefined}
            />
            <RuleCard
              id="R3"
              order={4}
              title="Stockout risk"
              rule={<>Weeks of cover &lt; the SKU&apos;s <b>min</b> window → flag STOCKOUT.</>}
              threshold="cover < min"
              live={has ? `${so.length} flagged: ${so.map((r) => `${r.skuId} ${fmt(r.weeksOfCover, 2)}`).join(", ") || "none"}.` : undefined}
            />
            <RuleCard
              id="R4"
              order={5}
              title="Overstock"
              rule={<>Weeks of cover &gt; the SKU&apos;s <b>max</b> window → flag OVERSTOCK.</>}
              threshold="cover > max"
              live={has ? `${os.length} flagged: ${os.map((r) => `${r.skuId} ${fmt(r.weeksOfCover, 2)}`).join(", ") || "none"}.` : undefined}
            />
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 text-xs leading-relaxed text-slate-600">
              <p className="font-semibold text-slate-800">Weeks of cover</p>
              <p className="mt-1">= Units on hand ÷ expected weekly demand.</p>
              <p className="mt-2 text-slate-500">There is no open-PO data, so stock already on order is not counted. Cover is shown to 2 decimals.</p>
            </div>
          </div>
        </Card>
      </Anchor>

      {/* Action matrix */}
      <Anchor id="actions">
        <Card title="Action matrix" sub="How flags become an action and a quantity. Quantities round up to whole units." icon={<Scale className="h-4 w-4" />} box={4}>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">When the flags are</th>
                  <th className="px-3 py-2.5 font-semibold">Action</th>
                  <th className="px-3 py-2.5 font-semibold">Quantity</th>
                  <th className="px-4 py-2.5 text-right font-semibold">SKUs now</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <MatrixRow when="STOCKOUT + HIGH_DEMAND" action="REORDER_NOW" qty="1.5 × standard reorder qty" n={has ? by((r) => r.action === "REORDER_NOW" && r.flags.includes("HIGH_DEMAND")).length : null} />
                <MatrixRow when="STOCKOUT only" action="REORDER_NOW" qty="Standard reorder qty" n={has ? by((r) => r.action === "REORDER_NOW" && !r.flags.includes("HIGH_DEMAND")).length : null} />
                <MatrixRow when="HIGH_DEMAND, not overstocked" action="REORDER_1.5X" qty="1.5 × standard reorder qty" n={has ? by((r) => r.action === "REORDER_1.5X").length : null} />
                <MatrixRow when="OVERSTOCK only" action="PAUSE" qty="0" n={has ? by((r) => r.action === "PAUSE").length : null} />
                <MatrixRow when="No flag · conflicting flags · missing data" action="HOLD" qty="0" n={has ? by((r) => r.action === "HOLD").length : null} />
              </tbody>
            </table>
          </div>
        </Card>
      </Anchor>

      {/* Review criteria */}
      <Anchor id="review">
        <Card title="Review criteria (qualifies as an exception)" sub="A SKU goes to Raghav instead of straight through when any of these is true. Detected in code; the AI only writes the explanation." icon={<Flag className="h-4 w-4" />} box={5}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Criterion code="NEW_LAUNCH" title="New launch" rule={`Fewer than ${RULES.longWindow} weeks of sales history`} why="Averages are unreliable on short history." rows={rows} has={has} />
            <Criterion code="SWING" title="Demand swing" rule={`Any week-on-week change above ±${RULES.swingThreshold * 100}% in the last ${RULES.swingTransitions} transitions`} why="Proxy for a distributor order swing — each SKU maps to one distributor." rows={rows} has={has} />
            <Criterion code="CONFLICT" title="Conflicting flags" rule="HIGH_DEMAND or STOCKOUT together with OVERSTOCK" why="The rules disagree, so no automatic action is taken." rows={rows} has={has} />
            <Criterion code="DATA" title="Missing or invalid data" rule="Any required field missing or invalid for the SKU" why="Never guess — hold at 0 and ask a human." rows={rows} has={has} />
          </div>
          <Callout tone="blue">Gate 1: Raghav must approve or override <b>every</b> exception. An override needs a new quantity (≥ 0) and a written reason, and is logged for the kill switch.</Callout>
        </Card>
      </Anchor>

      {/* Data rejection */}
      <Anchor id="rejection">
        <Card
          title="Data rejection rules"
          sub="Checked when files are loaded. Rejected rows never feed a recommendation."
          icon={<Ban className="h-4 w-4" />}
          box={2}
          right={summary && <Chip tone={summary.rejected.length ? "red" : "green"} dot>{summary.rejected.length} rows rejected now</Chip>}
        >
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-2.5 font-semibold">Check</th><th className="px-4 py-2.5 font-semibold">What happens</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                <Rej check="File is missing a required column" result="Whole file rejected; Run forecast stays disabled until fixed." severity="file" />
                <Rej check='Week is not ISO format (e.g. "2026-W27")' result="Row rejected; SKU sent for review (Missing data)." />
                <Rej check="Units_Sold / Units_On_Hand missing, negative or not a number" result="Row rejected; SKU sent for review." />
                <Rej check="Same SKU and week appears twice" result="Duplicate row rejected; SKU sent for review." />
                <Rej check="As_Of_Date not YYYY-MM-DD" result="Row rejected; SKU sent for review." />
                <Rej check="SKU missing from sku_master, inventory or sales" result="HOLD 0 and sent for review — never guessed." />
                <Rej check="Perishability not High/Low, or Standard_Reorder_Qty ≤ 0" result="HOLD 0 and sent for review." />
                <Rej check="Distributor_ID not in distributor_master" result="HOLD 0 and sent for review." />
                <Rej check="As-of month not in the calendar" result="Festival uplift treated as OFF, with a warning." severity="warn" />
                <Rej check="Expected weekly demand is 0" result="Cover undefined; HOLD 0 and sent for review." />
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">Weeks are sorted as ISO weeks (2025-W52 before 2026-W09), not as text.</p>
        </Card>
      </Anchor>

      {/* Kill switch */}
      <Anchor id="kill">
        <Card
          title="Kill switch"
          sub="When Raghav overrides too often, the rules no longer describe how he plans."
          icon={<Power className="h-4 w-4" />}
          box="8 → 3"
          right={
            log.length > 0 ? (
              <Button variant="secondary" size="sm" onClick={ws.downloadLog}><Download className="h-3.5 w-3.5" /> Override log</Button>
            ) : undefined
          }
        >
          <div className={`rounded-2xl border p-4 ${stats.killCriterion ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50/60"}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className={`grid h-10 w-10 place-items-center rounded-xl ${stats.killCriterion ? "bg-red-500 text-white" : "bg-emerald-500 text-white"}`}>
                  {stats.killCriterion ? <TriangleAlert className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
                </span>
                <div>
                  <p className={`text-sm font-semibold ${stats.killCriterion ? "text-red-900" : "text-emerald-900"}`}>
                    {stats.killCriterion ? "Triggered — rules may need re-documenting" : "Armed — rules are holding up"}
                  </p>
                  <p className="text-xs text-slate-600">Trips when the override rate is above {KILL_CRITERION_OVERRIDE_RATE * 100}% of reviewed exceptions in a cycle.</p>
                </div>
              </div>
              <span className={`text-3xl font-semibold tabular-nums ${stats.killCriterion ? "text-red-600" : "text-slate-900"}`}>
                {stats.resolved ? `${Math.round(stats.overrideRate * 100)}%` : "—"}
              </span>
            </div>
            <div className="relative mt-4">
              <ProgressBar value={stats.overrideRate} tone={stats.killCriterion ? "red" : "green"} className="h-2.5" />
              <span className="absolute -top-1 h-4.5 w-0.5 bg-slate-900" style={{ left: `${KILL_CRITERION_OVERRIDE_RATE * 100}%` }} title="30% threshold" />
              <div className="mt-1.5 flex justify-between text-[10px] text-slate-500">
                <span>0%</span>
                <span style={{ marginLeft: `${KILL_CRITERION_OVERRIDE_RATE * 100 - 10}%` }}>threshold {KILL_CRITERION_OVERRIDE_RATE * 100}%</span>
                <span>100%</span>
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MiniStat label="Override rate" value={stats.resolved ? `${Math.round(stats.overrideRate * 100)}%` : "—"} hint={`${stats.overrides} of ${stats.resolved} reviewed`} tone={stats.killCriterion ? "red" : undefined} />
            <MiniStat label="Acceptance rate" value={stats.resolved ? `${Math.round(stats.acceptanceRate * 100)}%` : "—"} hint={`${stats.approvals} approved as-is`} tone="green" />
            <MiniStat label="Threshold" value={`${KILL_CRITERION_OVERRIDE_RATE * 100}%`} hint="override rate" />
            <MiniStat label="Override log" value={log.length} hint="this session" />
          </div>
          <p className="mt-4 text-xs leading-relaxed text-slate-600">
            <b>What to do when it trips:</b> stop relying on the automatic list, sit with Raghav to see which rule he keeps correcting (the override reasons show this), update Rules v1, then re-run. Overrides feed back from procurement (step 8) to the rules (step 3).
          </p>
          {log.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 text-xs">
              {log.map((e) => (
                <li key={`${e.runAt}-${e.sku}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <span className="flex items-center gap-2">
                    <b className="text-slate-900">{e.sku}</b>
                    <ActionBadge action={e.originalAction} />
                    <span className="tabular-nums text-slate-500">{e.originalQty} → <b className="text-violet-700">{e.overrideQty}</b></span>
                  </span>
                  <span className="text-slate-600">“{e.reason}”</span>
                  <span className="text-slate-400">{e.by} · {ts(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Anchor>

      {/* Guardrails */}
      <Anchor id="guardrails">
        <Card title="Guardrails" sub="Non-negotiables built into the system" icon={<Gavel className="h-4 w-4" />}>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Guard title="Code decides, AI explains" body="Rules run in code in a fixed order. The AI writes reasons and flags; it never sets or edits a quantity." />
            <Guard title="Two humans before any PO" body="Raghav resolves every exception, then procurement approves. The PO download stays locked until both happen." />
            <Guard title="Missing data → exception" body="Bad or missing data becomes a review item at HOLD 0 — never a guess." />
            <Guard title="Nothing auto-ordered" body="The PO list is a CSV for manual upload to Zoho. No order is placed by the system." />
          </ul>
        </Card>
      </Anchor>

      {/* Settings */}
      <Anchor id="settings">
        <Card title="Settings" sub="Session-only — nothing is stored on a server" icon={<Settings2 className="h-4 w-4" />}>
          <div className="divide-y divide-slate-100">
            <Setting label="Festival uplift (what-if)" desc="Auto follows the calendar. Force a value to see how recommendations change, then re-run.">
              <select value={ws.mode} onChange={(e) => ws.setMode(e.target.value as UpliftMode)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm">
                <option value="auto">Auto (calendar)</option>
                <option value="off">Force OFF</option>
                <option value="on">Force ON</option>
              </select>
            </Setting>
            {ws.stale && (
              <div className="py-3">
                <Callout tone="amber">Uplift changed. <button className="font-semibold underline" onClick={ws.runForecast}>Re-run the forecast</button> to apply it.</Callout>
              </div>
            )}
            <Setting label="Planner (Gate 1)" desc="Name recorded on approvals and overrides.">
              <input value={ws.g1Name} onChange={(e) => ws.setG1Name(e.target.value)} disabled={!!ws.g2} className="h-9 w-44 rounded-lg border border-slate-300 px-2.5 text-sm disabled:bg-slate-50" />
            </Setting>
            <Setting label="Procurement approver (Gate 2)" desc="Name recorded on the PO export.">
              <input value={ws.g2Name} onChange={(e) => ws.setG2Name(e.target.value)} disabled={!!ws.g2} placeholder="e.g. Priya" className="h-9 w-44 rounded-lg border border-slate-300 px-2.5 text-sm disabled:bg-slate-50" />
            </Setting>
            <Setting label="AI explanations" desc={ws.explStatus?.note ?? "Runs after the forecast."}>
              <Chip tone={ws.explStatus?.source === "ai" ? "green" : "slate"} dot>
                <Sparkles className="h-3 w-3" /> {ws.explStatus?.source === "ai" ? "Claude" : "Free mode"}
              </Chip>
            </Setting>
            <Setting label="Show component-map labels" desc="Tag each screen with its box (1–8) from the class component map.">
              <Toggle on={ws.showBoxes} onChange={ws.setShowBoxes} />
            </Setting>
          </div>
        </Card>
        <Card className="mt-6" title="Assumptions" sub="Stated so nobody has to guess">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
            <li>Festival uplift uses the month of the inventory as-of date.</li>
            <li>Weeks of cover uses stock on hand only — there is no open-PO data.</li>
            <li>A SKU&apos;s week-on-week swing stands in for a distributor swing (one distributor per SKU).</li>
            <li>Perishability High = perishable (3–4 week window).</li>
            <li>Short history: averages use the weeks available, and the SKU is reviewed as a new launch.</li>
            <li>An override above 0 on a non-reorder SKU becomes REORDER_OVERRIDE so it reaches the PO list; an override to 0 removes a line.</li>
          </ol>
        </Card>
      </Anchor>
    </div>
  );
}

function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return <div id={`rules-${id}`} className="scroll-mt-32">{children}</div>;
}

function RuleCard({ id, order, title, rule, threshold, live }: { id: string; order: number; title: string; rule: ReactNode; threshold: string; live?: string }) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-emerald-600 px-1.5 py-0.5 text-[11px] font-bold text-white">{id}</span>
          <p className="text-sm font-semibold text-slate-900">{title}</p>
        </div>
        <span className="text-[11px] text-slate-400">step {order}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{rule}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        <Chip tone="slate">Threshold: {threshold}</Chip>
      </div>
      {live && <p className="mt-2 rounded-lg bg-emerald-50/70 px-2.5 py-1.5 text-xs text-emerald-900"><b>This cycle:</b> {live}</p>}
    </div>
  );
}

function MatrixRow({ when, action, qty, n }: { when: string; action: string; qty: string; n: number | null }) {
  return (
    <tr>
      <td className="px-4 py-2.5 text-slate-700">{when}</td>
      <td className="px-3 py-2.5"><ActionBadge action={action} /></td>
      <td className="px-3 py-2.5 text-slate-500">{qty}</td>
      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{n ?? "—"}</td>
    </tr>
  );
}

function Criterion({ code, title, rule, why, rows, has }: { code: ExceptionCode; title: string; rule: string; why: string; rows: SkuResult[]; has: boolean }) {
  const hit = rows.filter((r) => r.exceptionCodes.includes(code));
  return (
    <div className={`rounded-xl border p-4 ${hit.length ? "border-violet-200 bg-violet-50/50" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {has && <Chip tone={hit.length ? "violet" : "slate"}>{hit.length} this cycle</Chip>}
      </div>
      <p className="mt-1 text-sm text-slate-700">{rule}</p>
      <p className="mt-1 text-xs text-slate-500">{why}</p>
      {hit.length > 0 && <p className="mt-2 text-xs font-medium text-violet-800">{hit.map((r) => `${r.skuId} ${r.name.replace("Freshroots ", "")}`).join(" · ")}</p>}
      <span className="sr-only">{exceptionLabel[code]}</span>
    </div>
  );
}

function Rej({ check, result, severity = "row" }: { check: string; result: string; severity?: "file" | "row" | "warn" }) {
  const tone = severity === "file" ? "red" : severity === "warn" ? "amber" : "slate";
  return (
    <tr>
      <td className="px-4 py-2.5 text-slate-800">
        <span className="flex items-center gap-2">
          <Chip tone={tone}>{severity === "file" ? "File" : severity === "warn" ? "Warning" : "Row / SKU"}</Chip>
          {check}
        </span>
      </td>
      <td className="px-4 py-2.5 text-slate-600">{result}</td>
    </tr>
  );
}

function Guard({ title, body }: { title: string; body: string }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-slate-200 p-4">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      <div>
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{body}</p>
      </div>
    </li>
  );
}

function Setting({ label, desc, children }: { label: string; desc: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 max-w-md">
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <p className="text-xs text-slate-500">{desc}</p>
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 rounded-full transition-colors ${on ? "bg-emerald-600" : "bg-slate-300"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}
