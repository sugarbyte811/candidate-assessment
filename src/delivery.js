// Phase 6b - Email delivery + Firestore storage. Both have safe dry-run
// fallbacks so the full pipeline runs (and tests) offline with zero spend.

const fs = require("fs");

// ---- Email (participant + admin) -------------------------------------------
// Uses nodemailer if SMTP env is configured; otherwise dry-run (logs, no send).
// Env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, ADMIN_EMAIL
async function sendReportEmails({ report, pdf, participantEmail, adminEmail, opts = {} }) {
  const from = opts.from || process.env.MAIL_FROM || "no-reply@palmbeachplacements.com";
  const admin = adminEmail || process.env.ADMIN_EMAIL;
  const subject = `Candidate Assessment - ${report.meta.name}`;
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

// ---- Purchase fulfilment email ---------------------------------------------
// Sent to whoever bought a report. Returns a result object describing exactly
// what happened; it never reports success for a message it did not send.
async function sendPurchaseEmail({ to, productTitle, downloadUrl, pdfPath, opts = {} }) {
  const from = opts.from || process.env.MAIL_FROM || "no-reply@palmbeachplacements.com";
  if (!to) return { sent: false, reason: "no recipient address" };

  const smtpReady = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
  if (!smtpReady) {
    return { sent: false, reason: "SMTP not configured", missing: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"].filter((k) => !process.env[k]) };
  }

  let nodemailer;
  try { nodemailer = require("nodemailer"); }
  catch { return { sent: false, reason: "nodemailer not installed" }; }

  const title = productTitle || "your report";
  const lines = [
    `Thank you for your purchase.`,
    ``,
    `Your ${title} is ready.`,
    ``,
  ];
  if (downloadUrl) lines.push(`Download it here:`, downloadUrl, ``);
  if (pdfPath && fs.existsSync(pdfPath)) lines.push(`Your behavioral profile PDF is attached.`, ``);
  lines.push(`If you have any trouble opening this, just reply to this email.`);

  // Branded HTML version. Table layout and inline styles, because email
  // clients ignore stylesheets and modern CSS.
  const NAVY = "#0F2744";
  const GOLD = "#C5A95A";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const button = downloadUrl ? `
              <tr><td align="center" style="padding:8px 0 28px;">
                <a href="${esc(downloadUrl)}"
                   style="display:inline-block;background:${GOLD};color:${NAVY};text-decoration:none;
                          font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;
                          letter-spacing:.04em;padding:14px 34px;border-radius:4px;">
                  DOWNLOAD YOUR REPORT
                </a>
              </td></tr>` : "";
  const attachNote = (pdfPath && fs.existsSync(pdfPath)) ? `
              <tr><td style="padding:0 40px 20px;font-family:Helvetica,Arial,sans-serif;
                            font-size:14px;color:#5A6472;">
                Your behavioral profile PDF is attached to this email.
              </td></tr>` : "";

  const htmlUnused = `<!doctype html>
<html><body style="margin:0;padding:0;background:#F4F5F7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F7;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#FFFFFF;border-radius:6px;overflow:hidden;
                    border:1px solid #E3E6EA;">
        <tr><td style="background:${NAVY};padding:26px 40px;">
          <div style="font-family:Helvetica,Arial,sans-serif;font-size:17px;font-weight:bold;
                      letter-spacing:.14em;color:#FFFFFF;">PALM BEACH PLACEMENTS</div>
        </td></tr>
        <tr><td style="height:3px;background:${GOLD};"></td></tr>
        <tr><td style="padding:34px 40px 10px;font-family:Helvetica,Arial,sans-serif;
                      font-size:21px;font-weight:bold;color:${NAVY};">
          Your ${esc(title)} is ready
        </td></tr>
        <tr><td style="padding:0 40px 24px;font-family:Helvetica,Arial,sans-serif;
                      font-size:15px;line-height:1.6;color:#3D4753;">
          Thank you for your purchase. Your personalized report has been generated
          and is ready to view.
        </td></tr>
        ${button}
        ${attachNote}
        <tr><td style="padding:0 40px 30px;font-family:Helvetica,Arial,sans-serif;
                      font-size:13px;line-height:1.6;color:#7A8494;">
          Having trouble? Just reply to this email and we will help.
        </td></tr>
        <tr><td style="background:#FAFBFC;border-top:1px solid #E3E6EA;padding:16px 40px;
                      font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#9AA3B0;">
          Palm Beach Placements &middot; Confidential
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const attachments = pdfPath && fs.existsSync(pdfPath)
    ? [{ filename: pdfPath.split("/").pop(), path: pdfPath }] : [];

  // Attach the generated report itself rather than making the buyer click a
  // link. A raw storage URL looks like spam and gets flagged as unverified.
  if (downloadUrl) {
    try {
      const res = await fetch(downloadUrl);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        attachments.push({
          filename: `${title.replace(/[^A-Za-z0-9 ]/g, "").trim() || "Report"}.pdf`,
          content: buf,
          contentType: "application/pdf",
        });
      }
    } catch (e) {
      console.error("[email] could not attach report:", e.message);
    }
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const info = await transporter.sendMail({
    from: opts.fromName === false ? from : `Palm Beach Placements <${from}>`,
    to,
    replyTo: from,
    subject: `Your ${title} is ready`,
    text: `Thank you for your order.\n\nYour ${title} is attached.`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#3D4753;">`
        + `<p>Thank you for your order.</p><p>Your ${esc(title)} is attached.</p></div>`,
    attachments,
  });
  return { sent: true, to, id: info.messageId, attachments: attachments.length };
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
  if (store[key]) return { stored: false, reused: true, id: key, backend: "local",
    pdfPath: store[key].profile?.delivery?.pdfPath || null,
    report: store[key].report || null,
  };
  store[key] = { profile, report, createdAt: profile.createdAt };
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
  return { stored: true, reused: false, id: key, backend: "local" };
}

module.exports = { sendReportEmails, sendPurchaseEmail, storeAssessment, peekStored };

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
        return { reused: true, id: key, backend: "firestore", report: data.report || null,
          pdfPath: data.profile?.delivery?.pdfPath || null,
        };
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
