// أدوات تحقق موثوقة من مضمون PDF (محرك v1.5/v1.6 المنطقي)
const { execSync } = require('child_process');

const cleanTxt = s => String(s).replace(/[\u2000-\u200f\u202a-\u202e\u2066-\u2069]/g, '');

function traceOf(pdfPath) {
  try { return execSync(`mutool draw -F trace "${pdfPath}" 2>/dev/null`, { maxBuffer: 64 * 1024 * 1024 }).toString(); }
  catch { return ''; }
}

// عدّ رموز الريال المتجهية (مسار تعبئة كثيف: ≥8 منحنيات و≥20 خطًا)
function countRiyal(trace) {
  const blocks = trace.match(/<fill_path[\s\S]*?<\/fill_path>/g) || [];
  return blocks.filter(b => (b.match(/<curve/g) || []).length >= 8 && (b.match(/<line/g) || []).length >= 20).length;
}

// تحقق وجود كلمة عربية — مطابقة متسامحة:
// يزيل المسافات وعلامات الاتجاه، ويوحّد الألفات (تفادي انقلاب رابطة لام-ألف في ToUnicode)
function normWord(s) {
  return cleanTxt(s).replace(/[\s\u00a0]+/g, '').replace(/[ـ]/g, '');
}
function hasWord(txt, word) {
  const stripAlef = s => normWord(s).replace(/[اأإآ]/g, '');
  return stripAlef(txt).includes(stripAlef(word));
}

module.exports = { traceOf, countRiyal, hasWord, cleanTxt };
