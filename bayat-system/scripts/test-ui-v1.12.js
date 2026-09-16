// فحص الواجهة عبر jsdom: تحميل الصفحة + تنفيذ app.js + التنقل بين الشاشات
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path');
const ROOT = '/home/user/repo/bayat-alakena-v1.11.1/bayat-system';
const BASE = 'http://127.0.0.1:3000';
let pass=0, fail=0;
const ok=(c,n,e='')=>{ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗ FAIL:',n, e?('— '+String(e).slice(0,200)):'');} };

(async () => {
  const html = fs.readFileSync(path.join(ROOT,'public/index.html'),'utf8');
  const vc = new VirtualConsole();
  const errors=[];
  vc.on('jsdomError', e=>errors.push(e.message));
  vc.on('error', (...a)=>errors.push(a.join(' ')));
  const dom = new JSDOM(html, { runScripts:'outside-only', url: BASE+'/', virtualConsole: vc, pretendToBeVisual:true });
  const w = dom.window;
  w.fetch = (u,o)=>fetch(String(u).startsWith('http')?u:BASE+u,o);
  w.localStorage.clear();
  // الرمز يُقرأ داخل app.js عند التحميل، فيجب ضبطه قبل التنفيذ
  const r = await fetch(BASE+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'Admin@103'})});
  const {token} = await r.json();
  w.localStorage.setItem('token', token);
  const appjs = fs.readFileSync(path.join(ROOT,'public/app.js'),'utf8');
  w.eval(appjs);
  ok(errors.length===0, '1. تحميل app.js بلا أخطاء', errors[0]);
  await w.boot();
  await new Promise(r=>setTimeout(r,600));
  ok(!w.document.getElementById('appView').classList.contains('hidden'), '2. الدخول وعرض التطبيق');

  const nav = [...w.document.querySelectorAll('#nav button[data-page]')].map(b=>b.dataset.page);
  ok(nav.length===19, `3. القائمة الجانبية 19 عنصرًا بعد الدمج (${nav.length})`);
  ok(!nav.includes('marketerSettlements'), '4. عنصر «تصفية المسوقين» المنفصل أُزيل من القائمة');

  const content = () => w.document.getElementById('content').innerHTML;
  for (const page of nav) {
    try {
      await w.go(page);
      await new Promise(r=>setTimeout(r,350));
      const c = content();
      ok(c.length>200 && !c.includes('تعذر تحميل الصفحة'), `5.${page} تفتح بلا خطأ`, c.slice(0,140));
    } catch(e) { ok(false, `5.${page} تفتح بلا خطأ`, e.message); }
  }
  // تبويب تصفية المسوقين داخل الصفحة المدمجة
  await w.go('investorSettlements','marketers');
  await new Promise(r=>setTimeout(r,350));
  ok(content().includes('اختر المسوق'), '6. تبويب تصفية المسوقين يعمل داخل صفحة التصفيات');

  // شاشة الدفعات: الأعمدة العشرة + شريط النتائج + زر إعادة التعيين
  await w.go('payments');
  await new Promise(r=>setTimeout(r,700));
  const pc = content();
  ok(pc.includes('إعادة تعيين الفلاتر'), '7. زر إعادة تعيين الفلاتر موجود');
  ok(pc.includes('عدد النتائج') && pc.includes('إجمالي المبالغ'), '8. شريط عدد النتائج والإجماليات ظاهر');
  const ths=[...w.document.querySelectorAll('#ledgerBody table thead th')].map(x=>x.textContent.trim());
  ok(ths.length===10, `9. جدول الدفعات 10 أعمدة أساسية فقط (${ths.length}): ${ths.join('/')}`);
  ok(w.document.querySelectorAll('#ledgerBody tr.row-click').length>0, '10. صفوف الدفعات قابلة للنقر لعرض التفاصيل');
  // الفلاتر المطلوبة كلها موجودة
  const need=['ldProject','ldCustomer','ldUnit','ldMethod','ldBank','ldAccount2','ldRecipient','ldStatus','ldFrom','ldTo','ldAmtFrom','ldAmtTo','ldRef','ldOp'];
  const missing=need.filter(id=>!w.document.getElementById(id));
  ok(missing.length===0, '11. كل فلاتر الدفعات المطلوبة موجودة', missing.join(','));

  // حساب العميل: الفلاتر + الملخص
  await w.go('customerFinance');
  await new Promise(r=>setTimeout(r,700));
  const cneed=['cfSearch','cfProject','cfUnit','cfSaleStatus','cfSettle','cfFrom','cfTo'];
  const cmiss=cneed.filter(id=>!w.document.getElementById(id));
  ok(cmiss.length===0, '12. فلاتر حساب العميل كاملة', cmiss.join(','));
  ok(content().includes('إجمالي المتبقي'), '13. ملخص حساب العملاء يعرض الإجماليات');

  // نموذج الدفع: الحقول حسب طريقة الدفع
  const sales = await (await fetch(BASE+'/api/sales',{headers:{Authorization:'Bearer '+token}})).json();
  w.paymentForm(sales[0].id);
  await new Promise(r=>setTimeout(r,200));
  const sel = w.document.getElementById('pfMethod');
  const bankField = [...w.document.querySelectorAll('[data-pay-for]')].find(e=>e.getAttribute('data-pay-for').includes('bank_transfer'));
  ok(!!sel && !!bankField, '14. نموذج الدفع يحتوي حقولًا مرتبطة بالطريقة');
  ok(bankField.style.display==='none', '15. حقل البنك مخفي مع النقدي');
  sel.value='check'; w.applyMethodFields(sel,'check');
  const chk=[...w.document.querySelectorAll('[data-pay-for]')].filter(e=>e.getAttribute('data-pay-for').includes('check'));
  ok(chk.every(e=>e.style.display!=='none'), '16. حقول الشيك تظهر عند اختيار شيك');
  sel.value='cash'; w.applyMethodFields(sel,'cash');
  ok(chk.every(e=>e.style.display==='none'), '17. حقول الشيك تختفي عند العودة للنقدي');


  // ===== 18) صحة التسميات: التسمية يجب أن تطابق القيمة المعروضة =====
  // (خطأ v1.12.1: كان صف «إجمالي المدفوع» يعرض قيمة المتبقي في وضع التحويل)
  const rsvs = await (await fetch(BASE+'/api/reservations',{headers:{Authorization:'Bearer '+token}})).json();
  const conv = rsvs.find(r=>r.status==='active' && r.rp_total>0);
  if (conv) {
    await w.saleForm(conv.unit_id, conv.id);
    await new Promise(r=>setTimeout(r,450));
    const dep = w._saleDeposit || 0;
    const base = +w.document.getElementById('sfBase').value;
    const extra = Math.max(0, base - dep - 1000);       // نترك متبقيًا معلومًا = 1000
    w.document.getElementById('sfPaid').value = extra;
    w.saleCalc();
    const num = id => +(w.document.getElementById(id)?.textContent||'').replace(/[^\d.-]/g,'');
    const paid = num('calcPaid'), rem = num('calcRemain'), fin = num('calcFinal');
    ok(w.document.getElementById('calcPaid') !== null, '18. يوجد صف مستقل لإجمالي المدفوع');
    ok(Math.abs(paid - (dep + extra)) < 1, `19. «إجمالي المدفوع» يعرض المدفوع فعلاً (${paid} = عربون ${dep} + إضافي ${extra})`);
    ok(Math.abs(rem - 1000) < 1, `20. «المتبقي على العميل» يعرض المتبقي فعلاً (${rem})`);
    ok(Math.abs(fin - (paid + rem)) < 1, `21. السعر النهائي = المدفوع + المتبقي (${fin} = ${paid} + ${rem})`);
    ok(paid !== rem, '22. لا يعرض الحقلان نفس القيمة (كشف الخلط بين المدفوع والمتبقي)');
    const labels = [...w.document.querySelectorAll('#saleForm .kv-money span')].map(x=>x.textContent.trim());
    ok(labels.includes('المتبقي على العميل'), '23. تسمية «المتبقي على العميل» موجودة');
    ok(!labels.some(l=>l==='المتبقي بعد الدفعة'), '24. أُزيلت التسمية القديمة الملتبسة');
    w.closeModal();
  } else { ok(false, '18-24. تعذر إيجاد حجز بعربون للاختبار'); }

  console.log(`\n===== النتيجة: ${pass} نجح / ${fail} فشل =====`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH:',e);process.exit(1);});
