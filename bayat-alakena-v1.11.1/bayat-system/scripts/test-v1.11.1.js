// ============================================================
// بيات الأكنة — اختبار v1.11.1: بوكس المستلم والبنك في كل
// النماذج المالية — التحقق من الحفظ الفعلي في قاعدة البيانات
// التشغيل: node scripts/test-v1.11.1.js
// ============================================================
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 4800 + Math.floor(Math.random() * 150);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bayat-v1111-'));
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
  console.log('اختبار v1.11.1 — حفظ المستلم والبنك لكل الدفعات');
  console.log('==============================================\n');
  const server = await startServer();
  const T = (await call(null, 'POST', '/api/login', { username: 'admin', password: 'Admin@103' })).d.token;
  ok(!!T, '0. دخول مدير النظام');
  const P = (await call(T, 'POST', '/api/projects', { code: '914', name: 'مشروع الاستلام' })).d.id;
  const F = (await call(T, 'POST', '/api/floors', { project_id: P, name: 'الأول', floor_order: 1 })).d.id;
  const U1 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: F, unit_number: 'S-101', price: 400000 })).d.id;
  const U2 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: F, unit_number: 'S-102', price: 300000 })).d.id;
  const MK = (await call(T, 'POST', '/api/marketers', { name: 'مسوق الاستلام', code: 'MK-11' })).d.id;

  // ===== 1) دفعة على بيع مع المستلم والبنك =====
  console.log('\n== 1) دفعة بيع ==');
  const s1 = await call(T, 'POST', '/api/sales', { unit_id: U1, customer_name: 'عميل بيع', customer_phone: '0509111001', base_price: 400000, discount_type: 'none', payment_method: 'cash', paid_amount: 100000, received_by: 'أمين الصندوق', deposit_account: 'حساب الشركة الراجحي' });
  ok(s1.status === 200, '1.0 بيع بدفعة افتتاحية');
  const pay1 = await call(T, 'POST', `/api/sales/${s1.d.id}/payments`, { amount: 50000, method: 'bank_transfer', ref_no: 'TR-501', received_by: 'خالد المحاسب', deposit_account: 'حساب الشركة الأهلي' });
  ok(pay1.status === 200, '1.1 تسجيل دفعة إضافية');
  const db = new (require(path.join(ROOT, 'node_modules', 'better-sqlite3')))(path.join(DATA_DIR, 'bayat.sqlite'), { readonly: true });
  const pRow = db.prepare("SELECT received_by,deposit_account,payment_status FROM payments WHERE payment_no=?").get(pay1.d.payment_no);
  ok(pRow.received_by === 'خالد المحاسب' && pRow.deposit_account === 'حساب الشركة الأهلي' && pRow.payment_status === 'received', `1.2 المستلم والبنك محفوظان في جدول الدفعات (${pRow.received_by}/${pRow.deposit_account})`);
  const sRow = db.prepare("SELECT received_by,deposit_account FROM payments WHERE sale_id=? ORDER BY id LIMIT 1").get(s1.d.id);
  ok(sRow.received_by === 'أمين الصندوق' && sRow.deposit_account === 'حساب الشركة الراجحي', '1.3 الدفعة الافتتاحية من شاشة البيع تحمل المستلم والبنك');

  // ===== 2) تسوية (تحصيل) =====
  console.log('\n== 2) تسوية تحصيل ==');
  const adj = await call(T, 'POST', `/api/sales/${s1.d.id}/adjustments`, { adjustment_type: 'collection', amount: 20000, reason: 'تحصيل متأخر', method: 'cash', received_by: 'أمين الصندوق', deposit_account: 'خزينة الفرع' });
  ok(adj.status === 200 && adj.d.payment_no, '2.1 تسوية تحصيل مسجلة');
  const aRow = db.prepare("SELECT received_by,deposit_account FROM payments WHERE payment_no=?").get(adj.d.payment_no);
  ok(aRow.received_by === 'أمين الصندوق' && aRow.deposit_account === 'خزينة الفرع', '2.2 المستلم والبنك محفوظان في دفعة التسوية', aRow);

  // ===== 3) دفعة عمولة =====
  console.log('\n== 3) دفعة عمولة ==');
  const s2 = await call(T, 'POST', '/api/sales', { unit_id: U2, customer_name: 'عميل عمولة', customer_phone: '0509111002', base_price: 300000, discount_type: 'none', payment_method: 'cash', paid_amount: 300000, marketer_id: MK, commission_type: 'percent', commission_value: 3 });
  ok(s2.status === 200, '3.0 بيع بعمولة 3% = 9000');
  const cp = await call(T, 'POST', `/api/sales/${s2.d.id}/commission-payments`, { amount: 9000, method: 'bank_transfer', ref_no: 'TR-502', received_by: 'مسؤول العمولات', deposit_account: 'حساب العمولات الأهلي' });
  ok(cp.status === 200, '3.1 دفع العمولة');
  const cRow = db.prepare("SELECT received_by,deposit_account,payment_status FROM commission_payments WHERE cp_no=?").get(cp.d.cp_no);
  ok(cRow.received_by === 'مسؤول العمولات' && cRow.deposit_account === 'حساب العمولات الأهلي', '3.2 المستلم والبنك محفوظان في دفعة العمولة', cRow);

  // ===== 4) تصفية إجمالية للمسوق =====
  console.log('\n== 4) تصفية إجمالية ==');
  const U3 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: F, unit_number: 'S-103', price: 250000 })).d.id;
  const s3 = await call(T, 'POST', '/api/sales', { unit_id: U3, customer_name: 'عميل تصفية', customer_phone: '0509111003', base_price: 250000, discount_type: 'none', payment_method: 'cash', paid_amount: 250000, marketer_id: MK, commission_type: 'amount', commission_value: 5000 });
  const batch = await call(T, 'POST', `/api/marketers/${MK}/settlement-batches`, { sale_ids: [s3.d.id], settlement_date: '2026-08-26', method: 'bank_transfer', ref_no: 'TR-503', received_by: 'أمين الصندوق', deposit_account: 'حساب الشركة الراجحي' });
  ok(batch.status === 200, '4.1 تصفية إجمالية (عمولة غير مدفوعة)');
  const bRow = db.prepare("SELECT received_by,deposit_account FROM commission_payments WHERE settlement_batch_id=?").get(batch.d.id);
  ok(bRow.received_by === 'أمين الصندوق' && bRow.deposit_account === 'حساب الشركة الراجحي', '4.2 المستلم والبنك محفوظان في دفعات التصفية الإجمالية', bRow);

  // ===== 5) تسوية المبالغ النهائية للصفقة (تأكد من عدم كسر الحسابات) =====
  console.log('\n== 5) سلامة الحسابات ==');
  const fin1 = (await call(T, 'GET', `/api/sales/${s1.d.id}/financial-summary`)).d;
  ok(fin1.finance.paid === 170000 && fin1.finance.remaining === 230000, `5.1 مدفوع 170,000 / متبقي 230,000 (${fin1.finance.paid}/${fin1.finance.remaining})`);
  const integ = (await call(T, 'GET', '/api/finance/integrity')).d;
  ok(integ.ok === true, '5.2 فحص السلامة المالية: لا فروق');

  // ===== 6) السجل الموحد يعرض المستلم والحساب =====
  console.log('\n== 6) السجل الموحد ==');
  const led = (await call(T, 'GET', '/api/finance/payment-ledger?account=الراجحي')).d;
  ok(led.totals.count >= 1 && led.rows.every(r => String(r.deposit_account).includes('الراجحي')), `6.1 فلتر الحساب (الراجحي) يعيد الدفعات (${led.totals.count})`);
  ok(led.rows.every(r => String(r.deposit_account).includes('الراجحي')), '6.2 كل النتائج من حساب الراجحي');

  await new Promise(r => { server.child.on('exit', r); server.child.kill('SIGTERM'); });
  const md = [`# تقرير نتائج الاختبارات — v1.11.1`, ``, `- **التاريخ:** ${new Date().toISOString().slice(0, 10)}`, `- **النتيجة:** ${pass} نجح / ${fail} فشل`, ``, `| # | السيناريو | النتيجة |`, `|---|-----------|---------|`, ...results.map((r, i) => `| ${i + 1} | ${r.name} | ${r.ok ? '✅' : '❌' + (r.extra ? ' — ' + r.extra : '')} |`)].join('\n');
  fs.writeFileSync(path.join(ROOT, 'TEST-REPORT-v1.11.1.md'), md);
  fs.writeFileSync(path.join(ROOT, 'test-results-v1.11.1.json'), JSON.stringify({ generated_at: new Date().toISOString(), pass, fail, results }, null, 2));
  console.log(`\n==============================================`);
  console.log(`النتيجة: ${pass} نجح / ${fail} فشل (من ${results.length})`);
  console.log('التقرير: TEST-REPORT-v1.11.1.md');
  console.log('==============================================');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
