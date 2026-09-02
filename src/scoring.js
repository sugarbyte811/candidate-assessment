// Phase 1 — Deterministic scoring engine. No AI, no randomness.
// Same 17 answers in -> identical profile out, every time.

const { SCALE, TRAITS, QUESTIONS } = require("./questions");

// ---- helpers ---------------------------------------------------------------

function reverse(raw) {
  return SCALE.min + SCALE.max - raw; // 6 - raw for a 1..5 scale
}

// Normalize a summed score to 0..100 given how many items fed it and the
// per-item min/max contribution.
function normalize(sum, itemCount) {
  const lo = itemCount * SCALE.min; // all 1s
  const hi = itemCount * SCALE.max; // all 5s
  if (hi === lo) return 50;
  return Math.round(((sum - lo) / (hi - lo)) * 100);
}

function band(score0to100) {
  if (score0to100 <= 33) return "low";
  if (score0to100 <= 66) return "moderate";
  return "high";
}

// ---- trait aggregation -----------------------------------------------------

// Returns { traitScores0to100, traitItemCounts } computed from the 17 answers.
function computeTraits(answers) {
  if (!Array.isArray(answers) || answers.length !== QUESTIONS.length) {
    throw new Error(`Expected ${QUESTIONS.length} answers, got ${answers?.length}`);
  }
  const sums = {};
  const counts = {};
  for (const t of TRAITS) { sums[t] = 0; counts[t] = 0; }

  QUESTIONS.forEach((q, i) => {
    const raw = answers[i];
    if (!Number.isInteger(raw) || raw < SCALE.min || raw > SCALE.max) {
      throw new Error(`Answer ${i + 1} must be an integer ${SCALE.min}..${SCALE.max}, got ${raw}`);
    }
    for (const { trait, dir } of q.map) {
      sums[trait] += dir === -1 ? reverse(raw) : raw;
      counts[trait] += 1;
    }
  });

  const traits = {};
  for (const t of TRAITS) {
    traits[t] = counts[t] ? normalize(sums[t], counts[t]) : 50;
  }
  return { traits, counts };
}

// ---- MBTI-inspired (Jungian 16-type, NOT branded MBTI) ---------------------
// Axis chosen by which pole scores higher. We reuse normalized trait scores as
// pole strength. Ties (equal) resolve to the first-listed letter and are flagged.

function computeTypeCode(traits) {
  const axes = [
    { key: "EI", hi: "E", lo: "I", score: traits.extraversion },
    { key: "SN", hi: "N", lo: "S", score: traits.intuition },
    { key: "TF", hi: "T", lo: "F", score: traits.thinking },
    { key: "JP", hi: "J", lo: "P", score: traits.judging },
  ];
  const letters = {};
  const balanced = [];
  let type = "";
  for (const a of axes) {
    // >50 leans to the "hi" pole (the +1 direction trait), <50 to "lo".
    const pick = a.score >= 50 ? a.hi : a.lo;
    if (a.score >= 45 && a.score <= 55) balanced.push(a.key);
    letters[a.key] = pick;
    type += pick;
  }
  return { type, axes: letters, balancedAxes: balanced };
}

// ---- DISC-style ------------------------------------------------------------
// Each DISC dimension is an average of its supporting trait scores (0..100).

function computeDisc(traits) {
  const scores = {
    D: Math.round((traits.dominance + traits.riskTolerance + traits.decisionSpeed) / 3),
    I: Math.round((traits.influence + traits.socialDrive + traits.extraversion) / 3),
    S: Math.round((traits.steadiness + (100 - traits.workPace)) / 2),
    C: Math.round((traits.conscientiousness + traits.needForRules) / 2),
  };
  // Rank to find primary/secondary. Deterministic tie-break by fixed order D>I>S>C.
  const order = ["D", "I", "S", "C"];
  const ranked = [...order].sort((a, b) => (scores[b] - scores[a]) || (order.indexOf(a) - order.indexOf(b)));
  return { scores, primary: ranked[0], secondary: ranked[1] };
}

// ---- PI-inspired workplace factors (NOT branded Predictive Index) ----------

function computePi(traits) {
  const factors = {
    dominance: Math.round((traits.dominance + traits.riskTolerance) / 2),
    extraversion: Math.round((traits.influence + traits.socialDrive + traits.extraversion) / 3),
    patience: Math.round((traits.steadiness + (100 - traits.workPace)) / 2),
    formality: Math.round((traits.conscientiousness + traits.needForRules) / 2),
  };
  const bands = {};
  for (const k of Object.keys(factors)) bands[k] = band(factors[k]);
  return { factors, bands };
}

// ---- top-level -------------------------------------------------------------

function scoreAssessment(answers) {
  const { traits, counts } = computeTraits(answers);
  return {
    traits,
    _itemCounts: counts,
    mbti: computeTypeCode(traits),
    disc: computeDisc(traits),
    pi: computePi(traits),
  };
}

module.exports = {
  reverse, normalize, band,
  computeTraits, computeTypeCode, computeDisc, computePi,
  scoreAssessment,
};
