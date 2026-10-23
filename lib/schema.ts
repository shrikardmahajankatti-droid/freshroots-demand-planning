/**
 * Neon Postgres schema. Idempotent: safe to run on every cold start.
 *
 * Inputs are stored exactly as uploaded (text) so any run can be reproduced —
 * validation stays in lib/rules.ts, the single source of truth. Outputs are typed.
 */
export const SCHEMA: string[] = [
  `create table if not exists upload_batches (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    source text not null check (source in ('demo', 'upload')),
    as_of_date text,
    sku_count int not null,
    distributor_count int not null,
    sales_rows int not null,
    inventory_rows int not null,
    rejected_rows int not null default 0,
    file_names jsonb not null
  )`,
  `create table if not exists weekly_sales (
    batch_id bigint not null references upload_batches(id) on delete cascade,
    row_no int not null,
    sku_id text, week text, units_sold text,
    primary key (batch_id, row_no)
  )`,
  `create table if not exists inventory (
    batch_id bigint not null references upload_batches(id) on delete cascade,
    row_no int not null,
    sku_id text, location text, units_on_hand text, as_of_date text,
    primary key (batch_id, row_no)
  )`,
  `create table if not exists sku_master (
    batch_id bigint not null references upload_batches(id) on delete cascade,
    row_no int not null,
    sku_id text, sku_name text, category text, perishability text,
    standard_reorder_qty text, unit_of_measure text, distributor_id text,
    primary key (batch_id, row_no)
  )`,
  `create table if not exists festival_calendar (
    batch_id bigint not null references upload_batches(id) on delete cascade,
    row_no int not null,
    year text, month text, year_month text, is_festival_month text,
    primary key (batch_id, row_no)
  )`,
  `create table if not exists distributors (
    batch_id bigint not null references upload_batches(id) on delete cascade,
    row_no int not null,
    distributor_id text, distributor_name text, region text, status text,
    primary key (batch_id, row_no)
  )`,
  `create table if not exists forecast_runs (
    id bigint generated always as identity primary key,
    batch_id bigint not null references upload_batches(id) on delete cascade,
    run_at timestamptz not null,
    uplift_mode text not null,
    festival_on boolean not null,
    festival_month text,
    sku_count int not null,
    reorder_count int not null,
    reorder_units int not null,
    pause_count int not null,
    hold_count int not null,
    exception_count int not null,
    ai_source text,
    ai_model text
  )`,
  `create table if not exists sku_results (
    run_id bigint not null references forecast_runs(id) on delete cascade,
    sku_id text not null,
    sku_name text, distributor_id text, perishability text,
    units_on_hand numeric, avg_4w numeric, avg_12w numeric,
    expected_weekly_demand numeric, weeks_of_cover numeric,
    flags text[] not null default '{}',
    action text not null, qty int not null,
    is_exception boolean not null, exception_codes text[] not null default '{}',
    reason text, check_note text,
    primary key (run_id, sku_id)
  )`,
  `create table if not exists gate1_decisions (
    run_id bigint not null references forecast_runs(id) on delete cascade,
    sku_id text not null,
    decision text not null check (decision in ('approve', 'override')),
    original_action text not null, original_qty int not null,
    final_qty int not null, reason text,
    decided_by text not null, decided_at timestamptz not null,
    primary key (run_id, sku_id)
  )`,
  `create table if not exists gate2_approvals (
    run_id bigint primary key references forecast_runs(id) on delete cascade,
    approved_by text not null,
    approved_at timestamptz not null,
    po_lines int not null,
    po_units int not null
  )`,
  `create table if not exists hubspot_orders (
    run_id bigint not null references forecast_runs(id) on delete cascade,
    distributor_id text not null,
    distributor_name text, order_id text not null, url text,
    line_count int not null, units int not null, status text not null,
    synced_at timestamptz not null default now(),
    primary key (run_id, distributor_id)
  )`,
  `create table if not exists app_settings (
    key text primary key,
    value jsonb not null,
    updated_at timestamptz not null default now()
  )`,
  `create index if not exists forecast_runs_batch_idx on forecast_runs (batch_id, id desc)`,
];
