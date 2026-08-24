// اختبار شامل v1.4.0 — بيانات الشركة المركزية + الشعار في PDF + العربية/RTL
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
const { hasWord } = require('./lib/pdfcheck');

(async () => {
  console.log('== 1) الإعدادات العامة واسم الموقع ==');
  const pub = await call(null, 'GET', '/api/public-settings');
  ok(pub.status === 200 && pub.d.site_name === 'بيات الأكنة', 'إعدادات عامة بدون دخول تعرض اسم الموقع');
  ok(!('email' in pub.d) && !('phone_main' in pub.d) && !('cr_number' in pub.d), 'الإعدادات العامة لا تكشف بيانات حساسة');
  const T = (await call(null, 'POST', '/api/login', { username: 'admin', password: 'Admin@103' })).d.token;
  await call(T, 'POST', '/api/users', { name: 'محاسب', username: 'acc1', password: 'Pass@1234', role: 'accountant' });
  const TACC = (await call(null, 'POST', '/api/login', { username: 'acc1', password: 'Pass@1234' })).d.token;
  ok(!!T && !!TACC, 'دخول المدير والمحاسب');

  console.log('== 2) بيانات شركة تجريبية ==');
  const P = (await call(T, 'POST', '/api/projects', { code: '103', name: 'مشروع النزهة' })).d.id;
  const F = (await call(T, 'POST', '/api/floors', { project_id: P, name: 'الأول', floor_order: 1 })).d.id;
  const U = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: F, unit_number: 'A-101', price: 495000 })).d.id;
  const S = (await call(T, 'POST', '/api/sales', { unit_id: U, customer_name: 'عبدالله السالم', customer_phone: '0501112222', base_price: 495000, discount_type: 'percent', discount_value: 4, payment_method: 'cash', paid_amount: 100000 })).d;
  ok(S.sale_no, 'بيعة تجريبية بخصم 4%');
  const put = await call(T, 'PUT', '/api/settings', {
    company_name_ar: 'شركة بيات الأكنة العقارية', site_name: 'منصة الأكنة الذكية',
    phone_main: '0500000001', phone_extra: '0500000002', whatsapp: '0500000003',
    email: 'info@akena.sa', address: 'جدة — حي النزهة', cr_number: '1010123456', tax_number: '300012345600003',
    doc_footer_note: 'جميع الأسعار تشمل ضريبة القيمة المضافة',
  });
  ok(put.d.ok, 'حفظ بيانات الشركة الجديدة من الإعدادات');
  const st = await call(T, 'GET', '/api/settings');
  ok(st.d.site_name === 'منصة الأكنة الذكية' && st.d.phone_main === '0500000001' && st.d.cr_number === '1010123456', 'الحقول محفوظة مركزيًا (اسم الموقع/هاتف/س.ت)');
  const pub2 = await call(null, 'GET', '/api/public-settings');
  ok(pub2.d.site_name === 'منصة الأكنة الذكية', 'اسم الموقع الجديد يظهر فورًا في الإعدادات العامة (الدخول/العنوان)');
  const accPut = await call(TACC, 'PUT', '/api/settings', { site_name: 'اختراق' });
  ok(accPut.status === 403, 'المحاسب (بلا صلاحية إدارة بيانات الشركة) ممنوع من التعديل');

  console.log('== 3) الشعار: رفع PNG ورفض الصيغ غير المدعومة ==');
  // رفع شعار PNG شفاف 200x80
  const logoBuf = fs.readFileSync('/tmp/logo_test.png');
  const form = new FormData();
  form.append('logo', new Blob([logoBuf], { type: 'image/png' }), 'logo.png');
  let lr = await fetch(BASE + '/api/settings/logo', { method: 'POST', headers: { Authorization: 'Bearer ' + T }, body: form });
  const ld = await lr.json();
  ok(lr.status === 200 && ld.url.startsWith('/uploads/'), `رفع شعار PNG شفاف: ${ld.url}`);
  ok(fs.existsSync('public/uploads/' + ld.url.split('/').pop()), 'الشعار محفوظ على القرص');
  // رفض GIF (غير مدعوم في PDF)
  const badForm = new FormData();
  badForm.append('logo', new Blob([Buffer.from('GIF89a')], { type: 'image/gif' }), 'x.gif');
  const bad = await fetch(BASE + '/api/settings/logo', { method: 'POST', headers: { Authorization: 'Bearer ' + T }, body: badForm });
  ok(bad.status === 400, 'رفض صيغة غير مدعومة (GIF) برسالة واضحة');
  const accLogo = await fetch(BASE + '/api/settings/logo', { method: 'POST', headers: { Authorization: 'Bearer ' + TACC }, body: form });
  ok(accLogo.status === 403, 'المحاسب ممنوع من تغيير الشعار');

  console.log('== 4) تضمين الشعار في كل ملفات PDF ==');
  const pdfImages = async (params, type = 'unit_offer') => {
    const r = await call(T, 'POST', '/api/documents/generate', { type, params, save: false });
    const buf = Buffer.from(await (await fetch(BASE + '/api/documents/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: JSON.stringify({ type, params, save: false }) })).arrayBuffer());
    fs.writeFileSync('/tmp/v14.pdf', buf);
    try { return { size: buf.length, images: execSync('pdfimages -list /tmp/v14.pdf').toString() }; } catch (e) { return { size: buf.length, images: '', err: e.message }; }
  };
  const offer = await pdfImages({ unit_id: U });
  const imgLines = offer.images.split('\n').filter(l => / image /.test(l) || / smask /i.test(l) || /image/.test(l) && /^\s*\d+/.test(l));
  ok(offer.size > 5000 && offer.images.includes('image'), `عرض وحدة يتضمن الشعار داخل PDF (${offer.size}B، صور: ${imgLines.length})`);
  const dims = (offer.images.match(/\s(\d+)\s+(\d+)\s+image/g) || []);
  const firstDim = (offer.images.split('\n').find(l => l.includes(' image ') || l.includes(' image')) || '');
  ok(/200\s+80/.test(firstDim), `أبعاد الشعار محفوظة بدون تمديد (200×80): ${firstDim.trim().slice(0, 70)}`);
  // تقرير مسوقين بدون رفع جديد → الشعار موجود تلقائيًا
  const MK = (await call(T, 'POST', '/api/marketers', { name: 'أحمد', code: 'MK-1' })).d.id;
  await call(T, 'POST', `/api/sales/${S.id}/commission`, { marketer_id: MK, commission_type: 'percent', commission_value: 2 });
  const mkRep = await fetch(BASE + '/api/documents/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: JSON.stringify({ type: 'marketer_report', params: { marketer_id: MK }, save: false }) });
  fs.writeFileSync('/tmp/v14mk.pdf', Buffer.from(await mkRep.arrayBuffer()));
  ok(execSync('pdfimages -list /tmp/v14mk.pdf').toString().includes('image'), 'تقرير المسوقين يستخدم نفس الشعار تلقائيًا (بلا إعادة رفع)');
  for (const t of ['search_results', 'sales_report', 'financial_report', 'payments_report', 'commissions_report', 'marketers_report']) {
    const r = await fetch(BASE + '/api/documents/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: JSON.stringify({ type: t, params: {}, save: false }) });
    fs.writeFileSync('/tmp/v14x.pdf', Buffer.from(await r.arrayBuffer()));
    const has = execSync('pdfimages -list /tmp/v14x.pdf').toString().includes('image');
    ok(r.status === 200 && has, `${t}: الشعار مضمّن في رأس الصفحة`);
  }

  console.log('== 5) بيانات الشركة الجديدة داخل PDF تلقائيًا ==');
  const salePdf = await call(T, 'POST', '/api/documents/generate', { type: 'sale', params: { sale_id: S.id }, save: true });
  fs.writeFileSync('/tmp/v14sale.pdf', fs.readFileSync('data/pdf_archive/' + salePdf.d.filename));
  const saleTxt = execSync('pdftotext /tmp/v14sale.pdf -').toString().replace(/[\u2000-\u200f\u202a-\u202e\u2066-\u2069]/g, '');
  ok(hasWord(saleTxt, 'منصة') && hasWord(saleTxt, 'الأكنة') && hasWord(saleTxt, 'الذكية'), 'اسم الموقع الجديد يظهر في ترويسة PDF');
  ok(saleTxt.includes('0500000001') && saleTxt.includes('0500000003'), 'الهاتف والواتساب الجدد في شريط التواصل');
  ok(saleTxt.includes('info@akena.sa'), 'البريد الإلكتروني الجديد');
  ok(saleTxt.includes('1010123456'), 'رقم السجل التجاري');
  ok(saleTxt.includes('300012345600003'), 'الرقم الضريبي');
  ok(hasWord(saleTxt, 'ضريبة') && hasWord(saleTxt, 'القيمة') && hasWord(saleTxt, 'المضافة'), 'البيانات الإضافية (doc_footer_note) تظهر في المستند');
  ok(salePdf.d.filename.startsWith('منصة_الأكنة_الذكية'), `بادئة اسم الملف من اسم الموقع المركزي: ${salePdf.d.filename}`);

  console.log('== 6) الأرشيف القديم لا يتغير بعد تعديل البيانات ==');
  const oldBytes = fs.readFileSync('data/pdf_archive/' + salePdf.d.filename);
  await call(T, 'PUT', '/api/settings', { company_name_ar: 'شركة أخرى تمامًا', phone_main: '0999999999' });
  const salePdf2 = await fetch(BASE + '/api/documents/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: JSON.stringify({ type: 'sale', params: { sale_id: S.id }, save: false }) });
  fs.writeFileSync('/tmp/v14sale2.pdf', Buffer.from(await salePdf2.arrayBuffer()));
  const saleTxt2 = execSync('pdftotext /tmp/v14sale2.pdf -').toString().replace(/[\u2000-\u200f\u202a-\u202e\u2066-\u2069]/g, '');
  ok(saleTxt2.includes('0999999999'), 'PDF الجديد بعد التغيير يستخدم البيانات الجديدة تلقائيًا');
  const stillOld = fs.readFileSync('data/pdf_archive/' + salePdf.d.filename);
  ok(Buffer.compare(oldBytes, stillOld) === 0, 'ملف الأرشيف القديم لم يتغير بتاتًا (تاريخي سليم)');
  // إعادة البيانات التجريبية
  await call(T, 'PUT', '/api/settings', { company_name_ar: 'شركة بيات الأكنة العقارية', phone_main: '0500000001' });

  console.log('== 7) العربية وRTL في PDF ==');
  const chk = (txt, w) => hasWord(txt, w);
  ok(chk(saleTxt2, 'سند') && chk(saleTxt2, 'الوحدة') && chk(saleTxt2, 'الدفعات'), 'حروف متصلة ومشكّلة في المستندات');
  ok(saleTxt2.includes('475,200') && saleTxt2.includes('19,800'), 'الأسعار والخصم بالأرقام الصحيحة (495000-4%)');
  ok(!/[\uFFFD]/.test(saleTxt2), 'لا مربعات/رموز بديلة');
  execSync('mutool draw -o /tmp/v14render.png /tmp/v14sale2.pdf 2>/dev/null');
  execSync('pdftoppm -png -r 50 -f 1 -l 1 /tmp/v14sale2.pdf /tmp/v14render2');
  ok(fs.existsSync('/tmp/v14render.png') && fs.existsSync('/tmp/v14render2-1.png'), 'الملف يُعرض على قارئين مختلفين (MuPDF + Poppler)');
  const fonts = execSync('pdffonts /tmp/v14sale2.pdf').toString().replace(/[\u2000-\u200f\u202a-\u202e\u2066-\u2069]/g, '');
  ok(/ExpoArabic/i.test(fonts), 'خط Expo Arabic مضمّن — نفس الشكل على أي جهاز');

  console.log('== 8) إزالة الشعار ==');
  const rm = await call(T, 'POST', '/api/settings/logo/remove');
  ok(rm.d.ok && (await call(T, 'GET', '/api/settings')).d.logo_url === '', 'إزالة الشعار من الإعدادات');
  const afterRm = await fetch(BASE + '/api/documents/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: JSON.stringify({ type: 'unit_offer', params: { unit_id: U }, save: false }) });
  fs.writeFileSync('/tmp/v14rm.pdf', Buffer.from(await afterRm.arrayBuffer()));
  ok(!execSync('pdfimages -list /tmp/v14rm.pdf').toString().split('\n').some(l => /\simage\s/.test(l)), 'بعد الإزالة: PDF بلا صور شعار (ختم مركزي بديل)');

  console.log(`\n===== النتيجة: ${pass} نجح / ${fail} فشل =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
