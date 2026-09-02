// Phase 6b — Email delivery + Firestore storage. Both have safe dry-run
// fallbacks so the full pipeline runs (and tests) offline with zero spend.

const fs = require("fs");

// ---- Email (participant + admin) -------------------------------------------
// Uses nodemailer if SMTP env is configured; otherwise dry-run (logs, no send).
// Env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, ADMIN_EMAIL
async function sendReportEmails({ report, pdf, participantEmail, adminEmail, opts = {} }) {
  const from = opts.from || process.env.MAIL_FROM || "no-reply@palmbeachplacements.com";
  const admin = adminEmail || process.env.ADMIN_EMAIL;
  const subject = `Candidate Assessment — ${report.meta.name}`;
  const bodyText =
    `Attached is the completed candidate assessment for ${report.meta.name}.\n\n` +
    `Archetype: ${report.meta.archetype}\nGenerated: ${report.meta.createdAt}\n\n` +
    `${report.disclaimer}`;

  const attachments = pdf?.path && fs.existsSync(pdf.path)
    ? [{ filename: pdf.path.split("/").pop(), path: pdf.path }] : [];

  const recipients = [];
  if (participantEmail) recipients.push({ to: participantEmail, role: "participant" });
  if (admin) recipients.push({ to: admin, role: "admin" });

  let transporter = null;
  const smtpReady = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
  if (smtpReady) {
    let nodemailer;
    try { nodemailer = require("nodemailer"); } catch { nodemailer = null; }
    if (nodemailer) {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
    }
  }

  const results = [];
  for (const r of recipients) {
    if (transporter) {
      const info = await transporter.sendMail({
        from, to: r.to, subject, text: bodyText, attachments,
      });
      results.push({ to: r.to, role: r.role, sent: true, id: info.messageId });
    } else {
      results.push({ to: r.to, role: r.role, sent: false, dryRun: true });
    }
  }
  return { sent: !!transporter, from, subject, attachments: attachments.length, results };
}

// ---- Firestore storage with dedupe -----------------------------------------
// Stores the scored profile + report keyed by inputHash so identical
// submissions are NOT regenerated. Uses firebase-admin if credentials exist;
// otherwise persists to a local JSON file (dev/dry-run) with the same dedupe.
async function storeAssessment({ profile, report, opts = {} }) {
  const key = profile.inputHash;

  // Firestore path
  const credsReady = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_SERVICE_ACCOUNT || opts.firestore;
  if (credsReady) {
    let admin;
    try { admin = require("firebase-admin"); } catch { admin = null; }
    if (admin) {
      if (!admin.apps.length) {
        admin.initializeApp(opts.firebaseAppOptions || {
          credential: admin.credential.applicationDefault(),
        });
      }
      const db = admin.firestore();
      const col = db.collection(opts.collection || "assessments");
      const existing = await col.doc(key).get();
      if (existing.exists) {
        return { stored: false, reused: true, id: key, backend: "firestore" };
      }
      await col.doc(key).set({
        profile, report, createdAt: profile.createdAt,
      });
      return { stored: true, reused: false, id: key, backend: "firestore" };
    }
  }

  // Local fallback (dev): dedupe by inputHash in a JSON store.
  const storePath = opts.localStore || "./data/assessments.json";
  fs.mkdirSync(require("path").dirname(storePath), { recursive: true });
  let store = {};
  if (fs.existsSync(storePath)) {
    try { store = JSON.parse(fs.readFileSync(storePath, "utf8")); } catch { store = {}; }
  }
  if (store[key]) return { stored: false, reused: true, id: key, backend: "local" };
  store[key] = { profile, report, createdAt: profile.createdAt };
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
  return { stored: true, reused: false, id: key, backend: "local" };
}

module.exports = { sendReportEmails, storeAssessment, peekStored };

// Read-only existence check for dedupe (does NOT write).
async function peekStored(profile, opts = {}) {
  const key = profile.inputHash;
  const credsReady = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_SERVICE_ACCOUNT || opts.firestore;
  if (credsReady) {
    let admin;
    try { admin = require("firebase-admin"); } catch { admin = null; }
    if (admin) {
      if (!admin.apps.length) {
        admin.initializeApp(opts.firebaseAppOptions || {
          credential: admin.credential.applicationDefault(),
        });
      }
      const db = admin.firestore();
      const doc = await db.collection(opts.collection || "assessments").doc(key).get();
      if (doc.exists) {
        const data = doc.data();
        return { reused: true, id: key, backend: "firestore", report: data.report || null };
      }
      return null;
    }
  }
  const storePath = opts.localStore || "./data/assessments.json";
  if (fs.existsSync(storePath)) {
    try {
      const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
      if (store[key]) return { reused: true, id: key, backend: "local", report: store[key].report || null };
    } catch { /* ignore */ }
  }
  return null;
}
