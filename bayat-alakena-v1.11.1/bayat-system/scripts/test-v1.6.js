// اختبار شامل v1.6.0 — إصلاحات PDF الأربعة: العربية/اللف/الأعمدة/الفوتر
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
const cleanTxt = s => String(s).replace(/[\u2000-\u200f\u202a-\u202e\u2066-\u2069]/g, '');
const flat = s => cleanTxt(s).replace(/\s+/g, '');
const pdfTxt = pdf => cleanTxt(execSync(`pdftotext "${pdf}" -`).toString());
const rawTxt = (pdf, pg = null) => cleanTxt(execSync(`pdftotext -raw ${pg ? '-f ' + pg + ' -l ' + pg + ' ' : ''}"${pdf}" -`).toString());
const pageTxt = (pdf, i) => cleanTxt(execSync(`pdftotext -f ${i} -l ${i} "${pdf}" -`).toString());
const pageOf = pdf => +((execSync(`pdfinfo "${pdf}"`).toString().match(/Pages:\s+(\d+)/) || [])[1] || 0);
const traceOf = pdf => { try { return execSync(`mutool draw -F trace "${pdf}" 2>/dev/null`, { maxBuffer: 64 * 1024 * 1024 }).toString(); } catch { return ''; } };
const countRiyal = t => (t.match(/<fill_path[\s\S]*?<\/fill_path>/g) || []).filter(b => (b.match(/<curve/g) || []).length >= 8 && (b.match(/<line/g) || []).length >= 20).length;

