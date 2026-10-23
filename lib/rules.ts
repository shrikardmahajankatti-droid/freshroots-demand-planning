/**
 * Freshroots demand-planning rules (Rules v1).
 *
 * Pure module: no UI, no AI, no I/O. Everything here is deterministic so the
 * same inputs always produce the same flags, actions and quantities.
 *
 * Fixed rule order per SKU:
 *   R5 windows -> R1 festival uplift -> R2 high demand -> R3 stockout -> R4 overstock
 *   -> action logic -> exception detection
 */

export type RawRow = Record<string, string | undefined>;

export type FileKind = "sales" | "inventory" | "skuMaster" | "calendar" | "distributors";

export const REQUIRED_HEADERS: Record<FileKind, string[]> = {
  sales: ["SKU_ID", "Week", "Units_Sold"],
  inventory: ["SKU_ID", "Location", "Units_On_Hand", "As_Of_Date"],
  skuMaster: [
    "SKU_ID",
    "SKU_Name",
    "Category",
    "Perishability",
    "Standard_Reorder_Qty",
    "Unit_of_Measure",
    "Distributor_ID",
  ],
  calendar: ["Year", "Month", "Year_Month", "Is_Festival_Month"],
  distributors: ["Distributor_ID", "Distributor_Name", "Region", "Status"],
};

export const FILE_NAMES: Record<FileKind, string> = {
  sales: "weekly_sales.csv",
  inventory: "current_inventory.csv",
  skuMaster: "sku_master.csv",
  calendar: "calendar.csv",
  distributors: "distributor_master.csv",
};

/** Returns the required headers missing from `fields` (trimmed, case-sensitive). */
export function missingHeaders(kind: FileKind, fields: string[]): string[] {
  const have = new Set(fields.map((f) => f.trim()));
  return REQUIRED_HEADERS[kind].filter((h) => !have.has(h));
}

export interface KindMatch {
  /** The input this sheet is, or null when no input's headers all match. */
  kind: FileKind | null;
  /** Closest input by share of required headers present. */
  closest: FileKind;
  missing: string[];
}

/**
 * Works out which of the 5 inputs a sheet is from its headers alone, so files can be
 * dropped in any order with any name. Ties go to the input with more required columns.
 */
export function detectKind(fields: string[]): KindMatch {
  const kinds = Object.keys(REQUIRED_HEADERS) as FileKind[];
  const scored = kinds
    .map((k) => {
      const missing = missingHeaders(k, fields);
      const need = REQUIRED_HEADERS[k].length;
      return { k, missing, score: (need - missing.length) / need, need };
    })
    .sort((x, y) => y.score - x.score || y.need - x.need);
  const best = scored[0];
  return { kind: best.missing.length === 0 ? best.k : null, closest: best.k, missing: best.missing };
}

/** Turns a spreadsheet cell into the string a CSV would have held. */
export function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    const utc = v.getUTCHours() === 0 && v.getUTCMinutes() === 0;
    const y = utc ? v.getUTCFullYear() : v.getFullYear();
    const m = (utc ? v.getUTCMonth() : v.getMonth()) + 1;
    const d = utc ? v.getUTCDate() : v.getDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(+v.toFixed(10));
  return String(v).trim();
}

/** Converts a sheet's rows (first non-empty row = headers) into CSV-like records. */
export function sheetToRecords(data: unknown[][]): { fields: string[]; rows: RawRow[] } {
  const nonEmpty = (r: unknown[]) => r.some((c) => cellToString(c) !== "");
  const start = data.findIndex(nonEmpty);
  if (start < 0) return { fields: [], rows: [] };
  const fields = data[start].map((c) => cellToString(c).replace(/^\uFEFF/, ""));
  const rows: RawRow[] = [];
  for (const r of data.slice(start + 1)) {
    if (!nonEmpty(r)) continue;
    const rec: RawRow = {};
    fields.forEach((f, i) => {
      if (f) rec[f] = cellToString(r[i]);
    });
    rows.push(rec);
  }
  return { fields: fields.filter(Boolean), rows };
}

// ---------------------------------------------------------------------------
// Rules v1 constants
// ---------------------------------------------------------------------------

export const RULES = {
  festivalUplift: 1.25, // R1
  highDemandRatio: 1.2, // R2
  windows: {
    High: { min: 3, max: 4 }, // R5
    Low: { min: 6, max: 14 },
  },
  shortWindow: 4,
  longWindow: 12,
  swingThreshold: 0.3, // exception: any WoW change > 30% in last 4 transitions
  swingTransitions: 4,
  highDemandQtyMultiplier: 1.5,
} as const;

export type Perishability = "High" | "Low";
export type Flag = "HIGH_DEMAND" | "STOCKOUT" | "OVERSTOCK";
export type Action = "REORDER_NOW" | "REORDER_1.5X" | "PAUSE" | "HOLD";
export type ExceptionCode = "NEW_LAUNCH" | "SWING" | "CONFLICT" | "DATA";
export type UpliftMode = "auto" | "on" | "off";

