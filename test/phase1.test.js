// Phase 1 self-test. Run: node test/phase1.test.js
// Verifies determinism, bounds, reverse-scoring, and archetype-relevant extremes.

const assert = require("assert");
const { QUESTIONS } = require("../src/questions");
const { reverse, scoreAssessment } = require("../src/scoring");
const { buildProfile, inputHash } = require("../src/profile");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log("  ok -", name); }

console.log("Phase 1 scoring tests\n");

// 1. reverse scoring
check("reverse() flips the 1..5 scale", () => {
  assert.strictEqual(reverse(1), 5);
  assert.strictEqual(reverse(3), 3);
  assert.strictEqual(reverse(5), 1);
});

// 2. all-neutral (all 3s) -> everything ~50, type balanced on all axes
check("all-neutral answers land mid-range", () => {
  const r = scoreAssessment(Array(17).fill(3));
  for (const t of Object.keys(r.traits)) {
    assert.ok(r.traits[t] >= 45 && r.traits[t] <= 55, `${t}=${r.traits[t]} not mid`);
  }
  assert.strictEqual(r.mbti.balancedAxes.length, 4);
});

// 3. bounds: every trait stays 0..100 for random valid inputs
check("trait scores stay within 0..100", () => {
  for (let n = 0; n < 500; n++) {
    const ans = Array.from({ length: 17 }, () => 1 + Math.floor(Math.random() * 5));
    const r = scoreAssessment(ans);
    for (const t of Object.keys(r.traits)) {
      assert.ok(r.traits[t] >= 0 && r.traits[t] <= 100, `${t}=${r.traits[t]} OOB`);
    }
    ["D", "I", "S", "C"].forEach((d) =>
      assert.ok(r.disc.scores[d] >= 0 && r.disc.scores[d] <= 100));
  }
});

// 4. determinism: same input -> identical output
check("identical answers produce identical profiles", () => {
  const ans = [5,1,2,5,5,1,5,1,5,5,1,5,4,5,5,1,5];
  const a = JSON.stringify(scoreAssessment(ans));
  const b = JSON.stringify(scoreAssessment(ans));
  assert.strictEqual(a, b);
});

// 5. a clear "high-D leader extravert" profile
check("assertive/extravert answers => E, high D, high dominance", () => {
  // Agree strongly with drive/influence/risk/speed; disagree with rules/steadiness.
  const ans = [5,1,3,4,5,2,3,5,5,5,1,3,4,5,5,1,5];
  const r = scoreAssessment(ans);
  assert.strictEqual(r.mbti.axes.EI, "E", "should be Extravert");
  assert.strictEqual(r.disc.primary, "D", `primary was ${r.disc.primary}`);
  assert.ok(r.traits.dominance >= 66, `dominance=${r.traits.dominance}`);
  assert.strictEqual(r.pi.bands.dominance, "high");
});

// 6. a clear "steady, detail, introvert" profile
check("cautious/steady answers => I, high C or S, high conscientiousness", () => {
  const ans = [1,5,5,2,3,4,5,1,1,1,5,5,2,1,1,5,1];
  const r = scoreAssessment(ans);
  assert.strictEqual(r.mbti.axes.EI, "I", "should be Introvert");
  assert.ok(["S", "C"].includes(r.disc.primary), `primary=${r.disc.primary}`);
  assert.ok(r.traits.conscientiousness >= 66, `consc=${r.traits.conscientiousness}`);
});

// 7. input validation
check("rejects wrong answer count and out-of-range values", () => {
  assert.throws(() => scoreAssessment(Array(16).fill(3)));
  assert.throws(() => scoreAssessment([6, ...Array(16).fill(3)]));
  assert.throws(() => scoreAssessment([0, ...Array(16).fill(3)]));
});

// 8. profile builder + hash stability
check("buildProfile yields schema; hash stable & answer-sensitive", () => {
  const person = { firstName: "Test", lastName: "User", email: "t@x.com", birthday: "1990-05-10" };
  const ans = Array(17).fill(3);
  const p = buildProfile({ person, answers: ans });
  assert.ok(p.id && p.inputHash && p.behavioral && p.behavioral.mbti.type.length === 4);
  assert.strictEqual(p.numerology.available, true); // birthday present => life path computed
  assert.strictEqual(p.numerology.expression, null); // no birth name given
  assert.strictEqual(p.astrology.available, true); // birthday present => sun/planets computed
  const h1 = inputHash(person, ans);
  const h2 = inputHash(person, ans);
  const h3 = inputHash(person, [4, ...ans.slice(1)]);
  assert.strictEqual(h1, h2, "hash must be stable");
  assert.notStrictEqual(h1, h3, "hash must change with answers");
});

// 9. question integrity
check("17 questions, each maps to >=1 trait", () => {
  assert.strictEqual(QUESTIONS.length, 17);
  QUESTIONS.forEach((q) => assert.ok(q.map.length >= 1, `Q${q.id} has no mapping`));
});

console.log(`\nAll ${passed} tests passed.`);
