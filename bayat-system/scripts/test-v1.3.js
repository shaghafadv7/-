// اختبار شامل v1.3.0 — الصلاحيات التفصيلية + تقارير المسوقين + PDF
const BASE = 'http://127.0.0.1:4173';
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FAIL:', name); } };
async function call(token, method, path, body, raw = false) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return r;
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
}
(async () => {
  console.log('== 1) التهيئة ==');
  const login = await call(null, 'POST', '/api/login', { username: 'admin', password: 'Admin@103' });
  const T = login.d.token;
  ok(!!T && login.d.user.perms.length > 30 && login.d.user.role === 'super_admin', 'مدير النظام يدخل ويستلم جميع الصلاحيات تلقائيًا');
  await call(T, 'POST', '/api/users', { name: 'محاسب', username: 'acc1', password: 'Pass@1234', role: 'accountant' });
  await call(T, 'POST', '/api/users', { name: 'مسؤول حجوزات', username: 'res1', password: 'Pass@1234', role: 'reservations_officer' });
  await call(T, 'POST', '/api/users', { name: 'مشاهد', username: 'view1', password: 'Pass@1234', role: 'viewer' });
  const TACC = (await call(null, 'POST', '/api/login', { username: 'acc1', password: 'Pass@1234' })).d.token;
  const TRES = (await call(null, 'POST', '/api/login', { username: 'res1', password: 'Pass@1234' })).d.token;
  const TVIEW = (await call(null, 'POST', '/api/login', { username: 'view1', password: 'Pass@1234' })).d.token;
  ok(!!TACC && !!TRES && !!TVIEW, 'إنشاء المستخدمين التجريبيين');

  console.log('== 2) مخطط الصلاحيات و /api/me ==');
  const schema = await call(T, 'GET', '/api/permissions-schema');
  ok(schema.d.length === 9 && schema.d.reduce((a, g) => a + g.items.length, 0) === 52, `9 مجموعات و52 صلاحية (${schema.d.length}/${schema.d.reduce((a, g) => a + g.items.length, 0)})`);
  const me = await call(TACC, 'GET', '/api/me');
  ok(me.d.perms.includes('add_payment') && !me.d.perms.includes('add_project') && me.d.permsCustomized === false, 'محاسب: افتراضياته في /api/me (دفعات نعم، مشاريع لا)');

  console.log('== 3) إنشاء بيانات تجريبية ==');
  const P = (await call(T, 'POST', '/api/projects', { code: '103', name: 'مشروع 103 النزهة', construction_status: 'under_construction' })).d.id;
  const f1 = (await call(T, 'POST', '/api/floors', { project_id: P, name: 'الدور الأول', floor_order: 1 })).d.id;
  const mA = (await call(T, 'POST', '/api/models', { project_id: P, code: 'A1', rooms: 3, area: 165, base_price: 495000 })).d.id;
  const u1 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: f1, model_id: mA, unit_number: 'A-101', price: 495000 })).d.id;
  const u2 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: f1, model_id: mA, unit_number: 'A-102', price: 495000 })).d.id;
  const u3 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: f1, model_id: mA, unit_number: 'A-103', price: 490000 })).d.id;
  const MK = (await call(T, 'POST', '/api/marketers', { name: 'أحمد المسوق', phone: '0551112222', code: 'MK-200' })).d.id;
  const MK2 = (await call(T, 'POST', '/api/marketers', { name: 'سعد المسوق', phone: '0553334444', code: 'MK-201' })).d.id;
  ok(P > 0 && u1 > 0 && MK > 0, 'مشروع + وحدات + مسوقان');
  // بيوع مع مسوقين وخصومات ودفعات
  const s1 = (await call(T, 'POST', '/api/sales', { unit_id: u1, customer_name: 'خالد العمري', customer_phone: '0501111111', sale_date: '2026-08-05', base_price: 495000, discount_type: 'percent', discount_value: 5, payment_method: 'bank_transfer', payment_ref: 'TR-1', paid_amount: 200000, marketer_id: MK, commission_type: 'percent', commission_value: 1 })).d;
  const s2 = (await call(T, 'POST', '/api/sales', { unit_id: u2, customer_name: 'ماجد الشمري', customer_phone: '0502222222', sale_date: '2026-08-12', base_price: 495000, discount_type: 'none', payment_method: 'cash', paid_amount: 470250, marketer_id: MK, commission_type: 'percent', commission_value: 1 })).d;
  const s3 = (await call(T, 'POST', '/api/sales', { unit_id: u3, customer_name: 'نورة القحطاني', customer_phone: '0503333333', sale_date: '2026-08-20', base_price: 490000, discount_type: 'amount', discount_value: 10000, payment_method: 'check', payment_ref: 'CH-9', paid_amount: 100000, marketer_id: MK2, commission_type: 'amount', commission_value: 5000 })).d;
  await call(TACC, 'POST', `/api/sales/${s1.id}/payments`, { amount: 50000, pay_date: '2026-08-15', method: 'cash' });
  await call(TACC, 'POST', `/api/sales/${s1.id}/commission-payments`, { amount: 2000, pay_date: '2026-08-16', method: 'cash' });
  await call(TACC, 'POST', `/api/sales/${s3.id}/commission-payments`, { amount: 5000, pay_date: '2026-08-21', method: 'cash' });
  ok(s1.sale_no && s2.sale_no && s3.sale_no, 'ثلاث بيوع بمسوقين وعمولات');

  console.log('== 4) الصلاحيات التفصيلية (Checkboxes) ==');
  // منح المشاهد 3 صلاحيات فقط
  const putPerms = await call(T, 'PUT', `/api/users/4/permissions`, { permissions: { view_projects: true, view_units: true, add_reservation: true } });
  ok(putPerms.d.ok && putPerms.d.perms.length === 3, 'منح المشاهد 3 صلاحيات محددة');
  const meV = await call(TVIEW, 'GET', '/api/me');
  ok(meV.d.perms.length === 3 && meV.d.permsCustomized === true, 'الصلاحيات المخصصة تظهر فورًا في /api/me');
  ok((await call(TVIEW, 'GET', '/api/projects')).status === 200, 'يملك «عرض المشاريع» → يرى المشاريع');
  ok((await call(TVIEW, 'GET', '/api/units?limit=5')).status === 200, 'يملك «عرض الوحدات» → يبحث');
  ok((await call(TVIEW, 'GET', '/api/sales')).status === 403, 'لا يملك «عرض المبيعات» → ممنوع مباشرة عبر API');
  ok((await call(TVIEW, 'POST', '/api/projects', { code: '9', name: 'x' })).status === 403, 'لا يملك «إضافة مشروع» → ممنوع');
  ok((await call(TVIEW, 'GET', '/api/customers')).status === 403, 'لا يملك «عرض العملاء» → ممنوع');
  ok((await call(TVIEW, 'POST', '/api/documents/generate', { type: 'search_results', params: {} })).status === 403, 'لا يملك «تصدير PDF» → ممنوع من المستندات');
  const rsvV = await call(TVIEW, 'POST', '/api/reservations', { unit_id: u3 === 0 ? u2 : 0, customer_name: 'x', customer_phone: 'x' });
  ok(rsvV.status !== 403, 'يملك «إضافة حجز» → الطلب يتجاوز فحص الصلاحية (رفض لاحق لأسباب أخرى مقبولة)');
  // تحديد الكل
  const allPerms = {};
  schema.d.forEach(g => g.items.forEach(([k]) => allPerms[k] = true));
  await call(T, 'PUT', `/api/users/4/permissions`, { permissions: allPerms });
  const meV2 = await call(TVIEW, 'GET', '/api/me');
  ok(meV2.d.perms.length === 52, 'تحديد الكل → 52 صلاحية');
  ok((await call(TVIEW, 'POST', '/api/projects', { code: '900', name: 'مشروع تجريبي' })).status === 200, 'بعد منح «إضافة مشروع» يستطيع الإضافة فعليًا');
  // إلغاء الكل
  await call(T, 'PUT', `/api/users/4/permissions`, { permissions: {} });
  const meV3 = await call(TVIEW, 'GET', '/api/me');
  ok(meV3.d.perms.length === 0 && (await call(TVIEW, 'GET', '/api/units')).status === 403, 'إلغاء تحديد الكل → صلاحيات صفرية وممنوع من الوحدات');
  // حماية التصعيد
  ok((await call(TACC, 'PUT', `/api/users/4/permissions`, { permissions: allPerms })).status === 403, 'المحاسب (غير مدير النظام) لا يستطيع تعديل صلاحيات الآخرين');
  ok((await call(TACC, 'PUT', `/api/users/2/permissions`, { permissions: allPerms })).status === 403, 'المحاسب لا يستطيع منح نفسه صلاحيات');
  ok((await call(TACC, 'PUT', '/api/users/2', { name: 'محاسب', role: 'super_admin' })).status === 403, 'المحاسب لا يستطيع ترقية دوره إلى مدير نظام');
  const selfEdit = await call(TACC, 'PUT', '/api/users/2', { name: 'محاسب الشركة' });
  ok(selfEdit.status === 403, 'المحاسب بلا صلاحية «تعديل مستخدم» → ممنوع من تعديل الحسابات');

  console.log('== 5) صلاحيات فعلية على مستوى العمليات ==');
  // وحدة بدون صلاحية أسعار
  await call(T, 'PUT', `/api/users/4/permissions`, { permissions: { view_projects: true, view_units: true, add_unit: true } });
  const noPriceUnit = await call(TVIEW, 'POST', '/api/units', { project_id: P, floor_id: f1, model_id: mA, unit_number: 'A-199', price: 777000 });
  ok(noPriceUnit.status === 400 && String(noPriceUnit.d.error).includes('الأسعار'), 'إضافة وحدة بسعر مخصص بدون صلاحية «تعديل الأسعار» → رفض');
  const modelPriceUnit = await call(TVIEW, 'POST', '/api/units', { project_id: P, floor_id: f1, model_id: mA, unit_number: 'A-198' });
  ok(modelPriceUnit.status === 200, 'إضافة وحدة بسعر النموذج المرجعي مسموحة');
  // تعديل وحدة بدون صلاحية حالة
  await call(T, 'PUT', `/api/users/4/permissions`, { permissions: { view_units: true, edit_unit: true } });
  const stChk = await call(TVIEW, 'PUT', '/api/units/' + modelPriceUnit.d.id, { project_id: P, floor_id: f1, unit_number: 'A-198', price: 495000, status: 'unavailable', sell_phase: 'off_plan', inventory_type: 'company', notes: '' });
  ok(stChk.status === 400 && String(stChk.d.error).includes('حالة الوحدة'), 'تعديل حالة الوحدة بدون صلاحية «تغيير حالة الوحدة» → رفض');

  console.log('== 6) نقاط النهاية الجديدة (حذف/تعديل/تعطيل) ==');
  const delPrj = await call(T, 'DELETE', `/api/projects/${P}`);
  ok(delPrj.status === 400, 'حذف مشروع عليه مبيعات نشطة → رفض');
  const prj2 = (await call(T, 'POST', '/api/projects', { code: '104', name: 'مشروع فارغ' })).d.id;
  ok((await call(T, 'DELETE', `/api/projects/${prj2}`)).d.ok, 'حذف مشروع بلا عمليات → نجح (حذف ناعم)');
  ok((await call(T, 'DELETE', `/api/units/${u1}`)).status === 400, 'حذف وحدة عليها بيع → رفض');
  const uFree = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: f1, model_id: mA, unit_number: 'A-197', price: 100 })).d.id;
  ok((await call(T, 'DELETE', `/api/units/${uFree}`)).d.ok, 'حذف وحدة حرة → نجح');
  const custEdit = await call(T, 'PUT', '/api/customers/1', { name: 'خالد عبدالله العمري', source: 'مسوق' });
  ok(custEdit.d.ok, 'تعديل بيانات عميل');
  ok((await call(T, 'DELETE', '/api/customers/1')).status === 400, 'حذف عميل له مبيعات → رفض');
  const custFree = (await call(T, 'POST', '/api/customers', { name: 'عميل حر', phone: '0599999999' })).d.id;
  ok((await call(T, 'DELETE', `/api/customers/${custFree}`)).d.ok, 'حذف عميل بلا عمليات → نجح');
  // تعديل صفقة
  const sEdit = await call(T, 'PUT', `/api/sales/${s3.id}`, { discount_type: 'amount', discount_value: 5000, base_price: 490000 });
  ok(sEdit.d.ok, 'تعديل خصم الصفقة (لديه صلاحية التعديل)');
  const sAfter = (await call(T, 'GET', '/api/sales?limit=10')).d.find(x => x.id === s3.id);
  ok(sAfter.final_price === 485000 && sAfter.discount_amount === 5000, `إعادة حساب السعر بعد تعديل الخصم (485000): ${sAfter.final_price}`);
  const sBadEdit = await call(T, 'PUT', `/api/sales/${s2.id}`, { discount_type: 'amount', discount_value: 490000 });
  ok(sBadEdit.status === 400, 'خصم يجعل السعر النهائي أقل من المدفوع → رفض');
  // تعديل صفقة بدون صلاحية
  await call(T, 'PUT', `/api/users/4/permissions`, { permissions: { view_sales: true, edit_sale: true } });
  const dChk = await call(TVIEW, `PUT`, `/api/sales/${s3.id}`, { discount_type: 'amount', discount_value: 1000, base_price: 490000 });
  ok(dChk.status === 400 && String(dChk.d.error).includes('الخصومات'), 'تعديل الخصم بدون صلاحية «تعديل الخصومات» → رفض');
  // تعطيل/حذف مستخدم
  const u5 = (await call(T, 'POST', '/api/users', { name: 'مؤقت', username: 'tmp1', password: 'Pass@1234', role: 'viewer' })).d.id;
  ok((await call(T, 'POST', `/api/users/${u5}/toggle`)).d.active === false, 'تعطيل مستخدم');
  ok((await call(null, 'POST', '/api/login', { username: 'tmp1', password: 'Pass@1234' })).status === 401, 'المعطل لا يستطيع الدخول');
  ok((await call(T, 'DELETE', `/api/users/${u5}`)).d.ok, 'حذف مستخدم بلا عمليات → نجح');
  ok((await call(T, 'DELETE', '/api/users/2')).status === 400, 'حذف مستخدم له عمليات (المحاسب) → رفض');
  ok((await call(T, 'DELETE', '/api/users/1')).status === 400, 'حذف حساب مدير النظام نفسه → رفض');

  console.log('== 7) الاستعادة ==');
  const backup = await call(T, 'POST', '/api/backups');
  ok(backup.d.filename, 'إنشاء نسخة احتياطية');
  const restoreNo = await call(TACC, 'POST', `/api/backups/${backup.d.id}/restore`, { confirm: true });
  ok(restoreNo.status === 403, 'المحاسب (بلا صلاحية استعادة) ممنوع');
  const restoreNoC = await call(T, 'POST', `/api/backups/${backup.d.id}/restore`, {});
  ok(restoreNoC.status === 400, 'الاستعادة تتطلب تأكيدًا');
  const restore = await call(T, 'POST', `/api/backups/${backup.d.id}/restore`, { confirm: true });
  ok(restore.d.ok && restore.d.restart_required === true, 'تجهيز الاستعادة (تطبق عند الإقلاع التالي)');
  const fs = require('fs');
  ok(fs.existsSync('data/restore-pending.sqlite'), 'ملف الاستعادة المعلقة موجود');
  fs.unlinkSync('data/restore-pending.sqlite'); // تنظيف لاختبار لاحق

  console.log('== 8) تقارير المسوقين (JSON) ==');
  const all = await call(T, 'GET', '/api/reports/marketers');
  ok(all.d.summary.length === 2 && all.d.rows.length === 3, `التقرير الإجمالي: مسوقان و3 عمليات (${all.d.summary.length}/${all.d.rows.length})`);
  const ahmed = all.d.summary.find(m => m.marketer_name === 'أحمد المسوق');
  ok(ahmed && ahmed.sales_total === 470250 + 495000 && ahmed.ops === 2, `ملخص أحمد (مبيعات 965250): ${ahmed?.sales_total}`);
  const r1 = all.d.rows[0];
  ok('reserve_date' in r1 && 'payment_method' in r1 && 'customer_name' in r1 && 'commission_paid' in r1, 'الصف التفصيلي يحوي كل الأعمدة المطلوبة (حجز/دفع/عمولة)');
  const oneMk = await call(T, 'GET', `/api/reports/marketers?marketer_id=${MK}`);
  ok(oneMk.d.marketer_name === 'أحمد المسوق' && oneMk.d.marketer_phone === '0551112222' && oneMk.d.rows.length === 2, 'تقرير مسوق واحد باسمه وهاتفه');
  const dateF = await call(T, 'GET', '/api/reports/marketers?date_from=2026-08-11&date_to=2026-08-13');
  ok(dateF.d.rows.length === 1, 'فلترة فترة زمنية مخصصة');
  const byUnit = await call(T, 'GET', '/api/reports/marketers?unit=A-101');
  ok(byUnit.d.rows.length === 1 && byUnit.d.rows[0].unit_number === 'A-101', 'تصفية حسب الوحدة');
  const byCommStatus = await call(T, 'GET', '/api/reports/marketers?commission_status=paid');
  ok(byCommStatus.d.rows.every(r => r.commission_status === 'paid') && byCommStatus.d.rows.length === 1, 'تصفية حسب حالة العمولة');
  const byProject = await call(T, 'GET', `/api/reports/marketers?project_id=${P}`);
  ok(byProject.d.rows.length === 3, 'تصفية حسب المشروع');
  // صلاحيات التقرير
  ok((await call(TRES, 'GET', '/api/reports/marketers')).status === 403, 'مسؤول الحجوزات بلا صلاحية «تقارير المسوقين» → ممنوع');
  await call(T, 'PUT', `/api/users/4/permissions`, { permissions: { view_marketer_reports: true, create_reports: true } });
  ok((await call(TVIEW, 'GET', '/api/reports/marketers')).status === 200, 'منح صلاحية التقارير → يستطيع العرض');
  await call(T, 'PUT', `/api/users/4/permissions`, { permissions: { view_marketer_reports: true } });
  ok((await call(TVIEW, 'GET', '/api/reports/marketers')).status === 403, 'بلا «إنشاء التقارير» → ممنوع من توليد التقرير');

  console.log('== 9) PDF تقرير المسوقين والأرشفة ==');
  const pdfAll = await call(T, 'POST', '/api/documents/generate', { type: 'marketer_report', params: {}, save: false }, true);
  const bufAll = await pdfAll.arrayBuffer();
  ok(pdfAll.status === 200 && bufAll.byteLength > 6000, `PDF التقرير الإجمالي (${bufAll.byteLength} بايت)`);
  const pdfOne = await call(T, 'POST', '/api/documents/generate', { type: 'marketer_report', params: { marketer_id: MK }, save: true });
  ok(pdfOne.d.doc_no && pdfOne.d.filename.includes('أحمد'), `حفظ تقرير مسوق محدد باسمه: ${pdfOne.d.filename}`);
  const pdfPeriod = await call(T, 'POST', '/api/documents/generate', { type: 'marketer_report', params: { marketer_id: MK, date_from: '2026-08-01', date_to: '2026-08-31' }, save: true });
  ok(pdfPeriod.d.filename.includes('2026-08-01'), `اسم الملف يتضمن الفترة: ${pdfPeriod.d.filename}`);
  const docs = await call(T, 'GET', '/api/documents');
  const mkDoc = docs.d.find(x => x.id === pdfOne.d.id);
  ok(mkDoc && mkDoc.marketer_name === 'أحمد المسوق' && mkDoc.doc_type === 'marketer_report', 'الأرشيف يسجل المسوق المرتبط والنوع');
  ok((await call(TVIEW, 'POST', '/api/documents/generate', { type: 'marketer_report', params: {}, save: false })).status === 403, 'بلا صلاحية «تصدير PDF» → ممنوع');
  await call(T, 'PUT', `/api/users/4/permissions`, { permissions: { view_marketer_reports: true, create_reports: true, export_pdf: true } });
  const noSave = await call(TVIEW, 'POST', '/api/documents/generate', { type: 'marketer_report', params: {}, save: true });
  ok(noSave.status === 403, 'مع «تصدير PDF» بلا «حفظ PDF» → التصدير مسموح والحفظ ممنوع');
  const yesExport = await call(TVIEW, 'POST', '/api/documents/generate', { type: 'marketer_report', params: {}, save: false }, true);
  ok(yesExport.status === 200, 'التصدير المسموح يعمل');

  console.log('== 10) العربية داخل PDF (فحص متعدد القارئات) ==');
  const { execSync } = require('child_process');
  const fsx = require('fs');
  const saleDoc = await call(T, 'POST', '/api/documents/generate', { type: 'sale', params: { sale_id: s1.id }, save: true });
  const salePath = 'data/pdf_archive/' + saleDoc.d.filename;
  ok(fsx.existsSync(salePath), 'سند بيع محفوظ');
  const fonts = execSync(`pdffonts "${salePath}"`).toString().replace(/[\u2000-\u200f\u202a-\u202e\u2066-\u2069]/g, '');
  ok(/ExpoArabic/i.test(fonts), 'خط Expo Arabic مضمّن داخل ملف PDF ويظهر في pdffonts');
  execSync(`pdftotext "${salePath}" /tmp/sale13.txt`);
  const txt = fsx.readFileSync('/tmp/sale13.txt', 'utf8');
  const { hasWord } = require('./lib/pdfcheck');
  let shapingOk = true;
  for (const w of ['سند', 'بيانات', 'الوحدة', 'المالية', 'توقيع', 'الدفعات']) { if (!hasWord(txt, w)) { shapingOk = false; console.log('   كلمة غير سليمة:', w); } }
  ok(shapingOk, 'الحروف العربية متصلة ومشكّلة بشكل صحيح (وليست منفصلة أو معكوسة)');
  ok(txt.includes('470,250') && txt.includes('24,750'), 'الأرقام والأسعار بالاتجاه الصحيح');
  ok(!/[\uFFFD]/.test(txt), 'لا توجد مربعات/رموز بديلة');
  execSync(`mutool draw -o /tmp/sale13.png "${salePath}" 2>/dev/null`);
  ok(fsx.existsSync('/tmp/sale13.png'), 'قارئ ثانٍ (MuPDF) يعرض الملف بنجاح');
  execSync(`pdftoppm -png -r 50 -f 1 -l 1 "${salePath}" /tmp/sale13b`);
  ok(fsx.existsSync('/tmp/sale13b-1.png'), 'قارئ ثالث (Poppler) يعرض الملف بنجاح');
  // تقرير المسوق PDF بالعربية
  execSync(`pdftotext "${salePath.replace(saleDoc.d.filename, pdfOne.d.filename)}" /tmp/mk.txt`);
  const mkTxt = fsx.readFileSync('/tmp/mk.txt', 'utf8');
  ok(hasWord(mkTxt, 'المسوق'), 'تقرير المسوق: كلمة «المسوق» مشكّلة في PDF');

  console.log('== 11) سلوكيات v1.2 محفوظة ==');
  ok((await call(TRES, 'GET', '/api/customers')).d[0].email === undefined, 'مسؤول الحجوزات (افتراضي) يرى العملاء بحقول محدودة');
  ok((await call(TACC, 'GET', '/api/marketers')).status === 200, 'المحاسب يرى المسوقين');
  ok((await call(TACC, 'GET', '/api/users')).status === 403, 'المحاسب لا يرى المستخدمين (افتراضيًا)');
  ok((await call(TRES, 'POST', '/api/marketers', { name: 'x' })).status === 403, 'مسؤول الحجوزات لا يضيف مسوقين (افتراضيًا)');
  const dashV = await call(TRES, 'GET', '/api/dashboard');
  ok(dashV.d.finance === undefined, 'لوحة التحكم بلا أرقام مالية لمن لا يملك صلاحية التقارير المالية');
  const dashA = await call(TACC, 'GET', '/api/dashboard');
  ok(dashA.d.finance && dashA.d.finance.sales_count === 3, 'لوحة التحكم المالية للمحاسب');

  console.log(`\n===== النتيجة: ${pass} نجح / ${fail} فشل =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
