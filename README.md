# Candidate Assessment

A low-cost, integrated candidate assessment combining behavioral analysis,
numerology, and astrology into ONE cohesive profile and a 5-page report.

**Cost model:** deterministic-first. Everything is computed locally except a
single optional AI call that polishes the report narrative, plus email sending.
Typical cost per completed assessment: **under ~2 cents**, dominated by the one
AI call. With the deterministic fallback (no AI key), cost is effectively $0.

## Pipeline (one entry point)

```js
const { runAssessment } = require("./src/pipeline");

const result = await runAssessment({
  person:   { firstName, lastName, email, birthday: "YYYY-MM-DD" }, // required
  optional: { birthplace, birthName },                             // optional
  answers:  [/* 17 integers, 1..5 */],
  adminEmail: "admin@palmbeachplacements.com",
  config: { /* ai, email, storage, outDir */ },
});
```

Flow: buildProfile (score + numerology + astrology + integration) → dedupe check
→ **one** AI call (or deterministic fallback) → render 5-page report → PDF →
email participant + admin → store (Firestore or local, deduped by inputHash).

## Phases (all built + tested)

| Phase | Module | What |
|---|---|---|
| 1 | `src/questions.js`, `src/scoring.js`, `src/profile.js` | 17 questions, deterministic scoring, MBTI/DISC/PI-style output |
| 2 | `src/numerology.js` | Life Path, Expression, Soul Urge, Personality, Birthday (Pythagorean, master numbers) |
| 3 | `src/astrology.js` | Offline Sun/planet signs; Moon only when unambiguous (Option B); no houses/Ascendant without birth time |
| 4 | `src/integration.js` | Behavioral-weighted unified profile + archetype; numerology/astrology are secondary context |
| 5 | `src/report.js`, `src/ai.js` | 5-page report; ~80% templated, one AI call for narrative |
| 6 | `src/pdf.js`, `src/delivery.js`, `src/pipeline.js` | PDF, email, Firestore storage, dedupe |

## Configuration (env)

- **AI (optional):** `AI_API_KEY`, `AI_BASE_URL` (default OpenAI), `AI_MODEL` (default gpt-4o-mini). No key → deterministic narrative, $0.
- **Email (optional):** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `ADMIN_EMAIL`. No SMTP → dry-run.
- **Storage (optional):** `GOOGLE_APPLICATION_CREDENTIALS` for Firestore. No creds → local JSON store.

All external steps degrade gracefully to a dry-run so the whole thing is
testable offline with zero spend.

## Tests

```bash
npm test        # runs test/phase1..6
```

## Legal

Reports are **inspired** by established frameworks and are **not affiliated with,
endorsed by, or a substitute for** the official MBTI®, DISC, or Predictive
Index® assessments. Astrology/numerology are interpretive context only. Do not
use as the sole basis for an employment decision; behavioral results are the
only decision-relevant component. Personality/astrology-based hiring carries
EEOC / disparate-impact risk — get legal review before production hiring use.
