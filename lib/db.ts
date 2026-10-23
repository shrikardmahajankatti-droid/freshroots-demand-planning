import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { SCHEMA } from "./schema";
import type { FileKind, RawRow } from "./rules";

// Server-only data access for Neon Postgres. DATABASE_URL never reaches the browser.

let client: NeonQueryFunction<false, false> | null = null;
let schemaReady: Promise<void> | null = null;

export const dbConfigured = () => !!process.env.DATABASE_URL;

/** Returns a ready client; creates the schema once per server process. */
export async function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  client ??= neon(process.env.DATABASE_URL);
  schemaReady ??= (async () => {
    for (const stmt of SCHEMA) await client!.query(stmt);
  })().catch((e) => {
    schemaReady = null;
    throw e;
  });
  await schemaReady;
  return client;
}

/** CSV header → column, per input table. Order matters for inserts and restores. */
const INPUTS: Record<FileKind, { table: string; cols: [string, string][] }> = {
  sales: { table: "weekly_sales", cols: [["SKU_ID", "sku_id"], ["Week", "week"], ["Units_Sold", "units_sold"]] },
  inventory: {
    table: "inventory",
    cols: [["SKU_ID", "sku_id"], ["Location", "location"], ["Units_On_Hand", "units_on_hand"], ["As_Of_Date", "as_of_date"]],
  },
  skuMaster: {
    table: "sku_master",
    cols: [
      ["SKU_ID", "sku_id"], ["SKU_Name", "sku_name"], ["Category", "category"], ["Perishability", "perishability"],
      ["Standard_Reorder_Qty", "standard_reorder_qty"], ["Unit_of_Measure", "unit_of_measure"], ["Distributor_ID", "distributor_id"],
    ],
  },
  calendar: {
    table: "festival_calendar",
    cols: [["Year", "year"], ["Month", "month"], ["Year_Month", "year_month"], ["Is_Festival_Month", "is_festival_month"]],
  },
  distributors: {
    table: "distributors",
    cols: [["Distributor_ID", "distributor_id"], ["Distributor_Name", "distributor_name"], ["Region", "region"], ["Status", "status"]],
  },
};
const KINDS = Object.keys(INPUTS) as FileKind[];

const quoteJson = (s: string) => `'${s.replace(/'/g, "''")}'`;

export interface BatchInput {
  source: "demo" | "upload";
  asOfDate: string | null;
  skuCount: number;
  distributorCount: number;
  rejectedRows: number;
  fileNames: Record<FileKind, string>;
  inputs: Record<FileKind, RawRow[]>;
}

/** Saves one upload (all five inputs) atomically; returns the batch id. */
export async function saveBatch(b: BatchInput): Promise<number> {
  const sql = await db();
  const params: unknown[] = [b.source, b.asOfDate, b.skuCount, b.distributorCount, b.inputs.sales.length, b.inputs.inventory.length, b.rejectedRows, JSON.stringify(b.fileNames)];
  const ctes = KINDS.map((k) => {
    params.push(JSON.stringify(b.inputs[k].map((r) => Object.fromEntries(INPUTS[k].cols.map(([h]) => [h, r[h] ?? null])))));
    const { table, cols } = INPUTS[k];
    return `${table}_ins as (
      insert into ${table} (batch_id, row_no, ${cols.map(([, c]) => c).join(", ")})
      select (select id from b), ord, ${cols.map(([h]) => `x->>${quoteJson(h)}`).join(", ")}
      from jsonb_array_elements($${params.length}::jsonb) with ordinality as t(x, ord)
    )`;
  });
  const rows = await sql.query(
    `with b as (
       insert into upload_batches (source, as_of_date, sku_count, distributor_count, sales_rows, inventory_rows, rejected_rows, file_names)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning id
     ), ${ctes.join(", ")}
     select id from b`,
    params,
  );
  return Number(rows[0].id);
}

export interface RunInput {
  batchId: number;
  runAt: string;
  upliftMode: string;
  festivalOn: boolean;
  festivalMonth: string | null;
  counts: { skus: number; reorder: number; reorderUnits: number; pause: number; hold: number; exceptions: number };
  results: {
    sku_id: string; sku_name: string; distributor_id: string; perishability: string | null;
    units_on_hand: number | null; avg_4w: number | null; avg_12w: number | null;
    expected_weekly_demand: number | null; weeks_of_cover: number | null;
    flags: string[]; action: string; qty: number; is_exception: boolean; exception_codes: string[];
    reason: string; check_note: string;
  }[];
}

