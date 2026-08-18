const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const { fitSingleLine } = require("./pdfTextFit");

/* ================= CONSTANTS ================= */
const BORDER_MARGIN = 25;
const INNER_MARGIN = BORDER_MARGIN + 15;
const CONTENT_WIDTH = 595 - INNER_MARGIN * 2;
const CONTENT_START_Y = 200;

/* ================= HELPERS ================= */
function getPeriodLabel(fromDate, toDate) {
  if (!fromDate && !toDate) return "All-Time Summary";
  if (fromDate && !toDate) return `From ${fromDate}`;
  if (!fromDate && toDate) return `Up to ${toDate}`;
  if (fromDate === toDate) return `For ${fromDate}`;
  return `From ${fromDate} to ${toDate}`;
}

/* ================= HEADER ================= */
function drawHeader(doc, meta, title, subtitleLines = []) {
  // Border
  doc.rect(
    BORDER_MARGIN,
    BORDER_MARGIN,
    doc.page.width - BORDER_MARGIN * 2,
    doc.page.height - BORDER_MARGIN * 2
  ).stroke();

  // Logo
  const logoPath = meta.logo ? path.join(__dirname, "..", "public", meta.logo.replace(/^\//, "")) : path.join(__dirname, "../public/logo.png");
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, doc.page.width / 2 - 20, 40, { width: 40 });
  }

  // School name box
  doc.font("Helvetica-Bold").fontSize(14);
  const name = meta.schoolName || "ASSALAM INTERNATIONAL ACADEMIC SCHOOL";
  const boxW = doc.widthOfString(name) + 60;
  const boxX = (doc.page.width - boxW) / 2;
  const boxY = 90;

  doc.rect(boxX, boxY, boxW, 26).stroke();
  doc.text(name, 0, boxY + 6, { align: "center" });

  // School info
  doc.font("Helvetica").fontSize(9);
  doc.text(
    `Address: ${meta.address || "Behind Garko Motor Park, Opp. Tasidi Filling Station"}`,
    INNER_MARGIN,
    boxY + 36,
    { width: CONTENT_WIDTH, align: "center" }
  );
  doc.text(
    `Motto: ${meta.motto || "Success comes after tears"}`,
    INNER_MARGIN,
    boxY + 50,
    { width: CONTENT_WIDTH, align: "center" }
  );
  doc.text(
    `Phone: ${meta.phone || "08165789331, 08103992584, 08151015152, 07068595598"}`,
    INNER_MARGIN,
    boxY + 64,
    { width: CONTENT_WIDTH, align: "center" }
  );

  // Divider
  doc.moveTo(60, boxY + 80).lineTo(540, boxY + 80).stroke();

  /* ========== REPORT TITLE & META (FIXED) ========== */
  let y = boxY + 92;

  // Title (centered)
  doc.font("Helvetica-Bold").fontSize(13);
  doc.text(title, INNER_MARGIN, y, {
    width: CONTENT_WIDTH,
    align: "center"
  });

  y += 22;

  // Meta info (left aligned)
  doc.font("Helvetica").fontSize(10);
  subtitleLines.forEach(line => {
    doc.text(line, INNER_MARGIN, y, {
      width: CONTENT_WIDTH,
      align: "left"
    });
    y += 14;
  });

  // Ensure attendance starts cleanly below header
  doc.y = Math.max(y + 10, CONTENT_START_Y);
}

