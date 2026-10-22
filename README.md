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

## Cost: free by default

**No paid service is needed.** With no `ANTHROPIC_API_KEY` set, `/api/explain` returns immediately without calling any API, and every reason and "what to check" line comes from the built-in templates in `lib/rules.ts` (`templateExplanation`). Box 5 shows "Free mode" when this happens. All rules, gates, charts and downloads work the same either way.

The Claude call is optional. If you add a key later, Claude rewrites the reasons in plain English, but it still never sets a quantity.

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

## Environment variables (optional)

Copy `.env.example` to `.env.local` only if you want Claude-written reasons:

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | *(unset → free mode)* | Read only on the server, in `app/api/explain/route.ts`; never sent to the browser |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Any current Claude model ID |

If the key is missing, the call fails, the model declines, or the reply isn't valid JSON of the form `[{"sku","reason","check"}]`, the app silently uses the templates. Any SKU missing from the reply also falls back to its template.

## Deploy to Vercel (free Hobby plan)

1. Push this folder to a GitHub repo.
2. In Vercel, choose **Add New → Project**, import the repo, and keep the Next.js defaults.
3. Optional: add `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` under **Settings → Environment Variables**. Leave them out to stay free.
4. Deploy. The demo CSVs ship from `public/demo/`.

Or from the CLI: `npx vercel` (preview), then `npx vercel --prod`.

## UI

The app is laid out as a SaaS workspace: a dark sidebar that shows the live status of every pipeline box, a sticky top bar, and box-labelled cards. On first visit the demo workspace loads and runs automatically, so the dashboard is never empty. **Load demo data** in the top bar reloads it, and each file card has **Upload / Replace** for your own CSVs.

Four [React Bits](https://reactbits.dev) components are used (copied into `components/reactbits/`). All of them respect `prefers-reduced-motion`:

| Component | Where |
|---|---|
| Aurora | Soft WebGL background in the Box 1 banner only (client-only, dark fallback) |
| ShinyText | Banner headline |
| SpotlightCard | KPI tiles in Box 6 |
| CountUp | KPI numbers |

React Bits is MIT + Commons Clause: free to use in this app, but the components themselves may not be resold as a template or component pack. Icons come from lucide-react.

## Project layout

```
lib/rules.ts            all rule logic: pure, no UI, no AI (parsing, joins, R1–R5, actions, exceptions, gates, CSV)
lib/csv.ts              browser CSV parsing (papaparse) + header validation + downloads
app/page.tsx            the 8-box UI (state in memory only)
components/Charts.tsx   recharts: weeks-of-cover bars, sales trend
components/ui.tsx       shared UI: box cards, chips, buttons, KPI tiles, toasts
components/reactbits/   React Bits components (Aurora, ShinyText, SpotlightCard, CountUp)
app/api/explain/route.ts  the only server route: Claude call + JSON validation
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
10. **Rates:** override and acceptance rates are computed over the current run's resolved exceptions. The override log keeps every override from the browser session.
