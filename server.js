// Demo web server. Pure Node http, no framework. Serves the intake form and
// runs the assessment pipeline. Reports + PDFs are written under ./data and
// served back for download. Runs in dry-run mode (no email/Firestore) unless
// env keys are set - perfect for a shareable demo link.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { QUESTIONS } = require("./src/questions");
const { DISCLAIMER } = require("./src/report");
const { runAssessment } = require("./src/pipeline");
const { generateReport } = require("./src/firebase-report");
const { sendReportEmails, sendPurchaseEmail } = require("./src/delivery");
const { computeAstrology } = require("./src/astrology");
const GEO = require("./src/geo");
const store = require("./src/store");

const PORT = process.env.PORT || 8787;
const PUBLIC = path.join(__dirname, "public");
const DATA = path.join(__dirname, "data");
const REPORTS = path.join(DATA, "reports");
fs.mkdirSync(REPORTS, { recursive: true });

// ---- JSON data stores -------------------------------------------------------
const ASSESSMENTS_BY_EMAIL = path.join(DATA, "assessments-by-email.json");
const PARTNER_INVITES      = path.join(DATA, "partner-invites.json");

// Firestore when FIREBASE_SERVICE_ACCOUNT is set, local JSON files otherwise.
store.init({ assessmentsPath: ASSESSMENTS_BY_EMAIL, invitesPath: PARTNER_INVITES });

// Unambiguous alphabet: no O/0, I/1, so codes survive being read off a screen.
function makeAccessCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return out;
}

function readJsonStore(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore corrupt file */ }
  return {};
}

function writeJsonStore(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

// Shopify product handle -> Pinnacle product_id
const PRODUCT_MAP = {
  "personal-year-forecast":  "personal_year_forecast",
  "power-wealth-report":     "power_wealth_report",
  "career-edge-report":      "career_edge",
  "compatibility-report":    "compatibility_deep_dive",
  "business-partner-report": "compatibility_deep_dive",
};

// Shopify order webhooks do NOT include a product handle on line items, so a
// handle-only lookup silently matched nothing and no report was ever built.
// Variant id is the most reliable identifier present on the payload; title is
// the human-readable fallback.
const VARIANT_MAP = {
  "45400241602742": "personal_year_forecast",
  "45402285015222": "career_edge",
  "45402285047990": "power_wealth_report",
  "45402285080758": "compatibility_deep_dive",
};

const TITLE_MAP = {
  "personal year forecast":        "personal_year_forecast",
  "career edge report":            "career_edge",
  "power and wealth report":       "power_wealth_report",
  "power wealth report":           "power_wealth_report",
  "you and your business partner": "compatibility_deep_dive",
  "business partner report":       "compatibility_deep_dive",
  "compatibility report":          "compatibility_deep_dive",
};

// Resolve a Pinnacle product id from a Shopify line item, trying every
// identifier the payload might actually carry.
function resolveProductId(item) {
  if (!item) return null;
  const variantId = String(item.variant_id || "");
  if (VARIANT_MAP[variantId]) return VARIANT_MAP[variantId];

  const handle = item.handle || item.product_handle || "";
  if (handle && PRODUCT_MAP[handle]) return PRODUCT_MAP[handle];

  const sku = String(item.sku || "").toLowerCase();
  if (sku && PRODUCT_MAP[sku]) return PRODUCT_MAP[sku];

  const title = String(item.title || item.name || "").toLowerCase().trim()
    .replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "");
  if (title && TITLE_MAP[title]) return TITLE_MAP[title];

  return null;
}

// The buyer's address can arrive in several places depending on whether the
// checkout was a guest checkout. Cart attributes carry the address captured
// during the assessment, which is the one the report belongs to.
function resolveOrderEmail(order) {
  const attrs = {};
  for (const a of order.note_attributes || []) {
    if (a && a.name) attrs[a.name] = a.value;
  }
  return String(
    attrs.assessment_email ||
    order.email ||
    order.contact_email ||
    (order.customer && order.customer.email) ||
    ""
  ).toLowerCase() || null;
}

function resolveAssessmentId(order) {
  for (const a of order.note_attributes || []) {
    if (a && a.name === "assessment_id") return a.value;
  }
  return null;
}

