// اختبار دائم لنظام الأيقونات الموحد — سلامة الـ 38 أيقونة وتغطية كل الأزرار
const src = require('fs').readFileSync(__dirname + '/../public/app.js', 'utf8');
const mIcons = src.match(/const ICONS = \{[\s\S]*?\n\};/)[0];
const mRules = src.match(/const ICON_RULES = \[[\s\S]*?\n\];/)[0];
const mIcon = src.match(/const icon = \(n, s = 16, w = 1\.7\) =>[^\n]+;/)[0];
const { ICONS, ICON_RULES, icon } = new Function(mIcons + '\n' + mRules + '\n' + mIcon + '\n return {ICONS, ICON_RULES, icon};')();
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL:', n); } };
// 1) سلامة كل أيقونة
let bad = [];
for (const k of Object.keys(ICONS)) {
  const s = icon(k, 16);
  if (!s.startsWith('<svg') || !s.endsWith('</svg>') || !ICONS[k].trim() || !s.includes('currentColor')) bad.push(k);
}
ok(bad.length === 0, `سلامة الأيقونات الـ ${Object.keys(ICONS).length} (SVG + currentColor)`);
// 2) أيقونات القائمة الجانبية في index.html
const idx = require('fs').readFileSync(__dirname + '/../public/index.html', 'utf8');
const navIcons = (idx.match(/class="nav-ic"/g) || []).length;
ok(navIcons >= 15, `أيقونات SVG في القائمة الجانبية والرأس (${navIcons})`);
ok(!/[◈▥▦▣◉▤♙♟⛁◎⚙☰⌕❖]/.test(idx), 'لا رموز نصية قديمة في الهيكل');
// 3) تغطية الأزرار: كل نص زر في القوالب يحصل على أيقونة أو مقبول نصيًا
const labels = [...src.matchAll(/>([^<>{}]{2,28})<\/button>/g)].map(m => m[1].trim());
const acceptable = /^(الغاء|إلغاء|حفظ التعديل?|حفظ$|إضافة|إغلاق)$/;
let missed = [];
for (const raw of [...new Set(labels)]) {
  if (acceptable.test(raw)) continue;
  const hit = ICON_RULES.some(([re]) => re.test(raw));
  if (!hit) missed.push(raw);
}
ok(missed.length === 0, 'كل أزرار النظام مغطاة بقواعد الأيقونات' + (missed.length ? ' — ناقص: ' + missed.join(' | ') : ''));
// 4) الرموز القديمة اختفت من app.js (عدا داخل تعليقات القواعد)
ok(!/[⬇🗄🖨⌖]/.test(src.replace(/ICON_RULES[\s\S]*?;/, '')), 'لا رموز تصدير/طباعة قديمة في القوالب');
console.log(`\n===== الأيقونات: ${pass} نجح / ${fail} فشل =====`);
process.exit(fail ? 1 : 0);
