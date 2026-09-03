// Phase 6a — PDF generation. Renders the report to a styled 6-page PDF.
// Uses pdfkit (pure JS, no headless browser) to keep cost/deps minimal.
// If pdfkit is not installed, falls back to writing an .html file so the
// pipeline still produces a deliverable artifact in any environment.

const fs   = require("fs");
const path = require("path");

// ---- Page geometry ---------------------------------------------------------
const PAGE_W    = 612;   // LETTER width in points
const PAGE_H    = 792;   // LETTER height in points
const MARGIN    = 56;
const CONTENT_W = PAGE_W - 2 * MARGIN;

// ---- Palette ---------------------------------------------------------------
const GOLD       = "#C5A95A";
const NAVY       = "#0F2744";
const DARK       = "#111111";
const BODY_COLOR = "#333333";
const MUTED      = "#666666";
const VERY_MUTED = "#999999";
const RULE_COLOR = "#CCCCCC";

// ---- Layout constants ------------------------------------------------------
const HEADER_Y       = 24;   // top of running page header text
const CONTENT_START  = 66;   // y where body content begins on content pages
const FOOTER_LINE_Y  = PAGE_H - 50;  // where the footer rule is drawn
const FOOTER_TEXT_Y  = FOOTER_LINE_Y + 7;
// Guard: if the cursor reaches this y, start a new page before rendering next field
const PAGE_BREAK_AT  = FOOTER_LINE_Y - 40;

