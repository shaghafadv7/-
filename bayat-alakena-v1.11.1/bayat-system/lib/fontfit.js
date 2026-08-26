// ============================================================
// مطابقة الخط مع محرك التشكيل: يعوض أي أشكال عرض ناقصة في الخط
// باستخراج الشكل الصحيح من GSUB (تشكيل OpenType) ثم إيجاد نقطة
// ترميز بديلة داخل الـ cmap تُنتج نفس الرسمة تمامًا.
// ============================================================
const fontkit = require('fontkit');

// إنتاج كل نقاط الترميز التي يخرجها المحرك (أشكال العرض + المركبات)
function engineCodepoints() {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'arabicText.js'), 'utf8');
  const m = src.match(/const LETTERS = \{([\s\S]*?)\n\};/)[1];
  const cps = new Set();
  for (const [, cpHex, formsStr] of [...m.matchAll(/0x([0-9A-Fa-f]+): \{ f: \[([^\]]*)\]/g)]) {
    cps.add(parseInt(cpHex, 16));
    formsStr.split(',').map(s => parseInt(s.trim(), 16)).filter(x => !isNaN(x)).forEach(f => cps.add(f));
  }
  [0xFEF5, 0xFEF6, 0xFEF7, 0xFEF8, 0xFEF9, 0xFEFA, 0xFEFB, 0xFEFC].forEach(f => cps.add(f));
  return [...cps];
}

const BASE_OF_PF = {};
// خريطة عكسية: من الشكل إلى الحرف الأساسي (مبنية من محرك التشكيل)
(function buildBaseMap() {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'arabicText.js'), 'utf8');
  const m = src.match(/const LETTERS = \{([\s\S]*?)\n\};/)[1];
  for (const [, cpHex, formsStr] of [...m.matchAll(/0x([0-9A-Fa-f]+): \{ f: \[([^\]]*)\]/g)]) {
    const base = parseInt(cpHex, 16);
    formsStr.split(',').map(s => parseInt(s.trim(), 16)).filter(x => !isNaN(x)).forEach(f => BASE_OF_PF[f] = base);
  }
})();

/**
 * بناء خريطة تطبيع لخط معين.
 * لكل شكل عرض ينقص الخط: نحاول (1) رمز بديل يعطي نفس رسمة GSUB،
 * (2) الحرف الأساسي، (3) أي شكل متاح لنفس الحرف.
 */
// نوع الشكل: 0 معزول، 1 نهائي، 2 ابتدائي، 3 وسطي — من ترتيب f[] في جدول المحرك
const FORM_KIND = (() => {
  const kinds = {};
  const srcEng = require('fs').readFileSync(require('path').join(__dirname, 'arabicText.js'), 'utf8');
  const blk = srcEng.match(/const LETTERS = \{([\s\S]*?)\n\};/)[1];
  for (const [, cpHex, formsStr] of [...blk.matchAll(/0x([0-9A-Fa-f]+): \{ f: \[([^\]]*)\]/g)]) {
    const formsArr = formsStr.split(',').map(s => parseInt(s.trim(), 16));
    formsArr.forEach((f, i) => { if (!isNaN(f)) kinds[f] = Math.min(i, formsArr.length - 1); });
  }
  return kinds;
})();

function buildNormalization(fontPath) {
  const font = fontkit.openSync(fontPath);
  const has = cp => { try { return font.hasGlyphForCodePoint(cp); } catch { return false; } };
  const glyphId = cp => { try { return font.glyphForCodePoint(cp).id; } catch { return -1; } };
  // رسمات GSUB عبر تحليل سلاسل تجريبية (نستخرج رسمة الحرف الأول/الأخير)
  const shapeProbe = str => { try { return font.layout(str).glyphs.map(g => g.id); } catch { return null; } };
  // فهرس: رسمة -> أقرب نقطة ترميز تنتجها
  const idToCp = new Map();
  for (const cp of font.characterSet) {
    const id = glyphId(cp);
    if (id > 0 && !idToCp.has(id)) idToCp.set(id, cp);
  }
  const map = new Map();
  const formsByLetter = {};
  for (const [pf, base] of Object.entries(BASE_OF_PF)) {
    formsByLetter[base] = formsByLetter[base] || new Set();
    formsByLetter[base].add(Number(pf));
  }
  let compensated = 0;
  for (const cp of engineCodepoints()) {
    if (cp < 0xFB50 || cp > 0xFEFF) continue; // الأساسيات ليست ضمن التطبيع
    if (has(cp)) continue;
    const base = BASE_OF_PF[cp];
    let replacement = null;
    // (1) المطابقة عبر GSUB: أين يقع هذا الشكل؟ أول الكلمة = ابتدائي/معزول، وسطها = وسطي، آخرها = نهائي
    if (base) {
      // fontkit.layout يعيد الرسمات بالترتيب البصري (آخر عنصر = أول حرف منطقي)
      const solo = shapeProbe(String.fromCodePoint(base));                       // معزول
      const init = shapeProbe(String.fromCodePoint(base) + '\u0645');            // ابتدائي (آخر عنصر بصري)
      const mid = shapeProbe('\u0645' + String.fromCodePoint(base) + '\u0645'); // وسطي (منتصف)
      const fin = shapeProbe('\u0645' + String.fromCodePoint(base));            // نهائي (أول عنصر بصري)
      const vv = a => (a && a.length ? a : []);
      const initialGid = vv(init)[vv(init).length - 1], medialGid = vv(mid)[1], finalGid = vv(fin)[0], isolatedGid = vv(solo)[0];
      const wanted = { 0: isolatedGid, 1: finalGid, 2: initialGid, 3: medialGid }[FORM_KIND[cp] ?? 0] || isolatedGid;
      const candidates = [wanted, isolatedGid, finalGid, initialGid, medialGid];
      for (const gid of candidates) {
        if (gid && idToCp.has(gid)) { replacement = idToCp.get(gid); if (replacement != null && glyphId(replacement) === gid) break; }
      }
      // (2) الحرف الأساسي (شكله المعزول غالبًا)
      if (replacement === null && has(base)) replacement = base;
      // (3) أي شكل آخر متاح لنفس الحرف
      if (replacement === null) {
        for (const alt of formsByLetter[base]) if (has(alt)) { replacement = alt; break; }
      }
    }
    if (replacement !== null && glyphId(replacement) > 0) {
      map.set(cp, replacement);
      compensated++;
    }
  }
  return { map, compensated, missing: [...engineCodepoints()].filter(cp => cp >= 0xFB50 && cp <= 0xFEFF && !has(cp) && !map.has(cp)) };
}

module.exports = { buildNormalization, engineCodepoints, BASE_OF_PF };