/** Saves a forecast run and every SKU's result; returns the run id. */
export async function saveRun(r: RunInput): Promise<number> {
  const sql = await db();
  const arr = (f: string) => `coalesce(array(select jsonb_array_elements_text(x->'${f}')), '{}')`;
  const num = (f: string) => `(x->>'${f}')::numeric`;
  const rows = await sql.query(
    `with run as (
       insert into forecast_runs (batch_id, run_at, uplift_mode, festival_on, festival_month, sku_count, reorder_count, reorder_units, pause_count, hold_count, exception_count, ai_source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'template') returning id
     ), res as (
       insert into sku_results (run_id, sku_id, sku_name, distributor_id, perishability, units_on_hand, avg_4w, avg_12w, expected_weekly_demand, weeks_of_cover, flags, action, qty, is_exception, exception_codes, reason, check_note)
       select (select id from run), x->>'sku_id', x->>'sku_name', x->>'distributor_id', x->>'perishability',
              ${num("units_on_hand")}, ${num("avg_4w")}, ${num("avg_12w")}, ${num("expected_weekly_demand")}, ${num("weeks_of_cover")},
              ${arr("flags")}, x->>'action', (x->>'qty')::int, (x->>'is_exception')::boolean, ${arr("exception_codes")},
              x->>'reason', x->>'check_note'
       from jsonb_array_elements($12::jsonb) as t(x)
     )
     select id from run`,
    [r.batchId, r.runAt, r.upliftMode, r.festivalOn, r.festivalMonth, r.counts.skus, r.counts.reorder, r.counts.reorderUnits, r.counts.pause, r.counts.hold, r.counts.exceptions, JSON.stringify(r.results)],
  );
  return Number(rows[0].id);
}

export async function saveExplanations(runId: number, source: string, model: string | null, items: { sku: string; reason: string; check: string }[]) {
  const sql = await db();
  await sql.transaction([
    sql.query(
      `update sku_results s set reason = x->>'reason', check_note = x->>'check'
       from jsonb_array_elements($2::jsonb) as t(x)
       where s.run_id = $1 and s.sku_id = x->>'sku'`,
      [runId, JSON.stringify(items)],
    ),
    sql.query(`update forecast_runs set ai_source = $2, ai_model = $3 where id = $1`, [runId, source, model]),
  ]);
}

export async function saveDecision(d: {
  runId: number; skuId: string; decision: "approve" | "override"; originalAction: string; originalQty: number;
  finalQty: number; reason: string | null; decidedBy: string; decidedAt: string;
}) {
  const sql = await db();
  await sql.query(
    `insert into gate1_decisions (run_id, sku_id, decision, original_action, original_qty, final_qty, reason, decided_by, decided_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (run_id, sku_id) do update set decision = excluded.decision, final_qty = excluded.final_qty,
       reason = excluded.reason, decided_by = excluded.decided_by, decided_at = excluded.decided_at`,
    [d.runId, d.skuId, d.decision, d.originalAction, d.originalQty, d.finalQty, d.reason, d.decidedBy, d.decidedAt],
  );
}

/** Undo of a Gate 1 decision, only while procurement has not approved the run. */
export async function undoDecision(runId: number, skuId: string) {
  const sql = await db();
  await sql.query(
    `delete from gate1_decisions where run_id = $1 and sku_id = $2
       and not exists (select 1 from gate2_approvals where run_id = $1)`,
    [runId, skuId],
  );
}

export async function saveApproval(a: { runId: number; approvedBy: string; approvedAt: string; poLines: number; poUnits: number }) {
  const sql = await db();
  await sql.query(
    `insert into gate2_approvals (run_id, approved_by, approved_at, po_lines, po_units) values ($1, $2, $3, $4, $5)
     on conflict (run_id) do nothing`,
    [a.runId, a.approvedBy, a.approvedAt, a.poLines, a.poUnits],
  );
}

