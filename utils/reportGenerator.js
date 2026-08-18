// utils/reportGenerator.js
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const dayjs = require("dayjs");
const { fitSingleLine, measureWrappedHeight } = require("./pdfTextFit");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// Auto grading + remarks
function getGradeAndRemark(score) {
  let grade = "F";
  let remark = "Poor";
  if (score >= 70) { grade = "A"; remark = "Excellent"; }
  else if (score >= 60) { grade = "B"; remark = "Very Good"; }
  else if (score >= 50) { grade = "C"; remark = "Good"; }
  else if (score >= 40) { grade = "D"; remark = "Fair"; }
  else if (score >= 30) { grade = "E"; remark = "Weak"; }
  return { grade, remark };
}

// Auto recommendation
function getRecommendation(avg) {
  if (avg >= 70) return "Excellent performance. Keep it up!";
  if (avg >= 60) return "Very good work. A little more effort to reach excellence.";
  if (avg >= 50) return "Good performance. Try to improve further.";
  if (avg >= 40) return "Fair effort, more study is required.";
  return "Needs serious improvement and closer attention.";
}

function generateReportPDF(meta, student, reportData, outPath, callback) {
  try {
    ensureDir(path.dirname(outPath));

    const doc = new PDFDocument({ margin: 40 });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);

    // ======================================================
    // Plain white background — the watermark that used to be here
    // has been removed, matching the combined class report generator,
    // which never had one.
    // ======================================================

    // ======================================================
    // BORDER
    // ======================================================
    const margin = 25;
    doc.lineWidth(1).strokeColor("#888");
    doc.rect(
      margin,
      margin,
      doc.page.width - margin * 2,
      doc.page.height - margin * 2
    ).stroke();

    // ===== LOGO =====
    const logoPath = meta.logo ? path.join(__dirname, "..", "public", meta.logo.replace(/^\//, "")) : path.join(__dirname, "../public/logo.png");
    if (fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, doc.page.width / 2 - 20, 40, { width: 40 });
      } catch {}
    }

    // ===== TITLE BOX =====
    const schoolName = meta.schoolName || "SCHOOL NAME";
    doc.font("Helvetica-Bold").fontSize(15);
    const pageContentWidth = doc.page.width - 120; // keep the school name box safely inside the margins
    const boxWidth = Math.min(doc.widthOfString(schoolName) + 60, pageContentWidth);
    const boxX = (doc.page.width - boxWidth) / 2;
    const boxY = 90;

    doc.rect(boxX, boxY, boxWidth, 28).stroke();
    fitSingleLine(doc, schoolName, 0, boxY + 7, doc.page.width, { startSize: 15, minSize: 9, font: "Helvetica-Bold", align: "center" });

    // Address + details — each kept to one line on purpose, since the
    // lines below are positioned at fixed offsets; letting one of
    // these wrap to two lines would silently run into the line below it.
    doc.font("Helvetica").fontSize(10).fillColor("#333");
    fitSingleLine(doc, `Address: ${meta.address || "Behind Garko Motor Park, Opp. Tasidi Filling Station"}`, 0, boxY + 38, doc.page.width, { startSize: 10, minSize: 7, font: "Helvetica", align: "center" });
    fitSingleLine(doc, `Motto: ${meta.motto || "Success comes after tears"}`, 0, boxY + 52, doc.page.width, { startSize: 10, minSize: 7, font: "Helvetica", align: "center" });
    fitSingleLine(doc, `Phone: ${meta.phone || "08165789331, 08103992584, 08151015152"}`, 0, boxY + 66, doc.page.width, { startSize: 10, minSize: 7, font: "Helvetica", align: "center" });
    doc.fillColor("#000");

    doc.moveTo(60, boxY + 82).lineTo(540, boxY + 82).stroke();

    // ===== TITLE =====
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(13).text("STUDENT REPORT SHEET", { align: "center" });

    // ===== PHOTO =====
    if (student.photoPath) {
      try {
        const relative = student.photoPath.replace(/^\/?public\//, "").replace(/^\//, "");
        const pic = path.join(__dirname, "..", relative);
        if (fs.existsSync(pic)) doc.image(pic, 430, 160, { width: 90, height: 100 });
      } catch {}
    }

    // ===== STUDENT INFO =====
    doc.moveDown(1);
    const infoY = doc.y;
    doc.font("Helvetica").fontSize(10);

    let classDisplay = student.classId;
    try {
      if (Array.isArray(meta.classes)) {
        const c = meta.classes.find(cl =>
          (cl.id || "").toUpperCase() === (student.classId || "").toUpperCase()
        );
        if (c && c.name) classDisplay = c.name;
      }
    } catch {}

    const sessionValue = meta.session || meta.Session || meta.sessionName || "";

    fitSingleLine(doc, `Name: ${student.name}`, 60, infoY, 230, { startSize: 10, minSize: 7, font: "Helvetica" });
    fitSingleLine(doc, `Class: ${classDisplay}`, 60, infoY + 14, 230, { startSize: 10, minSize: 7, font: "Helvetica" });
    doc.text(`Admission No: ${student.id}`, 60, infoY + 28);

    doc.text(`Term: ${meta.term}`, 300, infoY);
    doc.text(`Session: ${sessionValue}`, 300, infoY + 14);
    doc.text(`Date: ${dayjs().format("YYYY-MM-DD HH:mm")}`, 300, infoY + 28);

    if (meta.totalStudents)
      doc.text(`No. Students: ${meta.totalStudents}`, 60, infoY + 42);

    doc.text(`Position: ${meta.position || "—"}`, 300, infoY + 42);

    doc.moveDown(4);

    // ===== TABLE HEADER =====
    const startY = doc.y;
    const headers = ["Subject","Test1","Test2","Test3","Exam","Total","Grade","Remark"];
    const colX = [60,175,225,275,325,385,445,495];

    doc.font("Helvetica-Bold").fontSize(10);
    headers.forEach((h,i)=> doc.text(h, colX[i], startY));
    doc.moveTo(60,startY+12).lineTo(540,startY+12).stroke();

    doc.font("Helvetica").fontSize(9);

    let y = startY + 18;
    let totalScore = 0;
    let subjectCount = 0;

    for (const subject in reportData) {
      const r = reportData[subject];
      const t1 = +r.test1 || 0;
      const t2 = +r.test2 || 0;
      const t3 = +r.test3 || 0;
      const ex = +r.exam  || 0;
      const total = t1 + t2 + t3 + ex;

      const { grade, remark } = getGradeAndRemark(total);

      totalScore += total;
      subjectCount++;

      const vals = [subject, t1, t2, t3, ex, total, grade, remark];
      const colWidths = [110, 45, 45, 45, 55, 55, 45, 45]; // matches the gaps between colX entries
      vals.forEach((v, i) => {
        if (i === 0 || i === 7) {
          // Subject name and Remark are the two fields with real
          // variable length — everything else is a short number or
          // a single letter grade that's never at risk of overflow.
          fitSingleLine(doc, String(v), colX[i], y, colWidths[i], { startSize: 9, minSize: 6.5, font: "Helvetica" });
        } else {
          doc.text(String(v), colX[i], y);
        }
      });

      y += 14;

      if (y > doc.page.height - 150) {
        // NEW PAGE
        doc.addPage();

        // border only — no watermark
        doc.lineWidth(1).strokeColor("#888");
        doc.rect(margin, margin, doc.page.width - margin * 2, doc.page.height - margin * 2).stroke();

        y = 60;
      }
    }

    if (!subjectCount) {
      doc.text("No subjects found.", 60, y);
      y += 16;
    }

    const avg = subjectCount ? (totalScore / subjectCount).toFixed(2) : 0;

    // ===== SUMMARY =====
    y += 10;
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(`Subjects: ${subjectCount}`,60,y);
    doc.text(`Total: ${totalScore}`,200,y);
    doc.text(`Average: ${avg}`,360,y);

    const recommendation = getRecommendation(avg);

    // Estimate the whole remaining footer (recommendation + gap +
    // signature line) before drawing any of it — if it wouldn't fit
    // on this page, start a fresh one now instead of letting it run
    // past the bottom border.
    const estimatedRecHeight = measureWrappedHeight(doc, recommendation, 380, 10, "Helvetica");
    const estimatedFooterHeight = 28 + 14 + estimatedRecHeight + Math.max(90, estimatedRecHeight + 76) + 55;
    if (y + estimatedFooterHeight > doc.page.height - 60) {
      doc.addPage();
      doc.lineWidth(1).strokeColor("#888");
      doc.rect(margin, margin, doc.page.width - margin * 2, doc.page.height - margin * 2).stroke();
      y = 60;
    }

    y += 28;
    doc.text("Teacher's Recommendation:",60,y);

    doc.font("Helvetica").fontSize(10).text(recommendation,60,y+14,{width:380});

    // Next Term
    doc.font("Helvetica-Bold").fontSize(10).text("Next Term Begins:",400,y);
    doc.font("Helvetica").fontSize(10).text(meta.nextTermBegins || "TBA",400,y+14);

    // ===== SIGNATURES =====
    // The gap before signatures scales with how tall the recommendation
    // actually rendered — a longer comment that wraps to 2-3 lines no
    // longer runs into the signature block below it.
    const recommendationHeight = measureWrappedHeight(doc, recommendation, 380, 10, "Helvetica");
    y += Math.max(90, recommendationHeight + 76);
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text("Teacher's Signature:",60,y);
    doc.text("Principal's Signature:",350,y);

    // Teacher signature
    let teacherSigPath = null;
    if (student.classId) {
      const sigFile = `${student.classId}_signature.png`;
      const try1 = path.join(__dirname, "../public/uploads/teachers", sigFile);
      const try2 = path.join(__dirname, "../public/uploads", sigFile);
      if (fs.existsSync(try1)) teacherSigPath = try1;
      else if (fs.existsSync(try2)) teacherSigPath = try2;
    }

    if (!teacherSigPath && meta.teacherSignature) {
      teacherSigPath = path.join(__dirname,"..", meta.teacherSignature.replace(/^\//,""));
    }

    if (teacherSigPath && fs.existsSync(teacherSigPath)) {
      doc.image(teacherSigPath,60,y+15,{width:80,height:40});
    } else {
      doc.text("____________________________",160,y);
    }

  // Principal signature
let principalPath = meta.signaturePrincipal || "/uploads/principal_signature.png";

// Correct path: convert /uploads/... to public/uploads/...
if (principalPath.startsWith("/uploads")) {
  principalPath = path.join("public", principalPath.replace(/^\//, ""));
}

// Resolve absolute path
const principalSig = path.join(__dirname, "..", principalPath);

// Debug: print path
console.log("Principal Signature Path:", principalSig);

if (fs.existsSync(principalSig)) {
  doc.image(principalSig, 350, y + 15, { width: 80, height: 40 });
} else {
  console.log("Signature NOT FOUND!");
  doc.text("____________________", 350, y + 15);
}


    y += 70;
    doc.font("Helvetica").fontSize(8).fillColor("#444");
    doc.text(
      `Generated by ${meta.schoolName || "School"} Portal - ${dayjs().format("YYYY-MM-DD")}`,
      60,
      y
    );

    doc.end();
    stream.on("finish",()=> callback && callback(null,outPath));
    stream.on("error",(err)=> callback && callback(err));

  } catch(err) {
    callback && callback(err);
  }
}

module.exports = { generateReportPDF };


