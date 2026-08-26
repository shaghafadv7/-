// ============================================================
// اختبار واجهة النماذج (v1.9.2) — يمنع تكرار مشكلة اختفاء حقل
// رقم المرجع/الشيك عند اختيار طريقة الدفع.
// التشغيل: node scripts/test-ui-forms.js
// ============================================================
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const realHtml = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const dom = new JSDOM(realHtml, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;

window.fetch = async (url) => {
  const u = String(url);
  let body = {};
  if (u.includes('/api/units/')) body = { id: 1, status: 'available', unit_number: '108', price: 450000, sell_phase: 'off_plan', owner_name: '', seller_name: '', prev_price: null, reservation: null, reservation_payments: [] };
  else if (u.includes('/api/sales?')) body = [];
  else body = { site_name: 'x', company_name_ar: 'x', logo_url: '', primary_color: '#972B32', secondary_color: '#192E56', accent_color: '#B79552' };
  return { ok: true, status: 200, json: async () => body, blob: async () => new Blob() };
};
window.confirm = () => true; window.prompt = () => 'x'; window.open = () => null;
window.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
window.eval(fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8'));
const { document } = window;

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL:', n); } };
const pick = (selId, value) => {
  const el = document.getElementById(selId);
  if (!el) { fail++; console.log('  ✗ FAIL: select مفقود:', selId); return; }
  el.value = value;
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
};
// الفحص الجوهري: الحقل ظاهر + الـ input موجود فعليًا + التسمية صحيحة
const chk = (wrapId, labelId, inputId, expectedLabel) => {
  const wrap = document.getElementById(wrapId);
  const input = document.getElementById(inputId);
  const label = document.getElementById(labelId);
  return !!wrap && wrap.style.display === 'block' && !!input && label.textContent === expectedLabel;
};

(async () => {
  console.log('== اختبار حقول الدفع (شيك/حوالة/كاش) — كل النماذج ==');

  // 1) تسجيل دفعة
  window.paymentForm(1);
  pick('pfMethod', 'check');
  ok(chk('pfRefWrap', 'pfRefLabel', 'pfRefInput', 'رقم الشيك (مطلوب)'), '1. دفعة/شيك: ظاهر + input موجود');
  ok(document.getElementById('pfRefInput').required === true, '1b. input إلزامي');
  pick('pfMethod', 'bank_transfer');
  ok(chk('pfRefWrap', 'pfRefLabel', 'pfRefInput', 'رقم المرجع / رقم الحوالة (مطلوب)'), '1c. دفعة/حوالة: تسمية صحيحة + input باقٍ');
  pick('pfMethod', 'cash');
  ok(document.getElementById('pfRefWrap').style.display === 'none' && !!document.getElementById('pfRefInput'), '1d. كاش: يختفي والـ input محفوظ');

  // 2) دفع عمولة
  window.commissionPayForm(1, 5000);
  pick('cpMethod', 'check');
  ok(chk('cpRefWrap', 'cpRefLabel', 'cpRefInput', 'رقم الشيك (مطلوب)'), '2. عمولة/شيك');

  // 3) تسوية مبلغ
  window.adjustmentForm(1);
  pick('adjMethod', 'bank_transfer');
  ok(chk('adjRefWrap', 'adjRefLabel', 'adjRefInput', 'رقم المرجع / رقم الحوالة (مطلوب)'), '3. تسوية/حوالة');

  // 4) تسجيل تصفية
  window.settlementPayForm(1, 2, 'عميل', 1000);
  pick('stpMethod', 'check');
  ok(chk('stpRefWrap', 'stpRefLabel', 'stpRefInput', 'رقم الشيك (مطلوب)'), '4. تصفية/شيك');

  // 5) تصفية مسوق
  document.body.innerHTML += '<input class="ms-check" type="checkbox" checked value="1">';
  window._msId = 1; window._msRows = [{ sale_id: 1, remaining: 5000 }];
  window.marketerBatchForm();
  pick('msbMethod', 'bank_transfer');
  ok(chk('msbRefWrap', 'msbRefLabel', 'msbRefInput', 'رقم المرجع / رقم الحوالة (مطلوب)'), '5. تصفية مسوق/حوالة');

  // 6) حجز وحدة
  await window.reservationForm(1);
  document.getElementById('resDeposit').value = 5000;
  window.resPayToggle();
  pick('resPayMethod', 'check');
  ok(chk('resRefField', 'resRefLabel', 'resPayRef', 'رقم الشيك (مطلوب)'), '6. حجز/شيك');
  ok(document.getElementById('resCheckWrap').style.display === 'block', '6b. حقول الشيك تظهر');
  pick('resPayMethod', 'bank_transfer');
  ok(chk('resRefField', 'resRefLabel', 'resPayRef', 'رقم المرجع / رقم الحوالة (مطلوب)'), '6c. حجز/حوالة');

  // 7) تسجيل بيع
  window._saleDeposit = 0;
  await window.saleForm(1);
  pick('sfMethod', 'check');
  ok(chk('sfRefWrap', 'sfRefLabel', 'sfRef', 'رقم الشيك (مطلوب)'), '7. بيع/شيك');
  pick('sfMethod', 'bank_transfer');
  ok(chk('sfRefWrap', 'sfRefLabel', 'sfRef', 'رقم المرجع / رقم الحوالة (مطلوب)'), '7b. بيع/حوالة');

  // 8) دفعة حجز
  window.reservationPaymentForm(1, '108');
  pick('rpMethod', 'bank_transfer');
  ok(chk('rpRefWrap', 'rpRefLabel', 'rpRefNo', 'رقم المرجع / رقم الحوالة (مطلوب)'), '8. دفعة حجز/حوالة');

  // 9) تعديل صفقة (طريقة محفوظة check)
  window.api = async () => ([{ id: 1, sale_no: 'SAL-1', base_price: 450000, discount_type: 'none', discount_value: 0, final_price: 450000, payment_method: 'check', payment_ref: 'CH-9', contract_no: '', notes: '' }]);
  await window.editSaleForm(1);
  ok(document.getElementById('esRefWrap').style.display === 'block' && !!document.getElementById('esRefInput'), '9. تعديل صفقة (شيك محفوظ): ظاهر تلقائيًا');
  ok(document.getElementById('esRefInput').value === 'CH-9', '9b. القيمة المحفوظة تظهر');
  pick('esMethod', 'cash');
  ok(document.getElementById('esRefWrap').style.display === 'none' && !!document.getElementById('esRefInput'), '9c. كاش: يختفي والـ input محفوظ');

  // 10) الحماية الجذرية: استدعاء payRefToggle لا يمسح input داخل label أبدًا
  window.paymentForm(1);
  pick('pfMethod', 'check');
  ok(!!document.getElementById('pfRefInput'), '10. التسمية span لا تمسح الـ input (السبب الجذري)');

  console.log(`\n===== النتيجة: ${pass} نجح / ${fail} فشل =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