/* ================= CLASS ATTENDANCE ================= */
function generateClassAttendancePDF({
  meta,
  cls,
  students,
  attendance,
  fromDate,
  toDate,
  outPath
}) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  doc.pipe(fs.createWriteStream(outPath));

  const periodLabel = getPeriodLabel(fromDate, toDate);

  drawHeader(
    doc,
    meta,
    "CLASS ATTENDANCE REPORT",
    [
      `Class: ${cls.name} (${cls.id})`,
      `Period: ${periodLabel}`
    ]
  );

  doc.on("pageAdded", () =>
    drawHeader(
      doc,
      meta,
      "CLASS ATTENDANCE REPORT",
      [
        `Class: ${cls.name} (${cls.id})`,
        `Period: ${periodLabel}`
      ]
    )
  );

  const days = Object.keys(attendance || {})
    .filter(d => (!fromDate || d >= fromDate) && (!toDate || d <= toDate))
    .sort();

  if (!days.length) {
    doc.text("No attendance records for selected period.");
    doc.end();
    return;
  }

  // ---- Day-by-day matrix: student names down the side, each date
  // across the top, marked Present/Absent per cell, with the
  // signing teacher's name shown under each date. ----
  const nameColWidth = 150;
  const colWidth = Math.max(55, Math.min(80, (CONTENT_WIDTH - nameColWidth) / days.length));
  const rowHeight = 13;
  const startX = INNER_MARGIN;

  function drawMatrixHeader(y) {
    doc.font("Helvetica-Bold").fontSize(8);
    doc.text("Student", startX, y, { width: nameColWidth });
    days.forEach((d, i) => {
      const x = startX + nameColWidth + i * colWidth;
      const teacherName = attendance[d]?.teacherName || "—";
      doc.text(d, x, y, { width: colWidth, align: "center" });
      doc.font("Helvetica").fontSize(6.5).fillColor("#555")
        .text(`by ${teacherName}`, x, y + 9, { width: colWidth, align: "center" });
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#000");
    });
    return y + 20;
  }

  let y = drawMatrixHeader(doc.y);

  students.forEach((st, idx) => {
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = drawMatrixHeader(doc.y);
    }

    doc.font("Helvetica").fontSize(8).fillColor("#000");
    fitSingleLine(doc, `${st.name} (${st.id})`, startX, y, nameColWidth - 4, { startSize: 8, minSize: 6, font: "Helvetica" });

    days.forEach((d, i) => {
      const x = startX + nameColWidth + i * colWidth;
      const status = attendance[d]?.students?.[st.id];
      const mark = status === "present" ? "P" : (status === "absent" ? "A" : "-");
      doc.fillColor(mark === "P" ? "#006400" : (mark === "A" ? "#b00000" : "#999"));
      doc.text(mark, x, y, { width: colWidth, align: "center" });
    });
    doc.fillColor("#000");
    y += rowHeight;
  });

  doc.end();
}

/* ================= TEACHER ATTENDANCE ================= */
// Rebuilt to match the class attendance report exactly: one row per
// teacher, one column per day, instead of a single summary count.
// Reads from teacherAttendance (each teacher's own login-based daily
// record), not the class attendance object — that's a different
// thing entirely (who signed a CLASS in, not whether a teacher
// themselves was present that day).
function generateTeacherAttendancePDF({
  meta,
  teachers,
  teacherAttendance,
  fromDate,
  toDate,
  outPath
}) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  doc.pipe(fs.createWriteStream(outPath));

  const periodLabel = getPeriodLabel(fromDate, toDate);

  drawHeader(doc, meta, "TEACHER ATTENDANCE REPORT", [`Period: ${periodLabel}`]);
  doc.on("pageAdded", () =>
    drawHeader(doc, meta, "TEACHER ATTENDANCE REPORT", [`Period: ${periodLabel}`])
  );

  const allDays = new Set();
  Object.values(teacherAttendance || {}).forEach(days => {
    Object.keys(days || {}).forEach(d => allDays.add(d));
  });
  const days = [...allDays]
    .filter(d => (!fromDate || d >= fromDate) && (!toDate || d <= toDate))
    .sort();

  if (!days.length) {
    doc.text("No attendance records for selected period.");
    doc.end();
    return new Promise(res => doc.on("end", res));
  }

  const nameColWidth = 150;
  const colWidth = Math.max(55, Math.min(80, (CONTENT_WIDTH - nameColWidth) / days.length));
  const rowHeight = 13;
  const startX = INNER_MARGIN;

  function drawMatrixHeader(y) {
    doc.font("Helvetica-Bold").fontSize(8);
    doc.text("Teacher", startX, y, { width: nameColWidth });
    days.forEach((d, i) => {
      const x = startX + nameColWidth + i * colWidth;
      doc.text(d, x, y, { width: colWidth, align: "center" });
    });
    return y + 16;
  }

  let y = drawMatrixHeader(doc.y);

  teachers.forEach(t => {
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = drawMatrixHeader(doc.y);
    }

    doc.font("Helvetica").fontSize(8).fillColor("#000");
    fitSingleLine(doc, `${t.name} (${t.id})`, startX, y, nameColWidth - 4, { startSize: 8, minSize: 6, font: "Helvetica" });

    days.forEach((d, i) => {
      const x = startX + nameColWidth + i * colWidth;
      const present = !!(teacherAttendance?.[t.id]?.[d]);
      doc.fillColor(present ? "#006400" : "#b00000");
      doc.text(present ? "P" : "A", x, y, { width: colWidth, align: "center" });
    });
    doc.fillColor("#000");
    y += rowHeight;
  });

  doc.end();
  return new Promise(res => doc.on("end", res));
}

module.exports = {
  generateClassAttendancePDF,
  generateTeacherAttendancePDF
};

