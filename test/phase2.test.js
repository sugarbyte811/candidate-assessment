// Phase 2 self-test. Run: node test/phase2.test.js
// Every expected value below is hand-computed with the Pythagorean system so the
// engine is checked against arithmetic we can verify by hand, not against itself.

const assert = require("assert");
const {
  reduce, LETTER_VALUE, classifyLetters,
  lifePath, birthdayNumber, expression, soulUrge, personality,
  computeNumerology,
} = require("../src/numerology");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log("  ok -", name); }

console.log("Phase 2 numerology tests\n");

// ---- reduce + master numbers ----
check("reduce collapses to a single digit", () => {
  assert.strictEqual(reduce(19), 1);   // 1+9=10 -> 1
  assert.strictEqual(reduce(20), 2);
  assert.strictEqual(reduce(9), 9);
  assert.strictEqual(reduce(27), 9);
});
check("reduce preserves master numbers 11/22/33", () => {
  assert.strictEqual(reduce(11), 11);
  assert.strictEqual(reduce(22), 22);
  assert.strictEqual(reduce(33), 33);
  assert.strictEqual(reduce(29), 11); // 2+9=11 -> master, stop
  assert.strictEqual(reduce(38), 11); // 3+8=11
});

// ---- letter values ----
check("Pythagorean letter map is correct at boundaries", () => {
  assert.strictEqual(LETTER_VALUE.A, 1);
  assert.strictEqual(LETTER_VALUE.I, 9);
  assert.strictEqual(LETTER_VALUE.J, 1);
  assert.strictEqual(LETTER_VALUE.R, 9);
  assert.strictEqual(LETTER_VALUE.S, 1);
  assert.strictEqual(LETTER_VALUE.Z, 8);
});

// ---- Life Path (birth date) ----
// 2000-01-01: M 1->1, D 1->1, Y 2000->2 ; 1+1+2=4
check("Life Path 2000-01-01 = 4", () => {
  assert.strictEqual(lifePath("2000-01-01"), 4);
});
// 1990-12-25: M 12->3, D 25->7, Y 1990->19->1 ; 3+7+1=11 (master kept)
check("Life Path 1990-12-25 = 11 (master preserved)", () => {
  assert.strictEqual(lifePath("1990-12-25"), 11);
});
// 1980-07-04: M 7, D 4, Y 1980->18->9 ; 7+4+9=20->2
check("Life Path 1980-07-04 = 2", () => {
  assert.strictEqual(lifePath("1980-07-04"), 2);
});

// ---- Birthday number ----
check("Birthday number = reduced day of month", () => {
  assert.strictEqual(birthdayNumber("1990-12-25"), 7); // 25 -> 7
  assert.strictEqual(birthdayNumber("1990-12-29"), 11); // 29 -> 11 master
  assert.strictEqual(birthdayNumber("2000-01-04"), 4);
});

// ---- Name numbers: "JANE DOE" (fully hand-worked) ----
// Letters J1 A1 N5 E5 D4 O6 E5 => 27 -> 9
// Vowels  A1 E5 O6 E5 => 17 -> 8
// Consts  J1 N5 D4 => 10 -> 1     (27 = 17 + 10 checks out)
check('Expression("JANE DOE") = 9', () => {
  assert.strictEqual(expression("JANE DOE"), 9);
});
check('SoulUrge("JANE DOE") = 8', () => {
  assert.strictEqual(soulUrge("JANE DOE"), 8);
});
check('Personality("JANE DOE") = 1', () => {
  assert.strictEqual(personality("JANE DOE"), 1);
});

// ---- Y-as-vowel rule ----
// "LYNN": Y not adjacent to a hard vowel -> vowel. Vowels: Y7 -> 7.
//         Consonants L3 N5 N5 = 13 -> 4. Expression 3+7+5+5=20 -> 2.
check('"LYNN": Y treated as vowel', () => {
  const { vowels, consonants } = classifyLetters("LYNN");
  assert.deepStrictEqual(vowels, ["Y"]);
  assert.deepStrictEqual(consonants, ["L", "N", "N"]);
  assert.strictEqual(soulUrge("LYNN"), 7);
  assert.strictEqual(expression("LYNN"), 2);
});
// "RYAN": Y next to hard vowel A -> consonant. R9 Y7 A1 N5 = 22 (master).
check('"RYAN": Y treated as consonant; Expression = 22 (master)', () => {
  const { vowels } = classifyLetters("RYAN");
  assert.deepStrictEqual(vowels, ["A"]);
  assert.strictEqual(expression("RYAN"), 22);
});

// ---- diacritics fold ----
check("accented letters fold to ASCII (José -> JOSE)", () => {
  assert.strictEqual(expression("José"), expression("Jose"));
});

// ---- top-level assembly + graceful omission ----
check("computeNumerology with birthday + name is fully populated", () => {
  const r = computeNumerology({ birthday: "1990-12-25", birthName: "Jane Doe" });
  assert.strictEqual(r.available, true);
  assert.strictEqual(r.lifePath, 11);
  assert.strictEqual(r.birthdayNumber, 7);
  assert.strictEqual(r.expression, 9);
  assert.strictEqual(r.soulUrge, 8);
  assert.strictEqual(r.personality, 1);
  assert.ok(r.basis.hasBirthday && r.basis.hasName);
});
check("no birth name => name numbers omitted, not guessed", () => {
  const r = computeNumerology({ birthday: "2000-01-01" });
  assert.strictEqual(r.available, true);
  assert.strictEqual(r.lifePath, 4);
  assert.strictEqual(r.expression, null);
  assert.strictEqual(r.soulUrge, null);
  assert.strictEqual(r.personality, null);
  assert.strictEqual(r.basis.hasName, false);
});
check("no data at all => available false", () => {
  const r = computeNumerology({});
  assert.strictEqual(r.available, false);
});

// ---- validation ----
check("rejects malformed dates", () => {
  assert.throws(() => lifePath("12/25/1990"));
  assert.throws(() => lifePath("1990-13-01"));
  assert.throws(() => lifePath("1990-01-40"));
});

console.log(`\nAll ${passed} tests passed.`);
