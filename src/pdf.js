// Phase 6a - PDF generation. Renders the report to a styled PDF: a cover page,
// content sections packed onto as few pages as the text needs, then the
// disclaimer. Empty sections and empty fields are skipped entirely.
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
const BACKGROUND = "#09081a";  // paid report background
const GOLD       = "#D4AF37";
const NAVY       = "#e2d4ff";  // primary heading text on dark
const DARK       = "#e2d4ff";
const BODY_COLOR = "#c4b2e8";
const MUTED      = "#7a6d9a";
const VERY_MUTED = "#4e4470";
const RULE_COLOR = "#1e1a36";

// ---- Layout constants ------------------------------------------------------
const HEADER_Y       = 24;   // top of running page header text
const CONTENT_START  = 66;   // y where body content begins on content pages
const FOOTER_LINE_Y  = PAGE_H - 50;  // where the footer rule is drawn
const FOOTER_TEXT_Y  = FOOTER_LINE_Y + 7;

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

// Anything drawn below (PAGE_H - bottom margin) is treated by pdfkit as content
// overflowing the writable area, so it silently starts a new page to hold it.
// Header and footer text live in the margin bands on purpose, so the bottom
// margin is zeroed for the duration of those draws and then restored. Without
// this, every footer emitted one blank page per text call.
function drawInMarginBand(doc, fn) {
  const prevBottom = doc.page.margins.bottom;
  const prevY      = doc.y;
  doc.page.margins.bottom = 0;
  try { fn(); }
  finally {
    doc.page.margins.bottom = prevBottom;
    doc.y = prevY;
  }
}

// True when a field carries nothing worth printing. Empty fields would
// otherwise render an orphan label with no body under it.
function isBlank(v) {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.filter((x) => String(x ?? "").trim() !== "").length === 0;
  return String(v).trim() === "";
}

// The printable fields of a report page, title excluded.
function contentFields(pageData) {
  if (!pageData || typeof pageData !== "object") return [];
  return Object.entries(pageData).filter(([k, v]) => k !== "title" && !isBlank(v));
}

// Draw the running header (name, right-aligned, very muted).
function drawHeader(doc, displayName) {
  drawInMarginBand(doc, () => {
    doc.font("Helvetica").fontSize(8).fillColor(VERY_MUTED)
      .text(displayName, MARGIN, HEADER_Y, { width: CONTENT_W, align: "right" });
  });
}

// Draw the footer rule + left/right text at fixed bottom position.
function drawFooter(doc, pageNum) {
  doc.moveTo(MARGIN, FOOTER_LINE_Y)
    .lineTo(PAGE_W - MARGIN, FOOTER_LINE_Y)
    .lineWidth(0.5).strokeColor(RULE_COLOR).stroke();

  drawInMarginBand(doc, () => {
    doc.font("Helvetica").fontSize(8).fillColor(VERY_MUTED)
      .text("Palm Beach Placements \u00b7 Confidential", MARGIN, FOOTER_TEXT_Y, { width: CONTENT_W });
    // Right-align page number in the same band
    doc.text(String(pageNum), MARGIN, FOOTER_TEXT_Y, { width: CONTENT_W, align: "right" });
  });
}

// Start a fresh content page with the cursor below the header band.
function paintBackground(doc) {
  doc.save();
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(BACKGROUND);
  doc.restore();
}

function startContentPage(doc) {
  doc.addPage();
  doc.y = CONTENT_START;
}

