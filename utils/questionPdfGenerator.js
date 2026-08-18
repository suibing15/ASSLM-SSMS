const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const { fitSingleLine, measureWrappedHeight } = require("./pdfTextFit");

/* ================= CONSTANTS ================= */
const BORDER_MARGIN = 25;
const INNER_MARGIN = BORDER_MARGIN + 15; // ✅ FIX: text stays inside border
const CONTENT_START_Y = 200;
const FOOTER_Y = 730;
const CONTENT_WIDTH = 595 - INNER_MARGIN * 2; // A4 safe width

async function generateQuestionPDF(meta, questions, outputPath) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  /* ========== HEADER FUNCTION ========== */
  function drawHeader() {
    // Border
    doc.lineWidth(1).strokeColor("#000");
    doc.rect(
      BORDER_MARGIN,
      BORDER_MARGIN,
      doc.page.width - BORDER_MARGIN * 2,
      doc.page.height - BORDER_MARGIN * 2
    ).stroke();

    // Logo
    const logoPath = meta.logo ? path.join(__dirname, "..", "public", meta.logo.replace(/^\//, "")) : path.join(__dirname, "../public/logo.png");
    if (fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, doc.page.width / 2 - 20, 40, { width: 40 });
      } catch {}
    }

    // School name box
    doc.font("Helvetica-Bold").fontSize(14);
    const name = meta.schoolName || "ASSALAM INTERNATIONAL ACADEMIC SCHOOL";
    const boxW = Math.min(doc.widthOfString(name) + 60, doc.page.width - 120);
    const boxX = (doc.page.width - boxW) / 2;
    const boxY = 90;

    doc.rect(boxX, boxY, boxW, 26).stroke();
    fitSingleLine(doc, name, 0, boxY + 6, doc.page.width, { startSize: 14, minSize: 8, font: "Helvetica-Bold", align: "center" });

    // School info — each kept to one line since the lines below sit
    // at fixed offsets from each other.
    doc.font("Helvetica").fontSize(9);
    fitSingleLine(
      doc,
      `Address: ${meta.address || "Behind Garko Motor Park, Opp. Tasidi Filling Station"}`,
      INNER_MARGIN, boxY + 36, CONTENT_WIDTH,
      { startSize: 9, minSize: 6.5, font: "Helvetica", align: "center" }
    );
    fitSingleLine(
      doc,
      `Motto: ${meta.motto || "Success comes after tears"}`,
      INNER_MARGIN, boxY + 50, CONTENT_WIDTH,
      { startSize: 9, minSize: 6.5, font: "Helvetica", align: "center" }
    );
    fitSingleLine(
      doc,
      `Phone: ${meta.phone || "08165789331, 08103992584, 08151015152, 07068595598"}`,
      INNER_MARGIN, boxY + 64, CONTENT_WIDTH,
      { startSize: 9, minSize: 6.5, font: "Helvetica", align: "center" }
    );

    doc.moveTo(60, boxY + 80).lineTo(540, boxY + 80).stroke();
    doc.y = CONTENT_START_Y;
  }

  /* ========== INITIAL HEADER ========== */
  drawHeader();

  /* ========== HEADER ON EVERY PAGE ========== */
  doc.on("pageAdded", drawHeader);

  /* ========== META INFO ========== */
  doc.font("Helvetica-Bold").fontSize(10);
  doc.text(`Class: ${meta.className}`, INNER_MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.text(`Subject: ${meta.subjectName}`, INNER_MARGIN, undefined, { width: CONTENT_WIDTH });
  doc.text(`Assessment Type: ${String(meta.type || "").toUpperCase()}`, INNER_MARGIN, undefined, { width: CONTENT_WIDTH });
  doc.text(`Term: ${meta.term || "_________"}`, INNER_MARGIN, undefined, { width: CONTENT_WIDTH });

  doc.moveDown(1);

  /* ========== QUESTIONS — compact two-column grid ========== */
  const usableLeft = INNER_MARGIN;
  const usableRight = INNER_MARGIN + CONTENT_WIDTH;
  const gap = 20;
  const colWidth = (usableRight - usableLeft - gap) / 2;
  const col1X = usableLeft;
  const col2X = usableLeft + colWidth + gap;

  let colY = [doc.y, doc.y];
  const bottomLimit = doc.page.height - 70;

  function measureQuestionBlock(q, idx, width) {
    const questionLine = `${idx + 1}. ${q.text}`;
    let height = measureWrappedHeight(doc, questionLine, width, 9, "Helvetica-Bold");
    if (Array.isArray(q.options) && q.options.length) {
      const optionsLine = q.options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join("   ");
      height += 2 + measureWrappedHeight(doc, optionsLine, width, 8, "Helvetica");
    }
    return height + 6; // matches the small gap drawQuestionBlock adds after itself
  }

  function drawQuestionBlock(q, idx, x, y, width) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#000");
    doc.text(`${idx + 1}. ${q.text}`, x, y, { width });

    if (Array.isArray(q.options) && q.options.length) {
      doc.font("Helvetica").fontSize(8).fillColor("#333");
      doc.text(
        q.options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join("   "),
        x, doc.y + 2, { width }
      );
    }
    doc.fillColor("#000");
    doc.y = doc.y + 6; // small gap before next block
  }

  questions.forEach((q, idx) => {
    const col = colY[0] <= colY[1] ? 0 : 1;
    const x = col === 0 ? col1X : col2X;
    let y = colY[col];

    // Measure the whole block BEFORE deciding whether it fits — the
    // old check only looked at where the block starts, not how tall
    // a long question (or many options) would actually make it,
    // which is exactly what let content run past the bottom border.
    const estimatedHeight = measureQuestionBlock(q, idx, colWidth);

    if (y + estimatedHeight > bottomLimit) {
      doc.addPage();
      colY = [doc.y, doc.y];
      y = colY[col];
    }

    drawQuestionBlock(q, idx, x, y, colWidth);
    colY[col] = doc.y;
  });

  doc.y = Math.max(colY[0], colY[1]) + 10;

  doc.end();
  return new Promise(resolve => stream.on("finish", resolve));
}

module.exports = { generateQuestionPDF };
