import { NextResponse } from "next/server";
import { extractJsonArray, validateExplanations } from "@/lib/rules";

// BOX 5 · AI LAYER — server-only. The API key never reaches the browser.
// Gemini explains and flags; it never sets or edits a quantity.

export const runtime = "nodejs";

const SYSTEM_PROMPT =
  'You are a demand-planning assistant for Freshroots. You do NOT set quantities; code does. For each SKU you receive its history, stock, weeks of cover, flags, action and exception status. If exception=true, give one line on why it is unusual and one line on what the planner should check. Otherwise give one line explaining the rule-based recommendation using the real numbers. Never change a quantity. Never invent data; if data is missing, say so. Reply ONLY with JSON: [{"sku":"","reason":"","check":""}]';

const DEFAULT_MODEL = "gemini-3.8-flash";

type Fail = { ok: false; source: "template"; error: string };
const fail = (error: string) => NextResponse.json<Fail>({ ok: false, source: "template", error });

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fail("Free mode: no GEMINI_API_KEY set, so no AI is called. Reasons come from built-in templates.");

  let body: { skus?: { sku: string }[] };
  try {
    body = await req.json();
  } catch {
    return fail("Bad request body.");
  }
  const skus = Array.isArray(body.skus) ? body.skus : [];
  if (!skus.length) return fail("No SKUs sent.");

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [{ text: `Explain these ${skus.length} SKUs. Return exactly one JSON object per SKU.\n\n${JSON.stringify(skus)}` }],
          },
        ],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 16000 },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const data = (await res.json()) as GeminiResponse;
    if (!res.ok) {
      if (res.status === 429) return fail("Gemini rate limit reached — using template reasons.");
      if (res.status === 400 || res.status === 403) return fail(`Gemini rejected the request (${data.error?.status ?? res.status}) — using template reasons.`);
      return fail(`Gemini error ${res.status} — using template reasons.`);
    }
    if (data.promptFeedback?.blockReason) return fail("Gemini declined the request — using template reasons.");

    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    const parsed = validateExplanations(
      extractJsonArray(text),
      skus.map((s) => s.sku),
    );
    if (!parsed) return fail("Gemini reply was not valid JSON — using template reasons.");

    return NextResponse.json({ ok: true, source: "ai", model, items: [...parsed.values()] });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    return fail(timedOut ? "Gemini timed out — using template reasons." : "AI call failed — using template reasons.");
  }
}
