import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { extractJsonArray, validateExplanations } from "@/lib/rules";

// BOX 5 · AI LAYER — server-only. The API key never reaches the browser.
// Claude explains and flags; it never sets or edits a quantity.

export const runtime = "nodejs";

const SYSTEM_PROMPT =
  'You are a demand-planning assistant for Freshroots. You do NOT set quantities; code does. For each SKU you receive its history, stock, weeks of cover, flags, action and exception status. If exception=true, give one line on why it is unusual and one line on what the planner should check. Otherwise give one line explaining the rule-based recommendation using the real numbers. Never change a quantity. Never invent data; if data is missing, say so. Reply ONLY with JSON: [{"sku":"","reason":"","check":""}]';

const DEFAULT_MODEL = "claude-sonnet-5-5";
// Models that accept the server-side refusal fallback in its "default" form.
const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"]);

type Fail = { ok: false; source: "template"; error: string };
const fail = (error: string) => NextResponse.json<Fail>({ ok: false, source: "template", error });

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail("Free mode: no ANTHROPIC_API_KEY set, so no paid API is called. Reasons come from built-in templates.");

  let body: { skus?: { sku: string }[] };
  try {
    body = await req.json();
  } catch {
    return fail("Bad request body.");
  }
  const skus = Array.isArray(body.skus) ? body.skus : [];
  if (!skus.length) return fail("No SKUs sent.");

  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });

  try {
    const params = {
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: { effort: "low" as const },
      messages: [
        {
          role: "user" as const,
          content: `Explain these ${skus.length} SKUs. Return exactly one JSON object per SKU.\n\n${JSON.stringify(skus)}`,
        },
      ],
    };
    const response = FALLBACK_MODELS.has(model)
      ? await client.beta.messages.create({
          ...params,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        })
      : await client.beta.messages.create(params);

    if (response.stop_reason === "refusal") return fail("Model declined the request — using template reasons.");
    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const parsed = validateExplanations(
      extractJsonArray(text),
      skus.map((s) => s.sku),
    );
    if (!parsed) return fail("Model reply was not valid JSON — using template reasons.");

    return NextResponse.json({ ok: true, source: "ai", model: response.model, items: [...parsed.values()] });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return fail("Invalid ANTHROPIC_API_KEY — using template reasons.");
    if (error instanceof Anthropic.RateLimitError) return fail("Rate limited — using template reasons.");
    if (error instanceof Anthropic.APIError) return fail(`Anthropic API error ${error.status ?? ""} — using template reasons.`);
    return fail("AI call failed — using template reasons.");
  }
}