// pdfkit inserts its own pages when text overflows, and those never ran through
// startContentPage, so they came out white with near-invisible light text.
// Painting on the pageAdded event covers every page however it was created.
function autoPaintPages(doc) {
  doc.on("pageAdded", () => paintBackground(doc));
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
    // bufferPages lets the header/footer be stamped on every page in a single
    // pass at the end, so numbering stays sequential no matter how many
    // continuation pages the flowing content needed.
    const doc    = new PDFDocument({ size: "LETTER", margin: MARGIN, autoFirstPage: true, bufferPages: true });
    const stream = fs.createWriteStream(outPath);
    autoPaintPages(doc);
    doc.pipe(stream);

    // ========================================================
    // PAGE 1 - COVER
    // ========================================================

    paintBackground(doc);

    // Top gold rule (bleeds to edge, ignores margin)
    doc.rect(0, 0, PAGE_W, 8).fill(GOLD);

    // Title label - tracked caps
    doc.font("Helvetica").fontSize(11).fillColor(BODY_COLOR)
      .text("BEHAVIORAL PROFILE ASSESSMENT", MARGIN, 228, {
        width: CONTENT_W, align: "center", characterSpacing: 2,
      });

    // Participant name - serif, large
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

    // Access code - needed to retrieve these results later, so make it findable.
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

    // Company name - very muted, near bottom. Sits inside the bottom margin
    // band, so it must not be allowed to trigger an implicit page break.
    drawInMarginBand(doc, () => {
      doc.font("Helvetica").fontSize(9).fillColor("#BBBBBB")
        .text("PALM BEACH PLACEMENTS", MARGIN, PAGE_H - 52, {
          width: CONTENT_W, align: "center", characterSpacing: 2,
        });
    });

    // Bottom gold rule (4px, bleeds to edge)
    doc.rect(0, PAGE_H - 16, PAGE_W, 16).fill(GOLD);

    // ========================================================
    // CONTENT PAGES - sections flow continuously
    // ========================================================
    // Sections are packed onto as few pages as the text needs. A new page is
    // started only when there is genuinely no room left, instead of forcing
    // one PDF page per report section.
    const BOTTOM_LIMIT = PAGE_H - MARGIN;  // last y that content may occupy
    const TITLE_ROOM   = 96;               // space a section title plus opening lines needs
    const LABEL_ROOM   = 46;               // space a field label plus one line needs

    const sections = Object.keys(report.pages)
      .map((i) => report.pages[i])
      .filter((p) => contentFields(p).length > 0);

    let started = false;
    for (const pageData of sections) {
      if (!started) {
        startContentPage(doc);
        started = true;
      } else if (doc.y > BOTTOM_LIMIT - TITLE_ROOM) {
        startContentPage(doc);
      } else {
        doc.moveDown(1.2);
      }

      // Section title
      doc.font("Helvetica-Bold").fontSize(14).fillColor(NAVY)
        .text(pageData.title, MARGIN, doc.y, { width: CONTENT_W });
      doc.moveDown(0.7);

      for (const [k, v] of contentFields(pageData)) {
        // Never leave a label stranded at the very bottom of a page
        if (doc.y > BOTTOM_LIMIT - LABEL_ROOM) startContentPage(doc);

        // Field label - small caps style
        const label = k
          .replace(/([A-Z])/g, " $1")
          .replace(/^./, (c) => c.toUpperCase());
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(MUTED)
          .text(label.toUpperCase(), MARGIN, doc.y, { width: CONTENT_W, characterSpacing: 0.6 });
        doc.moveDown(0.15);

        // Field body
        doc.font("Helvetica").fontSize(10).fillColor(BODY_COLOR);
        if (Array.isArray(v)) {
          // Numbered list (interview questions, strengths, etc.)
          v.filter((item) => String(item ?? "").trim() !== "")
            .forEach((item, idx) => {
              doc.text(`${idx + 1}.\u2002${String(item).trim()}`, MARGIN, doc.y, {
                width: CONTENT_W, lineGap: 3,
              });
              doc.moveDown(0.25);
            });
        } else {
          doc.text(String(v).trim(), MARGIN, doc.y, { width: CONTENT_W, lineGap: 3 });
        }
        doc.moveDown(0.5);
      }
    }

    // ========================================================
    // DISCLAIMER - final page
    // ========================================================
    if (!isBlank(report.disclaimer)) {
      doc.addPage();

      doc.font("Helvetica-Bold").fontSize(10).fillColor(MUTED)
        .text("ABOUT THIS REPORT", MARGIN, MARGIN + 24, {
          width: CONTENT_W, align: "center", characterSpacing: 1.5,
        });

      doc.moveDown(1.8);
      doc.font("Helvetica").fontSize(9).fillColor(VERY_MUTED)
        .text(String(report.disclaimer).trim(), MARGIN, doc.y, {
          width: CONTENT_W, align: "justify", lineGap: 3,
        });
    }

    // ========================================================
    // Stamp header and footer on every page except the cover
    // ========================================================
    const range = doc.bufferedPageRange();
    let pageNum = 2;
    for (let i = range.start + 1; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      drawHeader(doc, displayName);
      drawFooter(doc, pageNum++);
    }
    doc.flushPages();

    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return { path: outPath, format: "pdf" };
}

module.exports = { renderPdf, reportToHtml };
