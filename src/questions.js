// Phase 1 — The 17 questions + response scale + trait mapping.
// Single Likert scale for every item: 1=Strongly Disagree ... 5=Strongly Agree.
// Each item maps to one or more trait dimensions with a direction:
//   dir = +1  -> raw score used as-is
//   dir = -1  -> reverse scored (6 - raw)
// Keeping direction on the *item↔trait link* (not the item) lets one question
// feed several traits with different signs. Everything here is data, so scoring
// stays deterministic and needs zero AI.

const SCALE = {
  min: 1,
  max: 5,
  labels: {
    1: "Strongly Disagree",
    2: "Disagree",
    3: "Neutral",
    4: "Agree",
    5: "Strongly Agree",
  },
};

// Trait keys used across the whole system.
const TRAITS = [
  "extraversion",      // vs introversion
  "intuition",         // vs sensing/concrete
  "thinking",          // vs feeling
  "judging",           // vs perceiving
  "dominance",
  "influence",
  "steadiness",
  "conscientiousness",
  "independence",
  "riskTolerance",
  "decisionSpeed",
  "needForRules",
  "adaptability",
  "workPace",
  "socialDrive",
  "leadership",
];

// The 17 items. `map` = list of {trait, dir}.
const QUESTIONS = [
  { id: 1,  text: "I feel energized after spending time in large groups of people.",
    map: [{ trait: "extraversion", dir: +1 }, { trait: "influence", dir: +1 }, { trait: "socialDrive", dir: +1 }] },
  { id: 2,  text: "I prefer to recharge alone rather than being around others.",
    map: [{ trait: "extraversion", dir: -1 }] },
  { id: 3,  text: "I focus on concrete facts and details more than big-picture possibilities.",
    map: [{ trait: "intuition", dir: -1 }, { trait: "conscientiousness", dir: +1 }] },
  { id: 4,  text: "I'm drawn to patterns, theories, and future possibilities.",
    map: [{ trait: "intuition", dir: +1 }] },
  { id: 5,  text: "I make decisions based on logic and objective analysis rather than how people will feel.",
    map: [{ trait: "thinking", dir: +1 }] },
  { id: 6,  text: "I weigh the impact on people heavily when making decisions.",
    map: [{ trait: "thinking", dir: -1 }, { trait: "steadiness", dir: +1 }] },
  { id: 7,  text: "I like having a clear plan and structure for my day.",
    map: [{ trait: "judging", dir: +1 }, { trait: "conscientiousness", dir: +1 }, { trait: "needForRules", dir: +1 }] },
  { id: 8,  text: "I'm comfortable adapting and keeping my options open as things change.",
    map: [{ trait: "judging", dir: -1 }, { trait: "adaptability", dir: +1 }] },
  { id: 9,  text: "I naturally take charge and push for results, even under pressure.",
    map: [{ trait: "dominance", dir: +1 }, { trait: "leadership", dir: +1 }] },
  { id: 10, text: "I enjoy persuading and influencing others toward my ideas.",
    map: [{ trait: "influence", dir: +1 }, { trait: "socialDrive", dir: +1 }, { trait: "leadership", dir: +1 }] },
  { id: 11, text: "I stay calm and steady, preferring stability over sudden change.",
    map: [{ trait: "steadiness", dir: +1 }, { trait: "adaptability", dir: -1 }] },
  { id: 12, text: "I double-check my work and hold myself to high accuracy standards.",
    map: [{ trait: "conscientiousness", dir: +1 }] },
  { id: 13, text: "I prefer to work independently rather than rely on a team.",
    map: [{ trait: "independence", dir: +1 }] },
  { id: 14, text: "I'm willing to take significant risks for a bigger potential reward.",
    map: [{ trait: "riskTolerance", dir: +1 }, { trait: "dominance", dir: +1 }] },
  { id: 15, text: "I make decisions quickly and act without over-analyzing.",
    map: [{ trait: "decisionSpeed", dir: +1 }, { trait: "riskTolerance", dir: +1 }] },
  { id: 16, text: "I follow established rules and procedures even when I disagree.",
    map: [{ trait: "needForRules", dir: +1 }, { trait: "conscientiousness", dir: +1 }, { trait: "dominance", dir: -1 }] },
  { id: 17, text: "I work best at a fast, high-intensity pace rather than a steady, measured one.",
    map: [{ trait: "workPace", dir: +1 }, { trait: "steadiness", dir: -1 }] },
];

module.exports = { SCALE, TRAITS, QUESTIONS };
