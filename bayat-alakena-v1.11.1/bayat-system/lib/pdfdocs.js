// ============================================================
// مولدات مستندات بيات الأكنة (PDF) — هوية موحدة RTL
// ============================================================
const path = require('path');
const fs = require('fs');
const { ArabicPDF, fmtMoney } = require('./pdf');
const { SAR_MARK } = require('./riyal');

const S = {
  available: ['متاح', '#267456'], reserved: ['محجوز', '#a85f28'], contracted: ['متعاقد', '#315f91'],
  sold: ['مباع', '#982d36'], paid: ['مسدد بالكامل', '#267456'], unavailable: ['غير متاح', '#657080'],
  resale: ['إعادة بيع', '#6b4fa3'], owner: ['للمالك', '#5b7c3d'], investment: ['استثمار', '#315f91'],
  active: ['نشط', '#267456'], cancelled: ['ملغي', '#657080'], converted: ['محوّل لبيع', '#315f91'],
  expired: ['منتهي', '#a36c1f'], under_construction: ['تحت الإنشاء', '#a36c1f'], completed: ['مكتمل', '#267456'],
  paused: ['متوقف مؤقتًا', '#a36c1f'], unpaid: ['غير مدفوعة', '#982d36'], partial: ['مدفوعة جزئيًا', '#a85f28'],
  none: ['—', '#657080'], open: ['مفتوحة', '#982d36'], settled: ['تمت التصفية', '#267456'], resold: ['أعيد بيعها', '#315f91'], off_plan: ['تحت الإنشاء', '#a36c1f'],
};
const st = k => (S[k] || [k || '—', '#657080']);
const methodAr = { cash: 'كاش', bank_transfer: 'حوالة بنكية', check: 'شيك' };
const phaseAr = { off_plan: 'بيع تحت الإنشاء', completed: 'بيع بعد الاكتمال' };
const today = () => new Date().toISOString().slice(0, 10);
const hhmm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`; };
// تنسيق العملة المركزي: رقم منسق + رمز الريال السعودي الرسمي (يُرسم متجهيًا)
const money = n => fmtMoney(n) + ' ' + SAR_MARK;

const DOC_META = {
  search_results: { title: 'كشف الوحدات', fname: 'كشف_وحدات' },
  unit_offer: { title: 'عرض وحدة سكنية', fname: 'عرض_وحدة' },
  reservation: { title: 'سند حجز وحدة', fname: 'سند_حجز' },
  sale: { title: 'سند بيع وحدة', fname: 'سند_بيع' },
  sale_invoice: { title: 'فاتورة بيع عقارية', fname: 'فاتورة_بيع' },
  marketer_settlement_invoice: { title: 'فاتورة تصفية عمولات مسوق', fname: 'فاتورة_تصفية_مسوق' },
  cancelled_reservations_report: { title: 'تقرير الحجوزات الملغاة', fname: 'تقرير_الحجوزات_الملغاة' },
  refunds_report: { title: 'تقرير الاستردادات والخصومات', fname: 'تقرير_الاستردادات' },
  sales_report: { title: 'تقرير المبيعات', fname: 'تقرير_المبيعات' },
  payments_report: { title: 'تقرير الدفعات', fname: 'تقرير_الدفعات' },
  commissions_report: { title: 'تقرير عمولات المسوقين', fname: 'تقرير_العمولات' },
  marketers_report: { title: 'تقرير المسوقين', fname: 'تقرير_المسوقين' },
  financial_report: { title: 'التقرير المالي', fname: 'التقرير_المالي' },
  settlement_report: { title: 'تقرير تصفية مستحقات إعادة البيع', fname: 'تقرير_التصفية' },
  marketer_report: { title: 'تقرير المسوقين', fname: '' },
};

function filtersLine(filters = []) {
  return filters.filter(f => f && f[1]).map(f => `${f[0]}: ${f[1]}`).join('  •  ');
}

// ---------- كشف نتائج البحث ----------
function renderSearchResults(p, data) {
  if (data.filters && data.filters.length) p.noteBox('معايير البحث: ' + filtersLine(data.filters));
  p.space(4);
  p.table({
    cols: [
      { label: 'م', key: 'i', w: .045, align: 'center' },
      { label: 'المشروع', key: 'prj', w: .16 },
      { label: 'الوحدة', key: 'no', w: .09, align: 'center' },
      { label: 'الدور', key: 'fl', w: .11 },
      { label: 'النموذج', key: 'mo', w: .08, align: 'center' },
      { label: 'الغرف', key: 'rooms', w: .06, align: 'center' },
      { label: 'المساحة', key: 'area', w: .09, align: 'center' },
      { label: 'المرحلة', key: 'ph', w: .11, align: 'center' },
      { label: 'الحالة', key: 'stt', w: .1, align: 'center' },
      { label: 'السعر', key: 'price', w: .155, align: 'center' },
    ],
    rows: data.rows.map((r, i) => ({
      i: String(i + 1), prj: r.project_name, no: r.unit_number, fl: r.floor_name, mo: r.model_code || '—',
      rooms: String(r.display_rooms ?? r.rooms ?? '—'), area: (r.display_area ?? r.area ?? '—') + ' م²',
      ph: { t: phaseAr[r.sell_phase] || '—', c: st(r.sell_phase)[1] },
      stt: { t: st(r.status)[0], c: st(r.status)[1] },
      price: money(r.effective_price ?? r.price) ,
    })),
    totals: ['الإجمالي', `${data.total} وحدة`, '', '', '', '', '', '', '', ''],
    fontSize: 7.5,
  });
  p.contactBand();
}

// ---------- عرض وحدة ----------
function renderUnitOffer(p, data) {
  const u = data.unit;
  p.sectionTitle('معلومات الوحدة');
  p.kvGrid([
    ['المشروع', u.project_name], ['الدور', u.floor_name], ['رقم الوحدة', u.unit_number],
    ['النموذج', u.model_code ? `${u.model_code}${u.model_name ? ' — ' + u.model_name : ''}` : '—'],
    ['عدد الغرف', u.display_rooms ?? '—'], ['الحمامات', u.display_bathrooms ?? '—'],
    ['المساحة', (u.display_area ?? '—') + ' م²'], ['الواجهة', u.view || '—'],
    ['مرحلة البيع', phaseAr[u.sell_phase] || 'تحت الإنشاء'], ['الحالة', st(u.status)[0]],
  ]);
  p.space(6);
  p.sectionTitle('تفاصيل السعر');
  const base = u.sale ? u.sale.base_price : u.price;
  const disc = u.sale ? u.sale.discount_amount : 0;
  const discLabel = u.sale && u.sale.discount_type === 'percent' ? `${money(u.sale.discount_value)}% (${money(disc)})` : money(disc);
  const finalP = u.sale ? u.sale.final_price : u.price;
  p.kvGrid([
    ['السعر الأساسي (قبل الخصم)', money(base) ],
    ['قيمة الخصم', u.sale && disc > 0 ? discLabel : 'بدون خصم'],
    ['السعر النهائي بعد الخصم', money(finalP) ],
  ], { cols: 3, boxH: 50 });
  if (u.notes || (u.model_description)) {
    p.space(4);
    p.sectionTitle('أوصاف وملاحظات');
    if (u.model_description) p.text(u.model_description, { size: 9.5, color: '#4a5568' });
    if (u.notes) p.text(u.notes, { size: 9, color: this_muted() });
  }
  if (u.owner_name && u.status === 'resale') {
    p.space(2);
    p.noteBox('هذه الوحدة معروضة لإعادة البيع بعد اكتمال المشروع' + (u.resale_date ? ` بتاريخ ${u.resale_date}` : '') + '، والسعر أعلاه هو سعر الوحدة بعد اكتمال المشروع.');
  }
  p.space(6);
  p.noteBox('هذا العرض صادر من نظام ' + (p.settings.company_name_ar || '') + ' وهو ساري لمدة 7 أيام من تاريخ الإصدار ما لم يُذكر خلاف ذلك، ولا يُعد عقدًا أو التزامًا نهائيًا حتى توقيع عقد البيع المعتمد.');
  p.contactBand();
}
function this_muted() { return '#718096'; }

// ---------- سند حجز ----------
function renderReservation(p, data) {
  const r = data.reservation, u = data.unit;
  p.sectionTitle('بيانات الحجز');
  p.kvGrid([
    ['رقم الحجز', r.reservation_no], ['تاريخ الحجز', (r.start_at || '').slice(0, 10)], ['تاريخ الانتهاء', (r.expires_at || '').slice(0, 10)],
    ['اسم العميل', data.customer.name], ['جوال العميل', data.customer.phone], ['العربون', money(r.deposit || 0) ],
    ['الموظف المسؤول', r.employee_name || r.user_name || '—'], ['حالة الحجز', st(r.status)[0]], ['المشروع', u.project_name],
  ]);
  p.space(6);
  p.sectionTitle('بيانات الوحدة');
  p.kvGrid([
    ['رقم الوحدة', u.unit_number], ['الدور', u.floor_name], ['النموذج', u.model_code || '—'],
    ['عدد الغرف', u.display_rooms ?? '—'], ['المساحة', (u.display_area ?? '—') + ' م²'],
    ['السعر المعروض', money(u.price) ],
  ]);
  p.space(6);
  p.sectionTitle('شروط وأحكام الحجز');
  p.text(`1. يلتزم العميل بسداد العربون الموضح أعلاه عند إصدار هذا السند، ويُخصم من قيمة الوحدة عند توقيع عقد البيع النهائي.`, { size: 9 });
  p.text(`2. الحجز ساري حتى تاريخ الانتهاء الموضح أعلاه، وبعد انتهائه يحق للشركة عرض الوحدة لعملاء آخرين دون إشعار مسبق.`, { size: 9 });
  p.text(`3. لا يُعد هذا السند عقد بيع نهائيًا، وإنما يوثق أولوية العميل في الوحدة المحددة خلال مدة الحجز.`, { size: 9 });
  p.text(`4. في حال إلغاء الحجز من قبل العميل تطبق سياسة الشركة المعتمدة بشأن استرداد العربون.`, { size: 9 });
  p.contactBand();
}

// ---------- سند بيع ----------
function renderSale(p, data) {
  const s = data.sale, u = data.unit, fin = data.finance;
  p.sectionTitle('بيانات الوحدة');
  p.kvGrid([
    ['المشروع', u.project_name], ['رقم الوحدة', u.unit_number], ['الدور', u.floor_name],
    ['النموذج', u.model_code || '—'], ['عدد الغرف', u.display_rooms ?? '—'], ['المساحة', (u.display_area ?? '—') + ' م²'],
  ]);
  p.space(4);
  p.sectionTitle('بيانات البيع');
  p.kvGrid([
    ['رقم الفاتورة', s.invoice_no || '—'], ['رقم البيع', s.sale_no], ['تاريخ البيع', s.sale_date],
    ['رقم العقد', s.contract_no || '—'], ['اسم العميل (المالك الجديد)', data.customer.name], ['جوال العميل', data.customer.phone],
    ['الجهة المستفيدة', data.beneficiary?.name || s.beneficiary_name || (s.is_resale ? 'العميل / المستثمر' : 'الشركة')], ['الحساب المستفيد', data.beneficiary?.account || (s.is_resale ? 'حساب المستثمر' : 'حساب الشركة')],
    ['نوع العملية', s.is_resale ? 'إعادة بيع بعد اكتمال المشروع' : phaseAr[s.sale_phase] || '—'],
    ['طريقة الدفع', methodAr[s.payment_method] || 'كاش'], ['مرجع العملية', s.payment_ref || '—'],
    ...(s.seller_name ? [['المالك البائع', s.seller_name]] : []),
    ...(s.prev_owner_name ? [['المالك السابق', s.prev_owner_name], ['سعر الشراء الأصلي', money(s.purchase_price || 0)], ['تاريخ الشراء الأصلي', s.purchase_date || '—']] : []),
    ...(s.investor_name ? [['المستثمر', s.investor_name]] : []),
  ]);
  p.space(4);
  p.sectionTitle('التفاصيل المالية');
  p.table({
    cols: [
      { label: 'البيان', key: 'k', w: .4 },
      { label: 'التفصيل', key: 'd', w: .3, align: 'center' },
      { label: 'القيمة', key: 'v', w: .3, align: 'center' },
    ],
    rows: [
      { k: 'السعر الأساسي (قبل الخصم)', d: '—', v: money(s.base_price || s.list_price)  },
      {
        k: 'قيمة الخصم', d: s.discount_type === 'percent' ? `${s.discount_value}%` : s.discount_type === 'amount' ? 'مبلغ ثابت' : '—',
        v: money(s.discount_amount || 0) ,
      },
      { k: 'السعر النهائي بعد الخصم', d: '—', v: { t: money(s.final_price) , c: '#192E56' } },
      ...(data.deposit && data.deposit.total > 0 ? [
        { k: 'المدفوع سابقًا — العربون (دفعة حجز أولى من قيمة البيع)', d: data.deposit.count + ' قيد', v: { t: money(data.deposit.total), c: '#315f91' } },
        { k: 'رقم قيد الحجز', d: '—', v: data.deposit.payments.map(x => x.payment_no).join(' / ') },
        { k: 'تاريخ الحجز / الدفع', d: '—', v: data.deposit.payments.map(x => x.pay_date).join(' / ') },
        { k: 'طريقة دفع الحجز', d: '—', v: data.deposit.payments.map(x => (methodAr[x.method] || x.method) + (x.ref_no ? ' (' + x.ref_no + ')' : '')).join(' / ') },
      ] : []),
      { k: 'إجمالي المدفوع (العربون + الدفعات)', d: methodAr[s.payment_method] || '—', v: money(s.paid_amount)  },
      { k: 'المبلغ المتبقي', d: '—', v: { t: money(s.remaining_amount) , c: '#982d36' } },
      ...(s.marketer_name && (s.commission_total || 0) > 0 ? [{ k: 'عمولة المسوق: ' + s.marketer_name, d: s.commission_type === 'percent' ? s.commission_value + '%' : 'مبلغ ثابت', v: money(s.commission_total) }] : []),
    ],
    fontSize: 8.5,
  });
  if (data.discounts && data.discounts.length) {
    p.space(6);
    p.sectionTitle('بنود الخصومات');
    p.table({
      cols: [
        { label: 'النوع', key: 't', w: .12, align: 'center' },
        { label: 'المبلغ', key: 'a', w: .16, align: 'center' },
        { label: 'السبب', key: 'r', w: .3 },
        { label: 'اعتمده', key: 'ap', w: .2 },
        { label: 'التاريخ', key: 'd', w: .22, align: 'center' },
      ],
      rows: data.discounts.map(d => ({ t: d.type === 'percent' ? d.value + '%' : 'مبلغ ثابت', a: money(d.amount), r: d.reason || '—', ap: d.approved_by || '—', d: d.discount_date || '—' })),
      totals: ['الإجمالي', money(fin ? fin.discounts : (s.discount_amount || 0)), '', '', ''],
      fontSize: 8,
    });
  }
  if (data.expenses && data.expenses.length) {
    p.space(6);
    p.sectionTitle('المصروفات');
    p.table({
      cols: [
        { label: 'البيان', key: 't', w: .34 },
        { label: 'المبلغ', key: 'a', w: .18, align: 'center' },
        { label: 'التاريخ', key: 'd', w: .18, align: 'center' },
        { label: 'ملاحظات', key: 'n', w: .3 },
      ],
      rows: data.expenses.map(e => ({ t: e.title, a: money(e.amount), d: e.expense_date || '—', n: e.notes || '—' })),
      totals: ['الإجمالي', money(fin ? fin.expenses : 0), '', ''],
      fontSize: 8,
    });
  }
  if (fin) {
    p.space(6);
    p.sectionTitle('الإيرادات والتكاليف والأرباح المحققة' + (s.investor_name ? ' — المستثمر: ' + s.investor_name : ''));
    p.table({
      cols: [
        { label: 'البيان', key: 'k', w: .4 },
        { label: 'القيمة', key: 'v', w: .35, align: 'center' },
        { label: 'ملاحظة', key: 'n', w: .25, align: 'center' },
      ],
      rows: [
        { k: 'قيمة البيع النهائي (بعد الخصومات)', v: money(fin.final), n: fin.resale_price != null ? 'سعر إعادة البيع' : 'قيمة تعاقدية' },
        { k: 'الإيراد المحقق (المحصل فعليًا)', v: money(fin.realized_revenue ?? fin.paid), n: 'أساس الربح' },
        { k: 'الذمم غير المحصلة', v: money(fin.receivable ?? Math.max(0,fin.remaining)), n: 'لا تدخل في الربح' },
        { k: 'تكلفة العقار (رأس المال)', v: money(fin.property_cost ?? fin.purchase_cost), n: '—' },
        { k: 'إجمالي المصروفات الأخرى', v: money(fin.expenses), n: '—' },
        { k: 'عمولة المسوق (مصروف بيع)', v: money(fin.commission), n: '—' },
        { k: 'الربح الإجمالي (المحصل − تكلفة العقار)', v: money(fin.gross_profit), n: fin.gross_profit_pct != null ? fin.gross_profit_pct + '%' : '—' },
        { k: 'إجمالي التكاليف', v: money(fin.total_costs ?? ((fin.purchase_cost||0)+fin.expenses+fin.commission)), n: '—' },
        { k: 'صافي الربح الحقيقي', v: { t: money(fin.net_profit), c: fin.net_profit >= 0 ? '#1e6b4f' : '#982d36' }, n: fin.net_profit_pct != null ? fin.net_profit_pct + '%' : 'على أساس التحصيل' },
        { k: fin.client_state === 'due_to_client' ? 'رصيد مستحق للعميل' : (fin.client_state === 'settled' ? 'حالة السداد' : 'المتبقي على العميل'), v: fin.client_state === 'settled' ? 'مسدد بالكامل' : money(Math.abs(fin.remaining)), n: '—' },
      ],
      fontSize: 8.5,
    });
  }
  if (data.prevSale && fin) {
    p.space(6);
    p.sectionTitle('الملخص المالي — المالك السابق والمالك الجديد');
    const pFin = fin.prev_owner_finance;
    const nFin = fin.new_owner_finance;
    const prevPaid = pFin ? pFin.paid : (data.prevSale.paid_amount || 0);
    const prevFinal = pFin ? pFin.final : (data.prevSale.final_price || 0);
    const prevRem = pFin ? pFin.remaining : (prevFinal - prevPaid);
    const newPaid = nFin ? nFin.paid : s.paid_amount;
    const newRem = nFin ? nFin.remaining : s.remaining_amount;
    p.table({
      cols: [
        { label: 'الطرف', key: 'who', w: .24 },
        { label: 'قيمة العقد', key: 'val', w: .18, align: 'center' },
        { label: 'المدفوع', key: 'paid', w: .18, align: 'center' },
        { label: 'المتبقي', key: 'rem', w: .2, align: 'center' },
        { label: 'الحالة', key: 'st', w: .2, align: 'center' },
      ],
      rows: [
        { who: 'المالك السابق (الشراء الأول)', val: money(prevFinal), paid: { t: money(prevPaid), c: '#1e6b4f' }, rem: { t: money(prevRem), c: prevRem > 0 ? '#982d36' : '#1e6b4f' }, st: { t: prevRem > 0 ? 'مستحق على المالك السابق' : 'مسدد', c: prevRem > 0 ? '#a85f28' : '#1e6b4f' } },
        { who: 'المالك الجديد (إعادة البيع)', val: money(s.final_price), paid: { t: money(newPaid), c: '#1e6b4f' }, rem: { t: money(newRem), c: newRem > 0 ? '#982d36' : '#1e6b4f' }, st: { t: newRem > 0 ? 'مستحق على المالك الجديد' : (newRem < 0 ? 'رصيد مستحق للمالك الجديد' : 'مسدد بالكامل'), c: newRem > 0 ? '#a85f28' : '#315f91' } },
      ],
      fontSize: 8,
    });
    p.space(2);
    p.noteBox('المتبقي على المالك الجديد = قيمة إعادة البيع − المدفوع من المالك الجديد. تُحدَّث هذه الأرقام تلقائيًا عند أي دفعة أو خصم على أي من الصفقتين.');
  }
  if (data.reservation_payments && data.reservation_payments.length) {
    p.space(6);
    p.sectionTitle('دفعات الحجز (العربون) — دفعة أولى من قيمة البيع');
    p.table({
      cols: [
        { label: 'رقم القيد', key: 'no', w: .2, align: 'center' },
        { label: 'التاريخ', key: 'dt', w: .14, align: 'center' },
        { label: 'طريقة الدفع', key: 'm', w: .14, align: 'center' },
        { label: 'المرجع / الشيك', key: 'ref', w: .18, align: 'center' },
        { label: 'البنك / المستلم', key: 'bank', w: .16, align: 'center' },
        { label: 'المبلغ', key: 'amt', w: .18, align: 'center' },
      ],
      rows: data.reservation_payments.map(x => ({
        no: x.payment_no, dt: x.pay_date, m: methodAr[x.method] || x.method,
        ref: x.ref_no || '—', bank: (x.bank || x.received_by) || '—', amt: money(x.amount),
      })),
      totals: ['', '', '', '', 'الإجمالي', money(data.reservation_payments.reduce((a, x) => a + x.amount, 0))],
      fontSize: 8,
    });
  }
  if (data.payments && data.payments.length) {
    p.space(6);
    p.sectionTitle('سجل الدفعات المسجلة');
    p.table({
      cols: [
        { label: 'م', key: 'i', w: .06, align: 'center' },
        { label: 'رقم الدفعة', key: 'no', w: .18, align: 'center' },
        { label: 'التاريخ', key: 'dt', w: .14, align: 'center' },
        { label: 'طريقة الدفع', key: 'm', w: .16, align: 'center' },
        { label: 'المرجع', key: 'ref', w: .2, align: 'center' },
        { label: 'المبلغ', key: 'amt', w: .26, align: 'center' },
      ],
      rows: data.payments.map((x, i) => ({
        i: String(i + 1), no: x.payment_no, dt: x.pay_date, m: methodAr[x.method] || x.method,
        ref: x.ref_no || '—', amt: money(x.amount) ,
      })),
      totals: ['', '', '', '', 'الإجمالي', money(s.paid_amount) ],
      fontSize: 8,
    });
  }
  if (data.movements && data.movements.length) {
    p.space(6); p.sectionTitle('السجل المالي الكامل — الرصيد قبل وبعد كل حركة');
    p.table({cols:[
      {label:'التاريخ',key:'dt',w:.11,align:'center'},{label:'المرجع',key:'ref',w:.12,align:'center'},
      {label:'الحركة',key:'title',w:.19},{label:'المستخدم',key:'user',w:.13},
      {label:'القيمة',key:'amt',w:.13,align:'center'},{label:'قبل',key:'before',w:.12,align:'center'},{label:'بعد',key:'after',w:.12,align:'center'},{label:'الحالة',key:'status',w:.08,align:'center'}
    ],rows:data.movements.map(m=>({dt:m.date||'—',ref:m.reference||'—',title:m.title,user:m.user||'النظام',amt:money(m.amount||0),before:money(m.balance_before||0),after:money(m.balance_after||0),status:m.status==='cancelled'?'ملغي':'نشط'})),fontSize:6.5});
  }
  if (data.settlement) { p.space(5); p.noteBox(`التصفية المرتبطة: ${data.settlement.invoice_no || ''} — ${data.settlement.report_no} — الحالة: ${st(data.settlement.status)[0]}`); }
  p.space(14);
  const d = p.doc;
  // توقيعات
  d.strokeColor('#c9cedb').lineWidth(.8);
  d.moveTo(420, p.y + 22).lineTo(545, p.y + 22).stroke();
  d.moveTo(75, p.y + 22).lineTo(200, p.y + 22).stroke();
  p._drawLineRight(['توقيع الشركة'], 545, p.y + 26, 125, '#1d2a42', true, 9);
  p._drawLineRight(['توقيع العميل'], 200, p.y + 26, 125, '#1d2a42', true, 9);
  p.y += 48;
  p.noteBox('هذا السند صادر داخليًا من نظام ' + (p.settings.company_name_ar || '') + ' لتوثيق عملية البيع، وتراعي التفاصيل أعلاه الخصم وطريقة الدفع والمدفوع والمتبقي لحظة الإصدار.');
  p.contactBand();
}

// ---------- تقرير المبيعات ----------
function renderSalesReport(p, data) {
  if (data.filters && data.filters.length) p.noteBox('نطاق التقرير: ' + filtersLine(data.filters));
  p.space(4);
  p.table({
    cols: [
      { label: 'م', key: 'i', w: .04, align: 'center' },
      { label: 'رقم البيع', key: 'no', w: .1, align: 'center' },
      { label: 'التاريخ', key: 'dt', w: .08, align: 'center' },
      { label: 'المشروع / الوحدة', key: 'pu', w: .17 },
      { label: 'العميل', key: 'cu', w: .11 },
      { label: 'المرحلة', key: 'ph', w: .07, align: 'center' },
      { label: 'قبل الخصم', key: 'base', w: .09, align: 'center' },
      { label: 'الخصم', key: 'disc', w: .08, align: 'center' },
      { label: 'النهائي', key: 'fin', w: .09, align: 'center' },
      { label: 'المدفوع', key: 'paid', w: .085, align: 'center' },
      { label: 'المتبقي', key: 'rem', w: .085, align: 'center' },
    ],
    rows: data.rows.map((s, i) => ({
      i: String(i + 1), no: s.sale_no, dt: s.sale_date, pu: `${s.project_name} — ${s.unit_number}`,
      cu: s.customer_name, ph: { t: s.is_resale ? 'إعادة بيع' : (s.sale_phase === 'completed' ? 'مكتمل' : 'إنشاء'), c: '#657080' },
      base: money(s.base_price || s.list_price), disc: money(s.discount_amount || 0), fin: money(s.final_price),
      paid: money(s.paid_amount), rem: money(s.remaining_amount),
    })),
    totals: ['الإجمالي', '', `${data.rows.length} عملية`, '', '', '',
      money(data.totals.base), money(data.totals.discount), money(data.totals.final),
      money(data.totals.paid), money(data.totals.remaining)],
    fontSize: 7,
  });
}

// ---------- تقرير الدفعات ----------
function renderPaymentsReport(p, data) {
  if (data.filters && data.filters.length) p.noteBox('نطاق التقرير: ' + filtersLine(data.filters));
  p.space(4);
  p.table({
    cols: [
      { label: 'م', key: 'i', w: .045, align: 'center' },
      { label: 'رقم الدفعة', key: 'no', w: .12, align: 'center' },
      { label: 'التاريخ', key: 'dt', w: .1, align: 'center' },
      { label: 'رقم البيع', key: 'sn', w: .12, align: 'center' },
      { label: 'المشروع / الوحدة', key: 'pu', w: .18 },
      { label: 'العميل', key: 'cu', w: .12 },
      { label: 'الطريقة', key: 'm', w: .09, align: 'center' },
      { label: 'المرجع', key: 'ref', w: .12, align: 'center' },
      { label: 'المبلغ', key: 'amt', w: .105, align: 'center' },
    ],
    rows: data.rows.map((x, i) => ({
      i: String(i + 1), no: x.payment_no, dt: x.pay_date, sn: x.sale_no, pu: `${x.project_name} — ${x.unit_number}`,
      cu: x.customer_name || '—', m: methodAr[x.method] || x.method, ref: x.ref_no || '—', amt: money(x.amount) ,
    })),
    totals: ['الإجمالي', '', `${data.rows.length} دفعة`, '', '', '', '', '', money(data.totals.amount) ],
    fontSize: 7,
  });
}

// ---------- تقرير العمولات ----------
function renderCommissionsReport(p, data) {
  if (data.filters && data.filters.length) p.noteBox('نطاق التقرير: ' + filtersLine(data.filters));
  p.space(4);
  p.sectionTitle('عمولات الصفقات');
  p.table({
    cols: [
      { label: 'م', key: 'i', w: .04, align: 'center' },
      { label: 'المسوق', key: 'mk', w: .13 },
      { label: 'رقم البيع', key: 'no', w: .11, align: 'center' },
      { label: 'المشروع / الوحدة', key: 'pu', w: .17 },
      { label: 'قيمة البيع', key: 'fin', w: .1, align: 'center' },
      { label: 'العمولة', key: 'cm', w: .1, align: 'center' },
      { label: 'المدفوع', key: 'pd', w: .1, align: 'center' },
      { label: 'المتبقي', key: 'rm', w: .1, align: 'center' },
      { label: 'الحالة', key: 'stt', w: .15, align: 'center' },
    ],
    rows: data.rows.map((x, i) => ({
      i: String(i + 1), mk: x.marketer_name, no: x.sale_no, pu: `${x.project_name} — ${x.unit_number}`,
      fin: money(x.final_price), cm: money(x.commission_total), pd: money(x.commission_paid),
      rm: money(Math.max(0, x.commission_total - x.commission_paid)),
      stt: { t: st(x.commission_status)[0], c: st(x.commission_status)[1] },
    })),
    totals: ['الإجمالي', '', '', '', '', money(data.totals.total), money(data.totals.paid), money(data.totals.remaining), ''],
    fontSize: 7,
  });
  if (data.marketers && data.marketers.length) {
    p.space(8);
    p.sectionTitle('ملخص المسوقين');
    p.table({
      cols: [
        { label: 'م', key: 'i', w: .05, align: 'center' },
        { label: 'المسوق', key: 'n', w: .25 },
        { label: 'عدد الوحدات', key: 'u', w: .14, align: 'center' },
        { label: 'إجمالي المبيعات', key: 's', w: .15, align: 'center' },
        { label: 'العمولات المستحقة', key: 'c', w: .15, align: 'center' },
        { label: 'المدفوعة', key: 'p', w: .13, align: 'center' },
        { label: 'المتبقية', key: 'r', w: .13, align: 'center' },
      ],
      rows: data.marketers.map((m, i) => ({
        i: String(i + 1), n: m.name, u: String(m.units_count), s: money(m.sales_total),
        c: money(m.commission_total), p: money(m.commission_paid), r: money(Math.max(0, m.commission_total - m.commission_paid)),
      })),
      fontSize: 7.5,
    });
  }
}

// ---------- تقرير المسوقين ----------
function renderMarketersReport(p, data) {
  p.table({
    cols: [
      { label: 'م', key: 'i', w: .04, align: 'center' },
      { label: 'الكود', key: 'c', w: .09, align: 'center' },
      { label: 'الاسم', key: 'n', w: .16 },
      { label: 'الجوال', key: 'ph', w: .12, align: 'center' },
      { label: 'الوحدات', key: 'u', w: .08, align: 'center' },
      { label: 'إجمالي المبيعات', key: 's', w: .13, align: 'center' },
      { label: 'العمولات المستحقة', key: 'cm', w: .13, align: 'center' },
      { label: 'المدفوعة', key: 'pd', w: .12, align: 'center' },
      { label: 'المتبقية', key: 'rm', w: .13, align: 'center' },
    ],
    rows: data.rows.map((m, i) => ({
      i: String(i + 1), c: m.code, n: m.name, ph: m.phone || '—', u: String(m.units_count || 0),
      s: money(m.sales_total || 0), cm: money(m.commission_total || 0), pd: money(m.commission_paid || 0),
      rm: money(Math.max(0, (m.commission_total || 0) - (m.commission_paid || 0))),
    })),
    totals: ['الإجمالي', '', `${data.rows.length} مسوق`, '', String(data.rows.reduce((a, m) => a + (m.units_count || 0), 0)),
      money(data.rows.reduce((a, m) => a + (m.sales_total || 0), 0)),
      money(data.rows.reduce((a, m) => a + (m.commission_total || 0), 0)),
      money(data.rows.reduce((a, m) => a + (m.commission_paid || 0), 0)),
      money(data.rows.reduce((a, m) => a + Math.max(0, (m.commission_total || 0) - (m.commission_paid || 0)), 0))],
    fontSize: 7.5,
  });
}

// ---------- التقرير المالي ----------
function renderFinancialReport(p, data) {
  const s = data.summary;
  if (data.filters && data.filters.length) p.noteBox('نطاق التقرير: ' + filtersLine(data.filters));
  p.space(4);
  p.sectionTitle('المؤشرات الرئيسية');
  p.bigNumber('إجمالي المبيعات', s.final_total, 'ريال سعودي');
  p.bigNumber('إجمالي الخصومات', s.discount_total, 'ريال سعودي');
  p.bigNumber('إجمالي المحصل', s.paid_total, 'ريال سعودي');
  p.bigNumber('إجمالي المتبقي', s.remaining_total, 'ريال سعودي');
  p.bigNumber('تكلفة العقارات', s.property_cost || 0, 'ريال سعودي');
  p.bigNumber('المصروفات الأخرى', s.expenses_total || 0, 'ريال سعودي');
  p.bigNumber('عمولات المسوقين (مصروف بيع)', s.commission_due, 'ريال سعودي');
  p.bigNumber('إجمالي التكاليف', s.total_costs || 0, 'ريال سعودي');
  p.bigNumber('صافي الربح الحقيقي', s.net_profit || 0, 'ريال سعودي');
  p.noteBox('صافي الربح = المبالغ المحصلة فعليًا − تكلفة العقار − عمولات المسوقين − المصروفات الأخرى. المبالغ المتبقية لا تدخل في الربح حتى تحصيلها.');
  p.space(4);
  p.sectionTitle('التفصيل الشهري');
  p.table({
    cols: [
      { label: 'الشهر', key: 'm', w: .14, align: 'center' },
      { label: 'عدد البيوع', key: 'c', w: .12, align: 'center' },
      { label: 'المبيعات (نهائي)', key: 'f', w: .16, align: 'center' },
      { label: 'الخصومات', key: 'd', w: .13, align: 'center' },
      { label: 'المحصل', key: 'p', w: .15, align: 'center' },
      { label: 'العمولات', key: 'cm', w: .15, align: 'center' },
      { label: 'دفعات المسوقين', key: 'mp', w: .15, align: 'center' },
    ],
    rows: data.months.map(x => ({
      m: x.month, c: String(x.sales_count), f: money(x.final_total), d: money(x.discount_total),
      p: money(x.paid_total), cm: money(x.commission_total), mp: money(x.marketer_paid),
    })),
    totals: ['الإجمالي', String(data.months.reduce((a, x) => a + x.sales_count, 0)),
      money(data.months.reduce((a, x) => a + x.final_total, 0)),
      money(data.months.reduce((a, x) => a + x.discount_total, 0)),
      money(data.months.reduce((a, x) => a + x.paid_total, 0)),
      money(data.months.reduce((a, x) => a + x.commission_total, 0)),
      money(data.months.reduce((a, x) => a + x.marketer_paid, 0))],
    fontSize: 7.5,
  });
  p.space(8);
  p.sectionTitle('العمولات والمسوقون');
  p.bigNumber('عمولات مدفوعة', s.commission_paid, 'ريال سعودي');
  p.bigNumber('عمولات متبقية', Math.max(0, s.commission_due - s.commission_paid), 'ريال سعودي');
  p.bigNumber('عدد المسوقين', s.marketers_count, 'مسوق');
  p.bigNumber('وحدات مباعة', s.sold_units, 'وحدة');
  p.bigNumber('وحدات متاحة', s.available_units, 'وحدة');
}


// ---------- تقرير المسوقين (إجمالي + تفصيلي) ----------
function renderMarketerReport(p, data) {
  const single = data.marketer_name;
  p.sectionTitle(single ? `ملخص المسوق: ${data.marketer_name}` : 'الملخص الإجمالي للمسوقين');
  if (single) {
    p.kvGrid([
      ['اسم المسوق', data.marketer_name], ['رقم الهاتف', data.marketer_phone || '—'], ['الفترة', data.period],
      ['عدد العمليات', String(data.totals.ops)], ['إجمالي المبيعات', money(data.totals.sales_total) ],
      ['إجمالي العمولات المستحقة', money(data.totals.commission_total) ],
      ['المدفوع للمسوق', money(data.totals.commission_paid) ],
      ['المتبقي للمسوق', money(data.totals.commission_due) ], ['حالة العمولات', data.summary[0] ? st(data.summary[0].commission_status)[0] : '—'],
    ]);
  } else if (data.summary && data.summary.length) {
    p.table({
      cols: [
        { label: 'المسوق', key: 'n', w: .18 },
        { label: 'الهاتف', key: 'ph', w: .12, align: 'center' },
        { label: 'العمليات', key: 'op', w: .08, align: 'center' },
        { label: 'الوحدات', key: 'un', w: .08, align: 'center' },
        { label: 'إجمالي المبيعات', key: 'sa', w: .14, align: 'center' },
        { label: 'عمولات مستحقة', key: 'ct', w: .13, align: 'center' },
        { label: 'مدفوعة', key: 'cp', w: .12, align: 'center' },
        { label: 'متبقية', key: 'cr', w: .13, align: 'center' },
      ],
      rows: data.summary.map(m => ({
        n: m.marketer_name + (m.marketer_code ? ` (${m.marketer_code})` : ''), ph: m.phone || '—',
        op: String(m.ops), un: String(m.units), sa: money(m.sales_total), ct: money(m.commission_total),
        cp: money(m.commission_paid), cr: money(m.commission_due),
      })),
      totals: ['الإجمالي', '', String(data.totals.ops), '', money(data.totals.sales_total),
        money(data.totals.commission_total), money(data.totals.commission_paid), money(data.totals.commission_due)],
      fontSize: 8,
    });
  } else {
    p.noteBox('لا توجد عمليات مسوقين ضمن الفلاتر والفترة المحددة.');
  }
  if (data.filters && data.filters.length) { p.space(4); p.noteBox('نطاق التقرير: ' + filtersLine(data.filters)); }
  if (data.rows && data.rows.length) {
    p.space(6);
    p.sectionTitle(single ? 'عمليات المسوق بالتفصيل' : 'جميع عمليات المسوقين بالتفصيل');
    p.table({
      cols: [
        { label: 'رقم البيع', key: 'no', w: .07, align: 'center' },
        { label: 'تاريخ الحجز', key: 'rd', w: .07, align: 'center' },
        { label: 'تاريخ البيع', key: 'sd', w: .07, align: 'center' },
        { label: 'المشروع / الوحدة', key: 'pu', w: .13 },
        { label: 'العميل', key: 'cu', w: .08 },
        ...(single ? [] : [{ label: 'المسوق', key: 'mk', w: .08 }]),
        { label: 'سعر الوحدة', key: 'bp', w: .08, align: 'center' },
        { label: 'الخصم', key: 'dc', w: .065, align: 'center' },
        { label: 'النهائي', key: 'fp', w: .08, align: 'center' },
        { label: 'الدفع', key: 'pm', w: .055, align: 'center' },
        { label: 'مدفوع العميل', key: 'pd', w: .075, align: 'center' },
        { label: 'متبقي العميل', key: 'rm', w: .07, align: 'center' },
        { label: 'النسبة', key: 'pc', w: .05, align: 'center' },
        { label: 'العمولة', key: 'cm', w: .07, align: 'center' },
        { label: 'مدفوع للمسوق', key: 'mp', w: .075, align: 'center' },
        { label: 'متبقي المسوق', key: 'mr', w: .075, align: 'center' },
        { label: 'حالة العمولة', key: 'cs', w: .08, align: 'center' },
      ],
      rows: data.rows.map(r => ({
        no: r.sale_no, rd: r.reserve_date ? String(r.reserve_date).slice(0, 10) : '—', sd: r.sale_date,
        pu: `${r.project_name} — ${r.unit_number}`, cu: r.customer_name,
        ...(single ? {} : { mk: r.marketer_name }),
        bp: money(r.base_price), dc: money(r.discount_amount || 0), fp: money(r.final_price),
        pm: methodAr[r.payment_method] || r.payment_method, pd: money(r.paid_amount), rm: money(r.remaining_amount),
        pc: r.commission_type === 'percent' ? r.commission_value + '%' : '—',
        cm: money(r.commission_total || 0), mp: money(r.commission_paid || 0),
        mr: money(Math.max(0, (r.commission_total || 0) - (r.commission_paid || 0))),
        cs: { t: st(r.commission_status)[0], c: st(r.commission_status)[1] },
      })),
      fontSize: 6.2,
    });
  }
  p.contactBand();
}


// ---------- تقرير تصفية مستحقات إعادة البيع ----------
function renderSettlementReport(p, data) {
  p.sectionTitle('بيانات التقرير والعملية الأصلية');
  p.kvGrid([
    ['رقم فاتورة التصفية', data.invoice_no || '—'], ['رقم التقرير الفريد', data.report_no], ['حالة التقرير', st(data.status)[0] || data.status], ['تاريخ الإنشاء', String(data.created_at || '').slice(0, 10)],
    ['رقم البيع الثاني', data.sale_no], ['تاريخ البيع', data.sale_date], ['المشروع / الوحدة', `${data.project_name} — ${data.unit_number}`],
    ['المالك السابق', data.prev_owner_name || data.seller_name || '—'], ['المالك الجديد', data.new_owner_name], ['المسوق', data.marketer_name || '—'],
  ]);
  p.space(5);
  p.sectionTitle('الملخص المالي للبيع الثاني');
  p.kvGrid([
    ['قيمة البيع قبل الخصم', money(data.base_price || data.final_price)], ['الخصومات', money(data.discount_amount || 0)], ['صافي قيمة البيع', money(data.final_price)],
    ['مدفوع المالك الجديد', money(data.paid_amount)], ['متبقي المالك الجديد', money(data.remaining_amount)], ['عمولة المسوق', money(data.commission_total || 0)],
  ]);
  p.space(6);
  p.sectionTitle('تصفية الشركة والعملاء والمساهمين والمسوق');
  p.table({
    cols: [
      { label: 'الطرف', key: 'party', w: .17 }, { label: 'نوع المستحق', key: 'dir', w: .11, align: 'center' },
      { label: 'الإجمالي', key: 'gross', w: .12, align: 'center' }, { label: 'الخصومات/الاستقطاعات', key: 'ded', w: .14, align: 'center' },
      { label: 'صافي المستحق', key: 'net', w: .13, align: 'center' }, { label: 'تمت تصفيته', key: 'paid', w: .11, align: 'center' },
      { label: 'المتبقي', key: 'rem', w: .11, align: 'center' }, { label: 'الحالة', key: 'status', w: .11, align: 'center' },
    ],
    rows: data.entries.map(e => ({ party: e.party_name, dir: e.direction === 'payable' ? 'مستحق للطرف' : 'مستحق للشركة', gross: money(e.gross_amount), ded: money(e.deductions), net: money(e.net_amount), paid: money(e.settled_amount), rem: money(e.remaining_amount), status: { t: st(e.status)[0] || e.status, c: e.status === 'settled' ? '#267456' : e.status === 'partial' ? '#a85f28' : '#982d36' } })),
    totals: ['الإجمالي', '', money(data.entries.reduce((a,e)=>a+e.gross_amount,0)), money(data.entries.reduce((a,e)=>a+e.deductions,0)), money(data.totals.net), money(data.totals.paid), money(data.totals.remaining), ''],
    fontSize: 7.2,
  });
  p.space(6);
  p.sectionTitle('نشاط التصفية الكامل');
  if (data.activity && data.activity.length) p.table({
    cols: [
      { label: 'التاريخ', key: 'date', w: .12, align: 'center' }, { label: 'رقم الحركة', key: 'no', w: .14, align: 'center' },
      { label: 'العملية', key: 'op', w: .14 }, { label: 'الطرف', key: 'party', w: .14 },
      { label: 'المبلغ', key: 'amount', w: .11, align: 'center' }, { label: 'المدفوع', key: 'paid', w: .11, align: 'center' },
      { label: 'المتبقي', key: 'rem', w: .11, align: 'center' }, { label: 'الحالة', key: 'status', w: .13, align: 'center' },
    ],
    rows: data.activity.map(a => ({ date: String(a.date || '').slice(0, 10), no: a.number, op: a.operation, party: a.party, amount: money(a.amount), paid: money(a.paid || 0), rem: money(a.remaining || 0), status: a.status === 'cancelled' ? 'ملغي' : st(a.settlement_status)[0] })),
    fontSize: 7.5,
  }); else p.noteBox('لا توجد حركات تصفية مسجلة حتى تاريخ إصدار التقرير.');
  p.space(4);
  p.noteBox(`هذا التقرير محفوظ برقم فريد ${data.report_no} ومرتبط مباشرة بعملية البيع ${data.sale_no}. تتحدث الحسابات تلقائيًا من الدفعات والخصومات والعمولات والتصفيات المسجلة.`);
  p.contactBand();
}

function renderMarketerSettlementInvoice(p,data){const b=data.batch;p.sectionTitle('بيانات فاتورة التصفية');p.kvGrid([['رقم الفاتورة',b.invoice_no],['رقم التصفية',b.settlement_no],['تاريخ التصفية',b.settlement_date],['المسوق',b.marketer_name],['كود المسوق',b.marketer_code||'—'],['الهاتف',b.marketer_phone||'—'],['طريقة الدفع',methodAr[b.method]||b.method],['المرجع',b.ref_no||'—'],['الحالة',b.status==='active'?'مصفاة':'ملغاة']]);p.space(6);p.sectionTitle('العمولات والعمليات المشمولة');p.table({cols:[{label:'رقم البيع',key:'sale',w:.12},{label:'فاتورة البيع',key:'inv',w:.13},{label:'النوع',key:'type',w:.1},{label:'المشروع / الوحدة',key:'unit',w:.15},{label:'العميل',key:'customer',w:.13},{label:'قيمة البيع',key:'value',w:.13,align:'center'},{label:'العمولة',key:'comm',w:.12,align:'center'},{label:'المصفى',key:'paid',w:.12,align:'center'}],rows:data.items.map(i=>({sale:i.sale_no,inv:i.sale_invoice_no||'—',type:i.is_resale?'إعادة بيع':'بيع أول',unit:`${i.project_name} — ${i.unit_number}`,customer:i.customer_name,value:money(i.final_price),comm:money(i.commission_total),paid:money(i.amount)})),totals:['الإجمالي','','','','','',money(data.items.reduce((a,i)=>a+i.commission_total,0)),money(b.total_amount)],fontSize:7});if(b.notes){p.space(4);p.noteBox('ملاحظات: '+b.notes);}p.space(4);p.noteBox('كل بند في هذه الفاتورة مرتبط بعملية البيع الأصلية التي استحقت منها العمولة، ولا يؤدي إعادة بيع الوحدة إلى حذف العمولة أو نقلها إلى عملية أخرى.');p.contactBand();}

function renderCancelledReservationsReport(p, data) {
  const reasonAr = { customer_request: 'طلب العميل', incomplete_payment: 'عدم استكمال السداد', expired: 'انتهاء مدة الحجز', unit_change: 'تغيير الوحدة', booking_error: 'خطأ في الحجز', other: 'سبب آخر' };
  if (data.filters && data.filters.length) p.noteBox('معايير التقرير: ' + filtersLine(data.filters));
  p.space(4);
  p.sectionTitle('الحجوزات الملغاة — ' + data.rows.length + ' حجز');
  p.table({
    cols: [
      { label: 'رقم الحجز', key: 'no', w: .12, align: 'center' },
      { label: 'المصدر', key: 'src', w: .08, align: 'center' },
      { label: 'العميل', key: 'cust', w: .12 },
      { label: 'الوحدة / المشروع', key: 'unit', w: .14 },
      { label: 'المدفوع', key: 'paid', w: .08, align: 'center' },
      { label: 'سبب الإلغاء', key: 'reason', w: .13 },
      { label: 'المخصوم', key: 'ded', w: .08, align: 'center' },
      { label: 'المرتجع', key: 'ref', w: .08, align: 'center' },
      { label: 'طريقة الاسترداد', key: 'm', w: .07, align: 'center' },
      { label: 'تاريخ الإلغاء', key: 'dt', w: .1, align: 'center' },
    ],
    rows: data.rows.map(r => ({
      no: r.reservation_no, src: r.source_type === 'resale' ? 'إعادة بيع' : 'مباشر', cust: r.customer_name, unit: `${r.unit_number} — ${r.project_name}`,
      paid: money(r.total_paid), reason: (reasonAr[r.cancel_reason_code] || r.cancel_reason || '—'),
      ded: money(r.deducted_amount), ref: money(r.refund_amount), m: methodAr[r.refund_method] || '—', dt: String(r.cancelled_at || '').slice(0, 10),
    })),
    totals: ['الإجمالي', '', `${data.totals.count} حجز`, '', money(data.totals.total_paid), '', money(data.totals.deducted), money(data.totals.refunded), '', ''],
    fontSize: 7.5,
  });
  p.contactBand();
}
function renderRefundsReport(p, data) {
  if (data.filters && data.filters.length) p.noteBox('معايير التقرير: ' + filtersLine(data.filters));
  p.space(4);
  p.sectionTitle('الاستردادات والخصومات — ' + data.rows.length + ' عملية');
  p.table({
    cols: [
      { label: 'رقم الحجز', key: 'no', w: .1, align: 'center' },
      { label: 'المصدر', key: 'src', w: .08, align: 'center' },
      { label: 'العميل', key: 'cust', w: .11 },
      { label: 'الوحدة', key: 'unit', w: .08 },
      { label: 'المبلغ الأصلي', key: 'orig', w: .08, align: 'center' },
      { label: 'المخصوم', key: 'ded', w: .07, align: 'center' },
      { label: 'سبب الخصم', key: 'dreason', w: .12 },
      { label: 'المرتجع', key: 'ref', w: .08, align: 'center' },
      { label: 'الطريقة', key: 'm', w: .06, align: 'center' },
      { label: 'الحساب المصروف منه', key: 'acc', w: .09 },
      { label: 'رقم المرجع', key: 'rno', w: .11, align: 'center' },
    ],
    rows: data.rows.map(r => ({
      no: r.reservation_no, src: r.source_type === 'resale' ? 'إعادة بيع' : 'مباشر', cust: r.customer_name, unit: r.unit_number,
      orig: money(r.total_paid), ded: money(r.deducted_amount), dreason: r.deduction_reason || '—',
      ref: money(r.refund_amount), m: methodAr[r.refund_method] || '—', acc: r.refund_account || '—', rno: r.refund_ref_no || r.refund_no || '—',
    })),
    totals: ['الإجمالي', '', `${data.totals.count} عملية`, '', money(data.totals.total_paid), money(data.totals.deducted), '', money(data.totals.refunded), '', '', ''],
    fontSize: 7,
  });
  p.contactBand();
}


const RENDERERS = {
  search_results: renderSearchResults, unit_offer: renderUnitOffer, reservation: renderReservation,
  sale: renderSale, sale_invoice: renderSale, marketer_settlement_invoice: renderMarketerSettlementInvoice, cancelled_reservations_report: renderCancelledReservationsReport, refunds_report: renderRefundsReport, sales_report: renderSalesReport, payments_report: renderPaymentsReport,
  commissions_report: renderCommissionsReport, marketers_report: renderMarketersReport,
  financial_report: renderFinancialReport, settlement_report: renderSettlementReport,
  marketer_report: renderMarketerReport,
};

/**
 * توليد مستند PDF
 * options: { type, data, settings, user, docNo, subtitle }
 * returns: { buffer, filename, title, pages }
 */
async function buildDocument(options) {
  const { type, data } = options;
  const meta = DOC_META[type] || { title: 'مستند', fname: 'مستند' };
  const p = new ArabicPDF({
    settings: options.settings || {}, title: meta.title, subtitle: options.subtitle || '',
    user: options.user || null, docNo: options.docNo || '',
    landscape: ['marketer_report', 'settlement_report', 'sale_invoice', 'marketer_settlement_invoice', 'sales_report', 'payments_report', 'commissions_report', 'search_results'].includes(type),
  });
  p.ink = '#1d2a42';
  RENDERERS[type](p, data);
  const buffer = await p.buffer();
  // بادئة اسم الملف من اسم الموقع المركزي (الإعدادات) وليس نصًا ثابتًا
  const brandPrefix = String(options.settings?.site_name || options.settings?.company_name_ar || 'مستند').trim().replace(/\s+/g, '_').replace(/[<>:"/\\|?*]/g, '-');
  const parts = [brandPrefix, meta.fname];
  if (options.filenameParts && options.filenameParts.length) parts.push(...options.filenameParts.filter(Boolean));
  parts.push(today() + '_' + hhmm());
  const filename = parts.filter(Boolean).join('_').replace(/[<>:"/\\|?*]/g, '-') + '.pdf';
  return { buffer, filename, title: meta.title, pages: p.pageNo };
}

module.exports = { buildDocument, DOC_META, st, methodAr, phaseAr };
