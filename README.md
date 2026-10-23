# Freshroots Demand Planning — class prototype

Runs Raghav's documented reorder rules automatically on five CSV uploads, shows why each SKU got its action, sends only the unusual SKUs to a human, and needs **two human approvals** before a PO list can be downloaded.

The UI follows the 8-box component map, and every section is labelled with its box:

| Box | Name | What it does |
|---|---|---|
| 1 | Trigger | "Run forecast" button (stands in for the Mon + Thu 6 AM schedule), plus the last-run time |
| 2 | Input | Upload `weekly_sales.csv` + `current_inventory.csv`; load summary, weeks per SKU, as-of date, rejected rows and why |
| 3 | Context | Upload `sku_master.csv`, `calendar.csv`, `distributor_master.csv`; read-only **Rules v1** panel; what-if uplift toggle |
| 4 | Processing | Pure code (`lib/rules.ts`): averages, R1 uplift, cover, flags, action, qty. No AI |
| 5 | AI layer | Exception detection (in code) + one batched `/api/explain` call for plain-English reasons |
| 6 | Output | Summary strip, KPI tiles, weeks-of-cover charts, sales-trend chart, Exception Queue, SKU Action List |
| 7 | Gate 1 — Raghav | Approve or Override each exception (override needs qty ≥ 0 and a written reason) |
| 8 | Gate 2 — Procurement | "Approve final list" stays locked until Gate 1 is done; then "Download PO list" |
| 8 → 3 | Feedback loop | Override log CSV, override / acceptance rate, kill-criterion banner above 30% |

## AI and integrations

- **Gemini** writes the plain-English reasons (`/api/explain`, model `gemini-3.8-flash`). It never sets a quantity. With no `GEMINI_API_KEY`, or if Gemini fails or returns invalid JSON, the app falls back to built-in template reasons, so it always works offline.
- **HubSpot** receives the purchase orders (`/api/hubspot/po`). When procurement clicks **Approve & create in HubSpot**, the app creates **one HubSpot Order per distributor**, with each SKU as a line item. Retries are safe: each order carries an external ID (`FR-<run>-<distributor>`), so a retry finds the existing order instead of duplicating it. If HubSpot is not connected or fails, the approval still stands and the PO CSV is available, and the Purchase orders tab shows why with a Retry button.

## Database (Neon Postgres)

With `DATABASE_URL` set, everything is saved to Neon (project `freshroots-demand-planning`) and the latest run is restored on reload — inputs, results, Gemini reasons, Raghav's decisions, procurement approval and HubSpot order IDs. Tables are created automatically on first request (`lib/schema.ts`); there is no migration step.

| Table | One row per |
|---|---|
| `upload_batches` | Upload or demo load — source, as-of date, **SKU count**, distributor count, sales/inventory rows, rejected rows, file names |
| `weekly_sales`, `inventory`, `sku_master`, `festival_calendar`, `distributors` | Input row, stored exactly as uploaded (so any run can be reproduced) |
| `forecast_runs` | Run — uplift, SKU / reorder / pause / hold / exception counts, reorder units, AI source |
| `sku_results` | SKU per run — on hand, averages, expected demand, cover, flags, action, qty, exception codes, reason, check |
| `gate1_decisions` | Raghav's approve / override per exception (also the cross-cycle override log) |
| `gate2_approvals` | Procurement sign-off per run, with PO lines and units |
| `hubspot_orders` | HubSpot Order created per distributor per run |
| `app_settings` | Lead time, planner and approver names, uplift mode |

Every upload starts a new batch; every run, decision, approval and HubSpot sync is written as it happens. **Data sources → Saved in Neon** lists the history. The API routes are unauthenticated (class prototype): anyone with the URL can read and write this workspace.

## Run locally

Needs Node 20+.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000, click **Load demo data**, then **Run forecast**.

Run the rule tests (vitest, against the real uploaded CSVs in `tests/fixtures/` and the demo set in `public/demo/`):

```bash
npm test
```

## Environment variables

Put these in `.env.local` (gitignored); see `.env.example`.

