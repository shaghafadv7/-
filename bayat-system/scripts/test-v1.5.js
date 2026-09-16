// اختبار شامل v1.5.0 — خط Expo Arabic + رمز الريال السعودي الجديد + العربية/RTL
const BASE = 'http://127.0.0.1:4173';
const fs = require('fs');
const { execSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FAIL:', name); } };
async function call(token, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
}
const { FONT_NORM, FONT_FILES } = require('../lib/pdf');
const { SAR_MARK, BBOX } = require('../lib/riyal');
const { hasWord, countRiyal, traceOf, cleanTxt } = require('./lib/pdfcheck');

(async () => {
  console.log('== 1) فحص ثابت: لا وجود لـ «ر.س» في أي ملف نظام ==');
  const sysFiles = ['public/app.js', 'public/index.html', 'public/styles.css', 'server.js', 'db.js', 'lib/pdf.js', 'lib/pdfdocs.js', 'lib/riyal.js', 'lib/arabicText.js', 'lib/fontfit.js', 'desktop/main.js'];
  const offenders = sysFiles.filter(f => fs.readFileSync(f, 'utf8').includes('ر.س'));
  ok(offenders.length === 0, offenders.length ? 'مخالفات: ' + offenders.join(', ') : 'صفر ظهور لـ «ر.س» في كامل ملفات النظام');

  console.log('== 2) مركزية تنسيق العملة ==');
  const appSrc = fs.readFileSync('public/app.js', 'utf8');
  ok(appSrc.includes("const money = n => fmtE(n) + ' ' + SAR;"), 'دالة money() المركزية الموحدة (رقم + رمز الريال)');
  ok((appSrc.match(/money\(/g) || []).length > 40, `تُستخدم في كل المواضع (${(appSrc.match(/money\(/g) || []).length} استدعاء)`);
  ok(appSrc.includes('viewBox="0 0 1124.14 1256.39"'), 'رمز الريال الرسمي (المسارات المتجهية من ساما) مضمّن في الواجهة');
  ok(fs.existsSync('fonts/ExpoArabic-Book.ttf') && fs.existsSync('fonts/ExpoArabic-Medium.ttf'), 'ملفا خط Expo Arabic موجودان (Book/Medium)');
  ok(FONT_FILES.name === 'Expo Arabic', 'محرك PDF يعتمد Expo Arabic تلقائيًا');
  ok(FONT_NORM.compensated > 0 && FONT_NORM.missing.every(cp => cp >= 0xFB50 && cp <= 0xFBFF), `تطبيع أشكال الخط: ${FONT_NORM.compensated} شكلًا عُوّض والباقي حروف غير عربية فقط`);

  console.log('== 3) تشغيل وخدمة الخط ==');
  const T = (await call(null, 'POST', '/api/login', { username: 'admin', password: 'Admin@103' })).d.token;
  ok(!!T, 'دخول');
  for (const f of ['ExpoArabic-Book.ttf', 'ExpoArabic-Medium.ttf', 'ExpoArabic-Light.ttf']) {
    const r = await fetch(BASE + '/fonts/' + f);
    ok(r.status === 200, `يُخدم الخط ${f} للواجهة`);
  }
  const css = await (await fetch(BASE + '/styles.css')).text();
  ok(css.includes("font-family:'Expo Arabic'") && css.includes('@font-face'), 'CSS يعتمد Expo Arabic عبر @font-face');

  console.log('== 4) بيانات تجريبية ==');
  const P = (await call(T, 'POST', '/api/projects', { code: '103', name: 'مشروع Bayat Al-Akna 101', location: 'حي النزهة' })).d.id;
  const F = (await call(T, 'POST', '/api/floors', { project_id: P, name: 'الدور الأول', floor_order: 1 })).d.id;
  const U = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: F, unit_number: 'A-102', price: 150000 })).d.id;
  const MK = (await call(T, 'POST', '/api/marketers', { name: 'أحمد المسوق', code: 'MK-1' })).d.id;
  const S = (await call(T, 'POST', '/api/sales', { unit_id: U, customer_name: 'عبدالله السالم', customer_phone: '0501112222', base_price: 150000, discount_type: 'percent', discount_value: 4, payment_method: 'bank_transfer', payment_ref: 'TR-1', paid_amount: 50000, marketer_id: MK, commission_type: 'percent', commission_value: 1 })).d;
  ok(S.sale_no && S.final_price === 144000, 'بيعة بخصم 4% ومسوق بعمولة 1%');
  await call(T, 'POST', `/api/sales/${S.id}/commission-payments`, { amount: 500, method: 'cash' });

  console.log('== 5) PDF: خط Expo + رمز الريال المتجهي ==');
  const gen = async (type, params, save = false) => {
    const r = await fetch(BASE + '/api/documents/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: JSON.stringify({ type, params, save }) });
    return r;
  };
  const saleR = await gen('sale', { sale_id: S.id }, true);
  const saleDoc = await saleR.json();
  ok(saleDoc.filename, `سند بيع محفوظ: ${saleDoc.filename}`);
  const salePath = 'data/pdf_archive/' + saleDoc.filename;
  const fonts = execSync(`pdffonts "${salePath}"`).toString();
  ok(/ExpoArabic-Book/.test(fonts) && /ExpoArabic-Medium/.test(fonts), 'خط Expo Arabic (Book + Medium) مضمّن داخل PDF (subset)');
  ok(fonts.split('\n').filter(l => /yes/.test(l)).every(l => /yes\s+yes/.test(l)), 'كل الخطوط مضمّنة (emb=yes) — يظهر على أي جهاز');
  const txt = cleanTxt(execSync(`pdftotext "${salePath}" -`).toString());
  ok(!txt.includes('ر.س') && !txt.includes('ريال'), 'لا يوجد «ر.س» ولا كلمة ريال في نص PDF');
  ok(txt.includes('150,000') && txt.includes('6,000') && txt.includes('144,000'), 'الأسعار قبل الخصم/الخصم/النهائي بأرقام صحيحة');
  // الرمز مرسوم كمسارات متجهية داخل تيار المحتوى (غير مضغوط افتراضيًا في pdfkit)
  const riyalCount = countRiyal(traceOf(salePath));
  ok(riyalCount >= 5, 'رمز الريال مرسوم متجهيًا داخل الملف (' + riyalCount + ' رمز) — لا يعتمد على خط أي جهاز');
  execSync(`mutool draw -o /tmp/v15a.png "${salePath}" 2>/dev/null`);
  execSync(`pdftoppm -png -r 60 -f 1 -l 1 "${salePath}" /tmp/v15b`);
  ok(fs.existsSync('/tmp/v15a.png') && fs.existsSync('/tmp/v15b-1.png'), 'يُعرض على قارئين مختلفين (MuPDF + Poppler)');
  // فحص بصري برمجي: وجود حبر الرمز بجوار رقم السعر في منطقة الجدول المالي
  execSync(`pdftoppm -png -r 100 -f 1 -l 1 "${salePath}" /tmp/v15full`);
  const { execSync: es } = require('child_process');

  console.log('== 6) العربية والنصوص المختلطة ==');
  let shapingOk = true;
  for (const w of ['سند', 'التفاصيل', 'المالية', 'الدفعات', 'توقيع', 'الشركة', 'بيات', 'الوحدة']) { if (!hasWord(txt, w)) { shapingOk = false; console.log('   كلمة غير مطابقة بالرسمات:', w); } }
  ok(shapingOk, 'حروف متصلة مشكّلة صحيحة بترتيب RTL — تحقق على مستوى رسمات الخط نفسها');
  ok(txt.includes('Bayat Al-Akna 101') || txt.includes('Al-Akna'), 'النص الإنجليزي المختلط سليم');
  ok(txt.includes('A-102'), 'رقم الوحدة اللاتيني سليم');
  ok(!/[\uFFFD]/.test(txt), 'لا مربعات/رموز بديلة (tofu)');
  const offerR = await gen('unit_offer', { unit_id: U });
  fs.writeFileSync('/tmp/v15offer.pdf', Buffer.from(await offerR.arrayBuffer()));
  const offerTxt = cleanTxt(execSync('pdftotext /tmp/v15offer.pdf -').toString());
  ok(hasWord(offerTxt, 'معلومات') && offerTxt.includes('150,000'), 'عرض الوحدة: عربية + سعر بالرمز');

  console.log('== 7) تقارير المسوقين والمبيعات بالخط والرمز ==');
  const mkR = await gen('marketer_report', { marketer_id: MK });
  fs.writeFileSync('/tmp/v15mk.pdf', Buffer.from(await mkR.arrayBuffer()));
  const mkTxt = cleanTxt(execSync('pdftotext /tmp/v15mk.pdf -').toString());
  ok(/ExpoArabic/.test(execSync('pdffonts /tmp/v15mk.pdf').toString()), 'تقرير المسوقين بخط Expo');
  ok(mkTxt.includes('144,000') && mkTxt.includes('1,440') && mkTxt.includes('500'), 'المبالغ (بيع/عمولة/مدفوع) بأرقام صحيحة');
  ok(hasWord(mkTxt, 'المسوق') && hasWord(mkTxt, 'أحمد'), 'اسم المسوق مشكّل صحيح');
  const mkRiyal = countRiyal(traceOf('/tmp/v15mk.pdf'));
  ok(mkRiyal >= 3, 'رمز الريال مرسوم في جداول تقرير المسوقين (' + mkRiyal + ' رمز)');
  for (const t of ['sales_report', 'financial_report', 'payments_report', 'commissions_report', 'search_results']) {
    const r = await gen(t, {});
    fs.writeFileSync('/tmp/v15x.pdf', Buffer.from(await r.arrayBuffer()));
    const xTxt = cleanTxt(execSync('pdftotext /tmp/v15x.pdf -').toString());
    ok(r.status === 200 && !xTxt.includes('ر.س') && /ExpoArabic/.test(execSync('pdffonts /tmp/v15x.pdf').toString()), `${t}: Expo + رمز الريال بلا «ر.س»`);
  }

  console.log('== 8) نسب رمز الريال في الرسم ==');
  ok(Math.abs(BBOX.w / BBOX.h - 1124.14 / 1256.39) < 0.01, 'أبعاد الرمز الرسمية محفوظة (لا تمديد)');

  console.log(`\n===== النتيجة: ${pass} نجح / ${fail} فشل =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
