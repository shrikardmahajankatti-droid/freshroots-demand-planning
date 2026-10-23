import { NextResponse } from "next/server";

// BOX 8 · GATE 2 → HubSpot. Runs only after procurement approves.
// Creates one HubSpot Order per distributor, with each SKU as a line item.
// Server-only: the private-app token never reaches the browser.

export const runtime = "nodejs";

const API = "https://api.hubapi.com";
const ORDER_TYPE_ID = "0-123"; // HubSpot's object type id for Orders (record URLs)
const REQUIRED_SCOPES = [
  "crm.objects.orders.read",
  "crm.objects.orders.write",
  "crm.pipelines.orders.read",
  "crm.objects.line_items.read",
  "crm.objects.line_items.write",
];

interface PoLine {
  skuId: string;
  name: string;
  qty: number;
  action: string;
}
interface PoOrder {
  distributorId: string;
  distributorName: string;
  lines: PoLine[];
}
interface Body {
  cycle: string;
  runAt: string;
  approvedBy: string;
  orders: PoOrder[];
}

interface HubspotResult {
  distributorId: string;
  distributorName: string;
  orderId: string;
  url: string | null;
  lines: number;
  units: number;
  status: "created" | "existing";
}

class HubspotError extends Error {
  constructor(
    message: string,
    public status: number,
    public missingScopes: string[] = [],
  ) {
    super(message);
  }
}

const str = (v: unknown, max = 200) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** Strict shape check — this route writes to a real CRM. */
function parseBody(raw: unknown): Body | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  if (!str(b.cycle, 60) || !str(b.runAt, 40) || !str(b.approvedBy, 80) || !Array.isArray(b.orders)) return null;
  if (b.orders.length === 0 || b.orders.length > 50) return null;
  let total = 0;
  for (const o of b.orders as unknown[]) {
    const order = o as Record<string, unknown>;
    if (!order || !str(order.distributorId, 40) || !str(order.distributorName, 120) || !Array.isArray(order.lines) || order.lines.length === 0) return null;
    for (const l of order.lines as unknown[]) {
      const line = l as Record<string, unknown>;
      if (!line || !str(line.skuId, 40) || !str(line.name, 160) || !str(line.action, 40)) return null;
      if (typeof line.qty !== "number" || !Number.isInteger(line.qty) || line.qty < 1 || line.qty > 1_000_000) return null;
      total++;
    }
  }
  if (total > 500) return null;
  return raw as Body;
}

async function hs<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const scopes: string[] = data?.errors?.[0]?.context?.requiredGranularScopes ?? [];
    const msg = data?.category === "MISSING_SCOPES" ? "HubSpot token is missing scopes" : (data?.message as string) || `HubSpot error ${res.status}`;
    throw new HubspotError(msg, res.status, scopes);
  }
  return data as T;
}

export async function POST(req: Request) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token)
    return NextResponse.json({ ok: false, configured: false, error: "HubSpot is not connected (no HUBSPOT_ACCESS_TOKEN). The PO CSV is still available." });

  const body = parseBody(await req.json().catch(() => null));
  if (!body) return NextResponse.json({ ok: false, configured: true, error: "Invalid PO payload." }, { status: 400 });

  try {
    // Orders must sit in a pipeline stage: use the first stage of the first orders pipeline.
    const pipelines = await hs<{ results: { id: string; stages: { id: string; displayOrder: number }[] }[] }>(token, "/crm/v3/pipelines/orders");
    const pipeline = pipelines.results?.[0];
    const stage = pipeline?.stages?.slice().sort((a, b) => a.displayOrder - b.displayOrder)[0];
    if (!pipeline || !stage) throw new HubspotError("No orders pipeline found in HubSpot.", 404);

    const portalId = await hs<{ portalId: number }>(token, "/account-info/v3/details")
      .then((d) => d.portalId)
      .catch(() => null);

    const runKey = body.runAt.replace(/\D/g, "").slice(0, 14);
    const results: HubspotResult[] = [];

    for (const o of body.orders) {
      const externalId = `FR-${runKey}-${o.distributorId}`;
      const units = o.lines.reduce((a, l) => a + l.qty, 0);

      // Idempotent: a retry finds the order created by an earlier attempt.
      const existing = await hs<{ results: { id: string }[] }>(token, "/crm/v3/objects/orders/search", {
        method: "POST",
        body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: "hs_external_order_id", operator: "EQ", value: externalId }] }], limit: 1 }),
      });
      let orderId = existing.results?.[0]?.id;
      let status: HubspotResult["status"] = "existing";

      if (!orderId) {
        const order = await hs<{ id: string }>(token, "/crm/v3/objects/orders", {
          method: "POST",
          body: JSON.stringify({
            properties: {
              hs_order_name: `PO · ${o.distributorName} · ${body.cycle}`,
              hs_external_order_id: externalId,
              hs_currency_code: "INR",
              hs_pipeline: pipeline.id,
              hs_pipeline_stage: stage.id,
            },
          }),
        });
        orderId = order.id;
        status = "created";

        const items = await hs<{ results: { id: string }[] }>(token, "/crm/v3/objects/line_items/batch/create", {
          method: "POST",
          body: JSON.stringify({
            inputs: o.lines.map((l) => ({
              properties: { name: `${l.name} (${l.skuId})`, hs_sku: l.skuId, quantity: String(l.qty), description: `${l.action} · approved by ${body.approvedBy}` },
            })),
          }),
        });
        await hs(token, "/crm/v4/associations/orders/line_items/batch/associate/default", {
          method: "POST",
          body: JSON.stringify({ inputs: items.results.map((li) => ({ from: { id: orderId }, to: { id: li.id } })) }),
        });
      }

      results.push({
        distributorId: o.distributorId,
        distributorName: o.distributorName,
        orderId: orderId!,
        url: portalId ? `https://app.hubspot.com/contacts/${portalId}/record/${ORDER_TYPE_ID}/${orderId}` : null,
        lines: o.lines.length,
        units,
        status,
      });
    }
    return NextResponse.json({ ok: true, configured: true, results });
  } catch (e) {
    if (e instanceof HubspotError)
      return NextResponse.json({
        ok: false,
        configured: true,
        error: e.message,
        missingScopes: e.missingScopes.length ? REQUIRED_SCOPES : [],
      });
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    return NextResponse.json({ ok: false, configured: true, error: timedOut ? "HubSpot timed out." : "Could not reach HubSpot." });
  }
}