| Variable | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | *(unset → template reasons)* | Server-only, in `app/api/explain/route.ts` |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Any Gemini model that supports `generateContent` |
| `HUBSPOT_ACCESS_TOKEN` | *(unset → HubSpot step skipped)* | HubSpot private-app token, server-only, in `app/api/hubspot/po/route.ts` |
| `DATABASE_URL` | *(unset → nothing saved)* | Neon Postgres connection string, server-only, in `lib/db.ts` |

The HubSpot private app needs these scopes: `crm.objects.orders.read`, `crm.objects.orders.write`, `crm.pipelines.orders.read`, `crm.objects.line_items.read`, `crm.objects.line_items.write`. Orders are placed in the first stage of the first Orders pipeline.

## Deploy to Vercel (free Hobby plan)

1. Push this folder to a GitHub repo.
2. In Vercel, choose **Add New → Project**, import the repo, and keep the Next.js defaults.
3. Add `GEMINI_API_KEY`, `GEMINI_MODEL` and `HUBSPOT_ACCESS_TOKEN` under **Settings → Environment Variables** (Production). Without them the app still runs, using template reasons and no HubSpot sync.
4. Deploy. The demo CSVs ship from `public/demo/`.

Or from the CLI: `npx vercel` (preview), then `npx vercel --prod`.

## UI

The app is a tabbed SaaS workspace built for Raghav to oversee a planning cycle. The demo workspace loads and runs automatically on first visit.

**Outputs**

| Tab | What it shows |
|---|---|
| Overview | Cycle progress (data → forecast → Raghav review → procurement → export), KPI tiles, a plain-English briefing, stock health ranked by urgency, weeks-of-cover charts |
| Exceptions | Gate 1: each exception with why/what-to-check, a sparkline, key numbers and Approve / Override |
| Action list | Every SKU with filters, search, a cover gauge and CSV export. Click a row for the SKU drawer: trend chart, step-by-step rule trace, reason and decision |
| Purchase orders | Gate 2: reorder lines grouped by distributor, sign-off checklist; approving creates the Orders in HubSpot (with links), plus a PO CSV download |
| PO calendar | Month view of when to order what: this cycle's PO, the next order-by date per SKU (lead time editable, default 7 days), projected stockout dates, resume dates for paused SKUs, Mon/Thu forecast runs and festival months. Agenda list and `.ics` export |

**Configure**

| Tab | What it shows |
|---|---|
| Rules & settings | Rules v1 rubric with live examples, action matrix, review (exception) criteria, data rejection rules, the kill switch (override rate vs 30%) with the override log, guardrails, settings and assumptions |
| Data sources | Replace any single input (CSV or .xlsx), load summary, weeks of history per SKU, rejected rows |

**Uploading new data.** Click **Upload new data** in the top bar (or on Overview / Data sources), or just drag files anywhere onto the page. Drop any number of CSV or Excel (.xlsx) files at once — every sheet of a workbook is checked — and each one is matched to its input by its column headers, so file and sheet names don't matter. The dialog shows what each file matched, what changes (e.g. sales W27–W42 → W27–W43, stock as of 19 Oct → 26 Oct), and which inputs are kept; **Apply & re-run forecast** swaps them in and recalculates everything. `public/demo/freshroots_inputs.xlsx` is a 5-sheet template, and `public/demo/sample_next_week.xlsx` is a sample weekly refresh (W43 sales + stock as of 26 Oct). Old `.xls` files aren't supported — save as .xlsx or .csv. With Neon configured, uploads are saved and survive a refresh; without it they live in the browser tab only.

The class component map (Boxes 1–8) is still traceable: turn on **Settings → Show component-map labels** to tag each screen with its box.