export async function saveHubspotOrders(
  runId: number,
  orders: { distributorId: string; distributorName: string; orderId: string; url: string | null; lines: number; units: number; status: string }[],
) {
  const sql = await db();
  await sql.query(
    `insert into hubspot_orders (run_id, distributor_id, distributor_name, order_id, url, line_count, units, status)
     select $1, x->>'distributorId', x->>'distributorName', x->>'orderId', x->>'url', (x->>'lines')::int, (x->>'units')::int, x->>'status'
     from jsonb_array_elements($2::jsonb) as t(x)
     on conflict (run_id, distributor_id) do update set order_id = excluded.order_id, url = excluded.url, status = excluded.status, synced_at = now()`,
    [runId, JSON.stringify(orders)],
  );
}

export async function saveSettings(values: Record<string, unknown>) {
  const sql = await db();
  const entries = Object.entries(values);
  if (!entries.length) return;
  await sql.query(
    `insert into app_settings (key, value) select key, value from jsonb_each($1::jsonb)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [JSON.stringify(Object.fromEntries(entries))],
  );
}

/** Saved runs, uploads, the cross-cycle override log and settings — no input rows. */
export async function loadHistory() {
  const sql = await db();
  const [settingsRows, history, overrides, batches] = await Promise.all([
    sql.query(`select key, value from app_settings`),
    sql.query(
      `select r.id, r.run_at, r.uplift_mode, r.festival_on, r.festival_month, r.sku_count, r.reorder_count, r.reorder_units,
              r.pause_count, r.exception_count, r.ai_source, b.id as batch_id, b.source, b.as_of_date,
              (select count(*)::int from gate1_decisions d where d.run_id = r.id) as decided,
              (select count(*)::int from gate1_decisions d where d.run_id = r.id and d.decision = 'override') as overrides,
              a.approved_by, a.approved_at, a.po_lines, a.po_units,
              (select count(*)::int from hubspot_orders h where h.run_id = r.id) as hubspot_orders
       from forecast_runs r join upload_batches b on b.id = r.batch_id
       left join gate2_approvals a on a.run_id = r.id
       order by r.id desc limit 25`,
    ),
    sql.query(
      `select d.*, r.run_at from gate1_decisions d join forecast_runs r on r.id = d.run_id
       where d.decision = 'override' order by d.decided_at desc limit 200`,
    ),
    sql.query(
      `select id, created_at, source, as_of_date, sku_count, distributor_count, sales_rows, inventory_rows, rejected_rows
       from upload_batches order by id desc limit 25`,
    ),
  ]);
  return { settings: Object.fromEntries(settingsRows.map((s) => [s.key, s.value])), history, overrides, batches };
}

/** Everything the app needs to resume where it left off. */
export async function loadState() {
  const sql = await db();
  const [[batch], { settings, history, overrides, batches }] = await Promise.all([
    sql.query(`select * from upload_batches order by id desc limit 1`),
    loadHistory(),
  ]);
  if (!batch) return { batch: null, inputs: null, run: null, settings, history, overrides, batches };

  const inputs = Object.fromEntries(
    await Promise.all(
      KINDS.map(async (k) => {
        const { table, cols } = INPUTS[k];
        const rows = await sql.query(`select ${cols.map(([, c]) => c).join(", ")} from ${table} where batch_id = $1 order by row_no`, [batch.id]);
        return [k, rows.map((r) => Object.fromEntries(cols.map(([h, c]) => [h, r[c] ?? ""]))) as RawRow[]];
      }),
    ),
  ) as Record<FileKind, RawRow[]>;

  const [run] = await sql.query(`select * from forecast_runs where batch_id = $1 order by id desc limit 1`, [batch.id]);
  if (!run) return { batch, inputs, run: null, settings, history, overrides, batches };

  const [results, decisions, approval, hubspot] = await Promise.all([
    sql.query(`select sku_id, action, qty, reason, check_note from sku_results where run_id = $1`, [run.id]),
    sql.query(`select * from gate1_decisions where run_id = $1`, [run.id]),
    sql.query(`select * from gate2_approvals where run_id = $1`, [run.id]),
    sql.query(`select * from hubspot_orders where run_id = $1 order by distributor_id`, [run.id]),
  ]);
  return { batch, inputs, run: { ...run, results, decisions, approval: approval[0] ?? null, hubspot }, settings, history, overrides, batches };
}
