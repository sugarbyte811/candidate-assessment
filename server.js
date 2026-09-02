// Demo web server. Pure Node http, no framework. Serves the intake form and
// runs the assessment pipeline. Reports + PDFs are written under ./data and
// served back for download. Runs in dry-run mode (no email/Firestore) unless
// env keys are set — perfect for a shareable demo link.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { QUESTIONS } = require("./src/questions");
const { DISCLAIMER } = require("./src/report");
const { runAssessment } = require("./src/pipeline");
const GEO = require("./src/geo");

const PORT = process.env.PORT || 8787;
const PUBLIC = path.join(__dirname, "public");
const DATA = path.join(__dirname, "data");
const REPORTS = path.join(DATA, "reports");
fs.mkdirSync(REPORTS, { recursive: true });

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
      const result = await runAssessment({
        person: body.person,
        optional: body.optional || {},
        answers: body.answers.map(Number),
        adminEmail: process.env.ADMIN_EMAIL,
        config: { outDir: REPORTS, storage: { localStore: path.join(DATA, "assessments.json") } },
      });
      const pdfName = path.basename(result.pdf.path);
      return send(res, 200, {
        id: result.id,
        archetype: result.archetype,
        report: result.report,
        generatedBy: result.generatedBy,
        pdfUrl: `/reports/${pdfName}`,
        emailed: result.email ? result.email.results : [],
        scores: {
          traits: result.profile.behavioral.traits,
          disc:   result.profile.behavioral.disc,
          pi:     result.profile.behavioral.pi,
          mbti:   result.profile.behavioral.mbti,
        },
      });
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
