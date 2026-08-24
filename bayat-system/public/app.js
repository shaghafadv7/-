/* ============================================================
   بيات الأكنة — واجهة النظام v1.8.0 (Expo Arabic + رمز الريال الجديد)
   صلاحيات تفصيلية (Checkboxes) + تقارير المسوقين
   ============================================================ */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
let token = localStorage.token || '', user = null, settings = {}, cache = { projects: [], floors: [], models: [], marketers: [] }, currentPage = 'dashboard', lastSearch = {};
let permsSet = new Set(), cacheUnitId = null;

const statusAr = { available: 'متاح', reserved: 'محجوز', contracted: 'متعاقد', sold: 'مباع', paid: 'مسدد بالكامل', unavailable: 'غير متاح', resale: 'إعادة بيع', owner: 'للمالك', investment: 'استثمار', active: 'نشط', cancelled: 'ملغي', expired: 'منتهي', converted: 'محوّل لبيع', resold: 'أعيد بيعها', under_construction: 'تحت الإنشاء', completed: 'مكتمل', paused: 'متوقف مؤقتًا', draft: 'مسودة', unpaid: 'غير مدفوعة', partial: 'مدفوعة جزئيًا', open: 'مفتوحة', settled: 'تمت التصفية', none: '—' };
const roleAr = { super_admin: 'مدير النظام', admin: 'مدير عام', sales_manager: 'مدير مبيعات', accountant: 'محاسب', reservations_officer: 'مسؤول حجوزات', sales: 'موظف مبيعات', viewer: 'مشاهدة فقط' };
const methodAr = { cash: 'كاش', bank_transfer: 'حوالة بنكية', check: 'شيك' };
const phaseAr = { off_plan: 'تحت الإنشاء', completed: 'مكتمل' };
const docTypeAr = { search_results: 'كشف وحدات', unit_offer: 'عرض وحدة', reservation: 'سند حجز', sale: 'سند بيع', sales_report: 'تقرير المبيعات', payments_report: 'تقرير الدفعات', commissions_report: 'تقرير العمولات', marketers_report: 'تقرير المسوقين', marketer_report: 'تقرير مسوق', financial_report: 'التقرير المالي', sale_invoice: 'فاتورة بيع عقارية', marketer_settlement_invoice: 'فاتورة تصفية مسوق', settlement_report: 'تقرير تصفية المستحقات' };

/* ===== الصلاحيات: المصدر هو الخادم (تُعاد مع كل دخول) ===== */
const isSuperAdmin = () => user?.role === 'super_admin';
const hasPerm = k => isSuperAdmin() || permsSet.has(k);
const anyPerm = (...ks) => ks.some(hasPerm);

// ===== رمز الريال السعودي الجديد (المسار الرسمي — ساما، مجال عام) =====
const SAR = (() => {
  const P1 = 'M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z';
  const P2 = 'M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z';
  return `<svg class="sar" viewBox="0 0 1124.14 1256.39" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="${P1} ${P2}"/></svg>`;
})();
// ===== المُنسّق المركزي الموحد لكل المبالغ في النظام: 150,000 + رمز الريال =====
const money = n => fmtE(n) + ' ' + SAR;
const fmt = n => new Intl.NumberFormat('en-US').format(+n || 0);
const fmtE = n => new Intl.NumberFormat('en-US').format(Math.round(+n || 0));
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const dstr = d => new Date(String(d).includes('T') ? d : d + 'Z').toLocaleDateString('ar-SA');
const dtstr = d => { try { return new Date(String(d).includes('T') ? d : d + 'Z').toLocaleString('ar-SA'); } catch { return d; } };

function toast(msg, error = false) { let d = document.createElement('div'); d.className = 'toast' + (error ? ' error' : ''); d.innerHTML = icon(error ? 'alert' : 'check', 15) + '<span>' + esc(msg) + '</span>'; $('#toast').append(d); setTimeout(() => d.remove(), 4200); }
async function api(url, opt = {}) {
  opt.headers = { ...(opt.headers || {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  if (opt.body && !(opt.body instanceof FormData)) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(opt.body); }
  const r = await fetch(url, opt);
  let d = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401) logout(); throw Error(d.error || 'تعذر تنفيذ العملية'); }
  return d;
}
function modal(html, wide = false) { $('#modalContent').innerHTML = `<div class="modal-content" ${wide ? 'style="padding:22px"' : ''}>${html}</div>`; decorateIcons($('#modalContent')); $('#modal').classList.remove('hidden'); $('#modal .modal-box').style.width = wide ? 'min(940px,96vw)' : 'min(720px,96vw)'; }
function closeModal() { $('#modal').classList.add('hidden'); }
window.closeModal = closeModal;
function badge(s) { return `<span class="badge ${s}">${statusAr[s] || s}</span>`; }
function head(title, sub, action = '') { return `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div><div class="actions">${action}</div></div>`; }

/* ============================================================
   نظام الأيقونات الموحد — SVG خطّي Minimal يتبع لون النص
   (stroke=currentColor) بحجم ومحاذاة واحدة في كل النظام
   ============================================================ */
const ICONS = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h1.5M13.5 7H15M9 11h1.5M13.5 11H15M9 15h1.5M13.5 15H15"/><path d="M10 21v-3h4v3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13.5 9 5 9-5"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M8 14h2M14 14h2"/>',
  trending: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6.5 15h4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.3 3.4-5.4 6.5-5.4s5.7 2.1 6.5 5.4"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.6c2.3.5 4 2.4 4.6 5"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c1-4 4-6 7.5-6s6.5 2 7.5 6"/>',
  usercheck: '<circle cx="10" cy="8" r="4"/><path d="M2.5 21c1-4 4-6 7.5-6 1.2 0 2.3.2 3.3.7"/><path d="m14 17 2 2 4-4.5"/>',
  chart: '<path d="M6 20v-6M12 20V6M18 20v-9"/><path d="M3 20h18"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  shield: '<path d="M12 3l7 3v5c0 4.6-3 7.8-7 9.1C8 18.8 5 15.6 5 11V6z"/><path d="m9 11.5 2 2 4-4"/>',
  usercircle: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 19.5c1-2.8 3-4.2 5.5-4.2s4.5 1.4 5.5 4.2"/>',
  sliders: '<path d="M4 8h9M17.5 8H20M4 16h2.5M11 16h9"/><circle cx="15.5" cy="8" r="2"/><circle cx="8.5" cy="16" r="2"/>',
  login: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="m14 8 4 4-4 4M18 12H8"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="m10 8-4 4 4 4M6.5 12H16"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 4v11m0 0 4-4m-4 4-4-4"/><path d="M5 20h14"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v10.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V8"/><path d="M10 12h4"/>',
  print: '<path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="8" rx="2"/><path d="M7 13h10v8H7z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/>',
  edit: '<path d="M12.5 20H21"/><path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7.5 18.5 3.5 20l1.4-4.1z"/>',
  trash: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6 7l1 13.5h10L18 7"/><path d="M10 11v6M14 11v6"/>',
  pin: '<path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/>',
  banknote: '<rect x="2.5" y="6.5" width="19" height="11.5" rx="1.6"/><circle cx="12" cy="12.2" r="2.5"/><path d="M6.2 9.7h.01M17.8 14.8h.01"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.3 12.4 2.6 2.6 4.8-5.3"/>',
  xcircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  restore: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v5h5"/>',
  bell: '<path d="M6.2 9.5a5.8 5.8 0 1 1 11.6 0c0 4.6 1.9 5.7 1.9 5.7H4.3s1.9-1.1 1.9-5.7"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 9.5v4.5M12 17.3v.02"/>',
  inbox: '<path d="M3.5 13h4l1.8 3h5.4l1.8-3h4"/><path d="M5.5 5h13l3 8v6h-19v-6z"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/>',
  filter: '<path d="M3.5 5h17l-6.8 7.8V19l-3.4-1.9v-4.3z"/>',
};
const icon = (n, s = 16, w = 1.7) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

/* تركم الأيقونات تلقائيًا على الأزرار والعناصر بعد كل عرض — مركزي وبدون تعديل القوالب */
const ICON_RULES = [
  [/^[+＋]/, 'plus'], [/^تصدير/, 'download'], [/^حفظ في الأرشيف/, 'archive'], [/^حفظ \+/, 'archive'],
  [/^(عرض التقرير|بحث$)/, 'search'], [/^تحديث/, 'refresh'], [/^إعادة ضبط/, 'refresh'],
  [/^(صلاحيات)/, 'shield'], [/PDF/, 'file'],
  [/^استعادة/, 'restore'], [/^(تسجيل دفعة|تسجيل الدفعة|دفع$|دفع دفعة)/, 'banknote'],
  [/^تعطيل/, 'xcircle'], [/^تفعيل/, 'check'],
  [/^(التفاصيل|معاينة|مراجعة|^عرض)/, 'eye'],
  [/^(تعديل|إدارة$)/, 'edit'], [/^حذف/, 'trash'],
  [/^(إلغاء|إغلاق|إزالة)/, 'x'],
  [/^(تأكيد|حفظ|رفع|إنشاء|إضافة|تغيير كلمة|دخول|تنفيذ)/, 'check'],
  [/^تنزيل/, 'download'], [/^طباعة/, 'print'], [/^تفاصيل/, 'eye'], [/^حجز الوحدة/, 'calendar'],
  [/^إعادة تعيين كلمة/, 'refresh'], [/^تحديد/, 'check'],
  [/^قائمة المسوقين/, 'users'], [/^العمولات$/, 'percent'], [/^جميع عمليات/, 'users'], [/^ربط مسوق/, 'users'], [/^بيانات المستثمر/, 'user'],
];
function decorateIcons(root) {
  if (!root) return;
  root.querySelectorAll('button, .mini-btn').forEach(b => {
    if (b.dataset.icd) return;
    const raw = b.textContent.trim();
    let name = null;
    for (const [re, ic] of ICON_RULES) { if (re.test(raw)) { name = ic; break; } }
    if (!name) return;
    b.dataset.icd = '1';
    b.innerHTML = icon(name, b.classList.contains('mini-btn') ? 13 : 15) + '<span>' + raw.replace(/^[+＋]\s*/, '') + '</span>';
  });
  root.querySelectorAll('.empty:not([data_ic])').forEach(e => {
    e.setAttribute('data_ic', '1');
    if (!e.querySelector('.empty-ic')) e.insertAdjacentHTML('afterbegin', `<span class="empty-ic">${icon('inbox', 36, 1.4)}</span>`);
  });
}

const confirmBox = m => window.confirm(m);

// تطبيق اسم الموقع والهوية من المصدر المركزي (الإعدادات) في كل مكان
function applyBrand(s) {
  document.title = (s.site_name || s.company_name_ar || 'بيات الأكنة') + ' | إدارة المبيعات والعقارات';
  if ($('#loginBrand')) $('#loginBrand').textContent = s.site_name || s.company_name_ar || '';
  const lg = $('#loginLogo'); if (lg) { if (s.logo_url) { lg.classList.remove('hidden'); lg.src = s.logo_url; } else lg.classList.add('hidden'); }
  document.documentElement.style.setProperty('--primary', s.primary_color || '#972B32');
  document.documentElement.style.setProperty('--navy', s.secondary_color || '#192E56');
  document.documentElement.style.setProperty('--gold', s.accent_color || '#B79552');
}
async function loadPublicSettings() {
  try { const s = await fetch('/api/public-settings').then(r => r.json()); applyBrand(s); settings = { ...settings, ...s }; } catch { }
}
async function loadSettings() {
  settings = await api('/api/settings');
  applyBrand(settings);
  $('#companySide').textContent = settings.company_name_ar || settings.site_name;
  const sub = $('#siteSub'); if (sub) sub.textContent = settings.site_name || '';
  if (settings.logo_url) $('#logoBox').innerHTML = `<img src="${settings.logo_url}">`;
  else $('#logoBox').textContent = (settings.site_name || 'ب').trim()[0] || 'ب';
}
function applyUser(u) { user = u; permsSet = new Set(u?.perms || []); }
async function boot() {
  try {
    applyUser(await api('/api/me')); await loadSettings();
    $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden');
    $('#userName').textContent = user.name; $('#userRole').textContent = isSuperAdmin() ? 'مدير النظام — جميع الصلاحيات' : roleAr[user.role]; $('#userAvatar').textContent = user.name[0];
    // إظهار/إخفاء الأقسام حسب الصلاحيات الفعلية
    $$('[data-reservations],[data-sales],[data-payments],[data-marketers],[data-settlements],[data-mkreports],[data-customer-finance],[data-profits],[data-customers],[data-reports],[data-docs],[data-users],[data-settings]').forEach(x => x.classList.remove('hidden'));
    if (!hasPerm('view_reservations')) $$('[data-reservations]').forEach(x => x.classList.add('hidden'));
    if (!hasPerm('view_sales')) $$('[data-sales]').forEach(x => x.classList.add('hidden'));
    if (!hasPerm('view_payments')) $$('[data-payments]').forEach(x => x.classList.add('hidden'));
    if (!anyPerm('view_marketers', 'view_commissions')) $$('[data-marketers]').forEach(x => x.classList.add('hidden'));
    if (!hasPerm('view_marketer_reports')) $$('[data-mkreports]').forEach(x => x.classList.add('hidden'));
    if (!anyPerm('view_customer_finance','view_financial_reports')) $$('[data-customer-finance]').forEach(x => x.classList.add('hidden'));
    if (!hasPerm('view_financial_reports')) $$('[data-profits]').forEach(x => x.classList.add('hidden'));
    if (!hasPerm('view_settlements')) $$('[data-settlements]').forEach(x => x.classList.add('hidden'));
    if (!hasPerm('view_customers')) $$('[data-customers]').forEach(x => x.classList.add('hidden'));
    if (!anyPerm('view_sales_reports', 'view_financial_reports', 'view_commissions')) $$('[data-reports]').forEach(x => x.classList.add('hidden'));
    if (!anyPerm('export_pdf', 'save_pdf', 'manage_docs_archive')) $$('[data-docs]').forEach(x => x.classList.add('hidden'));
    if (!hasPerm('view_users')) $$('[data-users]').forEach(x => x.classList.add('hidden'));
    if (!anyPerm('manage_settings', 'edit_branding', 'backup', 'restore')) $$('[data-settings]').forEach(x => x.classList.add('hidden'));
    go('dashboard');
  } catch (e) { logout(false); }
}
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); let b = Object.fromEntries(new FormData(e.target));
  try { let d = await api('/api/login', { method: 'POST', body: b }); token = d.token; applyUser(d.user); localStorage.token = token; boot(); }
  catch (x) { toast(x.message, true); }
};
function logout(show = true) { token = ''; user = null; permsSet = new Set(); localStorage.removeItem('token'); $('#appView').classList.add('hidden'); $('#loginView').classList.remove('hidden'); if (show) toast('تم تسجيل الخروج'); }
$('#logout').onclick = () => logout();
$('#menuBtn').onclick = () => $('.sidebar').classList.toggle('open');
$('#nav').onclick = e => { let b = e.target.closest('button[data-page]'); if (b) go(b.dataset.page); };
$('#globalSearch').onkeydown = async e => { if (e.key === 'Enter') { const q=e.target.value.trim(); if (/^(INV|SAL|STR|IINV|MST|MINV)-/i.test(q) && anyPerm('view_customer_finance','view_financial_reports')) { try { const d=await api('/api/invoices/search?q='+encodeURIComponent(q)); showInvoiceSearch(d); } catch(x){ toast(x.message,true); } return; } go('search'); setTimeout(() => { const i = document.querySelector('input[name=search]'); if (i) { i.value = q; i.form.dispatchEvent(new Event('submit')); } }, 200); } };

async function go(page, param = {}) {
  const noPerm = (msg) => { toast(msg, true); page = 'dashboard'; };
  if (page === 'reservations' && !hasPerm('view_reservations')) noPerm('ليس لديك صلاحية الحجوزات');
  if (page === 'sales' && !hasPerm('view_sales')) noPerm('ليس لديك صلاحية عرض المبيعات');
  if (page === 'customerFinance' && !anyPerm('view_customer_finance','view_financial_reports')) noPerm('ليس لديك صلاحية المتبقيات المالية');
  if (page === 'profits' && !hasPerm('view_financial_reports')) noPerm('ليس لديك صلاحية لوحة الأرباح');
  if (page === 'investorSettlements' && !hasPerm('view_settlements')) noPerm('ليس لديك صلاحية تصفيات المستثمرين');
  if (page === 'marketerSettlements' && !hasPerm('view_settlements')) noPerm('ليس لديك صلاحية عرض تصفيات المستحقات');
  if (page === 'customers' && !hasPerm('view_customers')) noPerm('ليس لديك صلاحية بيانات العملاء');
  if (page === 'payments' && !hasPerm('view_payments')) noPerm('هذه الصفحة تتطلب صلاحية عرض الدفعات');
  if (page === 'marketers' && !anyPerm('view_marketers', 'view_commissions')) noPerm('هذه الصفحة تتطلب صلاحية المسوقين أو العمولات');
  if (page === 'mkreports' && !hasPerm('view_marketer_reports')) noPerm('تتطلب صلاحية عرض تقارير المسوقين');
  if (page === 'reports' && !anyPerm('view_sales_reports', 'view_financial_reports', 'view_commissions')) noPerm('التقارير تتطلب صلاحية مناسبة');
  if (page === 'docs' && !anyPerm('export_pdf', 'save_pdf', 'manage_docs_archive')) noPerm('أرشيف المستندات غير متاح بصلاحياتك');
  if (page === 'users' && !hasPerm('view_users')) noPerm('صفحة المستخدمين تتطلب صلاحية العرض');
  if (page === 'settings' && !anyPerm('manage_settings', 'edit_branding', 'backup', 'restore')) noPerm('الإعدادات تتطلب صلاحية مناسبة');
  currentPage = page;
  $$('#nav button').forEach(x => x.classList.toggle('active', x.dataset.page === page));
  $('.sidebar').classList.remove('open');
  $('#content').innerHTML = '<div class="empty">جارٍ التحميل...</div>';
  try { await pages[page](param); } catch (e) { $('#content').innerHTML = `<div class="empty"><b>تعذر تحميل الصفحة</b>${esc(e.message)}</div>`; toast(e.message, true); }
  decorateIcons($('#content'));
}

/* ============================================================
   الصفحات
   ============================================================ */
