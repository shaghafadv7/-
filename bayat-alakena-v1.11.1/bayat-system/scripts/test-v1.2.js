// اختبار شامل v1.2.0
const BASE = 'http://127.0.0.1:4173';
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FAIL:', name); } };
async function call(token, method, path, body, raw = false) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return r;
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d, headers: r.headers };
}
(async () => {
  console.log('== 1) الدخول وإنشاء المستخدمين ==');
  const login = await call(null, 'POST', '/api/login', { username: 'admin', password: 'Admin@103' });
  const T = login.d.token; ok(!!T, 'دخول المدير');
  await call(T, 'POST', '/api/users', { name: 'محاسب الشركة', username: 'acc1', password: 'Pass@1234', role: 'accountant' });
  await call(T, 'POST', '/api/users', { name: 'مسؤول الحجوزات', username: 'res1', password: 'Pass@1234', role: 'reservations_officer' });
  await call(T, 'POST', '/api/users', { name: 'موظف مبيعات', username: 'sal1', password: 'Pass@1234', role: 'sales' });
  await call(T, 'POST', '/api/users', { name: 'مشاهد', username: 'view1', password: 'Pass@1234', role: 'viewer' });
  const TACC = (await call(null, 'POST', '/api/login', { username: 'acc1', password: 'Pass@1234' })).d.token;
  const TRES = (await call(null, 'POST', '/api/login', { username: 'res1', password: 'Pass@1234' })).d.token;
  const TSAL = (await call(null, 'POST', '/api/login', { username: 'sal1', password: 'Pass@1234' })).d.token;
  const TVIEW = (await call(null, 'POST', '/api/login', { username: 'view1', password: 'Pass@1234' })).d.token;
  ok(!!TACC && !!TRES && !!TSAL && !!TVIEW, 'إنشاء ودخول محاسب + مسؤول حجوزات + مبيعات + مشاهد');

  console.log('== 2) المشروع والأدوار والنماذج والوحدات ==');
  const prj = await call(T, 'POST', '/api/projects', { code: '103', name: 'مشروع 103 النزهة', location: 'حي النزهة قطعة 563/ب', construction_status: 'under_construction' });
  ok(prj.d.id > 0, 'إنشاء المشروع');
  const P = prj.d.id;
  const f1 = (await call(T, 'POST', '/api/floors', { project_id: P, name: 'الدور الأول', floor_order: 1 })).d.id;
  const f2 = (await call(T, 'POST', '/api/floors', { project_id: P, name: 'الدور الثاني', floor_order: 2 })).d.id;
  const mA = (await call(T, 'POST', '/api/models', { project_id: P, code: 'A1', name: 'ثلاث غرف', rooms: 3, bathrooms: 2, area: 165, base_price: 495000 })).d.id;
  const mB = (await call(T, 'POST', '/api/models', { project_id: P, code: 'B1', name: 'أربع غرف', rooms: 4, bathrooms: 3, area: 190, base_price: 595000 })).d.id;
  ok(f1 > 0 && f2 > 0 && mA > 0 && mB > 0, 'الأدوار والنماذج');
  const u1 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: f1, model_id: mA, unit_number: 'A-101', price: 495000 })).d.id;
  const u2 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: f1, model_id: mB, unit_number: 'B-102', price: 595000 })).d.id;
  const u3 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: f2, model_id: mA, unit_number: 'A-201', price: 490000 })).d.id;
  const u4 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: f2, model_id: mB, unit_number: 'B-202', price: 590000 })).d.id;
  ok(u1 > 0 && u2 > 0 && u3 > 0 && u4 > 0, 'إضافة 4 وحدات');

  console.log('== 3) المسوقون ==');
  const mk = await call(T, 'POST', '/api/marketers', { name: 'خالد المسوق', phone: '0551234567', code: 'MK-100' });
  ok(mk.d.id > 0, 'إضافة مسوق بكود');
  const MK = mk.d.id;
  const mkDup = await call(T, 'POST', '/api/marketers', { name: 'تلقائي', code: 'MK-100' });
  ok(mkDup.status === 400, 'منع تكرار كود المسوق');
  const mkEdit = await call(T, 'PUT', `/api/marketers/${MK}`, { name: 'خالد المسوق', phone: '0551112222', code: 'MK-100', notes: 'مسوق رئيسي' });
  ok(mkEdit.d.ok, 'تعديل المسوق');
  const resOfficerMk = await call(TRES, 'POST', '/api/marketers', { name: 'ممنوع' });
  ok(resOfficerMk.status === 403, 'مسؤول الحجوزات لا يضيف مسوقين');
  const accMk = await call(TACC, 'GET', '/api/marketers');
  ok(accMk.status === 200 && accMk.d.length === 1, 'المحاسب يرى المسوقين (بدون إدارة)');

  console.log('== 4) الحجز (مسؤول الحجوزات) ==');
  const rsv = await call(TRES, 'POST', '/api/reservations', { unit_id: u2, customer_name: 'عبدالله العمري', customer_phone: '0561112233', expires_at: '2026-08-30 18:00', deposit: 10000 });
  ok(rsv.d.reservation_no, 'حجز وحدة B-102 لعميل جديد');
  const rsvEdit = await call(TRES, 'PUT', `/api/reservations/${rsv.d.id}`, { deposit: 15000, expires_at: '2026-09-01 12:00' });
  ok(rsvEdit.d.ok, 'تعديل الحجز');
  const rsvDocPerm = await call(TVIEW, 'GET', '/api/reservations');
  ok(rsvDocPerm.status === 403, 'المشاهد لا يرى الحجوزات');
  const resCust = await call(TRES, 'GET', '/api/customers');
  ok(resCust.status === 200 && resCust.d.length === 1 && resCust.d[0].phone === '0561112233' && resCust.d[0].email === undefined, 'مسؤول الحجوزات يرى العملاء (حقول محدودة)');
  const salCust = await call(TSAL, 'GET', '/api/customers');
  ok(salCust.status === 403, 'موظف المبيعات لا يرى قائمة العملاء');

  console.log('== 5) البيع بخصم نسبة + حوالة + مسوق + عمولة ==');
  const badSale1 = await call(T, 'POST', '/api/sales', { unit_id: u1, customer_name: 'سعود', customer_phone: '0501112222', base_price: 495000, discount_type: 'amount', discount_value: 500000, paid_amount: 0 });
  ok(badSale1.status === 400, 'رفض خصم يتجاوز السعر الأساسي');
  const badSale2 = await call(T, 'POST', '/api/sales', { unit_id: u1, customer_name: 'سعود', customer_phone: '0501112222', base_price: 495000, discount_type: 'none', payment_method: 'bank_transfer', paid_amount: 0 });
  ok(badSale2.status === 400, 'رفض حوالة بدون مرجع');
  const badSale3 = await call(T, 'POST', '/api/sales', { unit_id: u1, customer_name: 'سعود', customer_phone: '0501112222', base_price: 495000, paid_amount: 600000 });
  ok(badSale3.status === 400, 'رفض مدفوع يتجاوز السعر');
  const sale1 = await call(T, 'POST', '/api/sales', {
    unit_id: u1, customer_name: 'سعود الحربي', customer_phone: '0501112222', sale_date: '2026-08-10',
    base_price: 495000, discount_type: 'percent', discount_value: 5,
    payment_method: 'bank_transfer', payment_ref: 'TR-99887', paid_amount: 200000,
    contract_no: 'CT-555', sale_phase: 'off_plan', marketer_id: MK, commission_type: 'percent', commission_value: 1,
  });
  ok(sale1.d.sale_no, `تسجيل البيع ${sale1.d.sale_no}`);
  ok(sale1.d.final_price === 470250 && sale1.d.discount_amount === 24750, `حساب الخصم 5% = 24750 والنهائي 470250 (${sale1.d.final_price}/${sale1.d.discount_amount})`);
  const S1 = sale1.d.id;
  let unit1 = (await call(T, 'GET', '/api/units/' + u1)).d;
  ok(unit1.status === 'sold' && unit1.sale && unit1.sale.commission_total === 4703, `الوحدة مباعة + عمولة 1% = 4703 (${unit1.sale.commission_total})`);

  console.log('== 6) الدفعات وإعادة الحساب ==');
  const pay1 = await call(TACC, 'POST', `/api/sales/${S1}/payments`, { amount: 100000, pay_date: '2026-08-15', method: 'cash' });
  ok(pay1.d.payment_no && pay1.d.remaining === 170250, `دفعة المحاسب + إعادة الحساب (متبقي 170250): ${pay1.d.remaining}`);
  const payBad = await call(TACC, 'POST', `/api/sales/${S1}/payments`, { amount: 0, method: 'cash' });
  ok(payBad.status === 400, 'منع دفعة بصفر أو قيمة غير صحيحة');
  const payCheckBad = await call(TACC, 'POST', `/api/sales/${S1}/payments`, { amount: 1000, method: 'check' });
  ok(payCheckBad.status === 400, 'منع شيك بدون رقم');
  const resPay = await call(TRES, 'POST', `/api/sales/${S1}/payments`, { amount: 10, method: 'cash' });
  ok(resPay.status === 403, 'مسؤول الحجوزات لا يسجل دفعات');
  const pay2 = await call(TACC, 'POST', `/api/sales/${S1}/payments`, { amount: 170250, pay_date: '2026-08-20', method: 'check', ref_no: 'CH-30021' });
  ok(pay2.d.remaining === 0, 'تسديد كامل المتبقي');
  unit1 = (await call(T, 'GET', '/api/units/' + u1)).d;
  ok(unit1.status === 'paid', 'تحولت الوحدة إلى «مسدد بالكامل» تلقائيًا');
  const accPays = await call(TACC, 'GET', '/api/payments');
  ok(accPays.d.length === 3, 'سجل الدفعات يعرض الدفعة الافتتاحية + دفعتين');

  console.log('== 7) عمولة المسوق ودفعاتها ==');
  const cpBad = await call(TACC, 'POST', `/api/sales/${S1}/commission-payments`, { amount: 999999 });
  ok(cpBad.status === 400, 'منع دفعة عمولة تتجاوز المستحق');
  const cp1 = await call(TACC, 'POST', `/api/sales/${S1}/commission-payments`, { amount: 2000, pay_date: '2026-08-21', method: 'bank_transfer', ref_no: 'TR-COMM-1' });
  ok(cp1.d.status === 'partial', `دفعة عمولة جزئية (${cp1.d.status})`);
  const cp2 = await call(TACC, 'POST', `/api/sales/${S1}/commission-payments`, { amount: 2703, pay_date: '2026-08-22', method: 'cash' });
  ok(cp2.d.status === 'paid', `إكمال العمولة → مدفوعة بالكامل (${cp2.d.status})`);
  const mkDetail = await call(T, 'GET', '/api/marketers/' + MK);
  ok(mkDetail.d.units_count === 1 && mkDetail.d.commission_paid === 4703 && mkDetail.d.sales_total === 470250, `إحصاءات المسوق (وحدات/مبيعات/مدفوع): ${mkDetail.d.units_count}/${mkDetail.d.sales_total}/${mkDetail.d.commission_paid}`);
  const resCp = await call(TRES, 'GET', '/api/commissions');
  ok(resCp.status === 403, 'مسؤول الحجوزات لا يرى العمولات');

  console.log('== 8) تحويل الحجز إلى بيع (مسؤول الحجوزات يسجل بيانات بيع أساسية) ==');
  // v1.9: العربون (10000) يُحتسب تلقائيًا دفعة أولى — الدفعة الإضافية 570,000 تكمل السعر النهائي 580,000
  const sale2 = await call(TRES, 'POST', '/api/sales', { unit_id: u2, sale_date: '2026-08-18', base_price: 595000, discount_type: 'amount', discount_value: 15000, payment_method: 'cash', paid_amount: 570000 });
  ok(sale2.d.sale_no && sale2.d.final_price === 580000, `بيع وحدة المحجوزة B-102 بعد خصم 15000 (${sale2.d.final_price})`);
  const S2 = sale2.d.id;
  const resSales = await call(TRES, 'GET', '/api/sales');
  ok(resSales.d.length === 1 && resSales.d[0].sale_no === sale2.d.sale_no && resSales.d[0].commission_total === undefined, 'مسؤول الحجوزات يرى مبيعاته فقط وبدون أعمدة العمولة');
  const finSales = await call(TACC, 'GET', '/api/sales');
  ok(finSales.d.length === 2, 'المحاسب يرى كل المبيعات');

  console.log('== 9) اكتمال المشروع وإعادة البيع ==');
  await call(T, 'PUT', '/api/projects/' + P, { code: '103', name: 'مشروع 103 النزهة', location: 'حي النزهة', construction_status: 'completed', notes: 'اكتمل' });
  const unitsAfter = await call(T, 'GET', `/api/units?project_id=${P}&sell_phase=completed`);
  ok(unitsAfter.d.rows.length >= 1, 'تحويل مرحلة بيع الوحدات غير المباعة إلى مكتمل عند اكتمال المشروع');
  // قرار المالك: الاحتفاظ بالوحدة A-201
  const keep = await call(T, 'POST', `/api/units/${u3}/owner-decision`, { decision: 'keep', owner_name: 'شركة بيات القابضة' });
  ok(keep.d.ok, 'قرار الاحتفاظ بوحدة A-201');
  let unit3 = (await call(T, 'GET', '/api/units/' + u3)).d;
  ok(unit3.status === 'owner' && unit3.owner_name === 'شركة بيات القابضة', 'حالة A-201 = للمالك');
  // إعادة بيعها لاحقًا
  const resale1 = await call(T, 'POST', `/api/units/${u3}/owner-decision`, { decision: 'resale', new_price: 550000, owner_name: 'شركة بيات القابضة', date: '2026-08-22' });
  ok(resale1.d.ok, 'عرض A-201 لإعادة البيع بسعر 550000');
  unit3 = (await call(T, 'GET', '/api/units/' + u3)).d;
  ok(unit3.status === 'resale' && unit3.price === 550000 && unit3.prev_price === 490000, `حالة إعادة بيع + حفظ السعر السابق (${unit3.price}/${unit3.prev_price})`);
  const resaleBad = await call(T, 'POST', `/api/units/${u3}/owner-decision`, { decision: 'resale' });
  ok(resaleBad.status === 400, 'منع إعادة بيع بدون سعر');
  const resDecide = await call(TRES, 'POST', `/api/units/${u3}/owner-decision`, { decision: 'keep' });
  ok(resDecide.status === 403, 'مسؤول الحجوزات لا ينفذ قرارات المالك');
  // بيع وحدة إعادة البيع
  const sale3 = await call(T, 'POST', '/api/sales', { unit_id: u3, customer_name: 'فيصل الدوسري', customer_phone: '0598887777', sale_date: '2026-08-22', base_price: 550000, discount_type: 'none', payment_method: 'cash', paid_amount: 550000, sale_phase: 'completed' });
  ok(sale3.d.sale_no, `بيع وحدة إعادة البيع ${sale3.d.sale_no}`);
  const S3 = sale3.d.id;
  unit3 = (await call(T, 'GET', '/api/units/' + u3)).d;
  ok(unit3.sale && unit3.sale.is_resale == 1 && unit3.sale.seller_name === 'شركة بيات القابضة', 'السجل يحفظ العملية كإعادة بيع مع اسم المالك البائع');

  console.log('== 10) إلغاء بيع معتمد ==');
  const sale4 = await call(TSAL, 'POST', '/api/sales', { unit_id: u4, customer_name: 'عميل تجريبي', customer_phone: '0577777777', base_price: 590000, discount_type: 'none', payment_method: 'cash', paid_amount: 100000 });
  ok(sale4.d.sale_no, 'بيع B-202 عبر موظف المبيعات');
  const S4 = sale4.d.id;
  const noReason = await call(T, 'POST', `/api/sales/${S4}/cancel`, {});
  ok(noReason.status === 400, 'إلغاء البيع يتطلب سببًا');
  const accCancel = await call(TACC, 'POST', `/api/sales/${S4}/cancel`, { reason: 'x' });
  ok(accCancel.status === 403, 'المحاسب لا يلغي البيع');
  const cancel = await call(T, 'POST', `/api/sales/${S4}/cancel`, { reason: 'انسحاب العميل' });
  ok(cancel.d.ok, 'إلغاء البيع من الإدارة');
  const unit4 = (await call(T, 'GET', '/api/units/' + u4)).d;
  ok(unit4.status === 'available', 'الوحدة عادت متاحة بعد الإلغاء');
  const payCancelled = await call(TACC, 'GET', '/api/payments');
  ok(payCancelled.d.every(p => p.sale_id != S4), 'الدفعة الملغاة خرجت من السجل النشط');

  console.log('== 11) البحث المتقدم ==');
  const byDiscount = await call(T, 'GET', '/api/units?has_discount=1');
  ok(byDiscount.d.total >= 2, `فلتر «عليها خصم»: ${byDiscount.d.total}`);
  const byPhase = await call(T, 'GET', '/api/units?sell_phase=completed&status=resale,available,owner,sold,paid');
  ok(byPhase.d.rows.every(u => u.sell_phase === 'completed'), 'فلتر مرحلة البيع مكتمل');
  const byOwner = await call(T, 'GET', '/api/units?owner=' + encodeURIComponent('فيصل'));
  ok(byOwner.d.total >= 1, 'البحث باسم المالك');
  const combined = await call(T, 'GET', `/api/units?project_id=${P}&rooms=3&price_min=400000&price_max=600000`);
  ok(combined.d.total >= 1, 'دمج عدة فلاتر');
  const eff = combined.d.rows.find(u => u.id === u1);
  ok(eff && eff.effective_price === 470250, `السعر بعد الخصم في نتائج البحث (${eff?.effective_price})`);

  console.log('== 12) السجل التاريخي ==');
  const hist = await call(T, 'GET', `/api/units/${u1}/history`);
  const types = hist.d.map(h => h.event_type);
  ok(types.includes('created') && types.includes('sold') && types.includes('payment') && types.includes('commission') && types.includes('commission_payment'), `السجل يحوي: ${[...new Set(types)].join(', ')}`);
  const histRes = await call(TRES, 'GET', `/api/units/${u1}/history`);
  ok(histRes.d.length === hist.d.length, 'مسؤول الحجوزات يرى الأحداث (بدون مبالغ حساسة)');

  console.log('== 13) المستندات PDF ==');
  const gen = async (token, type, params, save, expect = 200) => {
    const r = await call(token, 'POST', '/api/documents/generate', { type, params, save }, true);
    return r;
  };
  const pdfSearch = await gen(T, 'search_results', { project_id: P }, false);
  const pdfSearchBuf = await pdfSearch.arrayBuffer();
  ok(pdfSearch.status === 200 && pdfSearchBuf.byteLength > 5000, `تصدير كشف وحدات PDF (${pdfSearchBuf.byteLength} بايت)`);
  const saved = await gen(T, 'search_results', { project_id: P }, true);
  const savedD = await saved.json();
  ok(savedD.doc_no && savedD.download_url, `حفظ في الأرشيف: ${savedD.filename}`);
  const offer = await gen(T, 'unit_offer', { unit_id: u1 }, true); const offerD = await offer.json();
  ok(offerD.id > 0, 'عرض وحدة PDF');
  const rsvDoc = await gen(TRES, 'reservation', { reservation_id: rsv.d.id }, true); const rsvDocD = await rsvDoc.json();
  ok(rsvDocD.id > 0, 'سند حجز PDF (مسؤول الحجوزات)');
  const saleDoc = await gen(TACC, 'sale', { sale_id: S1 }, true); const saleDocD = await saleDoc.json();
  ok(saleDocD.id > 0, 'سند بيع PDF (المحاسب)');
  const saleDocRes = await gen(TRES, 'sale', { sale_id: S1 }, true);
  ok(saleDocRes.status === 403, 'مسؤول الحجوزات لا يصدر سند بيع غيره');
  for (const t of ['sales_report', 'payments_report', 'commissions_report', 'marketers_report', 'financial_report']) {
    const r = await gen(TACC, t, { date_from: '2026-01-01' }, false);
    const buf = await r.arrayBuffer();
    ok(r.status === 200 && buf.byteLength > 4000, `تقرير ${t} (${buf.byteLength} بايت)`);
  }
  const viewDoc = await gen(TVIEW, 'search_results', {}, false);
  ok(viewDoc.status === 403, 'المشاهد لا ينشئ مستندات');
  const docs = await call(T, 'GET', '/api/documents');
  ok(docs.d.length === 4, `الأرشيف يحوي 4 مستندات (${docs.d.length})`);
  const fileR = await fetch(BASE + `/api/documents/${savedD.id}/file`, { headers: { Authorization: 'Bearer ' + T } });
  ok(fileR.status === 200 && fileR.headers.get('content-type') === 'application/pdf', 'معاينة ملف من الأرشيف');
  const delOther = await call(TRES, 'DELETE', `/api/documents/${savedD.id}`);
  ok(delOther.status === 403, 'منع حذف مستند غير منشأه (لمسؤول الحجوزات)');
  const delOwn = await call(TRES, 'DELETE', `/api/documents/${rsvDocD.id}`);
  ok(delOwn.d.ok, 'حذف مستند منشأه');

  console.log('== 14) التقارير JSON ==');
  const rep = await call(TACC, 'GET', '/api/reports/sales?date_from=2026-01-01');
  ok(rep.d.rows.length === 3 && rep.d.totals.final === 470250 + 580000 + 550000, `إجمالي تقارير المبيعات (${rep.d.totals.final})`);
  const fin = await call(T, 'GET', '/api/reports/financial');
  ok(fin.d.summary.paid_total === 470250 + 580000 + 550000, `المحصل في التقرير المالي (${fin.d.summary.paid_total})`);
  const resFin = await call(TRES, 'GET', '/api/reports/financial');
  ok(resFin.status === 403, 'مسؤول الحجوزات ممنوع من التقارير المالية');

  console.log('== 15) صلاحيات إضافية ==');
  ok((await call(TACC, 'GET', '/api/users')).status === 403, 'المحاسب لا يدير المستخدمين');
  ok((await call(TACC, 'PUT', '/api/settings', { company_name_ar: 'x' })).status === 403, 'المحاسب لا يغير الإعدادات');
  ok((await call(TACC, 'POST', '/api/projects', { code: '9', name: 'x' })).status === 403, 'المحاسب لا ينشئ مشاريع');
  ok((await call(TACC, 'POST', '/api/units', { project_id: P, floor_id: f1, unit_number: 'X' })).status === 403, 'المحاسب لا يضيف وحدات');
  ok((await call(TRES, 'POST', '/api/units', { project_id: P, floor_id: f1, unit_number: 'Y' })).status === 403, 'مسؤول الحجوزات لا يضيف وحدات');
  ok((await call(TSAL, 'GET', '/api/sales')).d.length === 0, 'موظف المبيعات يرى مبيعاته فقط (لا شيء له)');
  const dash = await call(TACC, 'GET', '/api/dashboard');
  ok(dash.d.finance && dash.d.finance.sales_count === 3, 'لوحة التحكم المالية للمحاسب');
  const dashView = await call(TVIEW, 'GET', '/api/dashboard');
  ok(dashView.d.finance === undefined, 'المشاهد بلا أرقام مالية');

  console.log(`\n===== النتيجة: ${pass} نجح / ${fail} فشل =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
