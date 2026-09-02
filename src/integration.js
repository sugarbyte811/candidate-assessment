// Phase 4 — Integration engine. Deterministic, no AI.
//
// Combines behavioral + numerology + astrology into ONE unified profile model.
// DESIGN RULE (per spec): behavioral answers carry the decision weight for any
// employment/workplace recommendation. Numerology and astrology are SECONDARY
// interpretive context and must NEVER override behavioral results.
//
// Concretely:
//   - The archetype, DISC primary, MBTI-style type, and all hiring-relevant
//     scores are derived ONLY from behavioral data.
//   - Numerology/astrology contribute "resonance" notes: do they reinforce or
//     conflict with the behavioral read? This is flavor/context, weighted ~0
//     in scoring but surfaced for the narrative.

const { SIGNS } = require("./astrology");

// Element grouping for astrology resonance (fire/earth/air/water).
const ELEMENT = {
  Aries: "fire", Leo: "fire", Sagittarius: "fire",
  Taurus: "earth", Virgo: "earth", Capricorn: "earth",
  Gemini: "air", Libra: "air", Aquarius: "air",
  Cancer: "water", Scorpio: "water", Pisces: "water",
};

// Rough behavioral leaning each element tends to echo (context only).
const ELEMENT_HINT = {
  fire: { dominance: 1, workPace: 1, riskTolerance: 1 },   // driving, energetic
  earth: { conscientiousness: 1, steadiness: 1, needForRules: 1 }, // grounded, structured
  air: { influence: 1, extraversion: 1, intuition: 1 },    // social, ideational
  water: { steadiness: 1, thinking: -1 },                  // feeling, people-oriented
};

// Numerology number -> loose behavioral theme (context only).
const NUMBER_THEME = {
  1: { label: "Leader/Initiator", echoes: { dominance: 1, independence: 1 } },
  2: { label: "Cooperator/Diplomat", echoes: { steadiness: 1, thinking: -1 } },
  3: { label: "Communicator/Creative", echoes: { influence: 1, extraversion: 1 } },
  4: { label: "Builder/Organizer", echoes: { conscientiousness: 1, needForRules: 1 } },
  5: { label: "Adventurer/Change-agent", echoes: { adaptability: 1, riskTolerance: 1 } },
  6: { label: "Nurturer/Responsible", echoes: { steadiness: 1, thinking: -1 } },
  7: { label: "Analyst/Seeker", echoes: { thinking: 1, independence: 1 } },
  8: { label: "Executive/Achiever", echoes: { dominance: 1, leadership: 1 } },
  9: { label: "Humanitarian/Visionary", echoes: { intuition: 1, influence: 1 } },
  11: { label: "Inspirer (master)", echoes: { intuition: 1, influence: 1 } },
  22: { label: "Master Builder", echoes: { conscientiousness: 1, leadership: 1 } },
  33: { label: "Master Teacher", echoes: { influence: 1, steadiness: 1 } },
};

// ---- Archetype: derived from BEHAVIORAL data only --------------------------
// Combines DISC primary + a dominant behavioral flavor into a named archetype.
const ARCHETYPES = {
  D: { name: "The Driver", blurb: "results-focused, decisive, and comfortable leading under pressure" },
  I: { name: "The Influencer", blurb: "outgoing, persuasive, and energized by people" },
  S: { name: "The Stabilizer", blurb: "steady, dependable, and calm through change" },
  C: { name: "The Analyst", blurb: "precise, structured, and quality-driven" },
};

function assignArchetype(behavioral) {
  const primary = behavioral.disc.primary;
  const secondary = behavioral.disc.secondary;
  const base = ARCHETYPES[primary];
  const code = `${primary}${secondary}-${behavioral.mbti.type}`;
  return {
    name: base.name,
    code,
    blurb: base.blurb,
    discPair: `${primary}/${secondary}`,
    typeCode: behavioral.mbti.type,
  };
}

