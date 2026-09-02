// Phase 5 — Report generator. Produces the 5-page report structure.
//
// COST DESIGN:
//   - ~80% of the report is deterministic/templated text built here from the
//     scored profile. No AI needed for structure, headings, trait tables,
//     numerology/astrology facts, or the "how to work with them" scaffolding.
//   - AI is used for ONE request only, to polish/personalize the prose in the
//     narrative slots. buildReportPayload() assembles the single prompt input;
//     the caller makes exactly one AI call and passes results to fillNarrative().
//   - If no AI is available, renderReport() still yields a complete report from
//     deterministic templates (graceful, zero-cost fallback).

const DISCLAIMER =
  "This report is inspired by established personality frameworks. It is not affiliated " +
  "with, endorsed by, or a substitute for the official MBTI\u00ae, DISC, or Predictive Index\u00ae " +
  "assessments. Astrology and numerology sections are for interpretive context only. " +
  "This report is informational and should not be the sole basis for any employment decision.";

const band = (v) => (v >= 66 ? "High" : v <= 33 ? "Low" : "Moderate");

// ---- deterministic descriptors ---------------------------------------------

const MBTI_AXIS_TEXT = {
  E: "outward-focused and energized by interaction",
  I: "inward-focused and energized by reflection",
  N: "big-picture and pattern-oriented",
  S: "concrete and detail-oriented",
  T: "logic-first in decisions",
  F: "people-and-values-first in decisions",
  J: "structured and planful",
  P: "flexible and adaptable",
};

const DISC_TEXT = {
  D: "Dominance \u2014 direct, results-driven, decisive",
  I: "Influence \u2014 outgoing, persuasive, optimistic",
  S: "Steadiness \u2014 patient, dependable, cooperative",
  C: "Conscientiousness \u2014 precise, analytical, quality-focused",
};

const NUMBER_MEANING = {
  1: "independence and leadership", 2: "cooperation and diplomacy",
  3: "expression and creativity", 4: "structure and reliability",
  5: "freedom and adaptability", 6: "responsibility and care",
  7: "analysis and depth", 8: "ambition and executive drive",
  9: "vision and compassion", 11: "inspiration and intuition (master)",
  22: "large-scale building (master)", 33: "teaching and uplift (master)",
};

const SIGN_TEXT = {
  Aries: "initiative and drive", Taurus: "steadiness and persistence",
  Gemini: "curiosity and communication", Cancer: "care and intuition",
  Leo: "confidence and warmth", Virgo: "precision and service",
  Libra: "balance and diplomacy", Scorpio: "intensity and focus",
  Sagittarius: "optimism and exploration", Capricorn: "discipline and ambition",
  Aquarius: "innovation and independence", Pisces: "empathy and imagination",
};

// Behavioral synthesis maps: how each sign tends to SHOW UP as behavior, and
// what each element leans toward at work. Used to write a short behavioral
// paragraph WITHOUT naming any planets or signs (per client request).
const SIGN_BEHAVIOR = {
  Aries: "act quickly and take initiative",
  Taurus: "work steadily and value stability",
  Gemini: "communicate easily and adapt to new information",
  Cancer: "read people well and work protectively",
  Leo: "lead with confidence and seek recognition",
  Virgo: "focus on detail and practical improvement",
  Libra: "seek fairness and collaborate diplomatically",
  Scorpio: "commit intensely and work with focus",
  Sagittarius: "stay optimistic and think big-picture",
  Capricorn: "are disciplined and goal-driven",
  Aquarius: "think independently and value fresh approaches",
  Pisces: "are empathetic and intuitive with people",
};
const ELEMENT_OF = {
  Aries: "fire", Leo: "fire", Sagittarius: "fire",
  Taurus: "earth", Virgo: "earth", Capricorn: "earth",
  Gemini: "air", Libra: "air", Aquarius: "air",
  Cancer: "water", Scorpio: "water", Pisces: "water",
};
const ELEMENT_BEHAVIOR = {
  fire: "bring energy, drive, and initiative to their work",
  earth: "are grounded, dependable, and detail-oriented",
  air: "are communicative, idea-driven, and socially engaged",
  water: "are intuitive, empathetic, and attuned to others",
};
const ENVIRONMENT_FIT = {
  fire: "fast-moving roles where they can take initiative",
  earth: "structured roles that reward reliability and follow-through",
  air: "collaborative roles with plenty of communication and new ideas",
  water: "people-centered roles where empathy and intuition matter",
};

