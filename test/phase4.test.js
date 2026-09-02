// Phase 4 self-test. Run: node test/phase4.test.js
const assert = require("assert");
const { buildProfile } = require("../src/profile");
const { integrate, assignArchetype } = require("../src/integration");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log("  ok -", name); }

console.log("Phase 4 integration tests\n");

const driver = {
  person: { firstName: "Dana", lastName: "Rivera", email: "dana@x.com", birthday: "1988-04-12" },
  optional: { birthName: "Dana Rivera", birthplace: "Miami, FL, USA" },
  answers: [5,1,3,4,5,2,3,5,5,5,1,3,4,5,5,1,5], // high-D driver
};
const stabilizer = {
  person: { firstName: "Sam", lastName: "Lee", email: "sam@x.com", birthday: "1979-11-03" },
  optional: { birthName: "Samuel Lee" },
  answers: [1,5,5,2,3,4,5,1,1,1,5,5,2,1,1,5,1], // steady/detail introvert
};

check("archetype comes ONLY from behavioral DISC primary", () => {
  const p = buildProfile(driver);
  assert.strictEqual(p.archetype.name, "The Driver");
  assert.ok(p.archetype.code.includes(p.behavioral.mbti.type));
  const s = buildProfile(stabilizer);
  assert.ok(["The Stabilizer", "The Analyst"].includes(s.archetype.name));
});

check("behavioral remains the decision basis", () => {
  const p = buildProfile(driver);
  assert.strictEqual(p.integration.weighting.decisionBasis, "behavioral");
});

check("numerology/astrology do NOT change behavioral scores or archetype", () => {
  // Same answers, wildly different birth data => identical behavioral + archetype.
  const a = buildProfile({ ...driver, person: { ...driver.person, birthday: "1960-01-01" } });
  const b = buildProfile({ ...driver, person: { ...driver.person, birthday: "1999-09-09" } });
  assert.deepStrictEqual(a.behavioral.traits, b.behavioral.traits);
  assert.strictEqual(a.archetype.name, b.archetype.name);
  assert.strictEqual(a.archetype.typeCode, b.archetype.typeCode);
});

check("resonance reports reinforce/conflict without overriding", () => {
  const p = buildProfile(driver);
  const r = p.integration.resonance;
  assert.ok(r.numerology.available);
  assert.ok(r.astrology.available);
  assert.ok(["reinforces", "conflicts", "neutral"].every(() => true));
  assert.ok(typeof r.summary === "string" && r.summary.length > 0);
  r.numerology.items.forEach((i) =>
    assert.ok(["reinforces", "conflicts", "neutral"].includes(i.alignment)));
});

check("missing optional context => resonance gracefully unavailable, archetype intact", () => {
  const p = buildProfile({
    person: { firstName: "No", lastName: "Extras", email: "n@x.com", birthday: "1990-06-15" },
    optional: {}, // no birth name, no birthplace
    answers: Array(17).fill(3),
  });
  assert.strictEqual(p.numerology.expression, null);        // no name => no expression
  // lifePath still comes from birthday, so numerology resonance IS available:
  assert.strictEqual(p.integration.resonance.numerology.available, true);
  assert.ok(p.integration.resonance.numerology.items.every((i) => i.source === "lifePath"));
  assert.strictEqual(p.astrology.available, true);          // birthday still gives sun/planets
  assert.ok(p.archetype.name);                              // archetype still assigned
});

check("integrate() is deterministic", () => {
  const p = buildProfile(driver);
  const a = JSON.stringify(integrate(p));
  const b = JSON.stringify(integrate(p));
  assert.strictEqual(a, b);
});

console.log(`\nAll ${passed} tests passed.`);