Four [React Bits](https://reactbits.dev) components are used (copied into `components/reactbits/`). All of them respect `prefers-reduced-motion`:

| Component | Where |
|---|---|
| Aurora | Soft WebGL background in the Overview banner only (client-only, dark fallback) |
| ShinyText | Banner headline |
| SpotlightCard | KPI tiles on Overview |
| CountUp | KPI numbers |

React Bits is MIT + Commons Clause: free to use in this app, but the components themselves may not be resold as a template or component pack. Icons come from lucide-react.

## Project layout

```
lib/rules.ts            all rule logic: pure, no UI, no AI (parsing, joins, R1–R5, actions, exceptions, gates, CSV)
lib/db.ts, lib/schema.ts  Neon data access and schema (server-only)
app/api/db/route.ts     save / restore API for Neon
lib/csv.ts              browser CSV parsing (papaparse) + header validation + downloads
app/page.tsx            app shell: sidebar, top bar, tab switching
components/Charts.tsx   recharts: weeks-of-cover bars, sales trend
components/workspace.tsx  all app state and actions (React context)
components/views/       one file per tab + the SKU drawer
components/ui.tsx       shared UI: cards, chips, buttons, KPI tiles, toasts
components/reactbits/   React Bits components (Aurora, ShinyText, SpotlightCard, CountUp)
app/api/explain/route.ts  Gemini call + JSON validation
app/api/hubspot/po/route.ts  creates HubSpot Orders + line items on approval
tests/rules.test.ts     acceptance tests
public/demo/            demo CSVs (real data + test SKU016)
tests/fixtures/         the real uploaded CSVs, unchanged
```

## Rules v1 (as implemented)

Fixed order per SKU: **R5 → R1 → R2 → R3 → R4 → action → exception check**.

- **R1 Festival uplift:** if the month of the inventory `As_Of_Date` is `Is_Festival_Month = TRUE`, expected weekly demand = 12-wk avg × 1.25, otherwise = 12-wk avg.
- **R2 High demand:** 4-wk avg > 12-wk avg × 1.20 → `HIGH_DEMAND` (raw averages, no uplift).
- **R3 Stockout:** weeks of cover < min window → `STOCKOUT`.
- **R4 Overstock:** weeks of cover > max window → `OVERSTOCK`.
- **R5 Windows:** High perishability 3–4 weeks; Low 6–14 weeks.

Actions: STOCKOUT + HIGH_DEMAND → `REORDER_NOW` 1.5 × std · STOCKOUT → `REORDER_NOW` std · HIGH_DEMAND (no overstock) → `REORDER_1.5X` 1.5 × std · OVERSTOCK only → `PAUSE` 0 · otherwise `HOLD` 0. Quantities are rounded up.

Exceptions: < 12 weeks of history · any week-on-week change > 30% in the last 4 transitions · conflicting flags · missing/invalid data.

## Assumptions

1. **Uplift month = inventory as-of month.** R1 uses the month of `As_Of_Date` (2026-10 in the data, a festival month). If inventory has several dates, the latest is used and a warning is shown.
2. **Cover uses on-hand only.** Weeks of cover = `Units_On_Hand ÷ expected weekly demand`. There is no open-PO data, so stock already on order is not counted.
3. **SKU swing as distributor proxy.** Sales are SKU-level and each SKU maps to one distributor, so a > 30% week-on-week swing in a SKU stands in for a distributor swing.
4. **High = perishable.** `Perishability = High` gets the 3–4 week window; `Low` gets 6–14.
5. **Short history:** averages use whatever weeks exist (SKU016 has 6), and the SKU is flagged as a new-launch exception.
6. **HIGH_DEMAND + OVERSTOCK** isn't in the action table, so it becomes `HOLD 0` and goes to Raghav as a conflict exception.
7. **Missing data → exception, never a guess.** A SKU with missing/invalid required fields (no inventory row, bad Units_Sold, unknown distributor, etc.) gets `HOLD 0` and a `DATA` exception. Bad rows are rejected and listed in Box 2.
8. **Overrides:** an override to qty > 0 on a non-reorder SKU becomes `REORDER_OVERRIDE` so it reaches the PO list; an override to 0 removes a reorder from it.
9. **ISO weeks** are sorted numerically (`2025-W52` < `2026-W09` < `2026-W10`). A week's month (for chart shading) is the month of its Thursday.
10. **PO calendar:** a projection only. It assumes demand stays at today's expected weekly demand and uses stock on hand. Order-by = the day cover drops below the minimum window, minus the supplier lead time (default 7 days; there's no lead-time data). If that date has already passed for a SKU on HOLD, it is shown on the next Mon/Thu run, when the rules re-check it.
11. **Rates:** override and acceptance rates are computed over the current run's resolved exceptions. The override log keeps every override from the browser session.