const pages = {

  /* ---------- لوحة التحكم ---------- */
  async dashboard() {
    let d = await api('/api/dashboard'), s = d.statuses || {}, all = Math.max(d.total, 1), f = d.finance || null;
    $('#content').innerHTML = head('لوحة التحكم', 'نظرة مباشرة على المخزون والمبيعات والمالية') +
      `${user.mustChangePassword ? '<div class="password-banner">لأمان النظام، غيّر كلمة المرور المؤقتة من صفحة «حسابي».</div>' : ''}` +
      `<div class="stats"><div class="stat"><span class="stat-ic">${icon('building', 22)}</span><small>إجمالي المشاريع</small><strong>${d.projects}</strong><em>مشروع نشط</em></div>
      <div class="stat green"><span class="stat-ic">${icon('check', 22)}</span><small>وحدات متاحة</small><strong>${s.available || 0}</strong><em>جاهزة للحجز والبيع</em></div>
      <div class="stat orange"><span class="stat-ic">${icon('calendar', 22)}</span><small>وحدات محجوزة</small><strong>${s.reserved || 0}</strong><em>حجز نشط</em></div>
      <div class="stat wine"><span class="stat-ic">${icon('restore', 22)}</span><small>إعادة البيع</small><strong>${s.resale || 0}</strong><em>معروضة بعد الاكتمال</em></div></div>` +
      (f ? `<div class="stats"><div class="stat"><span class="stat-ic">${icon('trending', 22)}</span><small>إجمالي المبيعات</small><strong>${money(f.final_total)}</strong><em>${f.sales_count} صفقة</em></div>
      <div class="stat green"><span class="stat-ic">${icon('banknote', 22)}</span><small>إجمالي المحصل</small><strong>${money(f.paid_total)}</strong><em>شامل الدفعات</em></div>
      <div class="stat orange"><span class="stat-ic">${icon('card', 22)}</span><small>المبالغ المتبقية</small><strong>${money(f.remaining_total)}</strong><em>متبقٍ على العملاء</em></div>
      <div class="stat wine"><span class="stat-ic">${icon('percent', 22)}</span><small>عمولات متبقية للمسوقين</small><strong>${money(f.commission_remaining ?? f.commission_due)}</strong><em>${f.marketers} مسوق</em></div>
      <div class="stat"><small>إجمالي التكاليف</small><strong>${money(f.total_costs)}</strong><em>عقار + مصروفات + عمولات</em></div>
      <div class="stat ${f.net_profit>=0?'green':'wine'}"><small>صافي الربح الحقيقي</small><strong>${money(f.net_profit)}</strong><em>من المبالغ المحصلة فقط</em></div></div>` : '') +
      `<div class="grid-2"><section class="panel"><div class="panel-head"><h3>مخزون الوحدات</h3>${hasPerm('view_units') ? '<button class="btn ghost" onclick="go(\'search\')">عرض الكل</button>' : ''}</div><div class="panel-body inventory-bars">${[['available', 'متاح'], ['reserved', 'محجوز'], ['sold', 'مباع'], ['paid', 'مسدد بالكامل'], ['resale', 'إعادة بيع']].map(([k, n]) => `<div class="bar"><div class="bar-top"><span>${n}</span><b>${s[k] || 0}</b></div><div class="track"><div class="fill" style="width:${(s[k] || 0) * 100 / all}%;background:${k === 'available' ? 'var(--green)' : k === 'reserved' ? 'var(--orange)' : k === 'resale' ? '#6b4fa3' : 'var(--primary)'}"></div></div></div>`).join('')}</div></section>
      <section class="panel"><div class="panel-head"><h3>تنبيهات</h3></div><div class="panel-body">
        <div class="stat orange" style="margin-bottom:10px"><small>حجوزات تنتهي خلال 48 ساعة</small><strong>${d.expiring}</strong>${hasPerm('view_reservations') ? '<button class="btn ghost" onclick="go(\'reservations\')">مراجعة</button>' : ''}</div>
        ${f ? `<div class="stat green"><span class="stat-ic">${icon('banknote', 22)}</span><small>محصلات هذا الشهر</small><strong>${money(f.payments_month)}</strong><em>محصلات الشهر</em></div>` : ''}
      </div></section></div>
      <section class="panel"><div class="panel-head"><h3>آخر النشاطات</h3></div><div class="table-wrap"><table><thead><tr><th>المستخدم</th><th>العملية</th><th>النوع</th><th>الوقت</th></tr></thead><tbody>${d.recent.map(x => `<tr><td>${esc(x.user_name || 'النظام')}</td><td>${esc(x.action)}</td><td>${esc(x.entity_type)}</td><td>${dtstr(x.created_at)}</td></tr>`).join('') || '<tr><td colspan="4">لا توجد نشاطات</td></tr>'}</tbody></table></div></section>`;
  },

  /* ---------- البحث المتقدم ---------- */
  async search(param = {}) {
    cache.projects = await api('/api/projects');
    const statusOpts = ['available', 'reserved', 'contracted', 'sold', 'paid', 'resale', 'unavailable', 'owner'].map(v => `<option value="${v}">${statusAr[v]}</option>`).join('');
    const pdfBtns = [
      hasPerm('export_pdf') ? `<button class="btn ghost" onclick="exportSearch(false)">تصدير PDF</button>` : '',
      hasPerm('print_reports') ? `<button class="btn ghost" onclick="printSearch()">طباعة</button>` : '',
      hasPerm('save_pdf') ? `<button class="btn secondary" onclick="exportSearch(true)">حفظ في الأرشيف</button>` : '',
    ].join('');
    window._searchBtns = pdfBtns;
    $('#content').innerHTML = head('البحث المتقدم عن وحدة', 'اجمع عدة معايير معًا واحصل على النتائج فورًا') +
      `<section class="panel"><div class="panel-body"><form id="searchForm" class="filters-adv">
        <div class="field"><label>المشروع<select name="project_id" id="sfProject"><option value="">كل المشاريع</option>${cache.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label></div>
        <div class="field"><label>الدور<select name="floor_id" id="sfFloor"><option value="">كل الأدوار</option></select></label></div>
        <div class="field"><label>رقم الوحدة<input name="unit_number" value="${esc(param.unit_number || '')}" placeholder="مثال: A-102"></label></div>
        <div class="field"><label>كلمة عامة<input name="search" value="${esc(param.search || '')}" placeholder="نموذج / مشروع / مالك"></label></div>
        <div class="field"><label>عدد الغرف<select name="rooms"><option value="">الكل</option>${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}">${n}${n === 6 ? ' أو أكثر' : ' غرف'}</option>`).join('')}</select></label></div>
        <div class="field"><label>الحالة<select name="status"><option value="">كل الحالات</option>${statusOpts}</select></label></div>
        <div class="field"><label>مرحلة البيع<select name="sell_phase"><option value="">الكل</option><option value="off_plan">تحت الإنشاء</option><option value="completed">مكتمل</option></select></label></div>
        <div class="field"><label>نوع الوحدة (النموذج)<input name="model_code" placeholder="A1، B2..."></label></div>
        <div class="field"><label>السعر من<input type="number" name="price_min" placeholder="0"></label></div>
        <div class="field"><label>السعر إلى<input type="number" name="price_max" placeholder="750000"></label></div>
        <div class="field"><label>المساحة من م²<input type="number" name="area_min"></label></div>
        <div class="field"><label>المساحة إلى م²<input type="number" name="area_max"></label></div>
        <div class="field"><label>اسم المالك / المساهم<input name="owner" placeholder="بحث بالمالك"></label></div>
        <label class="check"><input type="checkbox" name="has_discount" value="1"> وحدات عليها خصم فقط</label>
        <div class="filter-actions"><button class="btn primary">بحث</button><button type="reset" class="btn ghost">إعادة ضبط</button></div>
      </form></div></section><div id="searchResults"></div>`;
    $('#sfProject').onchange = async e => {
      const f = await api(`/api/projects/${e.target.value}/floors`);
      $('#sfFloor').innerHTML = '<option value="">كل الأدوار</option>' + f.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
    };
    $('#searchForm').onsubmit = e => { e.preventDefault(); const fd = new FormData(e.target); const q = {}; fd.forEach((v, k) => { if (v !== '' && !(k === 'has_discount' && !v)) q[k] = v; }); runSearch(q); };
    runSearch({});
  },

  /* ---------- المشاريع ---------- */
  async projects() {
    let rows = await api('/api/projects'); cache.projects = rows;
    $('#content').innerHTML = head('المشاريع', 'إنشاء المشاريع وإدارة حالتها ومخزونها', hasPerm('add_project') ? '<button class="btn primary" onclick="projectForm()">+ إضافة مشروع</button>' : '') +
      `<div class="cards">${rows.map(p => `<article class="project-card"><div class="unit-top">${badge(p.construction_status)}<span>${esc(p.code)}</span></div><h3>${esc(p.name)}</h3><p class="loc">${icon('pin', 13)} ${esc(p.location || 'لم يحدد الموقع')}</p><div class="project-kpis"><span><b>${p.floors_count}</b>الأدوار</span><span><b>${p.units_count}</b>الوحدات</span><span><b>${p.available_count}</b>المتاح</span><span><b>${p.resale_count || 0}</b>إعادة بيع</span></div><div class="card-foot"><span>الإنجاز ${p.progress}%</span><span class="toolbar">${hasPerm('edit_project') ? `<button class="mini-btn" onclick='projectForm(${JSON.stringify(p)})'>إدارة</button>` : ''}${hasPerm('delete_project') ? `<button class="mini-btn" style="color:#a72f3a" onclick="deleteProject(${p.id},'${esc(p.name)}')">حذف</button>` : ''}</span></div></article>`).join('') || '<div class="empty"><b>لا توجد مشاريع</b>ابدأ بإضافة مشروعك الأول</div>'}</div>`;
  },

  /* ---------- النماذج والأدوار ---------- */
  async models() {
    cache.projects = await api('/api/projects');
    $('#content').innerHTML = head('النماذج والأدوار', 'كوّن هيكل كل مشروع ثم أضف نماذج الشقق') +
      `<section class="panel"><div class="panel-body"><div class="field"><label>اختر المشروع<select id="structureProject"><option value="">اختر مشروعًا</option>${cache.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label></div></div></section><div id="structure"></div>`;
    $('#structureProject').onchange = e => loadStructure(e.target.value);
  },

  /* ---------- الوحدات ---------- */
  async units() {
    cache.projects = await api('/api/projects');
    let d = await api('/api/units?limit=100');
    $('#content').innerHTML = head('إدارة الوحدات', 'إضافة الوحدات وتعديل أسعارها وحالاتها ومرحلة بيعها', hasPerm('add_unit') ? '<button class="btn primary" onclick="unitForm()">+ إضافة وحدة</button>' : '') + unitsTable(d.rows);
  },

  /* ---------- الحجوزات ---------- */
  async reservations() {
    let rows = await api('/api/reservations');
    $('#content').innerHTML = head('الحجوزات', 'متابعة الحجوزات النشطة والمنتهية') +
      `<section class="panel"><div class="table-wrap"><table><thead><tr><th>رقم الحجز</th><th>المشروع / الوحدة</th><th>العميل</th><th>الموظف</th><th>الانتهاء</th><th>العربون</th><th>الحالة</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td><b>${esc(r.reservation_no)}</b></td><td>${esc(r.project_name)} — ${esc(r.unit_number)}</td><td>${esc(r.customer_name)}<br><small>${esc(r.customer_phone)}</small></td><td>${esc(r.employee_name)}</td><td>${dtstr(r.expires_at)}</td><td>${money(r.deposit)}</td><td>${badge(r.status)}</td><td class="toolbar">${hasPerm('export_pdf') ? `<button class="mini-btn" onclick="reservationDoc(${r.id})">سند PDF</button>` : ''}${r.status === 'active' && hasPerm('edit_reservation') ? `<button class="mini-btn" onclick="editReservation(${r.id},${JSON.stringify(r.expires_at).replace(/"/g, '&quot;')},${r.deposit})">تعديل</button>` : ''}${r.status === 'active' && hasPerm('cancel_reservation') ? `<button class="btn danger" onclick="cancelReservation(${r.id})">إلغاء</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">لا توجد حجوزات</div></td></tr>'}</tbody></table></div></section>`;
  },

  /* ---------- المبيعات ---------- */
  async sales() {
    const rows = await api('/api/sales');
    const showPrice = hasPerm('view_prices'), showDisc = hasPerm('view_discounts');
    $('#content').innerHTML = head('المبيعات', 'سجل المبيعات مع الخصومات والدفعات') +
      `<section class="panel"><div class="table-wrap"><table><thead><tr><th>رقم الفاتورة / البيع</th><th>المشروع / الوحدة</th><th>العميل</th>${showPrice ? '<th>قبل الخصم</th>' : ''}${showDisc && showPrice ? '<th>الخصم</th>' : ''}${showPrice ? '<th>النهائي</th><th>المدفوع</th><th>المتبقي</th>' : ''}<th>المرحلة</th><th>التاريخ</th><th></th></tr></thead><tbody>${rows.map(s => `<tr><td><b>${esc(s.invoice_no || '—')}</b><br><small>${esc(s.sale_no)}</small></td><td>${esc(s.project_name)} — ${esc(s.unit_number)}</td><td>${esc(s.customer_name)}</td>${showPrice ? `<td>${fmt(s.base_price)}</td>` : ''}${showDisc && showPrice ? `<td>${s.discount_amount ? `<span class="discount-tag">-${fmt(s.discount_amount)}</span>` : '—'}</td>` : ''}${showPrice ? `<td><b>${fmt(s.final_price)}</b></td><td class="money-pos">${fmt(s.paid_amount)}</td><td class="money-neg">${fmt(s.remaining_amount)}</td>` : ''}<td>${s.is_resale ? '<span class="phase-chip">إعادة بيع</span>' : `<span class="phase-chip">${phaseAr[s.sale_phase] || ''}</span>`}</td><td>${esc(s.sale_date)}</td><td class="toolbar">${showPrice ? `<button class="mini-btn" onclick="viewInvoice(${s.id})">عرض الفاتورة</button>` : ''}${showPrice && hasPerm('export_pdf') ? `<button class="mini-btn" onclick="invoicePdf(${s.id})">تنزيل PDF</button>` : ''}${hasPerm('edit_sale') && s.status === 'active' ? `<button class="mini-btn" onclick="editSaleForm(${s.id})">تعديل</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="11"><div class="empty">لا توجد مبيعات</div></td></tr>'}</tbody></table></div></section>`;
  },

  /* ---------- الدفعات ---------- */
  async payments() {
    const rows = await api('/api/payments');
    const total = rows.reduce((a, x) => a + x.amount, 0);
    $('#content').innerHTML = head('الدفعات', 'تسجيل ومتابعة دفعات العملاء على المبيعات') +
      `<div class="toolbar" style="margin-bottom:14px"><span class="toolbar-label">إجمالي المعروض:</span><b>${money(total)}</b><span style="flex:1"></span>
        ${hasPerm('export_pdf') ? '<button class="btn ghost" onclick="paymentsReportPdf(false)">تصدير PDF</button>' : ''}
        ${hasPerm('save_pdf') ? '<button class="btn ghost" onclick="paymentsReportPdf(true)">حفظ في الأرشيف</button>' : ''}</div>` +
      `<section class="panel"><div class="table-wrap"><table><thead><tr><th>رقم الدفعة</th><th>البيع</th><th>المشروع / الوحدة</th><th>العميل</th><th>التاريخ</th><th>الطريقة</th><th>المرجع</th><th>المبلغ</th><th></th></tr></thead><tbody>${rows.map(x => `<tr><td><b>${esc(x.payment_no)}</b></td><td>${esc(x.sale_no)}</td><td>${esc(x.project_name)} — ${esc(x.unit_number)}</td><td>${esc(x.customer_name || '—')}</td><td>${esc(x.pay_date)}</td><td>${methodAr[x.method] || x.method}</td><td>${esc(x.ref_no || '—')}</td><td><b>${money(x.amount)}</b></td><td>${hasPerm('add_payment') ? `<button class="mini-btn" onclick="cancelPayment(${x.id})">إلغاء</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9"><div class="empty">لا توجد دفعات</div></td></tr>'}</tbody></table></div></section>`;
  },

  /* ---------- المسوقون والعمولات ---------- */
  async marketers(tab = 'list') {
    window._mkTab = tab || 'list';
    const canList = hasPerm('view_marketers'), canComm = hasPerm('view_commissions');
    window._mkTab = window._mkTab === 'commissions' && !canComm ? 'list' : window._mkTab;
    const tabs = `${canList ? `<button class="${window._mkTab === 'list' ? 'active' : ''}" onclick="go('marketers','list')">قائمة المسوقين</button>` : ''}${canComm ? `<button class="${window._mkTab === 'commissions' ? 'active' : ''}" onclick="go('marketers','commissions')">العمولات</button>` : ''}`;
    if (window._mkTab !== 'commissions' && canList) {
      const rows = await api('/api/marketers');
      $('#content').innerHTML = head('المسوقون', 'إدارة المسوقين وربطهم بالصفقات', hasPerm('add_marketer') ? '<button class="btn primary" onclick="marketerForm()">+ مسوق جديد</button>' : '') + `<div class="tabs">${tabs}</div>` +
        `<div class="cards">${rows.map(m => `<article class="unit-card"><div class="unit-top"><div><small>${esc(m.code)}</small><div class="unit-no" style="font-size:17px">${esc(m.name)}</div></div>${m.active ? badge('active') : badge('unavailable')}</div><div class="unit-meta"><div>الوحدات المباعة<b>${m.units_count}</b></div><div>إجمالي المبيعات<b>${fmt(m.sales_total)}</b></div><div>عمولات مستحقة<b>${fmt(m.commission_due)}</b></div><div>عمولات مدفوعة<b>${fmt(m.commission_paid)}</b></div></div><div class="card-foot"><span>${esc(m.phone || 'بدون جوال')}</span><span class="toolbar">${hasPerm('view_marketer_sales') || canList ? `<button class="mini-btn" onclick="marketerDetails(${m.id})">التفاصيل</button>` : ''}${hasPerm('edit_marketer') ? `<button class="mini-btn" onclick='marketerForm(${JSON.stringify(m)})'>تعديل</button>` : ''}${hasPerm('disable_marketer') ? `<button class="mini-btn" onclick="toggleMarketer(${m.id})">${m.active ? 'تعطيل' : 'تفعيل'}</button>` : ''}</span></div></article>`).join('') || '<div class="empty"><b>لا يوجد مسوقون</b>أضف أول مسوق</div>'}</div>`;
    } else {
      const cms = await api('/api/commissions');
      $('#content').innerHTML = head('العمولات', 'متابعة عمولات المسوقين ودفعاتها') + `<div class="tabs">${tabs}</div>` +
        `<section class="panel"><div class="table-wrap"><table><thead><tr><th>المسوق</th><th>رقم البيع</th><th>المشروع / الوحدة</th><th>قيمة البيع</th><th>العمولة</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th><th></th></tr></thead><tbody>${cms.map(c => `<tr><td><b>${esc(c.marketer_name || '')}</b> <small>${esc(c.marketer_code || '')}</small></td><td>${esc(c.sale_no)}</td><td>${esc(c.project_name)} — ${esc(c.unit_number)}</td><td>${fmt(c.final_price)}</td><td><b>${fmt(c.commission_total)}</b></td><td class="money-pos">${fmt(c.commission_paid)}</td><td class="money-neg">${fmt(c.commission_due)}</td><td>${badge(c.commission_status)}</td><td class="toolbar">${hasPerm('edit_marketer') && hasPerm('view_commissions') ? `<button class="mini-btn" onclick="commissionForm(${c.id})">تعديل</button>` : ''}${hasPerm('pay_commission') && c.commission_due > 0 ? `<button class="mini-btn" onclick="commissionPayForm(${c.id},${c.commission_due})">دفع</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9"><div class="empty">لا توجد عمولات مسجلة</div></td></tr>'}</tbody></table></div></section>`;
    }
  },

  /* ---------- تقارير المسوقين ---------- */
  async mkreports() {
    cache.projects = await api('/api/projects');
    cache.marketers = await api('/api/marketers').catch(() => []);
    $('#content').innerHTML = head('تقارير المسوقين', 'تقرير إجمالي وتفصيلي لكل مسوق مرتبط مباشرة بالمبيعات والعمولات والدفعات') +
      `<section class="panel"><div class="panel-body"><div class="mr-filters">
        <div class="field"><label>المسوق<select id="mrMarketer"><option value="">كل المسوقين</option>${cache.marketers.map(m => `<option value="${m.id}">${esc(m.name)} — ${esc(m.code)}</option>`).join('')}</select></label></div>
        <div class="field"><label>المشروع<select id="mrProject"><option value="">كل المشاريع</option>${cache.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label></div>
        <div class="field"><label>الفترة<select id="mrPeriod" onchange="mrToggleCustom()">
          <option value="all">كل الفترات</option><option value="today">اليوم</option><option value="week">هذا الأسبوع</option>
          <option value="month">هذا الشهر</option><option value="year">هذا العام</option><option value="custom">فترة مخصصة</option></select></label></div>
        <div class="field"><label>رقم الوحدة<input id="mrUnit" placeholder="مثال: A-102"></label></div>
        <div class="field" id="mrFromWrap" style="display:none"><label>من تاريخ<input type="date" id="mrFrom"></label></div>
        <div class="field" id="mrToWrap" style="display:none"><label>إلى تاريخ<input type="date" id="mrTo"></label></div>
        <div class="field"><label>حالة البيع<select id="mrSaleStatus"><option value="">الكل</option><option value="active">نشط</option><option value="resold">أعيد بيعها</option><option value="cancelled">ملغي</option></select></label></div>
        <div class="field"><label>حالة العمولة<select id="mrCommStatus"><option value="">الكل</option><option value="unpaid">غير مدفوعة</option><option value="partial">مدفوعة جزئيًا</option><option value="paid">مدفوعة بالكامل</option></select></label></div>
        <div class="field"><label>بحث<input id="mrQ" placeholder="اسم/رقم بيع/عميل"></label></div>
        <div class="filter-actions">
          <button class="btn primary" onclick="loadMkReport()">عرض التقرير</button>
          ${hasPerm('export_pdf') ? '<button class="btn ghost" onclick="mkReportPdf(false)">تصدير PDF</button>' : ''}
          ${hasPerm('save_pdf') ? '<button class="btn secondary" onclick="mkReportPdf(true)">حفظ PDF</button>' : ''}
          ${hasPerm('print_reports') ? '<button class="btn ghost" onclick="printMkReport()">طباعة</button>' : ''}
        </div></div></div></section>
      <div id="mkReportBody"><div class="empty">حدد الفلاتر ثم اضغط «عرض التقرير»</div></div>`;
    loadMkReport();
  },

  /* ---------- العملاء والمتبقيات المالية ---------- */
  async customerFinance() {
    cache.projects = await api('/api/projects').catch(()=>[]);
    $('#content').innerHTML = head('العملاء والمتبقيات المالية','كشف موحد لقيم المبيعات والتحصيل الفعلي والذمم المستحقة وسجل الحركات') +
      `<section class="panel"><div class="panel-body"><div class="filters-adv">
      <div class="field"><label>بحث<input id="cfSearch" placeholder="عميل / جوال / بيع / وحدة"></label></div>
      <div class="field"><label>المشروع<select id="cfProject"><option value="">كل المشاريع</option>${cache.projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label></div>
      <label class="check"><input type="checkbox" id="cfOutstanding" checked> العملاء الذين عليهم مبالغ للشركة ولم تتم تصفيتهم</label>
      <div class="filter-actions"><button class="btn primary" onclick="loadCustomerFinance()">عرض</button><button class="btn ghost" onclick="document.getElementById('cfOutstanding').checked=false;document.getElementById('cfSearch').value='';loadCustomerFinance()">عرض الكل</button></div>
      </div></div></section><div id="customerFinanceBody"><div class="empty">جارٍ التحميل...</div></div>`;
    await loadCustomerFinance();
  },

  /* ---------- لوحة الأرباح الحقيقية ---------- */
  async profits() {
    cache.projects = await api('/api/projects').catch(()=>[]);
    $('#content').innerHTML = head('لوحة الأرباح','الأرباح المحققة من التحصيل الفعلي فقط — دون إدخال الذمم غير المحصلة') +
      `<section class="panel"><div class="panel-body"><div class="filters-adv"><div class="field"><label>من تاريخ<input type="date" id="pfFrom"></label></div><div class="field"><label>إلى تاريخ<input type="date" id="pfTo"></label></div><div class="field"><label>المشروع<select id="pfProject"><option value="">كل المشاريع</option>${cache.projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label></div><div class="filter-actions"><button class="btn primary" onclick="loadProfitDashboard()">تحديث</button></div></div></div></section><div id="profitBody"><div class="empty">جارٍ احتساب النتائج...</div></div>`;
    await loadProfitDashboard();
  },

  /* ---------- العملاء وتصفية مستحقات البيع الثاني ---------- */
  async customers(tab = 'list') {
    const active = typeof tab === 'string' ? tab : (tab?.tab || 'list');
    const tabs = `<div class="tabs"><button class="${active === 'list' ? 'active' : ''}" onclick="go('customers','list')">قائمة العملاء</button>${hasPerm('view_settlements') ? `<button class="${active === 'settlements' ? 'active' : ''}" onclick="go('customers','settlements')">تصفية المستحقات</button>` : ''}</div>`;
    if (active === 'settlements' && hasPerm('view_settlements')) {
      $('#content').innerHTML = head('تصفية المستحقات', 'جميع مستحقات الشركة والعملاء والمساهمين الناتجة عن البيع الثاني / إعادة البيع') + tabs + settlementFilters('customers') + '<div id="settlementBody"><div class="empty">جارٍ تحميل تقارير التصفية...</div></div>';
      await loadSettlements('customers');
      return;
    }
    let rows = await api('/api/customers');
    $('#content').innerHTML = head('العملاء', 'قاعدة العملاء وبيانات التواصل', hasPerm('add_customer') ? '<button class="btn primary" onclick="customerForm()">+ إضافة عميل</button>' : '') + tabs +
      `<section class="panel"><div class="table-wrap"><table><thead><tr><th>الاسم</th><th>الجوال</th><th>البريد</th><th>المصدر</th><th>تاريخ الإضافة</th><th></th></tr></thead><tbody>${rows.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.phone)}</td><td>${esc(c.email || '—')}</td><td>${esc(c.source || '—')}</td><td>${dstr(c.created_at)}</td><td class="toolbar">${hasPerm('edit_customer') ? `<button class="mini-btn" onclick='editCustomerForm(${JSON.stringify(c)})'>تعديل</button>` : ''}${hasPerm('delete_customer') ? `<button class="mini-btn" style="color:#a72f3a" onclick="deleteCustomer(${c.id},'${esc(c.name)}')">حذف</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">لا يوجد عملاء</div></td></tr>'}</tbody></table></div></section>`;
  },

  /* ---------- تصفيات المستثمرين في البيع الثاني ---------- */
  async investorSettlements() {
    $('#content').innerHTML=head('تصفيات المستثمرين','عمليات إعادة البيع لصالح العميل أو المستثمر، مرتبطة بفواتير البيع والتصفية الأصلية')+'<div id="investorSettlementBody"><div class="empty">جارٍ تحميل العمليات...</div></div>';
    const rows=await api('/api/investor-settlements'),b=$('#investorSettlementBody');
    b.innerHTML=`<div class="summary-strip"><div class="stat"><small>عمليات إعادة البيع</small><b>${rows.length}</b></div><div class="stat wine"><small>صافي مستحق المستثمرين</small><b>${money(rows.reduce((a,r)=>a+r.net_amount,0))}</b></div><div class="stat green"><small>تمت تصفيته</small><b>${money(rows.reduce((a,r)=>a+r.settled_amount,0))}</b></div><div class="stat orange"><small>المتبقي</small><b>${money(rows.reduce((a,r)=>a+r.investor_remaining,0))}</b></div></div><section class="panel"><div class="table-wrap"><table><thead><tr><th>فاتورة التصفية</th><th>فاتورة / رقم البيع</th><th>المشروع / الوحدة</th><th>المالك السابق</th><th>المالك الجديد</th><th>قيمة البيع</th><th>المدفوع</th><th>متبقي العميل</th><th>الخصومات</th><th>صافي مستحق المستثمر</th><th>المصفى</th><th>المتبقي للمستثمر</th><th>الحالة</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${esc(r.invoice_no||r.report_no)}</b><br><small>${esc(r.report_no)}</small></td><td>${esc(r.sale_invoice_no||'—')}<br><small>${esc(r.sale_no)}</small></td><td>${esc(r.project_name)} — ${esc(r.unit_number)}</td><td>${esc(r.prev_owner_name||r.beneficiary_name||'—')}</td><td>${esc(r.new_owner_name)}</td><td>${money(r.final_price)}</td><td>${money(r.paid_amount)}</td><td>${money(Math.max(0,r.remaining_amount))}</td><td>${money(r.discount_amount)}</td><td><b>${money(r.net_amount)}</b></td><td class="money-pos">${money(r.settled_amount)}</td><td class="money-neg">${money(r.investor_remaining)}</td><td>${badge(r.investor_status)}</td><td class="toolbar"><button class="mini-btn" onclick="showSettlementReport(${r.id})">عرض التصفية</button>${hasPerm('manage_settlements')&&r.investor_remaining>0?`<button class="mini-btn" onclick="settlementPayForm(${r.id},${r.entry_id},'${esc(r.prev_owner_name||'المستثمر')}',${r.investor_remaining})">تسجيل التصفية</button>`:''}${hasPerm('export_pdf')?`<button class="mini-btn" onclick="settlementPdf(${r.id},false)">تنزيل PDF</button>`:''}</td></tr>`).join('')||'<tr><td colspan="14"><div class="empty">لا توجد عمليات إعادة بيع لصالح مستثمر</div></td></tr>'}</tbody></table></div></section>`;decorateIcons(b);
  },

  /* ---------- قسم مستقل لتصفية المسوقين ---------- */
  async marketerSettlements() {
    cache.marketers=await api('/api/marketers').catch(()=>[]);
    $('#content').innerHTML = head('تصفية المسوقين', 'اختيار مسوق وتجميع جميع عمولاته غير المصفاة في تصفية واحدة دون ازدواجية') + `<section class="panel"><div class="panel-body"><div class="filters-adv"><div class="field"><label>المسوق<select id="msMarketer"><option value="">اختر المسوق</option>${cache.marketers.map(m=>`<option value="${m.id}">${esc(m.name)} — ${esc(m.code)}</option>`).join('')}</select></label></div><div class="filter-actions"><button class="btn primary" onclick="loadMarketerSettlement()">عرض العمولات غير المصفاة</button></div></div></div></section><div id="settlementBody"><div class="empty">اختر المسوق لعرض كشف التصفية</div></div>`;
  },

  /* ---------- التقارير ---------- */
  async reports(tab = 'sales') {
    const tabs = [];
    if (hasPerm('view_sales_reports')) tabs.push(['sales', 'تقرير المبيعات']);
    if (hasPerm('view_payments')) tabs.push(['payments', 'تقرير الدفعات']);
    if (hasPerm('view_commissions')) tabs.push(['commissions', 'العمولات والمسوقون']);
    if (hasPerm('view_financial_reports')) tabs.push(['financial', 'التقرير المالي']);
    window._rpTab = tab && tabs.some(t => t[0] === tab) ? tab : (tabs[0]?.[0] || 'sales');
    const t = window._rpTab;
    const dateFilter = `<div class="filters-adv" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">
      <div class="field"><label>من تاريخ<input type="date" id="rpFrom"></label></div>
      <div class="field"><label>إلى تاريخ<input type="date" id="rpTo"></label></div>
      <div class="filter-actions"><button class="btn primary" onclick="loadReport()">تحديث</button>
      ${hasPerm('export_pdf') ? '<button class="btn ghost" onclick="exportReport(false)">تصدير PDF</button>' : ''}
      ${hasPerm('save_pdf') ? '<button class="btn ghost" onclick="exportReport(true)">حفظ + تنزيل</button>' : ''}</div></div>`;
    $('#content').innerHTML = head('التقارير', 'تقارير فورية محدثة من قاعدة البيانات') + `<div class="tabs">${tabs.map(([k, n]) => `<button class="${t === k ? 'active' : ''}" onclick="go('reports','${k}')">${n}</button>`).join('')}</div>` + dateFilter + `<div id="reportBody"><div class="empty">جارٍ التحميل...</div></div>`;
    await loadReport();
  },

  /* ---------- أرشيف المستندات ---------- */
  async docs() {
    const typeOpts = Object.entries(docTypeAr).map(([v, n]) => `<option value="${v}">${n}</option>`).join('');
    $('#content').innerHTML = head('أرشيف المستندات PDF', 'جميع المستندات المحفوظة من النظام — لا تُحذف إلا بصلاحية') +
      `<section class="panel"><div class="panel-body"><form id="docFilter" class="filters-adv" style="grid-template-columns:repeat(5,1fr)">
        <div class="field"><label>بحث<input name="q" placeholder="اسم ملف / عميل / وحدة / مسوق / رقم"></label></div>
        <div class="field"><label>نوع المستند<select name="doc_type"><option value="">الكل</option>${typeOpts}</select></label></div>
        <div class="field"><label>من تاريخ<input type="date" name="date_from"></label></div>
        <div class="field"><label>إلى تاريخ<input type="date" name="date_to"></label></div>
        <div class="filter-actions"><button class="btn primary">بحث</button></div></form></div></section><div id="docList"></div>`;
    $('#docFilter').onsubmit = e => { e.preventDefault(); loadDocs(new URLSearchParams(new FormData(e.target))); };
    loadDocs(new URLSearchParams());
  },

  /* ---------- المستخدمون والصلاحيات ---------- */
  async users() {
    let rows = await api('/api/users');
    $('#content').innerHTML = head('المستخدمون والصلاحيات', 'إدارة الحسابات وتحديد صلاحيات كل مستخدم بشكل تفصيلي', hasPerm('add_user') ? '<button class="btn primary" onclick="userForm()">+ مستخدم جديد</button>' : '') +
      (isSuperAdmin() ? '<div class="perm-banner">أنت مدير النظام وتملك <b>جميع الصلاحيات</b> تلقائيًا. اختر أي مستخدم واضغط «صلاحيات» لتخصيص ما يراه وينفذه عبر Checkboxes.</div>' : '') +
      `<section class="panel"><div class="table-wrap"><table><thead><tr><th>المستخدم</th><th>اسم الدخول</th><th>الدور</th><th>الصلاحيات</th><th>الحالة</th><th></th></tr></thead><tbody>${rows.map(u => `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.username)}</td><td>${roleAr[u.role]}${u.perms_customized ? ' <span class="badge custom">مخصصة</span>' : ''}</td><td><span class="perm-count">${u.role === 'super_admin' ? 'الكل تلقائيًا' : u.perms_count + ' صلاحية'}</span></td><td>${u.active ? badge('active') : badge('unavailable')}</td><td class="toolbar">${u.role !== 'super_admin' && isSuperAdmin() ? `<button class="mini-btn" onclick="permsForm(${u.id},'${esc(u.name)}')">صلاحيات</button>` : ''}${hasPerm('edit_user') ? `<button class="mini-btn" onclick='editUser(${JSON.stringify(u)})'>تعديل</button>` : ''}${hasPerm('disable_user') && u.id !== user.id ? `<button class="mini-btn" onclick="toggleUser(${u.id},${u.active})">${u.active ? 'تعطيل' : 'تفعيل'}</button>` : ''}${hasPerm('delete_user') && u.id !== user.id ? `<button class="mini-btn" style="color:#a72f3a" onclick="deleteUser(${u.id},'${esc(u.name)}')">حذف</button>` : ''}</td></tr>`).join('')}</tbody></table></div></section>`;
  },

  /* ---------- حسابي ---------- */
  async profile() {
    $('#content').innerHTML = head('حسابي', 'تغيير كلمة المرور وتأمين الحساب') +
      `<section class="panel" style="max-width:650px"><div class="panel-head"><h3>${esc(user.name)}</h3><span>${isSuperAdmin() ? 'مدير النظام — جميع الصلاحيات' : roleAr[user.role]}</span></div><form id="profilePasswordForm" class="panel-body"><div class="field"><label>كلمة المرور الحالية<input type="password" name="currentPassword" required></label></div><div class="field"><label>كلمة المرور الجديدة<input type="password" name="newPassword" minlength="8" required></label></div><button class="btn secondary">تغيير كلمة المرور</button></form></section>`;
    $('#profilePasswordForm').onsubmit = async e => {
      e.preventDefault();
      try { await api('/api/change-password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); user.mustChangePassword = false; toast('تم تغيير كلمة المرور بنجاح'); e.target.reset(); } catch (x) { toast(x.message, true); }
    };
  },

  /* ---------- الإعدادات ---------- */
  async settings() {
    await loadSettings();
    const showBrand = hasPerm('edit_branding');
    let backups = hasPerm('backup') ? await api('/api/backups') : [];
    $('#content').innerHTML = head('إعدادات النظام', 'بيانات الشركة المركزية: الهوية والتواصل والنسخ الاحتياطي') +
      `<div class="grid-2">${showBrand ? `<section class="panel"><div class="panel-head"><h3>بيانات الشركة</h3><small style="font-size:11px;color:var(--muted)">تُطبَّق تلقائيًا على النظام وكل مستندات PDF الجديدة — والأرشيف القديم يبقى كما أُنشئ</small></div>
      <form id="brandForm" class="panel-body"><div class="form-grid">
        <div class="field"><label>اسم الشركة (عربي)<input name="company_name_ar" value="${esc(settings.company_name_ar)}"></label></div>
        <div class="field"><label>اسم الشركة (إنجليزي)<input name="company_name_en" value="${esc(settings.company_name_en)}"></label></div>
        <div class="field"><label>اسم الموقع / اسم النظام<input name="site_name" value="${esc(settings.site_name || '')}" placeholder="يظهر في الدخول والقائمة والتقارير وPDF"></label></div>
        <div class="field"><label>الهاتف الرئيسي<input name="phone_main" value="${esc(settings.phone_main || '')}"></label></div>
        <div class="field"><label>هاتف إضافي<input name="phone_extra" value="${esc(settings.phone_extra || '')}"></label></div>
        <div class="field"><label>واتساب<input name="whatsapp" value="${esc(settings.whatsapp || '')}"></label></div>
        <div class="field"><label>البريد الإلكتروني<input name="email" value="${esc(settings.email || '')}"></label></div>
        <div class="field full"><label>العنوان<input name="address" value="${esc(settings.address || '')}"></label></div>
        <div class="field"><label>الموقع الإلكتروني<input name="contact_website" value="${esc(settings.contact_website || '')}"></label></div>
        <div class="field"><label>إنستقرام<input name="contact_instagram" value="${esc(settings.contact_instagram || '')}"></label></div>
        <div class="field"><label>رقم السجل التجاري<input name="cr_number" value="${esc(settings.cr_number || '')}"></label></div>
        <div class="field"><label>الرقم الضريبي<input name="tax_number" value="${esc(settings.tax_number || '')}"></label></div>
        <div class="field full"><label>بيانات إضافية تظهر في المستندات والتقارير<input name="doc_footer_note" value="${esc(settings.doc_footer_note || '')}" placeholder="مثال: الأسعار تشمل ضريبة القيمة المضافة"></label></div>
        <div class="color-row"><div class="field"><label>اللون الرئيسي<input type="color" name="primary_color" value="${settings.primary_color}"></label></div><div class="field"><label>اللون الثانوي<input type="color" name="secondary_color" value="${settings.secondary_color}"></label></div><div class="field"><label>الذهبي<input type="color" name="accent_color" value="${settings.accent_color}"></label></div></div>
        <div class="form-actions full"><button class="btn primary">حفظ بيانات الشركة</button></div></div></form>
        <form id="logoForm" class="panel-body" style="border-top:1px solid var(--line)"><div class="field"><label>شعار الشركة — PNG أو JPG (الشفافية مدعومة) يُستخدم تلقائيًا في كل ملفات PDF اللاحقة<input type="file" name="logo" accept="image/png,image/jpeg" required></label></div>
        <div class="toolbar" style="margin-top:10px"><button class="btn secondary">رفع الشعار الجديد</button>${settings.logo_url ? '<button type="button" class="btn danger" onclick="removeLogo()">إزالة الشعار</button>' : ''}</div></form></section>` : ''}
      <section class="panel"><div class="panel-head"><h3>الأمان</h3></div><form id="passwordForm" class="panel-body"><div class="field"><label>كلمة المرور الحالية<input type="password" name="currentPassword" required></label></div><div class="field"><label>كلمة المرور الجديدة<input type="password" name="newPassword" minlength="8" required></label></div><button class="btn secondary">تغيير كلمة المرور</button></form></section></div>
      ${(hasPerm('backup') || hasPerm('restore')) ? `<section class="panel"><div class="panel-head"><h3>النسخ الاحتياطي والاستعادة</h3>${hasPerm('backup') ? '<button class="btn primary" onclick="createBackup()">إنشاء نسخة الآن</button>' : ''}</div><div class="table-wrap"><table><thead><tr><th>الملف</th><th>المستخدم</th><th>الحجم</th><th>التاريخ</th><th></th></tr></thead><tbody>${backups.map(b => '<tr><td>' + esc(b.filename) + '</td><td>' + esc(b.user_name) + '</td><td>' + (b.size / 1024).toFixed(1) + ' KB</td><td>' + dtstr(b.created_at) + '</td><td>' + (hasPerm('restore') ? '<button class="mini-btn" onclick="restoreBackup(' + b.id + ',\'' + esc(b.filename) + '\')">استعادة</button>' : '') + '</td></tr>').join('') || '<tr><td colspan="5">لا توجد نسخ</td></tr>'}</tbody></table></div></section>` : ''}`;
    bindSettings();
  }
};



/* ============================================================
   العملاء والمتبقيات ولوحة الأرباح
   ============================================================ */
function invoiceSaleHtml(d){const s=d.sale,f=d.finance,b=d.beneficiary;return `<div class="invoice-head"><div><small>فاتورة بيع عقارية</small><h2>${esc(s.invoice_no||'—')}</h2><span>رقم البيع: ${esc(s.sale_no)} • ${esc(s.sale_date)}</span></div><div>${badge(s.status)}</div></div><div class="details-grid"><div class="detail"><small>المشروع / الوحدة</small><b>${esc(s.project_name)} — ${esc(s.unit_number)}</b></div><div class="detail"><small>العميل / المالك</small><b>${esc(s.customer_name)}</b></div><div class="detail"><small>نوع العملية</small><b>${s.is_resale?'إعادة بيع / بيع ثانٍ':'بيع أول'}</b></div><div class="detail"><small>الجهة المستفيدة</small><b>${esc(b.name)}</b></div><div class="detail"><small>الحساب المستفيد</small><b>${esc(b.account)}</b></div><div class="detail"><small>قيمة البيع النهائية</small><b>${money(f.final)}</b></div></div><div class="profit-kpis"><div class="fin-card strong"><small>السعر الأساسي</small><b>${money(f.base)}</b></div><div class="fin-card disc"><small>الخصومات</small><b>${money(f.discounts)}</b></div><div class="fin-card pos"><small>المدفوع النهائي</small><b>${money(f.paid)}</b></div><div class="fin-card due"><small>المتبقي النهائي</small><b>${money(Math.max(0,f.remaining))}</b></div><div class="fin-card"><small>العمولة</small><b>${money(f.commission)}</b></div><div class="fin-card"><small>صافي المبلغ / الربح المحقق</small><b>${money(f.net_profit)}</b></div></div>
<section class="panel"><div class="panel-head"><h3>الخصومات بالتفصيل</h3></div><div class="table-wrap"><table><thead><tr><th>الرقم</th><th>التاريخ</th><th>القيمة</th><th>السبب</th><th>المستخدم</th><th>الحالة</th></tr></thead><tbody>${d.discounts.map(x=>`<tr><td>${esc(x.discount_no)}</td><td>${esc(x.discount_date||'')}</td><td>${money(x.amount)}</td><td>${esc(x.reason||'—')}</td><td>${esc(x.created_by_name||'—')}</td><td>${badge(x.status)}</td></tr>`).join('')||'<tr><td colspan="6">لا توجد خصومات</td></tr>'}</tbody></table></div></section>
<section class="panel"><div class="panel-head"><h3>السجل المالي الكامل</h3></div><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>المرجع</th><th>الحركة</th><th>القيمة</th><th>المستخدم</th><th>الرصيد قبل</th><th>الرصيد بعد</th><th>الحالة</th></tr></thead><tbody>${d.movements.map(m=>`<tr><td>${esc(m.date||'')}</td><td><b>${esc(m.reference||'—')}</b></td><td>${esc(m.title)}${m.reason?'<br><small>'+esc(m.reason)+'</small>':''}</td><td>${money(m.amount)}</td><td>${esc(m.user||'النظام')}</td><td>${money(m.balance_before)}</td><td>${money(m.balance_after)}</td><td>${badge(m.status==='cancelled'?'cancelled':'active')}</td></tr>`).join('')}</tbody></table></div></section>
${d.settlement?`<section class="panel"><div class="panel-head"><h3>التصفية المرتبطة</h3><button class="mini-btn" onclick="showSettlementReport(${d.settlement.id})">فتح التصفية</button></div><div class="panel-body">فاتورة التصفية: <b>${esc(d.settlement.invoice_no||'—')}</b> • التقرير: ${esc(d.settlement.report_no)} • ${badge(d.settlement.status)}</div></section>`:''}`;}
window.viewInvoice=async id=>{const d=await api(`/api/sales/${id}/financial-record`);window._invoiceRecord=d;modal(`${invoiceSaleHtml(d)}<div class="form-actions"><button class="btn ghost" onclick="go('${d.beneficiary.type==='company'?'profits':'investorSettlements'}');closeModal()">الانتقال إلى ${d.beneficiary.type==='company'?'حساب الشركة':'حساب المستثمر'}</button>${hasPerm('add_payment')?`<button class="btn ghost" onclick="adjustmentForm(${id})">تسوية مبلغ مفقود</button>`:''}${hasPerm('export_pdf')?`<button class="btn secondary" onclick="invoicePdf(${id})">تنزيل PDF</button>`:''}</div>`,true);};
window.invoicePdf=id=>exportDoc('sale_invoice',{sale_id:id},false);
window.adjustmentForm=saleId=>{modal(`<h2 class="modal-title">تسوية مبلغ مفقود أو غير مسجل</h2><p class="modal-sub">تسجل كحركة مستقلة مرتبطة بالعملية والفاتورة، دون تعديل أو حذف السجل الأصلي.</p><form id="adjForm" class="form-grid"><div class="field"><label>نوع التسوية<select name="adjustment_type"><option value="collection">تحصيل مبلغ غير مسجل</option><option value="balance_debit">إضافة مبلغ إلى ذمة العميل</option><option value="balance_credit">تخفيض ذمة العميل / رصيد تسوية</option></select></label></div><div class="field"><label>القيمة<input type="number" name="amount" min="0.01" step="0.01" required></label></div><div class="field"><label>التاريخ<input type="date" name="adjustment_date" value="${new Date().toISOString().slice(0,10)}" required></label></div><div class="field"><label>طريقة التحصيل<select name="method"><option value="cash">كاش</option><option value="bank_transfer">حوالة</option><option value="check">شيك</option></select></label></div><div class="field"><label>المرجع<input name="ref_no"></label></div><div class="field full"><label>سبب التسوية<input name="reason" required></label></div><div class="form-actions full"><button type="button" class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn primary">تسجيل التسوية</button></div></form>`);$('#adjForm').onsubmit=async e=>{e.preventDefault();try{const d=await api(`/api/sales/${saleId}/adjustments`,{method:'POST',body:Object.fromEntries(new FormData(e.target))});closeModal();toast(`تم تسجيل التسوية ${d.adjustment_no} وتحديث الأرصدة آليًا`);viewInvoice(saleId);}catch(x){toast(x.message,true);}};};
window.showInvoiceSearch=async d=>{if(d.type==='sale'){window._invoiceRecord=d.record;modal(`${invoiceSaleHtml(d.record)}<div class="form-actions"><button class="btn ghost" onclick="go('${d.record.beneficiary.type==='company'?'profits':'investorSettlements'}');closeModal()">فتح الحساب المرتبط</button>${hasPerm('export_pdf')?`<button class="btn secondary" onclick="invoicePdf(${d.record.sale.id})">تنزيل PDF</button>`:''}</div>`,true);}else if(d.type==='investor_settlement'){closeModal();await go('investorSettlements');await showSettlementReport(d.record.id);}else{const b=d.record;modal(`<div class="invoice-head"><div><small>فاتورة تصفية مسوق</small><h2>${esc(b.invoice_no)}</h2><span>${esc(b.settlement_no)} • ${esc(b.marketer_name)}</span></div>${badge(b.status==='active'?'settled':'cancelled')}</div><section class="panel"><div class="table-wrap"><table><thead><tr><th>البيع</th><th>فاتورة البيع</th><th>الوحدة</th><th>العميل</th><th>العمولة المصفاة</th></tr></thead><tbody>${b.items.map(i=>`<tr><td>${esc(i.sale_no)}</td><td>${esc(i.sale_invoice_no||'—')}</td><td>${esc(i.project_name)} — ${esc(i.unit_number)}</td><td>${esc(i.customer_name)}</td><td>${money(i.amount)}</td></tr>`).join('')}</tbody></table></div></section><div class="form-actions">${hasPerm('export_pdf')?`<button class="btn secondary" onclick="marketerSettlementPdf(${b.id})">تنزيل PDF</button>`:''}</div>`,true);}};
window.marketerSettlementPdf=id=>exportDoc('marketer_settlement_invoice',{batch_id:id},false);

window.loadCustomerFinance=async()=>{
  const q=new URLSearchParams(),search=$('#cfSearch')?.value?.trim(),project=$('#cfProject')?.value;if(search)q.set('search',search);if(project)q.set('project_id',project);if($('#cfOutstanding')?.checked)q.set('outstanding','1');
  const d=await api('/api/customer-finance?'+q),b=$('#customerFinanceBody');if(!b)return;
  b.innerHTML=`<div class="summary-strip"><div class="stat wine"><small>قيمة المبيعات</small><b>${money(d.totals.sales)}</b></div><div class="stat green"><small>المحصل فعليًا</small><b>${money(d.totals.paid)}</b></div><div class="stat orange"><small>المتبقي على العملاء</small><b>${money(d.totals.remaining)}</b></div><div class="stat"><small>عدد العمليات</small><b>${d.rows.length}</b></div></div>
  <section class="panel"><div class="table-wrap"><table><thead><tr><th>العميل</th><th>المشروع / الوحدة</th><th>نوع البيع</th><th>قيمة البيع</th><th>المدفوع</th><th>المتبقي</th><th>آخر دفعة</th><th>حالة التصفية</th><th></th></tr></thead><tbody>${d.rows.map(r=>`<tr><td><b>${esc(r.customer_name)}</b><br><small>${esc(r.phone)}</small></td><td>${esc(r.project_name)} — ${esc(r.unit_number)}<br><small>${esc(r.invoice_no||'—')} • ${esc(r.sale_no)}</small></td><td>${r.is_resale?'إعادة بيع':'بيع أول'}</td><td>${money(r.final_price)}</td><td class="money-pos">${money(r.paid_amount)}</td><td class="money-neg">${money(Math.max(0,r.remaining_amount))}</td><td>${r.last_payment_date?`${esc(r.last_payment_date)} — ${money(r.last_payment_amount)}`:'—'}</td><td>${badge(r.settlement_status)}</td><td class="toolbar"><button class="mini-btn" onclick="customerStatement(${r.customer_id})">كشف حساب العميل</button><button class="mini-btn" onclick="viewInvoice(${r.sale_id})">عرض الفاتورة</button>${hasPerm('export_pdf')?`<button class="mini-btn" onclick="invoicePdf(${r.sale_id})">تنزيل PDF</button>`:''}</td></tr>`).join('')||'<tr><td colspan="9"><div class="empty">لا توجد مبالغ مطابقة</div></td></tr>'}</tbody></table></div></section>`;decorateIcons(b);
};
window.customerStatement=async id=>{const d=await api('/api/customer-finance/'+id);modal(`<div class="details-hero"><small>كشف حساب العميل</small><h2>${esc(d.customer.name)}</h2><span>${esc(d.customer.phone)}${d.customer.email?' • '+esc(d.customer.email):''}</span></div><div class="summary-strip"><div class="stat wine"><small>المبيعات</small><b>${money(d.totals.sales)}</b></div><div class="stat green"><small>المحصل</small><b>${money(d.totals.paid)}</b></div><div class="stat orange"><small>المتبقي</small><b>${money(d.totals.remaining)}</b></div><div class="stat"><small>الحالة</small><b>${statusAr[d.settlement_status]||d.settlement_status}</b></div></div>
<section class="panel"><div class="panel-head"><h3>الوحدات والمبيعات</h3></div><div class="table-wrap"><table><thead><tr><th>البيع</th><th>المشروع/الوحدة</th><th>القيمة</th><th>المحصل</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>${d.sales.map(s=>`<tr><td><b>${esc(s.sale_no)}</b><br><small>${s.is_resale?'إعادة بيع':'بيع أول'}</small></td><td>${esc(s.project_name)} — ${esc(s.unit_number)}</td><td>${money(s.final_price)}</td><td class="money-pos">${money(s.paid_amount)}</td><td class="money-neg">${money(Math.max(0,s.remaining_amount))}</td><td>${badge(s.finance.client_state==='settled'?'settled':s.paid_amount>0?'partial':'unpaid')}</td></tr>`).join('')}</tbody></table></div></section>
<section class="panel"><div class="panel-head"><h3>سجل الدفعات والخصومات والمصروفات والتعديلات</h3><span class="perm-count">${d.movements.length} حركة</span></div><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>المرجع</th><th>العملية</th><th>البيع / الوحدة</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>${d.movements.map(m=>`<tr><td>${esc(m.movement_date||'')}</td><td>${esc(m.reference)}</td><td>${esc(m.title)}</td><td>${esc(m.sale_no)} — ${esc(m.unit_number)}</td><td>${m.amount?money(m.amount):'—'}</td><td>${m.status==='active'?badge('active'):badge('cancelled')}</td></tr>`).join('')||'<tr><td colspan="6"><div class="empty">لا توجد حركات</div></td></tr>'}</tbody></table></div></section>`,true);};
window.loadProfitDashboard=async()=>{const q=new URLSearchParams(),f=$('#pfFrom')?.value,t=$('#pfTo')?.value,p=$('#pfProject')?.value;if(f)q.set('date_from',f);if(t)q.set('date_to',t);if(p)q.set('project_id',p);const [d,audit]=await Promise.all([api('/api/finance/profit-dashboard?'+q),api('/api/finance/audit?'+q)]),x=d.totals,b=$('#profitBody');if(!b)return;b.innerHTML=`<div class="profit-formula">${esc(d.formula)}</div><div class="profit-kpis"><div class="fin-card strong"><small>إجمالي المبيعات</small><b>${money(x.sales)}</b></div><div class="fin-card pos"><small>المبالغ المحصلة</small><b>${money(x.collected)}</b></div><div class="fin-card due"><small>المتبقي على العملاء</small><b>${money(x.receivables)}</b></div><div class="fin-card"><small>تكلفة العقارات</small><b>${money(x.property_cost)}</b></div><div class="fin-card disc"><small>المصروفات الأخرى</small><b>${money(x.expenses)}</b></div><div class="fin-card"><small>عمولات المسوقين</small><b>${money(x.commissions)}</b></div><div class="fin-card loss"><small>إجمالي التكاليف</small><b>${money(x.total_costs)}</b></div><div class="fin-card ${x.net_profit>=0?'profit':'loss'}"><small>صافي الربح الحقيقي</small><b>${money(x.net_profit)}</b></div></div>
<section class="panel"><div class="panel-head"><h3>تفصيل الربح حسب عملية البيع</h3><span class="perm-count">${d.rows.length} عملية مستقلة</span></div><div class="table-wrap"><table><thead><tr><th>البيع</th><th>المشروع/الوحدة</th><th>النوع</th><th>قيمة البيع</th><th>المحصل</th><th>الذمم</th><th>تكلفة العقار</th><th>المصروفات</th><th>العمولة</th><th>صافي الربح المحقق</th></tr></thead><tbody>${d.rows.map(r=>`<tr><td><b>${esc(r.sale_no)}</b></td><td>${esc(r.project_name)} — ${esc(r.unit_number)}</td><td>${r.is_resale?'إعادة بيع':'بيع أول'}</td><td>${money(r.final)}</td><td class="money-pos">${money(r.realized_revenue)}</td><td class="money-neg">${money(Math.max(0,r.remaining))}</td><td>${money(r.property_cost)}</td><td>${money(r.expenses)}</td><td>${money(r.commission)}</td><td class="${r.net_profit>=0?'money-pos':'money-neg'}"><b>${money(r.net_profit)}</b></td></tr>`).join('')||'<tr><td colspan="10"><div class="empty">لا توجد عمليات</div></td></tr>'}</tbody></table></div></section><section class="panel"><div class="panel-head"><h3>سجل التدقيق المالي</h3><span class="perm-count">آخر ${audit.length} تعديل</span></div><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>المستخدم</th><th>العملية</th><th>رقم البيع</th><th>القيمة السابقة</th><th>القيمة الجديدة</th><th>السبب</th></tr></thead><tbody>${audit.map(a=>`<tr><td>${dtstr(a.created_at)}</td><td>${esc(a.user_name||'النظام')}</td><td>${esc(a.action)}</td><td>${esc(a.sale_no||'—')}</td><td><small>${esc(a.old_values||'{}')}</small></td><td><small>${esc(a.new_values||'{}')}</small></td><td>${esc(a.reason||'—')}</td></tr>`).join('')||'<tr><td colspan="7"><div class="empty">لا توجد تعديلات مالية</div></td></tr>'}</tbody></table></div></section>`;};

/* ============================================================
   تقارير تصفية مستحقات إعادة البيع
   ============================================================ */
window.loadMarketerSettlement=async()=>{const id=+$('#msMarketer')?.value;if(!id)return toast('اختر المسوق',true);const [a,account]=await Promise.all([api(`/api/marketers/${id}/unsettled-commissions`),api(`/api/marketers/${id}/account`)]);window._msRows=a;window._msId=id;const b=$('#settlementBody'),total=a.reduce((x,r)=>x+r.remaining,0);b.innerHTML=`<div class="summary-strip"><div class="stat"><small>المسوق</small><b>${esc(account.marketer.name)}</b></div><div class="stat"><small>العمليات غير المصفاة</small><b>${a.length}</b></div><div class="stat orange"><small>إجمالي المستحق</small><b>${money(total)}</b></div><div class="stat green"><small>المصفى سابقًا</small><b>${money(account.totals.settled)}</b></div></div>
<section class="panel"><div class="panel-head"><h3>بنود التصفية — كل عمولة مرتبطة بعملية مستقلة</h3>${hasPerm('pay_commission')&&a.length?'<button class="btn secondary" onclick="marketerBatchForm()">تصفية إجمالية للمحدد</button>':''}</div><div class="table-wrap"><table><thead><tr><th><input type="checkbox" checked onchange="document.querySelectorAll('.ms-check').forEach(x=>x.checked=this.checked)"></th><th>البيع</th><th>النوع</th><th>المشروع / الوحدة</th><th>العميل</th><th>قيمة البيع</th><th>العمولة</th><th>المصفى</th><th>المتبقي</th></tr></thead><tbody>${a.map(r=>`<tr><td><input class="ms-check" type="checkbox" value="${r.sale_id}" checked></td><td><b>${esc(r.sale_no)}</b><br><small>${esc(r.sale_date)}</small></td><td>${r.is_resale?'إعادة بيع':'بيع أول'}</td><td>${esc(r.project_name)} — ${esc(r.unit_number)}</td><td>${esc(r.customer_name)}</td><td>${money(r.final_price)}</td><td>${money(r.commission_total)}</td><td class="money-pos">${money(r.commission_paid)}</td><td class="money-neg">${money(r.remaining)}</td></tr>`).join('')||'<tr><td colspan="9"><div class="empty"><b>جميع عمولات المسوق مصفاة</b>لا توجد بنود قابلة للإدراج في تصفية جديدة</div></td></tr>'}</tbody></table></div></section>`;decorateIcons(b);};
window.marketerBatchForm=()=>{const ids=$$('.ms-check:checked').map(x=>+x.value),rows=(window._msRows||[]).filter(x=>ids.includes(x.sale_id)),total=rows.reduce((a,r)=>a+r.remaining,0);if(!ids.length)return toast('حدد عمولة واحدة على الأقل',true);modal(`<h2 class="modal-title">تصفية إجمالية للمسوق</h2><p class="modal-sub">${ids.length} عمولة مستقلة — إجمالي ${money(total)}. بعد التنفيذ لن تظهر البنود المصفاة في تصفية جديدة.</p><form id="msBatchForm" class="form-grid"><div class="field"><label>تاريخ التصفية<input type="date" name="settlement_date" value="${new Date().toISOString().slice(0,10)}" required></label></div><div class="field"><label>الطريقة<select name="method"><option value="cash">كاش</option><option value="bank_transfer">حوالة بنكية</option><option value="check">شيك</option></select></label></div><div class="field"><label>رقم المرجع<input name="ref_no"></label></div><div class="field full"><label>ملاحظات<input name="notes"></label></div><div class="form-actions full"><button type="button" class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn secondary">تنفيذ التصفية الإجمالية</button></div></form>`);$('#msBatchForm').onsubmit=async e=>{e.preventDefault();try{const d=await api(`/api/marketers/${window._msId}/settlement-batches`,{method:'POST',body:{...Object.fromEntries(new FormData(e.target)),sale_ids:ids}});closeModal();toast(`تمت التصفية ${d.settlement_no} — الفاتورة ${d.invoice_no} — بمبلغ ${money(d.total_amount)} وربط ${d.items} عمولة`);loadMarketerSettlement();}catch(x){toast(x.message,true);}};};

function settlementFilters(scope, marketerOnly = false) {
  return `<section class="panel"><div class="panel-body"><div class="filters-adv">
    <div class="field"><label>رقم التقرير<input id="stSearch" placeholder="STR-2026-..." onkeydown="if(event.key==='Enter')loadSettlements('${scope}')"></label></div>
    <div class="field"><label>حالة التصفية<select id="stStatus"><option value="">كل الحالات</option><option value="open">مفتوحة</option><option value="partial">جزئية</option><option value="settled">تمت التصفية</option></select></label></div>
    <div class="filter-actions"><button class="btn primary" onclick="loadSettlements('${scope}')">بحث برقم التقرير</button><button class="btn ghost" onclick="document.getElementById('stSearch').value='';document.getElementById('stStatus').value='';loadSettlements('${scope}')">عرض الكل</button></div>
  </div>${marketerOnly ? '<p class="modal-sub" style="margin:12px 0 0">يعرض هذا القسم بند المسوق في عمليات البيع الثاني فقط، ويمكن تسجيل دفع العمولة مباشرة من التقرير المرتبط.</p>' : ''}</div></section>`;
}
window.loadSettlements = async (scope = 'customers', directReport = '') => {
  const q = new URLSearchParams();
  const search = directReport || document.getElementById('stSearch')?.value?.trim();
  const status = document.getElementById('stStatus')?.value;
  if (search) q.set('search', search); if (status) q.set('status', status); if (scope === 'marketers') q.set('party_type', 'marketer');
  const rows = await api('/api/settlements?' + q);
  const body = document.getElementById('settlementBody'); if (!body) return;
  if (directReport && rows.length === 1) return showSettlementReport(rows[0].id);
  const filtered = scope === 'marketers' ? rows.filter(r => +r.commission_total > 0) : rows;
  body.innerHTML = `<div class="summary-strip">
    <div class="stat"><small>تقارير البيع الثاني</small><b>${filtered.length}</b></div>
    <div class="stat wine"><small>صافي المستحقات</small><b>${money(filtered.reduce((a,r)=>a+r.total_due,0))}</b></div>
    <div class="stat green"><small>تمت تصفيته</small><b>${money(filtered.reduce((a,r)=>a+r.total_paid,0))}</b></div>
    <div class="stat orange"><small>المتبقي</small><b>${money(filtered.reduce((a,r)=>a+r.total_remaining,0))}</b></div></div>
    <section class="panel"><div class="table-wrap"><table><thead><tr><th>رقم التقرير</th><th>البيع الثاني</th><th>المشروع / الوحدة</th><th>المالك السابق</th><th>المالك الجديد</th><th>قيمة البيع</th><th>الخصومات</th>${scope === 'marketers' ? '<th>العمولة</th><th>مدفوع المسوق</th>' : '<th>المستحقات</th><th>تمت تصفيته</th>'}<th>المتبقي</th><th>الحالة</th><th></th></tr></thead><tbody>${filtered.map(r=>`<tr><td><b class="report-no">${esc(r.report_no)}</b></td><td>${esc(r.sale_no)}<br><small>${esc(r.sale_date)}</small></td><td>${esc(r.project_name)} — ${esc(r.unit_number)}</td><td>${esc(r.prev_owner_name || '—')}</td><td>${esc(r.new_owner_name)}</td><td>${money(r.final_price)}</td><td>${money(r.discount_amount)}</td>${scope === 'marketers' ? `<td>${money(r.commission_total)}</td><td class="money-pos">${money(r.commission_paid)}</td>` : `<td>${money(r.total_due)}</td><td class="money-pos">${money(r.total_paid)}</td>`}<td class="money-neg">${money(scope === 'marketers' ? Math.max(0,r.commission_total-r.commission_paid) : r.total_remaining)}</td><td>${badge(r.status)}</td><td><button class="mini-btn" onclick="showSettlementReport(${r.id})">التفاصيل والتصفية</button></td></tr>`).join('') || '<tr><td colspan="13"><div class="empty"><b>لا توجد تقارير تصفية مطابقة</b>تُنشأ التقارير تلقائيًا لكل عملية إعادة بيع</div></td></tr>'}</tbody></table></div></section>`;
  decorateIcons(body);
};
window.showSettlementReport = async id => {
  const d = await api('/api/settlements/' + id);
  window._settlementReport = d;
  const body = document.getElementById('settlementBody') || document.getElementById('content');
  const backAction=currentPage==='investorSettlements'?"go('investorSettlements')":`loadSettlements('${currentPage==='marketerSettlements'?'marketers':'customers'}')`;
  const partyAr={new_owner:'المالك الجديد',previous_owner:'المالك السابق / المساهم',company:'الشركة',marketer:'المسوق'};
  const dirAr={receivable:'مستحق للشركة',payable:'مستحق للطرف'};
  body.innerHTML = `<div class="page-head"><div><h1 style="font-size:20px">فاتورة التصفية <span class="report-no">${esc(d.invoice_no||d.report_no)}</span></h1><p>مرتبط بالبيع ${esc(d.sale_no)} — ${esc(d.project_name)} / الوحدة ${esc(d.unit_number)}</p></div><div class="toolbar"><button class="btn ghost" onclick="${backAction}">العودة للقائمة</button>${hasPerm('export_pdf')?`<button class="btn ghost" onclick="settlementPdf(${d.id},false)">تصدير PDF</button>`:''}${hasPerm('save_pdf')?`<button class="btn secondary" onclick="settlementPdf(${d.id},true)">حفظ PDF</button>`:''}</div></div>
  <section class="settlement-hero"><div><small>رقم التقرير الفريد</small><b>${esc(d.report_no)}</b></div><div><small>العملية الأصلية</small><b>${esc(d.sale_no)}</b></div><div><small>حالة التصفية</small>${badge(d.status)}</div></section>
  <div class="fin-grid"><div class="fin-card strong"><small>قيمة البيع الثاني</small><b>${money(d.final_price)}</b></div><div class="fin-card disc"><small>الخصومات</small><b>${money(d.discount_amount)}</b></div><div class="fin-card pos"><small>المدفوع</small><b>${money(d.paid_amount)}</b></div><div class="fin-card due"><small>المتبقي على المالك الجديد</small><b>${money(d.remaining_amount)}</b></div><div class="fin-card"><small>عمولة المسوق</small><b>${money(d.commission_total)}</b></div></div>
  <section class="panel"><div class="panel-head"><h3>أطراف التصفية — الشركة والعملاء والمساهمون والمسوق</h3><span>${badge(d.status)}</span></div><div class="table-wrap"><table><thead><tr><th>الطرف</th><th>صفة الطرف</th><th>نوع المستحق</th><th>الإجمالي</th><th>الخصومات / الاستقطاعات</th><th>صافي المستحق</th><th>تمت تصفيته</th><th>المتبقي</th><th>الحالة</th><th></th></tr></thead><tbody>${d.entries.map(e=>`<tr><td><b>${esc(e.party_name)}</b><br><small>${esc(e.notes||'')}</small></td><td>${partyAr[e.party_type]||e.party_type}</td><td>${dirAr[e.direction]||e.direction}</td><td>${money(e.gross_amount)}</td><td>${money(e.deductions)}</td><td><b>${money(e.net_amount)}</b></td><td class="money-pos">${money(e.settled_amount)}</td><td class="money-neg">${money(e.remaining_amount)}</td><td>${badge(e.status)}</td><td>${hasPerm('manage_settlements')&&e.remaining_amount>0?`<button class="mini-btn" onclick="settlementPayForm(${d.id},${e.id},'${esc(e.party_name)}',${e.remaining_amount})">تسجيل التصفية</button>`:'—'}</td></tr>`).join('')}</tbody></table></div></section>
  <section class="panel"><div class="panel-head"><h3>نشاط التصفية بالكامل</h3><span class="perm-count">${d.activity.length} حركة</span></div><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>رقم التقرير</th><th>رقم الحركة</th><th>العملية</th><th>الطرف</th><th>المبلغ</th><th>إجمالي المدفوع</th><th>المتبقي</th><th>حالة التصفية</th></tr></thead><tbody>${d.activity.map(a=>`<tr><td>${dtstr(a.date)}</td><td>${esc(d.report_no)}</td><td><b>${esc(a.number)}</b></td><td>${esc(a.operation)}</td><td>${esc(a.party)}</td><td>${money(a.amount)}</td><td class="money-pos">${money(a.paid)}</td><td class="money-neg">${money(a.remaining)}</td><td>${a.status==='cancelled'?badge('cancelled'):badge(a.settlement_status)}</td></tr>`).join('')||'<tr><td colspan="9"><div class="empty">لا توجد حركات حتى الآن</div></td></tr>'}</tbody></table></div></section>`;
  decorateIcons(body);
};
window.settlementPayForm=(reportId,entryId,party,remaining)=>{
  modal(`<h2 class="modal-title">تسجيل تصفية — ${esc(party)}</h2><p class="modal-sub">المتبقي ${money(remaining)}. ستنعكس الحركة تلقائيًا على التقرير والبيع أو عمولة المسوق حسب الطرف.</p><form id="stPayForm" class="form-grid"><div class="field"><label>المبلغ<input type="number" name="amount" min="0.01" max="${remaining}" step="0.01" value="${remaining}" required></label></div><div class="field"><label>التاريخ<input type="date" name="transaction_date" value="${new Date().toISOString().slice(0,10)}" required></label></div><div class="field"><label>الطريقة<select name="method"><option value="cash">كاش</option><option value="bank_transfer">حوالة بنكية</option><option value="check">شيك</option></select></label></div><div class="field"><label>رقم المرجع<input name="ref_no"></label></div><div class="field full"><label>ملاحظات<input name="notes" placeholder="بيان التصفية"></label></div><div class="form-actions full"><button type="button" class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn primary">تسجيل التصفية</button></div></form>`);
  $('#stPayForm').onsubmit=async e=>{e.preventDefault();try{await api(`/api/settlements/${reportId}/transactions`,{method:'POST',body:{...Object.fromEntries(new FormData(e.target)),entry_id:entryId}});closeModal();toast('تم تسجيل التصفية وتحديث جميع السجلات المرتبطة');showSettlementReport(reportId);}catch(x){toast(x.message,true);}};
};
window.settlementPdf=(id,save)=>exportDoc('settlement_report',{report_id:id},save);

/* ============================================================
   البحث والنتائج
   ============================================================ */
async function runSearch(q) {
  lastSearch = { ...q };
  const d = await api('/api/units?limit=100&' + new URLSearchParams(q).toString());
  const resultsHtml = d.rows.length ? `<div class="cards">${d.rows.map(unitCard).join('')}</div>` : '<div class="empty"><b>لا توجد وحدات مطابقة</b>غيّر معايير البحث وحاول مرة أخرى</div>';
  $('#searchResults').innerHTML =
    `<div class="page-head"><div><h1 style="font-size:18px">النتائج (${d.total})</h1><p>تم إرجاع الوحدات المطابقة للمعايير المحددة</p></div>
     <div class="toolbar">${window._searchBtns || ''}</div></div>${resultsHtml}`;
}
function unitCard(u) {
  return `<article class="unit-card"><div class="unit-top"><div><small>${esc(u.project_name)}</small><div class="unit-no">${esc(u.unit_number)}</div></div>${badge(u.status)}</div>
    <div class="unit-meta"><div>النموذج<b>${esc(u.model_code || '—')}</b></div><div>الدور<b>${esc(u.floor_name)}</b></div><div>الغرف<b>${u.display_rooms || '—'}</b></div><div>المساحة<b>${u.display_area || '—'} م²</b></div><div>المرحلة<b>${phaseAr[u.sell_phase] || '—'}</b></div><div>المشروع<b>${statusAr[u.construction_status] || u.construction_status}</b></div></div>
    <div class="card-foot">${u.price == null ? '<span class="phase-chip">الأسعار بصلاحيتك</span>' : `<span class="price">${money(u.effective_price ?? u.price)}${u.eff_discount > 0 ? `<span class="discount-tag">خصم ${money(u.eff_discount)}</span>` : ''}</span>`}<button class="btn ${['available', 'resale'].includes(u.status) ? 'primary' : 'ghost'}" onclick="unitDetails(${u.id})">${['available', 'resale'].includes(u.status) ? 'عرض وحجز' : 'عرض الوحدة'}</button></div></article>`;
}
function unitsTable(rows) {
  return `<section class="panel"><div class="table-wrap"><table><thead><tr><th>الوحدة</th><th>المشروع</th><th>الدور</th><th>النموذج</th><th>الغرف</th><th>المساحة</th><th>السعر</th><th>المرحلة</th><th>الحالة</th><th></th></tr></thead><tbody>${rows.map(u => `<tr><td><b>${esc(u.unit_number)}</b></td><td>${esc(u.project_name)}</td><td>${esc(u.floor_name)}</td><td>${esc(u.model_code || '—')}</td><td>${u.display_rooms || '—'}</td><td>${u.display_area || '—'} م²</td><td>${u.price == null ? '—' : money(u.price)}</td><td>${phaseAr[u.sell_phase] || '—'}</td><td>${badge(u.status)}</td><td><button class="btn ghost" onclick="unitDetails(${u.id})">عرض</button> ${hasPerm('edit_unit') ? `<button class="btn ghost" onclick="unitForm(${u.id})">تعديل</button>` : ''}${hasPerm('delete_unit') ? ` <button class="btn danger" onclick="deleteUnit(${u.id},'${esc(u.unit_number)}')">حذف</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="10"><div class="empty">لا توجد وحدات</div></td></tr>'}</tbody></table></div></section>`;
}

/* ============================================================
   نماذج المشاريع والأدوار والنماذج والوحدات
   ============================================================ */
window.go = go;
window.projectForm = p => {
  p = p || {};
  modal(`<h2 class="modal-title">${p.id ? 'تعديل المشروع' : 'إضافة مشروع جديد'}</h2><p class="modal-sub">بيانات المشروع وحالته الإنشائية</p><form id="projectForm" class="form-grid">
    <div class="field"><label>اسم المشروع<input name="name" value="${esc(p.name || '')}" required></label></div>
    <div class="field"><label>رمز المشروع<input name="code" value="${esc(p.code || '')}" required></label></div>
    <div class="field"><label>الموقع<input name="location" value="${esc(p.location || '')}"></label></div>
    <div class="field"><label>حالة الإنشاء<select name="construction_status"><option value="under_construction">تحت الإنشاء</option><option value="completed" ${p.construction_status === 'completed' ? 'selected' : ''}>مكتمل</option><option value="paused">متوقف مؤقتًا</option></select></label></div>
    <div class="field"><label>نسبة الإنجاز<input type="number" min="0" max="100" name="progress" value="${p.progress || 0}"></label></div>
    <div class="field"><label>تاريخ الإنجاز المتوقع<input type="date" name="expected_date" value="${p.expected_date || ''}"></label></div>
    <div class="field full"><label>ملاحظات<textarea name="notes">${esc(p.notes || '')}</textarea></label></div>
    <div class="form-actions full"><button type="button" class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn primary">حفظ المشروع</button></div></form>`);
  $('#projectForm').onsubmit = async e => {
    e.preventDefault(); let b = Object.fromEntries(new FormData(e.target));
    try { await api(p.id ? '/api/projects/' + p.id : '/api/projects', { method: p.id ? 'PUT' : 'POST', body: { ...p, ...b, sales_status: p.sales_status || 'available' } }); closeModal(); toast('تم حفظ المشروع'); go('projects'); } catch (x) { toast(x.message, true); }
  };
};
window.deleteProject = async (id, name) => {
  if (!confirmBox(`حذف المشروع «${name}» نهائيًا من القوائم؟ (لن يُسمح إن كان عليه مبيعات أو حجوزات نشطة)`)) return;
  try { await api('/api/projects/' + id, { method: 'DELETE' }); toast('تم حذف المشروع'); go('projects'); } catch (x) { toast(x.message, true); }
};
window.loadStructure = async id => {
  if (!id) { $('#structure').innerHTML = ''; return; }
  let [f, m] = await Promise.all([api(`/api/projects/${id}/floors`), api(`/api/projects/${id}/models`)]);
  cache.floors = f; cache.models = m;
  $('#structure').innerHTML = `<div class="grid-2"><section class="panel"><div class="panel-head"><h3>الأدوار (${f.length})</h3>${hasPerm('edit_project') ? `<button class="btn primary" onclick="floorForm(${id})">+ دور</button>` : ''}</div><div class="panel-body quick-list">${f.map(x => `<div class="quick-row"><span><b>${esc(x.name)}</b> ${x.is_roof ? '— روفات' : ''}</span><span>الترتيب ${x.floor_order} ${hasPerm('edit_project') ? `<button class="btn ghost" onclick='floorForm(${id},${JSON.stringify(x)})'>تعديل</button>` : ''}</span></div>`).join('') || '<div class="empty">أضف أدوار المشروع</div>'}</div></section>
  <section class="panel"><div class="panel-head"><h3>النماذج (${m.length})</h3>${hasPerm('edit_project') ? `<button class="btn primary" onclick="modelForm(${id})">+ نموذج</button>` : ''}</div><div class="panel-body quick-list">${m.map(x => `<div class="quick-row"><span><b>${esc(x.code)}</b> — ${x.rooms} غرف</span><span>${money(x.base_price)} ${hasPerm('edit_project') ? `<button class="btn ghost" onclick='modelForm(${id},${JSON.stringify(x)})'>تعديل</button>` : ''}</span></div>`).join('') || '<div class="empty">أضف نماذج الشقق</div>'}</div></section></div>`;
};
window.floorForm = (id, x = {}) => {
  modal(`<h2 class="modal-title">${x.id ? 'تعديل الدور' : 'إضافة دور'}</h2><p class="modal-sub">يمكن إضافة أربعة أدوار ثم مستوى خامس للروفات</p><form id="floorForm" class="form-grid">
    <div class="field"><label>اسم الدور<input name="name" value="${esc(x.name || '')}" placeholder="الدور الأول" required></label></div>
    <div class="field"><label>ترتيب الدور<input type="number" name="floor_order" value="${x.floor_order || ''}" min="1" required></label></div>
    <div class="field full"><label><input type="checkbox" name="is_roof" ${x.is_roof ? 'checked' : ''} style="width:auto"> هذا الدور مخصص للروفات</label></div>
    <div class="form-actions full"><button class="btn primary">${x.id ? 'حفظ التعديل' : 'إضافة'}</button></div></form>`);
  $('#floorForm').onsubmit = async e => {
    e.preventDefault(); let b = Object.fromEntries(new FormData(e.target));
    await api(x.id ? '/api/floors/' + x.id : '/api/floors', { method: x.id ? 'PUT' : 'POST', body: { ...b, project_id: id, is_roof: !!b.is_roof } });
    closeModal(); toast('تم حفظ الدور'); loadStructure(id);
  };
};
window.modelForm = (id, x = {}) => {
  modal(`<h2 class="modal-title">${x.id ? 'تعديل النموذج' : 'إضافة نموذج'}</h2><form id="modelForm" class="form-grid">
    <div class="field"><label>رمز النموذج<input name="code" value="${esc(x.code || '')}" placeholder="A1" required></label></div>
    <div class="field"><label>اسم النموذج<input name="name" value="${esc(x.name || '')}" placeholder="ثلاث غرف أمامية"></label></div>
    <div class="field"><label>عدد الغرف<input type="number" name="rooms" value="${x.rooms || ''}" min="1" required></label></div>
    <div class="field"><label>الحمامات<input type="number" name="bathrooms" value="${x.bathrooms || ''}" min="1"></label></div>
    <div class="field"><label>المساحة م²<input type="number" step=".01" name="area" value="${x.area || ''}"></label></div>
    <div class="field"><label>السعر المرجعي<input type="number" name="base_price" value="${x.base_price || ''}"></label></div>
    <div class="field"><label>الواجهة<input name="view" value="${esc(x.view || '')}"></label></div>
    <div class="field full"><label>وصف النموذج<textarea name="description">${esc(x.description || '')}</textarea></label></div>
    <div class="form-actions full"><button class="btn primary">${x.id ? 'حفظ التعديل' : 'إضافة النموذج'}</button></div></form>`);
  $('#modelForm').onsubmit = async e => {
    e.preventDefault();
    await api(x.id ? '/api/models/' + x.id : '/api/models', { method: x.id ? 'PUT' : 'POST', body: { ...x, ...Object.fromEntries(new FormData(e.target)), project_id: id } });
    closeModal(); toast('تم حفظ النموذج'); loadStructure(id);
  };
};
window.unitForm = async uid => {
  cache.projects = await api('/api/projects');
  let u = uid ? await api('/api/units/' + uid) : {};
  let pid = u.project_id || cache.projects[0]?.id;
  if (!pid) return toast('أضف مشروعًا أولًا', true);
  let [floors, models] = await Promise.all([api(`/api/projects/${pid}/floors`), api(`/api/projects/${pid}/models`)]);
  if (!floors.length) return toast('أضف أدوار المشروع أولًا', true);
  const statusOpts = [['available', 'متاح'], ['contracted', 'متعاقد'], ['unavailable', 'غير متاح'], ['owner', 'للمالك'], ['investment', 'استثمار']];
  modal(`<h2 class="modal-title">${uid ? 'تعديل الوحدة' : 'إضافة وحدة'}</h2><p class="modal-sub">السعر والحالة ومرحلة البيع مستقلة لكل وحدة — البيع والحجز وإعادة البيع تتم من شاشة الوحدة</p>
  <form id="unitForm" class="form-grid">
    <div class="field"><label>المشروع<select name="project_id" ${uid ? 'disabled' : ''}>${cache.projects.map(x => `<option value="${x.id}" ${x.id == pid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label></div>
    <div class="field"><label>رقم الوحدة<input name="unit_number" value="${esc(u.unit_number || '')}" required></label></div>
    <div class="field"><label>الدور<select name="floor_id">${floors.map(x => `<option value="${x.id}" ${x.id == u.floor_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label></div>
    <div class="field"><label>النموذج<select name="model_id"><option value="">بدون نموذج</option>${models.map(x => `<option value="${x.id}" ${x.id == u.model_id ? 'selected' : ''}>${esc(x.code)} — ${x.rooms} غرف</option>`).join('')}</select></label></div>
    <div class="field"><label>السعر<input type="number" name="price" value="${u.price || ''}" ${hasPerm('edit_prices') ? '' : 'placeholder=بحق-تعديل-الأسعار'} required></label></div>
    <div class="field"><label>مرحلة البيع<select name="sell_phase"><option value="off_plan" ${u.sell_phase !== 'completed' ? 'selected' : ''}>تحت الإنشاء</option><option value="completed" ${u.sell_phase === 'completed' ? 'selected' : ''}>بعد اكتمال المشروع</option></select></label></div>
    <div class="field"><label>الحالة<select name="status">${statusOpts.map(([v, n]) => `<option value="${v}" ${u.status === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
    <div class="field"><label>المالك / المساهم<input name="owner_name" value="${esc(u.owner_name || '')}" placeholder="عند وجود مالك بعد الاكتمال"></label></div>
    <div class="field"><label>الغرف (اختياري)<input type="number" name="rooms" value="${u.rooms || ''}"></label></div>
    <div class="field"><label>المساحة م² (اختياري)<input type="number" step=".01" name="area" value="${u.area || ''}"></label></div>
    <div class="field full"><label>الواجهة<input name="view" value="${esc(u.view || '')}"></label></div>
    <div class="field full"><label>ملاحظات<textarea name="notes">${esc(u.notes || '')}</textarea></label></div>
    <div class="form-actions full"><button class="btn primary">حفظ الوحدة</button></div></form>`);
  $('#unitForm').onsubmit = async e => {
    e.preventDefault(); let b = Object.fromEntries(new FormData(e.target)); b.project_id = pid;
    try { await api(uid ? '/api/units/' + uid : '/api/units', { method: uid ? 'PUT' : 'POST', body: { ...u, ...b } }); closeModal(); toast('تم حفظ الوحدة'); go('units'); } catch (x) { toast(x.message, true); }
  };
};
window.deleteUnit = async (id, no) => {
  if (!confirmBox(`حذف الوحدة ${no} نهائيًا؟ (لن يُسمح إن كان لها مبيعات أو حجوزات)`)) return;
  try { await api('/api/units/' + id, { method: 'DELETE' }); toast('تم حذف الوحدة'); go('units'); } catch (x) { toast(x.message, true); }
};

/* ============================================================
   تفاصيل الوحدة (شاملة)
   ============================================================ */
window.unitDetails = async id => {
  cacheUnitId = id;
  const u = await api('/api/units/' + id);
  window._lastUnit = u;
  const saleBox = u.sale ? buildSalePanel(u) : '';
  const reservationBox = u.reservation ? buildReservationPanel(u.reservation) : '';
  const decisionBtns = hasPerm('change_unit_status') && ['sold', 'paid', 'owner', 'unavailable'].includes(u.status)
    ? `<button class="btn ghost" onclick="ownerDecisionForm(${u.id},${u.price || 0},'${esc(u.owner_name || '')}')">قرار ما بعد الاكتمال / إعادة بيع</button>` : '';
  const reserveBtn = u.status === 'available' && hasPerm('add_reservation') ? `<button class="btn primary" onclick="reservationForm(${u.id})">حجز الوحدة</button>` : '';
  const saleBtn = hasPerm('add_sale') && ['available', 'reserved', 'contracted', 'resale'].includes(u.status) ? `<button class="btn secondary" onclick="saleForm(${u.id})">${u.status === 'resale' ? 'تسجيل إعادة البيع' : 'تسجيل بيع'}</button>` : '';
  const docBtns = [
    hasPerm('export_pdf') ? `<button class="btn ghost" onclick="unitOfferDoc(${u.id},false)">عرض PDF</button>` : '',
    hasPerm('print_reports') ? `<button class="btn ghost" onclick="printUnitOffer(${u.id})">طباعة</button>` : '',
    hasPerm('save_pdf') ? `<button class="btn ghost" onclick="unitOfferDoc(${u.id},true)">حفظ</button>` : '',
    hasPerm('delete_unit') && !u.sale && !u.reservation ? `<button class="btn danger" onclick="deleteUnit(${u.id},'${esc(u.unit_number)}');closeModal()">حذف الوحدة</button>` : '',
  ].join('');
  modal(`<div class="details-hero"><small>${esc(u.project_name)} • ${esc(u.floor_name)} • ${statusAr[u.construction_status]}</small><h2>الوحدة ${esc(u.unit_number)}</h2><div>${badge(u.status)} <span class="phase-chip">مرحلة البيع: ${phaseAr[u.sell_phase] || '—'}</span></div></div>
    <div class="details-grid"><div class="detail"><small>النموذج</small><b>${esc(u.model_code || '—')}</b></div><div class="detail"><small>عدد الغرف</small><b>${u.display_rooms || '—'}</b></div><div class="detail"><small>الحمامات</small><b>${u.display_bathrooms || '—'}</b></div><div class="detail"><small>المساحة</small><b>${u.display_area || '—'} م²</b></div><div class="detail"><small>الواجهة</small><b>${esc(u.view || '—')}</b></div><div class="detail"><small>السعر</small><b>${u.price == null ? '—' : money(u.price)}</b></div>${u.owner_name ? `<div class="detail"><small>المالك / المساهم</small><b>${esc(u.owner_name)}</b></div><div class="detail"><small>تاريخ إعادة البيع</small><b>${u.resale_date || '—'}</b></div>` : ''}</div>
    ${reservationBox}${saleBox}
    <div class="form-actions">${reserveBtn}${saleBtn}${decisionBtns}${docBtns}<button class="btn ghost" onclick="closeModal()">إغلاق</button></div>
    <div style="margin-top:18px"><h3 style="font-size:15px;margin:0 0 12px">السجل التاريخي للوحدة</h3><div class="timeline" id="unitTimeline"><div class="empty">جارٍ التحميل...</div></div></div>`, true);
  const ev = await api(`/api/units/${id}/history`);
  const evIcon = t => ({ created: '', sold: 'ev-sold', reserved: 'ev-reserved', payment: 'ev-payment', commission: 'ev-commission', commission_payment: 'ev-commission_payment' }[t] || '');
  $('#unitTimeline').innerHTML = ev.map(x => `<div class="tl-item ${evIcon(x.event_type)}"><b>${esc(x.title)}</b><small>${esc(x.user_name || '')} — <span class="tl-date">${dtstr(x.created_at)}</span></small></div>`).join('') || '<div class="empty">لا توجد أحداث</div>';
};
function buildReservationPanel(r) {
  if (r.private) return `<section class="panel" style="margin-top:18px"><div class="panel-body">هذه الوحدة محجوزة. بيانات الحجز محمية حسب صلاحيتك.</div></section>`;
  return `<section class="panel" style="margin-top:18px"><div class="panel-head"><h3>بيانات الحجز النشط</h3>${badge('active')}</div><div class="panel-body"><div class="details-grid"><div class="detail"><small>رقم الحجز</small><b>${esc(r.reservation_no)}</b></div><div class="detail"><small>العميل</small><b>${esc(r.customer_name || '—')}</b></div><div class="detail"><small>الجوال</small><b>${esc(r.customer_phone || '—')}</b></div><div class="detail"><small>ينتهي في</small><b>${dtstr(r.expires_at)}</b></div><div class="detail"><small>العربون</small><b>${money(r.deposit)}</b></div><div class="detail"><small>الموظف</small><b>${esc(r.employee_name || '—')}</b></div></div></div></section>`;
}
const finStateAr = { due_from_client: 'مستحق على العميل', due_to_client: 'مستحق للعميل', settled: 'مسدد بالكامل' };
function finCard(label, value, cls = '', sub = '') {
  return `<div class="fin-card ${cls}"><small>${label}</small><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
}
function buildSalePanel(u) {
  const s = u.sale;
  const showPrice = hasPerm('view_prices'), showDisc = hasPerm('view_discounts'), showComm = hasPerm('view_commissions');
  const f = s.finance;
  let html = `<section class="panel" style="margin-top:18px"><div class="panel-head"><h3>تفاصيل البيع — ${s.is_resale ? 'عملية إعادة بيع' : 'عملية بيع'}</h3>${badge(s.status)}</div><div class="panel-body">
    <div class="details-grid"><div class="detail"><small>رقم الفاتورة</small><b>${esc(s.invoice_no||'—')}</b></div><div class="detail"><small>رقم البيع</small><b>${esc(s.sale_no)}</b></div><div class="detail"><small>الجهة المستفيدة</small><b>${s.beneficiary_type==='investor'?esc(s.beneficiary_name||s.prev_owner_name||'المستثمر'):'حساب الشركة'}</b></div><div class="detail"><small>التاريخ</small><b>${esc(s.sale_date)}</b></div><div class="detail"><small>العقد</small><b>${esc(s.contract_no || '—')}</b></div><div class="detail"><small>العميل (المالك الجديد)</small><b>${esc(s.customer_name)}</b></div><div class="detail"><small>طريقة الدفع</small><b>${methodAr[s.payment_method] || '—'}</b></div><div class="detail"><small>مرجع العملية</small><b>${esc(s.payment_ref || '—')}</b></div>${s.seller_name ? `<div class="detail"><small>المالك البائع</small><b>${esc(s.seller_name)}</b></div>` : ''}${s.prev_owner_name ? `<div class="detail"><small>المالك السابق</small><b>${esc(s.prev_owner_name)}</b></div><div class="detail"><small>سعر الشراء الأصلي</small><b>${money(s.purchase_price)}</b></div><div class="detail"><small>تاريخ الشراء الأصلي</small><b>${esc(s.purchase_date || '—')}</b></div>` : ''}</div>
  `;
  if (showPrice && f) {
    // ===== اللوحة المالية الاحترافية =====
    const stCls = f.client_state === 'due_from_client' ? 'due' : (f.client_state === 'due_to_client' ? 'credit' : 'settled');
    html += `<h4 class="fin-title">اللوحة المالية</h4><div class="fin-grid">
      ${finCard('سعر العقد (قبل الخصم)', money(f.base))}
      ${finCard('الخصومات', money(f.discounts), f.discounts > 0 ? 'disc' : '', showDisc && f.discounts > 0 ? (s.discounts ? s.discounts.length + ' بند' : '') : '')}
      ${finCard('السعر النهائي بعد الخصم', money(f.final), 'strong')}
      ${finCard('المدفوع', money(f.paid), 'pos')}
      ${finCard(f.client_state === 'due_to_client' ? 'رصيد مستحق للعميل' : (f.client_state === 'settled' ? 'الرصيد' : 'المتبقي على العميل'), money(Math.abs(f.remaining)), stCls, finStateAr[f.client_state])}
      ${s.is_resale ? finCard('سعر إعادة البيع', money(f.final), 'strong') : ''}
    </div>`;
  }
  if (showPrice && f) {
    // الربح المحقق يعتمد على التحصيل الفعلي فقط
    html += `<h4 class="fin-title">الإيرادات والتكاليف والأرباح ${s.investor_name ? '— ' + esc(s.investor_name) : ''}</h4><div class="fin-grid">
      ${finCard('الإيراد المحقق (المحصل)', money(f.realized_revenue), 'pos', 'لا يشمل المتبقي')}
      ${finCard('الذمم المستحقة', money(f.receivable), 'due', 'لا تدخل في الربح')}
      ${finCard('تكلفة العقار', money(f.property_cost))}
      ${finCard('المصروفات الأخرى', money(f.expenses))}
      ${finCard('عمولة المسوق (مصروف بيع)', money(f.commission))}
      ${finCard('إجمالي التكاليف', money(f.total_costs), 'loss')}
      ${finCard('صافي الربح الحقيقي', money(f.net_profit), f.net_profit >= 0 ? 'profit' : 'loss', 'على أساس التحصيل الفعلي')}
    </div>`;
  }
  if (showPrice && !f) {
    html += `<div style="margin-top:14px">
      <div class="kv-money"><span>السعر الأساسي (قبل الخصم)</span><b>${money(s.base_price ?? s.list_price)}</b></div>
      <div class="kv-money"><span>السعر النهائي بعد الخصم</span><b>${money(s.final_price)}</b></div>
      <div class="kv-money"><span>المبلغ المدفوع</span><b class="money-pos">${money(s.paid_amount)}</b></div>
      <div class="kv-money total"><span>المبلغ المتبقي</span><b class="money-neg">${money(s.remaining_amount)}</b></div></div>`;
  }
  if (showDisc && s.discounts && s.discounts.length) {
    html += `<h4 class="fin-title">بنود الخصومات (${s.discounts.length})</h4><div class="table-wrap"><table><thead><tr><th>النوع</th><th>القيمة</th><th>المبلغ</th><th>السبب</th><th>اعتمده</th><th>التاريخ</th>${hasPerm('edit_discounts') ? '<th></th>' : ''}</tr></thead><tbody>${s.discounts.map(d => `<tr><td>${d.type === 'percent' ? 'نسبة %' : 'مبلغ ثابت'}${d.type === 'percent' ? ' (' + d.value + '%)' : ''}</td><td>${fmt(d.value)}</td><td><b>${money(d.amount)}</b></td><td>${esc(d.reason || '—')}</td><td>${esc(d.approved_by || '—')}</td><td>${esc(d.discount_date || '')}</td>${hasPerm('edit_discounts') ? `<td><button class="mini-btn" onclick="cancelDiscount(${d.id})">إلغاء</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
  }
  if (showPrice && s.expenses && s.expenses.length) {
    html += `<h4 class="fin-title">المصروفات (${s.expenses.length})</h4><div class="table-wrap"><table><thead><tr><th>البيان</th><th>المبلغ</th><th>التاريخ</th><th>ملاحظات</th>${hasPerm('edit_sale') ? '<th></th>' : ''}</tr></thead><tbody>${s.expenses.map(e => `<tr><td><b>${esc(e.title)}</b></td><td><b>${money(e.amount)}</b></td><td>${esc(e.expense_date || '')}</td><td>${esc(e.notes || '—')}</td>${hasPerm('edit_sale') ? `<td><button class="mini-btn" onclick="cancelExpense(${e.id})">إلغاء</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
  }
  if (u.payments && u.payments.length) {
    html += `<h4 class="fin-title">الدفعات (${u.payments.length})</h4><div class="table-wrap"><table><thead><tr><th>الرقم</th><th>التاريخ</th><th>الطريقة</th><th>المرجع</th><th>المبلغ</th></tr></thead><tbody>${u.payments.map(p => `<tr><td>${esc(p.payment_no)}</td><td>${esc(p.pay_date)}</td><td>${methodAr[p.method] || p.method}</td><td>${esc(p.ref_no || '—')}</td><td><b>${money(p.amount)}</b></td></tr>`).join('')}</tbody></table></div>`;
  }
  if (showComm && s.commission_total > 0) {
    html += `<div class="commission-box"><h4>عمولة المسوق: ${esc(s.marketer_name || '')} ${s.marketer_code ? '(' + esc(s.marketer_code) + ')' : ''}</h4>
      <div class="kv-money"><span>العمولة المستحقة ${s.commission_type === 'percent' && s.commission_value ? '(' + s.commission_value + '%)' : ''}</span><b>${money(s.commission_total)}</b></div>
      <div class="kv-money"><span>المدفوع للمسوق</span><b class="money-pos">${money(s.commission_paid)}</b></div>
      <div class="kv-money total"><span>المتبقي للمسوق</span><b class="money-neg">${money(Math.max(0, s.commission_total - s.commission_paid))}</b></div>
      <div class="toolbar" style="margin-top:10px">${hasPerm('edit_marketer') ? `<button class="mini-btn" onclick="commissionForm(${s.id})">تعديل العمولة</button>` : ''}${hasPerm('pay_commission') && s.commission_total > s.commission_paid ? `<button class="mini-btn" onclick="commissionPayForm(${s.id},${Math.max(0, s.commission_total - s.commission_paid)})">دفع دفعة عمولة</button>` : ''}<span>${badge(s.commission_status)}</span></div></div>`;
  } else if (showComm && hasPerm('edit_marketer') && s.status === 'active') {
    html += `<div class="toolbar" style="margin-top:12px"><button class="mini-btn" onclick="commissionForm(${s.id})">ربط مسوق وتحديد عمولة</button></div>`;
  }
  const finBtns = [];
  if (hasPerm('add_payment') && s.status === 'active') finBtns.push(`<button class="btn primary" onclick="paymentForm(${s.id})">تسجيل دفعة</button>`);
  if (hasPerm('edit_discounts') && s.status === 'active') finBtns.push(`<button class="btn ghost" onclick="discountForm(${s.id})">إضافة خصم</button>`);
  if (hasPerm('edit_sale')) finBtns.push(`<button class="btn ghost" onclick="expenseForm(${s.id})">إضافة مصروف</button>`);
  if (hasPerm('edit_sale')) finBtns.push(`<button class="btn ghost" onclick="investorForm(${s.id})">بيانات المستثمر</button>`);
  if (showPrice) finBtns.push(`<button class="btn ghost" onclick="viewInvoice(${s.id})">عرض الفاتورة</button>`);
  if (showPrice && hasPerm('export_pdf')) finBtns.push(`<button class="btn ghost" onclick="invoicePdf(${s.id})">تنزيل PDF</button>`);
  if (hasPerm('add_payment') && ['active','resold'].includes(s.status)) finBtns.push(`<button class="btn ghost" onclick="adjustmentForm(${s.id})">تسوية مبلغ مفقود</button>`);
  if (hasPerm('edit_sale') && s.status === 'active') finBtns.push(`<button class="btn ghost" onclick="editSaleForm(${s.id})">تعديل الصفقة</button>`);
  if (hasPerm('cancel_sale') && s.status === 'active') finBtns.push(`<button class="btn danger" onclick="cancelSale(${s.id},'${esc(s.sale_no)}')">إلغاء البيع</button>`);
  if (finBtns.length) html += `<div class="form-actions">${finBtns.join('')}</div>`;
  html += `</div></section>`;
  return html;
}

/* ============================================================
   الحجز والبيع والدفعات
   ============================================================ */
window.reservationForm = id => {
  let dt = new Date(Date.now() + 48 * 3600000); dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
  modal(`<h2 class="modal-title">حجز الوحدة</h2><p class="modal-sub">يُعاد التحقق من توافر الوحدة لحظة التأكيد لمنع الحجز المزدوج</p><form id="reservationForm" class="form-grid">
    <div class="field"><label>اسم العميل<input name="customer_name" required></label></div>
    <div class="field"><label>رقم الجوال<input name="customer_phone" required></label></div>
    <div class="field"><label>البريد<input type="email" name="customer_email"></label></div>
    <div class="field"><label>انتهاء الحجز<input type="datetime-local" name="expires_at" value="${dt.toISOString().slice(0, 16)}" required></label></div>
    <div class="field"><label>العربون<input type="number" name="deposit" value="0"></label></div>
    <div class="field full"><label>ملاحظات<textarea name="notes"></textarea></label></div>
    <div class="form-actions full"><button class="btn primary">تأكيد الحجز</button></div></form>`);
  $('#reservationForm').onsubmit = async e => {
    e.preventDefault();
    try { let d = await api('/api/reservations', { method: 'POST', body: { ...Object.fromEntries(new FormData(e.target)), unit_id: id } }); closeModal(); toast('تم الحجز بنجاح: ' + d.reservation_no); go('reservations'); } catch (x) { toast(x.message, true); }
  };
};
window.editReservation = (id, expiresAt, deposit) => {
  const v = String(expiresAt || '').slice(0, 16);
  modal(`<h2 class="modal-title">تعديل الحجز</h2><form id="editResForm" class="form-grid">
    <div class="field"><label>تاريخ الانتهاء الجديد<input type="datetime-local" name="expires_at" value="${v}" required></label></div>
    <div class="field"><label>العربون<input type="number" name="deposit" value="${deposit || 0}"></label></div>
    <div class="field full"><label>ملاحظات<textarea name="notes"></textarea></label></div>
    <div class="form-actions full"><button class="btn primary">حفظ</button></div></form>`);
  $('#editResForm').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/reservations/' + id, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast('تم تعديل الحجز'); go('reservations'); } catch (x) { toast(x.message, true); }
  };
};
window.cancelReservation = async id => {
  let reason = prompt('سبب إلغاء الحجز:'); if (reason === null) return;
  try { await api('/api/reservations/' + id + '/cancel', { method: 'POST', body: { reason } }); toast('تم إلغاء الحجز وإتاحة الوحدة'); go('reservations'); } catch (x) { toast(x.message, true); }
};

window.saleForm = async id => {
  const u = await api('/api/units/' + id);
  let marketers = [];
  if (hasPerm('view_commissions') && hasPerm('edit_marketer')) { try { marketers = await api('/api/marketers'); } catch { } }
  const reserved = u.reservation && u.reservation.customer_name;
  const marketerOpts = marketers.map(m => `<option value="${m.id}">${esc(m.name)} — ${esc(m.code)}</option>`).join('');
  modal(`<h2 class="modal-title">${u.status === 'resale' ? 'تسجيل إعادة البيع' : 'تسجيل بيع الوحدة'} ${esc(u.unit_number)}</h2>
  <p class="modal-sub">يُحسب السعر النهائي تلقائيًا: الأساسي − الخصم — وتُحدَّث الوحدة والتقارير فورًا</p>
  <form id="saleForm" class="form-grid">
    ${u.status === 'resale' ? `<div class="field"><label>الجهة المستفيدة من البيع<select name="beneficiary_type" id="sfBeneficiary" onchange="document.getElementById('sfBeneficiaryName').disabled=this.value==='company'"><option value="investor" selected>حساب العميل / المستثمر</option><option value="company">حساب الشركة</option></select></label></div><div class="field"><label>اسم العميل / المستثمر المستفيد<input name="beneficiary_name" id="sfBeneficiaryName" value="${esc(u.owner_name||u.seller_name||'')}" placeholder="المالك السابق"></label></div>` : `<input type="hidden" name="beneficiary_type" value="company"><div class="field full company-account-banner"><b>البيع الأول — لصالح حساب الشركة</b><small>ترتبط جميع الدفعات والخصومات والمتبقيات بهذه العملية بحساب الشركة تلقائيًا.</small></div>`}
    ${reserved ? `<input type="hidden" name="customer_id" value="${u.reservation.customer_id || ''}"><div class="field full"><label>عميل الحجز<input value="${esc(u.reservation.customer_name)} — ${esc(u.reservation.customer_phone || '')}" disabled></label></div>`
      : `<div class="field"><label>اسم العميل<input name="customer_name" required></label></div><div class="field"><label>رقم الجوال<input name="customer_phone" required></label></div>`}
    <div class="field"><label>تاريخ البيع<input type="date" name="sale_date" value="${new Date().toISOString().slice(0, 10)}" required></label></div>
    <div class="field"><label>مرحلة البيع<select name="sale_phase"><option value="off_plan" ${u.sell_phase !== 'completed' && u.status !== 'resale' ? 'selected' : ''}>تحت الإنشاء</option><option value="completed" ${u.sell_phase === 'completed' || u.status === 'resale' ? 'selected' : ''}>بعد اكتمال المشروع</option></select></label></div>
    <div class="field"><label>السعر الأساسي<input type="number" name="base_price" id="sfBase" value="${u.price}" required></label></div>
    <div class="field"><label>تكلفة العقار لهذه العملية<input type="number" name="property_cost" id="sfCost" value="${u.status === 'resale' ? (u.prev_price || '') : ''}" min="0" oninput="saleCalc()" placeholder="تدخل في حساب الربح"></label></div>
    <div class="field"><label>الخصم<select name="discount_type" id="sfDiscType" onchange="saleCalc()"><option value="none">بدون خصم</option><option value="amount">خصم بمبلغ ثابت</option><option value="percent">خصم بنسبة %</option></select></label></div>
    <div class="field"><label>قيمة الخصم<input type="number" name="discount_value" id="sfDiscVal" value="0" min="0" oninput="saleCalc()"></label></div>
    <div class="field"><label>طريقة الدفع<select name="payment_method" id="sfMethod" onchange="saleCalc()"><option value="cash">كاش</option><option value="bank_transfer">حوالة بنكية</option><option value="check">شيك</option></select></label></div>
    <div class="field"><label>رقم الشيك / الحوالة<input name="payment_ref" id="sfRef" placeholder="مطلوب عند الحوالة أو الشيك"></label></div>
    <div class="field"><label>المبلغ المدفوع مقدمًا<input type="number" name="paid_amount" id="sfPaid" value="0" min="0" oninput="saleCalc()"></label></div>
    <div class="field"><label>رقم العقد<input name="contract_no"></label></div>
    ${marketers.length ? `
    <div class="field"><label>المسوق المرتبط بالصفقة<select name="marketer_id" id="sfMarketer" onchange="saleCalc()"><option value="">بدون مسوق</option>${marketerOpts}</select></label></div>
    <div class="field"><label>نوع العمولة<select name="commission_type" id="sfCType" onchange="saleCalc()"><option value="none">بدون عمولة</option><option value="amount">مبلغ ثابت</option><option value="percent">نسبة %</option></select></label></div>
    <div class="field"><label>قيمة العمولة<input type="number" name="commission_value" id="sfCVal" value="0" min="0" oninput="saleCalc()"></label></div>` : ''}
    <div class="field full"><label>ملاحظات<textarea name="notes"></textarea></label></div>
    <div class="field full" style="background:#f7f8fa;border:1px solid var(--line);border-radius:10px;padding:13px 16px">
      <div class="kv-money"><span>السعر الأساسي</span><b id="calcBase">0</b></div>
      <div class="kv-money"><span>قيمة الخصم</span><b id="calcDisc">0</b></div>
      <div class="kv-money total"><span>السعر النهائي بعد الخصم</span><b id="calcFinal">0</b></div>
      <div class="kv-money"><span>المتبقي بعد الدفعة</span><b id="calcRemain">0</b></div>
      <div class="kv-money" id="calcCommRow" style="display:none"><span>العمولة المستحقة للمسوق (مصروف بيع)</span><b id="calcComm">0</b></div>
      <div class="kv-money"><span>صافي الربح المحقق حاليًا من المبلغ المحصل</span><b id="calcProfit">0</b></div>
    </div>
    <div class="form-actions full"><button type="button" class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn secondary">تأكيد ${u.status === 'resale' ? 'إعادة البيع' : 'البيع'}</button></div></form>`);
  saleCalc();
  $('#saleForm').onsubmit = async e => {
    e.preventDefault();
    try {
      let d = await api('/api/sales', { method: 'POST', body: { ...Object.fromEntries(new FormData(e.target)), unit_id: id } });
      closeModal(); toast(`تم تسجيل ${u.status === 'resale' ? 'إعادة البيع' : 'البيع'}: ${d.sale_no} — الفاتورة ${d.invoice_no} — السعر النهائي ${money(d.final_price)}`);
      go('sales');
    } catch (x) { toast(x.message, true); }
  };
};
window.saleCalc = () => {
  const g = id => document.getElementById(id);
  const base = +g('sfBase')?.value || 0;
  const dt = g('sfDiscType')?.value || 'none';
  const dv = +g('sfDiscVal')?.value || 0;
  const disc = dt === 'amount' ? Math.min(dv, base) : dt === 'percent' ? Math.min(base * Math.min(dv, 100) / 100, base) : 0;
  const final = Math.max(0, base - disc);
  const paid = Math.min(+g('sfPaid')?.value || 0, final);
  const ct = g('sfCType')?.value || 'none';
  const cv = +g('sfCVal')?.value || 0;
  const comm = ct === 'amount' ? cv : ct === 'percent' ? final * Math.min(cv, 100) / 100 : 0;
  const set = (id, v) => { const el = g(id); if (el) el.textContent = money(Math.round(v)); };
  const cost = +g('sfCost')?.value || 0;
  set('calcBase', base); set('calcDisc', disc); set('calcFinal', final); set('calcRemain', final - paid); set('calcComm', comm); set('calcProfit', paid - cost - comm);
  if (g('calcCommRow')) g('calcCommRow').style.display = comm > 0 ? 'flex' : 'none';
};
window.editSaleForm = async saleId => {
  let s = null;
  try { const rows = await api('/api/sales?limit=1000'); s = rows.find(x => x.id === saleId); } catch { }
  if (!s) return toast('تعذر جلب بيانات الصفقة', true);
  const canDisc = hasPerm('edit_discounts');
  modal(`<h2 class="modal-title">تعديل الصفقة ${esc(s.sale_no)}</h2><form id="editSaleForm" class="form-grid">
    <div class="field"><label>تاريخ البيع<input type="date" name="sale_date" value="${s.sale_date}"></label></div>
    <div class="field"><label>رقم العقد<input name="contract_no" value="${esc(s.contract_no || '')}"></label></div>
    ${canDisc ? `<div class="field"><label>السعر الأساسي<input type="number" name="base_price" id="esBase" value="${s.base_price}" oninput="esCalc(${s.discount_value})"></label></div>
    <div class="field"><label>نوع الخصم<select name="discount_type" id="esType" onchange="esCalc(${s.discount_value})"><option value="none" ${s.discount_type === 'none' ? 'selected' : ''}>بدون</option><option value="amount" ${s.discount_type === 'amount' ? 'selected' : ''}>مبلغ ثابت</option><option value="percent" ${s.discount_type === 'percent' ? 'selected' : ''}>نسبة %</option></select></label></div>
    <div class="field"><label>قيمة الخصم<input type="number" name="discount_value" id="esVal" value="${s.discount_value}" oninput="esCalc()"></label></div>
    <div class="field"><label>السعر النهائي (محسوب تلقائيًا)<input id="esFinal" value="${s.final_price}" disabled style="background:#f4f5f7"></label></div>` : ''}
    <div class="field"><label>طريقة الدفع<select name="payment_method"><option value="cash" ${s.payment_method === 'cash' ? 'selected' : ''}>كاش</option><option value="bank_transfer" ${s.payment_method === 'bank_transfer' ? 'selected' : ''}>حوالة بنكية</option><option value="check" ${s.payment_method === 'check' ? 'selected' : ''}>شيك</option></select></label></div>
    <div class="field"><label>مرجع العملية<input name="payment_ref" value="${esc(s.payment_ref || '')}"></label></div>
    <div class="field full"><label>ملاحظات<textarea name="notes">${esc(s.notes || '')}</textarea></label></div>
    <div class="form-actions full"><button type="button" class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn primary">حفظ التعديلات</button></div></form>`);
  window.esCalc = () => {
    const g = id => document.getElementById(id);
    const base = +g('esBase')?.value || 0, ty = g('esType')?.value || 'none', dv = +g('esVal')?.value || 0;
    const disc = ty === 'amount' ? Math.min(dv, base) : ty === 'percent' ? base * Math.min(dv, 100) / 100 : 0;
    g('esFinal').value = Math.max(0, Math.round(base - disc));
  };
  $('#editSaleForm').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/sales/' + saleId, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast('تم تعديل الصفقة وتحديث التقارير'); go('sales'); } catch (x) { toast(x.message, true); }
  };
};
window.paymentForm = saleId => {
  modal(`<h2 class="modal-title">تسجيل دفعة جديدة</h2><p class="modal-sub">سيُحدَّث المدفوع والمتبقي وحالة السداد تلقائيًا في كل الشاشات والتقارير</p><form id="paymentForm" class="form-grid">
    <div class="field"><label>المبلغ<input type="number" name="amount" min="1" required></label></div>
    <div class="field"><label>تاريخ الدفع<input type="date" name="pay_date" value="${new Date().toISOString().slice(0, 10)}" required></label></div>
    <div class="field"><label>طريقة الدفع<select name="method" onchange="document.getElementById('pfRefWrap').style.display=this.value==='cash'?'none':'block'"><option value="cash">كاش</option><option value="bank_transfer">حوالة بنكية</option><option value="check">شيك</option></select></label></div>
    <div class="field" id="pfRefWrap" style="display:none"><label>رقم الحوالة / الشيك<input name="ref_no"></label></div>
    <div class="field full"><label>ملاحظات<textarea name="notes"></textarea></label></div>
    <div class="form-actions full"><button type="button" class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn primary">تسجيل الدفعة</button></div></form>`);
  $('#paymentForm').onsubmit = async e => {
    e.preventDefault();
    try {
      const d = await api(`/api/sales/${saleId}/payments`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      closeModal(); toast(`تم تسجيل الدفعة ${d.payment_no} — المتبقي الآن ${money(d.remaining)}`); go('payments');
    } catch (x) { toast(x.message, true); }
  };
};
window.cancelPayment = async id => {
  let reason = prompt('سبب إلغاء الدفعة:'); if (reason === null) return;
  try { await api(`/api/payments/${id}/cancel`, { method: 'POST', body: { reason } }); toast('تم إلغاء الدفعة وإعادة حساب المدفوع'); go('payments'); } catch (x) { toast(x.message, true); }
};
window.discountForm = saleId => {
  modal(`<h2 class="modal-title">إضافة خصم</h2><p class="modal-sub">يُخصم تلقائيًا من سعر العقد ويُعاد حساب المتبقي والأرباح فورًا</p><form id="discForm" class="form-grid">
    <div class="field"><label>نوع الخصم<select name="type" onchange="document.getElementById('dfValLabel').textContent=this.value==='percent'?'نسبة الخصم %':'قيمة الخصم'"><option value="amount">مبلغ ثابت</option><option value="percent">نسبة مئوية</option></select></label></div>
    <div class="field"><label><span id="dfValLabel">قيمة الخصم</span><input type="number" name="value" min="0" step="0.01" required></label></div>
    <div class="field"><label>تاريخ الخصم<input type="date" name="discount_date" value="${new Date().toISOString().slice(0, 10)}"></label></div>
    <div class="field"><label>اعتمده<input name="approved_by" placeholder="${esc(user.name)}"></label></div>
    <div class="field full"><label>سبب الخصم<input name="reason" placeholder="مثال: تسوية، دفع كاش، حافز تسويقي"></label></div>
    <div class="form-actions full"><button type="button" class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn primary">إضافة الخصم</button></div></form>`);
  $('#discForm').onsubmit = async e => {
    e.preventDefault();
    try { const d = await api(`/api/sales/${saleId}/discounts`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      closeModal(); toast(`تم إضافة الخصم ${d.discount_no} — السعر النهائي الآن ${fmtE(d.final)}`); unitDetails(cacheUnitId); } catch (x) { toast(x.message, true); }
  };
};
window.cancelDiscount = async id => {
  let reason = prompt('سبب إلغاء الخصم:'); if (reason === null) return;
  try { await api(`/api/discounts/${id}/cancel`, { method: 'POST', body: { reason } }); toast('تم إلغاء الخصم وإعادة الحساب'); closeModal(); unitDetails(cacheUnitId); } catch (x) { toast(x.message, true); }
};
window.expenseForm = saleId => {
  modal(`<h2 class="modal-title">إضافة مصروف على الصفقة</h2><p class="modal-sub">يُحسب تلقائيًا ضمن صافي الربح</p><form id="expForm" class="form-grid">
    <div class="field"><label>بيان المصروف<input name="title" required placeholder="مثال: صيانة، رسوم إدارية، تحديثات"></label></div>
    <div class="field"><label>المبلغ<input type="number" name="amount" min="1" required></label></div>
    <div class="field"><label>التاريخ<input type="date" name="expense_date" value="${new Date().toISOString().slice(0, 10)}"></label></div>
    <div class="field"><label>ملاحظات<input name="notes"></label></div>
    <div class="form-actions full"><button type="button" class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn primary">إضافة المصروف</button></div></form>`);
  $('#expForm').onsubmit = async e => {
    e.preventDefault();
    try { const d = await api(`/api/sales/${saleId}/expenses`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      closeModal(); toast(`تم تسجيل المصروف ${d.expense_no} — صافي الربح الآن ${fmtE(d.net_profit)}`); unitDetails(cacheUnitId); } catch (x) { toast(x.message, true); }
  };
};
window.cancelExpense = async id => {
  let reason = prompt('سبب إلغاء المصروف:'); if (reason === null) return;
  try { await api(`/api/expenses/${id}/cancel`, { method: 'POST', body: { reason } }); toast('تم إلغاء المصروف وإعادة الحساب'); closeModal(); unitDetails(cacheUnitId); } catch (x) { toast(x.message, true); }
};
window.investorForm = saleId => {
  const s = (window._lastUnit && window._lastUnit.sale) || {};
  modal(`<h2 class="modal-title">بيانات المستثمر وتكلفة العقار</h2><p class="modal-sub">صافي الربح المحقق = المحصل فعليًا − تكلفة العقار − العمولة − المصروفات</p><form id="invForm" class="form-grid">
    <div class="field"><label>اسم المستثمر<input name="investor_name" value="${esc(s.investor_name || '')}"></label></div>
    <div class="field"><label>تكلفة العقار / رأس المال<input type="number" name="property_cost" value="${s.property_cost ?? s.purchase_cost ?? ''}" min="0"></label></div>
    <div class="field full"><label>سبب التعديل<input name="reason" placeholder="يوثق في سجل التدقيق المالي"></label></div>
    <div class="form-actions full"><button type="button" class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn primary">حفظ</button></div></form>`);
  $('#invForm').onsubmit = async e => {
    e.preventDefault();
    try { const d = await api(`/api/sales/${saleId}/investor`, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
      closeModal(); toast(`تم تحديث بيانات المستثمر — صافي الربح ${money(d.finance.net_profit)} (${d.finance.net_profit_pct ?? '—'}%)`); unitDetails(cacheUnitId); } catch (x) { toast(x.message, true); }
  };
};
window.cancelSale = async (id, no) => {
  if (!confirmBox(`سيتم إلغاء البيع ${no} وإتاحة الوحدة وربط السبب بالسجل التاريخي. متابعة؟`)) return;
  let reason = prompt('سبب إلغاء البيع (إلزامي):'); if (reason === null || !reason) return;
  try { await api(`/api/sales/${id}/cancel`, { method: 'POST', body: { reason } }); toast('تم إلغاء البيع'); closeModal(); go('sales'); } catch (x) { toast(x.message, true); }
};
window.ownerDecisionForm = (id, price, owner) => {
  modal(`<h2 class="modal-title">قرار ما بعد اكتمال المشروع</h2><p class="modal-sub">عند اكتمال المشروع يحدد المالك أو المساهم مصير الوحدة — كل الإجراءات تُوثق في السجل التاريخي</p>
  <form id="decisionForm" class="form-grid">
    <div class="field"><label>القرار<select name="decision" id="dcType" onchange="dcToggle()">
      <option value="keep">الاحتفاظ بالوحدة للمالك</option>
      <option value="sell">بيع الوحدة عبر الشركة</option>
      <option value="resale">عرض الوحدة لإعادة البيع بسعر جديد</option></select></label></div>
    <div class="field"><label>اسم المالك / المساهم<input name="owner_name" id="dcOwner" value="${esc(owner)}" placeholder="المالك الحالي"></label></div>
    <div class="field" id="dcPriceWrap" style="display:none"><label>سعر إعادة البيع الجديد<input type="number" name="new_price" id="dcPrice" min="1"></label></div>
    <div class="field"><label>التاريخ<input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}"></label></div>
    <div class="field full" style="background:#fdf6e3;border-radius:10px;padding:12px 15px;font-size:12px" id="dcNote">سيتم الاحتفاظ بكامل السجل السابق للوحدة (الأسعار، الحجوزات، البيوع والدفعات).</div>
    <div class="form-actions full"><button type="button" class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn primary">تنفيذ القرار</button></div></form>`);
  window.dcToggle = () => {
    const v = document.getElementById('dcType').value;
    document.getElementById('dcPriceWrap').style.display = v === 'resale' ? 'block' : 'none';
    document.getElementById('dcNote').textContent = v === 'resale'
      ? `سيتم تحويل الوحدة إلى «إعادة بيع» وتسجيل السعر الجديد كبعد اكتمال المشروع، مع حفظ السعر السابق (${money(price)}) في السجل.`
      : v === 'keep' ? 'ستتحول حالة الوحدة إلى «للمالك» مع تسجيل اسمه.' : 'سيُسجّل توجه البيع، وتنفّذ عملية البيع من شاشة الوحدة عند الاتفاق.';
  };
  $('#decisionForm').onsubmit = async e => {
    e.preventDefault();
    try {
      const b = Object.fromEntries(new FormData(e.target));
      if (b.decision === 'resale' && !(+b.new_price > 0)) return toast('أدخل سعر إعادة البيع', true);
      const d = await api(`/api/units/${id}/owner-decision`, { method: 'POST', body: b });
      closeModal(); toast(d.message || 'تم تنفيذ القرار'); go('units');
    } catch (x) { toast(x.message, true); }
  };
};

/* ============================================================
   المسوقون والعمولات
   ============================================================ */
window.marketerForm = (m = {}) => {
  modal(`<h2 class="modal-title">${m.id ? 'تعديل المسوق' : 'إضافة مسوق جديد'}</h2><form id="marketerForm" class="form-grid">
    <div class="field"><label>اسم المسوق<input name="name" value="${esc(m.name || '')}" required></label></div>
    <div class="field"><label>رقم / كود المسوق<input name="code" value="${esc(m.code || '')}" placeholder="يُنشأ تلقائيًا إن تُرك فارغًا"></label></div>
    <div class="field"><label>رقم الهاتف<input name="phone" value="${esc(m.phone || '')}"></label></div>
    <div class="field full"><label>ملاحظات<textarea name="notes">${esc(m.notes || '')}</textarea></label></div>
    <div class="form-actions full"><button class="btn primary">${m.id ? 'حفظ التعديل' : 'إضافة المسوق'}</button></div></form>`);
  $('#marketerForm').onsubmit = async e => {
    e.preventDefault();
    try { await api(m.id ? '/api/marketers/' + m.id : '/api/marketers', { method: m.id ? 'PUT' : 'POST', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast('تم حفظ المسوق'); go('marketers', window._mkTab); } catch (x) { toast(x.message, true); }
  };
};
window.toggleMarketer = async id => {
  try { const d = await api(`/api/marketers/${id}/toggle`, { method: 'POST' }); toast(d.active ? 'تم تفعيل المسوق' : 'تم تعطيل المسوق'); go('marketers', 'list'); } catch (x) { toast(x.message, true); }
};
window.marketerDetails = async id => {
  const d = await api('/api/marketers/' + id + '/account'), m=d.marketer,t=d.totals;
  modal(`<div class="details-hero"><small>كشف حساب المسوق • ${esc(m.code)}</small><h2>${esc(m.name)}</h2><span>${esc(m.phone || 'بدون جوال')}</span></div>
  <div class="profit-kpis"><div class="fin-card"><small>إجمالي العمولات</small><b>${money(t.commission_total)}</b></div><div class="fin-card pos"><small>المصفى</small><b>${money(t.settled)}</b></div><div class="fin-card due"><small>غير المصفى / المستحق</small><b>${money(t.unsettled)}</b></div><div class="fin-card"><small>عدد عمليات البيع</small><b>${t.sales_count}</b></div><div class="fin-card"><small>البيع الأول</small><b>${t.first_sales}</b></div><div class="fin-card"><small>إعادة البيع</small><b>${t.resales}</b></div></div>
  <section class="panel" style="margin-top:16px"><div class="panel-head"><h3>كل مشاركات المسوق — كل عملية بند مستقل</h3></div><div class="table-wrap"><table><thead><tr><th>رقم البيع</th><th>النوع</th><th>المشروع / الوحدة</th><th>العميل / المالك</th><th>قيمة البيع</th><th>نسبة/قيمة العمولة</th><th>العمولة</th><th>المصفى</th><th>غير المصفى</th><th>الحالة</th></tr></thead><tbody>${d.rows.map(r=>`<tr><td><b>${esc(r.sale_no)}</b><br><small>${esc(r.sale_date)}</small></td><td>${r.is_resale?'إعادة بيع':'بيع أول'}</td><td>${esc(r.project_name)} — ${esc(r.unit_number)}</td><td>${esc(r.customer_name)}</td><td>${money(r.final_price)}</td><td>${r.commission_type==='percent'?r.commission_value+'%':money(r.commission_value)}</td><td>${money(r.commission_total)}</td><td class="money-pos">${money(r.commission_paid)}</td><td class="money-neg">${money(r.commission_remaining)}</td><td>${badge(r.commission_status)}</td></tr>`).join('')||'<tr><td colspan="10"><div class="empty">لا توجد مشاركات</div></td></tr>'}</tbody></table></div></section>
  <section class="panel"><div class="panel-head"><h3>التصفيات الإجمالية السابقة</h3></div><div class="table-wrap"><table><thead><tr><th>رقم التصفية</th><th>التاريخ</th><th>الإجمالي</th><th>الطريقة</th><th>الحالة</th><th></th></tr></thead><tbody>${d.batches.map(b=>`<tr><td><b>${esc(b.invoice_no||b.settlement_no)}</b><br><small>${esc(b.settlement_no)}</small></td><td>${esc(b.settlement_date)}</td><td>${money(b.total_amount)}</td><td>${methodAr[b.method]||b.method}</td><td>${b.status==='active'?badge('settled'):badge('cancelled')}</td><td>${hasPerm('export_pdf')?`<button class="mini-btn" onclick="marketerSettlementPdf(${b.id})">تنزيل PDF</button>`:''}</td></tr>`).join('')||'<tr><td colspan="5"><div class="empty">لا توجد تصفيات إجمالية</div></td></tr>'}</tbody></table></div></section>`,true);
};
window.commissionForm = async saleId => {
  let marketers = [];
  try { marketers = await api('/api/marketers'); } catch { }
  let s = null;
  try { const rows = await api('/api/commissions?limit=1000'); s = rows.find(x => x.id === saleId); } catch { }
  modal(`<h2 class="modal-title">عمولة الصفقة</h2><form id="commForm" class="form-grid">
    <div class="field"><label>المسوق<select name="marketer_id"><option value="">بدون</option>${marketers.map(m => `<option value="${m.id}" ${s && s.marketer_id == m.id ? 'selected' : ''}>${esc(m.name)} — ${esc(m.code)}</option>`).join('')}</select></label></div>
    <div class="field"><label>نوع العمولة<select name="commission_type"><option value="none">بدون</option><option value="amount" ${s && s.commission_type === 'amount' ? 'selected' : ''}>مبلغ ثابت</option><option value="percent" ${s && s.commission_type === 'percent' ? 'selected' : ''}>نسبة %</option></select></label></div>
    <div class="field"><label>قيمة العمولة<input type="number" name="commission_value" min="0" value="${s ? s.commission_value : ''}"></label></div>
    <div class="form-actions full"><button class="btn primary">حفظ العمولة</button></div></form>`);
  $('#commForm').onsubmit = async e => {
    e.preventDefault();
    try { await api(`/api/sales/${saleId}/commission`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast('تم تحديث العمولة'); go('marketers', 'commissions'); } catch (x) { toast(x.message, true); }
  };
};
window.commissionPayForm = (saleId, due) => {
  modal(`<h2 class="modal-title">دفعة عمولة لمسوق</h2><p class="modal-sub">المتبقي للمسوق: ${money(due)}</p><form id="cpForm" class="form-grid">
    <div class="field"><label>المبلغ<input type="number" name="amount" min="1" max="${Math.round(due)}" required></label></div>
    <div class="field"><label>تاريخ الدفع<input type="date" name="pay_date" value="${new Date().toISOString().slice(0, 10)}" required></label></div>
    <div class="field"><label>طريقة الدفع<select name="method"><option value="cash">كاش</option><option value="bank_transfer">حوالة بنكية</option><option value="check">شيك</option></select></label></div>
    <div class="field"><label>رقم العملية / المرجع<input name="ref_no"></label></div>
    <div class="field full"><label>ملاحظات<textarea name="notes"></textarea></label></div>
    <div class="form-actions full"><button class="btn primary">تسجيل الدفعة</button></div></form>`);
  $('#cpForm').onsubmit = async e => {
    e.preventDefault();
    try { const d = await api(`/api/sales/${saleId}/commission-payments`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast(`تم تسجيل دفعة العمولة ${d.cp_no} — الحالة: ${statusAr[d.status] || d.status}`); go('marketers', 'commissions'); } catch (x) { toast(x.message, true); }
  };
};

/* ============================================================
   العملاء والمستخدمون
   ============================================================ */
window.customerForm = () => {
  modal(`<h2 class="modal-title">إضافة عميل</h2><form id="customerForm" class="form-grid">
    <div class="field"><label>الاسم<input name="name" required></label></div>
    <div class="field"><label>الجوال<input name="phone" required></label></div>
    <div class="field"><label>البريد<input type="email" name="email"></label></div>
    <div class="field"><label>المصدر<input name="source" placeholder="إعلان، مسوق، زيارة"></label></div>
    <div class="field full"><label>ملاحظات<textarea name="notes"></textarea></label></div>
    <div class="form-actions full"><button class="btn primary">حفظ العميل</button></div></form>`);
  $('#customerForm').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/customers', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast('تم حفظ العميل'); go('customers'); } catch (x) { toast(x.message, true); }
  };
};
window.editCustomerForm = c => {
  modal(`<h2 class="modal-title">تعديل بيانات العميل</h2><form id="editCustomerForm" class="form-grid">
    <div class="field"><label>الاسم<input name="name" value="${esc(c.name)}" required></label></div>
    <div class="field"><label>الجوال<input name="phone" value="${esc(c.phone)}" required></label></div>
    <div class="field"><label>البريد<input type="email" name="email" value="${esc(c.email || '')}"></label></div>
    <div class="field"><label>المصدر<input name="source" value="${esc(c.source || '')}"></label></div>
    <div class="field full"><label>ملاحظات<textarea name="notes">${esc(c.notes || '')}</textarea></label></div>
    <div class="form-actions full"><button class="btn primary">حفظ التعديل</button></div></form>`);
  $('#editCustomerForm').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/customers/' + c.id, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast('تم تعديل بيانات العميل'); go('customers'); } catch (x) { toast(x.message, true); }
  };
};
window.deleteCustomer = async (id, name) => {
  if (!confirmBox(`حذف العميل «${name}» نهائيًا؟ (لن يُسمح إن كان له مبيعات أو حجوزات)`)) return;
  try { await api('/api/customers/' + id, { method: 'DELETE' }); toast('تم حذف العميل'); go('customers'); } catch (x) { toast(x.message, true); }
};

const userRoleOpts = [['super_admin', 'مدير النظام — جميع الصلاحيات'], ['admin', 'مدير عام'], ['sales_manager', 'مدير مبيعات'], ['accountant', 'محاسب'], ['reservations_officer', 'مسؤول حجوزات'], ['sales', 'موظف مبيعات'], ['viewer', 'مشاهدة فقط']];
window.userForm = () => {
  const superUI = isSuperAdmin();
  modal(`<h2 class="modal-title">مستخدم جديد</h2>${superUI ? '' : '<div class="perm-banner">بحكم صلاحياتك يُنشأ الحساب بدور «مشاهدة فقط» وبصلاحيات فارغة، ويحدد مدير النظام الدور والصلاحيات لاحقًا.</div>'}<form id="userForm" class="form-grid">
    <div class="field"><label>الاسم<input name="name" required></label></div>
    <div class="field"><label>اسم الدخول<input name="username" required></label></div>
    <div class="field"><label>كلمة المرور المؤقتة<input type="password" name="password" minlength="8" required></label></div>
    ${superUI ? `<div class="field"><label>الدور<select name="role">${userRoleOpts.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label></div>` : ''}
    <div class="form-actions full"><button class="btn primary">إنشاء الحساب</button></div></form>`);
  $('#userForm').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/users', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast('تم إنشاء المستخدم'); go('users'); } catch (x) { toast(x.message, true); }
  };
};
window.editUser = u => {
  modal(`<h2 class="modal-title">تعديل المستخدم</h2><form id="editUser" class="form-grid">
    <div class="field"><label>الاسم<input name="name" value="${esc(u.name)}"></label></div>
    ${isSuperAdmin() ? `<div class="field"><label>الدور<select name="role">${userRoleOpts.map(([v, n]) => `<option value="${v}" ${u.role === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>` : ''}
    <div class="form-actions full">${hasPerm('edit_user') ? '<button class="btn primary">حفظ</button>' : ''}${hasPerm('edit_user') ? `<button type="button" class="btn danger" onclick="resetUserPassword(${u.id})">إعادة تعيين كلمة المرور</button>` : ''}</div></form>`);
  $('#editUser').onsubmit = async e => {
    e.preventDefault(); let b = Object.fromEntries(new FormData(e.target));
    try { await api('/api/users/' + u.id, { method: 'PUT', body: b }); closeModal(); toast('تم تحديث المستخدم'); go('users'); } catch (x) { toast(x.message, true); }
  };
};
window.toggleUser = async (id, active) => {
  if (!confirmBox(active ? 'تعطيل هذا الحساب؟' : 'تفعيل هذا الحساب؟')) return;
  try { await api(`/api/users/${id}/toggle`, { method: 'POST' }); toast(active ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب'); go('users'); } catch (x) { toast(x.message, true); }
};
window.deleteUser = async (id, name) => {
  if (!confirmBox(`حذف المستخدم «${name}» نهائيًا؟ (لن يُسمح إن كان له عمليات مسجلة)`)) return;
  try { await api('/api/users/' + id, { method: 'DELETE' }); toast('تم حذف المستخدم'); go('users'); } catch (x) { toast(x.message, true); }
};
window.resetUserPassword = async id => {
  let password = prompt('أدخل كلمة مرور مؤقتة جديدة (8 أحرف على الأقل):');
  if (password === null) return;
  if (password.length < 8) return toast('كلمة المرور قصيرة', true);
  try { await api('/api/users/' + id + '/reset-password', { method: 'POST', body: { password } }); toast('تمت إعادة التعيين، وسيُطلب من المستخدم تغييرها'); closeModal(); } catch (x) { toast(x.message, true); }
};

/* ============================================================
   محرر الصلاحيات (Checkboxes)
   ============================================================ */
window.permsForm = async (id, name) => {
  const schema = await api('/api/permissions-schema');
  const cur = await api(`/api/users/${id}/permissions`);
  const set = new Set(cur.perms);
  const groupsHtml = schema.map((g, gi) => `
    <div class="perm-group" data-group="${gi}">
      <div class="perm-group-head"><b>${esc(g.label)}</b><button type="button" onclick="toggleGroup(${gi})">تحديد المجموعة</button></div>
      <div class="perm-items">${g.items.map(([k, label]) => `<label><input type="checkbox" name="p_${k}" data-group="${gi}" ${set.has(k) ? 'checked' : ''}> ${esc(label)}</label>`).join('')}</div>
    </div>`).join('');
  modal(`<h2 class="modal-title">صلاحيات المستخدم: ${esc(name)}</h2>
  <p class="modal-sub">${cur.customized ? 'هذا المستخدم يستخدم صلاحيات مخصصة' : 'يستخدم حاليًا الصلاحيات الافتراضية لدوره — أي حفظ هنا يجعل الصلاحيات مخصصة'} — التغييرات تُحفظ فور الضغط على «حفظ الصلاحيات»</p>
  <div class="perm-banner">الصلاحيات مفروضة فعليًا على مستوى الخادم وقاعدة البيانات: من لا يملك صلاحية لا يستطيع تنفيذ العملية حتى لو وصل إليها بشكل مباشر.</div>
  <form id="permsForm"><div class="perm-grid">${groupsHtml}</div>
  <div class="perm-actions">
    <span class="toolbar"><button type="button" class="btn ghost" onclick="permsSelectAll(true)">تحديد الكل</button><button type="button" class="btn ghost" onclick="permsSelectAll(false)">إلغاء تحديد الكل</button></span>
    <span class="toolbar"><button type="button" class="btn ghost" onclick="closeModal()">إغلاق</button><button class="btn primary">حفظ الصلاحيات</button></span>
  </div></form>`, true);
  window.permsSelectAll = on => { $$('#permsForm input[type=checkbox]').forEach(c => c.checked = on); };
  window.toggleGroup = gi => {
    const boxes = $$(`#permsForm input[data-group="${gi}"]`);
    const allOn = boxes.every(b => b.checked);
    boxes.forEach(b => b.checked = !allOn);
  };
  $('#permsForm').onsubmit = async e => {
    e.preventDefault();
    const permissions = {};
    $$('#permsForm input[type=checkbox]').forEach(c => { if (c.checked) permissions[c.name.replace('p_', '')] = true; });
    try { await api(`/api/users/${id}/permissions`, { method: 'PUT', body: { permissions } }); closeModal(); toast(`تم حفظ صلاحيات ${name} — ${Object.keys(permissions).length} صلاحية مفعلة`); go('users'); } catch (x) { toast(x.message, true); }
  };
};

/* ============================================================
   التقارير + تقارير المسوقين
   ============================================================ */
window.loadReport = async () => {
  const t = window._rpTab || 'sales';
  const params = {};
  const f = document.getElementById('rpFrom')?.value, to = document.getElementById('rpTo')?.value;
  if (f) params.date_from = f; if (to) params.date_to = to;
  window._rpParams = params;
  const body = document.getElementById('reportBody');
  if (!document.getElementById('reportBody')) return;
  if (t === 'sales') {
    const d = await api('/api/reports/sales?' + new URLSearchParams(params));
    body.innerHTML = `<section class="panel"><div class="panel-head"><h3>المبيعات (${d.rows.length})</h3><div class="kv-money total" style="border:0"><span>الإجمالي النهائي</span><b>${money(d.totals.final)}</b></div></div><div class="table-wrap"><table><thead><tr><th>رقم البيع</th><th>التاريخ</th><th>المشروع / الوحدة</th><th>العميل</th><th>قبل الخصم</th><th>الخصم</th><th>النهائي</th><th>المدفوع</th><th>المتبقي</th></tr></thead><tbody>${d.rows.map(s => `<tr><td><b>${esc(s.sale_no)}</b></td><td>${esc(s.sale_date)}</td><td>${esc(s.project_name)} — ${esc(s.unit_number)}</td><td>${esc(s.customer_name)}</td><td>${fmt(s.base_price || s.list_price)}</td><td>${fmt(s.discount_amount)}</td><td><b>${fmt(s.final_price)}</b></td><td class="money-pos">${fmt(s.paid_amount)}</td><td class="money-neg">${fmt(s.remaining_amount)}</td></tr>`).join('') || '<tr><td colspan="9"><div class="empty">لا توجد بيانات</div></td></tr>'}<tr style="background:#efe9dc;font-weight:800"><td colspan="4">الإجمالي (${d.rows.length} عملية)</td><td>${fmt(d.totals.base)}</td><td>${fmt(d.totals.discount)}</td><td>${fmt(d.totals.final)}</td><td>${fmt(d.totals.paid)}</td><td>${fmt(d.totals.remaining)}</td></tr></tbody></table></div></section>`;
  } else if (t === 'payments') {
    const d = await api('/api/reports/payments?' + new URLSearchParams(params));
    body.innerHTML = `<section class="panel"><div class="panel-head"><h3>الدفعات (${d.rows.length})</h3><div class="kv-money total" style="border:0"><span>الإجمالي</span><b>${money(d.totals.amount)}</b></div></div><div class="table-wrap"><table><thead><tr><th>رقم الدفعة</th><th>التاريخ</th><th>البيع</th><th>الوحدة</th><th>العميل</th><th>الطريقة</th><th>المرجع</th><th>المبلغ</th></tr></thead><tbody>${d.rows.map(x => `<tr><td><b>${esc(x.payment_no)}</b></td><td>${esc(x.pay_date)}</td><td>${esc(x.sale_no)}</td><td>${esc(x.project_name)} — ${esc(x.unit_number)}</td><td>${esc(x.customer_name || '—')}</td><td>${methodAr[x.method] || x.method}</td><td>${esc(x.ref_no || '—')}</td><td><b>${fmt(x.amount)}</b></td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">لا توجد بيانات</div></td></tr>'}</tbody></table></div></section>`;
  } else if (t === 'commissions') {
    const d = await api('/api/reports/commissions?' + new URLSearchParams(params));
    body.innerHTML = `<section class="panel"><div class="panel-head"><h3>العمولات (${d.rows.length})</h3><div class="kv-money total" style="border:0"><span>المستحق</span><b>${money(d.totals.total)}</b></div></div><div class="table-wrap"><table><thead><tr><th>المسوق</th><th>رقم البيع</th><th>الوحدة</th><th>قيمة البيع</th><th>العمولة</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>${d.rows.map(c => `<tr><td><b>${esc(c.marketer_name || '')}</b></td><td>${esc(c.sale_no)}</td><td>${esc(c.project_name)} — ${esc(c.unit_number)}</td><td>${fmt(c.final_price)}</td><td>${fmt(c.commission_total)}</td><td class="money-pos">${fmt(c.commission_paid)}</td><td class="money-neg">${fmt(c.commission_due)}</td><td>${badge(c.commission_status)}</td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">لا توجد بيانات</div></td></tr>'}</tbody></table></div></section>
    <section class="panel"><div class="panel-head"><h3>ملخص المسوقين</h3></div><div class="table-wrap"><table><thead><tr><th>المسوق</th><th>الوحدات</th><th>إجمالي المبيعات</th><th>عمولات مستحقة</th><th>مدفوعة</th><th>متبقية</th></tr></thead><tbody>${d.marketers.map(m => `<tr><td><b>${esc(m.name)}</b></td><td>${m.units_count}</td><td>${fmt(m.sales_total)}</td><td>${fmt(m.commission_total)}</td><td class="money-pos">${fmt(m.commission_paid)}</td><td class="money-neg">${fmt(m.commission_due)}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">لا يوجد مسوقون</div></td></tr>'}</tbody></table></div></section>`;
  } else {
    const d = await api('/api/reports/financial?' + new URLSearchParams(params));
    const s = d.summary;
    body.innerHTML = `<div class="stats" style="grid-template-columns:repeat(5,1fr)">
      <div class="stat wine"><small>إجمالي المبيعات</small><strong>${money(s.final_total)}</strong><em>إجمالي المبيعات</em></div>
      <div class="stat"><small>إجمالي الخصومات</small><strong>${money(s.discount_total)}</strong><em>إجمالي الخصومات</em></div>
      <div class="stat green"><small>إجمالي المحصل</small><strong>${money(s.paid_total)}</strong><em>إجمالي المحصل</em></div>
      <div class="stat orange"><small>إجمالي المتبقي</small><strong>${money(s.remaining_total)}</strong><em>إجمالي المتبقي</em></div>
      <div class="stat"><small>عمولات متبقية</small><strong>${money(s.commission_due - s.commission_paid)}</strong><em>متبقٍ للمسوقين</em></div></div>
    <section class="panel" style="margin-top:16px"><div class="panel-head"><h3>التفصيل الشهري</h3></div><div class="table-wrap"><table><thead><tr><th>الشهر</th><th>عدد البيوع</th><th>المبيعات</th><th>الخصومات</th><th>المحصل</th><th>العمولات</th><th>دفعات المسوقين</th></tr></thead><tbody>${d.months.map(m => `<tr><td><b>${esc(m.month)}</b></td><td>${m.sales_count}</td><td>${fmt(m.final_total)}</td><td>${fmt(m.discount_total)}</td><td>${fmt(m.paid_total)}</td><td>${fmt(m.commission_total)}</td><td>${fmt(m.marketer_paid)}</td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">لا توجد بيانات</div></td></tr>'}</tbody></table></div></section>`;
  }
};
window.exportReport = save => exportDoc({ sales: 'sales_report', payments: 'payments_report', commissions: 'commissions_report', financial: 'financial_report' }[window._rpTab], window._rpParams || {}, save);
window.paymentsReportPdf = save => exportDoc('payments_report', {}, save);

/* ---------- تقارير المسوقين ---------- */
function mrPeriodRange() {
  const p = document.getElementById('mrPeriod')?.value || 'all';
  const now = new Date();
  const iso = d => d.toISOString().slice(0, 10);
  if (p === 'today') return { date_from: iso(now), date_to: iso(now) };
  if (p === 'week') { const d = new Date(now); d.setDate(d.getDate() - 6); return { date_from: iso(d), date_to: iso(now) }; }
  if (p === 'month') return { date_from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), date_to: iso(now) };
  if (p === 'year') return { date_from: `${now.getFullYear()}-01-01`, date_to: iso(now) };
  if (p === 'custom') { return { date_from: document.getElementById('mrFrom')?.value || '', date_to: document.getElementById('mrTo')?.value || '' }; }
  return {};
}
window.mrToggleCustom = () => {
  const custom = document.getElementById('mrPeriod').value === 'custom';
  document.getElementById('mrFromWrap').style.display = custom ? 'block' : 'none';
  document.getElementById('mrToWrap').style.display = custom ? 'block' : 'none';
};
function mrParams() {
  const p = mrPeriodRange();
  const out = {};
  const mk = document.getElementById('mrMarketer')?.value; if (mk) out.marketer_id = mk;
  const pr = document.getElementById('mrProject')?.value; if (pr) out.project_id = pr;
  const un = document.getElementById('mrUnit')?.value.trim(); if (un) out.unit = un;
  const ss = document.getElementById('mrSaleStatus')?.value; if (ss) out.sale_status = ss;
  const cs = document.getElementById('mrCommStatus')?.value; if (cs) out.commission_status = cs;
  const q = document.getElementById('mrQ')?.value.trim(); if (q) out.search = q;
  if (p.date_from) out.date_from = p.date_from;
  if (p.date_to) out.date_to = p.date_to;
  return out;
}
window.loadMkReport = async () => {
  if (!document.getElementById('mkReportBody')) return;
  const params = mrParams(); window._mrParams = params;
  const d = await api('/api/reports/marketers?' + new URLSearchParams(params));
  window._mrData = d;
  const single = d.marketer_name;
  $('#mkReportBody').innerHTML =
    (single ? `<div class="summary-strip">
      <div class="stat"><span class="stat-ic">${icon('user', 20)}</span><small>المسوق</small><b>${esc(d.marketer_name)}</b></div>
      <div class="stat"><small>الهاتف</small><b>${esc(d.marketer_phone || '—')}</b></div>
      <div class="stat"><small>عدد العمليات</small><b>${d.totals.ops}</b></div>
      <div class="stat"><small>إجمالي المبيعات</small><b>${money(d.totals.sales_total)}</b></div>
      <div class="stat wine"><small>إجمالي العمولات</small><b>${money(d.totals.commission_total)}</b></div>
      <div class="stat green"><small>المدفوع للمسوق</small><b>${money(d.totals.commission_paid)}</b></div>
      <div class="stat orange"><small>المتبقي للمسوق</small><b>${money(d.totals.commission_due)}</b></div>
    </div>` : d.summary.length ? `<section class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>التقرير الإجمالي للمسوقين</h3><span class="perm-count">${d.summary.length} مسوق • ${d.totals.ops} عملية</span></div><div class="table-wrap"><table><thead><tr><th>المسوق</th><th>الهاتف</th><th>عدد العمليات</th><th>الوحدات</th><th>إجمالي المبيعات</th><th>عمولات مستحقة</th><th>مدفوعة</th><th>متبقية</th><th>الحالة</th></tr></thead><tbody>${d.summary.map(m => `<tr><td><b>${esc(m.marketer_name)}</b> <small>${esc(m.marketer_code || '')}</small></td><td>${esc(m.phone || '—')}</td><td>${m.ops}</td><td>${m.units}</td><td>${fmt(m.sales_total)}</td><td>${fmt(m.commission_total)}</td><td class="money-pos">${fmt(m.commission_paid)}</td><td class="money-neg">${fmt(m.commission_due)}</td><td>${badge(m.commission_status)}</td></tr>`).join('')}</tbody></table></div></section>` : '<div class="empty" style="margin-bottom:14px"><b>لا توجد عمليات للمسوقين ضمن الفلاتر</b></div>') +
    `<section class="panel"><div class="panel-head"><h3>${single ? 'عمليات المسوق بالتفصيل' : 'جميع عمليات المسوقين بالتفصيل'} (${d.rows.length})</h3></div><div class="table-wrap"><table><thead><tr><th>رقم البيع</th><th>تاريخ الحجز</th><th>تاريخ البيع</th><th>المشروع / الوحدة</th><th>العميل</th><th>سعر الوحدة</th><th>الخصم</th><th>النهائي</th><th>طريقة الدفع</th><th>مدفوع العميل</th><th>متبقي العميل</th><th>نسبة العمولة</th><th>العمولة</th><th>مدفوع للمسوق</th><th>متبقي المسوق</th><th>حالة العمولة</th></tr></thead><tbody>${d.rows.map(r => `<tr><td><b>${esc(r.sale_no)}</b></td><td>${r.reserve_date ? esc(String(r.reserve_date).slice(0, 10)) : '—'}</td><td>${esc(r.sale_date)}</td><td>${esc(r.project_name)} — ${esc(r.unit_number)}</td><td>${esc(r.customer_name)}</td><td>${fmt(r.base_price)}</td><td>${fmt(r.discount_amount || 0)}</td><td><b>${fmt(r.final_price)}</b></td><td>${methodAr[r.payment_method] || r.payment_method}</td><td class="money-pos">${fmt(r.paid_amount)}</td><td class="money-neg">${fmt(r.remaining_amount)}</td><td>${r.commission_type === 'percent' ? r.commission_value + '%' : '—'}</td><td>${fmt(r.commission_total || 0)}</td><td class="money-pos">${fmt(r.commission_paid || 0)}</td><td class="money-neg">${fmt(Math.max(0, (r.commission_total || 0) - (r.commission_paid || 0)))}</td><td>${badge(r.commission_status)}</td></tr>`).join('') || '<tr><td colspan="16"><div class="empty">لا توجد عمليات ضمن الفلاتر</div></td></tr>'}</tbody></table></div></section>`;
};
window.mkReportPdf = save => exportDoc('marketer_report', window._mrParams || {}, save);
window.printMkReport = () => {
  const d = window._mrData;
  if (!d) return toast('اعرض التقرير أولًا', true);
  const single = d.marketer_name;
  const summaryTable = single ? '' : `<table style="margin-bottom:14px"><thead><tr><th>المسوق</th><th>الهاتف</th><th>العمليات</th><th>إجمالي المبيعات</th><th>عمولات مستحقة</th><th>مدفوعة</th><th>متبقية</th></tr></thead><tbody>${d.summary.map(m => `<tr><td>${esc(m.marketer_name)}</td><td>${esc(m.phone || '—')}</td><td>${m.ops}</td><td>${money(m.sales_total)}</td><td>${money(m.commission_total)}</td><td>${money(m.commission_paid)}</td><td>${money(m.commission_due)}</td></tr>`).join('')}</tbody></table>`;
  printHTML(single ? `تقرير مسوق: ${d.marketer_name}` : 'التقرير الإجمالي للمسوقين', `الفترة: ${d.period} • العمليات: ${d.totals.ops} • إجمالي المبيعات: ${money(d.totals.sales_total)} • العمولات: ${money(d.totals.commission_total)}`,
    `${summaryTable}<table><thead><tr><th>رقم البيع</th><th>تاريخ البيع</th><th>المشروع/الوحدة</th><th>العميل</th><th>النهائي</th><th>مدفوع العميل</th><th>العمولة</th><th>مدفوع للمسوق</th><th>متبقي للمسوق</th><th>الحالة</th></tr></thead><tbody>${d.rows.map(r => `<tr><td>${esc(r.sale_no)}</td><td>${esc(r.sale_date)}</td><td>${esc(r.project_name)} — ${esc(r.unit_number)}</td><td>${esc(r.customer_name)}</td><td>${money(r.final_price)}</td><td>${money(r.paid_amount)}</td><td>${money(r.commission_total || 0)}</td><td>${money(r.commission_paid || 0)}</td><td>${money(Math.max(0, (r.commission_total || 0) - (r.commission_paid || 0)))}</td><td>${statusAr[r.commission_status] || r.commission_status}</td></tr>`).join('') || '<tr><td colspan="10">لا توجد عمليات</td></tr>'}</tbody></table>`);
};

/* ============================================================
   PDF: تصدير / حفظ / طباعة
   ============================================================ */
async function exportDoc(type, params, save = false) {
  try {
    const r = await fetch('/api/documents/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ type, params, save }) });
    if (save) {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(d.error || 'تعذر إنشاء المستند');
      toast('تم حفظ المستند في الأرشيف: ' + d.filename);
      const a = document.createElement('a'); a.href = `/api/documents/${d.id}/download`; a.download = d.filename; a.click();
      return d;
    }
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw Error(d.error || 'تعذر إنشاء المستند'); }
    const blob = await r.blob();
    const cd = r.headers.get('Content-Disposition') || '';
    const m = decodeURIComponent((cd.match(/filename\*=UTF-8''(.+?)(;|$)/) || [])[1] || 'Bayat-Document.pdf');
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = m; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('تم تنزيل المستند: ' + m);
  } catch (e) { toast(e.message, true); }
}
window.exportSearch = save => exportDoc('search_results', lastSearch || {}, save);
window.unitOfferDoc = (unitId, save) => exportDoc('unit_offer', { unit_id: unitId }, save);
window.saleDoc = saleId => exportDoc('sale', { sale_id: saleId }, false);
window.reservationDoc = reservationId => exportDoc('reservation', { reservation_id: reservationId }, false);

/* ---------- الطباعة بهوية الشركة ---------- */
function contactSummary(sep) {
  sep = sep || ' • ';
  const p = [];
  if (settings.phone_main) p.push('هاتف: ' + settings.phone_main + (settings.phone_extra ? ' / ' + settings.phone_extra : ''));
  if (settings.whatsapp && settings.whatsapp !== settings.phone_main) p.push('واتساب: ' + settings.whatsapp);
  if (settings.email) p.push(settings.email);
  if (settings.address) p.push(settings.address);
  if (settings.contact_website) p.push(settings.contact_website);
  return p.join(sep);
}
function officialSummary() {
  const p = [];
  if (settings.cr_number) p.push('س.ت: ' + settings.cr_number);
  if (settings.tax_number) p.push('الرقم الضريبي: ' + settings.tax_number);
  return p.join(' • ');
}
function brandHeader(title, sub) {
  sub = sub || '';
  const siteName = settings.site_name || settings.company_name_ar || '';
  const logo = settings.logo_url ? `<img src="${settings.logo_url}" style="height:56px;max-width:130px;object-fit:contain">` : `<div style="width:54px;height:54px;border:2px solid ${settings.accent_color};border-radius:14px;color:${settings.accent_color};display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800">${esc(siteName.trim()[0] || 'ب')}</div>`;
  return `<div style="display:flex;justify-content:space-between;align-items:center;background:${settings.secondary_color};color:#fff;padding:16px 22px;border-bottom:3px solid ${settings.accent_color}">
    <div style="display:flex;gap:14px;align-items:center">${logo}<div><div style="font-size:19px;font-weight:800">${esc(settings.company_name_ar || siteName)}</div><div style="font-size:10px;color:${settings.accent_color}">${esc(settings.site_name || '')}${settings.company_name_en ? ' — ' + esc(settings.company_name_en) : ''}</div></div></div>
    <div style="text-align:left"><div style="font-size:15px;font-weight:800;color:${settings.accent_color}">${esc(title)}</div><div style="font-size:10px">${esc(sub)}</div><div style="font-size:9.5px;opacity:.75">${new Date().toLocaleString('ar-SA')} — ${esc(user && user.name || '')}</div></div></div>`;
}
function printHTML(title, sub, bodyHtml) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;width:880px;height:1000px';
  document.body.append(iframe);
  iframe.srcdoc = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
    @page{size:A4;margin:0} body{font-family:Tahoma,'Segoe UI',Arial,sans-serif;margin:0;color:#17243e;background:#fff}
    table{width:100%;border-collapse:collapse;font-size:11.5px} th{background:${settings.secondary_color};color:#fff;padding:8px 9px;text-align:right} td{padding:7px 9px;border-bottom:1px solid #e5e8ee} tr:nth-child(even) td{background:#f8f7f4}
    .foot{margin-top:18px;padding:10px 22px;background:${settings.secondary_color};color:#fff;font-size:11px;border-top:2px solid ${settings.accent_color};display:flex;justify-content:space-between}
  </style></head><body>${brandHeader(title, sub)}<div style="padding:20px 24px">${bodyHtml}</div>
  <div class="foot" style="flex-direction:column;gap:4px;align-items:flex-start"><span>${esc(settings.company_name_ar || settings.site_name || '')} — ${esc(settings.site_name || '')} — جميع الحقوق محفوظة${officialSummary() ? ' • ' + esc(officialSummary()) : ''}</span><span>${esc(contactSummary())}</span></div></body></html>`;
  iframe.onload = () => { setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(() => iframe.remove(), 2000); }, 350); };
}
window.printSearch = async () => {
  const d = await api('/api/units?limit=100&' + new URLSearchParams(lastSearch || {}));
  printHTML('كشف الوحدات', `عدد النتائج: ${d.total}`, `<table><thead><tr><th>م</th><th>المشروع</th><th>الوحدة</th><th>الدور</th><th>النموذج</th><th>الغرف</th><th>المساحة</th><th>المرحلة</th><th>الحالة</th><th>السعر</th></tr></thead><tbody>${d.rows.map((u, i) => `<tr><td>${i + 1}</td><td>${esc(u.project_name)}</td><td><b>${esc(u.unit_number)}</b></td><td>${esc(u.floor_name)}</td><td>${esc(u.model_code || '—')}</td><td>${u.display_rooms || '—'}</td><td>${u.display_area || '—'}</td><td>${phaseAr[u.sell_phase] || '—'}</td><td>${statusAr[u.status]}</td><td>${u.price == null ? '—' : money(u.effective_price ?? u.price)}</td></tr>`).join('')}</tbody></table>`);
};
window.printUnitOffer = async id => {
  const u = await api('/api/units/' + id);
  const sale = u.sale;
  printHTML('عرض وحدة سكنية', `${u.project_name} — الوحدة ${u.unit_number}`,
    `<table style="margin-bottom:16px"><tbody>
    <tr><td><b>المشروع:</b> ${esc(u.project_name)}</td><td><b>الدور:</b> ${esc(u.floor_name)}</td><td><b>رقم الوحدة:</b> ${esc(u.unit_number)}</td></tr>
    <tr><td><b>النموذج:</b> ${esc(u.model_code || '—')}</td><td><b>الغرف:</b> ${u.display_rooms || '—'}</td><td><b>الحمامات:</b> ${u.display_bathrooms || '—'}</td></tr>
    <tr><td><b>المساحة:</b> ${u.display_area || '—'} م²</td><td><b>الواجهة:</b> ${esc(u.view || '—')}</td><td><b>الحالة:</b> ${statusAr[u.status]}</td></tr></tbody></table>
    ${u.price == null ? '' : `<table><thead><tr><th>البيان</th><th>القيمة</th></tr></thead><tbody>
    <tr><td>السعر الأساسي (قبل الخصم)</td><td>${money(sale ? sale.base_price : u.price)}</td></tr>
    <tr><td>قيمة الخصم ${sale && sale.discount_type === 'percent' ? `(${sale.discount_value}%)` : ''}</td><td>${money(sale ? sale.discount_amount : 0)}</td></tr>
    <tr class="tot"><td>السعر النهائي بعد الخصم</td><td>${money(sale ? sale.final_price : u.price)}</td></tr></tbody></table>`}
    <p style="font-size:11px;color:#666;margin-top:14px">هذا العرض ساري لمدة 7 أيام من تاريخ الإصدار ولا يُعد عقدًا نهائيًا حتى توقيع عقد البيع المعتمد من ${esc(settings.company_name_ar || '')}.</p>`);
};

/* ============================================================
   أرشيف المستندات
   ============================================================ */
async function loadDocs(q) {
  const rows = await api('/api/documents?' + q.toString());
  $('#docList').innerHTML = rows.length ? `<div class="doc-grid">${rows.map(d => `<article class="doc-card">
    <div style="display:flex;justify-content:space-between;align-items:start"><div class="doc-icon">' + icon('file',19) + '</div><small>${d.pages || 1} صفحة • ${(d.file_size / 1024).toFixed(0)} KB</small></div>
    <h4>${esc(docTypeAr[d.doc_type] || d.doc_type)}</h4><small style="min-height:28px">${esc(d.filename)}</small>
    <small>${esc(d.doc_no)}${d.project_name ? ' • ' + esc(d.project_name) : ''}${d.unit_number ? ' • وحدة ' + esc(d.unit_number) : ''}${d.customer_name ? ' • ' + esc(d.customer_name) : ''}${d.marketer_name ? ' • مسوق: ' + esc(d.marketer_name) : ''}</small>
    <small>${esc(d.created_by_name || '')} — ${dtstr(d.created_at)}</small>
    <div class="doc-actions"><button class="mini-btn" onclick="window.open('/api/documents/${d.id}/file','_blank')">معاينة</button>
    <button class="mini-btn" onclick="window.location.href='/api/documents/${d.id}/download'">تنزيل</button>
    <button class="mini-btn" onclick="printDocDirect(${d.id})">طباعة</button>
    <button class="mini-btn" style="color:#a72f3a" onclick="deleteDoc(${d.id})">حذف</button></div></article>`).join('')}</div>`
    : '<div class="empty"><b>لا توجد مستندات محفوظة</b>استخدم زر «حفظ في الأرشيف» في صفحات البحث والتقارير والمستندات</div>';
}
window.deleteDoc = async id => {
  if (!confirmBox('سيتم حذف المستند نهائيًا من الأرشيف. متابعة؟')) return;
  try { await api('/api/documents/' + id, { method: 'DELETE' }); toast('تم حذف المستند'); loadDocs(new URLSearchParams(new FormData($('#docFilter')))); } catch (x) { toast(x.message, true); }
};
window.printDocDirect = id => { const w = window.open('/api/documents/' + id + '/file', '_blank'); setTimeout(() => { try { w.print(); } catch { } }, 1200); };

/* ============================================================
   الإعدادات والنسخ الاحتياطي
   ============================================================ */
function bindSettings() {
  const bf = $('#brandForm');
  if (bf) bf.onsubmit = async e => { e.preventDefault(); try { await api('/api/settings', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('تم تطبيق الهوية'); await loadSettings(); } catch (x) { toast(x.message, true); } };
  const lf = $('#logoForm');
  if (lf) lf.onsubmit = async e => { e.preventDefault(); try { await api('/api/settings/logo', { method: 'POST', body: new FormData(e.target) }); toast('تم رفع الشعار'); await loadSettings(); } catch (x) { toast(x.message, true); } };
  $('#passwordForm').onsubmit = async e => { e.preventDefault(); try { await api('/api/change-password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('تم تغيير كلمة المرور'); e.target.reset(); } catch (x) { toast(x.message, true); } };
}
window.removeLogo = async () => {
  if (!confirmBox('إزالة الشعار الحالي؟ سيعود الختم الافتراضي في المستندات الجديدة.')) return;
  try { await api('/api/settings/logo/remove', { method: 'POST' }); toast('تمت إزالة الشعار'); await loadSettings(); go('settings'); } catch (x) { toast(x.message, true); }
};
window.createBackup = async () => { try { let d = await api('/api/backups', { method: 'POST' }); toast('تم إنشاء النسخة: ' + d.filename); go('settings'); } catch (x) { toast(x.message, true); } };
window.restoreBackup = async (id, name) => {
  if (!confirmBox(`سيتم تجهيز النسخة «${name}» للاستعادة.\nأغلق التطبيق ثم افتحه من جديد لتطبيقها.\nتأكيد الاستعادة؟`)) return;
  try { const d = await api(`/api/backups/${id}/restore`, { method: 'POST', body: { confirm: true } }); toast(d.message || 'تم تجهيز الاستعادة — أغلق التطبيق وافتحه مجددًا'); go('settings'); } catch (x) { toast(x.message, true); }
};

loadPublicSettings();
const _icObs = new MutationObserver(() => decorateIcons($('#appView')));
if (document.getElementById('appView')) { const _mo = new MutationObserver(() => decorateIcons($('#appView'))); _mo.observe($('#appView'), { childList: true, subtree: true }); }
if (token) boot();
