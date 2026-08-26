// اختبار v1.8.1 — إضافة عمولة المسوق ومالية المالكين للتقرير المالي/سند البيع
const BASE = 'http://127.0.0.1:4173';
const fs = require('fs');
const { execSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL:', n); } };
async function call(t, m, p, b) {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, d: await r.json().catch(() => ({})) };
}
const { hasWord } = require('./lib/pdfcheck');
const cleanTxt = s => String(s).replace(/[\u2000-\u200f\u202a-\u202e\u2066-\u2069]/g, '');
const flat = s => cleanTxt(s).replace(/\s+/g, '');

(async () => {
  console.log('== 1) التهيئة: شراء أول ثم إعادة بيع بمسوق ==');
  const T = (await call(null, 'POST', '/api/login', { username: 'admin', password: 'Admin@103' })).d.token;
  const P = (await call(T, 'POST', '/api/projects', { code: '103', name: 'مشروع النزهة' })).d.id;
  const F = (await call(T, 'POST', '/api/floors', { project_id: P, name: 'الأول', floor_order: 1 })).d.id;
  const U = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: F, unit_number: 'A-101', price: 500000 })).d.id;
  const MK = (await call(T, 'POST', '/api/marketers', { name: 'أحمد المسوق', code: 'MK-1' })).d.id;
  // الشراء الأول: 500,000 − 5% = 475,000، دفع 300,000
  const s1 = (await call(T, 'POST', '/api/sales', { unit_id: U, customer_name: 'خالد المالك الأول', customer_phone: '0501111111', sale_date: '2026-01-10', base_price: 500000, discount_type: 'percent', discount_value: 5, payment_method: 'cash', paid_amount: 300000 })).d;
  ok(s1.final_price === 475000, 'الصفقة الأولى: نهائي 475,000، مدفوع 300,000، متبقٍ 175,000');
  // إعادة البيع: 600,000، مسوق 2%، دفع 200,000
  await call(T, 'PUT', '/api/projects/' + P, { code: '103', name: 'مشروع النزهة', construction_status: 'completed' });
  await call(T, 'POST', `/api/units/${U}/owner-decision`, { decision: 'resale', new_price: 600000 });
  const s2 = (await call(T, 'POST', '/api/sales', { unit_id: U, customer_name: 'سعود المالك الجديد', customer_phone: '0502222222', base_price: 600000, discount_type: 'none', payment_method: 'bank_transfer', payment_ref: 'TR-9', paid_amount: 200000, marketer_id: MK, commission_type: 'percent', commission_value: 2 })).d;
  ok(s2.sale_no && s2.final_price === 600000, 'إعادة البيع: 600,000 بعمولة مسوق 2%');

  console.log('== 2) نقطة اللوحة المالية ==');
  const fin = await call(T, 'GET', `/api/sales/${s2.id}/finance`);
  ok(fin.d.commission === 12000 && fin.d.commission_pct === 2, `عمولة المسوق: القيمة 12,000 والنسبة 2% (${fin.d.commission}/${fin.d.commission_pct})`);
  const pf = fin.d.prev_owner_finance;
  ok(pf && pf.paid === 300000 && pf.remaining === 175000 && pf.final === 475000, `المالك السابق: مدفوع 300,000 / متبقٍ 175,000 (${pf?.paid}/${pf?.remaining})`);
  const nf = fin.d.new_owner_finance;
  ok(nf && nf.paid === 200000 && nf.remaining === 400000, `المالك الجديد: مدفوع 200,000 / متبقٍ 400,000 = 600,000 − 200,000 (${nf?.remaining})`);

  console.log('== 3) التحديث التلقائي ==');
  await call(T, 'POST', `/api/sales/${s2.id}/payments`, { amount: 250000, method: 'cash' });
  const fin2 = await call(T, 'GET', `/api/sales/${s2.id}/finance`);
  ok(fin2.d.new_owner_finance.remaining === 150000, `بعد دفعة 250,000: متبقٍ المالك الجديد 150,000 تلقائيًا (${fin2.d.new_owner_finance.remaining})`);
  // دفعة على الصفقة الأولى تحدّث مالية المالك السابق
  await call(T, 'POST', `/api/sales/${s1.id}/payments`, { amount: 75000, method: 'cash' });
  const fin3 = await call(T, 'GET', `/api/sales/${s2.id}/finance`);
  ok(fin3.d.prev_owner_finance.remaining === 100000, `بعد دفعة 75,000 على الصفقة الأولى: متبقٍ المالك السابق 100,000 تلقائيًا (${fin3.d.prev_owner_finance.remaining})`);

  console.log('== 4) سند البيع PDF ==');
  const r = await fetch(BASE + '/api/documents/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: JSON.stringify({ type: 'sale', params: { sale_id: s2.id }, save: false }) });
  fs.writeFileSync('/tmp/v181.pdf', Buffer.from(await r.arrayBuffer()));
  const txt = cleanTxt(execSync('pdftotext -raw /tmp/v181.pdf -').toString());
  const hasAll = ws => ws.every(w => hasWord(txt, w));
  ok(hasAll(['الملخص', 'المالي']), 'PDF: قسم الملخص المالي للمالكين');
  ok(hasAll(['السابق']) && txt.includes('375,000') && txt.includes('100,000'), 'PDF: مدفوع ومتبقي المالك السابق (375,000 / 100,000)');
  ok(txt.includes('200,000') && txt.includes('150,000'), 'PDF: مدفوع ومتبقي المالك الجديد (200,000 / 150,000)');
  ok(hasAll(['عمولة', 'المسوق']) && txt.includes('12,000') && txt.includes('2%'), 'PDF: عمولة المسوق بالقيمة 12,000 والنسبة 2%');
  ok(hasAll(['مستحق', 'على', 'المالك', 'الجديد']) || hasAll(['مستحق', 'الجديد']), 'PDF: حالة المالك الجديد (مستحق)');
  execSync('mutool draw -o /tmp/v181.png /tmp/v181.pdf 2>/dev/null');
  ok(fs.existsSync('/tmp/v181.png'), 'PDF يُعرض على MuPDF');

  console.log('== 5) تفاصيل الوحدة = اللوحة شاملة ==');
  const ud = await call(T, 'GET', '/api/units/' + U);
  ok(ud.d.sale.finance.prev_owner_finance.remaining === 100000 && ud.d.sale.finance.new_owner_finance.remaining === 150000, 'اللوحة المالية بتفاصيل الوحدة محدثة تلقائيًا');

  console.log(`\n===== النتيجة: ${pass} نجح / ${fail} فشل =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
