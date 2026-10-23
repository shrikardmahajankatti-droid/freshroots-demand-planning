import { readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import readXlsxFile from "read-excel-file/node";
import {
  buildDataset,
  decideAction,
  extractJsonArray,
  cellToString,
  detectKind,
  missingHeaders,
  sheetToRecords,
  nextRunOnOrAfter,
  planCalendar,
  toIcs,
  overrideStats,
  parseIsoWeek,
  poRows,
  runRules,
  templateExplanation,
  validateExplanations,
  type RawInputs,
  type SkuResult,
} from "../lib/rules";

function load(dir: string): RawInputs {
  const read = (f: string) =>
    Papa.parse<Record<string, string>>(readFileSync(join(dir, f), "utf8"), {
      header: true,
      skipEmptyLines: true,
    }).data;
  return {
    sales: read("weekly_sales.csv"),
    inventory: read("current_inventory.csv"),
    skuMaster: read("sku_master.csv"),
    calendar: read("calendar.csv"),
    distributors: read("distributor_master.csv"),
  };
}

const real = load(join(__dirname, "fixtures"));
const demo = load(join(__dirname, "..", "public", "demo"));

const byId = (rows: SkuResult[]) => Object.fromEntries(rows.map((r) => [r.skuId, r]));
const run = runRules(buildDataset(real));
const rows = byId(run.rows);

describe("acceptance — real uploaded data (Oct 2026 festival, uplift ON)", () => {
  it("detects festival uplift from the inventory as-of month", () => {
    expect(run.festival.on).toBe(true);
    expect(run.festival.month).toBe("2026-10");
  });

  it("SKU001: HIGH_DEMAND + STOCKOUT → REORDER_NOW 750, exception (W38→W39 +40%)", () => {
    const r = rows.SKU001;
    expect(r.avg4w!.toFixed(1)).toBe("261.0");
    expect(r.avg12w!.toFixed(1)).toBe("214.9");
    expect(r.weeksOfCover!).toBeCloseTo(3.35, 2);
    expect(r.flags.sort()).toEqual(["HIGH_DEMAND", "STOCKOUT"]);
    expect(r.action).toBe("REORDER_NOW");
    expect(r.qty).toBe(750);
    expect(r.isException).toBe(true);
    expect(r.exceptionCodes).toContain("SWING");
    expect(r.maxWowLabel).toBe("2026-W38→2026-W39");
    expect(Math.round(r.maxWowChange! * 100)).toBe(40);
  });

  it.each([
    ["SKU003", 4.36, 300],
    ["SKU004", 1.8, 150],
    ["SKU011", 1.8, 500],
    ["SKU013", 3.17, 120],
  ])("%s: cover ≈ %s → STOCKOUT → REORDER_NOW %s", (id, cover, qty) => {
    const r = rows[id];
    expect(r.weeksOfCover!).toBeCloseTo(cover, 2);
    expect(r.flags).toEqual(["STOCKOUT"]);
    expect(r.action).toBe("REORDER_NOW");
    expect(r.qty).toBe(qty);
  });

  it.each([
    ["SKU006", 22.23],
    ["SKU007", 4.08],
  ])("%s: cover ≈ %s → OVERSTOCK → PAUSE", (id, cover) => {
    const r = rows[id];
    expect(r.weeksOfCover!).toBeCloseTo(cover, 2);
    expect(r.flags).toEqual(["OVERSTOCK"]);
    expect(r.action).toBe("PAUSE");
    expect(r.qty).toBe(0);
  });

  it.each(["SKU002", "SKU005", "SKU008", "SKU009", "SKU010", "SKU012", "SKU014", "SKU015"])(
    "%s → HOLD",
    (id) => {
      expect(rows[id].flags).toEqual([]);
      expect(rows[id].action).toBe("HOLD");
      expect(rows[id].qty).toBe(0);
    },
  );

  it("only SKU001 is an exception in the real data", () => {
    expect(run.rows.filter((r) => r.isException).map((r) => r.skuId)).toEqual(["SKU001"]);
  });

  it("uplift OFF: SKU007 cover ≈ 5.10, still PAUSE", () => {
    const off = byId(runRules(buildDataset(real), "off").rows);
    expect(off.SKU007.weeksOfCover!).toBeCloseTo(5.1, 2);
    expect(off.SKU007.expectedWeeklyDemand).toBeCloseTo(121.5, 5);
    expect(off.SKU007.action).toBe("PAUSE");
  });

  it("uplift toggle: OFF changes expected demand but not R2 (raw averages)", () => {
    const off = byId(runRules(buildDataset(real), "off").rows);
    expect(off.SKU001.expectedWeeklyDemand! * 1.25).toBeCloseTo(rows.SKU001.expectedWeeklyDemand!, 6);
    expect(off.SKU001.flags).toContain("HIGH_DEMAND");
  });
});

describe("demo data — SKU016 new launch", () => {
  const d = byId(runRules(buildDataset(demo)).rows);
  it("SKU016 is an exception (new launch, 6 weeks)", () => {
    expect(d.SKU016.weeksOfHistory).toBe(6);
    expect(d.SKU016.isException).toBe(true);
    expect(d.SKU016.exceptionCodes).toContain("NEW_LAUNCH");
  });
  it("other SKUs unchanged by the extra row", () => {
    expect(d.SKU001.qty).toBe(750);
    expect(d.SKU006.action).toBe("PAUSE");
  });
});

describe("helpers", () => {
  it("sorts ISO weeks numerically, not as text", () => {
    const ds = buildDataset({
      ...real,
      sales: [
        { SKU_ID: "SKU002", Week: "2026-W10", Units_Sold: "1" },
        { SKU_ID: "SKU002", Week: "2026-W9", Units_Sold: "2" },
        { SKU_ID: "SKU002", Week: "2025-W52", Units_Sold: "3" },
      ],
    });
    expect(ds.skus.find((s) => s.skuId === "SKU002")!.sales.map((x) => x.week.label)).toEqual([
      "2025-W52",
      "2026-W09",
      "2026-W10",
    ]);
    expect(parseIsoWeek("2026-W54")).toBeNull();
  });

  it("rejects bad rows and makes missing data an exception, never a guess", () => {
    const ds = buildDataset({
      ...real,
      sales: [...real.sales, { SKU_ID: "SKU002", Week: "2026-W43", Units_Sold: "abc" }],
      inventory: real.inventory.filter((r) => r.SKU_ID !== "SKU005"),
    });
    expect(ds.rejected).toHaveLength(1);
    const r = byId(runRules(ds).rows);
    expect(r.SKU002.exceptionCodes).toContain("DATA");
    expect(r.SKU005.exceptionCodes).toContain("DATA");
    expect(r.SKU005.weeksOfCover).toBeNull();
    expect(r.SKU005.action).toBe("HOLD");
  });

  it("action table", () => {
    expect(decideAction(["HIGH_DEMAND", "STOCKOUT"], 101)).toEqual({ action: "REORDER_NOW", qty: 152 });
    expect(decideAction(["STOCKOUT"], 100)).toEqual({ action: "REORDER_NOW", qty: 100 });
    expect(decideAction(["HIGH_DEMAND"], 100)).toEqual({ action: "REORDER_1.5X", qty: 150 });
    expect(decideAction(["OVERSTOCK"], 100)).toEqual({ action: "PAUSE", qty: 0 });
    expect(decideAction(["HIGH_DEMAND", "OVERSTOCK"], 100)).toEqual({ action: "HOLD", qty: 0 });
    expect(decideAction([], 100)).toEqual({ action: "HOLD", qty: 0 });
  });

  it("validates headers", () => {
    expect(missingHeaders("sales", ["SKU_ID", "Week"])).toEqual(["Units_Sold"]);
    expect(missingHeaders("calendar", ["Year", "Month", "Year_Month", "Is_Festival_Month"])).toEqual([]);
  });

  it("validates AI JSON and falls back on garbage", () => {
    expect(validateExplanations(extractJsonArray("not json"), ["SKU001"])).toBeNull();
    expect(validateExplanations([{ sku: "SKU001", qty: 5 }], ["SKU001"])).toBeNull();
    const ok = validateExplanations(
      extractJsonArray('```json\n[{"sku":"SKU001","reason":"r","check":"c"},{"sku":"X","reason":"y"}]\n```'),
      ["SKU001"],
    );
    expect(ok!.get("SKU001")).toEqual({ sku: "SKU001", reason: "r", check: "c" });
    expect(ok!.has("X")).toBe(false);
    const t = templateExplanation(rows.SKU001, run.festival);
    expect(t.reason).toContain("3.35");
    expect(t.check).not.toBe("");
  });

  it("PO list and override stats", () => {
    const now = new Date().toISOString();
    expect(poRows(run.rows, {}).map((r) => r.skuId)).toEqual(["SKU001", "SKU003", "SKU004", "SKU011", "SKU013"]);
    const dec = { SKU001: { type: "override" as const, qty: 0, reason: "dup order", at: now } };
    expect(poRows(run.rows, dec).map((r) => r.skuId)).not.toContain("SKU001");
    const st = overrideStats(run.rows, dec);
    expect(st.overrideRate).toBe(1);
    expect(st.killCriterion).toBe(true);
  });
});

describe("PO calendar", () => {
  const plan = planCalendar(run.rows, "2026-10-19", { today: "2026-10-23", leadDays: 7 });
  const find = (sku: string, kind: string) => plan.find((e) => e.skuId === sku && e.kind === kind);

  it("reorders in this PO are scheduled on the as-of date", () => {
    expect(find("SKU001", "order")).toMatchObject({ date: "2026-10-19", qty: 750, inCurrentPo: true });
    expect(find("SKU001", "stockout")?.date).toBe("2026-11-11"); // 3.35 wks
  });
  it("HOLD SKU orders 7 days before cover hits the min window", () => {
    expect(find("SKU002", "order")).toMatchObject({ date: "2026-11-19", qty: 200, status: "upcoming" });
  });
  it("a past order-by date moves to the next Mon/Thu run, never earlier", () => {
    expect(find("SKU008", "order")).toMatchObject({ date: "2026-10-26", status: "due" });
    expect(nextRunOnOrAfter("2026-10-22")).toBe("2026-10-22");
  });
  it("paused SKUs get a resume date and a future order date", () => {
    expect(find("SKU006", "resume")?.date).toBe("2026-12-15");
    expect(find("SKU006", "order")?.date).toBe("2027-02-02");
    expect(find("SKU006", "stockout")).toBeUndefined(); // beyond 120-day horizon
  });
  it("lead time 0 shifts order dates", () => {
    const p0 = planCalendar(run.rows, "2026-10-19", { today: "2026-10-23", leadDays: 0 });
    expect(p0.find((e) => e.skuId === "SKU002" && e.kind === "order")?.date).toBe("2026-11-26");
  });
  it("exports an .ics feed of order and resume events", () => {
    const ics = toIcs(plan, "2026-10-23T09:00:00.000Z");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261119");
    expect(ics).not.toContain("stockout-");
  });
});

describe("uploads: header matching and Excel", () => {
  it("matches each input by its headers, in any order and with extra columns", () => {
    expect(detectKind(["Units_Sold", "Week", "SKU_ID"]).kind).toBe("sales");
    expect(detectKind(["SKU_ID", "Location", "Units_On_Hand", "As_Of_Date", "Notes"]).kind).toBe("inventory");
    expect(detectKind(["Distributor_ID", "Distributor_Name", "Region", "Status"]).kind).toBe("distributors");
    const miss = detectKind(["SKU_ID", "Week"]);
    expect(miss.kind).toBeNull();
    expect(miss.closest).toBe("sales");
    expect(miss.missing).toEqual(["Units_Sold"]);
  });

  it("normalises spreadsheet cells to CSV-style strings", () => {
    expect(cellToString(new Date(Date.UTC(2026, 9, 19)))).toBe("2026-10-19");
    expect(cellToString(true)).toBe("TRUE");
    expect(cellToString(261)).toBe("261");
    expect(cellToString(null)).toBe("");
    expect(sheetToRecords([[], ["SKU_ID", "Week", "Units_Sold"], ["SKU001", "2026-W27", 194], [null, null, null]])).toEqual({
      fields: ["SKU_ID", "Week", "Units_Sold"],
      rows: [{ SKU_ID: "SKU001", Week: "2026-W27", Units_Sold: "194" }],
    });
  });

  it("a 5-sheet workbook gives the same results as the CSVs", async () => {
    const sheets = await readXlsxFile(join(__dirname, "fixtures", "freshroots_inputs.xlsx"));
    expect(sheets).toHaveLength(5);
    const inputs: Partial<RawInputs> = {};
    for (const sh of sheets) {
      const { fields, rows } = sheetToRecords(sh.data as unknown[][]);
      const k = detectKind(fields).kind;
      expect(k).not.toBeNull();
      inputs[k!] = rows;
    }
    const fromXlsx = byId(runRules(buildDataset(inputs as RawInputs)).rows);
    for (const id of Object.keys(rows)) {
      expect(fromXlsx[id].action).toBe(rows[id].action);
      expect(fromXlsx[id].qty).toBe(rows[id].qty);
      expect(fromXlsx[id].weeksOfCover).toBeCloseTo(rows[id].weeksOfCover!, 6);
    }
    expect(fromXlsx.SKU001.qty).toBe(750);
  });
});
