// Phase 1 — Result data structure builder + input-hash for dedupe.
// Assembles the behavioral portion into the schema the later phases fill in.

const crypto = require("crypto");
const { scoreAssessment } = require("./scoring");
const { computeNumerology } = require("./numerology");
const { computeAstrology } = require("./astrology");
const { integrate } = require("./integration");

function inputHash(person, answers) {
  const basis = JSON.stringify({
    f: (person.firstName || "").trim().toLowerCase(),
    l: (person.lastName || "").trim().toLowerCase(),
    e: (person.email || "").trim().toLowerCase(),
    b: (person.birthday || "").trim(),
    a: answers,
  });
  return crypto.createHash("sha256").update(basis).digest("hex");
}

// Builds the full profile shell. Numerology/astrology stay null until their
// phases populate them; narrative/delivery are filled at Phases 5-6.
function buildProfile({ person, optional = {}, answers }) {
  const behavioralScore = scoreAssessment(answers);
  const { _itemCounts, ...behavioral } = behavioralScore;

  const profile = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    inputHash: inputHash(person, answers),
    person: {
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email,
      birthday: person.birthday, // YYYY-MM-DD
    },
    optional: {
      birthplace: optional.birthplace ?? null,
      birthName: optional.birthName ?? null,
    },
    answers,
    behavioral,
    numerology: computeNumerology({
      birthday: person.birthday,
      birthName: optional.birthName ?? null,
    }),
    astrology: computeAstrology({
      birthday: person.birthday,
      birthplace: optional.birthplace ?? null,
    }),
    archetype: { name: null, code: null },
    integration: null,
    narrative: { generatedBy: null, pages: { 1: "", 2: "", 3: "", 4: "", 5: "" } },
    delivery: { participantEmailed: false, adminEmailed: false, pdfPath: null },
  };

  // Phase 4: integrate (behavioral-weighted). Sets archetype + resonance.
  const integration = integrate(profile);
  profile.integration = { weighting: integration.weighting, resonance: integration.resonance };
  profile.archetype = integration.archetype;

  return profile;
}
module.exports = { inputHash, buildProfile };