// ---- Resonance: does context reinforce or conflict with behavioral read? ----
function traitBand(v) { return v >= 66 ? "high" : v <= 33 ? "low" : "mid"; }

function scoreEcho(behavioral, echoes) {
  // For each echoed trait, +1 if the behavioral score agrees with the echo
  // direction, -1 if it clearly conflicts, 0 if neutral. Returns net + details.
  let net = 0;
  const details = [];
  for (const [trait, dir] of Object.entries(echoes)) {
    const v = behavioral.traits[trait];
    if (v == null) continue;
    const b = traitBand(v);
    let agree = 0;
    if (dir > 0) agree = b === "high" ? 1 : b === "low" ? -1 : 0;
    else agree = b === "low" ? 1 : b === "high" ? -1 : 0;
    net += agree;
    if (agree !== 0) {
      details.push({ trait, behavioral: b, context: dir > 0 ? "high" : "low", agree });
    }
  }
  return { net, details };
}

function numerologyResonance(behavioral, numerology) {
  if (!numerology || !numerology.available) return { available: false, items: [] };
  const items = [];
  const nums = {
    lifePath: numerology.lifePath,
    expression: numerology.expression,
    soulUrge: numerology.soulUrge,
  };
  for (const [k, val] of Object.entries(nums)) {
    if (val == null) continue;
    const theme = NUMBER_THEME[val];
    if (!theme) continue;
    const { net, details } = scoreEcho(behavioral, theme.echoes);
    items.push({
      source: k, number: val, theme: theme.label,
      alignment: net > 0 ? "reinforces" : net < 0 ? "conflicts" : "neutral",
      net, details,
    });
  }
  return { available: true, items };
}

function astrologyResonance(behavioral, astrology) {
  if (!astrology || !astrology.available) return { available: false, items: [] };
  const items = [];
  const consider = { Sun: astrology.placements.Sun, Moon: astrology.moon };
  for (const [body, place] of Object.entries(consider)) {
    if (!place || !place.sign) continue;
    const el = ELEMENT[place.sign];
    const hint = ELEMENT_HINT[el];
    if (!hint) continue;
    const { net, details } = scoreEcho(behavioral, hint);
    items.push({
      body, sign: place.sign, element: el,
      alignment: net > 0 ? "reinforces" : net < 0 ? "conflicts" : "neutral",
      net, details,
    });
  }
  return { available: true, items };
}

// ---- top-level -------------------------------------------------------------
function integrate(profile) {
  const behavioral = profile.behavioral;
  const archetype = assignArchetype(behavioral);

  const numRes = numerologyResonance(behavioral, profile.numerology);
  const astRes = astrologyResonance(behavioral, profile.astrology);

  // A single, honest summary line about how context relates to behavior.
  const allItems = [...numRes.items, ...astRes.items];
  const reinforce = allItems.filter((i) => i.alignment === "reinforces").length;
  const conflict = allItems.filter((i) => i.alignment === "conflicts").length;
  let contextSummary;
  if (!numRes.available && !astRes.available) {
    contextSummary = "No numerology or astrology context was provided.";
  } else if (reinforce > conflict) {
    contextSummary = "Numerology/astrology themes broadly reinforce the behavioral profile.";
  } else if (conflict > reinforce) {
    contextSummary = "Numerology/astrology themes partly contrast the behavioral profile, offering complementary color.";
  } else {
    contextSummary = "Numerology/astrology themes are mixed relative to the behavioral profile.";
  }

  return {
    archetype,
    weighting: {
      decisionBasis: "behavioral",
      note: "Behavioral assessment drives all workplace/hiring recommendations. " +
            "Numerology and astrology are secondary interpretive context only.",
    },
    resonance: {
      numerology: numRes,
      astrology: astRes,
      summary: contextSummary,
      reinforceCount: reinforce,
      conflictCount: conflict,
    },
  };
}

module.exports = { integrate, assignArchetype, ELEMENT, NUMBER_THEME };