// Produce ~3 sentences of BEHAVIORAL description from the astrology data,
// naming no planets or signs — just how the person is likely to behave.
// All phrasing uses "they" for consistent grammar.
function astrologyBehaviorSentences(ast) {
  if (!ast || !ast.available) return "Astrology information was not provided.";
  const sunSign = ast.placements.Sun && ast.placements.Sun.sign;
  const moonSign = ast.moon && ast.moon.sign;

  // Dominant element across all available placements.
  const counts = { fire: 0, earth: 0, air: 0, water: 0 };
  for (const body of Object.values(ast.placements)) {
    const el = ELEMENT_OF[body.sign];
    if (el) counts[el]++;
  }
  if (moonSign && ELEMENT_OF[moonSign]) counts[ELEMENT_OF[moonSign]]++;
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

  const s1 = sunSign
    ? `At their core, they ${SIGN_BEHAVIOR[sunSign]}.`
    : `Their overall pattern suggests they ${ELEMENT_BEHAVIOR[dominant]}.`;
  const s2 = moonSign
    ? `Instinctively, they ${SIGN_BEHAVIOR[moonSign]}, which shapes how they respond under pressure.`
    : `Across the fuller picture, they ${ELEMENT_BEHAVIOR[dominant]}.`;
  const s3 = `They are likely to perform best in ${ENVIRONMENT_FIT[dominant]}.`;
  return `${s1} ${s2} ${s3}`;
}

// ---- structured payload for the ONE AI call --------------------------------
// Everything the model needs, already scored. The model only writes prose.
function buildReportPayload(profile) {
  const b = profile.behavioral;
  const person = profile.person;
  const arche = profile.archetype;

  const topTraits = Object.entries(b.traits)
    .sort((x, y) => y[1] - x[1]).slice(0, 5)
    .map(([k, v]) => ({ trait: k, score: v, band: band(v) }));

  const num = profile.numerology;
  const numFacts = num && num.available ? {
    lifePath: num.lifePath, expression: num.expression, soulUrge: num.soulUrge,
    personality: num.personality, birthdayNumber: num.birthdayNumber,
  } : null;

  const ast = profile.astrology;
  const astFacts = ast && ast.available ? {
    sun: ast.placements.Sun?.sign || null,
    moon: ast.moon?.sign || null,
    planets: Object.fromEntries(
      Object.entries(ast.placements).map(([k, v]) => [k, v.sign])),
  } : null;

  return {
    person: { firstName: person.firstName, lastName: person.lastName },
    archetype: arche,
    mbti: b.mbti,
    disc: b.disc,
    pi: b.pi,
    topTraits,
    allTraits: b.traits,
    numerology: numFacts,
    astrology: astFacts,
    resonance: profile.integration?.resonance || null,
    instruction:
      "Write a warm, professional, employer-facing candidate report in the exact JSON " +
      "shape requested. Base ALL workplace judgments on the behavioral data; treat " +
      "numerology/astrology only as light interpretive color and say so. Do not invent " +
      "scores. Keep each page concise (roughly 120-200 words).",
  };
}

// The JSON shape we ask the single AI call to return.
const NARRATIVE_SHAPE = {
  page1: { executiveSummary: "", strengths: ["..."], naturalTendencies: "" },
  page2: { communication: "", leadership: "", decisionMaking: "", environment: "", motivation: "", collaboration: "", friction: "" },
  page3: { mbtiNarrative: "", discNarrative: "", piNarrative: "" },
  page4: { astrologyNarrative: "", numerologyNarrative: "", integration: "" },
  page5: { manage: "", motivate: "", feedback: "", environment: "", blindSpots: "", interview: "", needsFromManager: "", bestFit: "", hiringSummary: "" },
};

