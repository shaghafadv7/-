// ============================================================
// معالجة النص العربي لتوليد PDF صحيح مع pdfkit
// 1) reshape: تحويل الحروف إلى أشكالها السياقية (Presentation Forms-B)
// 2) lamAlef: تحويل لام+ألف إلى الحرف المركب
// 3) bidi: ترتيب بصري (كلمات من اليمين لليسار، أرقام ولاتيني كما هي)
// ============================================================

// [isolated, final, initial, medial]، النوع: D=ي join من الجهتين، R=يوصل بما قبله فقط
const LETTERS = {
  0x0621: { f: [0xFE80], j: 'R' },            // ء
  0x0622: { f: [0xFE81, 0xFE82], j: 'R' },    // آ
  0x0623: { f: [0xFE83, 0xFE84], j: 'R' },    // أ
  0x0624: { f: [0xFE85, 0xFE86], j: 'R' },    // ؤ
  0x0625: { f: [0xFE87, 0xFE88], j: 'R' },    // إ
  0x0626: { f: [0xFE89, 0xFE8A, 0xFE8B, 0xFE8C], j: 'D' }, // ئ
  0x0627: { f: [0xFE8D, 0xFE8E], j: 'R' },    // ا
  0x0628: { f: [0xFE8F, 0xFE90, 0xFE91, 0xFE92], j: 'D' }, // ب
  0x0629: { f: [0xFE93, 0xFE94], j: 'R' },    // ة
  0x062A: { f: [0xFE95, 0xFE96, 0xFE97, 0xFE98], j: 'D' }, // ت
  0x062B: { f: [0xFE99, 0xFE9A, 0xFE9B, 0xFE9C], j: 'D' }, // ث
  0x062C: { f: [0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0], j: 'D' }, // ج
  0x062D: { f: [0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4], j: 'D' }, // ح
  0x062E: { f: [0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8], j: 'D' }, // خ
  0x062F: { f: [0xFEA9, 0xFEAA], j: 'R' },    // د
  0x0630: { f: [0xFEAB, 0xFEAC], j: 'R' },    // ذ
  0x0631: { f: [0xFEAD, 0xFEAE], j: 'R' },    // ر
  0x0632: { f: [0xFEAF, 0xFEB0], j: 'R' },    // ز
  0x0633: { f: [0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4], j: 'D' }, // س
  0x0634: { f: [0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8], j: 'D' }, // ش
  0x0635: { f: [0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC], j: 'D' }, // ص
  0x0636: { f: [0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0], j: 'D' }, // ض
  0x0637: { f: [0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4], j: 'D' }, // ط
  0x0638: { f: [0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8], j: 'D' }, // ظ
  0x0639: { f: [0xFEC9, 0xFECA, 0xFECB, 0xFECC], j: 'D' }, // ع
  0x063A: { f: [0xFECD, 0xFECE, 0xFECF, 0xFED0], j: 'D' }, // غ
  0x0640: { j: 'D', tatweel: true },          // ـ
  0x0641: { f: [0xFED1, 0xFED2, 0xFED3, 0xFED4], j: 'D' }, // ف
  0x0642: { f: [0xFED5, 0xFED6, 0xFED7, 0xFED8], j: 'D' }, // ق
  0x0643: { f: [0xFED9, 0xFEDA, 0xFEDB, 0xFEDC], j: 'D' }, // ك
  0x0644: { f: [0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0], j: 'D' }, // ل
  0x0645: { f: [0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4], j: 'D' }, // م
  0x0646: { f: [0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8], j: 'D' }, // ن
  0x0647: { f: [0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC], j: 'D' }, // ه
  0x0648: { f: [0xFEED, 0xFEEE], j: 'R' },    // و
  0x0649: { f: [0xFEEF, 0xFEF0], j: 'R' },    // ى
  0x064A: { f: [0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4], j: 'D' }, // ي
  0x0671: { f: [0xFB50, 0xFB51], j: 'R' },    // ٱ
  0x0679: { f: [0xFB66, 0xFB67, 0xFB68, 0xFB69], j: 'D' }, // ٹ
  0x067E: { f: [0xFB56, 0xFB57, 0xFB58, 0xFB59], j: 'D' }, // پ
  0x0686: { f: [0xFB7A, 0xFB7B, 0xFB7C, 0xFB7D], j: 'D' }, // چ
  0x0698: { f: [0xFB8A, 0xFB8B], j: 'R' },    // ژ
  0x06A9: { f: [0xFB8E, 0xFB8F, 0xFB90, 0xFB91], j: 'D' }, // ک
  0x06AF: { f: [0xFB92, 0xFB93, 0xFB94, 0xFB95], j: 'D' }, // گ
  0x06CC: { f: [0xFBFC, 0xFBFD, 0xFBFE, 0xFBFF], j: 'D' }, // ی
};
// لام + ألف => مركبات
const LAM_ALEF = {
  0x0622: { i: 0xFEF5, f: 0xFEF6 },
  0x0623: { i: 0xFEF7, f: 0xFEF8 },
  0x0625: { i: 0xFEF9, f: 0xFEFA },
  0x0627: { i: 0xFEFB, f: 0xFEFC },
};
const TATWEEL = 0x0640, LAM = 0x0644;
const isArabicChar = c => (c >= 0x0600 && c <= 0x06FF) || (c >= 0x0750 && c <= 0x077F) || (c >= 0xFB50 && c <= 0xFDFF) || (c >= 0xFE70 && c <= 0xFEFF);
const isDiacritic = c => (c >= 0x064B && c <= 0x0652) || c === 0x0670 || c === 0x0640;