// ---------------------------------------------------------------------------
// ISO week helpers
// ---------------------------------------------------------------------------

export interface IsoWeek {
  year: number;
  week: number;
  /** Sortable numeric key: year * 100 + week. */
  key: number;
  label: string;
}

/** Number of ISO weeks in a year (52 or 53). */
export function isoWeeksInYear(year: number): number {
  // Dec 28 is always in the last ISO week of its year.
  const d = new Date(Date.UTC(year, 11, 28));
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of that week
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7;
  const week1Thu = new Date(jan4);
  week1Thu.setUTCDate(jan4.getUTCDate() - jan4Day + 3);
  return 1 + Math.round((d.getTime() - week1Thu.getTime()) / (7 * 86400000));
}

/** Parses "2026-W27" (also tolerates "2026-W7"). Returns null when invalid. */
export function parseIsoWeek(s: string | undefined): IsoWeek | null {
  if (!s) return null;
  const m = /^(\d{4})-W(\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > isoWeeksInYear(year)) return null;
  return { year, week, key: year * 100 + week, label: `${year}-W${String(week).padStart(2, "0")}` };
}

/** Thursday of the ISO week (UTC) — the date that decides the week's month. */
export function isoWeekThursday(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7;
  const d = new Date(jan4);
  d.setUTCDate(jan4.getUTCDate() - jan4Day + 3 + (week - 1) * 7);
  return d;
}

