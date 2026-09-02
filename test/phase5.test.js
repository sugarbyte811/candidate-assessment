// Phase 5 self-test. Run: node test/phase5.test.js
// Tests the deterministic report path (no AI, zero cost) end-to-end.
const assert = require("assert");
const { buildProfile } = require("../src/profile");
const { buildReportPayload, renderReport, deterministicNarrative, DISCLAIMER } = require("../src/report");
const { generateNarrative } = require("../src/ai");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log("  ok -", name); }

console.log("Phase 5 report tests\n");

const profile = buildProfile({
  person: { firstName: "Dana", lastName: "Rivera", email: "dana@x.com", birthday: "1988-04-12" },
  optional: { birthName: "Dana Rivera", birthplace: "Miami, FL, USA" },
  answers: [5,1,3,4,5,2,3,5,5,5,1,3,4,5,5,1,5],
});

check("payload contains scored data + one clear instruction", () => {
  const pl = buildReportPayload(profile);
  assert.ok(pl.archetype && pl.mbti && pl.disc && pl.pi);
  assert.ok(Array.isArray(pl.topTraits) && pl.topTraits.length === 5);
  assert.ok(pl.numerology && pl.astrology);
  assert.ok(typeof pl.instruction === "string");
});

check("deterministic report renders all 4 pages with titles", () => {
  const r = renderReport(profile); // no AI
  assert.strictEqual(r.meta.generatedBy, "deterministic");
  for (let i = 1; i <= 4; i++) {
    assert.ok(r.pages[i].title, `page ${i} missing title`);
  }
  assert.ok(r.pages[1].executiveSummary.includes("Dana"));
  assert.ok(Array.isArray(r.pages[1].strengths));
  assert.strictEqual(r.disclaimer, DISCLAIMER);
});

check("raw Personality Assessment page (MBTI/DISC/PI) is NOT shown to candidate", () => {
  const r = renderReport(profile);
  const titles = Object.values(r.pages).map((p) => p.title);
  assert.ok(!titles.includes("Personality Assessment"), "page 3 should be removed");
  // but the underlying behavioral scores still exist upstream:
  assert.ok(profile.behavioral.mbti.type && profile.behavioral.disc.primary);
});

check("report never claims official MBTI/PI branding", () => {
  const r = renderReport(profile);
  const blob = JSON.stringify(r);
  assert.ok(!/Myers-Briggs Type Indicator/.test(blob));
  assert.ok(/not affiliated/i.test(r.disclaimer));
});

check("astrology page gives a behavioral read, not a planet list", () => {
  const r = renderReport(profile);
  const astroPage = Object.values(r.pages).find((p) => p.title.includes("Astrology"));
  assert.ok(astroPage && typeof astroPage.astrologyNarrative === "string");
  // Behavioral synthesis: should NOT name planets/signs in the candidate copy.
  assert.ok(!/Sun in|Moon in|Mercury in|Ascendant/.test(astroPage.astrologyNarrative),
    "astrology narrative should not list planets/signs");
  assert.ok(/this person|they/i.test(astroPage.astrologyNarrative));
});

check("missing optional data => report still complete, sections degrade gracefully", () => {
  const bare = buildProfile({
    person: { firstName: "Pat", lastName: "Kim", email: "p@x.com", birthday: "1995-02-20" },
    optional: {},
    answers: Array(17).fill(3),
  });
  const r = renderReport(bare);
  assert.ok(r.pages[3].numerologyNarrative.length > 0); // Astro+Num is page 3 now
  assert.ok(r.pages[4].hiringSummary.includes("Pat"));  // How-to-work is page 4 now
});

check("AI narrative, when supplied, is rendered instead of fallback", () => {
  const fake = deterministicNarrative(profile); // pretend AI returned this shape
  fake.page1.executiveSummary = "AI-written summary.";
  const r = renderReport(profile, fake);
  assert.strictEqual(r.meta.generatedBy, "ai");
  assert.strictEqual(r.pages[1].executiveSummary, "AI-written summary.");
});

// async: verify graceful no-key fallback
(async () => {
  const saved = process.env.AI_API_KEY;
  delete process.env.AI_API_KEY;
  const n = await generateNarrative(buildReportPayload(profile));
  assert.strictEqual(n, null);
  passed++;
  console.log("  ok - generateNarrative returns null without API key (fallback path)");
  if (saved) process.env.AI_API_KEY = saved;
  console.log(`\nAll ${passed} tests passed.`);
})();
