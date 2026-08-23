// ============================================================
// رمز الريال السعودي الجديد — رسم متجهي موحد (نظام + PDF + طباعة)
// المحرف الخاص \uE000 يُستخدم علامة داخل نصوص المبالغ ويُرسم كرمز
// ============================================================
const { RIYAL_PATHS, RIYAL_VIEWBOX } = require('./riyal-paths');

const SAR_MARK = '\uE000'; // علامة موضع رمز الريال داخل النصوص
const SAR_RATIO = RIYAL_VIEWBOX.w / RIYAL_VIEWBOX.h; // عرض/ارتفاع الرمز

/** تحليل مسار SVG (M m L l H h V v C c Z z) إلى أوامر مطلقة */
function parseSvgPath(d) {
  const cmds = [];
  const re = /([MmLlHhVvCcZz])([^MmLlHhVvCcZz]*)/g;
  let m, cx = 0, cy = 0, startX = 0, startY = 0, prevCmd = '';
  const nums = s => (s.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
  while ((m = re.exec(d))) {
    const cmd = m[1], a = nums(m[2]);
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toLowerCase()) {
      case 'm':
        for (let i = 0; i < a.length; i += 2) {
          const x = rel ? cx + a[i] : a[i], y = rel ? cy + a[i + 1] : a[i + 1];
          if (i === 0) { cmds.push({ t: 'M', x, y }); startX = x; startY = y; } else cmds.push({ t: 'L', x, y });
          cx = x; cy = y;
        }
        break;
      case 'l':
        for (let i = 0; i < a.length; i += 2) {
          const x = rel ? cx + a[i] : a[i], y = rel ? cy + a[i + 1] : a[i + 1];
          cmds.push({ t: 'L', x, y }); cx = x; cy = y;
        }
        break;
      case 'h':
        for (const v of a) { cx = rel ? cx + v : v; cmds.push({ t: 'L', x: cx, y: cy }); }
        break;
      case 'v':
        for (const v of a) { cy = rel ? cy + v : v; cmds.push({ t: 'L', x: cx, y: cy }); }
        break;
      case 'c':
        for (let i = 0; i + 5 < a.length; i += 6) {
          const x1 = rel ? cx + a[i] : a[i], y1 = rel ? cy + a[i + 1] : a[i + 1];
          const x2 = rel ? cx + a[i + 2] : a[i + 2], y2 = rel ? cy + a[i + 3] : a[i + 3];
          const x = rel ? cx + a[i + 4] : a[i + 4], y = rel ? cy + a[i + 5] : a[i + 5];
          cmds.push({ t: 'C', x1, y1, x2, y2, x, y }); cx = x; cy = y;
        }
        break;
      case 'z':
        cmds.push({ t: 'Z' }); cx = startX; cy = startY;
        break;
    }
    prevCmd = cmd;
  }
  return cmds;
}

const PARSED = RIYAL_PATHS.map(parseSvgPath);
// صندوق محيط للرمز
let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
PARSED.flat().forEach(c => {
  const pts = c.t === 'C' ? [[c.x1, c.y1], [c.x2, c.y2], [c.x, c.y]] : c.t === 'M' || c.t === 'L' ? [[c.x, c.y]] : [];
  pts.forEach(([x, y]) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; });
});
const BBOX = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

/**
 * رسم رمز الريال على مستند pdfkit
 * x: يمين الرمز، y: خط الأساس للنص (يرسم بارتفاع النص تقريبًا)
 * size: حجم خط النص المحيط، color: لون التعبئة
 */
function drawRiyalPDF(doc, x, y, size, color) {
  const h = size * 1.08; // ارتفاع الرمز بالنسبة لحجم الخط
  const w = h * (BBOX.w / BBOX.h);
  const top = y - size * 0.88;
  const s = h / BBOX.h;
  doc.save();
  doc.translate(x - w, top - BBOX.y * s);
  doc.scale(s, s);
  for (const path of PARSED) {
    for (const c of path) {
      if (c.t === 'M') doc.moveTo(c.x, c.y);
      else if (c.t === 'L') doc.lineTo(c.x, c.y);
      else if (c.t === 'C') doc.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
      else if (c.t === 'Z') doc.closePath();
    }
  }
  doc.fillColor(color);
  doc.fill();
  doc.restore();
  return w; // عرض الرمز المرسوم
}

/** رمز الريال كـ SVG مضمّن لواجهة النظام (يتبع لون النص تلقائيًا) */
function sarSVG(style = '') {
  return `<svg class="sar"${style ? ` style="${style}"` : ''} viewBox="${BBOX.x} ${BBOX.y} ${BBOX.w} ${BBOX.h}" xmlns="http://www.w3.org/2000/svg" aria-label="ريال سعودي"><path fill="currentColor" d="${RIYAL_PATHS.join(' ')}"/></svg>`;
}

/** تقسيم نص قد يحتوي علامة الريال إلى مقاطع {نص} و {رمز} */
function splitSAR(text) {
  const parts = [];
  String(text).split(SAR_MARK).forEach((seg, i, arr) => {
    if (seg) parts.push({ text: seg });
    if (i < arr.length - 1) parts.push({ sar: true });
  });
  return parts;
}

module.exports = { SAR_MARK, SAR_RATIO, drawRiyalPDF, sarSVG, splitSAR, BBOX, parseSvgPath };
