// Demo web server. Pure Node http, no framework. Serves the intake form and
// runs the assessment pipeline. Reports + PDFs are written under ./data and
// served back for download. Runs in dry-run mode (no email/Firestore) unless
// env keys are set — perfect for a shareable demo link.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { QUESTIONS } = require("./src/questions");
const { DISCLAIMER } = require("./src/report");
const { runAssessment } = require("./src/pipeline");
const { generateReport } = require("./src/firebase-report");
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
          const customerEmail = order.customer?.email?.toLowerCase();
          if (!customerEmail) return;

          const lineItems   = order.line_items || [];
          const assessment  = await store.getAssessmentByEmail(customerEmail);

          for (const item of lineItems) {
            const handle    = item.handle || item.product_handle || "";
            const productId = PRODUCT_MAP[handle];
            if (!productId) continue;

            const personA = assessment ? {
              name:      [assessment.firstName, assessment.lastName].filter(Boolean).join(" "),
              birthdate: assessment.birthday || null,
            } : null;

            const discProfile = (assessment && productId === "career_edge")
              ? assessment.discScores || null
              : null;

            try {
              const result = await generateReport({ productId, personA, discProfile, customerEmail });
              console.log(`[shopify] Generated ${productId} for ${customerEmail}:`, result);
            } catch (e) {
              console.error(`[shopify] Failed to generate ${productId} for ${customerEmail}:`, e.message);
            }
          }
        } catch (e) {
          console.error("[shopify] Webhook processing error:", e.message);
        }
      });

      return; // response already sent
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