// ---- HTML fallback ---------------------------------------------------------
function reportToHtml(report) {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const page = (p) => {
    const rows = Object.entries(p)
      .filter(([k]) => k !== "title")
      .map(([k, v]) => {
        const val = Array.isArray(v)
          ? `<ol>${v.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`
          : `<p>${esc(v)}</p>`;
        const label = k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
        return `<h3>${esc(label)}</h3>${val}`;
      }).join("");
    return `<section class="page"><h2>${esc(p.title)}</h2>${rows}</section>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Georgia,serif;max-width:720px;margin:40px auto;color:#222;line-height:1.6}
    h1{font-size:26px;color:#0F2744} h2{border-bottom:3px solid #C5A95A;padding-bottom:4px;margin-top:40px;color:#0F2744}
    h3{margin:20px 0 4px;color:#666;font-size:11px;text-transform:uppercase;letter-spacing:1px}
    p,li{font-size:14px;color:#333;margin:0 0 8px}
    ol{padding-left:20px} .page{page-break-after:always}
    .disc{font-size:11px;color:#666;margin-top:40px;border-top:1px solid #ccc;padding-top:10px}
  </style></head><body>
    <h1>Candidate Profile: ${esc(report.meta.name)}</h1>
    <p><em>${esc(report.meta.archetype || "")} &middot; generated ${esc(report.meta.createdAt)}</em></p>
    ${Object.keys(report.pages).map((i) => page(report.pages[i])).join("")}
    <div class="disc">${esc(report.disclaimer)}</div>
  </body></html>`;
}

// ---- PDF helpers -----------------------------------------------------------

// Draw the running header (name, right-aligned, very muted) and reset cursor.
function drawHeader(doc, displayName) {
  doc.font("Helvetica").fontSize(8).fillColor(VERY_MUTED)
    .text(displayName, MARGIN, HEADER_Y, { width: CONTENT_W, align: "right" });
  // Restore cursor to content start
  doc.y = CONTENT_START;
}

// Draw the footer rule + left/right text at fixed bottom position.
function drawFooter(doc, pageNum) {
  doc.moveTo(MARGIN, FOOTER_LINE_Y)
    .lineTo(PAGE_W - MARGIN, FOOTER_LINE_Y)
    .lineWidth(0.5).strokeColor(RULE_COLOR).stroke();

  doc.font("Helvetica").fontSize(8).fillColor(VERY_MUTED)
    .text("Palm Beach Placements \u00b7 Confidential", MARGIN, FOOTER_TEXT_Y, { width: CONTENT_W });
  // Right-align page number in the same band
  doc.text(String(pageNum), MARGIN, FOOTER_TEXT_Y, { width: CONTENT_W, align: "right" });
}

// If cursor is too close to the footer, add a continuation page.
function maybeBreak(doc, displayName, pdfPageNumRef) {
  if (doc.y > PAGE_BREAK_AT) {
    drawFooter(doc, pdfPageNumRef.num++);
    doc.addPage();
    drawHeader(doc, displayName);
  }
}

// ---- Main PDF renderer -----------------------------------------------------
async function renderPdf(report, outPath) {
  let PDFDocument;
  try { PDFDocument = require("pdfkit"); }
  catch { PDFDocument = null; }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  if (!PDFDocument) {
    // Graceful fallback: write HTML alongside so we always have a deliverable.
    const htmlPath = outPath.replace(/\.pdf$/i, ".html");
    fs.writeFileSync(htmlPath, reportToHtml(report), "utf8");
    return { path: htmlPath, format: "html", note: "pdfkit not installed; wrote HTML fallback" };
  }

  const displayName = report.meta.name;
  const archetype   = report.meta.archetype || "";
  const accessCode  = report.meta.accessCode || "";
  const rawDate     = report.meta.createdAt;
  const dateStr     = rawDate ? (() => {
    try {
      return new Date(rawDate).toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
      });
    } catch { return String(rawDate); }
  })() : "";

  await new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: "LETTER", margin: MARGIN, autoFirstPage: true });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);

    // ========================================================
    // PAGE 1 — COVER
    // ========================================================

    // Top gold rule (bleeds to edge, ignores margin)
    doc.rect(0, 0, PAGE_W, 8).fill(GOLD);

    // Title label — tracked caps
    doc.font("Helvetica").fontSize(11).fillColor(BODY_COLOR)
      .text("BEHAVIORAL PROFILE ASSESSMENT", MARGIN, 228, {
        width: CONTENT_W, align: "center", characterSpacing: 2,
      });

    // Participant name — serif, large
    doc.moveDown(2.4);
    doc.font("Times-Roman").fontSize(28).fillColor(DARK)
      .text(displayName, { width: CONTENT_W, align: "center" });

    // Archetype
    doc.moveDown(0.7);
    doc.font("Helvetica").fontSize(14).fillColor(MUTED)
      .text(archetype, { width: CONTENT_W, align: "center" });

    // Date completed
    if (dateStr) {
      doc.moveDown(0.5);
      doc.font("Helvetica").fontSize(10).fillColor(MUTED)
        .text(`Completed ${dateStr}`, { width: CONTENT_W, align: "center" });
    }

    // Access code — needed to retrieve these results later, so make it findable.
    if (accessCode) {
      doc.moveDown(2.2);
      doc.font("Helvetica").fontSize(9).fillColor(MUTED)
        .text("ACCESS CODE", { width: CONTENT_W, align: "center", characterSpacing: 2 });
      doc.moveDown(0.35);
      doc.font("Courier-Bold").fontSize(20).fillColor(DARK)
        .text(accessCode, { width: CONTENT_W, align: "center", characterSpacing: 3 });
      doc.moveDown(0.45);
      doc.font("Helvetica").fontSize(9).fillColor(MUTED)
        .text("Keep this. You will need it with your email address to view your results again.",
          { width: CONTENT_W, align: "center" });
    }

    // Company name — very muted, near bottom
    doc.font("Helvetica").fontSize(9).fillColor("#BBBBBB")
      .text("PALM BEACH PLACEMENTS", MARGIN, PAGE_H - 52, {
        width: CONTENT_W, align: "center", characterSpacing: 2,
      });

    // Bottom gold rule (4px, bleeds to edge)
    doc.rect(0, PAGE_H - 16, PAGE_W, 16).fill(GOLD);

    // ========================================================
    // PAGES 2–5 — CONTENT PAGES
    // ========================================================
    const pdfPageNumRef = { num: 2 };

    for (const i of Object.keys(report.pages)) {
      const pageData = report.pages[i];
      doc.addPage();
      drawHeader(doc, displayName);

      // Section title
      doc.font("Helvetica-Bold").fontSize(14).fillColor(NAVY)
        .text(pageData.title, MARGIN, doc.y);
      doc.moveDown(0.7);

      // Fields
      for (const [k, v] of Object.entries(pageData)) {
        if (k === "title") continue;

        maybeBreak(doc, displayName, pdfPageNumRef);

        // Field label — small caps style
        const label = k
          .replace(/([A-Z])/g, " $1")
          .replace(/^./, (c) => c.toUpperCase());
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(MUTED)
          .text(label.toUpperCase(), { characterSpacing: 0.6 });
        doc.moveDown(0.15);

        // Field body
        doc.font("Helvetica").fontSize(10).fillColor(BODY_COLOR);
        if (Array.isArray(v)) {
          // Numbered list (interview questions, strengths, etc.)
          v.forEach((item, idx) => {
            doc.text(`${idx + 1}.\u2002${item}`, { lineGap: 3 });
            doc.moveDown(0.25);
          });
        } else {
          doc.text(String(v ?? ""), { lineGap: 3 });
        }
        doc.moveDown(0.5);
      }

      drawFooter(doc, pdfPageNumRef.num++);
    }

    // ========================================================
    // PAGE 6 — DISCLAIMER
    // ========================================================
    doc.addPage();

    doc.font("Helvetica-Bold").fontSize(10).fillColor(MUTED)
      .text("METHODOLOGY & DISCLAIMER", MARGIN, MARGIN + 24, {
        width: CONTENT_W, align: "center", characterSpacing: 1.5,
      });

    doc.moveDown(1.8);
    doc.font("Helvetica").fontSize(9).fillColor(VERY_MUTED)
      .text(report.disclaimer, MARGIN, null, {
        width: CONTENT_W, align: "justify", lineGap: 3,
      });

    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return { path: outPath, format: "pdf" };
}

module.exports = { renderPdf, reportToHtml };