// Generate and deliver every purchased report on an order. Returns a per-item
// outcome so a failed delivery is visible instead of silently swallowed.
async function fulfillOrder(order) {
  const outcome = { order: order.name || order.id || "(unknown)", email: null, items: [] };

  const customerEmail = resolveOrderEmail(order);
  outcome.email = customerEmail;
  if (!customerEmail) {
    outcome.error = "No buyer email found on the order.";
    console.error("[fulfill] no email on order", outcome.order);
    return outcome;
  }

  const assessment   = await store.getAssessmentByEmail(customerEmail);
  const assessmentId = resolveAssessmentId(order) ||
    (assessment && assessment.assessmentId) || null;

  // The behavioral PDF that was already generated for this person, if any.
  let pdfPath = null;
  if (assessmentId) {
    const candidate = path.join(REPORTS, `${assessmentId}.pdf`);
    if (fs.existsSync(candidate)) pdfPath = candidate;
  }
  if (!pdfPath && assessment && assessment.pdfUrl) {
    const candidate = path.join(REPORTS, path.basename(assessment.pdfUrl));
    if (fs.existsSync(candidate)) pdfPath = candidate;
  }

  for (const item of order.line_items || []) {
    const productId = resolveProductId(item);
    const entry = { title: item.title || item.name, variantId: item.variant_id, productId };

    if (!productId) {
      entry.status = "skipped: no product match";
      console.error("[fulfill] unmatched line item", JSON.stringify(entry));
      outcome.items.push(entry);
      continue;
    }

    // The Pinnacle backend requires full_name and birthdate as YYYY-MM-DD.
    // Sending `name` produced a 400 on every single order.
    const override = order.person_a || {};
    const fullName = override.full_name ||
      (assessment ? [assessment.firstName, assessment.lastName].filter(Boolean).join(" ") : "");
    const birthdate = override.birthdate || (assessment && assessment.birthday) || null;
    // Attach the behavioural and astrological layers so the report can
    // synthesize all three systems rather than leaning on numerology alone.
    let astro = null;
    if (birthdate) {
      try {
        astro = computeAstrology({ birthday: birthdate, birthplace: null });
      } catch (e) {
        console.error("[fulfill] astrology unavailable:", e.message);
      }
    }

    const personA = (fullName && birthdate)
      ? {
          full_name: fullName,
          birthdate,
          astrology: astro,
          assessment: assessment ? {
            archetype:   assessment.archetype || null,
            disc_scores: assessment.discScores || null,
            traits:      assessment.traits || null,
          } : null,
        }
      : null;

    if (!personA) {
      entry.status = "skipped: missing name or birthdate for this buyer";
      entry.lookedUp = { assessmentFound: !!assessment, fullName: fullName || null, birthdate };
      console.error("[fulfill] cannot build person_a", JSON.stringify(entry.lookedUp));
      outcome.items.push(entry);
      continue;
    }

    // The behavioural layer belongs in every report, not only career_edge.
    const discProfile = (assessment && assessment.discScores) || null;

    let generated = null;
    try {
      generated = await generateReport({ productId, personA, discProfile, customerEmail });
      entry.generated = generated
        ? { reportId: generated.reportId, title: generated.title, downloadUrl: generated.downloadUrl }
        : null;
    } catch (e) {
      entry.generated = null;
      entry.generateError = e.message;
      console.error(`[fulfill] generation failed for ${productId}:`, e.message);
    }

    // Deliver whatever we have. A generation failure must not also mean silence.
    try {
      const mail = await sendPurchaseEmail({
        to: customerEmail,
        productTitle: (generated && generated.title) || item.title || productId,
        downloadUrl: generated && generated.downloadUrl,
        pdfPath,
      });
      entry.email = mail;
      entry.status = mail.sent ? "delivered" : `not delivered: ${mail.reason}`;
      console.log(`[fulfill] ${productId} -> ${customerEmail}: ${entry.status}`);
    } catch (e) {
      entry.status = `email failed: ${e.message}`;
      console.error(`[fulfill] email failed for ${customerEmail}:`, e.message);
    }

    outcome.items.push(entry);
  }

  return outcome;
}

