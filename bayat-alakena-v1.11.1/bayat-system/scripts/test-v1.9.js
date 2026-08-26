// ============================================================
// بيات الأكنة — اختبار v1.9 الشامل (34+ سيناريو وفق المواصفات)
// يشغّل الخادم فعليًا على قاعدة بيانات مؤقتة معزولة ثم يختبر كل
// سيناريو عبر HTTP ويحفظ النتائج في TEST-REPORT-v1.9.md و test-results-v1.9.json
// التشغيل: node scripts/test-v1.9.js
// ============================================================
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 4300 + Math.floor(Math.random() * 150);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bayat-v19-'));
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
    env: { ...process.env, PORT: String(PORT), BAYAT_DATA_DIR: DATA_DIR, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try { const r = await fetch(BASE + '/api/public-settings'); if (r.ok) return { child, log: () => log }; } catch { }
    if (child.exitCode !== null) throw Error('فشل إقلاع الخادم: ' + log);
  }
  throw Error('مهلة إقلاع الخادم: ' + log);
}

(async () => {
  console.log('==============================================');
  console.log('اختبار v1.9 — دورة الحجز والعربون والبيع والمالية والصلاحيات والأمان');
  console.log('قاعدة بيانات معزولة:', DATA_DIR);
  console.log('==============================================\n');
  let server = await startServer();

  // ===== التهيئة =====
  const T = (await call(null, 'POST', '/api/login', { username: 'admin', password: 'Admin@103' })).d.token;
  ok(!!T, '0. تهيئة: دخول مدير النظام');
  const P1 = (await call(T, 'POST', '/api/projects', { code: '108', name: 'العزيزية' })).d.id;
  const F1 = (await call(T, 'POST', '/api/floors', { project_id: P1, name: 'الأول', floor_order: 1 })).d.id;
  const U1 = (await call(T, 'POST', '/api/units', { project_id: P1, floor_id: F1, unit_number: '108', price: 450000 })).d.id;
  ok(!!U1, '0. تهيئة: مشروع العزيزية ووحدة 108 بسعر 450,000');

  // ===== 1) حجز نقدي =====
  console.log('\n== 1) حجز نقدي — عربون كاش = 5000 =="');
  const r1 = await call(T, 'POST', '/api/reservations', { unit_id: U1, customer_name: 'أحمد المشتري', customer_phone: '0500000001', expires_at: '2026-10-01T12:00', deposit: 5000, pay_method: 'cash', receipt_no: 'RC-100' });
  ok(r1.status === 200 && r1.d.reservation_no, '1.1 الحجز النقدي ناجح', r1.d);
  ok(r1.d.payment && r1.d.payment.payment_no.startsWith('RPY-'), '1.2 أُنشئ قيد مالي RPY للعربون', r1.d.payment);
  const rp1 = (await call(T, 'GET', '/api/reservations/' + r1.d.id + '/payments')).d;
  ok(rp1.length === 1 && rp1[0].amount === 5000 && rp1[0].method === 'cash' && rp1[0].receipt_no === 'RC-100', '1.3 القيد: 5000 كاش مع سند قبض RC-100', rp1);
  const u1 = await call(T, 'GET', '/api/units/' + U1);
  ok(u1.d.status === 'reserved' && u1.d.reservation.status === 'active', '1.4 الوحدة أصبحت محجوزة');

  // ===== 2) حجز تحويل بنكي =====
  console.log('\n== 2) حجز تحويل بنكي ==');
  const U2 = (await call(T, 'POST', '/api/units', { project_id: P1, floor_id: F1, unit_number: '109', price: 400000 })).d.id;
  const r2 = await call(T, 'POST', '/api/reservations', { unit_id: U2, customer_name: 'سعد', customer_phone: '0500000002', expires_at: '2026-10-01T12:00', deposit: 10000, pay_method: 'bank_transfer', pay_ref: 'TR-7788', bank: 'الراجحي', received_by: 'حساب الشركة' });
  ok(r2.status === 200 && r2.d.payment.ref_no === 'TR-7788', '2.1 حجز بنكي بمرجع TR-7788', r2.d);
  const rp2 = (await call(T, 'GET', '/api/reservations/' + r2.d.id + '/payments')).d;
  ok(rp2[0] && rp2[0].method === 'bank_transfer' && rp2[0].bank === 'الراجحي' && rp2[0].received_by === 'حساب الشركة', '2.2 القيد: تحويل بنكي مع البنك والجهة المستلمة');

  // ===== 3) حجز شيك =====
  console.log('\n== 3) حجز شيك ==');
  const U3 = (await call(T, 'POST', '/api/units', { project_id: P1, floor_id: F1, unit_number: '110', price: 350000 })).d.id;
  const r3 = await call(T, 'POST', '/api/reservations', { unit_id: U3, customer_name: 'فهد', customer_phone: '0500000003', expires_at: '2026-10-01T12:00', deposit: 8000, pay_method: 'check', pay_ref: 'CHK-5566', check_date: '2026-08-24', check_due_date: '2026-09-24', bank: 'الأهلي' });
  ok(r3.status === 200, '3.1 حجز شيك ناجح', r3.d);
  const rp3 = (await call(T, 'GET', '/api/reservations/' + r3.d.id + '/payments')).d;
  ok(rp3[0] && rp3[0].method === 'check' && rp3[0].ref_no === 'CHK-5566' && rp3[0].check_status === 'pending' && rp3[0].check_due_date === '2026-09-24', '3.2 القيد: شيك CHK-5566 مع تاريخ استحقاق وحالة pending');

  // ===== 4) رفض تحويل بنكي بدون مرجع =====
  console.log('\n== 4) رفض حوالة بدون مرجع ==');
  const U4 = (await call(T, 'POST', '/api/units', { project_id: P1, floor_id: F1, unit_number: '111', price: 300000 })).d.id;
  const r4 = await call(T, 'POST', '/api/reservations', { unit_id: U4, customer_name: 'ماجد', customer_phone: '0500000004', expires_at: '2026-10-01T12:00', deposit: 5000, pay_method: 'bank_transfer' });
  ok(r4.status === 400 && String(r4.d.error).includes('مرجع'), '4.1 رفض: حوالة بدون رقم مرجع', r4.d);

  // ===== 5) رفض شيك بدون رقم شيك =====
  console.log('\n== 5) رفض شيك بدون رقم شيك ==');
  const r5 = await call(T, 'POST', '/api/reservations', { unit_id: U4, customer_name: 'ماجد', customer_phone: '0500000004', expires_at: '2026-10-01T12:00', deposit: 5000, pay_method: 'check' });
  ok(r5.status === 400 && String(r5.d.error).includes('رقم الشيك'), '5.1 رفض: شيك بدون رقم شيك', r5.d);

  // ===== 6) تحويل الحجز إلى بيع — المعادلة الرسمية =====
  console.log('\n== 6) تحويل الحجز إلى بيع (450,000 − 5,000 = 445,000) ==');
  const cv = await call(T, 'POST', `/api/reservations/${r1.d.id}/convert-to-sale`, { sale_date: '2026-08-24', base_price: 450000, discount_type: 'none', paid_amount: 0 });
  ok(cv.status === 200 && cv.d.sale_no, '6.1 التحويل ناجح', cv.d);
  ok(cv.d.paid_amount === 5000 && cv.d.remaining_amount === 445000, `6.2 المدفوع=5000 والمتبقي=445000 (فعلي: ${cv.d.paid_amount}/${cv.d.remaining_amount})`);
  ok(cv.d.deposit && cv.d.deposit.total === 5000 && cv.d.deposit.payments[0].payment_no === rp1[0].payment_no, '6.3 رقم قيد الحجز محفوظ في البيع', cv.d.deposit);
  const sum1 = (await call(T, 'GET', `/api/sales/${cv.d.id}/financial-summary`)).d;
  ok(sum1.finance.base === 450000 && sum1.finance.discounts === 0 && sum1.finance.paid === 5000 && sum1.finance.remaining === 445000, '6.4 financial-summary: 450,000 / خصم 0 / مدفوع 5,000 / متبقي 445,000');
  ok(sum1.payments.length === 0, '6.5 لم تُنشأ دفعة مكررة في جدول الدفعات', sum1.payments);
  ok(sum1.deposit.count === 1 && sum1.deposit.payments[0].status === 'transferred', '6.6 دفعة الحجز حالتها transferred ومرتبطة بالبيع');
  const r1after = await call(T, 'GET', '/api/reservations/' + r1.d.id + '/payments');
  ok(r1after.d[0].sale_id === cv.d.id && r1after.d[0].status === 'transferred', '6.7 القيد الأصلي RPY احتفظ برقمه وارتبط بالبيع');
  const u1b = await call(T, 'GET', '/api/units/' + U1);
  ok(u1b.d.status === 'sold' && u1b.d.sale && u1b.d.sale.sale_no === cv.d.sale_no, '6.8 الوحدة أصبحت مباعة ومرتبطة بالصفقة');

  // ===== 7) منع تحويل الحجز مرتين =====
  console.log('\n== 7) منع التحويل المكرر ==');
  const cv2 = await call(T, 'POST', `/api/reservations/${r1.d.id}/convert-to-sale`, { base_price: 450000 });
  ok(cv2.status === 400, '7.1 التحويل الثاني مرفوض', cv2.d);
  const dup = await call(T, 'GET', `/api/sales/${cv.d.id}/financial-summary`);
  ok(dup.d.finance.paid === 5000, '7.2 لم يتغير المدفوع بعد محاولة التحويل المكررة');

  // ===== 8) احتساب العربون مرة واحدة =====
  console.log('\n== 8) احتساب العربون مرة واحدة ==');
  const rpAll = (await call(T, 'GET', '/api/reservations/' + r1.d.id + '/payments')).d;
  ok(rpAll.filter(x => x.status === 'transferred').length === 1, '8.1 عربون واحد فقط محوّل للبيع', rpAll);
  const salePaid = dup.d.sale.paid_amount ?? dup.d.finance.paid;
  ok(salePaid === 5000, '8.2 paid_amount يساوي مجموع الدفعات الفعلية (5000)');

  // ===== 9) دفعات إضافية بعد البيع =====
  console.log('\n== 9) دفعات إضافية ==');
  const pay1 = await call(T, 'POST', `/api/sales/${cv.d.id}/payments`, { amount: 100000, method: 'cash', pay_date: '2026-08-25' });
  ok(pay1.status === 200 && pay1.d.paid === 105000 && pay1.d.remaining === 345000, `9.1 بعد دفعة 100,000: مدفوع 105,000 / متبقي 345,000 (${pay1.d.paid}/${pay1.d.remaining})`);
  const pay2 = await call(T, 'POST', `/api/sales/${cv.d.id}/payments`, { amount: 345000, method: 'bank_transfer', pay_date: '2026-09-01', ref_no: 'TR-999' });
  ok(pay2.status === 200 && pay2.d.remaining === 0, '9.2 التسديد الكامل: المتبقي صفر');
  const u1c = await call(T, 'GET', '/api/units/' + U1);
  ok(u1c.d.status === 'paid', '9.3 الوحدة أصبحت «مسدد بالكامل»');

  // ===== 10) خصم ثابت =====
  console.log('\n== 10) خصم ثابت ==');
  const U5 = (await call(T, 'POST', '/api/units', { project_id: P1, floor_id: F1, unit_number: '112', price: 500000 })).d.id;
  const s10 = await call(T, 'POST', '/api/sales', { unit_id: U5, customer_name: 'ناصر', customer_phone: '0500000005', sale_date: '2026-08-24', base_price: 500000, discount_type: 'amount', discount_value: 25000, payment_method: 'cash', paid_amount: 100000 });
  ok(s10.status === 200 && s10.d.final_price === 475000, `10.1 خصم ثابت 25,000: النهائي 475,000 (${s10.d.final_price})`);

  // ===== 11) خصم نسبي =====
  console.log('\n== 11) خصم نسبي ==');
  const U6 = (await call(T, 'POST', '/api/units', { project_id: P1, floor_id: F1, unit_number: '113', price: 500000 })).d.id;
  const s11 = await call(T, 'POST', '/api/sales', { unit_id: U6, customer_name: 'بندر', customer_phone: '0500000006', sale_date: '2026-08-24', base_price: 500000, discount_type: 'percent', discount_value: 10, payment_method: 'cash', paid_amount: 0 });
  ok(s11.status === 200 && s11.d.final_price === 450000 && s11.d.discount_amount === 50000, `11.1 خصم 10%: النهائي 450,000 والخصم 50,000 (${s11.d.final_price}/${s11.d.discount_amount})`);

  // ===== 12) خصم أكبر من السعر =====
  console.log('\n== 12) خصم أكبر من السعر مرفوض ==');
  const s12 = await call(T, 'POST', '/api/sales', { unit_id: U6, customer_name: 'بندر', customer_phone: '0500000006', base_price: 500000, discount_type: 'amount', discount_value: 600000, payment_method: 'cash' });
  ok(s12.status === 400, '12.1 رفض: خصم 600,000 > سعر 500,000', s12.d);

  // ===== 13) إلغاء الحجز =====
  console.log('\n== 13) إلغاء الحجز ==');
  const cx = await call(T, 'POST', `/api/reservations/${r3.d.id}/cancel`, { reason: 'تنازل العميل' });
  ok(cx.status === 200, '13.1 إلغاء الحجز ناجح');
  const u3b = await call(T, 'GET', '/api/units/' + U3);
  ok(u3b.d.status === 'available', '13.2 الوحدة عادت متاحة');
  const rp3b = (await call(T, 'GET', '/api/reservations/' + r3.d.id + '/payments')).d;
  ok(rp3b.length === 1 && rp3b[0].amount === 8000, '13.3 سجل العربون محفوظ (لا يُحذف)');

  // ===== 14) إلغاء البيع =====
  console.log('\n== 14) إلغاء البيع ==');
  const cx2 = await call(T, 'POST', `/api/sales/${s10.d.id}/cancel`, { reason: 'فسخ من العميل' });
  ok(cx2.status === 200, '14.1 إلغاء البيع ناجح');
  const u5b = await call(T, 'GET', '/api/units/' + U5);
  ok(u5b.d.status === 'available', '14.2 الوحدة عادت متاحة');
  const ps = await call(T, 'GET', `/api/sales/${s10.d.id}/payments`);
  ok(ps.d.every(x => x.status === 'cancelled'), '14.3 الدفعات الملغاة مسجلة كملغاة (لا تُحذف)');

  // ===== 15) إعادة البيع =====
  console.log('\n== 15) إعادة البيع ==');
  await call(T, 'PUT', '/api/projects/' + P1, { code: '108', name: 'العزيزية', construction_status: 'completed' });
  const od = await call(T, 'POST', `/api/units/${U1}/owner-decision`, { decision: 'resale', new_price: 600000, owner_name: 'أحمد المشتري' });
  ok(od.status === 200, '15.1 عرض الوحدة لإعادة البيع بسعر 600,000', od.d);
  const u1d = await call(T, 'GET', '/api/units/' + U1);
  ok(u1d.d.status === 'resale' && u1d.d.prev_price === 450000, '15.2 حالة الوحدة إعادة بيع مع حفظ السعر السابق');
  const MK = (await call(T, 'POST', '/api/marketers', { name: 'عبدالله المسوق', code: 'MK-1' })).d.id;
  const s15 = await call(T, 'POST', '/api/sales', { unit_id: U1, customer_name: 'خالد الجديد', customer_phone: '0500000007', sale_date: '2026-08-24', base_price: 600000, discount_type: 'none', payment_method: 'bank_transfer', payment_ref: 'TR-1515', paid_amount: 200000, marketer_id: MK, commission_type: 'percent', commission_value: 2 });
  ok(s15.status === 200 && s15.d.is_resale && s15.d.report_no, '15.3 إعادة البيع ناجحة مع تقرير تصفية', s15.d);
  const fin15 = (await call(T, 'GET', `/api/sales/${s15.d.id}/financial-summary`)).d;
  ok(fin15.resale.prev_owner_name === 'أحمد المشتري' && fin15.resale.purchase_price === 450000, '15.4 المالك السابق وسعر الشراء السابق محفوظان', fin15.resale);
  ok(fin15.finance.prev_owner_finance && fin15.finance.prev_owner_finance.remaining === 0, '15.5 صافي المالك السابق بعد التسديد الكامل = 0', fin15.finance.prev_owner_finance);
  const settlements = await call(T, 'GET', '/api/settlements');
  ok(settlements.d.some(x => x.sale_no === s15.d.sale_no), '15.6 تقرير التصفية مرتبط بعملية إعادة البيع');

  // ===== 16) المصروفات =====
  console.log('\n== 16) المصروفات ==');
  const exp = await call(T, 'POST', `/api/sales/${s15.d.id}/expenses`, { title: 'رسوم إدارية', amount: 3000, expense_date: '2026-08-24' });
  ok(exp.status === 200, '16.1 تسجيل مصروف 3,000', exp.d);
  const fin16 = (await call(T, 'GET', `/api/sales/${s15.d.id}/financial-summary`)).d;
  ok(fin16.finance.expenses === 3000, '16.2 المصروفات محسوبة في اللوحة المالية');

  // ===== 17) العمولات =====
  console.log('\n== 17) العمولات ==');
  ok(fin16.finance.commission === 12000 && fin16.commission.type === 'percent' && fin16.commission.value === 2, `17.1 عمولة المسوق 2% = 12,000 (${fin16.finance.commission})`);

  // ===== 18) دفعات العمولات =====
  console.log('\n== 18) دفعات العمولات ==');
  const cp = await call(T, 'POST', `/api/sales/${s15.d.id}/commission-payments`, { amount: 12000, method: 'cash', pay_date: '2026-08-26' });
  ok(cp.status === 200 && cp.d.status === 'paid', '18.1 دفع العمولة 12,000 → الحالة paid', cp.d);
  const fin18 = (await call(T, 'GET', `/api/sales/${s15.d.id}/financial-summary`)).d;
  ok(fin18.commission.paid === 12000 && fin18.commission.remaining === 0, '18.2 المدفوع للمسوق 12,000 والمتبقي صفر');

  // ===== 19) أرباح المستثمر =====
  console.log('\n== 19) أرباح المستثمر ==');
  const inv = await call(T, 'PUT', `/api/sales/${s15.d.id}/investor`, { investor_name: 'أحمد المشتري', property_cost: 400000, reason: 'تحديد رأس مال إعادة البيع' });
  ok(inv.status === 200, '19.1 تحديث بيانات المستثمر', inv.d);
  const fin19 = (await call(T, 'GET', `/api/sales/${s15.d.id}/financial-summary`)).d;
  ok(fin19.finance.property_cost === 400000, '19.2 تكلفة العقار 400,000');
  ok(fin19.finance.net_profit === (200000 - 400000 - 3000 - 12000), `19.3 صافي الربح المحقق = المحصل − التكاليف (${fin19.finance.net_profit})`);
  const invSet = await call(T, 'GET', '/api/investor-settlements');
  ok(invSet.d.some(x => x.sale_no === s15.d.sale_no && x.net_amount != null), '19.4 بند صافي مستحق المستثمر موجود في تصفيات المستثمرين');

  // ===== 20) التسويات =====
  console.log('\n== 20) التسويات ==');
  const adj = await call(T, 'POST', `/api/sales/${s11.d.id}/adjustments`, { adjustment_type: 'balance_debit', amount: 5000, reason: 'مبلغ مفقود من دفعة قديمة', adjustment_date: '2026-08-24' });
  ok(adj.status === 200 && adj.d.adjustment_no, '20.1 تسوية balance_debit مسجلة', adj.d);
  const fin20 = (await call(T, 'GET', `/api/sales/${s11.d.id}/financial-summary`)).d;
  ok(fin20.finance.adjustments.net === 5000 && fin20.finance.final === 455000, `20.2 التسوية انعكست على السعر النهائي (450,000 + 5,000 = ${fin20.finance.final})`);

  // ===== 21) إصدار الفاتورة =====
  console.log('\n== 21) الفواتير ==');
  const invs = (await call(T, 'GET', '/api/sales?limit=1000')).d.map(x => x.invoice_no);
  ok(invs.length === new Set(invs).size && invs.every(Boolean), '21.1 كل صفقة لها فاتورة فريدة', invs);
  const srch = await call(T, 'GET', '/api/invoices/search?q=' + cv.d.invoice_no);
  ok(srch.status === 200 && srch.d.type === 'sale', '21.2 البحث برقم الفاتورة يعيد السجل الكامل');

  // ===== 22) إنشاء PDF =====
  console.log('\n== 22) PDF ==');
  const pdfR = await fetch(BASE + '/api/documents/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: JSON.stringify({ type: 'sale_invoice', params: { sale_id: cv.d.id }, save: false }) });
  const pdfBuf = Buffer.from(await pdfR.arrayBuffer());
  fs.writeFileSync('/tmp/v19-sale.pdf', pdfBuf);
  ok(pdfR.status === 200 && pdfBuf.slice(0, 4).toString() === '%PDF' && pdfBuf.length > 5000, '22.1 سند البيع PDF صالح', pdfBuf.length);
  const pdfSave = await call(T, 'POST', '/api/documents/generate', { type: 'sale_invoice', params: { sale_id: cv.d.id }, save: true });
  ok(pdfSave.status === 200 && pdfSave.d.id, '22.2 حفظ PDF في الأرشيف', pdfSave.d);
  const docs = await call(T, 'GET', '/api/documents?q=' + encodeURIComponent('أحمد المشتري'));
  ok(Array.isArray(docs.d) && docs.d.filter(x => x.doc_type === 'sale_invoice').length > 0, '22.3 المستند في الأرشيف');

  // ===== 23) تصدير Excel =====
  console.log('\n== 23) Excel ==');
  const xr = await fetch(BASE + `/api/reports/projects/export.xlsx?project_id=${P1}`, { headers: { Authorization: 'Bearer ' + T } });
  const xbuf = Buffer.from(await xr.arrayBuffer());
  ok(xr.status === 200 && xbuf.slice(0, 2).toString() === 'PK', '23.1 ملف XLSX حقيقي', xr.status);
  const xlsxPath = path.join(os.tmpdir(), 'v19-projects.xlsx');
  fs.writeFileSync(xlsxPath, xbuf);
  const ExcelJS = require(path.join(ROOT, 'node_modules', 'exceljs'));
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(xlsxPath);
  const ws = wb.getWorksheet(1);
  ok(!!ws && ws.views[0] && ws.views[0].rightToLeft === true, '23.2 الاتجاه RTL');
  const afMatch = String(ws.autoFilter || '').match(/^[A-Z]+(\d+):[A-Z]+(\d+)$/);
  ok(!!afMatch && +afMatch[1] === 7 && +afMatch[2] > 7, '23.3 AutoFilter مفعل على نطاق البيانات فقط (خارج الإجماليات) — ' + ws.autoFilter);
  ok(ws.views[0].state === 'frozen', '23.4 Freeze Panes مفعل');
  ok(String(ws.getRow(1).getCell(1).value).includes('بيات الأكنة'), '23.5 رأس التقرير: اسم الشركة');
  ok(String(ws.getRow(3).getCell(1).value).includes('العزيزية'), '23.6 رأس التقرير: اسم المشروع واضح');

  // ===== 24) الفلاتر =====
  console.log('\n== 24) الفلاتر ==');
  const P2 = (await call(T, 'POST', '/api/projects', { code: '200', name: 'الورود' })).d.id;
  const F2 = (await call(T, 'POST', '/api/floors', { project_id: P2, name: 'الأول', floor_order: 1 })).d.id;
  await call(T, 'POST', '/api/units', { project_id: P2, floor_id: F2, unit_number: '201', price: 200000 });
  const allRows = (await call(T, 'GET', '/api/reports/projects')).d;
  const filtRows = (await call(T, 'GET', '/api/reports/projects?project_id=' + P1)).d;
  ok(allRows.totals.units >= 7 && filtRows.totals.units < allRows.totals.units, `24.1 فلتر المشروع يقلص النتائج (الكل ${allRows.totals.units} / المفلتر ${filtRows.totals.units})`);
  const unitFilter = (await call(T, 'GET', '/api/reports/projects?unit_number=108')).d;
  ok(unitFilter.totals.units === 1 && unitFilter.rows[0].unit_number === '108', '24.2 فلتر رقم الوحدة يعيد الوحدة 108 فقط');
  const buyerFilter = (await call(T, 'GET', '/api/reports/projects?buyer=خالد')).d;
  ok(buyerFilter.totals.units >= 1 && buyerFilter.rows.every(r => String(r.customer_name).includes('خالد')), '24.3 فلتر اسم المشتري');

  // ===== 25-30) الصلاحيات والأمان =====
  console.log('\n== 25-30) الصلاحيات ==');
  const viewerUser = await call(T, 'POST', '/api/users', { name: 'مستخدم محدود', username: 'viewer1', password: 'Viewer@123', role: 'viewer' });
  ok(viewerUser.status === 200, '25.0 إنشاء مستخدم viewer');
  const TV = (await call(null, 'POST', '/api/login', { username: 'viewer1', password: 'Viewer@123' })).d.token;
  ok(!!TV, '25.0 دخول المستخدم المحدود');
  const vSales = await call(TV, 'GET', '/api/sales');
  ok(vSales.status === 403, '25.1 صلاحية مختلفة: viewer لا يرى المبيعات (403)', vSales.d);
  const vFinance = await call(TV, 'GET', '/api/sales/' + cv.d.id + '/financial-record');
  ok(vFinance.status === 403, '26.1 الوصول المباشر للرابط المالي مرفوض', vFinance.d);
  const vPay = await call(TV, 'POST', `/api/sales/${cv.d.id}/payments`, { amount: 1000, method: 'cash' });
  ok(vPay.status === 403, '27.1 استدعاء API مالي بدون صلاحية مرفوض', vPay.d);
  // 28) تغيير صلاحية أثناء الجلسة: منح view_sales فقط
  await call(T, 'PUT', '/api/users/' + viewerUser.d.id + '/permissions', { permissions: { view_sales: true, view_units: true, view_projects: true } });
  const vSales2 = await call(TV, 'GET', '/api/sales?limit=5');
  ok(vSales2.status === 200, '28.1 نفس الجلسة ترى المبيعات بعد منح الصلاحية (تحديث فوري)', vSales2.d);
  ok(vSales2.d.every(s => s.final_price == null && s.paid_amount == null), '30.1 بدون view_prices: الأسعار والمبالغ مخفية (null)', vSales2.d.slice(0, 1));
  const vUnit = await call(TV, 'GET', '/api/units/' + U1);
  ok(vUnit.d.price == null && vUnit.d.sale && vUnit.d.sale.final_price == null, '30.2 الوحدة: السعر مخفي والبيع بدون أرقام مالية');
  const vPay2 = await call(TV, 'POST', `/api/sales/${cv.d.id}/payments`, { amount: 1000, method: 'cash' });
  ok(vPay2.status === 403, '28.2 لا تزال الدفعات مرفوضة (صلاحية الدفع غير ممنوحة)');
  // 29) تعطيل المستخدم
  await call(T, 'POST', '/api/users/' + viewerUser.d.id + '/toggle');
  const vMe = await call(TV, 'GET', '/api/me');
  ok(vMe.status === 401, '29.1 تعطيل المستخدم يبطل جلسته فورًا (401)', vMe.d);

  // ===== 31) تعارض حجز وحدتين في نفس الوقت =====
  console.log('\n== 31) تعارض حجز متزامن ==');
  const U7 = (await call(T, 'POST', '/api/units', { project_id: P2, floor_id: F2, unit_number: '202', price: 250000 })).d.id;
  const [ra, rb] = await Promise.all([
    call(T, 'POST', '/api/reservations', { unit_id: U7, customer_name: 'عمر', customer_phone: '0500000011', expires_at: '2026-10-01T12:00', deposit: 3000, pay_method: 'cash' }),
    call(T, 'POST', '/api/reservations', { unit_id: U7, customer_name: 'زياد', customer_phone: '0500000012', expires_at: '2026-10-01T12:00', deposit: 3000, pay_method: 'cash' }),
  ]);
  const statuses = [ra.status, rb.status].sort();
  ok(statuses[0] === 200 && statuses[1] === 400, `31.1 حجز واحد فقط ينجح من المحاولتين المتزامنتين (${statuses})`, [ra.d, rb.d]);
  const rpCount = (await call(T, 'GET', `/api/reservations/${ra.status === 200 ? ra.d.id : rb.d.id}/payments`)).d.length;
  ok(rpCount === 1, '31.2 قيد عربون واحد فقط للحجز الناجح');

  // ===== 32) إعادة إرسال نفس الطلب (Idempotency) =====
  console.log('\n== 32) إعادة إرسال نفس الطلب ==');
  const key = 'IDEM-' + Date.now();
  const ip1 = await call(T, 'POST', `/api/sales/${cv.d.id}/payments`, { amount: 1, method: 'cash' }, { 'Idempotency-Key': key });
  const ip2 = await call(T, 'POST', `/api/sales/${cv.d.id}/payments`, { amount: 1, method: 'cash' }, { 'Idempotency-Key': key });
  ok(ip1.status === 200, '32.1 الطلب الأول ينفذ', ip1.d);
  ok(ip2.status === 409, '32.2 إعادة الإرسال بنفس المفتاح مرفوضة (409) تمنع التكرار المالي', ip2.d);
  const paidAfter = (await call(T, 'GET', `/api/sales/${cv.d.id}/financial-summary`)).d.finance.paid;
  ok(paidAfter === 450001, `32.3 الدفعة دخلت مرة واحدة فقط (المدفوع ${paidAfter})`);

  // ===== 33) انقطاع الشبكة أثناء عملية مالية =====
  console.log('\n== 33) انقطاع الشبكة أثناء عملية مالية ==');
  const U8 = (await call(T, 'POST', '/api/units', { project_id: P2, floor_id: F2, unit_number: '203', price: 300000 })).d.id;
  const r8 = await call(T, 'POST', '/api/reservations', { unit_id: U8, customer_name: 'تركي', customer_phone: '0500000013', expires_at: '2026-10-01T12:00', deposit: 6000, pay_method: 'cash' });
  // المحاكاة: استجابة التحويل "ضاعت" فأعاد العميل نفس الطلب
  await call(T, 'POST', `/api/reservations/${r8.d.id}/convert-to-sale`, { base_price: 300000, paid_amount: 0 });
  const retry = await call(T, 'POST', `/api/reservations/${r8.d.id}/convert-to-sale`, { base_price: 300000, paid_amount: 0 });
  ok(retry.status === 400, '33.1 إعادة الطلب بعد الضياع مرفوضة (لا تكرار)', retry.d);
  const rp8 = (await call(T, 'GET', `/api/reservations/${r8.d.id}/payments`)).d;
  ok(rp8.filter(x => x.status === 'transferred').length === 1, '33.2 العربون لم يُنقل مرتين', rp8);
  const salesOfU8 = (await call(T, 'GET', '/api/sales?search=203')).d;
  ok(salesOfU8.length === 1, '33.3 لا يوجد سوى بيع واحد للوحدة', salesOfU8);

  // ===== 34) مطابقة الأرقام بين API وExcel وPDF =====
  console.log('\n== 34) مطابقة الأرقام بين API وExcel وPDF ==');
  // أحدث صفقة للوحدة 108 (إعادة البيع) — هي ما يعرضه Excel للوحدة
  const sales108 = (await call(T, 'GET', '/api/sales?search=108&limit=100')).d;
  const latestSale = sales108.sort((a, b) => b.id - a.id)[0];
  ok(!!latestSale && latestSale.sale_no === s15.d.sale_no, '34.0 أحدث صفقة للوحدة 108 هي إعادة البيع ' + (latestSale && latestSale.sale_no));
  const sumX = (await call(T, 'GET', `/api/sales/${latestSale.id}/financial-summary`)).d;
  // إعادة تصدير Excel طازجًا (نفس الفلاتر) ليطابق اللحظة الحالية من API
  const xr2 = await fetch(BASE + `/api/reports/projects/export.xlsx?project_id=${P1}`, { headers: { Authorization: 'Bearer ' + T } });
  const xlsxAll = Buffer.from(await xr2.arrayBuffer());
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(xlsxAll);
  const ws2 = wb2.getWorksheet(1);
  let excelRow = null;
  ws2.eachRow((row, n) => { if (n > 7 && row.getCell(2).value === '108') excelRow = row; });
  ok(!!excelRow, '34.1 صف الوحدة 108 موجود في Excel');
  if (excelRow) {
    const toNum = v => (typeof v === 'object' && v !== null && 'result' in v) ? v.result : v;
    ok(Math.round(toNum(excelRow.getCell(14).value)) === Math.round(sumX.finance.final), `34.2 صافي البيع في Excel = API (${toNum(excelRow.getCell(14).value)} = ${sumX.finance.final})`);
    ok(Math.round(toNum(excelRow.getCell(15).value) || 0) === Math.round(sumX.deposit.total), `34.3 مبلغ الحجز في Excel = API (${toNum(excelRow.getCell(15).value)} = ${sumX.deposit.total})`);
    ok(Math.round(toNum(excelRow.getCell(20).value)) === Math.round(sumX.finance.paid), `34.4 إجمالي المدفوع في Excel = API (${toNum(excelRow.getCell(20).value)} = ${sumX.finance.paid})`);
    ok(Math.round(toNum(excelRow.getCell(21).value)) === Math.round(sumX.finance.remaining), `34.5 المتبقي في Excel = API (${toNum(excelRow.getCell(21).value)} = ${sumX.finance.remaining})`);
    if (sumX.deposit.total > 0) ok(String(excelRow.getCell(16).value) === sumX.deposit.payments[0].payment_no, '34.6 رقم قيد الحجز في Excel = API');
  }
  // PDF (سند البيع الأول) يطابق أرقامه الصادرة لحظة التوليد: الأساسي 450,000 والعربون 5,000
  const pdfTxt = require('child_process').execSync(`pdftotext -raw /tmp/v19-sale.pdf -`).toString();
  const hasNum = n => pdfTxt.includes(String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  ok(hasNum(450000) && hasNum(5000) && hasNum(100000) && hasNum(345000), '34.7 PDF يعرض أرقام API نفسها (450,000 / 5,000 / 100,000 / 345,000)', pdfTxt.slice(0, 120));
  ok(pdfTxt.includes(rp1[0].payment_no), '34.8 رقم قيد الحجز RPY يظهر في PDF');

  // ===== 35) فحص السلامة المالية =====
  console.log('\n== 35) السلامة المالية ==');
  const integ = (await call(T, 'GET', '/api/finance/integrity')).d;
  ok(integ.ok === true && integ.issues.length === 0, `35.1 لا توجد فروق محاسبية (فحص ${integ.checked_sales} صفقة)`, integ.issues);

  // ===== 36) ترحيل العربونات القديمة =====
  console.log('\n== 36) ترحيل العربونات القديمة ==');
  await new Promise(r => { server.child.on('exit', r); server.child.kill('SIGTERM'); });
  await sleep(800);
  const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
  const dbFile = path.join(DATA_DIR, 'bayat.sqlite');
  const db = new Database(dbFile);
  // إنشاء حجز قديم (بدون دفعة) — محاكاة بيانات نسخة سابقة
  const legacyCust = db.prepare("INSERT INTO customers(name,phone) VALUES('عميل قديم','0509999999')").run().lastInsertRowid;
  const legacyUnit = db.prepare("INSERT INTO units(project_id,floor_id,unit_number,price,status) VALUES(?,?,'999',150000,'reserved')").run(P1, F1).lastInsertRowid;
  const legacyRsv = db.prepare("INSERT INTO reservations(reservation_no,unit_id,customer_id,user_id,expires_at,deposit,status,created_at) VALUES('RSV-LEGACY-1',?,?,1,'2026-01-01T12:00',7000,'active','2025-12-01 10:00:00')").run(legacyUnit, legacyCust).lastInsertRowid;
  // إعادة تشغيل الترحيل (حذف علامة الترحيل ثم إقلاع جديد)
  db.prepare("DELETE FROM settings WHERE key='migration_deposits_v190'").run();
  db.close();
  server = await startServer();
  const T2 = (await call(null, 'POST', '/api/login', { username: 'admin', password: 'Admin@103' })).d.token;
  const legacyRps = (await call(T2, 'GET', `/api/reservations/${legacyRsv}/payments`)).d;
  const expNo = 'RPY-LEGACY-' + String(legacyRsv).padStart(6, '0');
  ok(legacyRps.length === 1 && legacyRps[0].payment_no === expNo && legacyRps[0].amount === 7000 && legacyRps[0].customer_id === legacyCust && legacyRps[0].unit_id === legacyUnit && legacyRps[0].project_id === P1, '36.1 العربون القديم رُحّل كقيد ' + expNo + ' مرتبط بالحجز/العميل/الوحدة/المشروع', legacyRps);
  ok(legacyRps[0].sale_id == null, '36.2 القيد القديم غير مرتبط بصفقة (لا يتغير أي رصيد تاريخي)');
  // منع الترحيل المكرر
  await new Promise(r => { server.child.on('exit', r); server.child.kill('SIGTERM'); });
  await sleep(800);
  server = await startServer();
  const T3 = (await call(null, 'POST', '/api/login', { username: 'admin', password: 'Admin@103' })).d.token;
  const legacyRps2 = (await call(T3, 'GET', `/api/reservations/${legacyRsv}/payments`)).d;
  ok(legacyRps2.length === 1, '36.3 الترحيل لا يتكرر (قيد واحد فقط بعد إقلاع ثانٍ)', legacyRps2);
  const migRep = (await call(T3, 'GET', '/api/settings')).d.migration_deposits_v190;
  ok(migRep && JSON.parse(migRep).created_payments >= 1, '36.4 تقرير الترحيل محفوظ في الإعدادات');

  // ===== 37) الدفع الزائد بلا صلاحية =====
  console.log('\n== 37) الدفع الزائد ==');
  const salesUser = await call(T3, 'POST', '/api/users', { name: 'موظف مبيعات', username: 'salesmgr1', password: 'Sales@123', role: 'sales_manager' });
  // صلاحيات مخصصة: لديه تسجيل الدفعات لكن بدون allow_overpayments
  await call(T3, 'PUT', '/api/users/' + salesUser.d.id + '/permissions', { permissions: { view_sales: true, add_sale: true, add_payment: true, view_prices: true, view_discounts: true, view_units: true, view_projects: true, add_customer: true } });
  const TS = (await call(null, 'POST', '/api/login', { username: 'salesmgr1', password: 'Sales@123' })).d.token;
  const U9 = (await call(T3, 'POST', '/api/units', { project_id: P2, floor_id: F2, unit_number: '204', price: 100000 })).d.id;
  const s9 = await call(T3, 'POST', '/api/sales', { unit_id: U9, customer_name: 'صالح', customer_phone: '0500000014', base_price: 100000, payment_method: 'cash', paid_amount: 50000 });
  ok(s9.status === 200, '37.0 بيع بمدفوع 50,000');
  const over = await call(TS, 'POST', `/api/sales/${s9.d.id}/payments`, { amount: 60000, method: 'cash' });
  ok(over.status === 400 && String(over.d.error).includes('صلاحية'), '37.1 موظف المبيعات لا يستطيع الدفع الزائد (60,000 > المتبقي 50,000)', over.d);
  const overAdmin = await call(T3, 'POST', `/api/sales/${s9.d.id}/payments`, { amount: 60000, method: 'cash' });
  ok(overAdmin.status === 200, '37.2 المدير بصلاحية allow_overpayments يستطيع (ينتج رصيدًا للعميل)', overAdmin.d);

  // ===== الإغلاق والتقرير =====
  await new Promise(r => { server.child.on('exit', r); server.child.kill('SIGTERM'); });
  const md = [`# تقرير نتائج الاختبارات — v1.9`, ``, `- **التاريخ:** ${new Date().toISOString().slice(0, 10)}`, `- **قاعدة بيانات معزولة:** ${DATA_DIR}`, `- **النتيجة:** ${pass} نجح / ${fail} فشل`, ``, `| # | السيناريو | النتيجة |`, `|---|-----------|---------|`, ...results.map((r, i) => `| ${i + 1} | ${r.name} | ${r.ok ? '✅' : '❌' + (r.extra ? ' — ' + r.extra : '')} |`)].join('\n');
  fs.writeFileSync(path.join(ROOT, 'TEST-REPORT-v1.9.md'), md);
  fs.writeFileSync(path.join(ROOT, 'test-results-v1.9.json'), JSON.stringify({ generated_at: new Date().toISOString(), pass, fail, total: results.length, results }, null, 2));
  console.log(`\n==============================================`);
  console.log(`النتيجة: ${pass} نجح / ${fail} فشل (من ${results.length})`);
  console.log('التقرير: TEST-REPORT-v1.9.md + test-results-v1.9.json');
  console.log('==============================================');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
