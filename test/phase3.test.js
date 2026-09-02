// Phase 3 self-test. Run: node test/phase3.test.js
// Sun-sign expectations come from the standard tropical zodiac date ranges
// (verifiable without any ephemeris). Planet/Moon spot-checks use well-known
// historical placements.

const assert = require("assert");
const { computeAstrology, signOf, julianDay, sunLongitude } = require("../src/astrology");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log("  ok -", name); }

console.log("Phase 3 astrology tests\n");

// ---- Sun sign matches tropical date ranges ----
const sunCases = [
  ["2000-01-15", "Capricorn"],
  ["2000-02-15", "Aquarius"],
  ["2000-03-25", "Aries"],
  ["2000-04-10", "Aries"],   // clearly Aries, away from the Taurus cusp
  ["2000-05-15", "Taurus"],
  ["2000-06-25", "Cancer"],
  ["2000-07-20", "Cancer"],
  ["2000-08-15", "Leo"],
  ["2000-09-25", "Libra"],
  ["2000-10-31", "Scorpio"],
  ["2000-11-25", "Sagittarius"],
  ["2000-12-25", "Capricorn"],
];
for (const [date, sign] of sunCases) {
  check(`Sun on ${date} = ${sign}`, () => {
    const a = computeAstrology({ birthday: date });
    assert.strictEqual(a.placements.Sun.sign, sign, `got ${a.placements.Sun.sign}`);
  });
}

// ---- Known planet placements (spot checks, sign-level) ----
// Reference date 2000-01-01 (well documented):
//   Sun Capricorn, Jupiter Aries, Saturn Taurus, Neptune Aquarius, Uranus Aquarius, Pluto Sagittarius
check("2000-01-01 outer planets land in known signs", () => {
  const a = computeAstrology({ birthday: "2000-01-01" });
  assert.strictEqual(a.placements.Sun.sign, "Capricorn");
  assert.strictEqual(a.placements.Jupiter.sign, "Aries");
  assert.strictEqual(a.placements.Saturn.sign, "Taurus");
  assert.strictEqual(a.placements.Uranus.sign, "Aquarius");
  assert.strictEqual(a.placements.Neptune.sign, "Aquarius");
  assert.strictEqual(a.placements.Pluto.sign, "Sagittarius");
});

// Reference 1990-12-25: Sun Capricorn, Saturn Capricorn, Uranus Capricorn,
// Neptune Capricorn, Pluto Scorpio (early-90s stellium era).
check("1990-12-25 Capricorn stellium era placements", () => {
  const a = computeAstrology({ birthday: "1990-12-25" });
  assert.strictEqual(a.placements.Sun.sign, "Capricorn");
  assert.strictEqual(a.placements.Saturn.sign, "Capricorn");
  assert.strictEqual(a.placements.Uranus.sign, "Capricorn");
  assert.strictEqual(a.placements.Neptune.sign, "Capricorn");
  assert.strictEqual(a.placements.Pluto.sign, "Scorpio");
});

// ---- Moon Option B behavior ----
check("Moon is reported OR gracefully omitted, never guessed on a cusp", () => {
  const a = computeAstrology({ birthday: "1990-12-25" });
  // Either we get a sign with unambiguous confidence, or null with ambiguous note.
  if (a.moon.sign) {
    assert.strictEqual(a.moon.confidence, "date-unambiguous");
  } else {
    assert.strictEqual(a.moon.confidence, "ambiguous-without-birth-time");
    assert.strictEqual(a.moon.degree, null);
  }
});

check("Moon omission produces a null sign + explanatory note (find a transition day)", () => {
  // Scan a month to guarantee at least one ambiguous day exists and is handled.
  let foundAmbiguous = false;
  for (let d = 1; d <= 28; d++) {
    const date = `2001-06-${String(d).padStart(2, "0")}`;
    const a = computeAstrology({ birthday: date });
    if (!a.moon.sign) {
      foundAmbiguous = true;
      assert.strictEqual(a.moon.confidence, "ambiguous-without-birth-time");
      assert.ok(/omitted/.test(a.moon.note));
    }
  }
  assert.ok(foundAmbiguous, "expected at least one ambiguous Moon day in the month");
});

// ---- Strict exclusions ----
check("Ascendant/houses/Midheaven are never produced", () => {
  const a = computeAstrology({ birthday: "1985-07-13", birthplace: "Boston, MA, USA" });
  assert.deepStrictEqual(a.excluded, ["ascendant", "houses", "midheaven"]);
  assert.ok(!("ascendant" in a.placements));
  assert.ok(!("houses" in a.placements));
  assert.strictEqual(a.birthplace, "Boston, MA, USA");
});

// ---- Birthplace optional; birth time never required ----
check("works with no birthplace at all", () => {
  const a = computeAstrology({ birthday: "1975-09-09" });
  assert.strictEqual(a.available, true);
  assert.ok(a.placements.Sun.sign);
});

// ---- graceful when no birthday ----
check("no birthday => available false, nothing invented", () => {
  const a = computeAstrology({});
  assert.strictEqual(a.available, false);
  assert.deepStrictEqual(a.placements, {});
});

// ---- validation ----
check("rejects malformed birthday", () => {
  assert.throws(() => computeAstrology({ birthday: "13/05/1990" }));
});

console.log(`\nAll ${passed} tests passed.`);