function letterAt(text, i) { // يتجاوز التشكيل والتطويل
  while (i < text.length) {
    const c = text.codePointAt(i);
    if (isDiacritic(c) && c !== TATWEEL) i++; else return i;
  }
  return -1;
}
function joinType(cp) { const e = LETTERS[cp]; if (!e) return null; return e.tatweel ? 'D' : e.j; }

// تحويل نص عربي منطقي إلى أشكال العرض (بنفس الترتيب المنطقي)
function reshapeLogical(text) {
  const out = [];
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const cp = text.codePointAt(i);
    if (!isArabicChar(cp) || isDiacritic(cp) && cp !== TATWEEL) { out.push(cp); continue; }
    const info = LETTERS[cp];
    if (!info) { out.push(cp); continue; }
    if (info.tatweel) { out.push(TATWEEL); continue; }
    // ما قبل الحرف (أول حرف قابل للدمج فعليًا)
    let pi = -1;
    for (let k = i - 1; k >= 0; k--) { const pc = text.codePointAt(k); if (isDiacritic(pc) && pc !== TATWEEL) continue; pi = k; break; }
    const prevJoins = pi >= 0 && joinType(text.codePointAt(pi)) === 'D';
    // ما بعد الحرف
    let ni = letterAt(text, i + 1), nextCp = ni >= 0 ? text.codePointAt(ni) : 0;
    const nextIsLetter = nextCp && LETTERS[nextCp];
    const nextJoinable = nextIsLetter && (joinType(nextCp) === 'D' || joinType(nextCp) === 'R');
    // لام+ألف
    if (cp === LAM && nextCp && LAM_ALEF[nextCp]) {
      const lig = LAM_ALEF[nextCp];
      out.push(prevJoins ? lig.f : lig.i);
      i = ni; // تخطي الألف
      continue;
    }
    const jt = joinType(cp);
    let form;
    if (jt === 'D') {
      if (prevJoins && nextJoinable) form = 3;      // وسطي
      else if (prevJoins) form = 1;                 // نهائي
      else if (nextJoinable) form = 2;              // ابتدائي
      else form = 0;                                // منفرد
    } else { // R
      form = prevJoins ? 1 : 0;
    }
    out.push(info.f[Math.min(form, info.f.length - 1)]);
  }
  return out.map(c => String.fromCodePoint(c)).join('');
}

const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '«': '»', '»': '«', '<': '>', '>': '<' };
function reverseToken(s) {
  return [...s].reverse().map(ch => MIRROR[ch] || ch).join('');
}
const hasArabic = s => [...s].some(ch => isArabicChar(ch.codePointAt(0)));

/**
 * ترتيب بصري لنص مختلط (عربي + أرقام + لاتيني) على سطر RTL.
 * يعيد مصفوفة مقاطع: {text, rtl} بحيث يُرسم المقطع الأول من أقصى اليمين.
 */
function bidiSegments(text) {
  const words = String(text ?? '').split(/(\s+)/).filter(w => w !== '');
  const segs = [];
  for (const w of words) {
    if (/^\s+$/.test(w)) { segs.push({ text: w, rtl: false, space: true }); continue; }
    const rtl = hasArabic(w);
    segs.push({ text: rtl ? reverseToken(reshapeLogical(w)) : w, rtl });
  }
  // ترتيب الكلمات: RTL => الأخير أولًا
  return segs.reverse();
}

module.exports = { reshapeLogical, bidiSegments, isArabicChar, hasArabic };
