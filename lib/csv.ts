import Papa from "papaparse";
import { FILE_NAMES, missingHeaders, type FileKind, type RawRow } from "./rules";

export interface LoadedFile {
  kind: FileKind;
  fileName: string;
  rows: RawRow[];
  fields: string[];
  error: string | null;
}

/** Parses CSV text in the browser and validates the headers for `kind`. */
export function parseCsv(kind: FileKind, fileName: string, text: string): LoadedFile {
  const res = Papa.parse<RawRow>(text.replace(/\r\n?/g, "\n"), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.replace(/^﻿/, "").trim(),
  });
  const fields = res.meta.fields ?? [];
  const missing = missingHeaders(kind, fields);
  let error: string | null = null;
  if (!fields.length) error = `File is empty or not a CSV (expected ${FILE_NAMES[kind]}).`;
  else if (missing.length)
    error = `Not a valid ${FILE_NAMES[kind]}: missing column(s) ${missing.join(", ")}. Found: ${fields.join(", ")}.`;
  else if (!res.data.length) error = "No data rows.";
  return { kind, fileName, rows: error ? [] : res.data, fields, error };
}

export function downloadCsv(fileName: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