(async () => {
  console.log('== 1) تهيئة بيانات غنية ==');
  const T = (await call(null, 'POST', '/api/login', { username: 'admin', password: 'Admin@103' })).d.token;
  await call(T, 'PUT', '/api/settings', { company_name_ar: 'شركة بيات الأكنة للتطوير العقاري', site_name: 'بيات الأكنة', phone_main: '0543537870', phone_extra: '0563056320', whatsapp: '0543537870', email: 'info@bayatalkenna.com', address: 'جدة — حي النزهة قطعة 563/ب', contact_website: 'www.bayatalkenna.com' });
  const P = (await call(T, 'POST', '/api/projects', { code: '103', name: 'مشروع Bayat Al-Akna 101 النزهة', location: 'حي النزهة' })).d.id;
  const F1 = (await call(T, 'POST', '/api/floors', { project_id: P, name: 'الدور الأول', floor_order: 1 })).d.id;
  const F2 = (await call(T, 'POST', '/api/floors', { project_id: P, name: 'الروفات الخامس المطل على الحديقة', floor_order: 5, is_roof: true })).d.id;
  const mA = (await call(T, 'POST', '/api/models', { project_id: P, code: 'A1', name: 'ثلاث غرف صالة واسعة بإطلالة بحرية', rooms: 3, area: 165, base_price: 495000 })).d.id;
  const MK1 = (await call(T, 'POST', '/api/marketers', { name: 'أحمد عبدالرحمن بن سالم المهداوي', phone: '0551112222', code: 'MK-101' })).d.id;
  const MK2 = (await call(T, 'POST', '/api/marketers', { name: 'سعد', phone: '0553334444', code: 'MK-102' })).d.id;
  // 12 وحدة بأسماء ومبالغ متنوعة
  const units = [];
  for (let i = 1; i <= 12; i++) {
    const u = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: i % 2 ? F1 : F2, model_id: mA, unit_number: 'A-' + (100 + i), price: 490000 + i * 5000 })).d.id;
    units.push(u);
  }
  // 8 بيوع مع مسوقين وخصومات ودفعات
  const sales = [];
  for (let i = 0; i < 8; i++) {
    const s = (await call(T, 'POST', '/api/sales', { unit_id: units[i], customer_name: 'عبدالله محمد السالم رقم ' + i, customer_phone: '05011122' + (30 + i), base_price: 490000 + (i + 1) * 5000, discount_type: i % 2 ? 'percent' : 'amount', discount_value: i % 2 ? 4 : 15000, payment_method: ['cash', 'bank_transfer', 'check'][i % 3], payment_ref: i % 3 === 1 ? 'TR-' + (9000 + i) : (i % 3 === 2 ? 'CH-' + (500 + i) : ''), paid_amount: 100000, marketer_id: i % 2 ? MK1 : MK2, commission_type: 'percent', commission_value: 1 })).d;
    sales.push(s.id);
    await call(T, 'POST', `/api/sales/${s.id}/payments`, { amount: 50000, method: 'cash' });
    await call(T, 'POST', `/api/sales/${s.id}/commission-payments`, { amount: 500, method: 'cash' });
  }
  ok(units.length === 12 && sales.length === 8, '12 وحدة و8 بيوع مع عمولات ودفعات');

  console.log('== 2) إصلاح 1: العربية والمختلط داخل PDF ==');
  const gen = async (type, params, save = false) => (await fetch(BASE + '/api/documents/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: JSON.stringify({ type, params, save }) }));
  const saleR = await gen('sale', { sale_id: sales[0] });
  fs.writeFileSync('/tmp/v16sale.pdf', Buffer.from(await saleR.arrayBuffer()));
  const st = pdfTxt('/tmp/v16sale.pdf');
  const hasAll = (txt, words) => words.every(w => flat(txt).includes(flat(w)));
  ok(hasAll(st, ['سند', 'بيع', 'وحدة']), 'عنوان المستند عربي سليم');
  ok(hasAll(st, ['حوالة بنكية']) || hasAll(st, ['كاش']) || hasAll(st, ['شيك']), 'طريقة الدفع عربية سليمة');
  ok(st.includes('A-101') && st.includes('SAL-2026'), 'الرموز اللاتينية والأرقام سليمة');
  ok(st.includes('0501112230') || st.includes('0551112222'), 'أرقام الهواتف سليمة');
  ok(/ExpoArabic/.test(execSync('pdffonts /tmp/v16sale.pdf').toString()), 'خط Expo Arabic مضمّن');
  const searchR = await gen('search_results', { project_id: P });
  fs.writeFileSync('/tmp/v16srch.pdf', Buffer.from(await searchR.arrayBuffer()));
  const stx = pdfTxt('/tmp/v16srch.pdf');
  ok(hasAll(stx, ['مشروع', 'Bayat Al-Akna 101', 'النزهة']), 'اسم المشروع المختلط عربي+إنجليزي سليم');
  ok(hasAll(stx, ['الروفات', 'الخامس', 'الحديقة']), 'اسم الدور الطويل عربي سليم');

  console.log('== 3) إصلاح 2: لف الخلايا وارتفاع الصفوف ==');
  const mkR = await gen('marketer_report', { marketer_id: MK1 });
  fs.writeFileSync('/tmp/v16mk.pdf', Buffer.from(await mkR.arrayBuffer()));
  const mk = pdfTxt('/tmp/v16mk.pdf');
  ok(hasAll(mk, ['أحمد', 'عبدالرحمن', 'بن', 'سالم', 'المهداوي']), 'اسم المسوق الطويل كامل بلا قص (ملفوف)');
  ok(hasAll(mk, ['متبقي', 'المسوق', 'العمولة', 'المدفوع']), 'عناوين الأعمدة الطويلة كاملة (ملفوفة لا مقصوصة)');
  ok(hasAll(mk, ['عبدالله', 'محمد', 'السعمري']) || hasAll(mk, ['عبدالله', 'محمد', 'السالم']), 'أسماء العملاء كاملة');
  // لا خط صغير مبالغ: أصغر حجم خط في المستند ≥ 6 (نفحص عبر trace trm)
  const mkTrace = traceOf('/tmp/v16mk.pdf');
  const trms = [...mkTrace.matchAll(/trm="([\d.]+) /g)].map(m => +m[1]).filter(v => v > 0);
  ok(trms.length && Math.min(...trms) >= 5.9, `أصغر خط في التقرير ${trms.length ? Math.min(...trms).toFixed(1) : '?'}pt (≥6 — لا تصغير مبالغ فيه)`);

  console.log('== 4) إصلاح 3: الأعمدة الكثيرة والعرض الديناميكي ==');
  const salesRep = await gen('sales_report', {});
  fs.writeFileSync('/tmp/v16srep.pdf', Buffer.from(await salesRep.arrayBuffer()));
  const sr = pdfTxt('/tmp/v16srep.pdf');
  ok(/841\.89 x 595\.28/.test(execSync('pdfinfo /tmp/v16srep.pdf').toString()), 'تقرير المبيعات (11 عمودًا) انتقل تلقائيًا إلى Landscape');
  const hdrs = ['رقم', 'البيع', 'التاريخ', 'المشروع', 'الوحدة', 'العميل', 'المرحلة', 'قبل', 'الخصم', 'النهائي', 'المدفوع', 'المتبقي'];
  ok(hasAll(sr, hdrs), 'كل رؤوس الأعمدة العشرة موجودة كاملة');
  ok(sr.includes('SAL-2026') && (sr.match(/SAL-2026-\d+/g) || []).length >= 8, 'كل الصفوف (8 بيوع) ظاهرة');
  // تقسيم أفقي: تقرير مصطنع بأعمدة كلماتها عريضة جدًا
  const { ArabicPDF } = require('../lib/pdf');
  const pWide = new ArabicPDF({ settings: {}, title: 'اختبار التقسيم الأفقي', user: { name: 'م' } });
  pWide.table({
    cols: [1, 2, 3, 4, 5, 6].map(n => ({ label: 'عمود طويل جدًا رقم ' + n + ' بمحتوى عريض', key: 'c' + n, w: 1 / 6 })),
    rows: [{ c1: 'superlongvalue-one', c2: 'superlongvalue-two', c3: 'superlongvalue-three', c4: 'superlongvalue-four', c5: 'superlongvalue-five', c6: 'superlongvalue-six' }],
    fontSize: 8,
  });
  fs.writeFileSync('/tmp/v16split.pdf', await pWide.buffer());
  const splitPages = pageOf('/tmp/v16split.pdf');
  const splitTxt = pdfTxt('/tmp/v16split.pdf');
  ok(splitPages >= 2, `الأعمدة الأوسع من الصفحة توزعت على صفحات أفقية (${splitPages} صفحات)`);
  ok(['superlongvalue-one', 'superlongvalue-two', 'superlongvalue-three', 'superlongvalue-four', 'superlongvalue-five', 'superlongvalue-six'].every(v => splitTxt.includes(v)), 'كل بيانات الأعمدة الستة موجودة بعد التقسيم (صفر فقد)');
  // تكرار رأس الجدول عند امتداد الصفوف لصفحات متعددة
  const pMulti = new ArabicPDF({ settings: {}, title: 'اختبار تكرار الرأس', user: { name: 'م' } });
  pMulti.table({
    cols: [{ label: 'رقم الصف', key: 'a', w: .5 }, { label: 'القيمة', key: 'b', w: .5, align: 'center' }],
    rows: Array.from({ length: 45 }, (_, i) => ({ a: 'صف رقم ' + (i + 1), b: String(i + 1) })),
    fontSize: 9,
  });
  fs.writeFileSync('/tmp/v16rep.pdf', await pMulti.buffer());
  const repPages = pageOf('/tmp/v16rep.pdf');
  const repTxt = pdfTxt('/tmp/v16rep.pdf');
  const rawRep = rawTxt('/tmp/v16rep.pdf');
  const headerCount = (rawRep.match(/الصف/g) || []).length;
  ok(repPages >= 2 && headerCount >= repPages, `رأس الجدول يتكرر في كل صفحة جديدة (${headerCount} مرة في ${repPages} صفحات)`);
  const tokens = rawRep.split(/[\s\u202a-\u202e\u200e\u200f]+/).filter(Boolean);
  ok(Array.from({ length: 45 }, (_, k) => k + 1).every(n => tokens.includes(String(n))), 'كل الصفوف الـ45 ظاهرة بلا فقد');

  console.log('== 5) إصلاح 4: الفوتر المحجوز ==');
  // فوتر متعدد الأسطر + أرقام صفحات صحيحة + عدم تداخل المحتوى
  const repPages2 = pageOf('/tmp/v16rep.pdf');
  let pagesOk = true;
  for (let i = 1; i <= repPages2; i++) {
    const pt = flat(rawTxt('/tmp/v16rep.pdf', i));
    const visForm = String(repPages2) + 'من' + i + 'صفحة';
    if (!pt.includes('صفحة' + i + 'من' + repPages2) && !pt.includes(visForm)) { pagesOk = false; console.log('   صفحة', i, 'لا يظهر فيها رقمها الصحيح'); }
  }
  ok(pagesOk, `رقم الصفحة صحيح ومحدث في كل صفحة (صفحة i من ${repPages2})`);
  const fTxt = pdfTxt('/tmp/v16sale.pdf');
  ok(hasAll(rawTxt('/tmp/v16sale.pdf'), ['جميع', 'الحقوق', 'محفوظة', 'شركة', 'بيات']), 'بيانات الشركة في الفوتر');
  ok(fTxt.includes('info@bayatalkenna.com') && fTxt.includes('www.bayatalkenna.com'), 'بيانات التواصل كاملة في الفوتر (بلف عند الطول)');
  // لا محتوى داخل منطقة الفوتر: كل نصوص الجدول فوق الخط الذهبي
  // لا يوجد محتوى (بيانات صفوف) داخل منطقة الفوتر في أي صفحة
  const t2 = traceOf('/tmp/v16srep.pdf');
  const footTop = 595.28 - 56;
  const pageBlocks = t2.split(/<page /).slice(1);
  const violations = [];
  pageBlocks.forEach((pb, pi) => {
    [...pb.matchAll(/<g unicode="([^"]*)"[^>]*y="([\d.]+)"/g)].forEach(m => {
      if (+m[1+0-1+1] > footTop + 2 && String(m[1]).charCodeAt(0) > 0x2E80) { /* محتوى غير رقمي بالفوتر */ }
    });
    const deepSpans = [...pb.matchAll(/<g unicode="([^"]*)"[^>]*y="([\d.]+)"/g)].filter(m => +m[2] > footTop + 16);
    const joined = deepSpans.map(m => m[1]).join('');
    if (joined.includes('SAL') || joined.includes('مشروع') || joined.includes('عميل')) violations.push(pi + 1);
  });
  ok(violations.length === 0, 'لا تتداخل بيانات الجدول مع منطقة الفوتر المحجوزة في أي صفحة');
  ok(countRiyal(traceOf('/tmp/v16mk.pdf')) >= 3, 'رمز الريال المتجهي حاضر في التقارير');

  console.log(`\n===== النتيجة: ${pass} نجح / ${fail} فشل =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
