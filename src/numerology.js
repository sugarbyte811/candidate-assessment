// Phase 2 — Deterministic numerology engine. No AI, no network.
// Uses the Pythagorean system, the most common in Western numerology.
//
// Numbers produced:
//   lifePath        — from the birth DATE
//   expression      — all letters of the full birth name (a.k.a. Destiny)
//   soulUrge        — vowels of the full birth name (a.k.a. Heart's Desire)
//   personality     — consonants of the full birth name
//   birthdayNumber  — the day of the month, reduced (master preserved)
//
// Master numbers 11, 22, 33 are preserved (not reduced to a single digit).

const MASTER = new Set([11, 22, 33]);

// Pythagorean letter->digit map (A=1..I=9, J=1..R=9, S=1..Z=8).
const LETTER_VALUE = (() => {
  const m = {};
  const A = "A".charCodeAt(0);
  for (let i = 0; i < 26; i++) {
    m[String.fromCharCode(A + i)] = (i % 9) + 1;
  }
  return m;
})();

const HARD_VOWELS = new Set(["A", "E", "I", "O", "U"]);

// Reduce a number to a single digit, but keep master numbers 11/22/33.
// Master numbers are honored at every step of the collapse.
function reduce(n) {
  let x = Math.abs(n);
  while (x > 9 && !MASTER.has(x)) {
    x = String(x).split("").reduce((s, d) => s + Number(d), 0);
  }
  return x;
}

// Normalize a name: keep A-Z letters only, uppercase. Diacritics are folded
// to their base ASCII letter (é -> E) so accented birth names still score.
function cleanName(name) {
  return (name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

// Split a name into word tokens (letters only) for Y-vowel decisions.
function nameWords(name) {
  return (name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);
}

// Y handling is the one genuinely ambiguous rule in numerology.
// Deterministic rule used here: within a word, Y is treated as a VOWEL when it
// has no adjacent hard vowel (A/E/I/O/U) on either side (e.g. "Yvonne", "Lynn",
// "Bryn"), and as a CONSONANT when it sits next to a hard vowel (e.g. "Kaya",
// "Ryan"). W is always a consonant. This is documented and configurable.
function classifyLetters(name) {
  const vowels = [];      // {letter}
  const consonants = [];  // {letter}
  for (const word of nameWords(name)) {
    const chars = word.split("");
    chars.forEach((ch, i) => {
      if (!LETTER_VALUE[ch]) return;
      let isVowel;
      if (HARD_VOWELS.has(ch)) {
        isVowel = true;
      } else if (ch === "Y") {
        const prev = chars[i - 1];
        const next = chars[i + 1];
        const prevVowel = prev && HARD_VOWELS.has(prev);
        const nextVowel = next && HARD_VOWELS.has(next);
        isVowel = !prevVowel && !nextVowel; // vowel only when not beside a hard vowel
      } else {
        isVowel = false;
      }
      (isVowel ? vowels : consonants).push(ch);
    });
  }
  return { vowels, consonants };
}

function sumLetters(letters) {
  return letters.reduce((s, ch) => s + (LETTER_VALUE[ch] || 0), 0);
}

// ---- core numbers ----------------------------------------------------------

// Life Path: reduce month, day, and year independently, then reduce the sum.
// This method honors master numbers that appear in any component or the total.
function lifePath(birthday) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthday).trim());
  if (!m) throw new Error(`birthday must be YYYY-MM-DD, got "${birthday}"`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) throw new Error(`invalid month ${month}`);
  if (day < 1 || day > 31) throw new Error(`invalid day ${day}`);
  const rM = reduce(month);
  const rD = reduce(day);
  const rY = reduce(year);
  return reduce(rM + rD + rY);
}

function birthdayNumber(birthday) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthday).trim());
  if (!m) throw new Error(`birthday must be YYYY-MM-DD, got "${birthday}"`);
  return reduce(Number(m[3]));
}

function expression(fullName) {
  const letters = cleanName(fullName).split("");
  if (!letters.length) throw new Error("name has no letters");
  return reduce(sumLetters(letters));
}

function soulUrge(fullName) {
  const { vowels } = classifyLetters(fullName);
  if (!vowels.length) throw new Error("name has no vowels");
  return reduce(sumLetters(vowels));
}

function personality(fullName) {
  const { consonants } = classifyLetters(fullName);
  if (!consonants.length) throw new Error("name has no consonants");
  return reduce(sumLetters(consonants));
}

// ---- top-level -------------------------------------------------------------
// birthName is optional. If absent, name-based numbers are omitted gracefully.
function computeNumerology({ birthday, birthName }) {
  const out = {
    lifePath: null,
    expression: null,
    soulUrge: null,
    personality: null,
    birthdayNumber: null,
    available: false,
    basis: { hasBirthday: false, hasName: false },
    yRule: "Y is a vowel only when not adjacent to a hard vowel within its word",
  };

  if (birthday) {
    out.lifePath = lifePath(birthday);
    out.birthdayNumber = birthdayNumber(birthday);
    out.basis.hasBirthday = true;
  }
  if (birthName && cleanName(birthName).length) {
    out.expression = expression(birthName);
    out.soulUrge = soulUrge(birthName);
    out.personality = personality(birthName);
    out.basis.hasName = true;
  }
  out.available = out.basis.hasBirthday || out.basis.hasName;
  return out;
}

module.exports = {
  MASTER, LETTER_VALUE, reduce, cleanName, classifyLetters,
  lifePath, birthdayNumber, expression, soulUrge, personality,
  computeNumerology,
};
