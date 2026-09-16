// ============================================================
// بيات الأكنة — اختبار v1.10: التتبع المالي الكامل للدفعات +
// بيانات الحجز الشاملة + إلغاء الحجز بالاسترداد والخصم + التقارير
// يشغّل خادمًا فعليًا على قاعدة معزولة ويختبر كل سيناريو عبر HTTP.
// التشغيل: node scripts/test-v1.10.js
// ============================================================
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 4600 + Math.floor(Math.random() * 150);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bayat-v110-'));
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const results = [];
function ok(cond, name, extra = '') {
  if (cond) { pass++; results.push({ name, ok: true }); console.log('  ✓', name); }
  else { fail++; results.push({ name, ok: false, extra: String(extra).slice(0, 300) }); console.log('  ✗ FAIL:', name, extra ? '— ' + String(extra).slice(0, 200) : ''); }
}
async function call(t, m, p, b, headers = {}) {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...headers }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, d: await r.json().catch(() => ({})) };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startServer(env = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), BAYAT_DATA_DIR: DATA_DIR, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try { const r = await fetch(BASE + '/api/public-settings'); if (r.ok) return { child, log: () => log }; } catch { }
    if (child.exitCode !== null) throw Error('فشل الإقلاع: ' + log);
  }
  throw Error('مهلة الإقلاع: ' + log);
}

