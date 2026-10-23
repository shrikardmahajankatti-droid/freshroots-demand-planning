import { NextResponse } from "next/server";
import {
  dbConfigured,
  loadHistory,
  loadState,
  saveApproval,
  saveBatch,
  saveDecision,
  saveExplanations,
  saveHubspotOrders,
  saveRun,
  saveSettings,
  undoDecision,
} from "@/lib/db";

// Neon persistence. GET restores the latest workspace; POST {op, ...} records each step.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const off = () => NextResponse.json({ configured: false });
const bad = (error: string) => NextResponse.json({ ok: false, error }, { status: 400 });
const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const isStr = (v: unknown, max = 500): v is string => typeof v === "string" && v.length <= max;

export async function GET(req: Request) {
  if (!dbConfigured()) return off();
  try {
    const view = new URL(req.url).searchParams.get("view");
    return NextResponse.json({ configured: true, ok: true, ...(view === "history" ? await loadHistory() : await loadState()) });
  } catch (e) {
    console.error("db GET failed", e);
    return NextResponse.json({ configured: true, ok: false, error: "Could not read from Neon." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!dbConfigured()) return off();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || !isStr(body.op, 40)) return bad("Missing op.");
  try {
    switch (body.op) {
      case "saveBatch": {
        const b = body.batch;
        if (!b || !["demo", "upload"].includes(b.source) || !b.inputs || !b.fileNames) return bad("Invalid batch.");
        const total = Object.values(b.inputs as Record<string, unknown[]>).reduce((a, r) => a + (Array.isArray(r) ? r.length : 0), 0);
        if (total > 200_000) return bad("Batch too large.");
        return NextResponse.json({ ok: true, batchId: await saveBatch(b) });
      }
      case "saveRun": {
        const r = body.run;
        if (!r || !isId(r.batchId) || !isStr(r.runAt, 40) || !Array.isArray(r.results) || r.results.length > 5000) return bad("Invalid run.");
        return NextResponse.json({ ok: true, runId: await saveRun(r) });
      }
      case "saveExplanations":
        if (!isId(body.runId) || !Array.isArray(body.items) || !isStr(body.source, 20)) return bad("Invalid explanations.");
        await saveExplanations(body.runId, body.source, isStr(body.model, 80) ? body.model : null, body.items);
        return NextResponse.json({ ok: true });
      case "decide": {
        const d = body.decision;
        if (!d || !isId(d.runId) || !isStr(d.skuId, 40) || !["approve", "override"].includes(d.decision) || !Number.isInteger(d.finalQty) || d.finalQty < 0)
          return bad("Invalid decision.");
        if (d.decision === "override" && !(isStr(d.reason, 1000) && d.reason.trim())) return bad("Override needs a reason.");
        await saveDecision(d);
        return NextResponse.json({ ok: true });
      }
      case "undo":
        if (!isId(body.runId) || !isStr(body.skuId, 40)) return bad("Invalid undo.");
        await undoDecision(body.runId, body.skuId);
        return NextResponse.json({ ok: true });
      case "approve": {
        const a = body.approval;
        if (!a || !isId(a.runId) || !isStr(a.approvedBy, 80) || !a.approvedBy.trim()) return bad("Invalid approval.");
        await saveApproval(a);
        return NextResponse.json({ ok: true });
      }
      case "hubspot":
        if (!isId(body.runId) || !Array.isArray(body.orders) || body.orders.length > 50) return bad("Invalid orders.");
        await saveHubspotOrders(body.runId, body.orders);
        return NextResponse.json({ ok: true });
      case "settings": {
        const s = body.settings;
        if (!s || typeof s !== "object") return bad("Invalid settings.");
        const allowed = ["leadDays", "plannerName", "approverName", "upliftMode"];
        await saveSettings(Object.fromEntries(Object.entries(s).filter(([k]) => allowed.includes(k))));
        return NextResponse.json({ ok: true });
      }
      default:
        return bad("Unknown op.");
    }
  } catch (e) {
    console.error(`db ${body.op} failed`, e);
    return NextResponse.json({ ok: false, error: "Could not save to Neon." }, { status: 500 });
  }
}
