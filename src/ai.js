// Phase 5 — The single AI narrative call. This is the ONLY place AI is used.
//
// generateNarrative(payload) makes exactly one request to an OpenAI-compatible
// Chat Completions endpoint and returns a JSON object matching NARRATIVE_SHAPE.
// If no API key is configured, it returns null so the caller falls back to the
// deterministic narrative (zero cost, still complete).
//
// Env:
//   AI_API_KEY   - required to enable AI (otherwise deterministic fallback)
//   AI_BASE_URL  - default https://api.openai.com/v1
//   AI_MODEL     - default gpt-4o-mini (cheap, sufficient for prose)

const { NARRATIVE_SHAPE } = require("./report");

async function generateNarrative(payload, opts = {}) {
  const apiKey = opts.apiKey || process.env.AI_API_KEY;
  if (!apiKey) return null; // no key => caller uses deterministic fallback

  const baseUrl = opts.baseUrl || process.env.AI_BASE_URL || "https://api.openai.com/v1";
  const model = opts.model || process.env.AI_MODEL || "gpt-4o-mini";

  const system =
    "You are an occupational profiling writer. You receive already-scored assessment " +
    "data and must ONLY write prose. Never change or invent numeric scores. Base all " +
    "workplace judgments on the behavioral data; treat astrology/numerology as light " +
    "interpretive color and say so explicitly. Respond with ONLY valid JSON matching the " +
    "provided shape. Keep each page ~120-200 words.";

  const user =
    "SCORED PROFILE (authoritative, do not alter numbers):\n" +
    JSON.stringify(payload, null, 2) +
    "\n\nReturn ONLY JSON in exactly this shape (fill every string, use arrays where shown):\n" +
    JSON.stringify(NARRATIVE_SHAPE, null, 2);

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.6,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`AI request failed ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI returned no content");
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("AI returned non-JSON content");
  }
  // Minimal shape guard; if malformed, caller can fall back.
  if (!parsed.page1 || !parsed.page5) throw new Error("AI JSON missing required pages");
  return parsed;
}

module.exports = { generateNarrative };
