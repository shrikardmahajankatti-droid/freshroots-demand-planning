"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { ArrowRight, CheckCircle2, Download, FileSpreadsheet, Loader2, TriangleAlert, UploadCloud, X } from "lucide-react";
import { Button, Callout, Chip } from "@/components/ui";
import { FILE_LABEL, KINDS, useWs } from "@/components/workspace";
import { parseUploads, type LoadedFile, type UploadItem } from "@/lib/csv";
import { parseIsoWeek, type FileKind } from "@/lib/rules";

/** One-line description of an input's contents, for the before/after comparison. */
function describe(f: LoadedFile | undefined): string {
  if (!f || f.error) return "—";
  if (f.kind === "sales") {
    const weeks = f.rows.map((r) => parseIsoWeek(r.Week)).filter((w) => w !== null).sort((a, b) => a!.key - b!.key);
    const skus = new Set(f.rows.map((r) => r.SKU_ID)).size;
    return weeks.length ? `${weeks[0]!.label.slice(5)}–${weeks[weeks.length - 1]!.label.slice(5)} · ${skus} SKUs` : `${f.rows.length} rows`;
  }
  if (f.kind === "inventory") {
    const dates = f.rows.map((r) => r.As_Of_Date ?? "").filter(Boolean).sort();
    return `as of ${dates[dates.length - 1] ?? "?"} · ${f.rows.length} rows`;
  }
  return `${f.rows.length} rows`;
}

export function UploadDialog() {
  const ws = useWs();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const open = ws.uploadOpen;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && ws.setUploadOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, ws]);

  useEffect(() => {
    if (!open) {
      setItems([]);
      setOver(false);
    }
  }, [open]);

  async function add(files: FileList | File[] | null) {
    if (!files || !files.length) return;
    setBusy(true);
    const parsed = await parseUploads([...files]);
    setItems((prev) => [...prev, ...parsed]);
    setBusy(false);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    add(e.dataTransfer.files);
  }

  // Later files win when two match the same input.
  const winner = new Map<FileKind, number>();
  items.forEach((it, i) => it.loaded && !it.loaded.error && winner.set(it.loaded.kind, i));
  const incoming = new Map<FileKind, LoadedFile>([...winner].map(([k, i]) => [k, items[i].loaded!]));
  const after = (k: FileKind) => incoming.get(k) ?? (ws.files[k]?.error ? undefined : ws.files[k]);
  const complete = KINDS.every((k) => after(k));
  const inProgress = !!ws.run && (Object.keys(ws.decisions).length > 0 || !!ws.g2);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={() => ws.setUploadOpen(false)}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
      onDrop={onDrop}
      role="dialog"
      aria-modal="true"
      aria-label="Upload new data"
    >
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Upload new data</h2>
            <p className="mt-0.5 text-sm text-slate-500">Drop this week&apos;s sales and stock, or all five inputs at once. CSV or Excel (.xlsx); every sheet in a workbook is checked.</p>
          </div>
          <button onClick={() => ws.setUploadOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Drop zone */}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={`flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
              over ? "border-emerald-500 bg-emerald-50" : "border-slate-300 bg-slate-50/60 hover:border-emerald-400 hover:bg-emerald-50/40"
            }`}
          >
            {busy ? <Loader2 className="h-8 w-8 animate-spin text-emerald-600" /> : <UploadCloud className={`h-8 w-8 ${over ? "text-emerald-600" : "text-slate-400"}`} />}
            <p className="mt-3 text-sm font-semibold text-slate-800">{busy ? "Reading files…" : over ? "Drop to add" : "Drag files here, or click to browse"}</p>
            <p className="mt-1 text-xs text-slate-500">Any file names, any order — each file is matched to an input by its column headers.</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => {
                add(e.target.files);
                e.target.value = "";
              }}
            />
          </button>
          <p className="-mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <a href="/demo/freshroots_inputs.xlsx" download className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline" onClick={(e) => e.stopPropagation()}>
              <Download className="h-3.5 w-3.5" /> Excel template (all 5 sheets)
            </a>
            <a href="/demo/sample_next_week.xlsx" download className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline" onClick={(e) => e.stopPropagation()}>
              <Download className="h-3.5 w-3.5" /> Sample next-week file (W43 sales + stock)
            </a>
            <span>Columns must match the template headers exactly.</span>
          </p>

          {/* Detected files */}
          {items.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Files read · {items.length}</h3>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {items.map((it, i) => {
                  const kind = it.loaded && !it.loaded.error ? it.loaded.kind : null;
                  const superseded = kind !== null && winner.get(kind) !== i;
                  return (
                    <li key={`${it.label}-${i}`} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                      <FileSpreadsheet className={`h-4 w-4 shrink-0 ${/\.xlsx$/i.test(it.fileName) ? "text-emerald-600" : "text-sky-600"}`} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{it.label}</p>
                        <p className={`text-xs ${it.problem ? "text-red-700" : "text-slate-500"}`}>{it.problem ?? `${it.rowCount} rows`}</p>
                      </div>
                      {kind && !superseded && (
                        <span className="flex items-center gap-1.5 text-xs text-slate-500">
                          <ArrowRight className="h-3.5 w-3.5" />
                          <Chip tone="green" dot>{FILE_LABEL[kind]}</Chip>
                        </span>
                      )}
                      {superseded && <Chip tone="slate">Replaced by a later file</Chip>}
                      {!kind && <Chip tone="red" dot>Ignored</Chip>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Result per input */}
          {items.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Inputs after upload</h3>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Input</th>
                      <th className="px-3 py-2 font-semibold">Now</th>
                      <th className="px-3 py-2 font-semibold">After</th>
                      <th className="px-3 py-2 font-semibold" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {KINDS.map((k) => {
                      const next = incoming.get(k);
                      return (
                        <tr key={k}>
                          <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">{FILE_LABEL[k]}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{describe(ws.files[k])}</td>
                          <td className={`whitespace-nowrap px-3 py-2 text-xs ${next ? "font-semibold text-emerald-800" : "text-slate-500"}`}>{next ? describe(next) : describe(after(k))}</td>
                          <td className="px-3 py-2 text-right">
                            {next ? <Chip tone="green">New</Chip> : after(k) ? <Chip>Kept</Chip> : <Chip tone="red">Missing</Chip>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!complete && <Callout tone="red">All five inputs are needed to run. Add the missing file(s) above.</Callout>}
              {complete && inProgress && (
                <Callout tone="amber">Re-running starts a new cycle: Raghav&apos;s decisions{ws.g2 ? ", the procurement approval" : ""} and this cycle&apos;s PO status are cleared. HubSpot orders already created stay in HubSpot.</Callout>
              )}
            </section>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            {incoming.size > 0 ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> {incoming.size} of 5 inputs will be replaced; the rest are kept.
              </>
            ) : items.length > 0 ? (
              <>
                <TriangleAlert className="h-3.5 w-3.5 text-amber-600" /> No file matched an input yet.
              </>
            ) : (
              "Nothing changes until you apply."
            )}
          </p>
          <div className="flex gap-2">
            {items.length > 0 && (
              <Button variant="ghost" size="md" onClick={() => setItems([])}>Clear</Button>
            )}
            <Button size="md" disabled={!incoming.size || !complete || busy} onClick={() => ws.applyUploads(items.filter((it, i) => it.loaded && winner.get(it.loaded.kind) === i))}>
              Apply &amp; re-run forecast
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
