// Phase 6c — Pipeline orchestrator. One entry point for a completed assessment.
//
// Flow (cost-optimized):
//   1. buildProfile         (deterministic: scoring + numerology + astrology + integration)
//   2. dedupe check         (skip regeneration if this exact submission was stored)
//   3. ONE AI call          (narrative only; falls back to deterministic prose if no key)
//   4. renderReport         (assemble 5 pages)
//   5. renderPdf            (pdfkit -> PDF, or HTML fallback)
//   6. sendReportEmails     (participant + admin; dry-run if no SMTP)
//   7. storeAssessment      (Firestore, or local JSON; dedupe by inputHash)

const { buildProfile } = require("./profile");
const { buildReportPayload, renderReport } = require("./report");
const { generateNarrative } = require("./ai");
const { renderPdf } = require("./pdf");
const { sendReportEmails, storeAssessment, peekStored } = require("./delivery");

async function runAssessment({ person, optional = {}, answers, adminEmail, config = {} }) {
  // 1. deterministic profile
  const profile = buildProfile({ person, optional, answers });

  // 2. dedupe: if this exact submission is already stored, reuse it (no AI, no
  //    regen, no re-email). storeAssessment returns reused=true when the
  //    inputHash already exists.
  const existing = await peekStored(profile, config.storage || {});
  if (existing && existing.reused) {
    return {
      id: existing.id,
      inputHash: profile.inputHash,
      reused: true,
      storage: existing,
      report: existing.report || null,
      profile,
    };
  }

  // 3. ONE AI call (or deterministic fallback)
  let narrative = null;
  try {
    const payload = buildReportPayload(profile);
    narrative = await generateNarrative(payload, config.ai || {});
  } catch (err) {
    narrative = null; // graceful fallback to deterministic prose
    profile._aiError = String(err.message || err);
  }

  // 4. render report
  const report = renderReport(profile, narrative);
  profile.narrative.generatedBy = report.meta.generatedBy;

  // 5. PDF
  const outPath = (config.outDir || "./data/reports") + `/${profile.id}.pdf`;
  const pdf = await renderPdf(report, outPath);
  profile.delivery.pdfPath = pdf.path;

  // 6. emails
  const emailRes = await sendReportEmails({
    report, pdf,
    participantEmail: person.email,
    adminEmail: adminEmail || config.adminEmail,
    opts: config.email || {},
  });
  profile.delivery.participantEmailed = emailRes.results.some((r) => r.role === "participant" && (r.sent || r.dryRun));
  profile.delivery.adminEmailed = emailRes.results.some((r) => r.role === "admin" && (r.sent || r.dryRun));

  // 7. store (dedupe by inputHash)
  const stored = await storeAssessment({ profile, report, opts: config.storage || {} });

  return {
    id: profile.id,
    inputHash: profile.inputHash,
    archetype: profile.archetype,
    generatedBy: report.meta.generatedBy,
    pdf,
    email: emailRes,
    storage: stored,
    report,
    profile,
  };
}

module.exports = { runAssessment };