// ---- interview question builder --------------------------------------------
function buildInterviewQuestions(disc, traits, mbti) {
  const { primary } = disc;
  const [, , tf] = mbti.type.split("");

  const qByTheme = {
    results: [
      "Tell me about a time you took on a goal that seemed out of reach. How did you approach it, and what happened?",
      "Describe a situation where you had to push a project forward despite resistance or slow buy-in from others. What did you do?",
      "Walk me through a time you had to make a significant decision quickly with limited information. What was your process, and how did it play out?",
    ],
    influence: [
      "Tell me about a time you had to bring a skeptical person or group around to your point of view. What was your approach?",
      "Describe a situation where you had to build excitement or momentum around something that others weren\u2019t initially enthusiastic about.",
      "Tell me about a time you used your relationship with someone to get a better outcome for your team or project.",
    ],
    stability: [
      "Tell me about a time when your role or environment changed significantly. How did you adjust, and what helped you stay effective?",
      "Describe a situation where you were the steady, consistent presence a team needed during a difficult or uncertain period.",
      "Walk me through a time you delivered consistently over a long stretch of an unglamorous project. What kept you engaged?",
    ],
    quality: [
      "Tell me about a piece of work you\u2019re particularly proud of \u2014 and walk me through the standard you held yourself to in producing it.",
      "Describe a situation where you identified a quality issue that others had missed. What did you do about it?",
      "Tell me about a time you pushed back on a decision or direction because you believed the quality wasn\u2019t there. How did it go?",
    ],
    decisions: [
      "Describe a decision you made under pressure that you\u2019d make the same way again \u2014 and one you\u2019d make differently. What did each teach you?",
      "Tell me about a time you had to make a call that you knew some people would disagree with. How did you handle the aftermath?",
      "Walk me through your process for a decision you\u2019re proud of \u2014 what information did you gather, and how did you weigh it?",
    ],
    independence: [
      "Tell me about a project or period where you were working with minimal direction. How did you structure your approach and stay on track?",
      "Describe a time you identified a problem or opportunity on your own initiative and acted on it without being asked.",
    ],
    collaboration: [
      "Tell me about a time you worked with someone who had a very different working style. How did you adapt, and what was the outcome?",
      "Describe a situation where a team decision wasn\u2019t what you would have chosen. How did you handle it?",
    ],
    blindspot: {
      D: "Tell me about a time when your directness or urgency created friction with someone on your team. What happened, and what did you learn?",
      I: "Tell me about a time when follow-through was harder for you than starting. What systems or support helped you close the loop?",
      S: "Tell me about a time you had to address conflict or deliver difficult feedback directly. How did you approach it?",
      C: "Tell me about a time you had to ship something before you felt it was truly ready. How did you make that call?",
    },
  };

  const questions = [];

  // Q1: Primary strength probe
  if (primary === "D") questions.push(qByTheme.results[0]);
  else if (primary === "I") questions.push(qByTheme.influence[0]);
  else if (primary === "S") questions.push(qByTheme.stability[0]);
  else questions.push(qByTheme.quality[0]);

  // Q2: Decision-making or secondary strength, based on profile
  if (traits.decisionSpeed >= 60 || tf === "T") questions.push(qByTheme.decisions[1]);
  else if (traits.independence >= 60) questions.push(qByTheme.independence[0]);
  else questions.push(qByTheme.collaboration[0]);

  // Q3: Blind spot probe (always useful for the interviewer)
  questions.push(qByTheme.blindspot[primary]);

  return questions;
}

