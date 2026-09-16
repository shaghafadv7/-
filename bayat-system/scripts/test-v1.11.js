// ============================================================
// بيات الأكنة — اختبار v1.11: حجز وحدات إعادة البيع
// (نفس نظام الحجز الحالي + ربط بعملية إعادة البيع + الإلغاء
//  يعيد الوحدة إلى «إعادة بيع» + تقارير موحدة)
// التشغيل: node scripts/test-v1.11.js
// ============================================================
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 4700 + Math.floor(Math.random() * 150);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bayat-v111-'));
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
async function startServer() {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: String(PORT), BAYAT_DATA_DIR: DATA_DIR }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  console.log('اختبار v1.11 — حجز وحدات إعادة البيع');
  console.log('قاعدة معزولة:', DATA_DIR);
  console.log('==============================================\n');
  const server = await startServer();
  const T = (await call(null, 'POST', '/api/login', { username: 'admin', password: 'Admin@103' })).d.token;
  ok(!!T, '0. دخول مدير النظام');
  const P = (await call(T, 'POST', '/api/projects', { code: '911', name: 'مشروع إعادة البيع' })).d.id;
  const F = (await call(T, 'POST', '/api/floors', { project_id: P, name: 'الأول', floor_order: 1 })).d.id;

  // ===== إعداد وحدة إعادة بيع: بيع أول ثم اكتمال ثم عرض إعادة بيع =====
  const U1 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: F, unit_number: 'R-101', price: 500000 })).d.id;
  const s1 = await call(T, 'POST', '/api/sales', { unit_id: U1, customer_name: 'خالد المالك الأول', customer_phone: '0509110001', base_price: 500000, discount_type: 'none', payment_method: 'cash', paid_amount: 500000 });
  ok(s1.status === 200 && s1.d.sale_no, '0. بيع أول مسدد بالكامل', s1.d.sale_no);
  await call(T, 'PUT', '/api/projects/' + P, { code: '911', name: 'مشروع إعادة البيع', construction_status: 'completed' });
  const od = await call(T, 'POST', `/api/units/${U1}/owner-decision`, { decision: 'resale', new_price: 600000, owner_name: 'خالد المالك الأول', date: '2026-08-25' });
  ok(od.status === 200, '0. عرض الوحدة لإعادة البيع بسعر 600,000');
  const u1 = (await call(T, 'GET', '/api/units/' + U1)).d;
  ok(u1.status === 'resale' && u1.sale && u1.sale.status === 'resold', '0. الوحدة في حالة إعادة بيع وعملية إعادة البيع resold مسجلة', u1.sale && u1.sale.sale_no);
  const RESALE_SALE_ID = u1.sale.id;
  const RESALE_SALE_NO = u1.sale.sale_no;

  // ===== 1) زر الحجز → إنشاء حجز مرتبط بإعادة البيع =====
  console.log('\n== 1) حجز وحدة إعادة البيع (نفس نظام الحجز + ربط بالعملية) ==');
  const rsv = await call(T, 'POST', '/api/reservations', {
    unit_id: U1, source_type: 'resale', resale_sale_id: RESALE_SALE_ID,
    customer_name: 'عميل إعادة البيع', customer_phone: '0509110002',
    expires_at: '2026-10-01T12:00', deposit: 15000, pay_method: 'bank_transfer', pay_ref: 'TR-3001',
    received_by: 'أمين الصندوق', deposit_account: 'خزينة الفرع',
  });
  ok(rsv.status === 200 && rsv.d.reservation_no.startsWith('RSV-'), '1.1 إنشاء الحجز ناجح', rsv.d);
  ok(rsv.d.source_type === 'resale' && rsv.d.resale_sale_id === RESALE_SALE_ID, `1.2 مصدر الحجز = إعادة بيع ومرتبط بعملية ${RESALE_SALE_NO}`);
  ok(rsv.d.unit_status_before === 'resale', '1.3 الحالة قبل الحجز محفوظة (resale) للاستعادة عند الإلغاء');
  ok(rsv.d.unit_price === 600000, `1.4 سعر إعادة البيع ملتقط (${rsv.d.unit_price})`);
  const u1b = (await call(T, 'GET', '/api/units/' + U1)).d;
  ok(u1b.status === 'reserved', '1.5 حالة الوحدة أصبحت محجوزة تلقائيًا');
  ok(u1b.reservation && u1b.reservation.id === rsv.d.id, '1.6 الحجز ظاهر داخل تفاصيل الوحدة/إعادة البيع');

  // ===== 2) منع حجز آخر لنفس الوحدة أثناء حجز فعال =====
  console.log('\n== 2) منع الحجز المزدوج ==');
  const dup = await call(T, 'POST', '/api/reservations', { unit_id: U1, source_type: 'resale', resale_sale_id: RESALE_SALE_ID, customer_name: 'عميل ثان', customer_phone: '0509110003', expires_at: '2026-10-01T12:00', deposit: 1000, pay_method: 'cash' });
  ok(dup.status === 400, '2.1 رفض إنشاء حجز ثانٍ لنفس الوحدة', dup.d);

  // ===== 3) رفض ربط خاطئ بعملية إعادة البيع =====
  console.log('\n== 3) التحقق من صحة الربط ==');
  const U2 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: F, unit_number: 'R-102', price: 400000 })).d.id;
  const badLink = await call(T, 'POST', '/api/reservations', { unit_id: U2, source_type: 'resale', resale_sale_id: RESALE_SALE_ID, customer_name: 'x', customer_phone: '0509110004', expires_at: '2026-10-01T12:00', deposit: 1000, pay_method: 'cash' });
  ok(badLink.status === 400, '3.1 رفض ربط حجز بعملية إعادة بيع تخص وحدة أخرى', badLink.d);
  const badSrc = await call(T, 'POST', '/api/reservations', { unit_id: U1, source_type: 'direct', customer_name: 'x', customer_phone: '0509110005', expires_at: '2026-10-01T12:00', deposit: 1000, pay_method: 'cash' });
  ok(badSrc.status === 400, '3.2 الحجز المباشر على وحدة محجوزة مرفوض (لا تعارض)', badSrc.d);

  // ===== 4) قائمة الحجوزات والتتبع =====
  console.log('\n== 4) القائمة ومسار الدفعة ==');
  const list = (await call(T, 'GET', '/api/reservations?source_type=resale')).d;
  ok(list.length === 1 && list[0].resale_sale_no === RESALE_SALE_NO && list[0].resale_price === 600000, '4.1 فلتر المصدر (إعادة بيع) يعيد الحجز مع رقم العملية والسعر');
  const rp = (await call(T, 'GET', `/api/reservations/${rsv.d.id}/payments`)).d[0];
  const trail = (await call(T, 'GET', `/api/reservation-payments/${rp.id}/trail`)).d;
  ok(trail.resale && trail.resale.resale_sale_no === RESALE_SALE_NO && trail.resale.resale_price === 600000, '4.2 مسار الدفعة يعرض عملية إعادة البيع المرتبطة', trail.resale);
  ok(trail.operation.source_type === 'resale', '4.3 مصدر العملية في المسار = resale');
  const led = (await call(T, 'GET', '/api/finance/payment-ledger?q=TR-3001')).d;
  ok(led.rows.length === 1 && led.rows[0].operation_no === rsv.d.reservation_no, '4.4 السجل المالي الموحد يضم دفعة حجز إعادة البيع');

  // ===== 5) تحويل حجز إعادة البيع إلى بيع (صفقة إعادة بيع صحيحة) =====
  console.log('\n== 5) التحويل إلى بيع يحافظ على صفة إعادة البيع ==');
  const cv = await call(T, 'POST', `/api/reservations/${rsv.d.id}/convert-to-sale`, { base_price: 600000, discount_type: 'none', paid_amount: 0 });
  ok(cv.status === 200 && cv.d.is_resale === true, '5.1 التحويل أنشأ صفقة إعادة بيع (is_resale=true)', cv.d);
  ok(cv.d.paid_amount === 15000 && cv.d.remaining_amount === 585000, '5.2 العربون محتسب مرة واحدة (15000/585000)');
  const fin = (await call(T, 'GET', `/api/sales/${cv.d.id}/financial-summary`)).d;
  ok(fin.resale && fin.resale.prev_owner_name === 'خالد المالك الأول' && fin.resale.purchase_price === 500000, '5.3 المالك السابق وسعر الشراء السابق محفوظان', fin.resale);
  ok(fin.sale.payment_method === 'bank_transfer' && fin.finance.paid === 15000, '5.4 طريقة الدفع والمدفوع صحيحان');
  const u1c = (await call(T, 'GET', '/api/units/' + U1)).d;
  ok(u1c.status === 'sold', '5.5 الوحدة أصبحت مباعة بعد التحويل');

  // ===== 6) إلغاء حجز إعادة البيع → الوحدة تعود «إعادة بيع» =====
  console.log('\n== 6) الإلغاء يعيد الوحدة إلى إعادة بيع ==');
  const U3 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: F, unit_number: 'R-103', price: 350000 })).d.id;
  await call(T, 'POST', '/api/sales', { unit_id: U3, customer_name: 'سعد البائع', customer_phone: '0509110006', base_price: 350000, discount_type: 'none', payment_method: 'cash', paid_amount: 350000 });
  await call(T, 'POST', `/api/units/${U3}/owner-decision`, { decision: 'resale', new_price: 420000, owner_name: 'سعد البائع' });
  const u3 = (await call(T, 'GET', '/api/units/' + U3)).d;
  const rsv3 = await call(T, 'POST', '/api/reservations', { unit_id: U3, source_type: 'resale', resale_sale_id: u3.sale.id, customer_name: 'عميل الإلغاء', customer_phone: '0509110007', expires_at: '2026-10-01T12:00', deposit: 8000, pay_method: 'cash', deposit_account: 'خزينة الفرع' });
  const cx3 = await call(T, 'POST', `/api/reservations/${rsv3.d.id}/cancel`, { reason: 'طلب العميل', reason_code: 'customer_request', amount_returned: true, refund_amount: 8000, deducted_amount: 0, refund_method: 'cash', refund_date: '2026-08-25', refund_account: 'خزينة الفرع' });
  ok(cx3.status === 200 && cx3.d.unit_status === 'resale', `6.1 بعد الإلغاء الوحدة عادت إلى «إعادة بيع» (${cx3.d.unit_status})`, cx3.d);
  const u3b = (await call(T, 'GET', '/api/units/' + U3)).d;
  ok(u3b.status === 'resale', '6.2 حالة الوحدة الفعلية = resale');
  ok(u3b.price === 420000, '6.3 سعر إعادة البيع محفوظ (لم يتحول إلى متاحة)');
  const rp3 = (await call(T, 'GET', `/api/reservations/${rsv3.d.id}/payments`)).d;
  ok(rp3[0].payment_status === 'refunded' && rp3[0].amount === 8000, '6.4 الدفعة الأصلية محفوظة وحالتها مرتجعة (لا حذف)');

  // ===== 7) إلغاء جزئي مع خصم → الوحدة تعود إعادة بيع + حالة المبلغ =====
  console.log('\n== 7) الإلغاء الجزئي مع الخصم ==');
  const U4 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: F, unit_number: 'R-104', price: 300000 })).d.id;
  await call(T, 'POST', '/api/sales', { unit_id: U4, customer_name: 'فهد البائع', customer_phone: '0509110008', base_price: 300000, discount_type: 'none', payment_method: 'cash', paid_amount: 300000 });
  await call(T, 'POST', `/api/units/${U4}/owner-decision`, { decision: 'resale', new_price: 360000, owner_name: 'فهد البائع' });
  const u4 = (await call(T, 'GET', '/api/units/' + U4)).d;
  const rsv4 = await call(T, 'POST', '/api/reservations', { unit_id: U4, source_type: 'resale', resale_sale_id: u4.sale.id, customer_name: 'عميل جزئي', customer_phone: '0509110009', expires_at: '2026-10-01T12:00', deposit: 10000, pay_method: 'cash' });
  const cx4 = await call(T, 'POST', `/api/reservations/${rsv4.d.id}/cancel`, { reason: 'عدم استكمال السداد', reason_code: 'incomplete_payment', amount_returned: true, refund_amount: 7000, deducted_amount: 3000, deduction_reason: 'رسوم إدارية', refund_method: 'cash' });
  ok(cx4.status === 200 && cx4.d.unit_status === 'resale' && cx4.d.deducted_amount === 3000, '7.1 إلغاء جزئي (مرتجع 7000 / خصم 3000) والوحدة عادت إعادة بيع');
  const det4 = (await call(T, 'GET', `/api/reservations/${rsv4.d.id}/cancellation`)).d;
  ok(det4.cancellation.deducted_amount === 3000 && det4.cancellation.deduction_reason === 'رسوم إدارية', '7.2 سجل الإلغاء كامل بالخصم والسبب');
  ok((await call(T, 'GET', '/api/units/' + U4)).d.status === 'resale', '7.3 حالة الوحدة = إعادة بيع');

  // ===== 8) إلغاء بلا استرداد → الوحدة تعود إعادة بيع =====
  console.log('\n== 8) الإلغاء بلا استرداد ==');
  const U5 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: F, unit_number: 'R-105', price: 280000 })).d.id;
  await call(T, 'POST', '/api/sales', { unit_id: U5, customer_name: 'ماجد البائع', customer_phone: '0509110010', base_price: 280000, discount_type: 'none', payment_method: 'cash', paid_amount: 280000 });
  await call(T, 'POST', `/api/units/${U5}/owner-decision`, { decision: 'resale', new_price: 330000, owner_name: 'ماجد البائع' });
  const u5 = (await call(T, 'GET', '/api/units/' + U5)).d;
  const rsv5 = await call(T, 'POST', '/api/reservations', { unit_id: U5, source_type: 'resale', resale_sale_id: u5.sale.id, customer_name: 'عميل بلا استرداد', customer_phone: '0509110011', expires_at: '2026-10-01T12:00', deposit: 5000, pay_method: 'cash' });
  const cx5 = await call(T, 'POST', `/api/reservations/${rsv5.d.id}/cancel`, { reason: 'انتهاء مدة الحجز', reason_code: 'expired', amount_returned: false, notes: 'انتهت المدة' });
  ok(cx5.status === 200 && cx5.d.unit_status === 'resale', '8.1 إلغاء بلا استرداد والوحدة عادت إعادة بيع');
  const det5 = (await call(T, 'GET', `/api/reservations/${rsv5.d.id}/cancellation`)).d;
  ok(det5.cancellation.refund_amount === 0 && det5.cancellation.refund_no === null, '8.2 لا عملية استرداد (غير مسترد)');
  const rp5 = (await call(T, 'GET', `/api/reservations/${rsv5.d.id}/payments`)).d;
  ok(rp5[0].amount === 5000 && rp5[0].payment_status === 'received', '8.3 الدفعة الأصلية محفوظة بحالة مستلمة (لم تُرجع)');

  // ===== 9) التقارير الموحدة (المصدر إعادة بيع) =====
  console.log('\n== 9) التقارير الموحدة ==');
  const cr = (await call(T, 'GET', '/api/reports/cancelled-reservations?source_type=resale')).d;
  ok(cr.totals.count === 3, `9.1 تقرير الحجوزات الملغاة (مصدر إعادة بيع) يعرض 3 (${cr.totals.count})`);
  ok(cr.rows.every(r => r.source_type === 'resale' && r.resale_sale_no), '9.2 كل الصفوف تحمل المصدر ورقم عملية إعادة البيع');
  ok(cr.totals.refunded === 15000 && cr.totals.deducted === 3000, `9.3 الإجماليات: مرتجع 15000 / مخصوم 3000 (${cr.totals.refunded}/${cr.totals.deducted})`);
  const rf = (await call(T, 'GET', '/api/reports/refunds?source_type=resale')).d;
  ok(rf.totals.count === 2 && rf.rows.every(r => r.source_type === 'resale'), `9.4 تقرير الاستردادات (إعادة بيع) يعرض 2 (${rf.totals.count})`);
  const example = (await call(T, 'GET', '/api/reports/cancelled-reservations?source_type=resale&reason_code=customer_request')).d;
  ok(example.totals.count === 1 && example.rows[0].refund_amount === 8000, '9.5 مثال: حجوزات إعادة البيع الملغاة بسبب طلب العميل');

  // ===== 10) PDF =====
  console.log('\n== 10) PDF ==');
  const p1 = await fetch(BASE + '/api/documents/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: JSON.stringify({ type: 'cancelled_reservations_report', params: { source_type: 'resale' }, save: false }) });
  const b1 = Buffer.from(await p1.arrayBuffer());
  ok(p1.status === 200 && b1.slice(0, 4).toString() === '%PDF', '10.1 PDF الحجوزات الملغاة (إعادة بيع)');

  // ===== 11) سجل العمليات =====
  console.log('\n== 11) سجل العمليات ==');
  const db = new (require(path.join(ROOT, 'node_modules', 'better-sqlite3')))(path.join(DATA_DIR, 'bayat.sqlite'), { readonly: true });
  const evs = db.prepare("SELECT event_type,title FROM unit_events WHERE unit_id=? AND event_type IN ('reserved','reservation_cancelled') ORDER BY id").all(U3);
  db.close();
  ok(evs.length === 2, `11.1 أحداث الحجز والإلغاء موثقة (${evs.length})`);
  ok(evs[1] && evs[1].title.includes('إعادة بيع'), '11.2 حدث الإلغاء يذكر العودة إلى إعادة بيع', evs[1] && evs[1].title);
  const audit = (await call(T, 'GET', '/api/finance/audit')).d;
  ok(audit.filter(a => a.action === 'reservation_cancel').length >= 3, '11.3 سجل التدقيق المالي يوثق إلغاءات إعادة البيع');

  // ===== 12) السلامة المالية =====
  console.log('\n== 12) السلامة المالية ==');
  const integ = (await call(T, 'GET', '/api/finance/integrity')).d;
  ok(integ.ok === true, `12.1 لا فروق محاسبية (فحص ${integ.checked_sales} صفقة)`, integ.issues);

  await new Promise(r => { server.child.on('exit', r); server.child.kill('SIGTERM'); });
  const md = [`# تقرير نتائج الاختبارات — v1.11`, ``, `- **التاريخ:** ${new Date().toISOString().slice(0, 10)}`, `- **النتيجة:** ${pass} نجح / ${fail} فشل`, ``, `| # | السيناريو | النتيجة |`, `|---|-----------|---------|`, ...results.map((r, i) => `| ${i + 1} | ${r.name} | ${r.ok ? '✅' : '❌' + (r.extra ? ' — ' + r.extra : '')} |`)].join('\n');
  fs.writeFileSync(path.join(ROOT, 'TEST-REPORT-v1.11.md'), md);
  fs.writeFileSync(path.join(ROOT, 'test-results-v1.11.json'), JSON.stringify({ generated_at: new Date().toISOString(), pass, fail, results }, null, 2));
  console.log(`\n==============================================`);
  console.log(`النتيجة: ${pass} نجح / ${fail} فشل (من ${results.length})`);
  console.log('التقرير: TEST-REPORT-v1.11.md');
  console.log('==============================================');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
