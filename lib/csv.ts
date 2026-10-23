import Papa from "papaparse";
import { FILE_NAMES, REQUIRED_HEADERS, detectKind, missingHeaders, sheetToRecords, type FileKind, type RawRow } from "./rules";

export interface LoadedFile {
  kind: FileKind;
  fileName: string;
  rows: RawRow[];
  fields: string[];
  error: string | null;
}

/** Validates already-parsed rows for `kind` (used for uploads and for data restored from Neon). */
export function validate(kind: FileKind, fileName: string, fields: string[], rows: RawRow[]): LoadedFile {
  const missing = missingHeaders(kind, fields);
  let error: string | null = null;
  if (!fields.length) error = `File is empty or not a CSV (expected ${FILE_NAMES[kind]}).`;
  else if (missing.length)
    error = `Not a valid ${FILE_NAMES[kind]}: missing column(s) ${missing.join(", ")}. Found: ${fields.join(", ")}.`;
  else if (!rows.length) error = "No data rows.";
  return { kind, fileName, rows: error ? [] : rows, fields, error };
}

function csvRecords(text: string): { fields: string[]; rows: RawRow[] } {
  const res = Papa.parse<RawRow>(text.replace(/\r\n?/g, "\n"), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.replace(/^﻿/, "").trim(),
  });
  return { fields: res.meta.fields ?? [], rows: res.data };
}

/** Parses CSV text in the browser and validates the headers for `kind`. */
export function parseCsv(kind: FileKind, fileName: string, text: string): LoadedFile {
  const { fields, rows } = csvRecords(text);
  return validate(kind, fileName, fields, rows);
}

/** One sheet (or CSV) from an upload, matched to an input by its headers. */
export interface UploadItem {
  /** File name, plus " › Sheet" for workbook sheets. */
  label: string;
  fileName: string;
  sheet: string | null;
  fields: string[];
  rowCount: number;
  /** Validated input when the headers match one; null when unrecognised or unreadable. */
  loaded: LoadedFile | null;
  problem: string | null;
}

const isExcel = (f: File) => /\.xlsx$/i.test(f.name) || f.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const isCsv = (f: File) => /\.csv$/i.test(f.name) || f.type === "text/csv";

function toItem(fileName: string, sheet: string | null, fields: string[], rows: RawRow[]): UploadItem {
  const label = sheet ? `${fileName} › ${sheet}` : fileName;
  const base = { label, fileName, sheet, fields, rowCount: rows.length };
  if (!fields.length) return { ...base, loaded: null, problem: "Empty — no header row found." };
  const m = detectKind(fields);
  if (!m.kind)
    return {
      ...base,
      loaded: null,
      problem:
        m.missing.length === REQUIRED_HEADERS[m.closest].length
          ? `Not recognised — none of the expected columns found (got ${fields.slice(0, 6).join(", ")}).`
          : `Not recognised. Closest is ${FILE_NAMES[m.closest]}, missing ${m.missing.join(", ")}.`,
    };
  const loaded = validate(m.kind, label, fields, rows);
  return { ...base, loaded, problem: loaded.error };
}

/**
 * Reads any number of dropped files. CSVs are one input each; every sheet of an
 * .xlsx workbook is checked, so one workbook can carry all five inputs.
 */
export async function parseUploads(files: File[]): Promise<UploadItem[]> {
  const out: UploadItem[] = [];
  for (const f of files) {
    try {
      if (isExcel(f)) {
        const { default: readXlsxFile } = await import("read-excel-file/browser");
        const sheets = await readXlsxFile(f);
        const before = out.length;
        for (const s of sheets) {
          const { fields, rows } = sheetToRecords(s.data as unknown[][]);
          if (!fields.length && !rows.length) continue; // skip blank sheets silently
          out.push(toItem(f.name, s.sheet, fields, rows));
        }
        if (out.length === before) out.push({ label: f.name, fileName: f.name, sheet: null, fields: [], rowCount: 0, loaded: null, problem: "Workbook has no data." });
      } else if (isCsv(f)) {
        const { fields, rows } = csvRecords(await f.text());
        out.push(toItem(f.name, null, fields, rows));
      } else {
        out.push({ label: f.name, fileName: f.name, sheet: null, fields: [], rowCount: 0, loaded: null, problem: /\.xls$/i.test(f.name) ? "Old .xls format — save as .xlsx or .csv." : "Not a CSV or .xlsx file." });
      }
    } catch {
      out.push({ label: f.name, fileName: f.name, sheet: null, fields: [], rowCount: 0, loaded: null, problem: "Could not read this file. Is it a valid .xlsx or .csv?" });
    }
  }
  return out;
}

export function downloadCsv(fileName: string, csv: string, type = fileName.endsWith(".ics") ? "text/calendar;charset=utf-8" : "text/csv;charset=utf-8") {
  const blob = new Blob([csv], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