(async () => {
  console.log('==============================================');
  console.log('اختبار v1.10 — التتبع المالي + الحجوزات + الإلغاء والاسترداد + التقارير');
  console.log('قاعدة معزولة:', DATA_DIR);
  console.log('==============================================\n');
  let server = await startServer();
  const T = (await call(null, 'POST', '/api/login', { username: 'admin', password: 'Admin@103' })).d.token;
  ok(!!T, '0. دخول مدير النظام');
  const P = (await call(T, 'POST', '/api/projects', { code: '910', name: 'مشروع التتبع' })).d.id;
  const F = (await call(T, 'POST', '/api/floors', { project_id: P, name: 'الأول', floor_order: 1 })).d.id;
  const U1 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: F, unit_number: 'T-101', price: 300000 })).d.id;
  const MK = (await call(T, 'POST', '/api/marketers', { name: 'مسوق التتبع', code: 'MK-10' })).d.id;
  ok(!!U1 && !!MK, '0. تهيئة: مشروع + وحدة + مسوق');

  // ===== 1) الحجز ببيانات كاملة =====
  console.log('\n== 1) بيانات الحجز الشاملة ==');
  const rsv = await call(T, 'POST', '/api/reservations', {
    unit_id: U1, customer_name: 'عميل التتبع', customer_phone: '0509100001',
    expires_at: '2026-10-01T12:00', deposit: 15000, pay_method: 'bank_transfer', pay_ref: 'TR-1001',
    bank: 'الراجحي', received_by: 'أمين الصندوق', deposit_account: 'خزينة الفرع الرئيسي',
    receipt_no: 'RC-55', marketer_id: MK, notes: 'حجز تجريبي كامل',
  });
  ok(rsv.status === 200 && rsv.d.reservation_no.startsWith('RSV-'), '1.1 رقم الحجز التلقائي', rsv.d);
  ok(rsv.d.unit_price === 300000, `1.2 لقطة سعر الوحدة محفوظة (${rsv.d.unit_price})`);
  ok(rsv.d.marketer_id === MK, '1.3 المسوق مرتبط بالحجز');
  const list = (await call(T, 'GET', '/api/reservations?q=عميل التتبع')).d;
  ok(list.length === 1 && list[0].marketer_name === 'مسوق التتبع' && list[0].unit_price === 300000, '1.4 القائمة تعرض المسوق وسعر الوحدة');
  const rp = (await call(T, 'GET', `/api/reservations/${rsv.d.id}/payments`)).d;
  ok(rp.length === 1 && rp[0].deposit_account === 'خزينة الفرع الرئيسي' && rp[0].received_by === 'أمين الصندوق' && rp[0].payment_status === 'received', '1.5 قيد الدفعة: الحساب + المستلم + حالة مستلمة', rp[0]);

  // ===== 2) مسار الدفعة الكامل =====
  console.log('\n== 2) مسار الدفعة (من دفع → لمن سلم → أي حساب → العملية) ==');
  const trail = (await call(T, 'GET', `/api/reservation-payments/${rp[0].id}/trail`)).d;
  ok(trail.kind === 'reservation' && trail.payment_no === rp[0].payment_no, '2.1 مسار الدفعة يعيد القيد');
  ok(trail.payer.name === 'عميل التتبع', '2.2 الدافع (العميل)');
  ok(trail.received_by === 'أمين الصندوق', '2.3 المستلم للمال');
  ok(trail.deposit_account === 'خزينة الفرع الرئيسي', '2.4 الحساب/الخزينة المودع فيها');
  ok(trail.operation.reservation_no === rsv.d.reservation_no && trail.operation.unit_price === 300000, '2.5 العملية المرتبطة (الحجز)');
  ok(trail.ref_no === 'TR-1001' && trail.method === 'bank_transfer', '2.6 رقم الحوالة والطريقة');
  ok(trail.user === 'مدير النظام' && trail.created_at, '2.7 المستخدم والتاريخ/الوقت');
  ok(trail.linked_sale === null && trail.cancellation === null, '2.8 لا بيع مرتبط ولا إلغاء بعد');

  // ===== 3) إلغاء الحجز مع استرداد كامل =====
  console.log('\n== 3) الإلغاء والاسترداد الكامل ==');
  const cx1 = await call(T, 'POST', `/api/reservations/${rsv.d.id}/cancel`, {
    reason: 'طلب العميل الإلغاء', reason_code: 'customer_request', amount_returned: true,
    refund_amount: 15000, deducted_amount: 0, refund_method: 'bank_transfer', refund_ref: 'RFD-77',
    refund_date: '2026-08-25', refund_account: 'حساب الشركة الراجحي', notes: 'إلغاء ودي كامل',
  });
  ok(cx1.status === 200 && cx1.d.refund_no.startsWith('RFD-'), '3.1 الإلغاء ناجح مع رقم عملية استرداد RFD', cx1.d);
  ok(cx1.d.refund_amount === 15000 && cx1.d.total_paid === 15000, '3.2 المرتجع = المدفوع = 15000');
  const unit1 = (await call(T, 'GET', '/api/units/' + U1)).d;
  ok(unit1.status === 'available', '3.3 الوحدة عادت متاحة تلقائيًا');
  const det1 = (await call(T, 'GET', `/api/reservations/${rsv.d.id}/cancellation`)).d;
  ok(det1.reservation.status === 'cancelled' && det1.reservation.cancel_reason_code === 'customer_request', '3.4 الحجز أصبح ملغى مع رمز السبب');
  ok(det1.cancellation.cancelled_by === 1 && det1.cancellation.refund_account === 'حساب الشركة الراجحي' && det1.cancellation.refund_method === 'bank_transfer', '3.5 كل تفاصيل الإلغاء محفوظة (المستخدم/الحساب/الطريقة)');
  const rpAfter = (await call(T, 'GET', `/api/reservations/${rsv.d.id}/payments`)).d;
  ok(rpAfter.length === 1 && rpAfter[0].amount === 15000 && rpAfter[0].payment_status === 'refunded', '3.6 الدفعة الأصلية محفوظة وحالتها مرتجعة (لا حذف)');
  const trail2 = (await call(T, 'GET', `/api/reservation-payments/${rp[0].id}/trail`)).d;
  ok(trail2.cancellation && trail2.cancellation.refund_no === cx1.d.refund_no && trail2.payment_status === 'refunded', '3.7 المسار يعرض الإلغاء والاسترداد');

  // ===== 4) إلغاء مع خصم جزئي =====
  console.log('\n== 4) الإلغاء مع خصم جزئي ==');
  const U2 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: F, unit_number: 'T-102', price: 250000 })).d.id;
  const rsv2 = await call(T, 'POST', '/api/reservations', { unit_id: U2, customer_name: 'عميل الخصم', customer_phone: '0509100002', expires_at: '2026-10-01T12:00', deposit: 10000, pay_method: 'cash', deposit_account: 'خزينة الفرع' });
  const cx2 = await call(T, 'POST', `/api/reservations/${rsv2.d.id}/cancel`, {
    reason: 'عدم استكمال السداد', reason_code: 'incomplete_payment', amount_returned: true,
    refund_amount: 7000, deducted_amount: 3000, deduction_reason: 'رسوم إدارية',
    refund_method: 'cash', refund_date: '2026-08-25', refund_account: 'خزينة الفرع',
  });
  ok(cx2.status === 200 && cx2.d.refund_amount === 7000 && cx2.d.deducted_amount === 3000, '4.1 استرداد 7000 + خصم 3000', cx2.d);
  const det2 = (await call(T, 'GET', `/api/reservations/${rsv2.d.id}/cancellation`)).d;
  ok(det2.cancellation.deduction_reason === 'رسوم إدارية' && det2.cancellation.deducted_amount === 3000, '4.2 سبب الخصم محفوظ');

  // ===== 5) رفض إلغاء بلا سبب / بلا سبب خصم / بمجموع يتجاوز المدفوع =====
  console.log('\n== 5) قيود الإلغاء ==');
  const U3 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: F, unit_number: 'T-103', price: 200000 })).d.id;
  const rsv3 = await call(T, 'POST', '/api/reservations', { unit_id: U3, customer_name: 'عميل الرفض', customer_phone: '0509100003', expires_at: '2026-10-01T12:00', deposit: 5000, pay_method: 'cash' });
  ok((await call(T, 'POST', `/api/reservations/${rsv3.d.id}/cancel`, { reason: '' })).status === 400, '5.1 رفض: بلا سبب');
  ok((await call(T, 'POST', `/api/reservations/${rsv3.d.id}/cancel`, { reason: 'x', amount_returned: true, refund_amount: 4000, deducted_amount: 0 })).status === 400, '5.2 رفض: إرجاع بمبلغ أقل من المدفوع وغير مفسر (يجب أن يساوي أو يوضح الخصم)');
  const cxBad = await call(T, 'POST', `/api/reservations/${rsv3.d.id}/cancel`, { reason: 'خطأ في الحجز', reason_code: 'booking_error', amount_returned: true, refund_amount: 6000, deducted_amount: 0, refund_method: 'cash' });
  ok(cxBad.status === 400 && String(cxBad.d.error).includes('يتجاوز'), '5.3 رفض: المرتجع > المدفوع', cxBad.d);
  const cxDed = await call(T, 'POST', `/api/reservations/${rsv3.d.id}/cancel`, { reason: 'خطأ في الحجز', reason_code: 'booking_error', amount_returned: true, refund_amount: 4000, deducted_amount: 1000, refund_method: 'cash' });
  ok(cxDed.status === 400 && String(cxDed.d.error).includes('سبب الخصم'), '5.4 رفض: خصم بدون سبب الخصم', cxDed.d);

  // ===== 6) إلغاء بلا استرداد =====
  console.log('\n== 6) إلغاء بلا استرداد ==');
  const cx3 = await call(T, 'POST', `/api/reservations/${rsv3.d.id}/cancel`, { reason: 'خطأ في الحجز', reason_code: 'booking_error', amount_returned: false, notes: 'إلغاء بدون استرداد' });
  ok(cx3.status === 200 && cx3.d.refund_no === null && cx3.d.refund_amount === 0, '6.1 إلغاء بلا استرداد (لا عملية RFD)');
  const unit3 = (await call(T, 'GET', '/api/units/' + U3)).d;
  ok(unit3.status === 'available', '6.2 الوحدة متاحة');

  // ===== 7) تقرير الحجوزات الملغاة + الفلاتر =====
  console.log('\n== 7) تقرير الحجوزات الملغاة ==');
  const crAll = (await call(T, 'GET', '/api/reports/cancelled-reservations')).d;
  ok(crAll.totals.count === 3, `7.1 التقرير يعرض 3 حجوزات ملغاة (${crAll.totals.count})`);
  ok(crAll.totals.refunded === 22000 && crAll.totals.deducted === 3000, `7.2 الإجماليات: مرتجع 22000 / مخصوم 3000 (${crAll.totals.refunded}/${crAll.totals.deducted})`);
  const crFilter = (await call(T, 'GET', '/api/reports/cancelled-reservations?reason_code=customer_request')).d;
  ok(crFilter.totals.count === 1 && crFilter.rows[0].reservation_no === rsv.d.reservation_no, '7.3 فلتر سبب الإلغاء (طلب العميل) يعيد الحجز الصحيح');
  const crFilter2 = (await call(T, 'GET', '/api/reports/cancelled-reservations?reason_code=booking_error')).d;
  ok(crFilter2.totals.count === 1, '7.4 فلتر «خطأ في الحجز»');
  const sampleDate = String(crAll.rows[0].cancelled_at || '').slice(0, 10);
  const crByDate = (await call(T, 'GET', `/api/reports/cancelled-reservations?date_from=${sampleDate}&date_to=${sampleDate}`)).d;
  ok(crByDate.totals.count >= 2, `7.5 فلتر الفترة الزمنية (${sampleDate})`);
  // مثال المواصفات: الحجوزات الملغاة بسبب طلب العميل مع المبالغ
  const exampleRow = crFilter.rows[0];
  ok(exampleRow.refund_amount === 15000 && exampleRow.deducted_amount === 0 && exampleRow.customer_name === 'عميل التتبع', '7.6 مثال: طلب العميل → مرتجع 15000 / مخصوم 0');

  // ===== 8) تقرير الاستردادات والخصومات =====
  console.log('\n== 8) تقرير الاستردادات والخصومات ==');
  const rfAll = (await call(T, 'GET', '/api/reports/refunds')).d;
  ok(rfAll.totals.count === 2, `8.1 عمليتا استرداد (${rfAll.totals.count})`);
  ok(rfAll.totals.refunded === 22000 && rfAll.totals.deducted === 3000 && rfAll.totals.total_paid === 25000, `8.2 الإجماليات: أصلي 25000 / مخصوم 3000 / مرتجع 22000 (${rfAll.totals.total_paid}/${rfAll.totals.deducted}/${rfAll.totals.refunded})`);
  const row = rfAll.rows.find(r => r.deducted_amount > 0);
  ok(row && row.refund_amount === 7000 && row.deducted_amount === 3000 && row.deduction_reason === 'رسوم إدارية' && row.refund_account === 'خزينة الفرع' && row.refund_method === 'cash', '8.3 السلسلة: أصلي→مخصوم→سبب→مرتجع→طريقة→حساب', row);
  const rfFilter = (await call(T, 'GET', '/api/reports/refunds?refund_method=bank_transfer')).d;
  ok(rfFilter.totals.count === 1 && rfFilter.rows[0].refund_ref_no === 'RFD-77', '8.4 فلتر طريقة الإرجاع + المرجع');

  // ===== 9) السجل المالي الموحد =====
  console.log('\n== 9) السجل المالي الموحد ==');
  const U4 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: F, unit_number: 'T-104', price: 400000 })).d.id;
  const s4 = await call(T, 'POST', '/api/sales', { unit_id: U4, customer_name: 'مشتري موحد', customer_phone: '0509100004', base_price: 400000, payment_method: 'bank_transfer', payment_ref: 'TR-2002', paid_amount: 100000, received_by: 'أمين الصندوق', deposit_account: 'حساب الشركة الأهلي' });
  ok(s4.status === 200, '9.0 بيع بدفعة كاملة البيانات');
  const ld = (await call(T, 'GET', '/api/finance/payment-ledger')).d;
  ok(ld.totals.count >= 4, `9.1 السجل يضم دفعات الحجز والبيع (${ld.totals.count})`);
  const ldSale = (await call(T, 'GET', '/api/finance/payment-ledger?type=sale')).d;
  ok(ldSale.rows.some(x => x.payment_no === s4.d.id && x.operation_no === s4.d.sale_no) || ldSale.rows.some(x => x.operation_no === s4.d.sale_no), '9.2 دفعة البيع في السجل مع رقم العملية');
  const salePay = (await call(T, 'GET', `/api/sales/${s4.d.id}/payments`)).d[0];
  const trailSale = (await call(T, 'GET', `/api/payments/${salePay.id}/trail`)).d;
  ok(trailSale.kind === 'sale' && trailSale.deposit_account === 'حساب الشركة الأهلي' && trailSale.received_by === 'أمين الصندوق' && trailSale.operation.sale_no === s4.d.sale_no, '9.3 مسار دفعة البيع كامل');
  const search = (await call(T, 'GET', '/api/finance/payment-trail?q=TR-1001')).d;
  ok(search.kind === 'reservation' && search.payment_no === rp[0].payment_no, '9.4 البحث بالرقم المرجعي يعيد المسار');
  const ldFilter = (await call(T, 'GET', '/api/finance/payment-ledger?account=خزينة')).d;
  ok(ldFilter.totals.count >= 2, '9.5 فلتر الحساب (خزينة)');
  const ldStatus = (await call(T, 'GET', '/api/finance/payment-ledger?payment_status=refunded')).d;
  ok(ldStatus.totals.count === 2, '9.6 فلتر حالة الدفعة (مرتجعة)');

  // ===== 10) PDF التقارير =====
  console.log('\n== 10) PDF ==');
  const p1 = await fetch(BASE + '/api/documents/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: JSON.stringify({ type: 'cancelled_reservations_report', params: { reason_code: 'customer_request' }, save: false }) });
  const b1 = Buffer.from(await p1.arrayBuffer());
  ok(p1.status === 200 && b1.slice(0, 4).toString() === '%PDF' && b1.length > 5000, '10.1 PDF الحجوزات الملغاة', b1.length);
  const p2 = await fetch(BASE + '/api/documents/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: JSON.stringify({ type: 'refunds_report', params: {}, save: false }) });
  const b2 = Buffer.from(await p2.arrayBuffer());
  ok(p2.status === 200 && b2.slice(0, 4).toString() === '%PDF', '10.2 PDF الاستردادات والخصومات');

  // ===== 11) لا حذف لأي سجل أصلي + سجل العمليات =====
  console.log('\n== 11) حفظ السجلات الأصلية وسجل العمليات ==');
  const db = new (require(path.join(ROOT, 'node_modules', 'better-sqlite3')))(path.join(DATA_DIR, 'bayat.sqlite'), { readonly: true });
  const rsvCount = db.prepare('SELECT COUNT(*) n FROM reservations').get().n;
  const rpCount = db.prepare('SELECT COUNT(*) n FROM reservation_payments').get().n;
  const rcCount = db.prepare('SELECT COUNT(*) n FROM reservation_cancellations').get().n;
  const evCount = db.prepare("SELECT COUNT(*) n FROM unit_events WHERE event_type IN ('reserved','reservation_cancelled')").get().n;
  db.close();
  ok(rsvCount === 3, `11.1 كل الحجوزات محفوظة (${rsvCount}) — لا حذف`);
  ok(rpCount === 3, `11.2 كل قيود الدفعات محفوظة (${rpCount}) — لا حذف`);
  ok(rcCount === 3, `11.3 سجل إلغاء لكل حجز ملغى (${rcCount})`);
  ok(evCount >= 6, `11.4 سجل العمليات: أحداث الحجز والإلغاء موثقة (${evCount})`);
  const finAudit = (await call(T, 'GET', '/api/finance/audit')).d;
  ok(finAudit.some(a => a.action === 'reservation_cancel'), '11.5 سجل التدقيق المالي يوثق الإلغاءات');

  // ===== 12) فحص السلامة المالية =====
  console.log('\n== 12) السلامة المالية ==');
  const integ = (await call(T, 'GET', '/api/finance/integrity')).d;
  ok(integ.ok === true, `12.1 لا فروق محاسبية (فحص ${integ.checked_sales} صفقة)`, integ.issues);

  // ===== 13) التحويل من حجز يرث المسوق =====
  console.log('\n== 13) وراثة المسوق عند التحويل ==');
  const U5 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: F, unit_number: 'T-105', price: 500000 })).d.id;
  const rsv5 = await call(T, 'POST', '/api/reservations', { unit_id: U5, customer_name: 'عميل التحويل', customer_phone: '0509100005', expires_at: '2026-10-01T12:00', deposit: 20000, pay_method: 'cash', marketer_id: MK });
  const cv = await call(T, 'POST', `/api/reservations/${rsv5.d.id}/convert-to-sale`, { base_price: 500000, discount_type: 'none', paid_amount: 0 });
  ok(cv.status === 200, '13.1 تحويل الحجز إلى بيع');
  const s5 = (await call(T, 'GET', `/api/sales/${cv.d.id}/financial-summary`)).d;
  ok(s5.finance.paid === 20000 && s5.finance.remaining === 480000, `13.2 العربون محتسب مرة واحدة (20000/480000)`);
  ok(s5.commission.marketer_name === 'مسوق التتبع', '13.3 المسوق ورث من الحجز إلى البيع', s5.commission);
  const trailCv = (await call(T, 'GET', `/api/reservation-payments/${(await call(T, 'GET', `/api/reservations/${rsv5.d.id}/payments`)).d[0].id}/trail`)).d;
  ok(trailCv.linked_sale && trailCv.linked_sale.sale_no === cv.d.sale_no, '13.4 مسار الدفعة يعرض البيع المحول إليه');

  // ===== 14) رفض إلغاء حجز محول =====
  console.log('\n== 14) رفض إلغاء حجز محوّل ==');
  const cxConv = await call(T, 'POST', `/api/reservations/${rsv5.d.id}/cancel`, { reason: 'x' });
  ok(cxConv.status === 400, '14.1 لا يمكن إلغاء حجز محوّل', cxConv.d);

  await new Promise(r => { server.child.on('exit', r); server.child.kill('SIGTERM'); });
  const md = [`# تقرير نتائج الاختبارات — v1.10`, ``, `- **التاريخ:** ${new Date().toISOString().slice(0, 10)}`, `- **النتيجة:** ${pass} نجح / ${fail} فشل`, ``, `| # | السيناريو | النتيجة |`, `|---|-----------|---------|`, ...results.map((r, i) => `| ${i + 1} | ${r.name} | ${r.ok ? '✅' : '❌' + (r.extra ? ' — ' + r.extra : '')} |`)].join('\n');
  fs.writeFileSync(path.join(ROOT, 'TEST-REPORT-v1.10.md'), md);
  fs.writeFileSync(path.join(ROOT, 'test-results-v1.10.json'), JSON.stringify({ generated_at: new Date().toISOString(), pass, fail, results }, null, 2));
  console.log(`\n==============================================`);
  console.log(`النتيجة: ${pass} نجح / ${fail} فشل (من ${results.length})`);
  console.log('التقرير: TEST-REPORT-v1.10.md');
  console.log('==============================================');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