const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on("end", () => resolve(d));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // API: questions + disclaimer
    if (url.pathname === "/api/questions" && req.method === "GET") {
      return send(res, 200, {
        questions: QUESTIONS.map((q) => ({ id: q.id, text: q.text })),
        disclaimer: DISCLAIMER,
      });
    }

    // API: birthplace geo (country -> cities)
    if (url.pathname === "/api/geo" && req.method === "GET") {
      return send(res, 200, GEO);
    }

    // API: run assessment
    if (url.pathname === "/api/assess" && req.method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}");
      if (!body.person || !Array.isArray(body.answers) || body.answers.length !== 17) {
        return send(res, 400, { error: "Need person + 17 answers." });
      }
      // Stable per-email access code, reused across retakes so an earlier PDF
      // keeps working. Generated before the run so it can be printed on the PDF.
      const priorEmail = (body.person.email || "").toLowerCase();
      const prior      = priorEmail ? await store.getAssessmentByEmail(priorEmail) : null;
      const accessCode = (prior && prior.accessCode) || makeAccessCode();

      const result = await runAssessment({
        person: { ...body.person, accessCode },
        optional: body.optional || {},
        answers: body.answers.map(Number),
        adminEmail: process.env.ADMIN_EMAIL,
        config: { outDir: REPORTS, storage: { localStore: path.join(DATA, "assessments.json") } },
      });
      const pdfFilePath = result.pdf?.path || result.profile?.delivery?.pdfPath || null;
      const pdfName = pdfFilePath ? path.basename(pdfFilePath) : null;
      return send(res, 200, {
        id: result.id,
        accessCode,
        archetype: result.archetype,
        report: result.report,
        generatedBy: result.generatedBy,
        pdfUrl: pdfName ? `/reports/${pdfName}` : null,
        emailed: result.email ? result.email.results : [],
        scores: {
          traits: result.profile.behavioral.traits,
          disc:   result.profile.behavioral.disc,
          pi:     result.profile.behavioral.pi,
          mbti:   result.profile.behavioral.mbti,
        },
      });
    }

    // ── Save assessment by email (called after assessment completes) ──────────
    if (url.pathname === "/api/save-assessment" && req.method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}");
      const { email } = body;
      if (!email) return send(res, 400, { error: "email required" });
      const key      = email.toLowerCase();
      const existing = await store.getAssessmentByEmail(key);
      // Prefer the code minted during /api/assess (it is the one printed on the
      // PDF), then any code already on file, and only mint as a last resort.
      const accessCode =
        body.accessCode ||
        (existing && existing.accessCode) ||
        makeAccessCode();
      await store.saveAssessmentByEmail(key, { ...body, accessCode, savedAt: new Date().toISOString() });
      return send(res, 200, { ok: true, accessCode });
    }

    // ── Look up a saved assessment by email ──────────────────────────────────
    if (url.pathname === "/api/my-assessment" && req.method === "GET") {
      const email = (url.searchParams.get("email") || "").trim().toLowerCase();
      const code  = (url.searchParams.get("code")  || "").trim().toUpperCase();
      if (!email) return send(res, 400, { error: "email required" });
      if (!code)  return send(res, 400, { error: "access code required" });
      const found = await store.getAssessmentByEmail(email);
      // Same response for unknown email and wrong code, so this cannot be used
      // to discover which email addresses have taken the assessment.
      if (!found || String(found.accessCode || "").toUpperCase() !== code) {
        return send(res, 403, { error: "That email and access code do not match." });
      }
      return send(res, 200, { ok: true, assessment: found });
    }

    // ── Email a copy of the report to the participant ─────────────────────
    if (url.pathname === "/api/email-report" && req.method === "POST") {
      const body  = JSON.parse(await readBody(req) || "{}");
      const email = String(body.email || "").trim().toLowerCase();
      const code  = String(body.accessCode || "").trim().toUpperCase();
      if (!email) return send(res, 400, { error: "email required" });
      if (!code)  return send(res, 400, { error: "access code required" });

      const found = await store.getAssessmentByEmail(email);
      // Same response for unknown email and wrong code, so this cannot be used
      // to discover which email addresses have taken the assessment.
      if (!found || String(found.accessCode || "").toUpperCase() !== code) {
        return send(res, 403, { error: "That email and access code do not match." });
      }

      // Locate the PDF that was already generated for this assessment.
      const pdfName =
        (found.pdfUrl ? path.basename(found.pdfUrl) : null) ||
        (found.assessmentId ? `${found.assessmentId}.pdf` : null);
      const pdfPath = pdfName ? path.join(REPORTS, pdfName) : null;
      if (!pdfPath || !fs.existsSync(pdfPath)) {
        return send(res, 404, { error: "No report PDF found for that assessment. Retake or regenerate it first." });
      }

      // Refuse to imply delivery when the mailer is not configured.
      const smtpReady = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
      if (!smtpReady) {
        return send(res, 503, {
          error: "Email delivery is not configured on this server, so nothing was sent.",
          configured: false,
          missing: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"].filter((k) => !process.env[k]),
        });
      }

      const displayName =
        [found.firstName, found.lastName].filter(Boolean).join(" ") || email;
      // sendReportEmails only reads meta.name, meta.archetype, meta.createdAt
      // and disclaimer, so a minimal report object is enough for a resend.
      const reportForEmail = {
        meta: {
          name:      displayName,
          archetype: found.archetype || (found.discScores && found.discScores.dominant_type) || "",
          createdAt: found.savedAt || found.createdAt || new Date().toISOString(),
        },
        disclaimer: DISCLAIMER,
      };

      try {
        const result = await sendReportEmails({
          report: reportForEmail,
          pdf: { path: pdfPath, format: "pdf" },
          participantEmail: email,
          // A user-initiated resend goes to the participant only.
          adminEmail: null,
        });
        const delivered = result.results.some((r) => r.sent);
        if (!delivered) {
          return send(res, 502, { error: "The mail server accepted no recipients, so nothing was sent.", configured: true });
        }
        return send(res, 200, { ok: true, sent: true, to: email, attachments: result.attachments });
      } catch (e) {
        console.error("[email-report] send failed:", e.message);
        return send(res, 502, { error: `Email send failed: ${e.message}`, configured: true });
      }
    }

    // ── Shopify order-paid webhook ───────────────────────────────────────────
    if (url.pathname === "/shopify/webhook/order-paid" && req.method === "POST") {
      const rawBody = await readBody(req);

      // Verify HMAC signature when secret is configured
      const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
      if (secret) {
        const hmac     = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
        const received = req.headers["x-shopify-hmac-sha256"] || "";
        if (hmac !== received) return send(res, 401, { error: "Invalid HMAC" });
      }

      // Respond 200 immediately so Shopify doesn't retry
      send(res, 200, { ok: true });

      // Fire async report generation (errors logged, not thrown)
      setImmediate(async () => {
        try {
          const order = JSON.parse(rawBody || "{}");
          await fulfillOrder(order);
        } catch (e) {
          console.error("[shopify] Webhook processing error:", e.message);
        }
      });

      return; // response already sent
    }

    // ── List paid Shopify orders (admin) ───────────────────────────────────
    // Protected by ADMIN_TOKEN. Uses SHOPIFY_ADMIN_API_TOKEN + SHOPIFY_SHOP env.
    // Returns lean per-order records so we can find undelivered reports.
    if (url.pathname === "/api/admin/list-paid-orders" && req.method === "GET") {
      const expected = process.env.ADMIN_TOKEN;
      if (!expected) return send(res, 503, { error: "ADMIN_TOKEN is not configured on this server." });
      if ((req.headers["x-admin-token"] || "") !== expected) return send(res, 403, { error: "Forbidden" });
      const shop = process.env.SHOPIFY_SHOP || "pznf0k-9p.myshopify.com";
      const tok = process.env.SHOPIFY_ADMIN_API_TOKEN;
      if (!tok) return send(res, 503, { error: "SHOPIFY_ADMIN_API_TOKEN is not configured on this server." });
      try {
        const r = await fetch(`https://${shop}/admin/api/2024-10/orders.json?status=any&limit=250&financial_status=paid`, {
          headers: { "X-Shopify-Access-Token": tok, "Content-Type": "application/json" },
        });
        if (!r.ok) return send(res, 502, { error: `Shopify ${r.status}: ${await r.text()}` });
        const data = await r.json();
        const orders = (data.orders || []).map(o => ({
          name: o.name,
          id: o.id,
          created_at: o.created_at,
          email: o.email || o.contact_email || null,
          financial_status: o.financial_status,
          fulfillment_status: o.fulfillment_status,
          line_items: (o.line_items || []).map(li => ({ title: li.title, variant_id: String(li.variant_id) })),
          note_attributes: Object.fromEntries((o.note_attributes || []).map(a => [a.name, a.value])),
          tags: o.tags,
        }));
        return send(res, 200, { count: orders.length, orders });
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }

    // ── Re-deliver an order that failed to reach the buyer ─────────────────
    // Protected by ADMIN_TOKEN. Accepts the same order shape Shopify sends, so
    // a purchase that fell through can be replayed without a new checkout.
    if (url.pathname === "/api/admin/fulfill" && req.method === "POST") {
      const expected = process.env.ADMIN_TOKEN;
      if (!expected) return send(res, 503, { error: "ADMIN_TOKEN is not configured on this server." });
      if ((req.headers["x-admin-token"] || "") !== expected) return send(res, 403, { error: "Forbidden" });

      const order = JSON.parse(await readBody(req) || "{}");
      try {
        const outcome = await fulfillOrder(order);
        return send(res, 200, { ok: true, outcome });
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }

    // ── Partner invite ───────────────────────────────────────────────────────
    if (url.pathname === "/api/partner-invite" && req.method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}");
      const { fromEmail, fromName, partnerEmail, assessmentId } = body;
      if (!fromEmail || !partnerEmail) return send(res, 400, { error: "fromEmail and partnerEmail required" });

      await store.savePartnerInvite(partnerEmail.toLowerCase(), {
        fromEmail, fromName, assessmentId,
        createdAt: new Date().toISOString(),
      });

      // Build partner URL
      const host     = req.headers.host || `localhost:${PORT}`;
      const protocol = host.includes("localhost") ? "http" : "https";
      const partnerUrl = `${protocol}://${host}/assessment?partner=${encodeURIComponent(fromEmail)}`;

      // Send invite email if SMTP is configured
      const smtpReady = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
      if (smtpReady) {
        let nodemailer;
        try { nodemailer = require("nodemailer"); } catch { nodemailer = null; }
        if (nodemailer) {
          try {
            const transporter = nodemailer.createTransport({
              host:   process.env.SMTP_HOST,
              port:   Number(process.env.SMTP_PORT || 587),
              secure: Number(process.env.SMTP_PORT) === 465,
              auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
            });
            await transporter.sendMail({
              from:    process.env.MAIL_FROM || "no-reply@mabonx.com",
              to:      partnerEmail,
              subject: `${fromName || "Someone"} invited you to take a behavioral assessment`,
              text:    `${fromName || "A colleague"} has invited you to complete a short behavioral assessment on Mabonx.\n\nClick this link to begin (takes about 3 minutes):\n${partnerUrl}\n\nOnce you both complete the assessment, your compatibility report will be generated automatically.`,
            });
          } catch (e) {
            console.error("[partner-invite] Email send error:", e.message);
          }
        }
      }

      return send(res, 200, { ok: true, partnerUrl });
    }

    // ── Check partner status ─────────────────────────────────────────────────
    if (url.pathname === "/api/check-partner" && req.method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}");
      const { email } = body;
      if (!email) return send(res, 400, { error: "email required" });

      const invites = await store.getAllPartnerInvites();

      // Find any invite sent FROM this email (they invited someone else)
      const myInviteEntry = Object.entries(invites).find(
        ([, inv]) => inv.fromEmail?.toLowerCase() === email.toLowerCase()
      );

      let pendingInvite   = false;
      let partnerCompleted = false;
      let partnerName     = null;

      if (myInviteEntry) {
        const [partnerEmail] = myInviteEntry;
        pendingInvite = true;
        const partnerAssessment = await store.getAssessmentByEmail(partnerEmail);
        if (partnerAssessment) {
          partnerCompleted = true;
          partnerName = [partnerAssessment.firstName, partnerAssessment.lastName]
            .filter(Boolean).join(" ") || null;
        }
      }

      return send(res, 200, { pendingInvite, partnerCompleted, partnerName });
    }

    // Serve generated PDFs/HTML
    if (url.pathname.startsWith("/reports/")) {
      const file = path.join(REPORTS, path.basename(url.pathname));
      if (fs.existsSync(file)) {
        const ext = file.endsWith(".pdf") ? "application/pdf" : "text/html";
        return send(res, 200, fs.readFileSync(file), ext);
      }
      return send(res, 404, { error: "not found" });
    }

    // Static: index.html
    let p = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.join(PUBLIC, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
    if (filePath.startsWith(PUBLIC) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" }[path.extname(filePath)] || "text/plain";
      return send(res, 200, fs.readFileSync(filePath), ext);
    }

    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`Assessment demo server on http://localhost:${PORT}`);
});
