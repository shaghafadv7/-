// ============================================================
// بيات الأكنة — اختبار v1.12: المحرك المالي المركزي
// يغطي: البيع، العربون، التحويل البنكي، الشيك، الدفع الزائد،
// الخصم، العمولة، المصروف، الإلغاء، الفلاتر، وتطابق
// (قاعدة البيانات = API = الشاشة = PDF = Excel)
// التشغيل: node scripts/test-v1.12.js
// ============================================================
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 4950 + Math.floor(Math.random() * 40);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bayat-v112-'));
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const results = [];
function ok(cond, name, extra = '') {
  if (cond) { pass++; results.push({ name, ok: true }); console.log('  ✓', name); }
  else { fail++; results.push({ name, ok: false, extra: JSON.stringify(extra).slice(0, 300) }); console.log('  ✗ FAIL:', name, extra ? '— ' + JSON.stringify(extra).slice(0, 220) : ''); }
}
const near = (a, b, e = 0.01) => Math.abs((a || 0) - (b || 0)) <= e;
async function call(t, m, p, b, headers = {}) {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...headers }, body: b ? JSON.stringify(b) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, d: ct.includes('json') ? await r.json().catch(() => ({})) : await r.arrayBuffer() };
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
  console.log('اختبار v1.12 — المحرك المالي المركزي');
  console.log('قاعدة معزولة:', DATA_DIR);
  console.log('==============================================\n');
  const server = await startServer();
  const T = (await call(null, 'POST', '/api/login', { username: 'admin', password: 'Admin@103' })).d.token;
  ok(!!T, '0.1 دخول مدير النظام');
  const P = (await call(T, 'POST', '/api/projects', { code: '912', name: 'مشروع المحرك المالي' })).d.id;
  const F = (await call(T, 'POST', '/api/floors', { project_id: P, name: 'الأول', floor_order: 1 })).d.id;
  const mkUnit = async (n, price) => (await call(T, 'POST', '/api/units', { project_id: P, floor_id: F, unit_number: n, price })).d.id;
  const MK = (await call(T, 'POST', '/api/marketers', { name: 'مسوق المحرك', code: 'MK-12' })).d.id;
  const openDb = () => new (require(path.join(ROOT, 'node_modules', 'better-sqlite3')))(path.join(DATA_DIR, 'bayat.sqlite'), { readonly: true });

  // ============ 1) بيع → دفعة → دفعة إضافية → المتبقي ============
  console.log('\n== 1) بيع ودفعات ==');
  const U1 = await mkUnit('F-101', 400000);
  const s1 = (await call(T, 'POST', '/api/sales', { unit_id: U1, customer_name: 'عميل البيع', customer_phone: '0512000001', base_price: 400000, payment_method: 'cash' })).d;
  ok(!!s1.id, '1.1 إنشاء بيع جديد بقيمة 400,000');
  await call(T, 'POST', `/api/sales/${s1.id}/payments`, { amount: 100000, method: 'cash', received_by: 'الصندوق' });
  await call(T, 'POST', `/api/sales/${s1.id}/payments`, { amount: 50000, method: 'cash', received_by: 'الصندوق' });
  let f1 = (await call(T, 'GET', `/api/sales/${s1.id}/finance`)).d;
  ok(near(f1.paid, 150000) && near(f1.remaining, 250000), `1.2 المدفوع 150,000 والمتبقي 250,000 (${f1.paid}/${f1.remaining})`, f1);
  {
    const db = openDb();
    const row = db.prepare('SELECT paid_amount,remaining_amount,final_price FROM sales WHERE id=?').get(s1.id);
    db.close();
    ok(near(row.paid_amount, f1.paid) && near(row.remaining_amount, f1.remaining) && near(row.final_price, f1.final),
      '1.3 قاعدة البيانات = API (المدفوع/المتبقي/النهائي)', row);
  }

  // ============ 2) العربون: حجز → تحويل → لا يُحتسب مرتين ============
  console.log('\n== 2) العربون ==');
  const U2 = await mkUnit('F-102', 300000);
  const rsv = (await call(T, 'POST', '/api/reservations', { unit_id: U2, customer_name: 'عميل العربون', customer_phone: '0512000002', expires_at: '2027-01-01T12:00', deposit: 30000, pay_method: 'cash', received_by: 'الصندوق' })).d;
  ok(!!rsv.payment && rsv.payment.amount === 30000, '2.1 تسجيل العربون كقيد مالي فريد', rsv.payment);
  const conv = (await call(T, 'POST', `/api/reservations/${rsv.id}/convert-to-sale`, { base_price: 300000 })).d;
  ok(!!conv.id, '2.2 تحويل الحجز إلى بيع');
  let f2 = (await call(T, 'GET', `/api/sales/${conv.id}/finance`)).d;
  ok(near(f2.paid, 30000) && near(f2.paid_deposit, 30000) && near(f2.paid_payments, 0),
    `2.3 العربون محتسب مرة واحدة فقط (المدفوع ${f2.paid} = عربون ${f2.paid_deposit} + دفعات ${f2.paid_payments})`, f2);
  await call(T, 'POST', `/api/sales/${conv.id}/payments`, { amount: 70000, method: 'cash', received_by: 'الصندوق' });
  f2 = (await call(T, 'GET', `/api/sales/${conv.id}/finance`)).d;
  ok(near(f2.paid, 100000) && near(f2.remaining, 200000), `2.4 العربون + الدفعات اللاحقة = إجمالي المدفوع (${f2.paid})`, f2);
  {
    const db = openDb();
    const n = db.prepare("SELECT COUNT(*) n FROM reservation_payments WHERE sale_id=? AND status='transferred'").get(conv.id).n;
    db.close();
    ok(n === 1, '2.5 قيد عربون واحد فقط مربوط بالبيع (لا تكرار)', { n });
  }

  // ============ 3) تحويل بنكي ============
  console.log('\n== 3) تحويل بنكي ==');
  const pb = await call(T, 'POST', `/api/sales/${s1.id}/payments`, { amount: 20000, method: 'bank_transfer', ref_no: 'TRX-9001', bank: 'الراجحي', deposit_account: 'حساب الشركة', received_by: 'المحاسب' });
  ok(pb.status === 200, '3.1 دفعة تحويل بنكي');
  {
    const db = openDb();
    const r = db.prepare('SELECT method,ref_no,bank,deposit_account,received_by FROM payments WHERE payment_no=?').get(pb.d.payment_no);
    db.close();
    ok(r.method === 'bank_transfer' && r.ref_no === 'TRX-9001' && r.bank === 'الراجحي' && r.deposit_account === 'حساب الشركة',
      '3.2 المرجع + البنك + الحساب المستلم محفوظة', r);
  }
  const noRef = await call(T, 'POST', `/api/sales/${s1.id}/payments`, { amount: 1000, method: 'bank_transfer' });
  ok(noRef.status >= 400, '3.3 رفض حوالة بدون رقم مرجع');
  const dupRef = await call(T, 'POST', `/api/sales/${s1.id}/payments`, { amount: 5000, method: 'bank_transfer', ref_no: 'TRX-9001', bank: 'الراجحي' });
  ok(dupRef.status >= 400, '3.4 رفض رقم مرجعي مكرر على نفس البنك', dupRef.d);

  // ============ 4) شيك ============
  console.log('\n== 4) شيك ==');
  const pc = await call(T, 'POST', `/api/sales/${s1.id}/payments`, { amount: 30000, method: 'check', ref_no: 'CHK-551', bank: 'الأهلي', check_due_date: '2026-12-01', check_status: 'pending' });
  ok(pc.status === 200, '4.1 دفعة بشيك');
  {
    const db = openDb();
    const r = db.prepare('SELECT ref_no,bank,check_due_date,check_status FROM payments WHERE payment_no=?').get(pc.d.payment_no);
    db.close();
    ok(r.ref_no === 'CHK-551' && r.check_due_date === '2026-12-01' && r.check_status === 'pending',
      '4.2 رقم الشيك + تاريخ الاستحقاق + الحالة محفوظة', r);
  }
  const noChk = await call(T, 'POST', `/api/sales/${s1.id}/payments`, { amount: 1000, method: 'check' });
  ok(noChk.status >= 400, '4.3 رفض شيك بدون رقم شيك');

  // ============ 5) دفع زائد ============
  console.log('\n== 5) الدفع الزائد ==');
  const U5 = await mkUnit('F-105', 100000);
  const s5 = (await call(T, 'POST', '/api/sales', { unit_id: U5, customer_name: 'عميل الزيادة', customer_phone: '0512000005', base_price: 100000, payment_method: 'cash' })).d;
  await call(T, 'POST', `/api/sales/${s5.id}/payments`, { amount: 120000, method: 'cash', received_by: 'الصندوق' });
  const f5 = (await call(T, 'GET', `/api/sales/${s5.id}/finance`)).d;
  ok(near(f5.paid, 120000) && near(f5.remaining, -20000) && near(f5.client_credit, 20000),
    `5.1 الزيادة تُسجل رصيدًا للعميل (رصيد ${f5.client_credit})`, f5);
  ok(near(f5.realized_revenue, 100000) && near(f5.overpaid, 20000),
    '5.2 الدفع الزائد لا يدخل في الإيراد المحقق', { rr: f5.realized_revenue, over: f5.overpaid });
  ok(f5.net_profit <= 100000, '5.3 الربح غير متضخم بالدفع الزائد', { net: f5.net_profit });

  // ============ 6) الخصم ============
  console.log('\n== 6) الخصم ==');
  const U6 = await mkUnit('F-106', 500000);
  const s6 = (await call(T, 'POST', '/api/sales', { unit_id: U6, customer_name: 'عميل الخصم', customer_phone: '0512000006', base_price: 500000, payment_method: 'cash' })).d;
  await call(T, 'POST', `/api/sales/${s6.id}/payments`, { amount: 100000, method: 'cash' });
  await call(T, 'POST', `/api/sales/${s6.id}/discounts`, { type: 'amount', value: 50000, reason: 'تسوية' });
  const f6 = (await call(T, 'GET', `/api/sales/${s6.id}/finance`)).d;
  ok(near(f6.final, 450000) && near(f6.remaining, 350000),
    `6.1 السعر النهائي والمتبقي أُعيد حسابهما (${f6.final}/${f6.remaining})`, f6);

  // ============ 7) العمولة ============
  console.log('\n== 7) العمولة ==');
  await call(T, 'POST', `/api/sales/${s6.id}/commission`, { marketer_id: MK, commission_type: 'percent', commission_value: 2 });
  let f7 = (await call(T, 'GET', `/api/sales/${s6.id}/finance`)).d;
  const expComm = Math.round(450000 * 0.02);
  ok(near(f7.commission, expComm), `7.1 احتساب العمولة 2% = ${expComm}`, { c: f7.commission });
  const netBefore = f7.net_profit;
  await call(T, 'POST', `/api/sales/${s6.id}/commission-payments`, { amount: 4000, method: 'cash' });
  f7 = (await call(T, 'GET', `/api/sales/${s6.id}/finance`)).d;
  ok(near(f7.commission_paid, 4000) && near(f7.commission_remaining, expComm - 4000),
    '7.2 دفع جزء من العمولة يظهر في المدفوع والمتبقي', { p: f7.commission_paid, r: f7.commission_remaining });
  ok(near(f7.net_profit, netBefore), '7.3 صافي الربح يعتمد على العمولة المستحقة لا المدفوعة (لا ازدواج)', { netBefore, after: f7.net_profit });

  // ============ 8) المصروف ============
  console.log('\n== 8) المصروف ==');
  const netPre = f7.net_profit;
  await call(T, 'POST', `/api/sales/${s6.id}/expenses`, { title: 'رسوم توثيق', amount: 5000 });
  const f8 = (await call(T, 'GET', `/api/sales/${s6.id}/finance`)).d;
  ok(near(f8.expenses, 5000) && near(f8.net_profit, netPre - 5000),
    `8.1 المصروف يخفض صافي الربح بمقداره (${netPre} ← ${f8.net_profit})`, f8);

  // ============ 9) الإلغاء ============
  console.log('\n== 9) إلغاء دفعة ==');
  const U9 = await mkUnit('F-109', 200000);
  const s9 = (await call(T, 'POST', '/api/sales', { unit_id: U9, customer_name: 'عميل الإلغاء', customer_phone: '0512000009', base_price: 200000, payment_method: 'cash' })).d;
  const p9 = (await call(T, 'POST', `/api/sales/${s9.id}/payments`, { amount: 40000, method: 'cash' })).d;
  const db9a = openDb(); const pid = db9a.prepare('SELECT id FROM payments WHERE payment_no=?').get(p9.payment_no).id; db9a.close();
  await call(T, 'POST', `/api/payments/${pid}/cancel`, { reason: 'خطأ إدخال' });
  const f9 = (await call(T, 'GET', `/api/sales/${s9.id}/finance`)).d;
  ok(near(f9.paid, 0) && near(f9.remaining, 200000), '9.1 الدفعة الملغاة لا تدخل في المدفوع', f9);
  {
    const db = openDb();
    const r = db.prepare('SELECT status,cancel_reason,cancelled_at,cancelled_by FROM payments WHERE payment_no=?').get(p9.payment_no);
    db.close();
    ok(r.status === 'cancelled' && r.cancel_reason && r.cancelled_at && r.cancelled_by,
      '9.2 السجل محفوظ (لا حذف) مع السبب والمستخدم والتاريخ', r);
  }
  // الحالات المالية: المعلقة لا تدخل في التحصيل
  const pPend = await call(T, 'POST', `/api/sales/${s9.id}/payments`, { amount: 10000, method: 'cash', payment_status: 'pending' });
  const f9b = (await call(T, 'GET', `/api/sales/${s9.id}/finance`)).d;
  ok(pPend.status === 200 && near(f9b.paid, 0) && near(f9b.pending_amount, 10000),
    '9.3 الدفعة المعلقة لا تؤثر على المدفوع وتُعرض منفصلة', { paid: f9b.paid, pending: f9b.pending_amount });

  // ============ 10) الفلاتر ============
  console.log('\n== 10) الفلاتر ==');
  const all = (await call(T, 'GET', '/api/finance/payment-ledger')).d;
  ok(all.totals.count > 0 && all.totals.collected > 0, `10.1 السجل الموحد يعمل (${all.totals.count} دفعة)`);
  const byBank = (await call(T, 'GET', '/api/finance/payment-ledger?bank=' + encodeURIComponent('الراجحي'))).d;
  ok(byBank.rows.length >= 1 && byBank.rows.every(r => (r.bank || '').includes('الراجحي')), '10.2 فلتر البنك', byBank.totals);
  const byProj = (await call(T, 'GET', '/api/finance/payment-ledger?project_id=' + P)).d;
  ok(byProj.rows.length === all.rows.length, '10.3 فلتر المشروع');
  const byMethod = (await call(T, 'GET', '/api/finance/payment-ledger?method=check')).d;
  ok(byMethod.rows.length >= 1 && byMethod.rows.every(r => r.method === 'check'), '10.4 فلتر طريقة الدفع');
  const byAmt = (await call(T, 'GET', '/api/finance/payment-ledger?amount_from=100000')).d;
  ok(byAmt.rows.every(r => r.amount >= 100000), '10.5 فلتر نطاق المبلغ');
  const combo = (await call(T, 'GET', `/api/finance/payment-ledger?project_id=${P}&method=bank_transfer&bank=${encodeURIComponent('الراجحي')}&date_from=2020-01-01`)).d;
  ok(combo.rows.length >= 1 && combo.rows.every(r => r.method === 'bank_transfer'), '10.6 عدة فلاتر معًا (مشروع + طريقة + بنك + فترة)', combo.totals);
  const byCustomer = (await call(T, 'GET', '/api/finance/payment-ledger?customer=' + encodeURIComponent('عميل العربون'))).d;
  ok(byCustomer.rows.every(r => r.customer_name.includes('عميل العربون')), '10.7 فلتر العميل');
  ok(typeof all.totals.count === 'number' && typeof all.totals.amount === 'number', '10.8 عدد النتائج وإجمالي المبالغ يظهران');

  // ============ 11) تطابق API = التقارير = PDF = Excel ============
  console.log('\n== 11) تطابق المصادر ==');
  const fin = (await call(T, 'GET', `/api/sales/${s6.id}/finance`)).d;
  const summary = (await call(T, 'GET', `/api/sales/${s6.id}/financial-summary`)).d;
  const record = (await call(T, 'GET', `/api/sales/${s6.id}/financial-record`)).d;
  ok(near(fin.final, summary.finance.final) && near(fin.paid, summary.finance.paid) && near(fin.remaining, summary.finance.remaining),
    '11.1 finance = financial-summary');
  ok(near(fin.final, record.finance.final) && near(fin.paid, record.finance.paid) && near(fin.net_profit, record.finance.net_profit),
    '11.2 finance = financial-record (المصدر الذي يبني PDF)');
  const salesRep = (await call(T, 'GET', '/api/reports/sales')).d;
  const rowS6 = salesRep.rows.find(r => r.id === s6.id);
  ok(rowS6 && near(rowS6.final_price, fin.final) && near(rowS6.paid_amount, fin.paid) && near(rowS6.remaining_amount, fin.remaining),
    '11.3 تقرير المبيعات = المحرك المالي', rowS6 && { f: rowS6.final_price, p: rowS6.paid_amount });
  const custFin = (await call(T, 'GET', '/api/customer-finance')).d;
  const rowC = custFin.rows.find(r => r.sale_id === s6.id);
  ok(rowC && near(rowC.final_price, fin.final) && near(rowC.paid_amount, fin.paid),
    '11.4 حساب العملاء = المحرك المالي');
  const projRep = (await call(T, 'GET', '/api/reports/projects?project_id=' + P)).d;
  const rowP = projRep.rows.find(r => r.sale_id === s6.id);
  ok(rowP && near(rowP.final_price, fin.final) && near(rowP.paid_amount, fin.paid),
    '11.5 تقرير المشاريع (مصدر Excel) = المحرك المالي', rowP && { f: rowP.final_price, p: rowP.paid_amount });
  const xlsx = await call(T, 'GET', '/api/reports/projects/export.xlsx?project_id=' + P);
  ok(xlsx.status === 200 && xlsx.d.byteLength > 5000, `11.6 تصدير Excel يعمل (${xlsx.d.byteLength || 0} بايت)`);
  const pdf = await call(T, 'POST', '/api/documents/generate', { type: 'sale_invoice', params: { sale_id: s6.id }, save: false });
  ok(pdf.status === 200, '11.7 توليد PDF لفاتورة البيع يعمل', pdf.d && pdf.d.error);
  const projAcc = (await call(T, 'GET', '/api/reports/project-account?project_id=' + P)).d;
  ok(projAcc.summary && projAcc.rows.length > 0 && near(projAcc.summary.sales_value, projAcc.rows.reduce((a, r) => a + r.final, 0)),
    '11.8 تقرير حساب المشروع متسق مع صفوفه', projAcc.summary);
  const finRep = (await call(T, 'GET', '/api/reports/financial')).d;
  ok(finRep.summary && typeof finRep.summary.commission_remaining === 'number' && typeof finRep.summary.client_credit_total === 'number',
    '11.9 التقرير المالي الشامل يعرض العمولات والأرصدة', finRep.summary);
  ok(near(finRep.summary.client_credit_total, 20000), '11.10 المبالغ الزائدة للعملاء تظهر في التقرير الشامل', finRep.summary.client_credit_total);

  // ============ 12) فحص السلامة المالية ============
  console.log('\n== 12) السلامة المالية ==');
  const integ = (await call(T, 'GET', '/api/finance/integrity')).d;
  const errs = (integ.issues || []).filter(x => x.severity !== 'info');
  ok(integ.ok && errs.length === 0, `12.1 لا فروق محاسبية (فحص ${integ.checked_sales} صفقة)`, errs.slice(0, 3));
  ok((integ.issues || []).some(x => x.type === 'client_credit'), '12.2 الفحص يرصد الرصيد الدائن للعميل كمعلومة');
  const rep = (await call(T, 'POST', '/api/finance/integrity/repair', {})).d;
  ok(rep.ok && rep.fixed === 0, '12.3 لا شيء يحتاج إصلاحًا (الأرقام المخزنة مطابقة)', rep);

  // ============ 13) الصلاحيات على الخادم ============
  console.log('\n== 13) الصلاحيات ==');
  await call(T, 'POST', '/api/users', { name: 'مشاهد', username: 'viewer12', password: 'Viewer@123', role: 'viewer' });
  const TV = (await call(null, 'POST', '/api/login', { username: 'viewer12', password: 'Viewer@123' })).d.token;
  ok(!!TV, '13.1 دخول مستخدم محدود الصلاحية');
  const vPay = await call(TV, 'POST', `/api/sales/${s1.id}/payments`, { amount: 1000, method: 'cash' });
  ok(vPay.status === 403, '13.2 منع تسجيل دفعة بلا صلاحية (تحقق في الخادم)');
  const vLedger = await call(TV, 'GET', '/api/finance/payment-ledger');
  ok(vLedger.status === 403, '13.3 منع عرض السجل المالي بلا صلاحية');
  const vInteg = await call(TV, 'GET', '/api/finance/integrity');
  ok(vInteg.status === 403, '13.4 منع فحص السلامة المالية بلا صلاحية');
  const vXlsx = await call(TV, 'GET', '/api/reports/projects/export.xlsx');
  ok(vXlsx.status === 403, '13.5 منع تصدير Excel بلا صلاحية');
  const vPdf = await call(TV, 'POST', '/api/documents/generate', { type: 'sale_invoice', params: { sale_id: s6.id } });
  ok(vPdf.status >= 400, '13.6 منع توليد PDF مالي بلا صلاحية');
  const vCust = await call(TV, 'GET', '/api/customer-finance');
  ok(vCust.status === 403, '13.7 منع عرض المتبقيات المالية للعملاء بلا صلاحية');

  // ============ 14) سلامة البيانات: لا فقدان ============
  console.log('\n== 14) سلامة البيانات ==');
  {
    const db = openDb();
    const counts = {
      sales: db.prepare('SELECT COUNT(*) n FROM sales').get().n,
      payments: db.prepare('SELECT COUNT(*) n FROM payments').get().n,
      rp: db.prepare('SELECT COUNT(*) n FROM reservation_payments').get().n,
      discounts: db.prepare('SELECT COUNT(*) n FROM discounts').get().n,
      expenses: db.prepare('SELECT COUNT(*) n FROM expenses').get().n,
    };
    const cancelledKept = db.prepare("SELECT COUNT(*) n FROM payments WHERE status='cancelled'").get().n;
    db.close();
    ok(counts.sales >= 5 && counts.payments >= 6 && counts.rp >= 1, '14.1 كل السجلات محفوظة', counts);
    ok(cancelledKept >= 1, '14.2 السجلات الملغاة محفوظة ولم تُحذف فعليًا', { cancelledKept });
  }

  // ============ 15) الوضع الصارم لحقول الدفع (اختياري) ============
  console.log('\n== 15) سياسة الحقول المحاسبية ==');
  const okLoose = await call(T, 'POST', `/api/sales/${s9.id}/payments`, { amount: 500, method: 'cash' });
  ok(okLoose.status === 200, '15.1 الوضع المرن (الافتراضي) يقبل دفعة نقدية بلا مستلم');
  const setStrict = await call(T, 'PUT', '/api/settings', { strict_payment_fields: '1' });
  ok(setStrict.status === 200, '15.2 تفعيل الوضع الصارم من الإعدادات');
  const blocked = await call(T, 'POST', `/api/sales/${s9.id}/payments`, { amount: 500, method: 'cash' });
  ok(blocked.status >= 400, '15.3 الوضع الصارم يمنع حفظ دفعة ناقصة البيانات', blocked.d);
  const allowed = await call(T, 'POST', `/api/sales/${s9.id}/payments`, { amount: 500, method: 'cash', received_by: 'أمين الصندوق' });
  ok(allowed.status === 200, '15.4 الوضع الصارم يقبل الدفعة المكتملة (لا يمنع العمليات الصحيحة)');
  const vStrict = await call(TV, 'PUT', '/api/settings', { strict_payment_fields: '0' });
  ok(vStrict.status === 403, '15.5 تغيير السياسة يتطلب صلاحية إدارة الإعدادات');
  await call(T, 'PUT', '/api/settings', { strict_payment_fields: '0' });

  // ============ 16) تقرير حساب المشروع وصفحة العميل ============
  console.log('\n== 16) حساب المشروع وملخص العميل ==');
  const pa = (await call(T, 'GET', '/api/reports/project-account?project_id=' + P)).d;
  ok(pa.summary.units_total > 0 && pa.summary.units_sold >= 0 && typeof pa.summary.net_profit === 'number',
    `16.1 ملخص المشروع كامل (وحدات ${pa.summary.units_total} • مباع ${pa.summary.units_sold})`, pa.summary);
  const custId = (await call(T, 'GET', '/api/customer-finance')).d.rows[0].customer_id;
  const cst = (await call(T, 'GET', '/api/customer-finance/' + custId)).d;
  ok(typeof cst.totals.units === 'number' && cst.totals.units === cst.sales.length,
    `16.2 ملخص العميل: عدد العقارات يطابق جدوله (${cst.totals.units})`, cst.totals);
  ok(cst.sales.every(x => x.finance && typeof x.finance.final === 'number'),
    '16.3 كل عقار في كشف العميل يحمل أرقام المحرك المالي');
  // فلاتر حساب العميل
  const cfUnit = (await call(T, 'GET', '/api/customer-finance?unit_number=F-106')).d;
  ok(cfUnit.rows.length >= 1 && cfUnit.rows.every(r => r.unit_number.includes('F-106')), '16.4 فلتر العقار في حساب العميل');
  const cfSettled = (await call(T, 'GET', '/api/customer-finance?settlement_status=overpaid')).d;
  ok(cfSettled.rows.every(r => r.settlement_status === 'overpaid'), '16.5 فلتر حالة السداد (دفع زائد)', cfSettled.totals);
  ok(typeof cfUnit.totals.count === 'number', '16.6 حساب العميل يعيد عدد النتائج والإجماليات');

  // ============ 17) البيع الثاني: خصم العمولة والمصروفات + التفاصيل ============
  // (خطأ v1.12.2: مصروفات إعادة البيع لم تكن تُخصم من مستحق المالك السابق)
  console.log('\n== 17) تصفية البيع الثاني ==');
  const UR = await mkUnit('RS-201', 400000);
  const r1 = (await call(T, 'POST', '/api/sales', { unit_id: UR, customer_name: 'المالك الأول', customer_phone: '0512000201', base_price: 400000, payment_method: 'cash' })).d;
  await call(T, 'POST', `/api/sales/${r1.id}/payments`, { amount: 400000, method: 'cash' });
  await call(T, 'POST', `/api/units/${UR}/owner-decision`, { decision: 'resale', new_price: 600000, owner_name: 'المالك الأول', date: '2026-08-26' });
  const r2 = (await call(T, 'POST', '/api/sales', { unit_id: UR, customer_name: 'المالك الثاني', customer_phone: '0512000202', base_price: 600000, payment_method: 'cash', marketer_id: MK, commission_type: 'percent', commission_value: 3 })).d;
  await call(T, 'POST', `/api/sales/${r2.id}/expenses`, { title: 'رسوم نقل ملكية', amount: 15000 });
  await call(T, 'POST', `/api/sales/${r2.id}/expenses`, { title: 'أتعاب تسويق', amount: 5000 });
  await call(T, 'POST', `/api/sales/${r2.id}/payments`, { amount: 600000, method: 'cash' });
  const COMM = 18000, EXPS = 20000;   // 3% من 600,000 + 15,000 + 5,000
  const setts = (await call(T, 'GET', '/api/settlements')).d;
  const repRow = setts.find(x => x.sale_no === r2.sale_no);
  ok(!!repRow, '17.1 إنشاء تقرير تصفية لعملية إعادة البيع');
  const det = (await call(T, 'GET', `/api/settlements/${repRow.id}`)).d;
  const seller = det.entries.find(e => e.party_type === 'previous_owner');
  ok(near(seller.net_amount, 600000 - COMM - EXPS),
    `17.2 صافي مستحق المالك السابق = السعر − العمولة − المصروفات (${seller.net_amount})`, { net: seller.net_amount, expected: 600000 - COMM - EXPS });
  ok(near(seller.deductions, COMM + EXPS), `17.3 الخصومات تشمل العمولة والمصروفات معًا (${seller.deductions})`);
  const finR = (await call(T, 'GET', `/api/sales/${r2.id}/finance`)).d;
  ok(near(finR.expenses, EXPS) && near(finR.commission, COMM), '17.4 المحرك المالي يطابق قيم التصفية');
  // ظهور التفاصيل
  ok(det.expenses && det.expenses.length === 2, `17.5 تفاصيل بنود المصروفات تظهر (${(det.expenses||[]).length} بند)`);
  ok(!!det.seller_breakdown, '17.6 يوجد تفصيل احتساب مستحق المالك السابق');
  const bd = det.seller_breakdown;
  ok(bd.deductions.some(x => x.key === 'expenses' && near(x.amount, EXPS)), '17.7 بند المصروفات مُدرج في تفصيل الخصم');
  ok(bd.deductions.some(x => x.key === 'commission' && near(x.amount, COMM)), '17.8 بند العمولة مُدرج في تفصيل الخصم');
  ok(near(bd.final_price - bd.total_deductions, bd.net_to_seller), '17.9 التفصيل متسق حسابيًا (السعر − الخصومات = الصافي)');
  ok(near(finR.net_profit, 600000 - 400000 - COMM - EXPS), `17.10 صافي ربح إعادة البيع يخصم العمولة والمصروفات (${finR.net_profit})`);
  const pdfSet = await call(T, 'POST', '/api/documents/generate', { type: 'settlement_report', params: { report_id: repRow.id }, save: false });
  ok(pdfSet.status === 200, '17.11 توليد PDF التصفية يعمل بعد إضافة التفاصيل');

  // ============ النتيجة ============
  console.log('\n==============================================');
  console.log(`النتيجة: ${pass} نجح / ${fail} فشل (من ${pass + fail})`);
  console.log('==============================================');
  fs.writeFileSync(path.join(ROOT, 'test-results-v1.12.json'), JSON.stringify({ pass, fail, total: pass + fail, results }, null, 2));
  server.child.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