// ---- deterministic fallback narrative (no AI) ------------------------------
function deterministicNarrative(profile) {
  const b = profile.behavioral;
  const p = profile.person;
  const a = profile.archetype;
  const [e, sn, tf, jp] = b.mbti.type.split("");
  const disc = b.disc;
  const num = profile.numerology;
  const ast = profile.astrology;

  const strengths = Object.entries(b.traits)
    .sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k]) => k);

  const numLine = num && num.available
    ? `Life Path ${num.lifePath} (${NUMBER_MEANING[num.lifePath] || "core themes"})`
      + (num.expression ? `, Expression ${num.expression} (${NUMBER_MEANING[num.expression] || ""})` : "")
      + (num.soulUrge ? `, Soul Urge ${num.soulUrge} (${NUMBER_MEANING[num.soulUrge] || ""})` : "")
    : "Numerology information was not provided.";

  const astLine = astrologyBehaviorSentences(ast);

  // ---- page1.executiveSummary ----
  const summaries = {
    D: [
      `${p.firstName} is ${a.name} \u2014 someone who operates with a bias toward action and a direct relationship with results.`,
      `They move fast, own outcomes, and expect the same level of commitment from the people around them.`,
      `They perform at their best when given real authority, clear goals, and the freedom to execute without excessive oversight.`,
    ],
    I: [
      `${p.firstName} is ${a.name} \u2014 someone who brings energy, connection, and natural persuasion to everything they touch.`,
      `They\u2019re animated in their work, quick to build relationships, and at their best when they can champion something they believe in.`,
      `Environments that give them variety, people-contact, and room to make an impact bring out their strongest performance.`,
    ],
    S: [
      `${p.firstName} is ${a.name} \u2014 someone whose reliability and consistency make them a stabilizing force wherever they work.`,
      `They build trust through follow-through and show up the same way whether the stakes are high or the moment is quiet.`,
      `They\u2019re at their best in roles where their steady contribution is valued and where they have clarity, real teammates, and a manager who notices what they bring.`,
    ],
    C: [
      `${p.firstName} is ${a.name} \u2014 someone who leads with precision and holds the quality of their work to a genuinely high standard.`,
      `They\u2019re methodical and analytical, and they bring a level of rigor to their role that others rely on even when they don\u2019t name it.`,
      `They perform best in environments that take quality seriously and give them the time and structure to do their work the right way.`,
    ],
  };
  const sumLines = summaries[disc.primary] || summaries["D"];
  const executiveSummary = sumLines.join(" ");

  // ---- page2.communication ----
  const COMM = {
    "D-E": "Communicates with directness and speed \u2014 they lead with the conclusion and expect others to keep up. In group settings, they\u2019re comfortable holding the floor and pushing conversation toward a resolution. Others may initially read this as blunt; those who know them recognize it as efficiency. They\u2019re at their best when discussion moves toward action, not away from it.",
    "D-I": "Blends task-focus with social ease \u2014 they\u2019re direct and confident, but also animated and engaging. Conversations tend to move fast: they have opinions, they state them, and they\u2019re ready to debate. They communicate well with people who can match their energy and engage with substance, not just pleasantries.",
    "I-E": "Naturally expressive and socially energized \u2014 they communicate with warmth, enthusiasm, and a talent for drawing people in. Meetings come alive around them. Their strength is not just what they say but how they make others feel heard and included. They think out loud and may benefit from structured moments to consolidate before deciding.",
    "I-I": "Communicates thoughtfully and with genuine warmth, but prefers depth to volume. They don\u2019t dominate rooms \u2014 they choose moments. When they speak, it tends to be considered and well-received. One-on-one or small-group conversations are where they shine most. They may need encouragement to share early-stage ideas before they\u2019ve fully formed them.",
    "S-E": "Communicates steadily and openly \u2014 they\u2019re approachable, easy to talk to, and reliably follow through on what they say. They don\u2019t rush to fill silence, but they engage warmly when invited. In teams, they\u2019re often the person others feel comfortable coming to \u2014 not because they\u2019re loud, but because they\u2019re consistent.",
    "S-I": "Communicates carefully and deliberately \u2014 they process before they speak and choose their words with intention. They\u2019re unlikely to dominate a meeting, but their contributions carry weight because they\u2019re considered. They prefer to communicate in writing or one-on-one where they can take their time and be heard properly.",
    "C-E": "Precise in content, approachable in delivery \u2014 they communicate with clarity and structure, and they\u2019re more comfortable in discussion than their analytical nature might suggest. They ask good questions, expect accurate answers, and tend to redirect conversations that drift toward opinion without data. Others may notice they prefer substance over small talk.",
    "C-I": "Communicates with precision and purpose. They choose depth over frequency \u2014 when they engage, it\u2019s specific and substantive. They\u2019re unlikely to speak unless they have something considered to add, which means quieter settings where this is valued (written updates, structured review meetings) bring out their best communication.",
  };
  const commKey = `${disc.primary}-${e}`;
  const communication = COMM[commKey] || COMM[`${disc.primary}-E`];

  // ---- page2.leadership ----
  const LEADER = {
    "D-high": "Steps into leadership positions naturally \u2014 they expect to be in front and tend to be. They lead by setting direction and pace, and they don\u2019t wait for consensus before moving. This makes them effective in environments that need momentum, though they may need to deliberately create space for others\u2019 contributions.",
    "D-mid":  "Takes ownership without always needing the title. They lead through results and decisiveness \u2014 when something needs to happen, they make it happen. Their leadership style is pragmatic: less about building culture, more about executing against a goal.",
    "D-low":  "Not a title-seeker, but capable of stepping up when the situation calls for it. Their directness lends authority even when they\u2019re not officially in charge. They lead best when given a defined scope and clear expectations.",
    "I-high": "Leads through influence and energy. Their leadership style is persuasive \u2014 they move people not by mandate but by inspiration. They build coalitions, rally enthusiasm, and can turn skeptics into advocates. Best in roles where driving buy-in matters as much as driving execution.",
    "I-mid":  "Leads best when they can engage others and bring them along. They\u2019re good at rallying support around an idea and keeping morale up through a challenge. More effective in collaborative leadership than in command-and-control structures.",
    "I-low":  "Leads by creating an environment where others feel motivated and included. They rarely lead by assertion, preferring to build agreement and shared purpose before moving forward. This style builds loyalty over time.",
    "S-high": "Leads through steadiness and earned trust. They don\u2019t rush to assert authority \u2014 they build it over time through consistency and reliability. Teams feel secure under their leadership because they\u2019re predictable: people know what they stand for and what to expect.",
    "S-mid":  "Leads by being the person others can count on. They create stability in their teams and are often looked to as a stabilizing presence during uncertainty, even when they don\u2019t hold a formal leadership title.",
    "S-low":  "Leads from the back when possible \u2014 preferring to support the team\u2019s success rather than be at the center of it. This style works particularly well in highly collaborative environments where leadership is distributed.",
    "C-high": "Leads through expertise and precision. They set high standards and expect the same from their team. Their leadership creates quality \u2014 people working under them know that work will be scrutinized and held to a rigorous bar. This style works best when accuracy and compliance matter.",
    "C-mid":  "Leads through depth of knowledge and careful thinking. They\u2019re the person in the room who has done the analysis \u2014 and whose judgment others respect as a result. Leadership authority comes from competence, not presence.",
    "C-low":  "Leads by being the most prepared person at the table. Their authority comes from the quality of their work and the clarity of their thinking rather than from charisma or assertiveness.",
  };
  const leaderKey = `${disc.primary}-${b.traits.leadership >= 66 ? "high" : b.traits.leadership >= 34 ? "mid" : "low"}`;
  const leadership = LEADER[leaderKey];

  // ---- page2.decisionMaking ----
  const DECIDE = {
    "TJ-fast": "Makes decisions quickly and on logic \u2014 they evaluate the facts, form a view, and commit. Structured thinkers who prefer clear criteria over open-ended deliberation. Under pressure, this translates to decisive action that others can follow, even when not everyone has caught up to their reasoning.",
    "TJ-slow": "Thorough and methodical \u2014 they want the facts organized before they decide, and they\u2019re willing to take the time to get there. Once they\u2019ve concluded, they commit fully. Others may sometimes need to set a decision deadline to move things forward, but the decisions themselves tend to be sound.",
    "TP-fast": "Analytical but flexible \u2014 they consider multiple angles quickly and are comfortable deciding before every variable is resolved. They remain open to adjusting course if new data emerges after the fact, which makes them less attached to being right than to getting it right.",
    "TP-slow": "Considers options carefully and prefers to keep things open a little longer than others might. They think laterally, exploring possibilities before converging. This can produce creative solutions, but may frustrate collaborators who prefer faster closure.",
    "FJ-fast": "Blends people-awareness with decisiveness \u2014 they consider how decisions will land before committing, but they don\u2019t stall. Once they\u2019ve weighed the human factors and confirmed alignment with their values, they move. A reliable decision-maker who rarely surprises people.",
    "FJ-slow": "Takes the time to understand how a decision will affect everyone involved before committing. Process-oriented and thoughtful, they make decisions that tend to have strong buy-in because others feel considered. May need to create a personal deadline to avoid over-processing.",
    "FP-fast": "Responsive and empathetic \u2014 they sense what\u2019s needed in the moment and can make judgment calls quickly when they trust their read of the situation. Less reliant on data frameworks, more reliant on contextual awareness and instinct.",
    "FP-slow": "Thoughtful, people-first, and unhurried. They want to understand the full picture \u2014 including the human picture \u2014 before landing somewhere. Open to input right up until the last moment. Best supported with clear criteria for when a decision needs to be final.",
  };
  const decideKey = `${tf}${jp}-${b.traits.decisionSpeed >= 55 ? "fast" : "slow"}`;
  const decisionMaking = DECIDE[decideKey] || DECIDE[`${tf}${jp}-fast`];

  // ---- page2.motivation ----
  const MOTIVATE = {
    D: "Driven by challenge, autonomy, and results. They need to own something \u2014 a goal, a project, a scope of responsibility \u2014 and they need it to matter. Recognition that comes attached to a real achievement lands far better than generic praise. What disengages them quickly: micromanagement, repetitive tasks with no clear end state, and processes that feel bureaucratic without purpose.",
    I: "Energized by connection, variety, and the sense that their work has impact on real people. They thrive when they have an audience \u2014 whether that\u2019s a team, a client, or a broader mission they can articulate and champion. What disengages them: isolation, repetitive admin work, and environments where enthusiasm is treated as superficial rather than useful.",
    S: "Motivated by stability, genuine appreciation, and the sense that their work is meaningful within a team they trust. They don\u2019t need the spotlight \u2014 but they do need to know their contributions are seen and valued. What disengages them: frequent reorganization, unclear expectations, and environments where consistency isn\u2019t rewarded.",
    C: "Driven by mastery, accuracy, and the quiet satisfaction of doing something right. They find meaning in quality \u2014 in delivering work that holds up to scrutiny and that they can stand behind. What disengages them: being pushed to ship something they don\u2019t believe in, environments that celebrate speed over care, and roles without clear standards.",
  };
  const motivation = MOTIVATE[disc.primary];

  // ---- page2.collaboration ----
  const collaboration = b.traits.independence >= 66
    ? "Works best with real ownership. They collaborate effectively when roles are clear and their lane is defined, but they can become frustrated in structures where everything requires consensus or approval. They contribute their strongest work when trusted to execute independently, then bring it to the group."
    : (b.traits.steadiness || 0) >= 66
    ? "Genuinely collaborative at their core \u2014 they find energy in working alongside others and see team success as their own. They\u2019re the kind of colleague who asks whether others need support before being asked, and who creates the psychological safety that makes teams work well together."
    : "Balances independent work with team engagement well. They can go heads-down when needed and surface for collaboration when it adds value. They\u2019re not likely to be the loudest voice in a group, but they\u2019re a reliable presence who gets things done whether working alone or alongside others.";

  // ---- page2.friction ----
  const FRICTION = {
    D: "Most likely when pace slows, autonomy narrows, or they sense they\u2019re being managed rather than trusted. Under high pressure, their directness can sharpen into bluntness \u2014 not as aggression, but as efficiency in a mode that doesn\u2019t account for how it lands. The teams that work best with them have learned to interpret this as urgency, not dismissal.",
    I: "Most likely when enthusiasm isn\u2019t matched, or when they\u2019re pulled into detail work that feels disconnected from impact. Under pressure, they may move fast and leave follow-through gaps that others have to fill. Environments that value their energy but hold them accountable to closure get the best of them.",
    S: "Most likely when change is frequent and unannounced, or when expectations shift without explanation. They can absorb a lot \u2014 but they absorb it quietly, which means friction can build without being visible. The best managers of this profile check in regularly and create a safe space for them to express concern early.",
    C: "Most likely when standards slip around them, or when they\u2019re pushed to deliver before they feel ready. They can become perfectionistic under pressure in ways that slow execution. Clear criteria for \u2018good enough\u2019 \u2014 set in advance \u2014 help them move forward without sacrificing the quality they care about.",
  };
  const friction = FRICTION[disc.primary];

  // ---- page5.manage ----
  const MANAGE = {
    D: "Give them a clear goal, define the outcome, and step back. Autonomy is not a perk to them \u2014 it\u2019s a requirement for their best work. Check in on results, not on process. When things go sideways, engage them as a partner in solving it: they respond to \u2018how do we fix this\u2019 far better than \u2018why did this happen.\u2019 Avoid hovering, avoid bureaucratic checkpoints, and never make them feel like they need permission to do their job.",
    I: "Keep communication frequent and human \u2014 they want to know where things stand and that they\u2019re valued, not just as a performer but as a person. Give them variety where possible. When something isn\u2019t working, be direct but wrap it in context: lead with what they\u2019re doing well before addressing the gap. They respond to recognition and will work harder for a manager they feel genuinely connected to.",
    S: "Create consistency and clarity in their environment \u2014 they perform at their best when they know what\u2019s expected and trust that the goalposts won\u2019t move without warning. Give feedback regularly, not just at review time. Be direct, but be kind: they\u2019re unlikely to push back, which means unaddressed concerns can sit and simmer. Ask them how they\u2019re doing and actually wait for the answer.",
    C: "Give context, not just instructions. They want to understand why before they commit to how \u2014 this isn\u2019t resistance, it\u2019s how they operate at quality. Allow them time to do it right: rushing them tends to produce exactly the rework you were trying to avoid. When giving feedback, be specific and data-grounded. They can handle directness; vague criticism is what frustrates them.",
  };
  const manage = MANAGE[disc.primary];

  // ---- page5.motivate ----
  const MOTIVATE_P5 = {
    D: "Set the bar high and let them know it. They\u2019re motivated by targets that feel like real challenges, not performance theater. Reward outcomes with expanded authority or responsibility \u2014 that lands better than words of affirmation alone. A stretch goal with meaningful stakes will bring out their best. What pulls them away: comfortable routines, soft expectations, and recognition that feels generic.",
    I: "Make them feel seen and valued \u2014 not just as a contributor but as a person. Public recognition, being included in high-profile work, and having their ideas taken seriously are powerful motivators. What disengages them: feeling invisible, being given no room to influence, or being kept in a narrowly defined lane with no room to connect with others.",
    S: "Show consistent appreciation for what they bring \u2014 their reliability, their steadiness, their quiet contribution to team cohesion. They don\u2019t need grand gestures; they need to know their work is noticed and that they\u2019re part of something stable and meaningful. What disengages them: environments that reward only high-energy output and overlook steady, reliable performance.",
    C: "Give them work that requires real skill and allow them to do it with care. The chance to produce something they\u2019re truly proud of is genuinely motivating. What disengages them: being asked to cut corners, being in environments where quality isn\u2019t valued, and having their expertise underutilized.",
  };
  const motivate = MOTIVATE_P5[disc.primary];

  // ---- page5.feedback ----
  const FEEDBACK = {
    "T-D": "Be direct and specific \u2014 they can handle it, and they prefer it. Frame feedback around outcomes and behaviors, not personality. Lead with what needs to change and why it matters for results. Skip the preamble; they\u2019ll sense it and disengage before you\u2019ve made your point.",
    "T-I": "Be honest and specific, but set a relational tone first \u2014 a moment of connection before the substance. They\u2019re not fragile, but feedback lands better when it comes from someone they trust. Ground your points in observable behavior and specific examples.",
    "T-S": "Give it in private and with patience. They\u2019ll absorb critical feedback without much visible reaction, but that doesn\u2019t mean it isn\u2019t registering deeply. Be specific, stay behavioral, and follow up. Make sure they have a chance to respond \u2014 even if their first answer is \u2018I\u2019m fine.\u2019",
    "T-C": "Be methodical and evidence-based. Vague feedback frustrates them because they can\u2019t act on it precisely. Bring specifics. Give them time to process and respond \u2014 they may need to think before they react, and that\u2019s not avoidance, it\u2019s how they work.",
    "F-D": "Direct but not harsh \u2014 they care about relationships and will push back if feedback feels disrespectful, even if it\u2019s accurate. Frame it around impact: \u2018Here\u2019s how this landed, and here\u2019s why it matters.\u2019 They respond well when they trust that the feedback comes from genuine investment in their success.",
    "F-I": "Warm, honest, and human. Lead with what\u2019s going well \u2014 they\u2019re motivated by encouragement \u2014 then address what needs to shift with care. Use \u2018and\u2019 instead of \u2018but\u2019 where possible. Close with what you believe they\u2019re capable of. They respond to belief in them.",
    "F-S": "Gentle, private, and relationship-aware. They need to feel safe before they can hear difficult feedback. Build trust before delivering anything challenging. Frame it around support: \u2018I want to help you succeed here, and here\u2019s what I\u2019m noticing.\u2019 Give them time after the conversation \u2014 they may need to sit with it.",
    "F-C": "Be caring and specific. They take quality seriously and may internalize criticism as a reflection of their worth rather than their output. Make clear that the feedback is about the work, not the person. Give them something concrete to act on so they don\u2019t spiral into self-correction without direction.",
  };
  const feedbackKey = `${tf}-${disc.primary}`;
  const feedback = FEEDBACK[feedbackKey] || FEEDBACK[`${tf}-D`];

  // ---- page5.interview ---- (returns array of 3 behavioral questions)
  const interview = buildInterviewQuestions(disc, b.traits, b.mbti);

  // ---- page5.environment ----
  const ENVIRON = {
    D: "Fast-moving, goal-oriented, and results-focused. They need real ownership over something that matters \u2014 a project, a client, a business line. Structure is fine when it serves speed; bureaucracy that slows without adding value will cost their engagement. Best in roles where urgency is the norm and performance is visible.",
    I: "Dynamic, people-rich, and varied enough to keep them engaged. They thrive when they have an audience for their work \u2014 whether that\u2019s a team they rally, a client they win, or a mission they can speak to. Roles that combine relationship-building with tangible output bring out their best.",
    S: "Stable, clearly defined, and relationship-oriented. They perform well in environments where they know the rules, trust their team, and can see how their contribution fits into the whole. They\u2019re not looking for constant change \u2014 they\u2019re looking for meaningful consistency and the chance to build something over time.",
    C: "Precision-driven, quality-conscious, and structured. Environments that reward thoroughness and accuracy \u2014 where errors have real consequences and doing it right matters \u2014 are where they naturally thrive. They need enough time to do their work at the standard they hold themselves to.",
  };
  const environment5 = ENVIRON[disc.primary];

  // ---- page5.needsFromManager ----
  const NEEDS = {
    D: "Clear outcomes, real authority, and minimal interference. They need a manager who engages at the level of \u2018what\u2019 and \u2018why\u2019 \u2014 not \u2018how.\u2019 When things go sideways, they need a partner in solving it, not a supervisor managing around them. They also need to know there\u2019s room to grow: a ceiling motivates them to find the door.",
    I: "Genuine connection and consistent recognition. They need a manager who sees them \u2014 not just their outputs \u2014 and who communicates frequently enough that they never feel out of the loop. When something isn\u2019t working, they need to hear it in a relational way, not a transactional one. They work hardest for managers they like.",
    S: "Clarity, consistency, and genuine appreciation. They need to know what\u2019s expected and trust that the expectations won\u2019t shift without warning. Regular check-ins \u2014 not as performance reviews, but as real conversations \u2014 matter to them more than most managers realize. They also need psychological safety to raise concerns: they won\u2019t push back if they don\u2019t feel safe doing it.",
    C: "Context, time, and high standards. They need a manager who explains the \u2018why\u2019 behind direction and doesn\u2019t rush them past quality. They respond to specificity: vague praise and vague criticism are both equally unhelpful to them. They also need to trust that their manager values accuracy and isn\u2019t willing to cut corners they care about.",
  };
  const needsFromManager = NEEDS[disc.primary];

  return {
    page1: {
      executiveSummary,
      strengths,
      naturalTendencies: `Primary style: ${DISC_TEXT[disc.primary]}. Secondary: ${DISC_TEXT[disc.secondary]}.`,
    },
    page2: {
      communication,
      leadership,
      decisionMaking,
      environment: jp === "J" ? "Prefers structure, clear plans, and defined expectations."
        : "Prefers flexibility, autonomy, and room to adapt.",
      motivation,
      collaboration,
      friction,
    },
    page3: {
      mbtiNarrative: `16-type (Jungian-inspired) code ${b.mbti.type}: ${MBTI_AXIS_TEXT[e]}, ${MBTI_AXIS_TEXT[sn]}, ${MBTI_AXIS_TEXT[tf]}, ${MBTI_AXIS_TEXT[jp]}.`
        + (b.mbti.balancedAxes.length ? ` Balanced on: ${b.mbti.balancedAxes.join(", ")}.` : ""),
      discNarrative: `DISC-style profile: primary ${disc.primary}, secondary ${disc.secondary}. `
        + `Scores D:${disc.scores.D} I:${disc.scores.I} S:${disc.scores.S} C:${disc.scores.C}.`,
      piNarrative: `Workplace factors (PI-inspired): Dominance ${b.pi.bands.dominance}, `
        + `Extraversion ${b.pi.bands.extraversion}, Patience ${b.pi.bands.patience}, Formality ${b.pi.bands.formality}.`,
    },
    page4: {
      astrologyNarrative: astLine,
      numerologyNarrative: numLine,
      integration: profile.integration?.resonance?.summary || "Behavioral results are the primary basis; other systems add context only.",
    },
    page5: {
      manage,
      motivate,
      feedback,
      environment: environment5,
      blindSpots: disc.primary === "D"
        ? "Patience and stakeholder buy-in \u2014 under pressure, their pace can outrun others\u2019 willingness to follow."
        : disc.primary === "I"
        ? "Follow-through on detail and administrative closure \u2014 starting is easy; finishing the last 10% is where they need structure."
        : disc.primary === "S"
        ? "Speed and comfort with ambiguity \u2014 they do best when expectations are clear, and can struggle when asked to move fast without a map."
        : "Perfectionism under time pressure \u2014 their standards are an asset until they become a blocker.",
      interview,
      needsFromManager,
      bestFit: disc.primary === "D" ? "Fast-moving, goal-driven roles with real ownership and visible performance."
        : disc.primary === "I" ? "People-facing, collaborative, and dynamic roles with variety and impact."
        : disc.primary === "S" ? "Stable, supportive, and process-oriented roles within a team they can trust."
        : "Precision-oriented, analytical, and quality-critical roles where rigor is genuinely valued.",
      hiringSummary: `${p.firstName} fits best in environments aligned to a ${a.name} profile. `
        + `Use the behavioral results as the decision basis; treat astrology/numerology as supplementary color.`,
    },
  };
}

// ---- render the final report object ----------------------------------------
// narrative: either AI-produced (matching NARRATIVE_SHAPE) or null to use fallback.
function renderReport(profile, narrative = null) {
  const n = narrative || deterministicNarrative(profile);
  const generatedBy = narrative ? "ai" : "deterministic";
  const name = `${profile.person.firstName} ${profile.person.lastName}`;
  return {
    meta: { name, generatedBy, createdAt: profile.createdAt, archetype: profile.archetype.name },
    disclaimer: DISCLAIMER,
    pages: {
      1: { title: "Personality Snapshot", ...n.page1 },
      2: { title: "Work & Communication", ...n.page2 },
      // Page 3 "Personality Assessment" (raw MBTI/DISC/PI narrative) intentionally
      // omitted from the candidate-facing report per client request (hiring use).
      // Behavioral scoring still runs upstream and drives the archetype + Page 4
      // "How to Work With This Person". Raw scores remain in profile.behavioral.
      3: { title: "Astrology + Numerology", ...n.page4 },
      4: { title: "How to Work With This Person", ...n.page5 },
    },
  };
}

module.exports = {
  DISCLAIMER, NARRATIVE_SHAPE,
  buildReportPayload, deterministicNarrative, renderReport,
};
