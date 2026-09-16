// اختبار شامل v1.8.0 — النظام المالي لإعادة البيع: المالك السابق، الخصومات، الرصيد، المصروفات، الأرباح
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

(async () => {
  console.log('== 1) التهيئة ==');
  const T = (await call(null, 'POST', '/api/login', { username: 'admin', password: 'Admin@103' })).d.token;
  await call(T, 'POST', '/api/users', { name: 'محاسب', username: 'acc1', password: 'Pass@1234', role: 'accountant' });
  await call(T, 'POST', '/api/users', { name: 'مسؤول حجوزات', username: 'res1', password: 'Pass@1234', role: 'reservations_officer' });
  const TACC = (await call(null, 'POST', '/api/login', { username: 'acc1', password: 'Pass@1234' })).d.token;
  const TRES = (await call(null, 'POST', '/api/login', { username: 'res1', password: 'Pass@1234' })).d.token;
  ok(!!T && !!TACC && !!TRES, 'مستخدمون: مدير + محاسب + مسؤول حجوزات');
  const P = (await call(T, 'POST', '/api/projects', { code: '103', name: 'مشروع النزهة' })).d.id;
  const F = (await call(T, 'POST', '/api/floors', { project_id: P, name: 'الأول', floor_order: 1 })).d.id;
  const U1 = (await call(T, 'POST', '/api/units', { project_id: P, floor_id: F, unit_number: 'A-101', price: 500000 })).d.id;
  ok(U1 > 0, 'وحدة A-101 بسعر 500,000');

  console.log('== 2) الشراء الأصلي (البيع الأول) بخصم نسبية ==');
  const s1 = (await call(T, 'POST', '/api/sales', { unit_id: U1, customer_name: 'خالد المالك الأول', customer_phone: '0501111111', sale_date: '2026-01-10', base_price: 500000, discount_type: 'percent', discount_value: 5, discount_reason: 'خصم افتتاحي', payment_method: 'cash', paid_amount: 200000 })).d;
  ok(s1.sale_no && s1.final_price === 475000, `بيعة أولى: 500,000 − 5% = 475,000 (${s1.final_price})`);
  const d1 = await call(T, 'GET', `/api/sales/${s1.id}/discounts`);
  ok(d1.d.length === 1 && d1.d[0].amount === 25000 && d1.d[0].reason === 'خصم افتتاحي' && d1.d[0].approved_by === 'مدير النظام', 'بند الخصم مستقل: القيمة + السبب + المعتمد + التاريخ');

  console.log('== 3) اكتمال المشروع وإدراج إعادة البيع ==');
  await call(T, 'PUT', '/api/projects/' + P, { code: '103', name: 'مشروع النزهة', construction_status: 'completed' });
  await call(T, 'POST', `/api/units/${U1}/owner-decision`, { decision: 'resale', new_price: 600000, date: '2026-06-01' });
  const s2 = (await call(T, 'POST', '/api/sales', { unit_id: U1, customer_name: 'سعود المشتري الجديد', customer_phone: '0502222222', sale_date: '2026-06-15', base_price: 600000, discount_type: 'none', payment_method: 'bank_transfer', payment_ref: 'TR-500', paid_amount: 100000, marketer_id: null })).d;
  ok(s2.sale_no, 'بيعة إعادة البيع 600,000');
  let ud = await call(T, 'GET', '/api/units/' + U1);
  ok(ud.d.sale.prev_owner_name === 'خالد المالك الأول', `الاسم المالك السابق يظهر تلقائيًا: ${ud.d.sale.prev_owner_name}`);
  ok(ud.d.sale.purchase_price === 475000 && ud.d.sale.purchase_date === '2026-01-10', 'سعر وتاريخ الشراء الأصلي محفوظان من الصفقة الأولى');
  ok(ud.d.sale.investor_name === 'خالد المالك الأول' && ud.d.sale.purchase_cost === 475000, 'المستثمر وتكلفة الشراء افتراضيًا من المالك السابق');

  console.log('== 4) الخصومات كبند مستقل على صفقة إعادة البيع ==');
  const dBad = await call(T, 'POST', `/api/sales/${s2.id}/discounts`, { type: 'amount', value: 700000 });
  ok(dBad.status === 400, 'منع خصم يتجاوز سعر العقد');
  const dBad2 = await call(T, 'POST', `/api/sales/${s2.id}/discounts`, { type: 'amount', value: 25000 });
  await call(T, 'POST', `/api/discounts/${dBad2.d.id}/cancel`, { reason: 'اختبار' });
  const dAdd = await call(T, 'POST', `/api/sales/${s2.id}/discounts`, { type: 'amount', value: 10000, reason: 'تسوية صيانة', approved_by: 'المدير العام', discount_date: '2026-06-20' });
  ok(dAdd.d.amount === 10000 && dAdd.d.final === 590000, 'خصم 10,000 → السعر النهائي 590,000 تلقائيًا');
  const permD = await call(TRES, 'POST', `/api/sales/${s2.id}/discounts`, { type: 'amount', value: 1000 });
  ok(permD.status === 403, 'مسؤول الحجوزات ممنوع من الخصومات');
  const permD2 = await call(TACC, 'POST', `/api/sales/${s2.id}/discounts`, { type: 'amount', value: 1000 });
  ok(permD2.status === 403, 'المحاسب (بلا صلاحية تعديل الخصومات) ممنوع');

  console.log('== 5) رصيد العميل: المتبقي / المسدد / المستحق له ==');
  let fin = await call(T, 'GET', `/api/sales/${s2.id}/finance`);
  ok(fin.d.base === 600000 && fin.d.discounts === 10000 && fin.d.final === 590000, 'العقد − الخصومات = النهائي (600,000 − 10,000 = 590,000)');
  ok(fin.d.paid === 100000 && fin.d.remaining === 490000 && fin.d.client_state === 'due_from_client', 'المتبقي على العميل 490,000');
  await call(TACC, 'POST', `/api/sales/${s2.id}/payments`, { amount: 490000, method: 'cash', pay_date: '2026-07-01' });
  fin = await call(T, 'GET', `/api/sales/${s2.id}/finance`);
  ok(fin.d.remaining === 0 && fin.d.client_state === 'settled', 'الوصول للصفر → «مسدد بالكامل»');
  ud = await call(T, 'GET', '/api/units/' + U1);
  ok(ud.d.status === 'paid', 'حالة الوحدة: مسدد بالكامل');
  const over = await call(TACC, 'POST', `/api/sales/${s2.id}/payments`, { amount: 5000, method: 'cash' });
  fin = await call(T, 'GET', `/api/sales/${s2.id}/finance`);
  ok(over.status === 200 && fin.d.remaining === -5000 && fin.d.client_state === 'due_to_client' && fin.d.client_credit === 5000, 'دفع زائد 5,000 → «مستحق للعميل 5,000» (لا قيم غير منطقية)');

  console.log('== 6) المصروفات والمستثمر والأرباح ==');
  const permE = await call(TRES, 'POST', `/api/sales/${s2.id}/expenses`, { title: 'x', amount: 1 });
  ok(permE.status === 403, 'مسؤول الحجوزات ممنوع من المصروفات');
  const e1 = await call(T, 'POST', `/api/sales/${s2.id}/expenses`, { title: 'تحديثات وتشطيبات', amount: 20000, expense_date: '2026-06-10' });
  const e2 = await call(T, 'POST', `/api/sales/${s2.id}/expenses`, { title: 'رسوم إدارية', amount: 5000 });
  fin = await call(T, 'GET', `/api/sales/${s2.id}/finance`);
  // 590,000 نهائي − 475,000 تكلفة = 115,000 إجمالي؛ − 25,000 مصروفات = 90,000 صافي
  ok(fin.d.expenses === 25000, 'إجمالي المصروفات 25,000');
  ok(fin.d.gross_profit === 115000, `الربح الإجمالي = 590,000 − 475,000 = 115,000 (${fin.d.gross_profit})`);
  ok(fin.d.gross_profit_pct === 24.21, `نسبة الربح الإجمالي = 115,000 ÷ 475,000 = 24.21% (${fin.d.gross_profit_pct})`);
  ok(fin.d.net_profit === 90000 && fin.d.net_profit_pct === 18.95, `صافي الربح = 115,000 − 25,000 = 90,000 (18.95%) (${fin.d.net_profit}/${fin.d.net_profit_pct})`);
  await call(T, 'PUT', `/api/sales/${s2.id}/investor`, { investor_name: 'شركة الاستثمار العقاري', purchase_cost: 480000 });
  fin = await call(T, 'GET', `/api/sales/${s2.id}/finance`);
  ok(fin.d.gross_profit === 110000 && fin.d.net_profit === 85000 && fin.d.net_profit_pct === 17.71, 'تعديل تكلفة الشراء ينعكس فورًا: 110,000 / 85,000 / 17.71%');
  ok(fin.d.profit_state === 'profit', 'الحالة: ربح');

  console.log('== 7) اللوحة المالية في تفاصيل الوحدة ==');
  ud = await call(T, 'GET', '/api/units/' + U1);
  ok(ud.d.sale.finance && ud.d.sale.finance.net_profit === 85000 && ud.d.sale.finance.client_state === 'due_to_client', 'اللوحة المالية مرفقة بتفاصيل الوحدة');
  ok(ud.d.sale.discounts.length === 1 && ud.d.sale.expenses.length === 2, 'قوائم الخصومات والمصروفات مرفقة');

  console.log('== 8) السجل التاريخي الكامل ==');
  const hist = await call(T, 'GET', `/api/units/${U1}/history`);
  const evTypes = hist.d.map(h => h.event_type);
  ok(evTypes.includes('sold') && evTypes.includes('discount') && evTypes.includes('expense') && evTypes.includes('payment') && evTypes.includes('investor'), `الأحداث: ${[...new Set(evTypes)].join(', ')}`);
  const soldEv = hist.d.find(h => h.event_type === 'sold' && h.details && h.details.prev_owner);
  ok(soldEv && soldEv.details.prev_owner === 'خالد المالك الأول' && soldEv.details.purchase_price === 475000, 'حدث إعادة البيع يوثق المالك السابق وسعر الشراء');
  ok(hist.d.some(h => h.event_type === 'discount' && h.title.includes('تسوية صيانة')), 'حدث الخصم يوثق السبب');
  // الصفقة الأولى ما زالت كاملة بخصمها
  const s1d = await call(T, 'GET', `/api/sales/${s1.id}/discounts`);
  ok(s1d.d.length === 1 && s1d.d[0].amount === 25000, 'سجل خصم الصفقة الأولى محفوظ (لا فقد بيانات)');

  console.log('== 9) سند بيع PDF بالبيانات المالية الكاملة ==');
  const r = await fetch(BASE + '/api/documents/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: JSON.stringify({ type: 'sale', params: { sale_id: s2.id }, save: false }) });
  fs.writeFileSync('/tmp/v18sale.pdf', Buffer.from(await r.arrayBuffer()));
  const txt = cleanTxt(execSync('pdftotext -raw /tmp/v18sale.pdf -').toString());
  const hasAll = ws => ws.every(w => hasWord(txt, w));
  ok(hasAll(['المالك', 'السابق', 'خالد', 'المالك', 'الأول']), 'PDF: المالك السابق ظاهر');
  ok(hasAll(['المستثمر', 'الربح', 'الإجمالي', 'صافي']), 'PDF: قسم المستثمر والأرباح');
  ok(hasWord(txt, 'تسوية') && hasWord(txt, 'صيانة'), 'PDF: سبب الخصم ظاهر');
  ok(hasWord(txt, 'المعتمد') || hasWord(txt, 'اعتمده'), 'PDF: عمود المعتمد للخصم');
  ok(hasWord(txt, 'تحديثات') && hasWord(txt, 'تشطيبات'), 'PDF: المصروفات ظاهرة');
  ok(txt.includes('110,000') && txt.includes('85,000'), 'PDF: أرقام الربح الإجمالي والصافي');
  ok(txt.includes('17.71'), 'PDF: نسبة صافي الربح');
  execSync('mutool draw -o /tmp/v18a.png /tmp/v18sale.pdf 2>/dev/null');
  execSync('pdftoppm -png -r 50 -f 1 -l 1 /tmp/v18sale.pdf /tmp/v18b');
  ok(fs.existsSync('/tmp/v18a.png') && fs.existsSync('/tmp/v18b-1.png'), 'PDF يُعرض على قارئين');

  console.log('== 10) الصلاحيات على اللوحة المالية ==');
  ok((await call(TRES, 'GET', `/api/sales/${s2.id}/finance`)).status === 403, 'مسؤول الحجوزات ممنوع من اللوحة المالية');
  ok((await call(TACC, 'GET', `/api/sales/${s2.id}/finance`)).status === 200, 'المحاسب يرى اللوحة المالية');

  console.log(`\n===== النتيجة: ${pass} نجح / ${fail} فشل =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