/** "YYYY-MM" for the month that contains the ISO week's Thursday. */
export function isoWeekMonth(w: IsoWeek): string {
  const d = isoWeekThursday(w.year, w.week);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Parsing & joining
// ---------------------------------------------------------------------------

export interface RawInputs {
  sales: RawRow[];
  inventory: RawRow[];
  skuMaster: RawRow[];
  calendar: RawRow[];
  distributors: RawRow[];
}

export interface RejectedRow {
  file: FileKind;
  /** 1-based data row number (header excluded). */
  row: number;
  skuId?: string;
  reason: string;
}

export interface WeekSale {
  week: IsoWeek;
  units: number;
}

export interface SkuMasterRecord {
  skuId: string;
  name: string;
  category: string;
  perishability: Perishability | null;
  standardReorderQty: number | null;
  uom: string;
  distributorId: string;
}

export interface DistributorRecord {
  id: string;
  name: string;
  region: string;
  status: string;
}

export interface SkuData {
  skuId: string;
  master: SkuMasterRecord | null;
  distributor: DistributorRecord | null;
  /** Sorted ascending by ISO week. */
  sales: WeekSale[];
  unitsOnHand: number | null;
  locations: string[];
  /** Human-readable data problems for this SKU (missing/invalid required fields). */
  dataIssues: string[];
}

export interface Dataset {
  skus: SkuData[];
  asOfDate: string | null;
  /** "YYYY-MM" of the inventory as-of date. */
  asOfMonth: string | null;
  festivalMonths: Set<string>;
  calendarMonths: Set<string>;
  rejected: RejectedRow[];
  warnings: string[];
}

const s = (v: string | undefined) => (v ?? "").trim();

function parseNonNegInt(v: string | undefined): number | null {
  const t = s(v);
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseIsoDate(v: string | undefined): string | null {
  const t = s(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t ? null : t;
}

function parseBool(v: string | undefined): boolean | null {
  const t = s(v).toUpperCase();
  if (t === "TRUE") return true;
  if (t === "FALSE") return false;
  return null;
}

/** Joins the five files on SKU_ID (distributor via sku_master.Distributor_ID). */
export function buildDataset(raw: RawInputs): Dataset {
  const rejected: RejectedRow[] = [];
  const warnings: string[] = [];
  const issues = new Map<string, string[]>();
  const addIssue = (sku: string, msg: string) => {
    if (!issues.has(sku)) issues.set(sku, []);
    issues.get(sku)!.push(msg);
  };

  // Distributors
  const distributors = new Map<string, DistributorRecord>();
  raw.distributors.forEach((r, i) => {
    const id = s(r.Distributor_ID);
    if (!id) {
      rejected.push({ file: "distributors", row: i + 1, reason: "Missing Distributor_ID" });
      return;
    }
    distributors.set(id, {
      id,
      name: s(r.Distributor_Name),
      region: s(r.Region),
      status: s(r.Status),
    });
  });

  // Calendar
  const festivalMonths = new Set<string>();
  const calendarMonths = new Set<string>();
  raw.calendar.forEach((r, i) => {
    const ym = s(r.Year_Month);
    const fest = parseBool(r.Is_Festival_Month);
    if (!/^\d{4}-\d{2}$/.test(ym)) {
      rejected.push({ file: "calendar", row: i + 1, reason: `Invalid Year_Month "${ym}"` });
      return;
    }
    if (fest === null) {
      rejected.push({
        file: "calendar",
        row: i + 1,
        reason: `Is_Festival_Month must be TRUE/FALSE (got "${s(r.Is_Festival_Month)}")`,
      });
      return;
    }
    calendarMonths.add(ym);
    if (fest) festivalMonths.add(ym);
  });

  // SKU master
  const masters = new Map<string, SkuMasterRecord>();
  raw.skuMaster.forEach((r, i) => {
    const skuId = s(r.SKU_ID);
    if (!skuId) {
      rejected.push({ file: "skuMaster", row: i + 1, reason: "Missing SKU_ID" });
      return;
    }
    if (masters.has(skuId)) {
      rejected.push({ file: "skuMaster", row: i + 1, skuId, reason: "Duplicate SKU_ID" });
      return;
    }
    const per = s(r.Perishability);
    const perishability: Perishability | null = per === "High" || per === "Low" ? per : null;
    if (!perishability) addIssue(skuId, `Perishability must be High/Low (got "${per}")`);
    const qty = parseNonNegInt(r.Standard_Reorder_Qty);
    if (qty === null || qty === 0)
      addIssue(skuId, `Standard_Reorder_Qty missing or invalid ("${s(r.Standard_Reorder_Qty)}")`);
    const name = s(r.SKU_Name);
    if (!name) addIssue(skuId, "SKU_Name missing");
    const distributorId = s(r.Distributor_ID);
    if (!distributorId) addIssue(skuId, "Distributor_ID missing");
    else if (!distributors.has(distributorId))
      addIssue(skuId, `Distributor ${distributorId} not in distributor_master`);
    masters.set(skuId, {
      skuId,
      name,
      category: s(r.Category),
      perishability,
      standardReorderQty: qty && qty > 0 ? qty : null,
      uom: s(r.Unit_of_Measure),
      distributorId,
    });
  });

  // Sales
  const sales = new Map<string, Map<number, WeekSale>>();
  raw.sales.forEach((r, i) => {
    const skuId = s(r.SKU_ID);
    const row = i + 1;
    if (!skuId) {
      rejected.push({ file: "sales", row, reason: "Missing SKU_ID" });
      return;
    }
    const week = parseIsoWeek(r.Week);
    if (!week) {
      rejected.push({ file: "sales", row, skuId, reason: `Invalid ISO week "${s(r.Week)}"` });
      addIssue(skuId, `Sales row ${row}: invalid week`);
      return;
    }
    const units = parseNonNegInt(r.Units_Sold);
    if (units === null) {
      rejected.push({
        file: "sales",
        row,
        skuId,
        reason: `Units_Sold missing or invalid ("${s(r.Units_Sold)}")`,
      });
      addIssue(skuId, `Sales ${week.label}: Units_Sold missing or invalid`);
      return;
    }
    if (!sales.has(skuId)) sales.set(skuId, new Map());
    const m = sales.get(skuId)!;
    if (m.has(week.key)) {
      rejected.push({ file: "sales", row, skuId, reason: `Duplicate week ${week.label}` });
      addIssue(skuId, `Duplicate sales row for ${week.label}`);
      return;
    }
    m.set(week.key, { week, units });
  });

  // Inventory (multiple locations per SKU are summed)
  const onHand = new Map<string, { units: number; locations: string[] }>();
  const dates = new Set<string>();
  raw.inventory.forEach((r, i) => {
    const skuId = s(r.SKU_ID);
    const row = i + 1;
    if (!skuId) {
      rejected.push({ file: "inventory", row, reason: "Missing SKU_ID" });
      return;
    }
    const units = parseNonNegInt(r.Units_On_Hand);
    if (units === null) {
      rejected.push({
        file: "inventory",
        row,
        skuId,
        reason: `Units_On_Hand missing or invalid ("${s(r.Units_On_Hand)}")`,
      });
      addIssue(skuId, "Units_On_Hand missing or invalid");
      return;
    }
    const date = parseIsoDate(r.As_Of_Date);
    if (!date) {
      rejected.push({
        file: "inventory",
        row,
        skuId,
        reason: `As_Of_Date invalid ("${s(r.As_Of_Date)}"), expected YYYY-MM-DD`,
      });
      addIssue(skuId, "As_Of_Date invalid");
      return;
    }
    dates.add(date);
    const cur = onHand.get(skuId) ?? { units: 0, locations: [] };
    cur.units += units;
    cur.locations.push(s(r.Location));
    onHand.set(skuId, cur);
  });

  const sortedDates = [...dates].sort();
  const asOfDate = sortedDates.length ? sortedDates[sortedDates.length - 1] : null;
  if (sortedDates.length > 1)
    warnings.push(
      `Inventory has ${sortedDates.length} different As_Of_Dates (${sortedDates.join(", ")}); using the latest, ${asOfDate}.`,
    );
  const asOfMonth = asOfDate ? asOfDate.slice(0, 7) : null;
  if (asOfMonth && !calendarMonths.has(asOfMonth))
    warnings.push(`As-of month ${asOfMonth} is not in calendar.csv; festival uplift treated as OFF.`);

  const allIds = new Set<string>([...masters.keys(), ...sales.keys(), ...onHand.keys()]);
  const skus: SkuData[] = [...allIds].sort().map((skuId) => {
    const master = masters.get(skuId) ?? null;
    if (!master) addIssue(skuId, "Not found in sku_master");
    const inv = onHand.get(skuId);
    if (!inv && !(issues.get(skuId) ?? []).some((x) => x.startsWith("Units_On_Hand") || x.startsWith("As_Of")))
      addIssue(skuId, "No row in current_inventory");
    const weekly = [...(sales.get(skuId)?.values() ?? [])].sort((a, b) => a.week.key - b.week.key);
    if (weekly.length === 0) addIssue(skuId, "No sales history");
    return {
      skuId,
      master,
      distributor: master ? distributors.get(master.distributorId) ?? null : null,
      sales: weekly,
      unitsOnHand: inv ? inv.units : null,
      locations: inv?.locations ?? [],
      dataIssues: issues.get(skuId) ?? [],
    };
  });

  return { skus, asOfDate, asOfMonth, festivalMonths, calendarMonths, rejected, warnings };
}

// ---------------------------------------------------------------------------
// Processing (Box 4)
// ---------------------------------------------------------------------------

export interface FestivalStatus {
  on: boolean;
  month: string | null;
  mode: UpliftMode;
  /** What the calendar says, regardless of a what-if override. */
  calendarSays: boolean;
}

export function festivalStatus(ds: Pick<Dataset, "asOfMonth" | "festivalMonths">, mode: UpliftMode = "auto"): FestivalStatus {
  const calendarSays = !!ds.asOfMonth && ds.festivalMonths.has(ds.asOfMonth);
  const on = mode === "auto" ? calendarSays : mode === "on";
  return { on, month: ds.asOfMonth, mode, calendarSays };
}

export interface SkuResult {
  skuId: string;
  name: string;
  category: string;
  distributorId: string;
  distributorName: string;
  perishability: Perishability | null;
  standardReorderQty: number | null;
  unitsOnHand: number | null;
  weeksOfHistory: number;
  avg4w: number | null;
  avg12w: number | null;
  expectedWeeklyDemand: number | null;
  weeksOfCover: number | null;
  minWindow: number | null;
  maxWindow: number | null;
  /** Signed % change (0.4 = +40%) with the largest magnitude over the last 4 transitions. */
  maxWowChange: number | null;
  maxWowLabel: string | null;
  flags: Flag[];
  action: Action;
  qty: number;
  isException: boolean;
  exceptionCodes: ExceptionCode[];
  exceptionNotes: string[];
  dataIssues: string[];
  /** Last 16 weeks for charting. */
  history: { week: string; units: number; festival: boolean }[];
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Max-magnitude week-on-week change over the last `n` transitions. */
export function maxWowChange(sales: WeekSale[], n: number = RULES.swingTransitions): { change: number; label: string } | null {
  const tail = sales.slice(-(n + 1));
  let best: { change: number; label: string } | null = null;
  for (let i = 1; i < tail.length; i++) {
    const prev = tail[i - 1].units;
    const cur = tail[i].units;
    const change = prev === 0 ? (cur === 0 ? 0 : Infinity) : (cur - prev) / prev;
    if (!best || Math.abs(change) > Math.abs(best.change))
      best = { change, label: `${tail[i - 1].week.label}→${tail[i].week.label}` };
  }
  return best;
}

/** Action logic from the flags. Returns HOLD for the uncovered HIGH_DEMAND+OVERSTOCK conflict. */
export function decideAction(flags: Flag[], stdQty: number): { action: Action; qty: number } {
  const hi = flags.includes("HIGH_DEMAND");
  const so = flags.includes("STOCKOUT");
  const os = flags.includes("OVERSTOCK");
  const big = Math.ceil(RULES.highDemandQtyMultiplier * stdQty);
  if (so && hi) return { action: "REORDER_NOW", qty: big };
  if (so) return { action: "REORDER_NOW", qty: Math.ceil(stdQty) };
  if (hi && !os) return { action: "REORDER_1.5X", qty: big };
  if (os && !hi) return { action: "PAUSE", qty: 0 };
  return { action: "HOLD", qty: 0 };
}

export function evaluateSku(sku: SkuData, fest: FestivalStatus, festivalMonths: Set<string>): SkuResult {
  const m = sku.master;
  const perishability = m?.perishability ?? null;
  const stdQty = m?.standardReorderQty ?? null;
  const units = sku.sales.map((x) => x.units);

  // R5 windows
  const win = perishability ? RULES.windows[perishability] : null;

  // Averages
  const avg4w = mean(units.slice(-RULES.shortWindow));
  const avg12w = mean(units.slice(-RULES.longWindow));

  // R1 festival uplift (applied before any threshold)
  const expected = avg12w === null ? null : avg12w * (fest.on ? RULES.festivalUplift : 1);

  // Weeks of cover (on-hand only; no open-PO data)
  const dataIssues = [...sku.dataIssues];
  let cover: number | null = null;
  if (sku.unitsOnHand !== null && expected !== null) {
    if (expected > 0) cover = sku.unitsOnHand / expected;
    else dataIssues.push("Expected weekly demand is 0; weeks of cover undefined");
  }

  const flags: Flag[] = [];
  // R2 high demand (raw averages, no uplift)
  if (avg4w !== null && avg12w !== null && avg4w > avg12w * RULES.highDemandRatio) flags.push("HIGH_DEMAND");
  // R3 / R4
  if (cover !== null && win) {
    if (cover < win.min) flags.push("STOCKOUT");
    if (cover > win.max) flags.push("OVERSTOCK");
  }

  // Action. Missing data blocks the action — never guess.
  const blocked = dataIssues.length > 0 || stdQty === null || cover === null || !win;
  const { action, qty } = blocked ? { action: "HOLD" as Action, qty: 0 } : decideAction(flags, stdQty);

  // Exceptions (Box 5 trigger, decided in code)
  const exceptionCodes: ExceptionCode[] = [];
  const exceptionNotes: string[] = [];
  if (sku.sales.length < RULES.longWindow) {
    exceptionCodes.push("NEW_LAUNCH");
    exceptionNotes.push(`Only ${sku.sales.length} week(s) of history (< ${RULES.longWindow})`);
  }
  const wow = maxWowChange(sku.sales);
  if (wow && Math.abs(wow.change) > RULES.swingThreshold) {
    exceptionCodes.push("SWING");
    exceptionNotes.push(
      `Week-on-week swing ${formatPct(wow.change)} (${wow.label}) exceeds ±${RULES.swingThreshold * 100}%`,
    );
  }
  if (flags.includes("OVERSTOCK") && (flags.includes("HIGH_DEMAND") || flags.includes("STOCKOUT"))) {
    exceptionCodes.push("CONFLICT");
    exceptionNotes.push(`Conflicting flags: ${flags.join(" + ")}`);
  }
  if (dataIssues.length) {
    exceptionCodes.push("DATA");
    exceptionNotes.push(`Missing/invalid data: ${dataIssues.join("; ")}`);
  }

  return {
    skuId: sku.skuId,
    name: m?.name ?? "",
    category: m?.category ?? "",
    distributorId: m?.distributorId ?? "",
    distributorName: sku.distributor?.name ?? "",
    perishability,
    standardReorderQty: stdQty,
    unitsOnHand: sku.unitsOnHand,
    weeksOfHistory: sku.sales.length,
    avg4w,
    avg12w,
    expectedWeeklyDemand: expected,
    weeksOfCover: cover,
    minWindow: win?.min ?? null,
    maxWindow: win?.max ?? null,
    maxWowChange: wow?.change ?? null,
    maxWowLabel: wow?.label ?? null,
    flags,
    action,
    qty,
    isException: exceptionCodes.length > 0,
    exceptionCodes,
    exceptionNotes,
    dataIssues,
    history: sku.sales.slice(-16).map((x) => ({
      week: x.week.label,
      units: x.units,
      festival: festivalMonths.has(isoWeekMonth(x.week)),
    })),
  };
}

export interface RunResult {
  rows: SkuResult[];
  festival: FestivalStatus;
  summary: RunSummary;
}

export interface RunSummary {
  skus: number;
  flagCounts: Record<Flag, number>;
  actionCounts: Record<Action, number>;
  exceptions: number;
  reorderUnits: number;
}

export function runRules(ds: Dataset, mode: UpliftMode = "auto"): RunResult {
  const festival = festivalStatus(ds, mode);
  const rows = ds.skus.map((sku) => evaluateSku(sku, festival, ds.festivalMonths));
  return { rows, festival, summary: summarize(rows) };
}

export function summarize(rows: SkuResult[]): RunSummary {
  const flagCounts: Record<Flag, number> = { HIGH_DEMAND: 0, STOCKOUT: 0, OVERSTOCK: 0 };
  const actionCounts: Record<Action, number> = { REORDER_NOW: 0, "REORDER_1.5X": 0, PAUSE: 0, HOLD: 0 };
  let reorderUnits = 0;
  for (const r of rows) {
    r.flags.forEach((f) => flagCounts[f]++);
    actionCounts[r.action]++;
    if (isReorder(r.action)) reorderUnits += r.qty;
  }
  return {
    skus: rows.length,
    flagCounts,
    actionCounts,
    exceptions: rows.filter((r) => r.isException).length,
    reorderUnits,
  };
}

export const isReorder = (a: string) => a.startsWith("REORDER");

// ---------------------------------------------------------------------------
// Load summary (Box 2)
// ---------------------------------------------------------------------------

export interface LoadSummary {
  skusLoaded: number;
  salesRows: number;
  inventoryRows: number;
  weeksPerSku: { skuId: string; weeks: number; first: string | null; last: string | null }[];
  asOfDate: string | null;
  rejected: RejectedRow[];
  warnings: string[];
}

export function loadSummary(ds: Dataset, raw: Pick<RawInputs, "sales" | "inventory">): LoadSummary {
  return {
    skusLoaded: ds.skus.length,
    salesRows: raw.sales.length,
    inventoryRows: raw.inventory.length,
    weeksPerSku: ds.skus.map((k) => ({
      skuId: k.skuId,
      weeks: k.sales.length,
      first: k.sales[0]?.week.label ?? null,
      last: k.sales[k.sales.length - 1]?.week.label ?? null,
    })),
    asOfDate: ds.asOfDate,
    rejected: ds.rejected,
    warnings: ds.warnings,
  };
}

// ---------------------------------------------------------------------------
// Explanations: AI payload + template fallback (Box 5)
// ---------------------------------------------------------------------------

export interface Explanation {
  sku: string;
  reason: string;
  check: string;
}

export const fmt = (n: number | null, dp = 1) => (n === null || !Number.isFinite(n) ? "n/a" : n.toFixed(dp));
export const formatPct = (x: number) =>
  Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%` : "from zero";

/** Compact per-SKU payload sent to /api/explain. */
export function explainPayload(r: SkuResult, fest: FestivalStatus) {
  return {
    sku: r.skuId,
    name: r.name,
    perishability: r.perishability,
    history: r.history.map((h) => `${h.week}:${h.units}`).join(","),
    weeks_of_history: r.weeksOfHistory,
    stock_on_hand: r.unitsOnHand,
    avg_4w: r.avg4w === null ? null : +r.avg4w.toFixed(1),
    avg_12w: r.avg12w === null ? null : +r.avg12w.toFixed(1),
    festival_uplift: fest.on ? `ON (${fest.month}, x${RULES.festivalUplift})` : "OFF",
    expected_weekly_demand: r.expectedWeeklyDemand === null ? null : +r.expectedWeeklyDemand.toFixed(1),
    weeks_of_cover: r.weeksOfCover === null ? null : +r.weeksOfCover.toFixed(2),
    window: r.minWindow === null ? null : `${r.minWindow}-${r.maxWindow} weeks`,
    max_wow_change: r.maxWowChange === null ? null : `${formatPct(r.maxWowChange)} (${r.maxWowLabel})`,
    flags: r.flags,
    action: r.action,
    qty: r.qty,
    exception: r.isException,
    exception_triggers: r.exceptionNotes,
  };
}

/** Deterministic reason used when the AI is unavailable or returns invalid JSON. */
export function templateExplanation(r: SkuResult, fest: FestivalStatus): Explanation {
  const cover = fmt(r.weeksOfCover, 2);
  const win = r.minWindow === null ? "unknown window" : `${r.minWindow}–${r.maxWindow} wk window`;
  const exp = fmt(r.expectedWeeklyDemand);
  const upl = fest.on ? ` (12-wk avg ${fmt(r.avg12w)} × ${RULES.festivalUplift} festival uplift)` : "";
  let reason: string;
  if (r.dataIssues.length) {
    reason = `Data missing or invalid: ${r.dataIssues.join("; ")}. No recommendation made.`;
  } else {
    switch (r.action) {
      case "REORDER_NOW":
        reason = `${cover} weeks of cover vs ${win} at ${exp}/wk expected${upl}${
          r.flags.includes("HIGH_DEMAND") ? `; 4-wk avg ${fmt(r.avg4w)} is >20% above 12-wk avg` : ""
        } → reorder ${r.qty}.`;
        break;
      case "REORDER_1.5X":
        reason = `4-wk avg ${fmt(r.avg4w)} is >20% above 12-wk avg ${fmt(r.avg12w)}; cover ${cover} wks is within ${win} → reorder 1.5× (${r.qty}).`;
        break;
      case "PAUSE":
        reason = `${cover} weeks of cover exceeds ${win} max at ${exp}/wk expected${upl} → pause reorders.`;
        break;
      default:
        reason = r.flags.length
          ? `Flags ${r.flags.join(" + ")} conflict; no automatic action — planner to decide.`
          : `${cover} weeks of cover is inside the ${win} at ${exp}/wk expected → hold.`;
    }
  }
  let check = "";
  if (r.isException) {
    const checks: string[] = [];
    if (r.exceptionCodes.includes("NEW_LAUNCH"))
      checks.push(`Only ${r.weeksOfHistory} weeks of history — confirm launch plan / expected run-rate`);
    if (r.exceptionCodes.includes("SWING"))
      checks.push(`Verify the ${formatPct(r.maxWowChange ?? 0)} swing (${r.maxWowLabel}) with ${r.distributorName || r.distributorId || "the distributor"} — one-off order or sustained?`);
    if (r.exceptionCodes.includes("CONFLICT")) checks.push("Flags conflict — check stock count and recent promotions");
    if (r.exceptionCodes.includes("DATA")) checks.push("Fix the source data before ordering");
    check = checks.map((c) => (/[.?!]$/.test(c) ? c : `${c}.`)).join(" ");
    if (!r.dataIssues.length) reason = `${r.exceptionNotes.join("; ")}. Rule result: ${reason}`;
  }
  return { sku: r.skuId, reason, check };
}

/**
 * Validates an AI reply against the SKUs that were sent. Returns a map keyed by SKU,
 * or null if the JSON is unusable. Missing SKUs simply fall back to templates.
 */
export function validateExplanations(raw: unknown, skuIds: string[]): Map<string, Explanation> | null {
  if (!Array.isArray(raw)) return null;
  const want = new Set(skuIds);
  const out = new Map<string, Explanation>();
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    if (typeof o.sku !== "string" || typeof o.reason !== "string") return null;
    if (o.check !== undefined && typeof o.check !== "string") return null;
    if (!want.has(o.sku) || !o.reason.trim()) continue;
    out.set(o.sku, { sku: o.sku, reason: o.reason.trim(), check: ((o.check as string) ?? "").trim() });
  }
  return out.size ? out : null;
}

/** Pulls the first JSON array out of a model reply (tolerates ```json fences). */
export function extractJsonArray(text: string): unknown {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Human gates & feedback loop (Boxes 7, 8)
// ---------------------------------------------------------------------------

export interface Decision {
  type: "approve" | "override";
  qty?: number;
  reason?: string;
  at: string;
}

export interface FinalRow {
  skuId: string;
  name: string;
  distributorId: string;
  action: string;
  qty: number;
  overridden: boolean;
}

export function validateOverride(qty: string, reason: string): string | null {
  if (!/^\d+$/.test(qty.trim())) return "Enter a whole-number quantity ≥ 0.";
  if (!reason.trim()) return "A written reason is required.";
  return null;
}

/**
 * Final action/qty after Gate 1. An override to qty > 0 on a non-reorder row becomes
 * REORDER_OVERRIDE so it reaches procurement; an override to 0 removes it from the PO.
 */
export function finalRow(r: SkuResult, d: Decision | undefined): FinalRow {
  const base = { skuId: r.skuId, name: r.name, distributorId: r.distributorId };
  if (d?.type === "override" && d.qty !== undefined) {
    const action = isReorder(r.action) ? r.action : d.qty > 0 ? "REORDER_OVERRIDE" : r.action;
    return { ...base, action, qty: d.qty, overridden: true };
  }
  return { ...base, action: r.action, qty: r.qty, overridden: false };
}

export function gate1Progress(rows: SkuResult[], decisions: Record<string, Decision>) {
  const exceptions = rows.filter((r) => r.isException);
  const resolved = exceptions.filter((r) => decisions[r.skuId]).length;
  return { resolved, total: exceptions.length, complete: resolved === exceptions.length };
}

export function poRows(rows: SkuResult[], decisions: Record<string, Decision>): FinalRow[] {
  return rows.map((r) => finalRow(r, decisions[r.skuId])).filter((f) => isReorder(f.action) && f.qty > 0);
}

export const KILL_CRITERION_OVERRIDE_RATE = 0.3;

export function overrideStats(rows: SkuResult[], decisions: Record<string, Decision>) {
  const resolved = rows.filter((r) => r.isException && decisions[r.skuId]);
  const overrides = resolved.filter((r) => decisions[r.skuId].type === "override").length;
  const n = resolved.length;
  const overrideRate = n ? overrides / n : 0;
  return {
    resolved: n,
    overrides,
    approvals: n - overrides,
    overrideRate,
    acceptanceRate: n ? (n - overrides) / n : 0,
    killCriterion: n > 0 && overrideRate > KILL_CRITERION_OVERRIDE_RATE,
  };
}

// ---------------------------------------------------------------------------
// CSV output
// ---------------------------------------------------------------------------

function csvCell(v: unknown): string {
  const t = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// PO calendar: when to order what (projection, not a decision)
// ---------------------------------------------------------------------------

export const DEFAULT_LEAD_DAYS = 7;
const DAY_MS = 86_400_000;

/** Adds days to a YYYY-MM-DD date (UTC). */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
}

/** First scheduled forecast run (Monday or Thursday) on or after `iso`. */
export function nextRunOnOrAfter(iso: string): string {
  for (let i = 0; i < 7; i++) {
    const d = addDays(iso, i);
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow === 1 || dow === 4) return d;
  }
  return iso;
}

export type PlanKind = "order" | "stockout" | "resume";
export type PlanStatus = "overdue" | "due" | "upcoming";

export interface PlanEvent {
  date: string;
  kind: PlanKind;
  skuId: string;
  name: string;
  distributorId: string;
  action: Action;
  qty: number;
  /** True for reorders already in this cycle's PO. */
  inCurrentPo: boolean;
  note: string;
  status: PlanStatus;
}

/**
 * Projects, per SKU, when to place the next PO, when stock would run out and when an
 * overstock clears — assuming demand stays at today's expected weekly demand.
 * The rules engine still decides every actual order; this only schedules.
 */
export function planCalendar(
  rows: SkuResult[],
  asOf: string,
  opts: { today: string; leadDays?: number; horizonDays?: number },
): PlanEvent[] {
  const lead = Math.max(0, Math.round(opts.leadDays ?? DEFAULT_LEAD_DAYS));
  const horizon = opts.horizonDays ?? 120;
  const end = addDays(opts.today, horizon);
  const status = (date: string): PlanStatus => {
    const d = diffDays(date, opts.today);
    return d < 0 ? "overdue" : d <= 7 ? "due" : "upcoming";
  };
  const out: PlanEvent[] = [];

  for (const r of rows) {
    if (r.weeksOfCover === null || r.minWindow === null || r.maxWindow === null || !r.standardReorderQty || r.dataIssues.length) continue;
    const base = { skuId: r.skuId, name: r.name, distributorId: r.distributorId, action: r.action };

    const stockout = addDays(asOf, Math.floor(r.weeksOfCover * 7));
    if (stockout <= end)
      out.push({ ...base, kind: "stockout", date: stockout, qty: 0, inCurrentPo: false, note: `Stock runs out at ${fmt(r.expectedWeeklyDemand)}/wk if nothing arrives`, status: status(stockout) });

    if (isReorder(r.action)) {
      out.push({ ...base, kind: "order", date: asOf, qty: r.qty, inCurrentPo: true, note: "In this cycle's PO — needs both approvals", status: status(asOf) });
    } else {
      const qty = Math.ceil(r.standardReorderQty * (r.flags.includes("HIGH_DEMAND") ? RULES.highDemandQtyMultiplier : 1));
      const projected = addDays(asOf, Math.floor((r.weeksOfCover - r.minWindow) * 7) - lead);
      const late = projected < opts.today;
      const date = late ? nextRunOnOrAfter(opts.today) : projected;
      if (date <= end)
        out.push({
          ...base,
          kind: "order",
          date,
          qty,
          inCurrentPo: false,
          note: late
            ? `Cover reaches the ${r.minWindow}-wk minimum within the ${lead}-day lead time — expect a reorder at this run`
            : `Order ${lead} days before cover falls below ${r.minWindow} wks`,
          status: late ? "due" : status(date),
        });
    }

    if (r.action === "PAUSE") {
      const resume = addDays(asOf, Math.floor((r.weeksOfCover - r.maxWindow) * 7));
      if (resume <= end)
        out.push({ ...base, kind: "resume", date: resume, qty: 0, inCurrentPo: false, note: `Cover falls back to the ${r.maxWindow}-wk maximum — reorders can resume`, status: status(resume) });
    }
  }
  const order: Record<PlanKind, number> = { order: 0, stockout: 1, resume: 2 };
  return out.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind] || a.skuId.localeCompare(b.skuId));
}

/** All-day iCalendar (.ics) feed for the order and resume events. */
export function toIcs(events: PlanEvent[], stamp: string): string {
  const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/[,;]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
  const d = (iso: string) => iso.replace(/-/g, "");
  const dt = stamp.replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Freshroots//Demand Planner//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Freshroots PO calendar"];
  for (const e of events.filter((x) => x.kind !== "stockout")) {
    const summary = e.kind === "order" ? `Order ${e.name} (${e.qty} units)` : `Resume reorders: ${e.name}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.kind}-${e.skuId}-${d(e.date)}@freshroots`,
      `DTSTAMP:${dt}`,
      `DTSTART;VALUE=DATE:${d(e.date)}`,
      `DTEND;VALUE=DATE:${d(addDays(e.date, 1))}`,
      `SUMMARY:${esc(summary)}`,
      `DESCRIPTION:${esc(`${e.skuId} · ${e.distributorId} · ${e.note}`)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
