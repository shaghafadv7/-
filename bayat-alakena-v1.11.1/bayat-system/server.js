const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { buildDocument } = require('./lib/pdfdocs');
const { buildProjectsXlsx } = require('./lib/excel');

const app = express();
const PORT = process.env.PORT || 4173;
const dataDir = process.env.BAYAT_DATA_DIR || path.join(__dirname, 'data');
const SECRET_FILE = path.join(dataDir, '.secret');
fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(48).toString('hex'));
const JWT_SECRET = fs.readFileSync(SECRET_FILE, 'utf8');
const uploadDir = process.env.BAYAT_UPLOAD_DIR || path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const ARCHIVE_DIR = path.join(dataDir, 'pdf_archive');
fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 3 * 1024 * 1024 }, fileFilter: (_, f, cb) => cb(null, /image\/(png|jpeg)/.test(f.mimetype)) });
app.use(helmet({ contentSecurityPolicy: false }));
// v1.9: CORS مقيد — النظام يُستخدم من نفس المصدر (تطبيق PC/محلي) ولا يسمح بمواقع خارجية
app.use(cors({ origin: false }));
app.use(express.json({ limit: '2mb' })); app.use(morgan('tiny'));
// v1.9: Rate Limiting — حماية من الهجمات وإعادة الإرسال المكثف
app.use('/api/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'محاولات دخول كثيرة جدًا — انتظر 15 دقيقة قبل المحاولة مرة أخرى' } }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 3000, standardHeaders: true, legacyHeaders: false, skip: req => req.path.startsWith('/login'), message: { error: 'طلبات كثيرة — انتظر قليلًا ثم أعد المحاولة' } }));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// نظام الصلاحيات التفصيلي (Checkboxes) — مفروض على مستوى الخادم
// ============================================================
const PERMISSION_SCHEMA = [
  { key: 'projects', label: 'المشاريع', items: [
    ['view_projects', 'عرض المشاريع'], ['add_project', 'إضافة مشروع'], ['edit_project', 'تعديل مشروع'], ['delete_project', 'حذف مشروع']] },
  { key: 'units', label: 'الوحدات', items: [
    ['view_units', 'عرض الوحدات'], ['add_unit', 'إضافة وحدة'], ['edit_unit', 'تعديل وحدة'], ['delete_unit', 'حذف وحدة'],
    ['change_unit_status', 'تغيير حالة الوحدة'], ['edit_prices', 'تعديل الأسعار']] },
  { key: 'reservations', label: 'الحجوزات', items: [
    ['view_reservations', 'عرض الحجوزات'], ['add_reservation', 'إضافة حجز'], ['edit_reservation', 'تعديل حجز'], ['cancel_reservation', 'إلغاء حجز'],
    ['add_reservation_payment', 'تسجيل دفعة حجز (عربون)'], ['convert_reservation_sale', 'تحويل الحجز إلى بيع']] },
  { key: 'sales', label: 'المبيعات', items: [
    ['view_sales', 'عرض المبيعات'], ['add_sale', 'إضافة عملية بيع'], ['edit_sale', 'تعديل عملية بيع'], ['cancel_sale', 'إلغاء عملية بيع'],
    ['view_prices', 'عرض الأسعار'], ['view_discounts', 'عرض الخصومات'], ['edit_discounts', 'تعديل الخصومات'],
    ['view_payments', 'عرض الدفعات'], ['add_payment', 'تسجيل دفعات'], ['allow_overpayments', 'السماح بدفعة تزيد على المتبقي']] },
  { key: 'customers', label: 'العملاء', items: [
    ['view_customers', 'عرض العملاء'], ['view_customer_finance', 'عرض العملاء والمتبقيات المالية'], ['add_customer', 'إضافة عميل'], ['edit_customer', 'تعديل بيانات العميل'], ['delete_customer', 'حذف العميل']] },
  { key: 'marketers', label: 'المسوقون', items: [
    ['view_marketers', 'عرض المسوقين'], ['add_marketer', 'إضافة مسوق'], ['edit_marketer', 'تعديل مسوق'], ['disable_marketer', 'تعطيل مسوق'],
    ['view_marketer_sales', 'عرض مبيعات المسوقين'], ['view_commissions', 'عرض العمولات'], ['pay_commission', 'تسجيل دفعة للمسوق']] },
  { key: 'reports', label: 'التقارير', items: [
    ['view_sales_reports', 'عرض تقارير المبيعات'], ['view_financial_reports', 'عرض التقارير المالية'], ['view_marketer_reports', 'عرض تقارير المسوقين'],
    ['view_settlements', 'عرض تقارير التصفية'], ['manage_settlements', 'تسجيل تصفيات المستحقات'],
    ['create_reports', 'إنشاء التقارير'], ['export_pdf', 'تصدير PDF'], ['print_reports', 'طباعة التقارير'], ['save_pdf', 'حفظ PDF'], ['export_excel', 'تصدير Excel']] },
  { key: 'users', label: 'المستخدمون', items: [
    ['view_users', 'عرض المستخدمين'], ['add_user', 'إضافة مستخدم'], ['edit_user', 'تعديل مستخدم'], ['disable_user', 'تعطيل مستخدم'],
    ['delete_user', 'حذف مستخدم'], ['edit_permissions', 'تعديل صلاحيات المستخدمين']] },
  { key: 'system', label: 'النظام', items: [
    ['backup', 'النسخ الاحتياطي'], ['restore', 'استعادة النسخة الاحتياطية'], ['manage_settings', 'إدارة إعدادات النظام'],
    ['edit_branding', 'إدارة بيانات الشركة والهوية (الاسم، اسم الموقع، الشعار، التواصل)'], ['manage_docs_archive', 'إدارة أرشيف PDF']] },
];
const ALL_PERMS = PERMISSION_SCHEMA.flatMap(g => g.items.map(i => i[0]));
const P = (...keys) => keys; // اختصار لقوائم الصلاحيات الافتراضية
const ROLE_DEFAULTS = {
  super_admin: ALL_PERMS,
  admin: ALL_PERMS.filter(k => !['view_users', 'add_user', 'edit_user', 'disable_user', 'delete_user', 'edit_permissions', 'backup', 'restore', 'manage_settings'].includes(k)),
  sales_manager: P('view_projects', 'view_units', 'view_reservations', 'add_reservation', 'edit_reservation', 'cancel_reservation', 'add_reservation_payment', 'convert_reservation_sale',
    'view_sales', 'add_sale', 'view_prices', 'view_discounts', 'view_payments', 'view_customers', 'view_customer_finance', 'add_customer',
    'view_marketers', 'add_marketer', 'edit_marketer', 'disable_marketer', 'view_marketer_sales', 'view_commissions',
    'view_sales_reports', 'view_financial_reports', 'view_marketer_reports', 'view_settlements', 'manage_settlements', 'create_reports', 'export_pdf', 'print_reports', 'save_pdf', 'export_excel', 'manage_docs_archive'),
  accountant: P('view_projects', 'view_units', 'view_reservations', 'view_sales', 'add_sale', 'view_prices', 'view_discounts', 'view_payments', 'add_payment', 'allow_overpayments',
    'view_customers', 'view_customer_finance', 'view_marketers', 'view_marketer_sales', 'view_commissions', 'pay_commission',
    'view_sales_reports', 'view_financial_reports', 'view_marketer_reports', 'view_settlements', 'manage_settlements', 'create_reports', 'export_pdf', 'print_reports', 'save_pdf', 'export_excel'),
  reservations_officer: P('view_projects', 'view_units', 'view_reservations', 'add_reservation', 'edit_reservation', 'cancel_reservation', 'add_reservation_payment', 'convert_reservation_sale',
    'view_sales', 'add_sale', 'view_prices', 'view_discounts', 'view_customers', 'add_customer', 'export_pdf', 'print_reports', 'save_pdf'),
  sales: P('view_projects', 'view_units', 'view_reservations', 'add_reservation', 'edit_reservation', 'cancel_reservation', 'add_reservation_payment', 'convert_reservation_sale',
    'view_sales', 'add_sale', 'view_prices', 'view_discounts', 'add_customer', 'export_pdf', 'print_reports', 'save_pdf'),
  viewer: P('view_projects', 'view_units'),
};

// حساب الصلاحيات الفعلية: مدير النظام = الكل، وإلا فالتجاوب التفصيلي إن وُجد ثم افتراضي الدور
function effectivePerms(row) {
  if (row.role === 'super_admin') return { perms: new Set(ALL_PERMS), customized: false };
  let ov = null;
  if (row.permissions) { try { ov = JSON.parse(row.permissions); } catch { } }
  if (ov && typeof ov === 'object') {
    const set = new Set(ALL_PERMS.filter(k => ov[k] === true));
    return { perms: set, customized: true };
  }
  return { perms: new Set(ROLE_DEFAULTS[row.role] || []), customized: false };
}
const safeUser = u => {
  const { perms, customized } = effectivePerms(u);
  return { id: u.id, name: u.name, username: u.username, role: u.role, mustChangePassword: !!u.must_change_password, perms: [...perms], permsCustomized: customized };
};
function auth(req, res, next) {
  try {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = jwt.verify(t, JWT_SECRET);
    const current = db.prepare('SELECT id,name,username,role,active,must_change_password,permissions,token_version FROM users WHERE id=?').get(payload.id);
    if (!current || !current.active) throw Error('inactive');
    // v1.9: إبطال الجلسات — تغيير كلمة المرور أو إعادة تعيينها يُبطل كل الرموز القديمة فورًا
    if ((current.token_version || 0) !== (payload.token_version || 0)) throw Error('stale_token');
    const { perms, customized } = effectivePerms(current);
    // النطاق القديم: أدوار المبيعات/الحجوزات بدون تجاوب مخصص ترى مبيعاتها فقط (حفاظًا على السلوك السابق)
    const legacy = !customized && ['sales', 'reservations_officer'].includes(current.role);
    req.user = { id: current.id, name: current.name, username: current.username, role: current.role, mustChangePassword: !!current.must_change_password, perms, permsCustomized: customized, legacy };
    // v1.9: تتبع مصدر العملية (IP والجهاز) — يُسجل في سجل العمليات
    req.user.ip = req.ip;
    req.user.device = String(req.headers['user-agent'] || '').slice(0, 250);
    next();
  } catch { return res.status(401).json({ error: 'انتهت الجلسة أو تم تعطيل الحساب، سجل الدخول مجددًا' }); }
}
const hasPerm = (u, k) => u.role === 'super_admin' || u.perms.has(k);
function perm(...keys) {
  return (req, res, next) => keys.every(k => hasPerm(req.user, k)) ? next()
    : res.status(403).json({ error: 'ليس لديك صلاحية لهذه العملية' });
}
const canFinance = u => hasPerm(u, 'view_financial_reports') || u.role === 'super_admin' || u.role === 'admin';
function maskPhone(v = '') { v = String(v); return v.length > 4 ? '***' + v.slice(-4) : '****'; }
function log(user, action, type, id, details = {}) { db.prepare('INSERT INTO activity_log(user_id,action,entity_type,entity_id,details,ip,device) VALUES (?,?,?,?,?,?,?)').run(user?.id || null, action, type, String(id || ''), JSON.stringify(details), user?.ip || null, user?.device || null); }
function logUnitEvent(unitId, eventType, title, user, details = {}) {
  db.prepare('INSERT INTO unit_events(unit_id,event_type,title,details,user_id,user_name) VALUES (?,?,?,?,?,?)')
    .run(unitId, eventType, title, JSON.stringify(details), user?.id || null, user?.name || 'النظام');
}
const httpError = (msg, status = 403) => Object.assign(new Error(msg), { status });
const wrap = fn => (req, res) => { try { fn(req, res) } catch (e) { console.error(e); const msg = String(e.message).includes('UNIQUE') ? 'البيانات موجودة مسبقًا' : (String(e.message).includes('FOREIGN KEY') ? 'لا يمكن تنفيذ العملية لوجود بيانات مرتبطة' : e.message); res.status(e.status || 400).json({ error: msg }); } };
const nowDate = () => new Date().toISOString().slice(0, 10);
const fmtN = n => (+n || 0).toLocaleString('en-US'); // تنسيق أرقام الخادم (يعادل fmtE في الواجهة)
function uniqueNo(prefix, table, column) {
  const y = new Date().getFullYear();
  for (let i=0;i<20;i++) { const no=`${prefix}-${y}-${String(Date.now()).slice(-7)}${i||''}`; if(!db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=?`).get(no)) return no; }
  return `${prefix}-${y}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}
// v1.9: التحقق الموحد من طريقة الدفع — يمنع دفعًا بدون طريقة، وحوالة بدون مرجع، وشيكًا بدون رقم شيك
function validatePaymentMethod(method, refNo) {
  const m = ['cash', 'bank_transfer', 'check'].includes(method) ? method : null;
  if (!m) throw Error('طريقة الدفع مطلوبة (كاش / حوالة بنكية / شيك)');
  if (m === 'bank_transfer' && !String(refNo || '').trim()) throw Error('رقم التحويل / المرجع البنكي مطلوب للحوالة البنكية');
  if (m === 'check' && !String(refNo || '').trim()) throw Error('رقم الشيك مطلوب');
  return m;
}
// v1.9: رقم قيد فريد لدفعات الحجز
function rpUniqueNo() {
  const y = new Date().getFullYear();
  for (let i = 0; i < 20; i++) { const no = `RPY-${y}-${String(Date.now()).slice(-7)}${i || ''}`; if (!db.prepare('SELECT 1 FROM reservation_payments WHERE payment_no=?').get(no)) return no; }
  return `RPY-${y}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}
// ===== v1.10: دوال دفعات الحجز والإلغاءات =====
const RESERVATION_CANCEL_REASONS = {
  customer_request: 'طلب العميل', incomplete_payment: 'عدم استكمال السداد', expired: 'انتهاء مدة الحجز',
  unit_change: 'تغيير الوحدة', booking_error: 'خطأ في الحجز', other: 'سبب آخر',
};
const PAYMENT_STATUS_AR = { received: 'مستلمة', deposited: 'مودعة', refunded: 'مرتجعة', cancelled: 'ملغاة', pending: 'معلقة' };
// إجمالي المدفوع الفعلي للحجز = مجموع قيود الحجز غير الملغاة وغير المرتجعة
function reservationTotalPaid(resId) {
  return db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM reservation_payments
    WHERE reservation_id=? AND status NOT IN ('cancelled') AND payment_status NOT IN ('refunded','cancelled')`).get(resId).t;
}
// تفاصيل إلغاء الحجز (أحدث سجل) — إن وجد
function reservationCancellation(resId) {
  return db.prepare('SELECT * FROM reservation_cancellations WHERE reservation_id=? ORDER BY id DESC LIMIT 1').get(resId) || null;
}
// الاستردادات المرتبطة بحجز (كل سجلات الإلغاء التي فيها استرداد أو خصم)
function reservationRefunds(resId) {
  return db.prepare(`SELECT * FROM reservation_cancellations WHERE reservation_id=? AND (refund_amount>0 OR deducted_amount>0) ORDER BY id`).all(resId);
}
// ===== v1.9: Idempotency — منع تكرار الأثر المالي عند إعادة إرسال نفس الطلب ======
// (انقطاع الشبكة ثم إعادة المحاولة): نفس مفتاح الطلب = رفض فوري 409.
const IDEM_TTL = 10 * 60 * 1000;
const idemSeen = new Map();
function idemCleanup() { const now = Date.now(); for (const [k, t] of idemSeen) if (now - t > IDEM_TTL) idemSeen.delete(k); }
setInterval(idemCleanup, 5 * 60 * 1000).unref();
function idemGuard(req, res, next) {
  const key = req.headers['idempotency-key'];
  if (!key) return next();
  if (idemSeen.has(String(key))) return res.status(409).json({ error: 'تمت معالجة هذا الطلب مسبقًا (مفتاح إعادة الإرسال مكرر) — يمنع تكرار العملية المالية' });
  idemSeen.set(String(key), Date.now());
  res.on('finish', () => { if (res.statusCode >= 400) idemSeen.delete(String(key)); });
  next();
}

// ==================== حسابات مالية موحدة ====================
// ===== الحسابات المالية الموحدة (v1.8) =====
// العقد − الخصومات − المدفوعات = المتبقي (السالب = رصيد مستحق للعميل)
function saleDiscountsSum(saleId) {
  return db.prepare("SELECT COALESCE(SUM(amount),0) t FROM discounts WHERE sale_id=? AND status='active'").get(saleId).t;
}
function saleExpensesSum(saleId) {
  return db.prepare("SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE sale_id=? AND status='active'").get(saleId).t;
}
function saleAdjustments(saleId) {
  const rows = db.prepare("SELECT adjustment_type,COALESCE(SUM(amount),0) amount FROM financial_adjustments WHERE sale_id=? AND status='active' AND adjustment_type IN ('balance_debit','balance_credit') GROUP BY adjustment_type").all(saleId);
  const m = Object.fromEntries(rows.map(x => [x.adjustment_type, x.amount]));
  return { debit: m.balance_debit || 0, credit: m.balance_credit || 0, net: (m.balance_debit || 0) - (m.balance_credit || 0) };
}
// v1.9: إجمالي المدفوعات الفعلية للصفقة = دفعات جدول payments + دفعات الحجز المربوطة (العربون)
function saleTotalPaid(saleId) {
  const p = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE sale_id=? AND status='active'").get(saleId).t;
  const d = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM reservation_payments WHERE sale_id=? AND status IN ('transferred','linked_to_sale')").get(saleId).t;
  return p + d;
}
// معلومات دفعة الحجز المرتبطة بعملية البيع (رقم القيد، التاريخ، الطريقة، المرجع...)
function saleDepositInfo(saleId) {
  const rows = db.prepare(`SELECT rp.*,r.reservation_no,r.expires_at FROM reservation_payments rp JOIN reservations r ON r.id=rp.reservation_id WHERE rp.sale_id=? ORDER BY rp.id`).all(saleId);
  return { count: rows.length, total: rows.reduce((a, x) => a + x.amount, 0), payments: rows };
}
function recalcSale(saleId) {
  const s = db.prepare("SELECT * FROM sales WHERE id=?").get(saleId);
  if (!s) return;
  const base = s.base_price || s.list_price || 0;
  const discounts = s.status === 'cancelled' ? 0 : saleDiscountsSum(saleId);
  const adj = s.status === 'cancelled' ? {net:0} : saleAdjustments(saleId);
  const final = Math.max(0, base - discounts + adj.net);
  const paid = saleTotalPaid(saleId);
  const remaining = final - paid; // قد يكون سالبًا = رصيد مستحق للعميل
  db.prepare('UPDATE sales SET discount_amount=?,final_price=?,paid_amount=?,remaining_amount=? WHERE id=?')
    .run(discounts, final, paid, remaining, saleId);
  if (s.status === 'active') {
    const st = remaining <= 0 ? 'paid' : 'sold';
    db.prepare("UPDATE units SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('sold','paid')").run(st, s.unit_id);
  }
  // صفقات إعادة البيع: صفقة resold تحدث مدفوعها دون المساس بحالة الوحدة الحالية
}

// اللوحة المالية الكاملة لصفقة (بيع أو إعادة بيع)
function saleFinance(s) {
  const base = s.base_price || s.list_price || 0;
  const discounts = saleDiscountsSum(s.id);
  const adjustments = saleAdjustments(s.id);
  const final = Math.max(0, base - discounts + adjustments.net);
  const paid = saleTotalPaid(s.id);
  const remaining = final - paid;
  const expenses = saleExpensesSum(s.id);
  const commission = s.commission_total || 0; // مصروف بيع مباشر مرتبط بهذه العملية فقط
  const propertyCost = s.property_cost ?? s.purchase_cost ?? s.purchase_price ?? 0;
  // الإيراد المحقق = المحصل فعليًا، لكنه لا يتجاوز قيمة العقد النهائية:
  // أي مبلغ زائد عن السعر يُعتبر رصيدًا دائنًا للعميل وليس إيرادًا (لا يضخم الربح)
  const realizedRevenue = Math.min(paid, Math.max(0, final));
  const grossProfit = realizedRevenue - propertyCost;
  const totalCosts = propertyCost + expenses + commission;
  const netProfit = realizedRevenue - totalCosts;
  const pct = v => propertyCost > 0 ? Math.round(v / propertyCost * 10000) / 100 : null;
  return {
    base, discounts, adjustments, final, paid, collected: paid, realized_revenue: realizedRevenue, remaining,
    receivable: remaining > 0 ? remaining : 0,
    client_state: remaining > 0.001 ? 'due_from_client' : (remaining < -0.001 ? 'due_to_client' : 'settled'),
    client_due: remaining > 0 ? remaining : 0,
    client_credit: remaining < 0 ? -remaining : 0,
    property_cost: propertyCost, purchase_cost: propertyCost,
    resale_price: s.is_resale ? final : null,
    expenses, commission, total_costs: totalCosts,
    gross_profit: grossProfit,
    gross_profit_pct: pct(grossProfit),
    net_profit: netProfit,
    net_profit_pct: pct(netProfit),
    profit_basis: 'collected',
    profit_state: netProfit > 0 ? 'profit' : (netProfit < 0 ? 'loss' : 'even'),
    // عمولة المسوق (القيمة + النسبة عند كونها نسبة)
    commission_pct: s.commission_type === 'percent' ? s.commission_value : null,
    // مالية المالك السابق من صفقة الشراء السابقة (تُحدَّث تلقائيًا من سجلها)
    prev_owner_finance: (() => {
      if (!s.prev_sale_id) return null;
      const ps = db.prepare('SELECT * FROM sales WHERE id=?').get(s.prev_sale_id);
      if (!ps) return null;
      const pPaid = ps.paid_amount || 0;
      const pFinal = ps.final_price || 0;
      return { paid: pPaid, remaining: pFinal - pPaid, final: pFinal };
    })(),
    // المالك الجديد: المدفوع والمتبقي من قيمة إعادة البيع (بعد الخصومات)
    new_owner_finance: { paid, remaining },
  };
}

function financialAudit(user, action, entityType, entityId, saleId, oldValues, newValues, reason = '') {
  db.prepare('INSERT INTO financial_audit(user_id,action,entity_type,entity_id,sale_id,old_values,new_values,reason) VALUES(?,?,?,?,?,?,?,?)')
    .run(user?.id || null, action, entityType, entityId || null, saleId || null, JSON.stringify(oldValues || {}), JSON.stringify(newValues || {}), reason || '');
}
function profitDashboardData(q = {}) {
  const where = ["s.status!='cancelled'"], p = [];
  if (q.date_from) { where.push('s.sale_date>=?'); p.push(q.date_from); }
  if (q.date_to) { where.push('s.sale_date<=?'); p.push(q.date_to); }
  if (q.project_id) { where.push('u.project_id=?'); p.push(+q.project_id); }
  const rows = db.prepare(`SELECT s.*,u.unit_number,pr.name project_name,c.name customer_name,
    COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.sale_id=s.id AND e.status='active'),0) expenses_total
    FROM sales s JOIN units u ON u.id=s.unit_id JOIN projects pr ON pr.id=u.project_id JOIN customers c ON c.id=s.customer_id
    WHERE ${where.join(' AND ')} ORDER BY s.sale_date DESC,s.id DESC`).all(...p).map(s => {
      const f = saleFinance(s);
      return { ...s, ...f, sale_type: s.is_resale ? 'resale' : 'first_sale' };
    });
  const totals = rows.reduce((a, r) => {
    a.sales += r.final; a.collected += r.realized_revenue; a.receivables += Math.max(0, r.remaining);
    a.property_cost += r.property_cost; a.expenses += r.expenses; a.commissions += r.commission;
    a.total_costs += r.total_costs; a.net_profit += r.net_profit; return a;
  }, { sales:0,collected:0,receivables:0,property_cost:0,expenses:0,commissions:0,total_costs:0,net_profit:0 });
  return { rows, totals, formula: 'صافي الربح = المبالغ المحصلة فعليًا - تكلفة العقار - عمولات المسوقين - المصروفات الأخرى' };
}

function recalcCommission(saleId) {
  const s = db.prepare("SELECT * FROM sales WHERE id=?").get(saleId);
  if (!s) return;
  const paid = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM commission_payments WHERE sale_id=? AND status='active'").get(saleId).t;
  let status = s.commission_status;
  if (s.commission_status !== 'cancelled') {
    if (!s.marketer_id || !(s.commission_total > 0)) status = 'none';
    else if (paid >= s.commission_total && s.commission_total > 0) status = 'paid';
    else if (paid > 0) status = 'partial';
    else status = 'unpaid';
  }
  db.prepare('UPDATE sales SET commission_paid=?,commission_status=? WHERE id=?').run(paid, status, saleId);
}
function computeDiscount(base, type, value) {
  if (type === 'amount') return Math.max(0, +value || 0);
  if (type === 'percent') return Math.max(0, (+base || 0) * (+value || 0) / 100);
  return 0;
}

// ==================== الدخول والحساب ====================
app.post('/api/login', wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(req.body.username || '').trim());
  if (!u || !bcrypt.compareSync(req.body.password || '', u.password_hash)) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  const user = safeUser(u);
  // v1.9: إصدار الجلسة يحمل token_version للسماح بإبطالها عند تغيير كلمة المرور
  const token = jwt.sign({ ...user, token_version: u.token_version || 0 }, JWT_SECRET, { expiresIn: '10h' });
  log({ ...user, ip: req.ip, device: String(req.headers['user-agent'] || '').slice(0, 250) }, 'login', 'session', u.id);
  res.json({ token, user });
}));
app.post('/api/change-password', auth, wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(req.body.currentPassword || '', u.password_hash)) return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
  if (String(req.body.newPassword || '').length < 8) return res.status(400).json({ error: 'كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف' });
  db.prepare('UPDATE users SET password_hash=?,must_change_password=0,token_version=token_version+1 WHERE id=?').run(bcrypt.hashSync(req.body.newPassword, 12), u.id);
  log(req.user, 'change_password', 'user', u.id); res.json({ ok: true, token_version_bumped: true });
}));
app.get('/api/me', auth, wrap((req, res) => {
  const row = db.prepare('SELECT id,name,username,role,must_change_password,permissions FROM users WHERE id=?').get(req.user.id);
  res.json(safeUser(row));
}));
// ==================== الإعدادات والهوية ====================
app.get('/api/public-settings', wrap((req, res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const s = Object.fromEntries(rows.map(x => [x.key, x.value]));
  res.json({ site_name: s.site_name || 'بيات الأكنة', company_name_ar: s.company_name_ar || '', company_name_en: s.company_name_en || '',
    logo_url: s.logo_url || '', primary_color: s.primary_color, secondary_color: s.secondary_color, accent_color: s.accent_color });
}));
app.get('/api/settings', auth, wrap((req, res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  res.json(Object.fromEntries(rows.map(x => [x.key, x.value])));
}));
app.put('/api/settings', auth, perm('edit_branding'), wrap((req, res) => {
  const allowed = ['company_name_ar', 'company_name_en', 'site_name', 'primary_color', 'secondary_color', 'accent_color',
    'phone_main', 'phone_extra', 'whatsapp', 'email', 'address', 'cr_number', 'tax_number', 'doc_footer_note',
    'contact_phone', 'contact_website', 'contact_instagram'];
  const q = db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`);
  const tx = db.transaction(() => allowed.forEach(k => { if (req.body[k] != null) q.run(k, String(req.body[k])); }));
  tx(); log(req.user, 'update', 'settings', 'brand', req.body); res.json({ ok: true });
}));
app.post('/api/settings/logo', auth, perm('edit_branding'), upload.single('logo'), wrap((req, res) => {
  if (!req.file) throw Error('اختر صورة شعار بصيغة PNG أو JPG (الشفافية مدعومة في PNG)');
  const ext = path.extname(req.file.originalname) || '.png';
  const n = `logo-${Date.now()}${ext}`;
  fs.renameSync(req.file.path, path.join(req.file.destination, n));
  const url = '/uploads/' + n;
  db.prepare(`INSERT INTO settings(key,value) VALUES('logo_url',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(url);
  log(req.user, 'upload_logo', 'settings', 'logo'); res.json({ url });
}));
app.post('/api/settings/logo/remove', auth, perm('edit_branding'), wrap((req, res) => {
  db.prepare(`INSERT INTO settings(key,value) VALUES('logo_url','') ON CONFLICT(key) DO UPDATE SET value=''`).run();
  log(req.user, 'remove_logo', 'settings', 'logo'); res.json({ ok: true });
}));

// ==================== لوحة التحكم ====================
app.get('/api/dashboard', auth, wrap((req, res) => {
  const projects = db.prepare('SELECT COUNT(*) n FROM projects WHERE active=1').get().n;
  const total = db.prepare('SELECT COUNT(*) n FROM units').get().n;
  const statuses = db.prepare('SELECT status,COUNT(*) count FROM units GROUP BY status').all();
  const expiring = db.prepare(`SELECT COUNT(*) n FROM reservations WHERE status='active' AND datetime(expires_at)<=datetime('now','+2 days')`).get().n;
  const recent = db.prepare(`SELECT a.id,a.user_id,a.action,a.entity_type,a.entity_id,a.created_at,u.name user_name FROM activity_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 8`).all();
  const out = { projects, total, statuses: Object.fromEntries(statuses.map(x => [x.status, x.count])), expiring, recent };
  if (hasPerm(req.user, 'view_financial_reports')) {
    const pf = profitDashboardData();
    out.finance = {
      sales_count: pf.rows.length, final_total: pf.totals.sales,
      paid_total: pf.totals.collected, remaining_total: pf.totals.receivables,
      property_cost: pf.totals.property_cost, expenses: pf.totals.expenses,
      commission_due: pf.totals.commissions,
      commission_remaining: db.prepare("SELECT COALESCE(SUM(commission_total-commission_paid),0) t FROM sales WHERE status!='cancelled' AND commission_status IN ('unpaid','partial')").get().t,
      commission_paid: db.prepare("SELECT COALESCE(SUM(commission_paid),0) t FROM sales WHERE status!='cancelled'").get().t,
      total_costs: pf.totals.total_costs, net_profit: pf.totals.net_profit,
      payments_month: db.prepare("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE status='active' AND strftime('%Y-%m',pay_date)=strftime('%Y-%m','now')").get().t,
      marketers: db.prepare('SELECT COUNT(*) n FROM marketers WHERE active=1').get().n,
    };
  }
  res.json(out);
}));

// ==================== المشاريع والأدوار والنماذج ====================
app.get('/api/projects', auth, perm('view_projects'), wrap((req, res) => {
  res.json(db.prepare(`SELECT p.*,(SELECT COUNT(*) FROM floors f WHERE f.project_id=p.id) floors_count,(SELECT COUNT(*) FROM units u WHERE u.project_id=p.id) units_count,(SELECT COUNT(*) FROM units u WHERE u.project_id=p.id AND u.status='available') available_count,(SELECT COUNT(*) FROM units u WHERE u.project_id=p.id AND u.status='resale') resale_count FROM projects p WHERE p.active=1 ORDER BY p.id DESC`).all());
}));
app.post('/api/projects', auth, perm('add_project'), wrap((req, res) => {
  const b = req.body; if (!b.code || !b.name) throw Error('رمز واسم المشروع مطلوبان');
  const info = db.prepare(`INSERT INTO projects(code,name,location,construction_status,sales_status,progress,start_date,expected_date,notes) VALUES(?,?,?,?,?,?,?,?,?)`).run(b.code, b.name, b.location || '', b.construction_status || 'under_construction', b.sales_status || 'available', +b.progress || 0, b.start_date || null, b.expected_date || null, b.notes || '');
  log(req.user, 'create', 'project', info.lastInsertRowid, b); res.json({ id: info.lastInsertRowid });
}));
app.put('/api/projects/:id', auth, perm('edit_project'), wrap((req, res) => {
  const b = req.body;
  const old = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  let completed = b.construction_status === 'completed' ? (b.completed_date || old?.completed_date || nowDate()) : null;
  let progress = b.construction_status === 'completed' ? 100 : (+b.progress || 0);
  db.prepare(`UPDATE projects SET name=?,code=?,location=?,construction_status=?,sales_status=?,progress=?,start_date=?,expected_date=?,completed_date=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(b.name, b.code, b.location || '', b.construction_status, b.sales_status || 'available', progress, b.start_date || null, b.expected_date || null, completed, b.notes || '', req.params.id);
  if (b.construction_status === 'completed' && old && old.construction_status !== 'completed') {
    db.prepare(`UPDATE units SET sell_phase='completed',updated_at=CURRENT_TIMESTAMP WHERE project_id=? AND status NOT IN ('sold','paid')`).run(req.params.id);
    db.prepare(`SELECT id,unit_number FROM units WHERE project_id=?`).all(req.params.id).forEach(u =>
      logUnitEvent(u.id, 'project_completed', `اكتمل المشروع — أصبحت مرحلة البيع: بعد الاكتمال`, req.user, { unit: u.unit_number }));
    log(req.user, 'project_completed', 'project', req.params.id, {});
  }
  log(req.user, 'update', 'project', req.params.id, b); res.json({ ok: true });
}));
app.delete('/api/projects/:id', auth, perm('delete_project'), wrap((req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id=? AND active=1').get(req.params.id);
  if (!p) throw Error('المشروع غير موجود');
  const hasActive = db.prepare(`SELECT 1 FROM sales s JOIN units u ON u.id=s.unit_id WHERE u.project_id=? AND s.status='active' LIMIT 1`).get(req.params.id)
    || db.prepare(`SELECT 1 FROM reservations r JOIN units u ON u.id=r.unit_id WHERE u.project_id=? AND r.status='active' LIMIT 1`).get(req.params.id);
  if (hasActive) throw Error('لا يمكن حذف مشروع عليه مبيعات أو حجوزات نشطة؛ أغلقها أولًا');
  db.prepare('UPDATE projects SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.params.id);
  log(req.user, 'delete', 'project', req.params.id, { name: p.name, soft: true }); res.json({ ok: true });
}));

app.get('/api/projects/:id/floors', auth, perm('view_projects'), wrap((req, res) => res.json(db.prepare('SELECT * FROM floors WHERE project_id=? ORDER BY floor_order').all(req.params.id))));
app.post('/api/floors', auth, perm('edit_project'), wrap((req, res) => {
  const b = req.body;
  const i = db.prepare('INSERT INTO floors(project_id,name,floor_order,is_roof) VALUES(?,?,?,?)').run(b.project_id, b.name, +b.floor_order, b.is_roof ? 1 : 0);
  log(req.user, 'create', 'floor', i.lastInsertRowid, b); res.json({ id: i.lastInsertRowid });
}));
app.put('/api/floors/:id', auth, perm('edit_project'), wrap((req, res) => {
  const b = req.body;
  db.prepare('UPDATE floors SET name=?,floor_order=?,is_roof=? WHERE id=?').run(b.name, +b.floor_order, b.is_roof ? 1 : 0, req.params.id);
  log(req.user, 'update', 'floor', req.params.id, b); res.json({ ok: true });
}));

app.get('/api/projects/:id/models', auth, perm('view_projects'), wrap((req, res) => res.json(db.prepare('SELECT * FROM models WHERE project_id=? AND active=1 ORDER BY code').all(req.params.id))));
app.post('/api/models', auth, perm('edit_project'), wrap((req, res) => {
  const b = req.body;
  const i = db.prepare(`INSERT INTO models(project_id,code,name,type,rooms,bathrooms,area,view,base_price,description) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(b.project_id, b.code, b.name || '', b.type || 'apartment', +b.rooms, +b.bathrooms || 1, +b.area || 0, b.view || '', +b.base_price || 0, b.description || '');
  log(req.user, 'create', 'model', i.lastInsertRowid, b); res.json({ id: i.lastInsertRowid });
}));
app.put('/api/models/:id', auth, perm('edit_project'), wrap((req, res) => {
  const b = req.body;
  db.prepare(`UPDATE models SET code=?,name=?,type=?,rooms=?,bathrooms=?,area=?,view=?,base_price=?,description=? WHERE id=?`).run(b.code, b.name || '', b.type || 'apartment', +b.rooms, +b.bathrooms || 1, +b.area || 0, b.view || '', +b.base_price || 0, b.description || '', req.params.id);
  log(req.user, 'update', 'model', req.params.id, b); res.json({ ok: true });
}));

// ==================== الوحدات والبحث المتقدم ====================
const STATUS_AR = { available: 'متاح', reserved: 'محجوز', contracted: 'متعاقد', sold: 'مباع', paid: 'مسدد بالكامل', unavailable: 'غير متاح', resale: 'إعادة بيع', owner: 'للمالك', investment: 'استثمار' };
const PHASE_AR = { off_plan: 'تحت الإنشاء', completed: 'مكتمل' };
const METHOD_AR = { cash: 'كاش', bank_transfer: 'حوالة بنكية', check: 'شيك' };

function unitsQuery(q) {
  const where = ['p.active=1'], p = [];
  if (q.project_id) { where.push('u.project_id=?'); p.push(+q.project_id); }
  if (q.floor_id) { where.push('u.floor_id=?'); p.push(+q.floor_id); }
  if (q.model_id) { where.push('u.model_id=?'); p.push(+q.model_id); }
  if (q.status) { const sts = String(q.status).split(',').map(s => s.trim()).filter(Boolean); if (sts.length) { where.push(`u.status IN (${sts.map(() => '?').join(',')})`); p.push(...sts); } }
  if (q.rooms) { where.push('COALESCE(u.rooms,m.rooms)=?'); p.push(+q.rooms); }
  if (q.bathrooms) { where.push('COALESCE(u.bathrooms,m.bathrooms)>=?'); p.push(+q.bathrooms); }
  if (q.unit_number) { where.push('u.unit_number LIKE ?'); p.push(`%${q.unit_number}%`); }
  if (q.price_min) { where.push('u.price>=?'); p.push(+q.price_min); }
  if (q.price_max) { where.push('u.price<=?'); p.push(+q.price_max); }
  if (q.area_min) { where.push('COALESCE(u.area,m.area)>=?'); p.push(+q.area_min); }
  if (q.area_max) { where.push('COALESCE(u.area,m.area)<=?'); p.push(+q.area_max); }
  if (q.sell_phase) { where.push('u.sell_phase=?'); p.push(q.sell_phase); }
  if (q.model_code) { where.push('m.code LIKE ?'); p.push(`%${q.model_code}%`); }
  if (q.construction_status) { where.push('p.construction_status=?'); p.push(q.construction_status); }
  if (q.has_discount === '1' || q.has_discount === 'true') where.push("ds.discount_amount>0");
  if (q.owner) { where.push('u.owner_name LIKE ?'); p.push(`%${q.owner}%`); }
  if (q.search) { where.push('(u.unit_number LIKE ? OR m.code LIKE ? OR p.name LIKE ? OR u.owner_name LIKE ?)'); p.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`, `%${q.search}%`); }
  const base = ` FROM units u JOIN projects p ON p.id=u.project_id JOIN floors f ON f.id=u.floor_id LEFT JOIN models m ON m.id=u.model_id LEFT JOIN sales ds ON ds.unit_id=u.id AND ds.status='active' WHERE ${where.join(' AND ')}`;
  const total = db.prepare('SELECT COUNT(*) n' + base).get(...p).n;
  return { base, p, total };
}
app.get('/api/units', auth, perm('view_units'), wrap((req, res) => {
  const q = req.query;
  const { base, p, total } = unitsQuery(q);
  const page = Math.max(1, +q.page || 1), limit = Math.min(500, +q.limit || 20), offset = (page - 1) * limit;
  const rows = db.prepare(`SELECT u.*,p.name project_name,p.code project_code,p.construction_status,f.name floor_name,f.floor_order,m.code model_code,COALESCE(u.rooms,m.rooms) display_rooms,COALESCE(u.bathrooms,m.bathrooms) display_bathrooms,COALESCE(u.area,m.area) display_area,ds.final_price effective_price,ds.discount_amount eff_discount ${base} ORDER BY p.id DESC,f.floor_order,u.unit_number LIMIT ? OFFSET ?`).all(...p, limit, offset);
  const showPrice = hasPerm(req.user, 'view_prices');
  rows.forEach(r => { r.effective_price = r.effective_price ?? r.price; if (!showPrice) { r.price = null; r.effective_price = null; } });
  res.json({ rows, total, page, pages: Math.ceil(total / limit) });
}));

app.get('/api/units/:id', auth, perm('view_units'), wrap((req, res) => {
  const u = db.prepare(`SELECT u.*,p.name project_name,p.code project_code,p.construction_status,f.name floor_name,m.code model_code,m.name model_name,COALESCE(u.rooms,m.rooms) display_rooms,COALESCE(u.bathrooms,m.bathrooms) display_bathrooms,COALESCE(u.area,m.area) display_area,m.description model_description FROM units u JOIN projects p ON p.id=u.project_id JOIN floors f ON f.id=u.floor_id LEFT JOIN models m ON m.id=u.model_id WHERE u.id=?`).get(req.params.id);
  if (!u) return res.status(404).json({ error: 'الوحدة غير موجودة' });
  const showPrice = hasPerm(req.user, 'view_prices');
  const r = db.prepare(`SELECT r.*,c.name customer_name,c.phone customer_phone,us.name employee_name FROM reservations r JOIN customers c ON c.id=r.customer_id JOIN users us ON us.id=r.user_id WHERE r.unit_id=? AND r.status='active'`).get(req.params.id) || null;
  const showCustomers = hasPerm(req.user, 'view_customers');
  if (r) {
    if (showCustomers) u.reservation = r;
    else if ((req.user.role === 'sales' || req.user.role === 'reservations_officer') && r.user_id === req.user.id) u.reservation = { id: r.id, reservation_no: r.reservation_no, customer_name: r.customer_name, customer_phone: r.customer_phone, start_at: r.start_at, expires_at: r.expires_at, deposit: r.deposit, status: r.status, owned_by_me: true };
    else u.reservation = { status: 'active', private: true };
  } else u.reservation = null;
  const fullCustomer = showCustomers || req.user.role === 'reservations_officer';
  if (hasPerm(req.user, 'view_sales')) {
    u.sale = db.prepare(`SELECT s.*,c.name customer_name,c.phone customer_phone,cr.name created_by_name,sp.name salesperson_name,mk.name marketer_name,mk.code marketer_code FROM sales s JOIN customers c ON c.id=s.customer_id JOIN users cr ON cr.id=s.created_by LEFT JOIN users sp ON sp.id=s.salesperson_id LEFT JOIN marketers mk ON mk.id=s.marketer_id WHERE s.unit_id=? AND s.status IN ('active','resold') ORDER BY s.id DESC`).get(req.params.id) || null;
    if (u.sale && !req.user.legacy) {
      const own = u.sale.created_by === req.user.id || u.sale.salesperson_id === req.user.id;
      if (!showCustomers && !own) { u.sale.customer_phone = maskPhone(u.sale.customer_phone); }
    } else if (u.sale && req.user.legacy) {
      const own = u.sale.created_by === req.user.id || u.sale.salesperson_id === req.user.id;
      if (!own) u.sale = null; // النطاق القديم: مبيعاته فقط
    }
    if (u.sale) {
      if (!showPrice) ['base_price', 'list_price', 'final_price', 'paid_amount', 'remaining_amount'].forEach(k => u.sale[k] = null);
      if (!hasPerm(req.user, 'view_discounts')) ['discount_type', 'discount_value', 'discount_amount'].forEach(k => delete u.sale[k]);
      if (!hasPerm(req.user, 'view_commissions')) ['commission_type', 'commission_value', 'commission_total', 'commission_paid', 'commission_status', 'marketer_name', 'marketer_code'].forEach(k => delete u.sale[k]);
      if (hasPerm(req.user, 'view_payments')) {
        u.payments = db.prepare("SELECT * FROM payments WHERE sale_id=? AND status='active' ORDER BY pay_date,id").all(u.sale.id);
        const rps = [];
        if (u.sale) rps.push(...db.prepare(`SELECT rp.*,r.reservation_no FROM reservation_payments rp LEFT JOIN reservations r ON r.id=rp.reservation_id WHERE rp.sale_id=? ORDER BY rp.id DESC LIMIT 100`).all(u.sale.id));
        if (u.reservation && u.reservation.id) rps.push(...db.prepare(`SELECT rp.*,r.reservation_no FROM reservation_payments rp LEFT JOIN reservations r ON r.id=rp.reservation_id WHERE rp.reservation_id=? ORDER BY rp.id DESC LIMIT 50`).all(u.reservation.id));
        const seen = new Set();
        u.reservation_payments = rps.filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return true; });
      }
      if (hasPerm(req.user, 'view_prices')) {
        u.sale.discounts = db.prepare("SELECT * FROM discounts WHERE sale_id=? AND status='active' ORDER BY id DESC").all(u.sale.id);
        if (canFinance(req.user)) {
          u.sale.finance = saleFinance(u.sale);
          u.sale.expenses = db.prepare("SELECT * FROM expenses WHERE sale_id=? AND status='active' ORDER BY id DESC").all(u.sale.id);
        }
      }
    }
  }
  if (!showPrice) u.price = null;
  res.json(u);
}));
app.post('/api/units', auth, perm('add_unit'), wrap((req, res) => {
  const b = req.body; const m = b.model_id ? db.prepare('SELECT * FROM models WHERE id=?').get(b.model_id) : {};
  let price = +b.price || +m.base_price || 0;
  if (b.price != null && +b.price > 0 && +b.price !== +m.base_price && !hasPerm(req.user, 'edit_prices'))
    throw Error('لا تملك صلاحية تعديل الأسعار — يمكن استخدام سعر النموذج المرجعي فقط');
  const i = db.prepare(`INSERT INTO units(project_id,floor_id,model_id,unit_number,rooms,bathrooms,area,view,price,status,inventory_type,notes,sell_phase) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.project_id, b.floor_id, b.model_id || null, b.unit_number, b.rooms || m.rooms || null, b.bathrooms || m.bathrooms || null, b.area || m.area || null, b.view || m.view || '', price, b.status || 'available', b.inventory_type || 'company', b.notes || '', b.sell_phase || 'off_plan');
  logUnitEvent(i.lastInsertRowid, 'created', `تمت إضافة الوحدة${price ? ' بسعر ' + price.toLocaleString('en-US') + '' : ''}`, req.user, { price, status: b.status || 'available' });
  log(req.user, 'create', 'unit', i.lastInsertRowid, b); res.json({ id: i.lastInsertRowid });
}));
app.put('/api/units/:id', auth, perm('edit_unit'), wrap((req, res) => {
  const b = req.body; const old = db.prepare('SELECT * FROM units WHERE id=?').get(req.params.id);
  if (!old) throw Error('الوحدة غير موجودة');
  const priceChanged = +b.price !== old.price;
  const statusChanged = b.status !== old.status;
  if (priceChanged && !hasPerm(req.user, 'edit_prices')) throw Error('لا تملك صلاحية تعديل الأسعار');
  if (statusChanged && !hasPerm(req.user, 'change_unit_status')) throw Error('لا تملك صلاحية تغيير حالة الوحدة');
  if (b.status === 'sold' && old.status !== 'sold' && old.status !== 'paid') throw Error('استخدم عملية تسجيل البيع لتحويل الوحدة إلى مباعة');
  if (['sold', 'paid'].includes(old.status) && !['sold', 'paid'].includes(b.status) && db.prepare("SELECT 1 FROM sales WHERE unit_id=? AND status='active'").get(req.params.id)) throw Error('لا يمكن إلغاء حالة البيع من تعديل الوحدة؛ يلزم إجراء إلغاء بيع معتمد');
  if (b.status === 'reserved' && old.status !== 'reserved') throw Error('استخدم عملية الحجز لتحويل الوحدة إلى محجوزة');
  if (old.status === 'reserved' && b.status !== 'reserved' && db.prepare("SELECT 1 FROM reservations WHERE unit_id=? AND status='active'").get(req.params.id)) throw Error('ألغِ الحجز النشط أولًا قبل تغيير حالة الوحدة');
  if (b.status === 'resale' && old.status !== 'resale') throw Error('استخدم عملية «عرض الوحدة لإعادة البيع» لتسجيل إعادة البيع');
  db.prepare(`UPDATE units SET floor_id=?,model_id=?,unit_number=?,rooms=?,bathrooms=?,area=?,view=?,price=?,status=?,inventory_type=?,notes=?,sell_phase=?,owner_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(b.floor_id, b.model_id || null, b.unit_number, b.rooms || null, b.bathrooms || null, b.area || null, b.view || '', +b.price || 0, b.status, b.inventory_type || 'company', b.notes || '', b.sell_phase || old.sell_phase || 'off_plan', b.owner_name || old.owner_name || '', req.params.id);
  if (priceChanged) logUnitEvent(req.params.id, 'price_change', `تغيير السعر من ${old.price.toLocaleString('en-US')} إلى ${(+b.price).toLocaleString('en-US')}`, req.user, { from: old.price, to: +b.price });
  if (statusChanged) logUnitEvent(req.params.id, 'status_change', `تغيير الحالة من «${STATUS_AR[old.status] || old.status}» إلى «${STATUS_AR[b.status] || b.status}»`, req.user, { from: old.status, to: b.status });
  log(req.user, 'update', 'unit', req.params.id, { before: { price: old.price, status: old.status }, after: { price: +b.price, status: b.status } });
  res.json({ ok: true });
}));
app.delete('/api/units/:id', auth, perm('delete_unit'), wrap((req, res) => {
  const u = db.prepare('SELECT * FROM units WHERE id=?').get(req.params.id);
  if (!u) throw Error('الوحدة غير موجودة');
  if (db.prepare('SELECT 1 FROM sales WHERE unit_id=?').get(req.params.id) || db.prepare('SELECT 1 FROM reservations WHERE unit_id=?').get(req.params.id))
    throw Error('لا يمكن حذف وحدة لها مبيعات أو حجوزات مسجلة (السجل التاريخي محفوظ)');
  db.prepare('DELETE FROM units WHERE id=?').run(req.params.id);
  log(req.user, 'delete', 'unit', req.params.id, { unit_number: u.unit_number }); res.json({ ok: true });
}));

// قرار ما بعد اكتمال المشروع
app.post('/api/units/:id/owner-decision', auth, perm('change_unit_status'), wrap((req, res) => {
  const b = req.body; const u = db.prepare('SELECT * FROM units WHERE id=?').get(req.params.id);
  if (!u) throw Error('الوحدة غير موجودة');
  const decision = b.decision;
  if (decision === 'keep') {
    db.prepare("UPDATE units SET status='owner',owner_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(b.owner_name || u.owner_name || 'المالك', req.params.id);
    logUnitEvent(req.params.id, 'owner_decision', `قرار المالك: الاحتفاظ بالوحدة${b.owner_name ? ' — ' + b.owner_name : ''}`, req.user, { decision, owner: b.owner_name });
    log(req.user, 'owner_keep', 'unit', req.params.id, { owner: b.owner_name });
    return res.json({ ok: true, message: 'تم تسجيل قرار الاحتفاظ بالوحدة للمالك' });
  }
  if (decision === 'sell') {
    logUnitEvent(req.params.id, 'owner_decision', 'قرار المالك: بيع الوحدة عبر النظام — سُجّل التوجه وتبقى الوحدة لعملية البيع', req.user, { decision });
    log(req.user, 'owner_sell_intent', 'unit', req.params.id, {});
    return res.json({ ok: true, message: 'سُجّل قرار البيع؛ نفّذ عملية تسجيل البيع عند الاتفاق مع المشتري' });
  }
  if (decision === 'resale') {
    const newPrice = +b.new_price;
    if (!newPrice || newPrice <= 0) throw Error('سعر إعادة البيع مطلوب');
    if (!['sold', 'paid', 'owner', 'unavailable'].includes(u.status) && !db.prepare('SELECT 1 FROM sales WHERE unit_id=?').get(req.params.id)) throw Error('إعادة البيع تتطلب وحدة مبيعة أو محتفظًا بها من قبل مالك');
    const activeSale = db.prepare("SELECT * FROM sales WHERE unit_id=? AND status='active'").get(req.params.id);
    if (activeSale) db.prepare("UPDATE sales SET status='resold' WHERE id=?").run(activeSale.id);
    db.prepare(`UPDATE units SET status='resale',price=?,prev_price=?,owner_name=?,seller_name=?,resale_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(newPrice, u.price, b.owner_name || u.owner_name || 'المالك', b.owner_name || u.owner_name || 'المالك', b.date || nowDate(), req.params.id);
    logUnitEvent(req.params.id, 'resale_listed', `عرض الوحدة لإعادة البيع بسعر ${newPrice.toLocaleString('en-US')} (السعر السابق ${u.price.toLocaleString('en-US')}) — المالك: ${b.owner_name || u.owner_name || 'المالك'}`, req.user, { old_price: u.price, new_price: newPrice, owner: b.owner_name || u.owner_name, previous_sale: activeSale?.sale_no || null });
    log(req.user, 'resale_listed', 'unit', req.params.id, { old_price: u.price, new_price: newPrice });
    return res.json({ ok: true, message: 'تم تحويل الوحدة إلى حالة إعادة البيع مع الاحتفاظ بالسجل السابق' });
  }
  throw Error('قرار غير معروف');
}));

app.get('/api/units/:id/history', auth, perm('view_units'), wrap((req, res) => {
  const rows = db.prepare('SELECT id,event_type,title,details,user_name,created_at FROM unit_events WHERE unit_id=? ORDER BY id DESC LIMIT 300').all(req.params.id);
  const full = hasPerm(req.user, 'view_prices');
  const out = rows.map(r => {
    let d = null; try { d = JSON.parse(r.details); } catch { }
    if (!full && d && typeof d === 'object') { delete d.to; delete d.from; delete d.new_price; delete d.old_price; delete d.price; }
    return { ...r, details: d };
  });
  res.json(out);
}));

// ==================== العملاء ====================
app.get('/api/customers', auth, perm('view_customers'), wrap((req, res) => {
  const s = `%${req.query.search || ''}%`;
  let rows = db.prepare('SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY id DESC LIMIT 100').all(s, s);
  if (req.user.legacy && req.user.role === 'reservations_officer') rows = rows.map(c => ({ id: c.id, name: c.name, phone: c.phone, created_at: c.created_at }));
  res.json(rows);
}));
app.post('/api/customers', auth, perm('add_customer'), wrap((req, res) => {
  const b = req.body; if (!b.name || !b.phone) throw Error('اسم العميل والجوال مطلوبان');
  const i = db.prepare('INSERT INTO customers(name,phone,email,national_id,source,notes) VALUES(?,?,?,?,?,?)').run(b.name, b.phone, b.email || '', b.national_id || '', b.source || '', b.notes || '');
  log(req.user, 'create', 'customer', i.lastInsertRowid, { name: b.name }); res.json({ id: i.lastInsertRowid });
}));
app.put('/api/customers/:id', auth, perm('edit_customer'), wrap((req, res) => {
  const b = req.body; const old = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
  if (!old) throw Error('العميل غير موجود');
  if (b.phone && b.phone !== old.phone && db.prepare('SELECT 1 FROM customers WHERE phone=? AND id!=?').get(b.phone, req.params.id)) throw Error('رقم الجوال مسجل لعميل آخر');
  db.prepare('UPDATE customers SET name=COALESCE(?,name),phone=COALESCE(?,phone),email=COALESCE(?,email),national_id=COALESCE(?,national_id),source=COALESCE(?,source),notes=COALESCE(?,notes) WHERE id=?')
    .run(b.name || null, b.phone || null, b.email ?? null, b.national_id ?? null, b.source ?? null, b.notes ?? null, req.params.id);
  log(req.user, 'update', 'customer', req.params.id, { name: b.name || old.name });
  res.json({ ok: true });
}));
app.delete('/api/customers/:id', auth, perm('delete_customer'), wrap((req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
  if (!c) throw Error('العميل غير موجود');
  if (db.prepare('SELECT 1 FROM sales WHERE customer_id=?').get(req.params.id) || db.prepare('SELECT 1 FROM reservations WHERE customer_id=?').get(req.params.id))
    throw Error('لا يمكن حذف عميل له مبيعات أو حجوزات مسجلة');
  db.prepare('DELETE FROM customers WHERE id=?').run(req.params.id);
  log(req.user, 'delete', 'customer', req.params.id, { name: c.name }); res.json({ ok: true });
}));


// ==================== العملاء والمتبقيات المالية ====================
const customerFinancePerm = (req,res,next) => (hasPerm(req.user,'view_customer_finance') || hasPerm(req.user,'view_financial_reports')) ? next() : res.status(403).json({error:'ليس لديك صلاحية عرض المتبقيات المالية'});
app.get('/api/customer-finance', auth, customerFinancePerm, wrap((req,res) => {
  const q=req.query, where=["s.status!='cancelled'"], p=[];
  if(q.outstanding==='1') where.push('s.remaining_amount>0.005');
  if(q.status==='settled') where.push('s.remaining_amount<=0.005');
  if(q.project_id){where.push('u.project_id=?');p.push(+q.project_id);}
  if(q.search){where.push('(c.name LIKE ? OR c.phone LIKE ? OR s.sale_no LIKE ? OR u.unit_number LIKE ?)');for(let i=0;i<4;i++)p.push(`%${q.search}%`);}
  const rows=db.prepare(`SELECT c.id customer_id,c.name customer_name,c.phone,c.email,s.id sale_id,s.sale_no,s.invoice_no,s.sale_date,s.is_resale,s.final_price,s.paid_amount,s.remaining_amount,s.discount_amount,
    u.unit_number,pr.name project_name,
    (SELECT MAX(py.pay_date) FROM payments py WHERE py.sale_id=s.id AND py.status='active') last_payment_date,
    (SELECT py.amount FROM payments py WHERE py.sale_id=s.id AND py.status='active' ORDER BY py.pay_date DESC,py.id DESC LIMIT 1) last_payment_amount
    FROM sales s JOIN customers c ON c.id=s.customer_id JOIN units u ON u.id=s.unit_id JOIN projects pr ON pr.id=u.project_id
    WHERE ${where.join(' AND ')} ORDER BY CASE WHEN s.remaining_amount>0 THEN 0 ELSE 1 END,s.sale_date DESC,s.id DESC LIMIT 1000`).all(...p);
  const totals=rows.reduce((a,r)=>{a.sales+=r.final_price;a.paid+=r.paid_amount;a.remaining+=Math.max(0,r.remaining_amount);return a;},{sales:0,paid:0,remaining:0});
  res.json({rows:rows.map(r=>({...r,settlement_status:r.remaining_amount<=0.005?'settled':r.paid_amount>0?'partial':'unpaid'})),totals});
}));
app.get('/api/customer-finance/:customerId', auth, customerFinancePerm, wrap((req,res) => {
  const customer=db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.customerId);if(!customer)return res.status(404).json({error:'العميل غير موجود'});
  const sales=db.prepare(`${SALE_OUT_SQL} WHERE s.customer_id=? AND s.status!='cancelled' ORDER BY s.sale_date DESC,s.id DESC`).all(req.params.customerId).map(s=>({...s,finance:saleFinance(s)}));
  const saleIds=sales.map(x=>x.id); let movements=[];
  if(saleIds.length){const marks=saleIds.map(()=>'?').join(',');
    movements=[
      ...db.prepare(`SELECT py.created_at,py.pay_date movement_date,py.payment_no reference,'payment' movement_type,'دفعة عميل' title,py.amount,py.status,s.sale_no,u.unit_number FROM payments py JOIN sales s ON s.id=py.sale_id JOIN units u ON u.id=s.unit_id WHERE py.sale_id IN (${marks})`).all(...saleIds),
      ...db.prepare(`SELECT d.created_at,d.discount_date movement_date,d.discount_no reference,'discount' movement_type,'خصم: '||COALESCE(d.reason,'') title,d.amount,d.status,s.sale_no,u.unit_number FROM discounts d JOIN sales s ON s.id=d.sale_id JOIN units u ON u.id=s.unit_id WHERE d.sale_id IN (${marks})`).all(...saleIds),
      ...db.prepare(`SELECT e.created_at,e.expense_date movement_date,e.expense_no reference,'expense' movement_type,'مصروف: '||e.title title,e.amount,e.status,s.sale_no,u.unit_number FROM expenses e JOIN sales s ON s.id=e.sale_id JOIN units u ON u.id=s.unit_id WHERE e.sale_id IN (${marks})`).all(...saleIds),
      ...db.prepare(`SELECT fa.created_at,substr(fa.created_at,1,10) movement_date,CAST(fa.id AS TEXT) reference,'audit' movement_type,fa.action title,0 amount,'active' status,s.sale_no,u.unit_number FROM financial_audit fa JOIN sales s ON s.id=fa.sale_id JOIN units u ON u.id=s.unit_id WHERE fa.sale_id IN (${marks})`).all(...saleIds)
    ].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  }
  const totals=sales.reduce((a,s)=>{a.sales+=s.final_price;a.paid+=s.paid_amount;a.remaining+=Math.max(0,s.remaining_amount);return a;},{sales:0,paid:0,remaining:0});
  res.json({customer,sales,movements,totals,settlement_status:totals.remaining<=0.005?'settled':'partial'});
}));

// ==================== الحجوزات ====================
app.post('/api/reservations', auth, perm('add_reservation'), idemGuard, wrap((req, res) => {
  const b = req.body;
  const tx = db.transaction(() => {
    const u = db.prepare('SELECT * FROM units WHERE id=?').get(b.unit_id);
    if (!u || !['available', 'resale'].includes(u.status)) throw Error('الوحدة لم تعد متاحة للحجز');
    let cid = b.customer_id;
    if (!cid) {
      if (!b.customer_name || !b.customer_phone) throw Error('بيانات العميل مطلوبة');
      const old = db.prepare('SELECT id FROM customers WHERE phone=?').get(b.customer_phone);
      cid = old?.id || db.prepare('INSERT INTO customers(name,phone,email,notes) VALUES(?,?,?,?)').run(b.customer_name, b.customer_phone, b.customer_email || '', b.customer_notes || '').lastInsertRowid;
    }
    const cust = db.prepare('SELECT name FROM customers WHERE id=?').get(cid);
    // v1.10: المسوق المرتبط بالحجز (إن وجد) — يُورَّث تلقائيًا إلى البيع عند التحويل
    let marketerId = null;
    if (b.marketer_id) {
      const mk = db.prepare('SELECT id FROM marketers WHERE id=? AND active=1').get(+b.marketer_id);
      if (!mk) throw Error('المسوق غير موجود أو غير مفعل');
      marketerId = +b.marketer_id;
    }
    // ===== v1.11: ربط الحجز بإعادة البيع (نفس نظام الحجز — لا نظام منفصل) =====
    // source_type='resale' + resale_sale_id = رقم عملية إعادة البيع (صفقة resold)
    const sourceType = b.source_type === 'resale' ? 'resale' : 'direct';
    let resaleSaleId = null;
    if (sourceType === 'resale') {
      if (u.status !== 'resale') throw Error('لا يمكن ربط الحجز بإعادة بيع لوحدة غير معروضة لإعادة البيع');
      const rs = b.resale_sale_id
        ? db.prepare(`SELECT s.id,s.sale_no,s.final_price,c.name prev_owner_name FROM sales s JOIN customers c ON c.id=s.customer_id WHERE s.id=? AND s.unit_id=? AND s.status='resold'`).get(+b.resale_sale_id, b.unit_id)
        : null;
      if (!rs) throw Error('رقم عملية إعادة البيع غير صحيح أو غير مرتبط بالوحدة');
      resaleSaleId = +b.resale_sale_id;
    }
    const unitStatusBefore = u.status; // available / resale — تُستعاد عند الإلغاء
    const no = 'RSV-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-7);
    // v1.10: لقطة سعر الوحدة وقت الحجز (unit_price) + المسوق + رمز سبب الإلغاء (فارغ افتراضيًا)
    const i = db.prepare(`INSERT INTO reservations(reservation_no,unit_id,customer_id,user_id,expires_at,deposit,notes,marketer_id,unit_price,source_type,resale_sale_id,unit_status_before) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(no, b.unit_id, cid, req.user.id, b.expires_at, +b.deposit || 0, b.notes || '', marketerId, +u.price || 0, sourceType, resaleSaleId, unitStatusBefore);
    const ch = db.prepare(`UPDATE units SET status='reserved',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('available','resale')`).run(b.unit_id);
    if (ch.changes !== 1) throw Error('تم حجز الوحدة بواسطة مستخدم آخر');
    // ===== v1.9: تسجيل العربون كدفعة مالية فعلية في نفس معاملة الحجز (ذرّي — لا حجز بدون قيد) =====
    let payment = null;
    const deposit = +b.deposit || 0;
    if (deposit > 0) {
      const pMethod = validatePaymentMethod(b.pay_method || 'cash', b.pay_ref);
      const pno = rpUniqueNo();
      db.prepare(`INSERT INTO reservation_payments(payment_no,reservation_id,customer_id,unit_id,project_id,amount,pay_date,method,ref_no,check_date,check_status,check_due_date,bank,received_by,receipt_no,notes,created_by,deposit_account,payment_status)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(pno, i.lastInsertRowid, cid, b.unit_id, u.project_id, deposit, b.pay_date || nowDate(), pMethod, b.pay_ref || '',
          b.check_date || null, b.check_status || 'pending', b.check_due_date || null,
          b.bank || '', b.received_by || '', b.receipt_no || '', b.pay_notes || 'عربون عند الحجز', req.user.id,
          b.deposit_account || '', b.payment_status || 'received');
      payment = { payment_no: pno, amount: deposit, method: pMethod, ref_no: b.pay_ref || '', deposit_account: b.deposit_account || '', payment_status: b.payment_status || 'received' };
    }
    const resaleTxt = sourceType === 'resale' ? ` — حجز على وحدة إعادة بيع (عملية ${db.prepare('SELECT sale_no FROM sales WHERE id=?').get(resaleSaleId)?.sale_no || resaleSaleId})` : '';
    logUnitEvent(b.unit_id, 'reserved', `حجز الوحدة للعميل ${cust?.name || ''} حتى ${String(b.expires_at).slice(0, 10)}${deposit > 0 ? ` بعربون ${deposit.toLocaleString('en-US')}${payment ? ' — القيد ' + payment.payment_no : ''}` : ''}${marketerId ? ' — المسوق: ' + (db.prepare('SELECT name FROM marketers WHERE id=?').get(marketerId)?.name || '') : ''}${resaleTxt}`, req.user, { reservation_no: no, customer: cust?.name, deposit, marketer_id: marketerId, source_type: sourceType, resale_sale_id: resaleSaleId });
    log(req.user, 'reserve', 'unit', b.unit_id, { reservation_no: no, customer_id: cid, payment: payment?.payment_no || null, marketer_id: marketerId, unit_price: +u.price || 0, source_type: sourceType, resale_sale_id: resaleSaleId });
    return { id: i.lastInsertRowid, reservation_no: no, unit_price: +u.price || 0, marketer_id: marketerId, source_type: sourceType, resale_sale_id: resaleSaleId, unit_status_before: unitStatusBefore, payment };
  });
  res.json(tx());
}));
app.get('/api/reservations', auth, perm('view_reservations'), wrap((req, res) => {
  const full = hasPerm(req.user, 'view_customers');
  const showPay = hasPerm(req.user, 'view_payments') || hasPerm(req.user, 'add_reservation_payment');
  const q = req.query;
  // v1.10: فلاتر (حالة / بحث / تاريخ / سبب الإلغاء) — تُطبق على SQL
  const where = [], p = [];
  if (q.status) { where.push('r.status=?'); p.push(q.status); }
  if (q.source_type) { where.push('r.source_type=?'); p.push(q.source_type); }
  if (q.reason_code) { where.push('r.cancel_reason_code=?'); p.push(q.reason_code); }
  if (q.date_from) { where.push('date(r.created_at)>=?'); p.push(q.date_from); }
  if (q.date_to) { where.push('date(r.created_at)<=?'); p.push(q.date_to); }
  if (q.q) { where.push('(r.reservation_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR u.unit_number LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  const scopeWhere = full
    ? (where.length ? ' WHERE ' + where.join(' AND ') : '')
    : (' WHERE r.user_id=?' + (where.length ? ' AND ' + where.join(' AND ') : ''));
  const sql = `SELECT r.*,u.unit_number,p.name project_name,c.name customer_name,c.phone customer_phone,us.name employee_name,mk.name marketer_name,mk.code marketer_code,
    rs.sale_no resale_sale_no,rs.sale_date resale_sale_date,u.price resale_price,rsc.name resale_prev_owner,
    (SELECT COUNT(*) FROM reservation_payments rp WHERE rp.reservation_id=r.id AND rp.status NOT IN ('cancelled')) rp_count,
    (SELECT COALESCE(SUM(amount),0) FROM reservation_payments rp WHERE rp.reservation_id=r.id AND rp.status NOT IN ('cancelled')) rp_total,
    (SELECT payment_no FROM reservation_payments rp WHERE rp.reservation_id=r.id AND rp.status NOT IN ('cancelled') ORDER BY rp.id LIMIT 1) rp_first_no,
    (SELECT refund_amount FROM reservation_cancellations rc WHERE rc.reservation_id=r.id ORDER BY rc.id DESC LIMIT 1) last_refund_amount,
    (SELECT deducted_amount FROM reservation_cancellations rc WHERE rc.reservation_id=r.id ORDER BY rc.id DESC LIMIT 1) last_deducted_amount,
    (SELECT cancel_reason FROM reservation_cancellations rc WHERE rc.reservation_id=r.id ORDER BY rc.id DESC LIMIT 1) cancel_reason_text
    FROM reservations r JOIN units u ON u.id=r.unit_id JOIN projects p ON p.id=u.project_id JOIN customers c ON c.id=r.customer_id JOIN users us ON us.id=r.user_id LEFT JOIN marketers mk ON mk.id=r.marketer_id LEFT JOIN sales rs ON rs.id=r.resale_sale_id LEFT JOIN customers rsc ON rsc.id=rs.customer_id${scopeWhere} ORDER BY r.id DESC LIMIT 500`;
  const rows = full ? db.prepare(sql).all(...p) : db.prepare(sql).all(...p, req.user.id);
  if (!full) rows.forEach(x => { x.customer_name = 'عميل الحجز'; x.customer_phone = maskPhone(x.customer_phone); delete x.notes; });
  if (!showPay) rows.forEach(x => { x.rp_count = null; x.rp_total = null; x.rp_first_no = null; x.last_refund_amount = null; x.last_deducted_amount = null; });
  res.json(rows);
}));
app.put('/api/reservations/:id', auth, perm('edit_reservation'), wrap((req, res) => {
  const r = db.prepare("SELECT * FROM reservations WHERE id=? AND status='active'").get(req.params.id);
  if (!r) throw Error('الحجز غير نشط');
  if (req.user.legacy && req.user.role === 'sales' && r.user_id !== req.user.id) throw Error('لا يمكنك تعديل حجز مستخدم آخر');
  const b = req.body;
  let marketerId = b.marketer_id !== undefined ? (b.marketer_id ? +b.marketer_id : null) : r.marketer_id;
  if (marketerId && !db.prepare('SELECT 1 FROM marketers WHERE id=? AND active=1').get(marketerId)) throw Error('المسوق غير موجود أو غير مفعل');
  db.prepare('UPDATE reservations SET expires_at=COALESCE(?,expires_at),deposit=COALESCE(?,deposit),notes=COALESCE(?,notes),marketer_id=COALESCE(?,marketer_id) WHERE id=?')
    .run(b.expires_at || null, b.deposit != null ? +b.deposit : null, b.notes != null ? b.notes : null, marketerId, req.params.id);
  logUnitEvent(r.unit_id, 'reservation_updated', `تعديل بيانات الحجز ${r.reservation_no}`, req.user, { reservation_id: r.id });
  log(req.user, 'update_reservation', 'reservation', req.params.id, b);
  res.json({ ok: true });
}));
app.post('/api/reservations/:id/cancel', auth, perm('cancel_reservation'), wrap((req, res) => {
  const tx = db.transaction(() => {
    const r = db.prepare(`SELECT r.*,c.name customer_name,u.unit_number,u.project_id FROM reservations r JOIN customers c ON c.id=r.customer_id JOIN units u ON u.id=r.unit_id WHERE r.id=? AND r.status='active'`).get(req.params.id);
    if (!r) throw Error('الحجز غير نشط أو محوّل مسبقًا');
    if (req.user.legacy && req.user.role === 'sales' && r.user_id !== req.user.id) throw Error('لا يمكنك إلغاء حجز مستخدم آخر');
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw Error('سبب إلغاء الحجز مطلوب');
    // v1.10: رمز السبب من القائمة الموحدة (اختياري — يُحفظ للنص الأصلي دائمًا)
    const reasonCode = Object.prototype.hasOwnProperty.call(RESERVATION_CANCEL_REASONS, req.body.reason_code) ? req.body.reason_code : 'other';
    const totalPaid = reservationTotalPaid(r.id);
    const amountReturned = !!req.body.amount_returned;
    const refundAmount = Math.max(0, +req.body.refund_amount || 0);
    const deductedAmount = Math.max(0, +req.body.deducted_amount || 0);
    if (amountReturned && !(refundAmount > 0)) throw Error('حدد قيمة المبلغ المرتجع (أو ألغِ خيار الإرجاع)');
    if (amountReturned && refundAmount < totalPaid - 0.001 && deductedAmount <= 0)
      throw Error('عند إرجاع جزء من المبلغ يجب تحديد قيمة المبلغ المخصوم وسببه (الباقي يُحسب خصمًا)');
    if (deductedAmount > 0 && !String(req.body.deduction_reason || '').trim()) throw Error('سبب الخصم مطلوب عند خصم جزء من المبلغ');
    if (refundAmount + deductedAmount > totalPaid + 0.001) throw Error(`مجموع المرتجع والمخصوم (${fmtN(refundAmount + deductedAmount)}) يتجاوز المبلغ المدفوع (${fmtN(totalPaid)})`);
    // طريقة الاسترداد ورقمه — إلزامية عند وجود استرداد
    let refundMethod = null, refundRef = null, refundNo = null, refundDate = null;
    if (refundAmount > 0) {
      refundMethod = validatePaymentMethod(req.body.refund_method || 'cash', req.body.refund_ref);
      refundRef = req.body.refund_ref || '';
      refundDate = req.body.refund_date || nowDate();
      refundNo = 'RFD-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-7);
    }
    // 1) سجل الإلغاء والاسترداد — يبقى الحجز والدفعات الأصلية كما هي (لا حذف)
    const ci = db.prepare(`INSERT INTO reservation_cancellations(refund_no,reservation_id,reason,cancel_reason_code,cancelled_at,cancelled_by,total_paid,amount_returned,refund_amount,deducted_amount,deduction_reason,refund_method,refund_ref_no,refund_date,refund_account,notes,status)
      VALUES(?,?,?,?,CURRENT_TIMESTAMP,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(refundNo, r.id, reason, reasonCode, req.user.id, totalPaid, amountReturned ? 1 : 0, refundAmount, deductedAmount,
        req.body.deduction_reason || '', refundMethod, refundRef, refundDate, req.body.refund_account || '', req.body.notes || '', refundAmount > 0 ? 'active' : 'none');
    // 2) تحديث الحجز إلى ملغى مع رمز السبب
    db.prepare(`UPDATE reservations SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancel_reason=?,cancel_reason_code=? WHERE id=?`).run(reason, reasonCode, r.id);
    // 3) إذا غطى الاسترداد كامل المدفوع → قيود الحجز تصبح «مرتجعة» (تبقى السجلات محفوظة)
    if (refundAmount > 0) {
      db.prepare(`UPDATE reservation_payments SET payment_status='refunded' WHERE reservation_id=? AND status='active' AND payment_status NOT IN ('refunded','cancelled')`).run(r.id);
    }
    // 4) الوحدة تعود لحالتها الصحيحة: متاحة للحجز العادي، «إعادة بيع» لحجز إعادة البيع
    //    (تُستعاد الحالة المحفوظة قبل الحجز فقط إن لم توجد عملية أخرى على الوحدة)
    const restoreStatus = r.unit_status_before === 'resale' ? 'resale' : 'available';
    db.prepare(`UPDATE units SET status=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='reserved'
      AND NOT EXISTS(SELECT 1 FROM sales s WHERE s.unit_id=units.id AND s.status='active')
      AND NOT EXISTS(SELECT 1 FROM reservations r2 WHERE r2.unit_id=units.id AND r2.status='active' AND r2.id!=?)`).run(restoreStatus, r.unit_id, r.id);
    // 5) التوثيق الكامل
    const refundTxt = refundAmount > 0 ? ` — استرداد ${refundAmount.toLocaleString('en-US')}${refundNo ? ' (عملية ' + refundNo + ')' : ''}${deductedAmount > 0 ? ` بعد خصم ${deductedAmount.toLocaleString('en-US')} (${req.body.deduction_reason || ''})` : ''}` : (deductedAmount > 0 ? ` — خصم ${deductedAmount.toLocaleString('en-US')} (${req.body.deduction_reason || ''})` : '');
    logUnitEvent(r.unit_id, 'reservation_cancelled', `إلغاء الحجز ${r.reservation_no} (${RESERVATION_CANCEL_REASONS[reasonCode] || reason})${refundTxt} — أُعيدت الوحدة إلى «${restoreStatus === 'resale' ? 'إعادة بيع' : 'متاحة'}»`, req.user, { reservation_id: r.id, reason, reason_code: reasonCode, total_paid: totalPaid, refund: refundAmount, deducted: deductedAmount, refund_no: refundNo, restored_status: restoreStatus });
    log(req.user, 'cancel_reservation', 'unit', r.unit_id, { reservation_id: r.id, reason, reason_code: reasonCode, total_paid: totalPaid, refund: refundAmount, deducted: deductedAmount, refund_no: refundNo });
    financialAudit(req.user, 'reservation_cancel', 'reservation_cancellation', ci.lastInsertRowid, null,
      { status: 'active', total_paid: totalPaid },
      { status: 'cancelled', reason, reason_code: reasonCode, refund: refundAmount, deducted: deductedAmount, refund_no: refundNo }, reason);
    return { ok: true, cancellation_id: ci.lastInsertRowid, refund_no: refundNo, refund_amount: refundAmount, deducted_amount: deductedAmount, total_paid: totalPaid, unit_status: restoreStatus, source_type: r.source_type };
  });
  res.json(tx());
}));
// v1.10: تفاصيل إلغاء الحجز + الاستردادات المرتبطة
app.get('/api/reservations/:id/cancellation', auth, perm('view_reservations'), wrap((req, res) => {
  const r = db.prepare('SELECT * FROM reservations WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'الحجز غير موجود' });
  const cancellation = reservationCancellation(r.id);
  const refunds = reservationRefunds(r.id);
  const payments = db.prepare('SELECT * FROM reservation_payments WHERE reservation_id=? ORDER BY id').all(r.id);
  res.json({ reservation: r, cancellation, refunds, payments, total_paid: reservationTotalPaid(r.id) });
}));

// ==================== دفعات الحجز (العربون) — v1.9 ====================
// العربون دفعة أولى من قيمة البيع: تُسجل كقيد مالي فعلي مرتبط بالحجز/العميل/الوحدة/المشروع،
// وتُربط بعملية البيع عند التحويل دون تكرار.
app.post('/api/reservations/:id/payment', auth, perm('add_reservation_payment'), idemGuard, wrap((req, res) => {
  const tx = db.transaction(() => {
    const r = db.prepare(`SELECT r.*,c.name customer_name,u.project_id FROM reservations r JOIN customers c ON c.id=r.customer_id JOIN units u ON u.id=r.unit_id WHERE r.id=? AND r.status='active'`).get(req.params.id);
    if (!r) throw Error('الحجز غير نشط');
    const amount = +req.body.amount;
    if (!(amount > 0)) throw Error('مبلغ دفعة الحجز مطلوب');
    const method = validatePaymentMethod(req.body.method, req.body.ref_no);
    const no = rpUniqueNo();
    db.prepare(`INSERT INTO reservation_payments(payment_no,reservation_id,customer_id,unit_id,project_id,amount,pay_date,method,ref_no,check_date,check_status,check_due_date,bank,received_by,receipt_no,notes,created_by,deposit_account,payment_status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(no, r.id, r.customer_id, r.unit_id, r.project_id, amount, req.body.pay_date || nowDate(), method, req.body.ref_no || '',
        req.body.check_date || null, req.body.check_status || 'pending', req.body.check_due_date || null,
        req.body.bank || '', req.body.received_by || '', req.body.receipt_no || '', req.body.notes || '', req.user.id,
        req.body.deposit_account || '', req.body.payment_status || 'received');
    logUnitEvent(r.unit_id, 'reservation_payment', `تسجيل عربون ${amount.toLocaleString('en-US')} (${({ cash: 'كاش', bank_transfer: 'حوالة بنكية', check: 'شيك' })[method]}) على الحجز ${r.reservation_no} — القيد ${no}`, req.user, { amount, method, ref_no: req.body.ref_no, payment_no: no });
    log(req.user, 'reservation_payment', 'reservation', r.id, { payment_no: no, amount, method, reservation_no: r.reservation_no });
    return { payment_no: no, amount, method, reservation_id: r.id, reservation_no: r.reservation_no, pay_date: req.body.pay_date || nowDate(), ref_no: req.body.ref_no || '', deposit_account: req.body.deposit_account || '', payment_status: req.body.payment_status || 'received' };
  });
  res.json(tx());
}));
app.get('/api/reservations/:id/payments', auth, wrap((req, res) => {
  if (!hasPerm(req.user, 'view_payments') && !hasPerm(req.user, 'view_reservations')) return res.status(403).json({ error: 'ليس لديك صلاحية عرض دفعات الحجز' });
  const r = db.prepare('SELECT * FROM reservations WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'الحجز غير موجود' });
  res.json(db.prepare('SELECT * FROM reservation_payments WHERE reservation_id=? ORDER BY id').all(req.params.id));
}));

// ==================== v1.10: تتبع الدفعة الكامل (مسار المال) ====================
// من دفع المبلغ → لمن سُلم → في أي حساب أُودع → وما الحجز/البيع المرتبط
function paymentTrailRow(base, kind) {
  // base: صف الدفعة (reservation_payments أو payments) مع الحقول المدمجة
  const payer = db.prepare('SELECT name,phone FROM customers WHERE id=?').get(base.customer_id);
  const user = base.created_by ? db.prepare('SELECT name FROM users WHERE id=?').get(base.created_by) : null;
  const out = {
    kind, // 'reservation' | 'sale'
    payment_no: base.payment_no, amount: base.amount, pay_date: base.pay_date,
    created_at: base.created_at, method: base.method, ref_no: base.ref_no || null,
    check_date: base.check_date || null, check_status: base.check_status || null, check_due_date: base.check_due_date || null,
    bank: base.bank || null, receipt_no: base.receipt_no || null,
    received_by: base.received_by || null, deposit_account: base.deposit_account || null,
    payment_status: base.payment_status || 'received', status: base.status,
    payer: payer ? { name: payer.name, phone: payer.phone } : null,
    user: user ? user.name : null,
    unit: { unit_number: base.unit_number, project_name: base.project_name, project_code: base.project_code },
    customer_id: base.customer_id,
  };
  if (kind === 'reservation') {
    out.operation = { type: 'reservation', reservation_id: base.reservation_id, reservation_no: base.reservation_no, reservation_status: base.reservation_status, unit_price: base.unit_price, source_type: base.source_type || 'direct' };
    out.resale = base.source_type === 'resale' ? { resale_sale_id: base.resale_sale_id, resale_sale_no: base.resale_sale_no, resale_price: base.resale_price, resale_prev_owner: base.resale_prev_owner } : null;
    out.linked_sale = base.sale_id ? { sale_id: base.sale_id, sale_no: base.linked_sale_no } : null;
    out.cancellation = reservationCancellation(base.reservation_id);
    out.refunds = reservationRefunds(base.reservation_id);
  } else {
    out.operation = { type: 'sale', sale_id: base.sale_id, sale_no: base.sale_no, sale_status: base.sale_status, invoice_no: base.invoice_no };
    out.adjustments = db.prepare(`SELECT adjustment_no,adjustment_type,amount,reason,status FROM financial_adjustments WHERE source_payment_id=?`).all(base.id);
    out.reservation = null;
  }
  return out;
}
const RP_TRAIL_SQL = `SELECT rp.*,r.reservation_no,r.status reservation_status,r.unit_price,r.source_type,r.resale_sale_id,u.unit_number,p.name project_name,p.code project_code,s.sale_no linked_sale_no,rs.sale_no resale_sale_no,u.price resale_price,rsc.name resale_prev_owner
  FROM reservation_payments rp JOIN reservations r ON r.id=rp.reservation_id JOIN units u ON u.id=rp.unit_id JOIN projects p ON p.id=u.project_id LEFT JOIN sales s ON s.id=rp.sale_id LEFT JOIN sales rs ON rs.id=r.resale_sale_id LEFT JOIN customers rsc ON rsc.id=rs.customer_id`;
app.get('/api/reservation-payments/:id/trail', auth, wrap((req, res) => {
  if (!hasPerm(req.user, 'view_payments') && !hasPerm(req.user, 'view_reservations')) return res.status(403).json({ error: 'ليس لديك صلاحية عرض مسار الدفعة' });
  const row = db.prepare(`${RP_TRAIL_SQL} WHERE rp.id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'دفعة الحجز غير موجودة' });
  res.json(paymentTrailRow(row, 'reservation'));
}));
const PAY_TRAIL_SQL = `SELECT py.*,s.sale_no,s.status sale_status,s.invoice_no,u.unit_number,p.name project_name,p.code project_code,c.id customer_id,c.name customer_name
  FROM payments py JOIN sales s ON s.id=py.sale_id JOIN units u ON u.id=s.unit_id JOIN projects p ON p.id=u.project_id JOIN customers c ON c.id=s.customer_id`;
app.get('/api/payments/:id/trail', auth, wrap((req, res) => {
  if (!hasPerm(req.user, 'view_payments')) return res.status(403).json({ error: 'ليس لديك صلاحية عرض مسار الدفعة' });
  const row = db.prepare(`${PAY_TRAIL_SQL} WHERE py.id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'الدفعة غير موجودة' });
  res.json(paymentTrailRow(row, 'sale'));
}));
// بحث موحد بالرقم المرجعي/رقم العملية — يعيد مسار الدفعة
app.get('/api/finance/payment-trail', auth, wrap((req, res) => {
  if (!hasPerm(req.user, 'view_payments')) return res.status(403).json({ error: 'ليس لديك صلاحية عرض مسار الدفعة' });
  const q = String(req.query.q || '').trim();
  if (!q) throw Error('أدخل رقم العملية أو الرقم المرجعي');
  const rp = db.prepare(`${RP_TRAIL_SQL} WHERE rp.payment_no=? OR rp.ref_no=?`).get(q, q);
  if (rp) return res.json(paymentTrailRow(rp, 'reservation'));
  const py = db.prepare(`${PAY_TRAIL_SQL} WHERE py.payment_no=? OR py.ref_no=?`).get(q, q);
  if (py) return res.json(paymentTrailRow(py, 'sale'));
  return res.status(404).json({ error: 'لم يتم العثور على دفعة بهذا الرقم' });
}));

// ==================== v1.10: السجل المالي الموحد للدفعات ====================
app.get('/api/finance/payment-ledger', auth, perm('view_payments'), wrap((req, res) => {
  const q = req.query;
  const w = ['1=1'], p = [];
  if (q.type) { w.push('ledger.type=?'); p.push(q.type); }
  if (q.date_from) { w.push('ledger.pay_date>=?'); p.push(q.date_from); }
  if (q.date_to) { w.push('ledger.pay_date<=?'); p.push(q.date_to); }
  if (q.method) { w.push('ledger.method=?'); p.push(q.method); }
  if (q.payment_status) { w.push('ledger.payment_status=?'); p.push(q.payment_status); }
  if (q.account) { w.push('(ledger.deposit_account LIKE ? OR ledger.bank LIKE ? OR ledger.received_by LIKE ?)'); p.push(`%${q.account}%`, `%${q.account}%`, `%${q.account}%`); }
  if (q.recipient) { w.push('ledger.received_by LIKE ?'); p.push(`%${q.recipient}%`); }
  if (q.user_id) { w.push('ledger.created_by=?'); p.push(+q.user_id); }
  if (q.project_id) { w.push('ledger.project_id=?'); p.push(+q.project_id); }
  if (q.q) { w.push('(ledger.payment_no LIKE ? OR ledger.ref_no LIKE ? OR ledger.operation_no LIKE ? OR ledger.customer_name LIKE ? OR ledger.unit_number LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  const sql = `SELECT * FROM (
    SELECT 'reservation' type, rp.payment_no, rp.amount, rp.pay_date, rp.created_at, rp.method, rp.ref_no, rp.bank, rp.received_by, rp.deposit_account,
      rp.payment_status, rp.status, rp.created_by, rp.id source_id, rp.customer_id,
      r.reservation_no operation_no, 'حجز' operation_type, c.name customer_name, u.unit_number, p.name project_name, p.id project_id,
      u2.name user_name, rp.notes, rp.sale_id, (SELECT s.sale_no FROM sales s WHERE s.id=rp.sale_id) linked_sale_no
    FROM reservation_payments rp JOIN reservations r ON r.id=rp.reservation_id JOIN customers c ON c.id=rp.customer_id
      JOIN units u ON u.id=rp.unit_id JOIN projects p ON p.id=rp.project_id LEFT JOIN users u2 ON u2.id=rp.created_by
    UNION ALL
    SELECT 'sale' type, py.payment_no, py.amount, py.pay_date, py.created_at, py.method, py.ref_no, NULL bank, py.received_by, py.deposit_account,
      py.payment_status, py.status, py.created_by, py.id source_id, s.customer_id customer_id,
      s.sale_no operation_no, 'بيع' operation_type, c.name customer_name, u.unit_number, p.name project_name, p.id project_id,
      u2.name user_name, py.notes, py.sale_id, s.sale_no linked_sale_no
    FROM payments py JOIN sales s ON s.id=py.sale_id JOIN customers c ON c.id=s.customer_id
      JOIN units u ON u.id=s.unit_id JOIN projects p ON p.id=u.project_id LEFT JOIN users u2 ON u2.id=py.created_by
  ) ledger WHERE ${w.join(' AND ')} ORDER BY ledger.created_at DESC, ledger.payment_no DESC LIMIT 2000`;
  const rows = db.prepare(sql).all(...p);
  const totals = { amount: rows.reduce((a, x) => a + x.amount, 0), count: rows.length };
  res.json({ rows, totals });
}));
app.post('/api/reservation-payments/:id/cancel', auth, perm('add_reservation_payment'), wrap((req, res) => {
  const tx = db.transaction(() => {
    const rp = db.prepare("SELECT * FROM reservation_payments WHERE id=? AND status='active'").get(req.params.id);
    if (!rp) throw Error('دفعة الحجز غير موجودة أو ملغاة');
    if (!req.body.reason) throw Error('سبب الإلغاء مطلوب');
    if (rp.sale_id) throw Error('لا يمكن إلغاء عربون مرتبط بعملية بيع؛ ألغِ البيع أولًا أو عالج الحالة يدويًا');
    db.prepare("UPDATE reservation_payments SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancel_reason=? WHERE id=?").run(req.body.reason, rp.id);
    logUnitEvent(rp.unit_id, 'reservation_payment_cancelled', `إلغاء عربون ${rp.payment_no} بمبلغ ${rp.amount.toLocaleString('en-US')} — السبب: ${req.body.reason}`, req.user, { payment_no: rp.payment_no });
    log(req.user, 'cancel_reservation_payment', 'reservation', rp.reservation_id, { payment_no: rp.payment_no, reason: req.body.reason });
    financialAudit(req.user, 'cancel_reservation_payment', 'reservation_payment', rp.id, rp.sale_id || null, { status: 'active', amount: rp.amount }, { status: 'cancelled' }, req.body.reason);
  });
  tx(); res.json({ ok: true });
}));

// ==================== المبيعات ====================
const SALE_OUT_SQL = `SELECT s.*,u.unit_number,p.name project_name,p.code project_code,cr.name created_by_name,sp.name salesperson_name,c.name customer_name,c.phone customer_phone,mk.name marketer_name,mk.code marketer_code FROM sales s JOIN units u ON u.id=s.unit_id JOIN projects p ON p.id=u.project_id JOIN customers c ON c.id=s.customer_id JOIN users cr ON cr.id=s.created_by LEFT JOIN users sp ON sp.id=s.salesperson_id LEFT JOIN marketers mk ON mk.id=s.marketer_id`;
function stripSaleFields(user, s) {
  if (!hasPerm(user, 'view_prices')) { s.base_price = null; s.list_price = null; s.final_price = null; s.paid_amount = null; s.remaining_amount = null; }
  if (!hasPerm(user, 'view_discounts')) { delete s.discount_type; delete s.discount_value; delete s.discount_amount; }
  if (!hasPerm(user, 'view_commissions')) { delete s.commission_type; delete s.commission_value; delete s.commission_total; delete s.commission_paid; delete s.commission_status; delete s.marketer_name; delete s.marketer_code; }
  if (!hasPerm(user, 'view_customers')) { s.customer_phone = maskPhone(s.customer_phone); }
  return s;
}
app.get('/api/sales', auth, perm('view_sales'), wrap((req, res) => {
  const q = req.query; const where = ["s.status!='x'"], p = [];
  if (q.status) { where.push('s.status=?'); p.push(q.status); } else { where.push("s.status IN ('active','resold')"); }
  if (q.project_id) { where.push('u.project_id=?'); p.push(+q.project_id); }
  if (q.marketer_id) { where.push('s.marketer_id=?'); p.push(+q.marketer_id); }
  if (q.date_from) { where.push('s.sale_date>=?'); p.push(q.date_from); }
  if (q.date_to) { where.push('s.sale_date<=?'); p.push(q.date_to); }
  if (q.search) { where.push('(s.sale_no LIKE ? OR u.unit_number LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)'); p.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`, `%${q.search}%`); }
  if (req.user.legacy) { where.push('(s.created_by=? OR s.salesperson_id=?)'); p.push(req.user.id, req.user.id); }
  const rows = db.prepare(`${SALE_OUT_SQL} WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT ${Math.min(1000, +q.limit || 300)}`).all(...p);
  res.json(rows.map(s => stripSaleFields(req.user, s)));
}));

// ===== v1.9: إنشاء صفقة بيع موحّد (يستخدمه تسجيل البيع المباشر وتحويل الحجز) =====
// العربون (دفعة الحجز) يُعتبر دفعة أولى من قيمة البيع: يُربط بالصفقة تلقائيًا
// دون إنشاء دفعة مكررة، ويُحسب ضمن المدفوع والمتبقي من جدول الدفعات الحقيقي.
function createSaleCore(req, b, ctx = {}) {
  return db.transaction(() => {
    const u = db.prepare('SELECT * FROM units WHERE id=?').get(b.unit_id);
    if (!u) throw Error('الوحدة غير موجودة');
    if (u.status === 'sold' || u.status === 'paid' || db.prepare("SELECT 1 FROM sales WHERE unit_id=? AND status='active'").get(u.id)) throw Error('الوحدة مباعة مسبقًا');
    if (!['available', 'reserved', 'contracted', 'resale'].includes(u.status)) throw Error('حالة الوحدة لا تسمح بتسجيل البيع');
    let customerId = b.customer_id;
    // الحجز النشط: إما محدد صراحة (تحويل حجز) أو يُكتشف من الوحدة
    const activeReservation = ctx.reservation || db.prepare("SELECT * FROM reservations WHERE unit_id=? AND status='active'").get(u.id);
    if (ctx.reservation && !activeReservation) throw Error('الحجز غير نشط');
    // v1.11: إعادة البيع تشمل الوحدة المعروضة (status=resale) أو حجزًا مصدره إعادة البيع
    const isResale = u.status === 'resale' || (activeReservation && activeReservation.source_type === 'resale');
    if (!customerId && activeReservation) customerId = activeReservation.customer_id;
    if (!customerId) {
      if (!b.customer_name || !b.customer_phone) throw Error('بيانات العميل مطلوبة');
      const oldCustomer = db.prepare('SELECT id FROM customers WHERE phone=?').get(b.customer_phone);
      customerId = oldCustomer?.id || db.prepare('INSERT INTO customers(name,phone,email,notes) VALUES(?,?,?,?)').run(b.customer_name, b.customer_phone, b.customer_email || '', b.customer_notes || '').lastInsertRowid;
    }
    const cust = db.prepare('SELECT name FROM customers WHERE id=?').get(customerId);
    const base = +b.base_price || u.price;
    if (!(base > 0)) throw Error('السعر الأساسي مطلوب');
    const dType = ['none', 'amount', 'percent'].includes(b.discount_type) ? (b.discount_type || 'none') : 'none';
    const dValue = +b.discount_value || 0;
    if (dType === 'amount' && dValue > base) throw Error('قيمة الخصم تتجاوز السعر الأساسي');
    if (dType === 'percent' && dValue > 100) throw Error('نسبة الخصم لا يمكن أن تتجاوز 100%');
    const discountAmount = Math.round(computeDiscount(base, dType, dValue));
    const finalPrice = Math.max(0, base - discountAmount);
    if (!(finalPrice > 0)) throw Error('السعر النهائي بعد الخصم يجب أن يكون أكبر من صفر');
    // ===== دفعات الحجز (العربون) — تربط بالصفقة مرة واحدة فقط =====
    let depositPayments = [], depositSum = 0;
    if (activeReservation) {
      depositPayments = db.prepare("SELECT * FROM reservation_payments WHERE reservation_id=? AND status='active' ORDER BY id").all(activeReservation.id);
      const linkedElsewhere = db.prepare("SELECT 1 FROM reservation_payments WHERE reservation_id=? AND sale_id IS NOT NULL LIMIT 1").get(activeReservation.id);
      if (linkedElsewhere) throw Error('عربون هذا الحجز مرتبط بعملية بيع أخرى — يمنع نقله إلى بيع جديد');
      depositSum = depositPayments.reduce((a, x) => a + x.amount, 0);
    }
    const extraPaid = Math.max(0, +b.paid_amount || 0);
    const paid = depositSum + extraPaid;
    // عند الإنشاء: لا يجوز أن يتجاوز إجمالي المدفوع السعر النهائي إطلاقًا (سلوك أصلي محفوظ)
    if (paid > finalPrice + 0.001) throw Error(`المبلغ المدفوع (${fmtN(paid)}) لا يمكن أن يتجاوز السعر النهائي (${fmtN(finalPrice)})`);
    // طريقة الدفع: إذا أرسل العميل طريقة صراحة تُتحقق بمرجعها دائمًا (سلوك أصلي)،
    // وإلا تُؤخذ طريقة ومرجع دفعة الحجز (العربون) عند وجودها
    const method = (b.payment_method != null && b.payment_method !== '')
      ? validatePaymentMethod(b.payment_method, b.payment_ref)
      : validatePaymentMethod(depositPayments[0]?.method || 'cash', depositPayments[0]?.ref_no || '');
    let marketer = null;
    // v1.10: وراثة المسوق من الحجز عند التحويل (إن لم يُحدد مسوق في طلب البيع)
    let marketerId = b.marketer_id || (activeReservation && activeReservation.marketer_id) || null;
    if (marketerId) {
      marketer = db.prepare('SELECT * FROM marketers WHERE id=? AND active=1').get(marketerId);
      if (!marketer) throw Error('المسوق غير موجود أو غير مفعل');
    }
    let cType = 'none', cValue = 0, cTotal = 0;
    if (marketer && b.commission_type && b.commission_type !== 'none') {
      cType = b.commission_type; cValue = +b.commission_value || 0;
      if (!(cValue > 0)) throw Error('قيمة العمولة مطلوبة');
      if (cType === 'amount') { if (cValue > finalPrice) throw Error('قيمة العمولة تتجاوز قيمة البيع'); cTotal = cValue; }
      else if (cType === 'percent') { if (cValue > 100) throw Error('نسبة العمولة لا يمكن أن تتجاوز 100%'); cTotal = Math.round(finalPrice * cValue / 100); }
      else throw Error('نوع عمولة غير صحيح');
    }
    const salePhase = b.sale_phase === 'completed' || (b.sale_phase == null && (u.sell_phase === 'completed' || isResale)) ? 'completed' : 'off_plan';
    // ===== v1.8: سجل الملكية السابقة عند إعادة البيع =====
    let prevOwnerName = null, purchasePrice = null, purchaseDate = null, prevSale = null;
    if (isResale) {
      prevSale = db.prepare("SELECT s.*,c.name customer_name FROM sales s JOIN customers c ON c.id=s.customer_id WHERE s.unit_id=? AND s.status!='cancelled' ORDER BY s.id DESC LIMIT 1").get(u.id);
      prevOwnerName = b.prev_owner_name || (prevSale ? prevSale.customer_name : null) || u.owner_name || u.seller_name || '';
      purchasePrice = prevSale ? prevSale.final_price : (u.prev_price || u.price || 0);
      purchaseDate = prevSale ? prevSale.sale_date : (u.resale_date || null);
    }
    const investorName = isResale ? (b.investor_name || prevOwnerName) : (b.investor_name || null);
    const purchaseCost = b.purchase_cost != null ? +b.purchase_cost : (isResale ? purchasePrice : null);
    const prevSaleId = isResale && prevSale ? prevSale.id : null;
    const no = 'SAL-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-7);
    const i = db.prepare(`INSERT INTO sales(sale_no,unit_id,customer_id,created_by,salesperson_id,sale_date,list_price,final_price,paid_amount,remaining_amount,contract_no,notes,base_price,discount_type,discount_value,discount_amount,sale_phase,payment_method,payment_ref,marketer_id,commission_type,commission_value,commission_total,commission_paid,commission_status,is_resale,seller_name,prev_owner_name,purchase_price,purchase_date,investor_name,purchase_cost,prev_sale_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(no, u.id, customerId, req.user.id, b.salesperson_id || req.user.id, b.sale_date || nowDate(), u.price, finalPrice, 0, finalPrice, b.contract_no || '', b.notes || '', base, dType, dValue, discountAmount, salePhase, method, b.payment_ref || (depositPayments[0]?.ref_no || ''), marketer?.id || null, cType, cValue, cTotal, 0, cTotal > 0 ? 'unpaid' : 'none', isResale ? 1 : 0, isResale ? (u.seller_name || u.owner_name || '') : '', prevOwnerName, purchasePrice, purchaseDate, investorName, purchaseCost, prevSaleId);
    const propertyCost = b.property_cost != null && b.property_cost !== '' ? Math.max(0, +b.property_cost || 0) : (purchaseCost || 0);
    const invoiceNo = uniqueNo('INV', 'sales', 'invoice_no');
    const beneficiaryType = isResale && b.beneficiary_type !== 'company' ? 'investor' : 'company';
    const beneficiaryName = beneficiaryType === 'company' ? 'الشركة' : (b.beneficiary_name || prevOwnerName || investorName || 'المستثمر');
    db.prepare('UPDATE sales SET property_cost=?,invoice_no=?,beneficiary_type=?,beneficiary_name=? WHERE id=?').run(propertyCost, invoiceNo, beneficiaryType, beneficiaryName, i.lastInsertRowid);
    // ===== ربط دفعات الحجز بالصفقة (لا تُنشأ دفعة مكررة أبدًا) =====
    if (activeReservation) {
      for (const rp of depositPayments) {
        db.prepare("UPDATE reservation_payments SET sale_id=?,status='transferred' WHERE id=?").run(i.lastInsertRowid, rp.id);
      }
      db.prepare("UPDATE reservations SET status='converted' WHERE id=?").run(activeReservation.id);
    }
    if (discountAmount > 0) {
      const dno = 'DSC-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-7);
      db.prepare(`INSERT INTO discounts(discount_no,sale_id,type,value,amount,reason,approved_by,discount_date,created_by) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(dno, i.lastInsertRowid, dType, dValue, discountAmount, b.discount_reason || 'خصم عند تسجيل البيع', b.discount_approved_by || req.user.name, b.sale_date || nowDate(), req.user.id);
    }
    // دفعة افتتاحية تُنشأ فقط للمبلغ الإضافي فوق العربون (العربون مسجل مسبقًا كدفعة حجز)
    if (extraPaid > 0) {
      const pno = 'PAY-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-7);
      db.prepare(`INSERT INTO payments(payment_no,sale_id,amount,pay_date,method,ref_no,notes,created_by,received_by,deposit_account,payment_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(pno, i.lastInsertRowid, extraPaid, b.sale_date || nowDate(), method, b.payment_ref || '', depositSum > 0 ? 'دفعة إضافية فوق العربون عند تسجيل البيع' : 'دفعة افتتاحية عند تسجيل البيع', req.user.id,
          b.received_by || '', b.deposit_account || '', b.payment_status || 'received');
    }
    recalcSale(i.lastInsertRowid);
    const afterSale = db.prepare('SELECT paid_amount,remaining_amount FROM sales WHERE id=?').get(i.lastInsertRowid);
    db.prepare(`UPDATE units SET status=?,owner_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(afterSale.remaining_amount <= 0 ? 'paid' : 'sold', cust?.name || '', u.id);
    logUnitEvent(u.id, 'sold', `${isResale ? 'إعادة بيع الوحدة' : 'بيع الوحدة'} للعميل ${cust?.name || ''} بسعر نهائي ${finalPrice.toLocaleString('en-US')}${discountAmount > 0 ? ` (خصم ${discountAmount.toLocaleString('en-US')})` : ''} — رقم البيع ${no}${depositSum > 0 ? ` — العربون المحتسب ضمن المدفوع: ${depositSum.toLocaleString('en-US')}` : ''}${isResale && prevOwnerName ? ` — المالك السابق: ${prevOwnerName} (شراء: ${(purchasePrice || 0).toLocaleString('en-US')}${purchaseDate ? ' بتاريخ ' + purchaseDate : ''})` : ''}`, req.user, { sale_no: no, final_price: finalPrice, discount: discountAmount, paid, deposit: depositSum, prev_owner: prevOwnerName, purchase_price: purchasePrice, purchase_date: purchaseDate });
    if (marketer && cTotal > 0) logUnitEvent(u.id, 'commission', `ربط المسوق ${marketer.name} بعمولة ${cTotal.toLocaleString('en-US')}`, req.user, { marketer: marketer.name, commission: cTotal });
    log(req.user, 'create_sale', 'unit', u.id, { sale_id: i.lastInsertRowid, sale_no: no, final_price: finalPrice, discount: discountAmount, marketer: marketer?.name || null, commission: cTotal, is_resale: isResale, deposit_linked: depositSum });
    return {
      id: i.lastInsertRowid, sale_no: no, invoice_no: invoiceNo, beneficiary_type: beneficiaryType,
      final_price: finalPrice, discount_amount: discountAmount, is_resale: isResale,
      paid_amount: afterSale.paid_amount, remaining_amount: afterSale.remaining_amount,
      deposit: { count: depositPayments.length, total: depositSum, payments: depositPayments.map(rp => ({ payment_no: rp.payment_no, amount: rp.amount, pay_date: rp.pay_date, method: rp.method, ref_no: rp.ref_no })) },
    };
  })();
}
app.post('/api/sales', auth, perm('add_sale'), idemGuard, wrap((req, res) => {
  const result = createSaleCore(req, req.body);
  if (result.is_resale) { const sr = ensureSettlementReport(result.id, req.user.id); result.report_no = sr.report_no; }
  res.json(result);
}));
// ===== v1.9: تحويل الحجز إلى بيع — يربط دفعة الحجز ولا ينشئ دفعة مكررة =====
app.post('/api/reservations/:id/convert-to-sale', auth, perm('convert_reservation_sale', 'add_sale'), idemGuard, wrap((req, res) => {
  const result = db.transaction(() => {
    const r = db.prepare("SELECT * FROM reservations WHERE id=? AND status='active'").get(req.params.id);
    if (!r) throw Error('الحجز غير نشط أو محوّل مسبقًا');
    const u = db.prepare('SELECT * FROM units WHERE id=?').get(r.unit_id);
    if (!u) throw Error('الوحدة غير موجودة');
    if (u.status !== 'reserved') throw Error('حالة الوحدة لا تسمح بالتحويل — يجب أن تكون محجوزة');
    const b = { ...req.body, unit_id: r.unit_id, customer_id: r.customer_id };
    return createSaleCore(req, b, { reservation: r });
  })();
  if (result.is_resale) { const sr = ensureSettlementReport(result.id, req.user.id); result.report_no = sr.report_no; }
  res.json({ ...result, converted: true });
}));

app.put('/api/sales/:id', auth, perm('edit_sale'), wrap((req, res) => {
  const tx = db.transaction(() => {
    const s = db.prepare("SELECT * FROM sales WHERE id=? AND status='active'").get(req.params.id);
    if (!s) throw Error('البيع غير نشط');
    const b = req.body;
    let base = s.base_price || s.list_price;
    const wantsDiscount = ['base_price', 'discount_type', 'discount_value'].some(k => b[k] !== undefined);
    if (wantsDiscount && !hasPerm(req.user, 'edit_discounts')) throw Error('تعديل الخصومات يتطلب صلاحية «تعديل الخصومات»');
    if (b.base_price !== undefined) base = +b.base_price;
    if (!(base > 0)) throw Error('السعر الأساسي مطلوب');
    let finalPrice = base - saleDiscountsSum(s.id);
    if (wantsDiscount) {
      // استبدال الخصم الحالي ببند جديد (يُلغى القديم مع بقاء السجل)
      const dType = ['none', 'amount', 'percent'].includes(b.discount_type) ? b.discount_type : 'none';
      const dValue = +b.discount_value || 0;
      if (dType === 'amount' && dValue > base) throw Error('قيمة الخصم تتجاوز السعر الأساسي');
      if (dType === 'percent' && dValue > 100) throw Error('نسبة الخصم لا يمكن أن تتجاوز 100%');
      const discountAmount = Math.round(computeDiscount(base, dType, dValue));
      finalPrice = Math.max(0, base - discountAmount);
      if (!(finalPrice > 0)) throw Error('السعر النهائي بعد الخصم يجب أن يكون أكبر من صفر');
      const paidNow = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE sale_id=? AND status='active'").get(s.id).t;
      if (finalPrice < paidNow - 0.001 && discountAmount > 0) throw Error(`السعر النهائي أصغر من المدفوع (${paidNow.toLocaleString('en-US')})`);
      db.prepare("UPDATE discounts SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancel_reason='استبدال بخصم معدل' WHERE sale_id=? AND status='active'").run(s.id);
      if (discountAmount > 0) {
        const dno = 'DSC-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-7);
        db.prepare(`INSERT INTO discounts(discount_no,sale_id,type,value,amount,reason,approved_by,discount_date,created_by) VALUES(?,?,?,?,?,?,?,?,?)`)
          .run(dno, s.id, dType, dValue, discountAmount, b.discount_reason || 'خصم معدل', b.discount_approved_by || req.user.name, nowDate(), req.user.id);
      }
      db.prepare('UPDATE sales SET discount_type=?,discount_value=? WHERE id=?').run(dType, dValue, s.id);
    }
    const method = b.payment_method !== undefined && ['cash', 'bank_transfer', 'check'].includes(b.payment_method) ? b.payment_method : s.payment_method;
    const ref = b.payment_ref !== undefined ? b.payment_ref : s.payment_ref;
    if ((method === 'check' || method === 'bank_transfer') && !ref) throw Error(method === 'check' ? 'رقم الشيك مطلوب' : 'رقم الحوالة مطلوب');
    db.prepare(`UPDATE sales SET sale_date=COALESCE(?,sale_date),contract_no=COALESCE(?,contract_no),notes=COALESCE(?,notes),base_price=?,payment_method=?,payment_ref=? WHERE id=?`)
      .run(b.sale_date || null, b.contract_no ?? null, b.notes ?? null, base, method, ref, req.params.id);
    recalcSale(s.id);
    const afterF = db.prepare('SELECT final_price FROM sales WHERE id=?').get(s.id);
    if (afterF.final_price !== s.final_price) logUnitEvent(s.unit_id, 'sale_edited', `تعديل الصفقة ${s.sale_no}: السعر النهائي من ${s.final_price.toLocaleString('en-US')} إلى ${afterF.final_price.toLocaleString('en-US')}`, req.user, { from: s.final_price, to: afterF.final_price });
    else logUnitEvent(s.unit_id, 'sale_edited', `تعديل بيانات الصفقة ${s.sale_no}`, req.user, {});
    log(req.user, 'update_sale', 'sale', s.id, { from: { final: s.final_price }, to: { final: finalPrice } });
  });
  tx(); res.json({ ok: true });
}));

app.post('/api/sales/:id/cancel', auth, perm('cancel_sale'), wrap((req, res) => {
  const tx = db.transaction(() => {
    const s = db.prepare("SELECT s.*,c.name customer_name FROM sales s JOIN customers c ON c.id=s.customer_id WHERE s.id=? AND s.status IN ('active','resold')").get(req.params.id);
    if (!s) throw Error('البيع غير نشط');
    if (!req.body.reason) throw Error('سبب إلغاء البيع مطلوب');
    db.prepare("UPDATE payments SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancel_reason=? WHERE sale_id=? AND status='active'").run('إلغاء البيع ' + s.sale_no + ': ' + req.body.reason, s.id);
    db.prepare("UPDATE commission_payments SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancel_reason=? WHERE sale_id=? AND status='active'").run('إلغاء البيع ' + s.sale_no, s.id);
    db.prepare("UPDATE sales SET status='cancelled',commission_status='cancelled' WHERE id=?").run(s.id);
    db.prepare("UPDATE units SET status='available',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(s.unit_id);
    recalcSale(s.id);
    logUnitEvent(s.unit_id, 'sale_cancelled', `إلغاء البيع ${s.sale_no} (العميل ${s.customer_name}) — السبب: ${req.body.reason}. أُعيدت الوحدة إلى متاحة`, req.user, { sale_no: s.sale_no, reason: req.body.reason });
    log(req.user, 'cancel_sale', 'unit', s.unit_id, { sale_id: s.id, reason: req.body.reason });
  });
  tx(); res.json({ ok: true });
}));

app.post('/api/sales/:id/commission', auth, perm('edit_marketer', 'view_commissions'), wrap((req, res) => {
  const s = db.prepare("SELECT s.*,mk.name marketer_name FROM sales s LEFT JOIN marketers mk ON mk.id=s.marketer_id WHERE s.id=? AND s.status='active'").get(req.params.id);
  if (!s) throw Error('البيع غير نشط');
  const b = req.body;
  let marketerId = b.marketer_id ? +b.marketer_id : s.marketer_id;
  if (!marketerId && b.marketer_id !== null) throw Error('اختر المسوق أولًا');
  const marketer = marketerId ? db.prepare('SELECT * FROM marketers WHERE id=? AND active=1').get(marketerId) : null;
  if (b.marketer_id && !marketer) throw Error('المسوق غير موجود أو غير مفعل');
  let cType = b.commission_type || 'none', cValue = +b.commission_value || 0, cTotal = 0;
  if (marketer && cType !== 'none') {
    if (!(cValue > 0)) throw Error('قيمة العمولة مطلوبة');
    if (cType === 'amount') { if (cValue > s.final_price) throw Error('العمولة تتجاوز قيمة البيع'); cTotal = cValue; }
    else if (cType === 'percent') { if (cValue > 100) throw Error('النسبة لا تتجاوز 100%'); cTotal = Math.round(s.final_price * cValue / 100); }
    else throw Error('نوع عمولة غير صحيح');
  }
  db.prepare('UPDATE sales SET marketer_id=?,commission_type=?,commission_value=?,commission_total=? WHERE id=?').run(marketer?.id || null, marketer ? cType : 'none', marketer ? cValue : 0, cTotal, s.id);
  recalcCommission(s.id);
  logUnitEvent(s.unit_id, 'commission', marketer ? `تحديث عمولة المسوق ${marketer.name}: ${cTotal.toLocaleString('en-US')}` : 'إزالة العمولة من الصفقة', req.user, { marketer: marketer?.name, total: cTotal });
  log(req.user, 'update_commission', 'sale', s.id, { marketer: marketer?.name || null, total: cTotal });
  financialAudit(req.user, 'update_commission', 'sale', s.id, s.id, { marketer_id: s.marketer_id, total: s.commission_total }, { marketer_id: marketer?.id || null, total: cTotal }, 'تحديث عمولة البيع');
  res.json({ ok: true });
}));

// ==================== الدفعات ====================
const PAYMENT_OUT_SQL = `SELECT py.*,s.sale_no,s.unit_id,u.unit_number,p.name project_name,c.name customer_name FROM payments py JOIN sales s ON s.id=py.sale_id JOIN units u ON u.id=s.unit_id JOIN projects p ON p.id=u.project_id JOIN customers c ON c.id=s.customer_id`;
app.get('/api/payments', auth, perm('view_payments'), wrap((req, res) => {
  const q = req.query; const where = ["py.status='active'"], p = [];
  if (q.sale_id) { where.push('py.sale_id=?'); p.push(+q.sale_id); }
  if (q.date_from) { where.push('py.pay_date>=?'); p.push(q.date_from); }
  if (q.date_to) { where.push('py.pay_date<=?'); p.push(q.date_to); }
  if (q.method) { where.push('py.method=?'); p.push(q.method); }
  if (q.search) { where.push('(py.payment_no LIKE ? OR s.sale_no LIKE ? OR u.unit_number LIKE ? OR c.name LIKE ?)'); p.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`, `%${q.search}%`); }
  res.json(db.prepare(`${PAYMENT_OUT_SQL} WHERE ${where.join(' AND ')} ORDER BY py.id DESC LIMIT ${Math.min(1000, +q.limit || 300)}`).all(...p));
}));
app.get('/api/sales/:id/payments', auth, wrap((req, res) => {
  if (!hasPerm(req.user, 'view_payments')) return res.status(403).json({ error: 'ليس لديك صلاحية عرض الدفعات' });
  const s = db.prepare('SELECT * FROM sales WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'البيع غير موجود' });
  const allowed = !req.user.legacy || s.created_by === req.user.id || s.salesperson_id === req.user.id;
  if (!allowed) return res.status(403).json({ error: 'ليس لديك صلاحية عرض دفعات هذا البيع' });
  res.json(db.prepare("SELECT * FROM payments WHERE sale_id=? ORDER BY pay_date,id").all(req.params.id));
}));
app.post('/api/sales/:id/payments', auth, perm('add_payment'), idemGuard, wrap((req, res) => {
  const tx = db.transaction(() => {
    const s = db.prepare("SELECT s.*,c.name customer_name FROM sales s JOIN customers c ON c.id=s.customer_id WHERE s.id=? AND s.status IN ('active','resold')").get(req.params.id);
    if (!s) throw Error('البيع غير نشط');
    const amount = +req.body.amount;
    if (!(amount > 0)) throw Error('مبلغ الدفعة مطلوب');
    const method = validatePaymentMethod(req.body.method, req.body.ref_no);
    // v1.9: منع الدفع الزائد إلا بصلاحية خاصة (allow_overpayments)
    const remainingNow = (s.final_price || 0) - (s.paid_amount || 0);
    if (amount > remainingNow + 0.001 && !hasPerm(req.user, 'allow_overpayments'))
      throw Error(`المبلغ (${fmtN(amount)}) يتجاوز المتبقي (${fmtN(remainingNow)}) — يتطلب صلاحية «السماح بدفعة تزيد على المتبقي»`);
    const no = 'PAY-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-7);
    // v1.10: اسم المستلم + الحساب/الخزينة + حالة الدفعة (افتراضيات آمنة)
    db.prepare(`INSERT INTO payments(payment_no,sale_id,amount,pay_date,method,ref_no,notes,created_by,received_by,deposit_account,payment_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(no, s.id, amount, req.body.pay_date || nowDate(), method, req.body.ref_no || '', req.body.notes || '', req.user.id,
        req.body.received_by || '', req.body.deposit_account || '', req.body.payment_status || 'received');
    recalcSale(s.id);
    const after = db.prepare('SELECT paid_amount,remaining_amount FROM sales WHERE id=?').get(s.id);
    logUnitEvent(s.unit_id, 'payment', `تسجيل دفعة ${amount.toLocaleString('en-US')} (${{ cash: 'كاش', bank_transfer: 'حوالة بنكية', check: 'شيك' }[method]}) على البيع ${s.sale_no} — المدفوع الآن ${after.paid_amount.toLocaleString('en-US')} والمتبقي ${after.remaining_amount.toLocaleString('en-US')}`, req.user, { amount, sale_no: s.sale_no });
    log(req.user, 'payment', 'sale', s.id, { payment_no: no, amount });
    financialAudit(req.user, 'collect_payment', 'payment', null, s.id, { paid: s.paid_amount, remaining: s.remaining_amount }, { paid: after.paid_amount, remaining: after.remaining_amount, payment: amount }, req.body.notes || '');
    return { payment_no: no, paid: after.paid_amount, remaining: after.remaining_amount };
  });
  const r = tx(); res.json(r);
}));
app.post('/api/payments/:id/cancel', auth, perm('add_payment'), wrap((req, res) => {
  const tx = db.transaction(() => {
    const py = db.prepare("SELECT py.*,s.unit_id,s.sale_no FROM payments py JOIN sales s ON s.id=py.sale_id WHERE py.id=? AND py.status='active'").get(req.params.id);
    if (!py) throw Error('الدفعة غير موجودة أو ملغاة');
    if (!req.body.reason) throw Error('سبب الإلغاء مطلوب');
    db.prepare("UPDATE payments SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancel_reason=?,cancelled_by=? WHERE id=?").run(req.body.reason, req.user.id, py.id);
    recalcSale(py.sale_id);
    logUnitEvent(py.unit_id, 'payment_cancelled', `إلغاء الدفعة ${py.payment_no} بمبلغ ${py.amount.toLocaleString('en-US')} — السبب: ${req.body.reason}`, req.user, { payment_no: py.payment_no });
    log(req.user, 'cancel_payment', 'sale', py.sale_id, { payment_no: py.payment_no, reason: req.body.reason });
    financialAudit(req.user, 'cancel_payment', 'payment', py.id, py.sale_id, { status: 'active', amount: py.amount }, { status: 'cancelled' }, req.body.reason);
  });
  tx(); res.json({ ok: true });
}));


// ==================== السجل المالي الموحد والتسويات ====================
function fullSaleRecord(saleId) {
  const sale=db.prepare(`${SALE_OUT_SQL} WHERE s.id=?`).get(saleId);if(!sale)return null;
  const payments=db.prepare(`SELECT py.*,u.name created_by_name FROM payments py LEFT JOIN users u ON u.id=py.created_by WHERE py.sale_id=? ORDER BY py.pay_date,py.id`).all(saleId);
  const discounts=db.prepare(`SELECT d.*,u.name created_by_name FROM discounts d LEFT JOIN users u ON u.id=d.created_by WHERE d.sale_id=? ORDER BY d.discount_date,d.id`).all(saleId);
  const adjustments=db.prepare(`SELECT a.*,u.name created_by_name FROM financial_adjustments a LEFT JOIN users u ON u.id=a.created_by WHERE a.sale_id=? ORDER BY a.adjustment_date,a.id`).all(saleId);
  const expenses=db.prepare(`SELECT e.*,u.name created_by_name FROM expenses e LEFT JOIN users u ON u.id=e.created_by WHERE e.sale_id=? ORDER BY e.expense_date,e.id`).all(saleId);
  const commissionPayments=db.prepare(`SELECT cp.*,u.name created_by_name,b.settlement_no,b.invoice_no settlement_invoice_no FROM commission_payments cp LEFT JOIN users u ON u.id=cp.created_by LEFT JOIN marketer_settlement_batches b ON b.id=cp.settlement_batch_id WHERE cp.sale_id=? ORDER BY cp.pay_date,cp.id`).all(saleId);
  const settlement=sale.is_resale?db.prepare('SELECT * FROM settlement_reports WHERE resale_sale_id=?').get(saleId):null;
  const settlementTransactions=settlement?db.prepare(`SELECT st.*,se.party_name,se.party_type,u.name created_by_name FROM settlement_transactions st JOIN settlement_entries se ON se.id=st.entry_id LEFT JOIN users u ON u.id=st.created_by WHERE st.report_id=? ORDER BY st.transaction_date,st.id`).all(settlement.id):[];
  let movements=[{date:sale.sale_date,created_at:sale.created_at,reference:sale.invoice_no,type:'sale',title:`قيد البيع ${sale.sale_no}`,amount:sale.base_price||sale.list_price||0,effect:sale.base_price||sale.list_price||0,user:sale.created_by_name,status:sale.status}];
  discounts.forEach(x=>movements.push({date:x.discount_date,created_at:x.created_at,reference:x.discount_no,type:'discount',title:`خصم: ${x.reason||'بدون سبب'}`,amount:x.amount,effect:x.status==='active'?-x.amount:0,user:x.created_by_name,status:x.status,reason:x.reason}));
  adjustments.filter(x=>x.adjustment_type!=='collection').forEach(x=>movements.push({date:x.adjustment_date,created_at:x.created_at,reference:x.adjustment_no,type:'adjustment',title:x.adjustment_type==='balance_debit'?'زيادة ذمة بتسوية مستقلة':'تخفيض ذمة بتسوية مستقلة',amount:x.amount,effect:x.status==='active'?(x.adjustment_type==='balance_debit'?x.amount:-x.amount):0,user:x.created_by_name,status:x.status,reason:x.reason}));
  payments.forEach(x=>{const a=adjustments.find(z=>z.source_payment_id===x.id);movements.push({date:x.pay_date,created_at:x.created_at,reference:a?`${a.adjustment_no} / ${x.payment_no}`:x.payment_no,type:a?'adjustment_collection':'payment',title:a?'تحصيل بتسوية مستقلة':'دفعة / تحصيل',amount:x.amount,effect:x.status==='active'?-x.amount:0,user:x.created_by_name,status:x.status,reason:a?.reason||x.notes});});
  expenses.forEach(x=>movements.push({date:x.expense_date,created_at:x.created_at,reference:x.expense_no,type:'expense',title:`مصروف: ${x.title}`,amount:x.amount,effect:0,user:x.created_by_name,status:x.status,reason:x.notes}));
  if(sale.commission_total>0)movements.push({date:sale.sale_date,created_at:sale.created_at,reference:`COM-${sale.sale_no}`,type:'commission',title:`استحقاق عمولة المسوق ${sale.marketer_name||''}`,amount:sale.commission_total,effect:0,user:sale.created_by_name,status:sale.commission_status,reason:sale.commission_type==='percent'?`${sale.commission_value}%`:'مبلغ ثابت'});
  commissionPayments.forEach(x=>movements.push({date:x.pay_date,created_at:x.created_at,reference:x.cp_no,type:'commission_payment',title:`تصفية عمولة${x.settlement_no?' — '+x.settlement_no:''}`,amount:x.amount,effect:0,user:x.created_by_name,status:x.status,reason:x.notes}));
  settlementTransactions.forEach(x=>movements.push({date:x.transaction_date,created_at:x.created_at,reference:x.transaction_no,type:'settlement',title:`تصفية ${x.party_name}`,amount:x.amount,effect:0,user:x.created_by_name,status:x.status,reason:x.notes}));
  const deposit = saleDepositInfo(saleId);
  deposit.payments.forEach(x=>movements.push({date:x.pay_date,created_at:x.created_at,reference:x.payment_no,type:'reservation_payment',title:`دفعة حجز (عربون) — ${x.reservation_no||''}`,amount:x.amount,effect:x.status==='active'?-x.amount:0,user:x.created_by_name||'—',status:x.status,reason:x.notes}));
  movements.sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.created_at||'').localeCompare(String(b.created_at||'')));
  let balance=0;movements=movements.map(m=>{const before=balance;balance+=m.effect||0;return{...m,balance_before:before,balance_after:balance};});
  return {sale,finance:saleFinance(sale),payments,discounts,adjustments,expenses,commission_payments:commissionPayments,settlement,settlement_transactions:settlementTransactions,movements,deposit,reservation_payments:deposit.payments,beneficiary:{type:sale.beneficiary_type|| (sale.is_resale?'investor':'company'),name:sale.beneficiary_name||(sale.is_resale?sale.prev_owner_name:'الشركة'),account:sale.is_resale?'حساب العميل / المستثمر':'حساب الشركة'}};
}
app.get('/api/sales/:id/financial-record',auth,customerFinancePerm,wrap((req,res)=>{const d=fullSaleRecord(+req.params.id);if(!d)return res.status(404).json({error:'عملية البيع غير موجودة'});res.json(d);}));
app.post('/api/sales/:id/adjustments',auth,perm('add_payment'),idemGuard,wrap((req,res)=>{
  const result=db.transaction(()=>{const sale=db.prepare("SELECT * FROM sales WHERE id=? AND status IN ('active','resold')").get(req.params.id);if(!sale)throw Error('العملية الأصلية غير موجودة أو ملغاة');const type=['collection','balance_debit','balance_credit'].includes(req.body.adjustment_type)?req.body.adjustment_type:'collection',amount=+req.body.amount;if(!(amount>0))throw Error('قيمة التسوية مطلوبة');if(!req.body.reason)throw Error('سبب التسوية مطلوب');const no=uniqueNo('ADJ','financial_adjustments','adjustment_no');const ai=db.prepare('INSERT INTO financial_adjustments(adjustment_no,sale_id,invoice_no,adjustment_type,amount,adjustment_date,reason,method,ref_no,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)').run(no,sale.id,sale.invoice_no,type,amount,req.body.adjustment_date||nowDate(),req.body.reason,req.body.method||'cash',req.body.ref_no||'',req.user.id);let paymentNo=null;if(type==='collection'){paymentNo=uniqueNo('PAY','payments','payment_no');const pi=db.prepare('INSERT INTO payments(payment_no,sale_id,amount,pay_date,method,ref_no,notes,created_by,received_by,deposit_account,payment_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(paymentNo,sale.id,amount,req.body.adjustment_date||nowDate(),req.body.method||'cash',req.body.ref_no||'',`تحصيل بتسوية مستقلة ${no}: ${req.body.reason}`,req.user.id,req.body.received_by||'',req.body.deposit_account||'',req.body.payment_status||'received');db.prepare('UPDATE financial_adjustments SET source_payment_id=? WHERE id=?').run(pi.lastInsertRowid,ai.lastInsertRowid);}recalcSale(sale.id);const after=db.prepare('SELECT final_price,paid_amount,remaining_amount FROM sales WHERE id=?').get(sale.id);financialAudit(req.user,'financial_adjustment','financial_adjustment',ai.lastInsertRowid,sale.id,{final:sale.final_price,paid:sale.paid_amount,remaining:sale.remaining_amount},{...after,adjustment_no:no,type,amount},req.body.reason);log(req.user,'financial_adjustment','sale',sale.id,{adjustment_no:no,type,amount,invoice_no:sale.invoice_no});return{adjustment_no:no,payment_no:paymentNo,...after};})();res.json(result);
}));
app.post('/api/financial-adjustments/:id/cancel',auth,perm('add_payment'),wrap((req,res)=>{if(!req.body.reason)throw Error('سبب الإلغاء مطلوب');db.transaction(()=>{const a=db.prepare("SELECT * FROM financial_adjustments WHERE id=? AND status='active'").get(req.params.id);if(!a)throw Error('التسوية غير موجودة أو ملغاة');db.prepare("UPDATE financial_adjustments SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancel_reason=? WHERE id=?").run(req.body.reason,a.id);if(a.source_payment_id)db.prepare("UPDATE payments SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancel_reason=?,cancelled_by=? WHERE id=?").run(req.body.reason,req.user.id,a.source_payment_id);recalcSale(a.sale_id);financialAudit(req.user,'cancel_adjustment','financial_adjustment',a.id,a.sale_id,{status:'active',amount:a.amount},{status:'cancelled'},req.body.reason);})();res.json({ok:true});}));
app.get('/api/invoices/search',auth,customerFinancePerm,wrap((req,res)=>{const q=String(req.query.q||'').trim();if(!q)throw Error('أدخل رقم البيع أو الفاتورة');let srow=db.prepare('SELECT id FROM sales WHERE invoice_no=? OR sale_no=?').get(q,q);if(srow)return res.json({type:'sale',record:fullSaleRecord(srow.id)});let ir=db.prepare('SELECT id FROM settlement_reports WHERE invoice_no=? OR report_no=?').get(q,q);if(ir)return res.json({type:'investor_settlement',record:settlementReportDetails(ir.id)});let mb=db.prepare(`SELECT b.*,m.name marketer_name FROM marketer_settlement_batches b JOIN marketers m ON m.id=b.marketer_id WHERE b.invoice_no=? OR b.settlement_no=?`).get(q,q);if(mb){const items=db.prepare(`SELECT i.*,s.sale_no,s.invoice_no sale_invoice_no,s.sale_date,s.is_resale,s.commission_total,u.unit_number,pr.name project_name,c.name customer_name FROM marketer_settlement_items i JOIN sales s ON s.id=i.sale_id JOIN units u ON u.id=s.unit_id JOIN projects pr ON pr.id=u.project_id JOIN customers c ON c.id=s.customer_id WHERE i.batch_id=?`).all(mb.id);return res.json({type:'marketer_settlement',record:{...mb,items}});}return res.status(404).json({error:'لم يتم العثور على رقم البيع أو الفاتورة'});}));

// ==================== المسوقون والعمولات ====================
const MARKETER_STATS = `SELECT mk.*,
 (SELECT COUNT(*) FROM sales s WHERE s.marketer_id=mk.id AND s.status!='cancelled') units_count,
 (SELECT COALESCE(SUM(s.final_price),0) FROM sales s WHERE s.marketer_id=mk.id AND s.status!='cancelled') sales_total,
 (SELECT COALESCE(SUM(s.commission_total),0) FROM sales s WHERE s.marketer_id=mk.id AND s.status!='cancelled') commission_total,
 (SELECT COALESCE(SUM(s.commission_paid),0) FROM sales s WHERE s.marketer_id=mk.id AND s.status!='cancelled') commission_paid
 FROM marketers mk`;
app.get('/api/marketers', auth, perm('view_marketers'), wrap((req, res) => {
  const q = `%${req.query.search || ''}%`;
  const rows = db.prepare(`${MARKETER_STATS} WHERE mk.name LIKE ? OR mk.code LIKE ? OR COALESCE(mk.phone,'') LIKE ? ORDER BY mk.active DESC, mk.id DESC`).all(q, q, q);
  res.json(rows.map(r => ({ ...r, commission_due: Math.max(0, r.commission_total - r.commission_paid) })));
}));
app.post('/api/marketers', auth, perm('add_marketer'), wrap((req, res) => {
  const b = req.body; if (!b.name) throw Error('اسم المسوق مطلوب');
  let code = b.code || ('MK-' + String(Date.now()).slice(-5));
  const i = db.prepare('INSERT INTO marketers(code,name,phone,notes,active) VALUES(?,?,?,?,1)').run(code, b.name, b.phone || '', b.notes || '');
  log(req.user, 'create', 'marketer', i.lastInsertRowid, { name: b.name, code }); res.json({ id: i.lastInsertRowid });
}));
app.put('/api/marketers/:id', auth, perm('edit_marketer'), wrap((req, res) => {
  const b = req.body; if (!b.name) throw Error('اسم المسوق مطلوب');
  db.prepare('UPDATE marketers SET code=?,name=?,phone=?,notes=? WHERE id=?').run(b.code, b.name, b.phone || '', b.notes || '', req.params.id);
  log(req.user, 'update', 'marketer', req.params.id, { name: b.name }); res.json({ ok: true });
}));
app.post('/api/marketers/:id/toggle', auth, perm('disable_marketer'), wrap((req, res) => {
  const m = db.prepare('SELECT * FROM marketers WHERE id=?').get(req.params.id);
  if (!m) throw Error('المسوق غير موجود');
  db.prepare('UPDATE marketers SET active=? WHERE id=?').run(m.active ? 0 : 1, req.params.id);
  log(req.user, m.active ? 'disable' : 'enable', 'marketer', req.params.id, { name: m.name });
  res.json({ ok: true, active: !m.active });
}));
app.get('/api/marketers/:id', auth, perm('view_marketers'), wrap((req, res) => {
  const m = db.prepare(`${MARKETER_STATS} WHERE mk.id=?`).get(req.params.id);
  if (!m) return res.status(404).json({ error: 'المسوق غير موجود' });
  const sales = db.prepare(`SELECT s.sale_no,s.sale_date,s.final_price,s.commission_total,s.commission_paid,s.commission_status,s.is_resale,u.unit_number,p.name project_name,c.name customer_name FROM sales s JOIN units u ON u.id=s.unit_id JOIN projects p ON p.id=u.project_id JOIN customers c ON c.id=s.customer_id WHERE s.marketer_id=? AND s.status!='cancelled' ORDER BY s.id DESC`).all(req.params.id);
  const payments = db.prepare(`SELECT cp.*,s.sale_no FROM commission_payments cp JOIN sales s ON s.id=cp.sale_id WHERE cp.marketer_id=? ORDER BY cp.id DESC LIMIT 200`).all(req.params.id);
  res.json({ ...m, commission_due: Math.max(0, m.commission_total - m.commission_paid), sales, payments });
}));


// كشف حساب المسوق والتصفية الإجمالية
app.get('/api/marketers/:id/account', auth, perm('view_commissions'), wrap((req,res)=>{
  const m=db.prepare('SELECT * FROM marketers WHERE id=?').get(req.params.id);if(!m)return res.status(404).json({error:'المسوق غير موجود'});
  const rows=db.prepare(`SELECT s.id sale_id,s.sale_no,s.sale_date,s.is_resale,s.status sale_status,s.final_price,s.commission_type,s.commission_value,s.commission_total,s.commission_paid,s.commission_status,
    u.unit_number,pr.name project_name,c.name customer_name,s.prev_owner_name
    FROM sales s JOIN units u ON u.id=s.unit_id JOIN projects pr ON pr.id=u.project_id JOIN customers c ON c.id=s.customer_id
    WHERE s.marketer_id=? AND s.status!='cancelled' ORDER BY s.sale_date DESC,s.id DESC`).all(req.params.id).map(r=>({...r,commission_remaining:Math.max(0,r.commission_total-r.commission_paid)}));
  const totals=rows.reduce((a,r)=>{a.commission_total+=r.commission_total||0;a.settled+=r.commission_paid||0;a.unsettled+=Math.max(0,(r.commission_total||0)-(r.commission_paid||0));a.sales_count++;if(r.is_resale)a.resales++;else a.first_sales++;return a;},{commission_total:0,settled:0,unsettled:0,sales_count:0,first_sales:0,resales:0});
  const batches=db.prepare('SELECT * FROM marketer_settlement_batches WHERE marketer_id=? ORDER BY id DESC LIMIT 100').all(req.params.id);
  res.json({marketer:m,rows,totals,batches});
}));
app.get('/api/marketers/:id/unsettled-commissions', auth, perm('view_commissions'), wrap((req,res)=>{
  res.json(db.prepare(`SELECT s.id sale_id,s.sale_no,s.sale_date,s.is_resale,s.final_price,s.commission_total,s.commission_paid,(s.commission_total-s.commission_paid) remaining,u.unit_number,pr.name project_name,c.name customer_name
    FROM sales s JOIN units u ON u.id=s.unit_id JOIN projects pr ON pr.id=u.project_id JOIN customers c ON c.id=s.customer_id
    WHERE s.marketer_id=? AND s.status!='cancelled' AND s.commission_total-s.commission_paid>0.005 ORDER BY s.sale_date,s.id`).all(req.params.id));
}));
app.post('/api/marketers/:id/settlement-batches', auth, perm('pay_commission'), idemGuard, wrap((req,res)=>{
  const result=db.transaction(()=>{
    const marketer=db.prepare('SELECT * FROM marketers WHERE id=?').get(req.params.id);if(!marketer)throw Error('المسوق غير موجود');
    const ids=Array.isArray(req.body.sale_ids)?[...new Set(req.body.sale_ids.map(Number).filter(Boolean))]:[];if(!ids.length)throw Error('اختر عمولة واحدة على الأقل');
    const marks=ids.map(()=>'?').join(',');
    const rows=db.prepare(`SELECT * FROM sales WHERE id IN (${marks}) AND marketer_id=? AND status!='cancelled'`).all(...ids,+req.params.id);
    if(rows.length!==ids.length)throw Error('توجد عملية غير صالحة أو لا تخص المسوق المحدد');
    rows.forEach(s=>{if(s.commission_total-s.commission_paid<=0.005)throw Error(`العمولة ${s.sale_no} مصفاة مسبقًا`);if(db.prepare("SELECT 1 FROM marketer_settlement_items WHERE sale_id=? AND status='active'").get(s.id))throw Error(`العمولة ${s.sale_no} مدرجة في تصفية قائمة`);});
    const total=rows.reduce((a,s)=>a+(s.commission_total-s.commission_paid),0);
    const no='MST-'+new Date().getFullYear()+'-'+String(Date.now()).slice(-7), invoiceNo=uniqueNo('MINV','marketer_settlement_batches','invoice_no');
    const bi=db.prepare('INSERT INTO marketer_settlement_batches(settlement_no,invoice_no,marketer_id,total_amount,settlement_date,method,ref_no,notes,created_by) VALUES(?,?,?,?,?,?,?,?,?)').run(no,invoiceNo,marketer.id,total,req.body.settlement_date||nowDate(),['cash','bank_transfer','check'].includes(req.body.method)?req.body.method:'cash',req.body.ref_no||'',req.body.notes||'',req.user.id);
    const batchId=bi.lastInsertRowid;
    for(const s of rows){const amount=s.commission_total-s.commission_paid;const cpno='CMP-'+new Date().getFullYear()+'-'+String(Date.now()).slice(-7)+'-'+s.id;
      const cp=db.prepare('INSERT INTO commission_payments(cp_no,marketer_id,sale_id,amount,pay_date,method,ref_no,notes,created_by,settlement_batch_id,received_by,deposit_account,payment_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(cpno,marketer.id,s.id,amount,req.body.settlement_date||nowDate(),req.body.method||'cash',req.body.ref_no||'',`تصفية إجمالية ${no}${req.body.notes?' — '+req.body.notes:''}`,req.user.id,batchId,
          req.body.received_by||'',req.body.deposit_account||'',req.body.payment_status||'received');db.prepare('INSERT INTO marketer_settlement_items(batch_id,sale_id,commission_payment_id,amount) VALUES(?,?,?,?)').run(batchId,s.id,cp.lastInsertRowid,amount);recalcCommission(s.id);financialAudit(req.user,'marketer_batch_settlement','commission_payment',cp.lastInsertRowid,s.id,{commission_paid:s.commission_paid},{commission_paid:s.commission_total,batch_no:no},req.body.notes||'');}
    log(req.user,'marketer_batch_settlement','marketer',marketer.id,{settlement_no:no,total,sales:ids});return {id:batchId,settlement_no:no,invoice_no:invoiceNo,total_amount:total,items:rows.length};
  })();res.json(result);
}));
app.post('/api/marketer-settlement-batches/:id/cancel', auth, perm('pay_commission'), wrap((req,res)=>{
  if(!req.body.reason)throw Error('سبب الإلغاء مطلوب');db.transaction(()=>{const b=db.prepare("SELECT * FROM marketer_settlement_batches WHERE id=? AND status='active'").get(req.params.id);if(!b)throw Error('التصفية غير موجودة أو ملغاة');const items=db.prepare("SELECT * FROM marketer_settlement_items WHERE batch_id=? AND status='active'").all(b.id);db.prepare("UPDATE marketer_settlement_batches SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancel_reason=? WHERE id=?").run(req.body.reason,b.id);db.prepare("UPDATE marketer_settlement_items SET status='cancelled' WHERE batch_id=?").run(b.id);for(const i of items){db.prepare("UPDATE commission_payments SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancel_reason=? WHERE id=?").run(req.body.reason,i.commission_payment_id);recalcCommission(i.sale_id);}financialAudit(req.user,'cancel_marketer_batch','marketer_settlement_batch',b.id,null,{status:'active'},{status:'cancelled'},req.body.reason);})();res.json({ok:true});
}));

app.get('/api/commissions', auth, perm('view_commissions'), wrap((req, res) => {
  const q = req.query; const where = ["s.marketer_id IS NOT NULL"], p = [];
  if (q.status) { where.push('s.commission_status=?'); p.push(q.status); } else { where.push("s.status!='cancelled'"); }
  if (q.marketer_id) { where.push('s.marketer_id=?'); p.push(+q.marketer_id); }
  if (q.search) { where.push('(mk.name LIKE ? OR s.sale_no LIKE ? OR u.unit_number LIKE ?)'); p.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`); }
  const rows = db.prepare(`${SALE_OUT_SQL} WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT 500`).all(...p);
  res.json(rows.map(s => ({ ...s, commission_due: Math.max(0, s.commission_total - s.commission_paid) })));
}));
app.get('/api/sales/:id/commission-payments', auth, perm('view_commissions'), wrap((req, res) => {
  res.json(db.prepare(`SELECT cp.*,us.name created_by_name FROM commission_payments cp LEFT JOIN users us ON us.id=cp.created_by WHERE cp.sale_id=? ORDER BY cp.pay_date,cp.id`).all(req.params.id));
}));
app.post('/api/sales/:id/commission-payments', auth, perm('pay_commission'), wrap((req, res) => {
  const tx = db.transaction(() => {
    const s = db.prepare("SELECT s.*,mk.name marketer_name FROM sales s LEFT JOIN marketers mk ON mk.id=s.marketer_id WHERE s.id=? AND s.status IN ('active','resold')").get(req.params.id);
    if (!s) throw Error('الصفقة غير نشطة');
    if (!s.marketer_id || !(s.commission_total > 0)) throw Error('لا توجد عمولة مسجلة على هذه الصفقة');
    const amount = +req.body.amount;
    if (!(amount > 0)) throw Error('مبلغ الدفعة مطلوب');
    const due = s.commission_total - s.commission_paid;
    if (amount > due) throw Error(`المبلغ يتجاوز المتبقي للمسوق (${due.toLocaleString('en-US')})`);
    const method = validatePaymentMethod(req.body.method || 'cash', req.body.ref_no);
    const no = 'CMP-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-7);
    db.prepare(`INSERT INTO commission_payments(cp_no,marketer_id,sale_id,amount,pay_date,method,ref_no,notes,created_by,received_by,deposit_account,payment_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(no, s.marketer_id, s.id, amount, req.body.pay_date || nowDate(), method, req.body.ref_no || '', req.body.notes || '', req.user.id,
        req.body.received_by || '', req.body.deposit_account || '', req.body.payment_status || 'received');
    recalcCommission(s.id);
    const after = db.prepare('SELECT commission_paid,commission_status FROM sales WHERE id=?').get(s.id);
    logUnitEvent(s.unit_id, 'commission_payment', `دفع ${amount.toLocaleString('en-US')} للمسوق ${s.marketer_name} من عمولة البيع ${s.sale_no} — حالة العمولة: ${({ unpaid: 'غير مدفوعة', partial: 'مدفوعة جزئيًا', paid: 'مدفوعة بالكامل' })[after.commission_status] || after.commission_status}`, req.user, { amount, marketer: s.marketer_name });
    log(req.user, 'commission_payment', 'sale', s.id, { cp_no: no, amount, marketer: s.marketer_name });
    return { cp_no: no, commission_paid: after.commission_paid, status: after.commission_status };
  });
  const r = tx(); res.json(r);
}));
app.post('/api/commission-payments/:id/cancel', auth, perm('pay_commission'), wrap((req, res) => {
  const tx = db.transaction(() => {
    const cp = db.prepare('SELECT * FROM commission_payments WHERE id=? AND status=? ').get(req.params.id, 'active');
    if (!cp) throw Error('الدفعة غير موجودة أو ملغاة');
    if (!req.body.reason) throw Error('سبب الإلغاء مطلوب');
    db.prepare("UPDATE commission_payments SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancel_reason=? WHERE id=?").run(req.body.reason, cp.id);
    const s = db.prepare('SELECT * FROM sales WHERE id=?').get(cp.sale_id);
    recalcCommission(cp.sale_id);
    if (s) logUnitEvent(s.unit_id, 'commission_payment_cancelled', `إلغاء دفعة عمولة ${cp.amount.toLocaleString('en-US')} — السبب: ${req.body.reason}`, req.user, { cp_no: cp.cp_no });
    log(req.user, 'cancel_commission_payment', 'marketer', cp.marketer_id, { cp_no: cp.cp_no, reason: req.body.reason });
  });
  tx(); res.json({ ok: true });
}));


// ==================== تصفية مستحقات إعادة البيع (v1.9) ====================
const SETTLEMENT_PARTY_AR = { new_owner: 'المالك الجديد', previous_owner: 'المالك السابق / المساهم', company: 'الشركة', marketer: 'المسوق' };
function settlementStatus(net, paid) {
  const rem = Math.max(0, (+net || 0) - (+paid || 0));
  return { remaining: rem, status: rem <= 0.005 ? 'settled' : paid > 0 ? 'partial' : 'unpaid' };
}
function uniqueSettlementNo() {
  const y = new Date().getFullYear();
  for (let i = 0; i < 10; i++) {
    const no = `STR-${y}-${String(Date.now()).slice(-7)}${i || ''}`;
    if (!db.prepare('SELECT 1 FROM settlement_reports WHERE report_no=?').get(no)) return no;
  }
  return `STR-${y}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}
function ensureSettlementReport(saleId, userId) {
  const sale = db.prepare(`${SALE_OUT_SQL} WHERE s.id=? AND s.is_resale=1`).get(saleId);
  if (!sale) throw Error('عملية إعادة البيع غير موجودة');
  let report = db.prepare('SELECT * FROM settlement_reports WHERE resale_sale_id=?').get(sale.id);
  if (!report) {
    const no = uniqueSettlementNo();
    const snap = JSON.stringify({ sale_no: sale.sale_no, unit_number: sale.unit_number, project_name: sale.project_name, created_at: new Date().toISOString() });
    const invoiceNo = uniqueNo('IINV', 'settlement_reports', 'invoice_no');
    const r = db.prepare('INSERT INTO settlement_reports(report_no,invoice_no,resale_sale_id,snapshot,created_by) VALUES(?,?,?,?,?)').run(no, invoiceNo, sale.id, snap, userId || sale.created_by);
    report = db.prepare('SELECT * FROM settlement_reports WHERE id=?').get(r.lastInsertRowid);
  }
  if (!report.invoice_no) { db.prepare('UPDATE settlement_reports SET invoice_no=? WHERE id=?').run(uniqueNo('IINV','settlement_reports','invoice_no'),report.id); report=db.prepare('SELECT * FROM settlement_reports WHERE id=?').get(report.id); }
  syncSettlementReport(report.id);
  return db.prepare('SELECT * FROM settlement_reports WHERE id=?').get(report.id);
}
function syncSettlementReport(reportId) {
  const report = db.prepare('SELECT * FROM settlement_reports WHERE id=?').get(reportId);
  if (!report) throw Error('تقرير التصفية غير موجود');
  const s = db.prepare(`${SALE_OUT_SQL} WHERE s.id=?`).get(report.resale_sale_id);
  if (!s) throw Error('عملية البيع المرتبطة غير موجودة');
  const prev = s.prev_sale_id ? db.prepare(`${SALE_OUT_SQL} WHERE s.id=?`).get(s.prev_sale_id) : null;
  const prevRemaining = Math.max(0, +(prev?.remaining_amount || 0));
  const commission = Math.max(0, +(s.commission_total || 0));
  const base = +(s.base_price || s.list_price || s.final_price || 0);
  const discount = +(s.discount_amount || 0), adj=saleAdjustments(s.id);
  const grossAfterDebits=base+adj.debit, saleDeductions=discount+adj.credit;
  const sellerNet = Math.max(0, +s.final_price - prevRemaining - commission);
  const definitions = [
    { type: 'new_owner', id: s.customer_id, name: s.customer_name || 'المالك الجديد', direction: 'receivable', gross: grossAfterDebits, deductions: saleDeductions, net: +s.final_price, sourcePaid: +s.paid_amount, notes: 'مستحق قيمة إعادة البيع بعد الخصومات والتسويات' },
    { type: 'previous_owner', id: prev?.customer_id || null, name: s.prev_owner_name || s.seller_name || prev?.customer_name || 'المالك السابق', direction: 'payable', gross: grossAfterDebits, deductions: saleDeductions + prevRemaining + commission, net: sellerNet, sourcePaid: 0, notes: 'صافي مستحق المستثمر بعد الخصومات والتسويات ومستحق الشركة وعمولة المسوق' },
    { type: 'company', id: null, name: 'الشركة', direction: 'receivable', gross: prevRemaining, deductions: 0, net: prevRemaining, sourcePaid: prevRemaining, notes: prevRemaining > 0 ? 'مستحق العقد السابق، تمت تسويته تلقائيًا بالخصم من مستحق المالك السابق' : 'لا توجد مستحقات متبقية على العقد السابق' },
  ];
  if (s.marketer_id && commission > 0) definitions.push({ type: 'marketer', id: s.marketer_id, name: s.marketer_name || 'المسوق', direction: 'payable', gross: commission, deductions: 0, net: commission, sourcePaid: +s.commission_paid, notes: `عمولة مرتبطة بالبيع ${s.sale_no}` });
  const genericPaid = db.prepare("SELECT COALESCE(SUM(amount),0) n FROM settlement_transactions WHERE report_id=? AND entry_id=? AND status='active' AND source_type='settlement'");
  const upsert = db.prepare(`INSERT INTO settlement_entries(report_id,sale_id,party_type,party_id,party_name,direction,gross_amount,deductions,net_amount,source_paid,settled_amount,remaining_amount,status,notes)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(report_id,party_type) DO UPDATE SET party_id=excluded.party_id,party_name=excluded.party_name,direction=excluded.direction,gross_amount=excluded.gross_amount,deductions=excluded.deductions,net_amount=excluded.net_amount,source_paid=excluded.source_paid,settled_amount=excluded.settled_amount,remaining_amount=excluded.remaining_amount,status=excluded.status,notes=excluded.notes,updated_at=CURRENT_TIMESTAMP`);
  for (const d of definitions) {
    const old = db.prepare('SELECT id FROM settlement_entries WHERE report_id=? AND party_type=?').get(report.id, d.type);
    const extra = old ? +genericPaid.get(report.id, old.id).n : 0;
    const paid = Math.min(d.net, Math.max(0, d.sourcePaid + extra));
    const st = settlementStatus(d.net, paid);
    upsert.run(report.id, s.id, d.type, d.id, d.name, d.direction, d.gross, d.deductions, d.net, d.sourcePaid, paid, st.remaining, st.status, d.notes);
  }
  // لا نحذف سجل مسوق سابق؛ يصير ملغيًا/صفريًا للمحافظة على الأثر التاريخي
  if (!definitions.some(x => x.type === 'marketer')) db.prepare("UPDATE settlement_entries SET gross_amount=0,net_amount=0,source_paid=0,settled_amount=0,remaining_amount=0,status='settled',notes='لا توجد عمولة حالية',updated_at=CURRENT_TIMESTAMP WHERE report_id=? AND party_type='marketer'").run(report.id);
  const counts = db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN status='settled' THEN 1 ELSE 0 END) done FROM settlement_entries WHERE report_id=? AND net_amount>0").get(report.id);
  const status = !counts.total || counts.total === counts.done ? 'settled' : counts.done > 0 ? 'partial' : 'open';
  db.prepare('UPDATE settlement_reports SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, report.id);
}
function settlementReportDetails(idOrNo) {
  const report = typeof idOrNo === 'number' || /^\d+$/.test(String(idOrNo))
    ? db.prepare('SELECT * FROM settlement_reports WHERE id=?').get(+idOrNo)
    : db.prepare('SELECT * FROM settlement_reports WHERE report_no=?').get(String(idOrNo));
  if (!report) return null;
  syncSettlementReport(report.id);
  const row = db.prepare(`SELECT sr.*,s.sale_no,s.sale_date,s.base_price,s.discount_amount,s.final_price,s.paid_amount,s.remaining_amount,s.prev_owner_name,s.seller_name,s.prev_sale_id,s.commission_total,s.commission_paid,s.commission_status,
    u.unit_number,p.name project_name,c.name new_owner_name,mk.name marketer_name
    FROM settlement_reports sr JOIN sales s ON s.id=sr.resale_sale_id JOIN units u ON u.id=s.unit_id JOIN projects p ON p.id=u.project_id JOIN customers c ON c.id=s.customer_id LEFT JOIN marketers mk ON mk.id=s.marketer_id WHERE sr.id=?`).get(report.id);
  row.entries = db.prepare('SELECT * FROM settlement_entries WHERE report_id=? ORDER BY CASE party_type WHEN \'new_owner\' THEN 1 WHEN \'previous_owner\' THEN 2 WHEN \'company\' THEN 3 ELSE 4 END').all(report.id);
  row.transactions = db.prepare(`SELECT st.*,se.party_type,se.party_name,us.name created_by_name FROM settlement_transactions st JOIN settlement_entries se ON se.id=st.entry_id LEFT JOIN users us ON us.id=st.created_by WHERE st.report_id=? ORDER BY st.transaction_date DESC,st.id DESC`).all(report.id);
  row.activity = [
    ...db.prepare(`SELECT py.created_at date,py.payment_no number,'دفعة المالك الجديد' operation,c.name party,py.amount,'payment' source,py.status FROM payments py JOIN sales s ON s.id=py.sale_id JOIN customers c ON c.id=s.customer_id WHERE py.sale_id=?`).all(row.resale_sale_id),
    ...db.prepare(`SELECT cp.created_at date,cp.cp_no number,'تصفية عمولة مسوق' operation,mk.name party,cp.amount,'commission' source,cp.status FROM commission_payments cp JOIN marketers mk ON mk.id=cp.marketer_id WHERE cp.sale_id=?`).all(row.resale_sale_id),
    ...db.prepare(`SELECT st.created_at date,st.transaction_no number,'تسجيل تصفية' operation,se.party_name party,st.amount,'settlement' source,st.status FROM settlement_transactions st JOIN settlement_entries se ON se.id=st.entry_id WHERE st.report_id=? AND st.source_type='settlement'`).all(report.id),
  ].sort((a,b) => String(b.date).localeCompare(String(a.date)));
  row.activity.forEach(a => {
    const partyType = a.source === 'payment' ? 'new_owner' : a.source === 'commission' ? 'marketer' : null;
    const e = partyType ? row.entries.find(x => x.party_type === partyType) : row.entries.find(x => x.party_name === a.party);
    a.paid = e?.settled_amount || 0;
    a.remaining = e?.remaining_amount || 0;
    a.settlement_status = e?.status || (a.status === 'active' ? 'open' : 'cancelled');
  });
  row.totals = row.entries.reduce((a,e) => { a.net += e.net_amount; a.paid += e.settled_amount; a.remaining += e.remaining_amount; return a; }, { net:0, paid:0, remaining:0 });
  return row;
}
function ensureAllSettlementReports(userId) {
  db.prepare("SELECT id FROM sales WHERE is_resale=1 AND status!='cancelled'").all().forEach(s => ensureSettlementReport(s.id, userId));
}
app.get('/api/settlements', auth, perm('view_settlements'), wrap((req,res) => {
  ensureAllSettlementReports(req.user.id);
  const q=req.query, where=['1=1'], p=[];
  if(q.status){where.push('sr.status=?');p.push(q.status);}
  if(q.party_type){where.push('EXISTS(SELECT 1 FROM settlement_entries se WHERE se.report_id=sr.id AND se.party_type=?)');p.push(q.party_type);}
  if(q.search){where.push('(sr.report_no LIKE ? OR s.sale_no LIKE ? OR u.unit_number LIKE ? OR c.name LIKE ? OR COALESCE(s.prev_owner_name,\'\') LIKE ?)');for(let i=0;i<5;i++)p.push(`%${q.search}%`);}
  const rows=db.prepare(`SELECT sr.*,s.sale_no,s.sale_date,s.final_price,s.paid_amount,s.remaining_amount,s.discount_amount,s.prev_owner_name,s.commission_total,s.commission_paid,u.unit_number,pr.name project_name,c.name new_owner_name,
    (SELECT COALESCE(SUM(net_amount),0) FROM settlement_entries WHERE report_id=sr.id) total_due,
    (SELECT COALESCE(SUM(settled_amount),0) FROM settlement_entries WHERE report_id=sr.id) total_paid,
    (SELECT COALESCE(SUM(remaining_amount),0) FROM settlement_entries WHERE report_id=sr.id) total_remaining
    FROM settlement_reports sr JOIN sales s ON s.id=sr.resale_sale_id JOIN units u ON u.id=s.unit_id JOIN projects pr ON pr.id=u.project_id JOIN customers c ON c.id=s.customer_id WHERE ${where.join(' AND ')} ORDER BY sr.id DESC LIMIT 500`).all(...p);
  res.json(rows);
}));
app.get('/api/investor-settlements', auth, perm('view_settlements'), wrap((req,res)=>{
  ensureAllSettlementReports(req.user.id);
  const rows=db.prepare(`SELECT sr.id,sr.report_no,sr.invoice_no,sr.status,s.sale_no,s.invoice_no sale_invoice_no,s.sale_date,s.prev_owner_name,s.beneficiary_name,s.base_price,s.discount_amount,s.final_price,s.paid_amount,s.remaining_amount,u.unit_number,pr.name project_name,c.name new_owner_name,
    se.id entry_id,se.gross_amount,se.deductions,se.net_amount,se.settled_amount,se.remaining_amount investor_remaining,se.status investor_status
    FROM settlement_reports sr JOIN sales s ON s.id=sr.resale_sale_id JOIN settlement_entries se ON se.report_id=sr.id AND se.party_type='previous_owner' JOIN units u ON u.id=s.unit_id JOIN projects pr ON pr.id=u.project_id JOIN customers c ON c.id=s.customer_id
    WHERE s.beneficiary_type='investor' ORDER BY CASE WHEN se.remaining_amount>0 THEN 0 ELSE 1 END,sr.id DESC`).all();
  res.json(rows);
}));
app.get('/api/settlements/search/:reportNo', auth, perm('view_settlements'), wrap((req,res) => {
  const d=settlementReportDetails(req.params.reportNo); if(!d)return res.status(404).json({error:'رقم تقرير التصفية غير موجود'}); res.json(d);
}));
app.get('/api/settlements/:id', auth, perm('view_settlements'), wrap((req,res) => {
  const d=settlementReportDetails(+req.params.id); if(!d)return res.status(404).json({error:'تقرير التصفية غير موجود'}); res.json(d);
}));
app.post('/api/settlements/:id/refresh', auth, perm('view_settlements'), wrap((req,res) => { syncSettlementReport(+req.params.id); res.json(settlementReportDetails(+req.params.id)); }));
app.post('/api/settlements/:id/transactions', auth, perm('manage_settlements'), idemGuard, wrap((req,res) => {
  const report=settlementReportDetails(+req.params.id); if(!report)throw Error('التقرير غير موجود');
  const entry=report.entries.find(e=>e.id===+req.body.entry_id); if(!entry)throw Error('بند التصفية غير موجود');
  const amount=+req.body.amount; if(!(amount>0))throw Error('مبلغ التصفية مطلوب');
  if(amount>entry.remaining_amount+0.005)throw Error(`المبلغ يتجاوز المتبقي (${entry.remaining_amount.toLocaleString('en-US')})`);
  const method=['cash','bank_transfer','check'].includes(req.body.method)?req.body.method:'cash';
  if((method==='check'||method==='bank_transfer')&&!req.body.ref_no)throw Error('رقم المرجع مطلوب');
  const result=db.transaction(()=>{
    let sourceType='settlement',sourceId=null;
    if(entry.party_type==='new_owner'){
      const pno='PAY-'+new Date().getFullYear()+'-'+String(Date.now()).slice(-7);
      const r=db.prepare('INSERT INTO payments(payment_no,sale_id,amount,pay_date,method,ref_no,notes,created_by,received_by,deposit_account,payment_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(pno,report.resale_sale_id,amount,req.body.transaction_date||nowDate(),method,req.body.ref_no||'',req.body.notes||`تصفية ${report.report_no}`,req.user.id,
        req.body.received_by||'',req.body.deposit_account||'',req.body.payment_status||'received');
      sourceType='payment';sourceId=r.lastInsertRowid;recalcSale(report.resale_sale_id);
    }else if(entry.party_type==='marketer'){
      const s=db.prepare('SELECT marketer_id FROM sales WHERE id=?').get(report.resale_sale_id);
      const no='CMP-'+new Date().getFullYear()+'-'+String(Date.now()).slice(-7);
      const r=db.prepare('INSERT INTO commission_payments(cp_no,marketer_id,sale_id,amount,pay_date,method,ref_no,notes,created_by,received_by,deposit_account,payment_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(no,s.marketer_id,report.resale_sale_id,amount,req.body.transaction_date||nowDate(),method,req.body.ref_no||'',req.body.notes||`تصفية ${report.report_no}`,req.user.id,
        req.body.received_by||'',req.body.deposit_account||'',req.body.payment_status||'received');
      sourceType='commission';sourceId=r.lastInsertRowid;recalcCommission(report.resale_sale_id);
    }
    const no='STX-'+new Date().getFullYear()+'-'+String(Date.now()).slice(-7);
    const r=db.prepare('INSERT INTO settlement_transactions(transaction_no,report_id,entry_id,sale_id,amount,transaction_date,method,ref_no,notes,source_type,source_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(no,report.id,entry.id,report.resale_sale_id,amount,req.body.transaction_date||nowDate(),method,req.body.ref_no||'',req.body.notes||'',sourceType,sourceId,req.user.id);
    log(req.user,'settlement_payment','settlement_report',report.id,{report_no:report.report_no,transaction_no:no,party:entry.party_name,amount});
    return {id:r.lastInsertRowid,transaction_no:no};
  })();
  syncSettlementReport(report.id);res.json({...result,report:settlementReportDetails(report.id)});
}));
app.post('/api/settlement-transactions/:id/cancel', auth, perm('manage_settlements'), wrap((req,res)=>{
  const tx=db.prepare("SELECT * FROM settlement_transactions WHERE id=? AND status='active'").get(req.params.id);if(!tx)throw Error('التصفية غير موجودة أو ملغاة');if(!req.body.reason)throw Error('سبب الإلغاء مطلوب');
  db.transaction(()=>{db.prepare("UPDATE settlement_transactions SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancel_reason=? WHERE id=?").run(req.body.reason,tx.id);if(tx.source_type==='payment'&&tx.source_id){db.prepare("UPDATE payments SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancel_reason=?,cancelled_by=? WHERE id=?").run(req.body.reason,req.user.id,tx.source_id);recalcSale(tx.sale_id);}if(tx.source_type==='commission'&&tx.source_id){db.prepare("UPDATE commission_payments SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancel_reason=? WHERE id=?").run(req.body.reason,tx.source_id);recalcCommission(tx.sale_id);}log(req.user,'cancel_settlement','settlement_report',tx.report_id,{transaction_no:tx.transaction_no,reason:req.body.reason});})();
  syncSettlementReport(tx.report_id);res.json({ok:true});
}));

// ==================== تجميع بيانات التقارير ====================
function salesReportData(q = {}) {
  const where = ["s.status!='cancelled'"], p = [];
  if (q.project_id) { where.push('u.project_id=?'); p.push(+q.project_id); }
  if (q.marketer_id) { where.push('s.marketer_id=?'); p.push(+q.marketer_id); }
  if (q.date_from) { where.push('s.sale_date>=?'); p.push(q.date_from); }
  if (q.date_to) { where.push('s.sale_date<=?'); p.push(q.date_to); }
  if (q.search) { where.push('(s.sale_no LIKE ? OR u.unit_number LIKE ? OR c.name LIKE ?)'); p.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`); }
  const rows = db.prepare(`${SALE_OUT_SQL} WHERE ${where.join(' AND ')} ORDER BY s.sale_date DESC, s.id DESC LIMIT 1000`).all(...p);
  const t = { base: 0, discount: 0, final: 0, paid: 0, remaining: 0 };
  rows.forEach(s => { t.base += s.base_price || s.list_price || 0; t.discount += s.discount_amount || 0; t.final += s.final_price; t.paid += s.paid_amount; t.remaining += s.remaining_amount; });
  return { rows, totals: t };
}
function paymentsReportData(q = {}) {
  const where = ["py.status='active'"], p = [];
  if (q.date_from) { where.push('py.pay_date>=?'); p.push(q.date_from); }
  if (q.date_to) { where.push('py.pay_date<=?'); p.push(q.date_to); }
  if (q.method) { where.push('py.method=?'); p.push(q.method); }
  if (q.search) { where.push('(py.payment_no LIKE ? OR s.sale_no LIKE ? OR u.unit_number LIKE ? OR c.name LIKE ?)'); p.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`, `%${q.search}%`); }
  const rows = db.prepare(`${PAYMENT_OUT_SQL} WHERE ${where.join(' AND ')} ORDER BY py.pay_date DESC, py.id DESC LIMIT 1000`).all(...p);
  return { rows, totals: { amount: rows.reduce((a, x) => a + x.amount, 0) } };
}
function commissionsReportData(q = {}) {
  const where = ["s.marketer_id IS NOT NULL", "s.status!='cancelled'"], p = [];
  if (q.marketer_id) { where.push('s.marketer_id=?'); p.push(+q.marketer_id); }
  if (q.status) { where.push('s.commission_status=?'); p.push(q.status); }
  const rows = db.prepare(`${SALE_OUT_SQL} WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT 1000`).all(...p);
  const marketers = db.prepare(`${MARKETER_STATS} WHERE mk.active=1 ORDER BY commission_total DESC`).all().map(m => ({ ...m, commission_due: Math.max(0, m.commission_total - m.commission_paid) }));
  const t = { total: 0, paid: 0, remaining: 0 };
  rows.forEach(s => { t.total += s.commission_total; t.paid += s.commission_paid; t.remaining += Math.max(0, s.commission_total - s.commission_paid); });
  return { rows, totals: t, marketers };
}
// ===== تقرير المسوقين التفصيلي (الإجمالي + عمليات كل مسوق) =====
function marketersReportData(q = {}) {
  const where = ["s.marketer_id IS NOT NULL", "s.status!='cancelled'"], p = [];
  if (q.marketer_id) { where.push('s.marketer_id=?'); p.push(+q.marketer_id); }
  if (q.project_id) { where.push('u.project_id=?'); p.push(+q.project_id); }
  if (q.unit) { where.push('u.unit_number LIKE ?'); p.push(`%${q.unit}%`); }
  if (q.date_from) { where.push('s.sale_date>=?'); p.push(q.date_from); }
  if (q.date_to) { where.push('s.sale_date<=?'); p.push(q.date_to); }
  if (q.sale_status) { where.push('s.status=?'); p.push(q.sale_status); }
  if (q.commission_status) { where.push('s.commission_status=?'); p.push(q.commission_status); }
  if (q.search) { where.push('(mk.name LIKE ? OR s.sale_no LIKE ? OR c.name LIKE ? OR u.unit_number LIKE ?)'); p.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`, `%${q.search}%`); }
  const rows = db.prepare(`SELECT s.id sale_id,s.sale_no,s.sale_date,s.status sale_status,s.is_resale,s.base_price,s.discount_type,s.discount_value,s.discount_amount,s.final_price,s.paid_amount,s.remaining_amount,s.payment_method,s.payment_ref,s.commission_type,s.commission_value,s.commission_total,s.commission_paid,s.commission_status,
    u.unit_number,p.name project_name,c.name customer_name,c.phone customer_phone,mk.id marketer_id,mk.name marketer_name,mk.phone marketer_phone,mk.code marketer_code,
    (SELECT r.start_at FROM reservations r WHERE r.unit_id=s.unit_id AND r.status='converted' ORDER BY r.id DESC LIMIT 1) reserve_date
    FROM sales s JOIN units u ON u.id=s.unit_id JOIN projects p ON p.id=u.project_id JOIN customers c ON c.id=s.customer_id JOIN marketers mk ON mk.id=s.marketer_id
    WHERE ${where.join(' AND ')} ORDER BY s.sale_date DESC, s.id DESC LIMIT 2000`).all(...p);
  const summaryMap = new Map();
  rows.forEach(r => {
    const m = summaryMap.get(r.marketer_id) || { marketer_id: r.marketer_id, marketer_name: r.marketer_name, marketer_code: r.marketer_code, phone: r.marketer_phone || '', ops: 0, units: 0, sales_total: 0, commission_total: 0, commission_paid: 0, commission_due: 0, statuses: new Set() };
    m.ops++; m.units++; m.sales_total += r.final_price;
    m.commission_total += r.sale_status !== 'cancelled' ? (r.commission_total || 0) : 0;
    m.commission_paid += r.sale_status !== 'cancelled' ? (r.commission_paid || 0) : 0;
    if (r.sale_status !== 'cancelled') m.statuses.add(r.commission_status);
    summaryMap.set(r.marketer_id, m);
  });
  const summary = [...summaryMap.values()].map(m => {
    const st = m.statuses.has('unpaid') ? 'unpaid' : m.statuses.has('partial') ? 'partial' : m.statuses.has('paid') ? 'paid' : m.statuses.has('cancelled') ? 'cancelled' : 'none';
    return { ...m, commission_due: Math.max(0, m.commission_total - m.commission_paid), commission_status: st, statuses: undefined };
  });
  const totals = rows.reduce((a, r) => ({ ops: a.ops + 1, sales_total: a.sales_total + r.final_price, commission_total: a.commission_total + (r.sale_status !== 'cancelled' ? (r.commission_total || 0) : 0), commission_paid: a.commission_paid + (r.sale_status !== 'cancelled' ? (r.commission_paid || 0) : 0) }), { ops: 0, sales_total: 0, commission_total: 0, commission_paid: 0 });
  totals.commission_due = Math.max(0, totals.commission_total - totals.commission_paid);
  const period = q.date_from || q.date_to ? `${q.date_from || 'البداية'} ← ${q.date_to || 'اليوم'}` : 'كل الفترات';
  return { rows, summary, totals, period, marketer_name: q.marketer_id ? (summary[0]?.marketer_name || '') : null, marketer_phone: q.marketer_id ? (summary[0]?.phone || '') : null };
}
function financialReportData(q = {}) {
  const pf = profitDashboardData(q);
  const summary = {
    final_total: pf.totals.sales, paid_total: pf.totals.collected, remaining_total: pf.totals.receivables,
    property_cost: pf.totals.property_cost, expenses_total: pf.totals.expenses,
    discount_total: pf.rows.reduce((a,s)=>a+(s.discount_amount||0),0),
    commission_due: pf.totals.commissions,
    commission_paid: pf.rows.reduce((a,s)=>a+(s.commission_paid||0),0),
    total_costs: pf.totals.total_costs, net_profit: pf.totals.net_profit,
    marketers_count: db.prepare('SELECT COUNT(*) n FROM marketers WHERE active=1').get().n,
    sold_units: db.prepare("SELECT COUNT(*) n FROM units WHERE status IN ('sold','paid')").get().n,
    available_units: db.prepare("SELECT COUNT(*) n FROM units WHERE status IN ('available','resale')").get().n,
  };
  const months={}; const M=()=>({month:'',sales_count:0,final_total:0,discount_total:0,paid_total:0,property_cost:0,expenses_total:0,commission_total:0,total_costs:0,net_profit:0,marketer_paid:0});
  pf.rows.forEach(s=>{const ym=String(s.sale_date).slice(0,7),m=months[ym]||=( {...M(),month:ym} );m.sales_count++;m.final_total+=s.final;m.discount_total+=s.discounts;m.property_cost+=s.property_cost;m.expenses_total+=s.expenses;m.commission_total+=s.commission;m.total_costs+=s.total_costs;});
  const payWhere=["py.status='active'"],pp=[];if(q.date_from){payWhere.push('py.pay_date>=?');pp.push(q.date_from);}if(q.date_to){payWhere.push('py.pay_date<=?');pp.push(q.date_to);}
  db.prepare(`SELECT amount,pay_date FROM payments py WHERE ${payWhere.join(' AND ')}`).all(...pp).forEach(x=>{const ym=String(x.pay_date).slice(0,7),m=months[ym]||=( {...M(),month:ym} );m.paid_total+=x.amount;});
  db.prepare("SELECT amount,pay_date FROM commission_payments WHERE status='active'").all().forEach(x=>{const ym=String(x.pay_date).slice(0,7),m=months[ym]||=( {...M(),month:ym} );m.marketer_paid+=x.amount;});
  Object.values(months).forEach(m=>m.net_profit=m.paid_total-m.total_costs);
  return {summary,months:Object.values(months).sort((a,b)=>b.month.localeCompare(a.month)),formula:pf.formula};
}
app.get('/api/reports/sales', auth, perm('view_sales_reports', 'create_reports'), wrap((req, res) => res.json(salesReportData(req.query))));
app.get('/api/reports/payments', auth, perm('view_payments', 'create_reports'), wrap((req, res) => res.json(paymentsReportData(req.query))));
app.get('/api/reports/commissions', auth, perm('view_commissions', 'create_reports'), wrap((req, res) => res.json(commissionsReportData(req.query))));
app.get('/api/reports/financial', auth, perm('view_financial_reports', 'create_reports'), wrap((req, res) => res.json(financialReportData(req.query))));
app.get('/api/reports/marketers', auth, perm('view_marketer_reports', 'create_reports'), wrap((req, res) => res.json(marketersReportData(req.query))));

// ==================== تقرير المشاريع Excel — v1.9 ====================
// الفلاتر تُطبَّق على SQL قبل إنشاء الملف (وليس بعد بناء ملف شامل)
function projectsReportData(q = {}) {
  const where = ['p.active=1'], p = [];
  if (q.project_id) { where.push('u.project_id=?'); p.push(+q.project_id); }
  if (q.unit_number) { where.push('u.unit_number LIKE ?'); p.push(`%${q.unit_number}%`); }
  if (q.floor_id) { where.push('u.floor_id=?'); p.push(+q.floor_id); }
  if (q.model_id) { where.push('u.model_id=?'); p.push(+q.model_id); }
  if (q.rooms) { where.push('COALESCE(u.rooms,m.rooms)=?'); p.push(+q.rooms); }
  if (q.unit_status) { where.push('u.status=?'); p.push(q.unit_status); }
  if (q.buyer) { where.push('c.name LIKE ?'); p.push(`%${q.buyer}%`); }
  if (q.investor) { where.push('(COALESCE(s.investor_name,\'\') LIKE ? OR COALESCE(s.prev_owner_name,\'\') LIKE ? OR COALESCE(s.seller_name,\'\') LIKE ?)'); p.push(`%${q.investor}%`, `%${q.investor}%`, `%${q.investor}%`); }
  if (q.marketer_id) { where.push('s.marketer_id=?'); p.push(+q.marketer_id); }
  if (q.payment_method) { where.push('s.payment_method=?'); p.push(q.payment_method); }
  if (q.sale_status) { where.push('s.status=?'); p.push(q.sale_status); }
  if (q.settlement_status) { where.push('COALESCE(sr.status,\'none\')=?'); p.push(q.settlement_status); }
  if (q.date_from) { where.push('s.sale_date>=?'); p.push(q.date_from); }
  if (q.date_to) { where.push('s.sale_date<=?'); p.push(q.date_to); }
  const base = ` FROM units u JOIN projects p ON p.id=u.project_id JOIN floors f ON f.id=u.floor_id
    LEFT JOIN models m ON m.id=u.model_id
    LEFT JOIN sales s ON s.id=(SELECT s2.id FROM sales s2 WHERE s2.unit_id=u.id AND s2.status!='cancelled' ORDER BY s2.id DESC LIMIT 1)
    LEFT JOIN customers c ON c.id=s.customer_id
    LEFT JOIN marketers mk ON mk.id=s.marketer_id
    LEFT JOIN settlement_reports sr ON sr.resale_sale_id=s.id
    WHERE ${where.join(' AND ')}`;
  const rows = db.prepare(`SELECT
    u.id unit_id,u.unit_number,u.status unit_status,u.sell_phase,u.updated_at unit_updated,u.owner_name,
    p.name project_name,p.code project_code,p.id project_id,f.name floor_name,m.code model_code,
    COALESCE(u.rooms,m.rooms) display_rooms,COALESCE(u.area,m.area) display_area,
    s.id sale_id,s.sale_no,s.sale_date,s.base_price,s.discount_amount,s.final_price,s.paid_amount,s.remaining_amount,
    s.status sale_status,s.is_resale,s.payment_method,s.payment_ref,s.marketer_id,s.commission_type,s.commission_value,
    s.commission_total,s.commission_paid,s.commission_status,s.property_cost,s.purchase_cost,s.purchase_price,s.purchase_date,
    s.prev_owner_name,s.prev_sale_id,s.investor_name,s.beneficiary_type,s.beneficiary_name,s.seller_name,s.notes,
    c.name customer_name,mk.name marketer_name,mk.code marketer_code,
    sr.status settlement_status,sr.report_no settlement_report_no,sr.invoice_no settlement_invoice_no
    ${base} ORDER BY p.name,u.floor_id,u.unit_number LIMIT 5000`).all(...p);
  const out = rows.map(r => {
    const fin = r.sale_id ? saleFinance({ ...r, id: r.sale_id }) : null;
    // دفعة الحجز: المربوطة بالصفقة، أو دفعة حجز نشطة على الوحدة
    let dep = null;
    if (r.sale_id) {
      const d = saleDepositInfo(r.sale_id);
      if (d.count) dep = { ...d.payments[0], total: d.total, count: d.count };
    } else if (r.unit_status === 'reserved') {
      const rp = db.prepare(`SELECT rp.*,r.reservation_no FROM reservation_payments rp JOIN reservations r ON r.id=rp.reservation_id WHERE rp.unit_id=? AND rp.status='active' AND rp.sale_id IS NULL ORDER BY rp.id DESC LIMIT 1`).get(r.unit_id);
      if (rp) dep = { payment_no: rp.payment_no, amount: rp.amount, pay_date: rp.pay_date, method: rp.method, ref_no: rp.ref_no, count: 1, total: rp.amount };
    }
    const isRes = !!r.is_resale;
    return {
      ...r,
      unit_status: STATUS_AR[r.unit_status] || r.unit_status,
      sale_status: STATUS_AR[r.sale_status] || r.sale_status,
      settlement_info: r.settlement_status ? `${r.settlement_invoice_no || r.settlement_report_no || ''} ${r.settlement_report_no || ''} — ${STATUS_AR[r.settlement_status] || r.settlement_status}`.trim() : '—',
      deposit_amount: dep?.total || null, deposit_payment_no: dep?.payment_no || '—', deposit_date: dep?.pay_date || '—',
      deposit_method: dep ? (METHOD_AR[dep.method] || dep.method) : '—', deposit_ref_no: dep?.ref_no || '—',
      base_price: fin ? fin.base : null, discount_amount: fin ? fin.discounts : null,
      final_price: fin ? fin.final : null, paid_amount: fin ? fin.paid : null,
      remaining_amount: fin ? fin.remaining : null,
      property_cost: fin ? fin.property_cost : null, expenses: fin ? fin.expenses : null,
      commission_total: fin ? fin.commission : null,
      commission_paid: fin ? (r.commission_paid || 0) : null, commission_remaining: fin ? Math.max(0, fin.commission - (r.commission_paid || 0)) : null,
      gross_profit: fin ? fin.gross_profit : null, net_profit: fin ? fin.net_profit : null,
      // نسبة المستثمر المشتقة: حصة المالك السابق من قيمة إعادة البيع (إن وُجد مستثمر)
      investor_share_pct: (fin && isRes && r.investor_name && fin.final > 0 && fin.prev_owner_finance)
        ? Math.round((Math.max(0, fin.prev_owner_finance.remaining) / fin.final) * 10000) / 100 : null,
      investor_due: fin && isRes ? (fin.prev_owner_finance?.remaining ?? null) : null,
      adjustments_net: fin ? fin.adjustments.net : null,
      collected: fin ? fin.realized_revenue : null, receivable: fin ? Math.max(0, fin.remaining) : null,
      resale_price: fin && isRes ? fin.final : null,
      prev_remaining: fin && isRes ? (fin.prev_owner_finance ? Math.max(0, fin.prev_owner_finance.remaining) : null) : null,
      resale_discount: fin && isRes ? fin.discounts : null,
      resale_gross_profit: fin && isRes ? fin.gross_profit : null,
      resale_net_profit: fin && isRes ? fin.net_profit : null,
      unit_updated: String(r.unit_updated || '').slice(0, 10),
      investor_due_label: null,
    };
  });
  const t0 = { units: 0, base: 0, discount: 0, final: 0, deposit: 0, paid: 0, remaining: 0, property_cost: 0, expenses: 0, commission_total: 0, commission_paid: 0, commission_remaining: 0, gross_profit: 0, net_profit: 0, investor_due: 0, adjustments_net: 0, collected: 0, receivable: 0, purchase_price: 0, resale_price: 0, prev_remaining: 0, resale_discount: 0, resale_gross_profit: 0, resale_net_profit: 0 };
  const totals = out.reduce((a, r) => {
    a.units++;
    a.base += r.base_price || 0; a.discount += r.discount_amount || 0; a.final += r.final_price || 0;
    a.deposit += r.deposit_amount || 0; a.paid += r.paid_amount || 0; a.remaining += Math.max(0, r.remaining_amount || 0);
    a.property_cost += r.property_cost || 0; a.expenses += r.expenses || 0;
    a.commission_total += r.commission_total || 0; a.commission_paid += r.commission_paid || 0; a.commission_remaining += r.commission_remaining || 0;
    a.gross_profit += r.gross_profit || 0; a.net_profit += r.net_profit || 0;
    a.investor_due += r.investor_due || 0; a.adjustments_net += r.adjustments_net || 0;
    a.collected += r.collected || 0; a.receivable += r.receivable || 0;
    a.purchase_price += r.purchase_price || 0; a.resale_price += r.resale_price || 0; a.prev_remaining += r.prev_remaining || 0;
    a.resale_discount += r.resale_discount || 0; a.resale_gross_profit += r.resale_gross_profit || 0; a.resale_net_profit += r.resale_net_profit || 0;
    return a;
  }, t0);
  return { rows: out, totals, filters: q };
}
app.get('/api/reports/projects', auth, perm('view_projects', 'export_excel'), wrap((req, res) => res.json(projectsReportData(req.query))));

// ==================== v1.10: تقرير الحجوزات الملغاة ====================
// فلاتر: سبب الإلغاء / الفترة / المشروع / الوحدة / العميل / رقم الحجز / طريقة الاسترداد / الحساب / المستخدم
function cancelledReservationsReportData(q = {}) {
  const w = ["r.status='cancelled'"], p = [];
  if (q.source_type) { w.push('r.source_type=?'); p.push(q.source_type); }
  if (q.reason_code) { w.push('rc.cancel_reason_code=?'); p.push(q.reason_code); }
  if (q.date_from) { w.push('date(rc.cancelled_at)>=?'); p.push(q.date_from); }
  if (q.date_to) { w.push('date(rc.cancelled_at)<=?'); p.push(q.date_to); }
  if (q.project_id) { w.push('u.project_id=?'); p.push(+q.project_id); }
  if (q.unit_number) { w.push('u.unit_number LIKE ?'); p.push(`%${q.unit_number}%`); }
  if (q.customer) { w.push('c.name LIKE ?'); p.push(`%${q.customer}%`); }
  if (q.reservation_no) { w.push('r.reservation_no LIKE ?'); p.push(`%${q.reservation_no}%`); }
  if (q.refund_method) { w.push('rc.refund_method=?'); p.push(q.refund_method); }
  if (q.refund_account) { w.push('rc.refund_account LIKE ?'); p.push(`%${q.refund_account}%`); }
  if (q.cancelled_by) { w.push('rc.cancelled_by=?'); p.push(+q.cancelled_by); }
  if (q.has_refund === '1') { w.push('rc.refund_amount>0'); }
  if (q.has_deduction === '1') { w.push('rc.deducted_amount>0'); }
  const rows = db.prepare(`SELECT r.id reservation_id,r.reservation_no,r.created_at reservation_date,r.unit_price,r.deposit,r.source_type,r.resale_sale_id,rs.sale_no resale_sale_no,
    rc.id cancellation_id,rc.reason cancel_reason,rc.cancel_reason_code,rc.cancelled_at,rc.total_paid,rc.amount_returned,
    rc.refund_amount,rc.deducted_amount,rc.deduction_reason,rc.refund_method,rc.refund_ref_no,rc.refund_date,rc.refund_account,rc.notes,rc.refund_no,
    c.name customer_name,c.phone customer_phone,u.unit_number,p.name project_name,mk.name marketer_name,u2.name cancelled_by_name,us.name created_by_name,
    (SELECT COUNT(*) FROM reservation_payments rp WHERE rp.reservation_id=r.id) payments_count,
    (SELECT COALESCE(SUM(rp.amount),0) FROM reservation_payments rp WHERE rp.reservation_id=r.id AND rp.status NOT IN ('cancelled') AND rp.payment_status NOT IN ('refunded','cancelled')) paid_remaining
    FROM reservations r JOIN reservation_cancellations rc ON rc.reservation_id=r.id
    JOIN customers c ON c.id=r.customer_id JOIN units u ON u.id=r.unit_id JOIN projects p ON p.id=u.project_id
    LEFT JOIN marketers mk ON mk.id=r.marketer_id LEFT JOIN users u2 ON u2.id=rc.cancelled_by LEFT JOIN users us ON us.id=r.user_id LEFT JOIN sales rs ON rs.id=r.resale_sale_id
    WHERE ${w.join(' AND ')} ORDER BY rc.cancelled_at DESC,r.id DESC LIMIT 2000`).all(...p);
  const totals = rows.reduce((a, x) => {
    a.count++; a.deposit += x.deposit || 0; a.total_paid += x.total_paid || 0;
    a.refunded += x.refund_amount || 0; a.deducted += x.deducted_amount || 0; return a;
  }, { count: 0, deposit: 0, total_paid: 0, refunded: 0, deducted: 0 });
  return { rows, totals, filters: q };
}
app.get('/api/reports/cancelled-reservations', auth, perm('view_reservations'), wrap((req, res) => res.json(cancelledReservationsReportData(req.query))));

// ==================== v1.10: تقرير الاستردادات والخصومات ====================
// المبلغ الأصلي → المخصوم → السبب → المرتجع → الطريقة → الحساب → المرجع → التاريخ
function refundsReportData(q = {}) {
  const w = ['(rc.refund_amount>0 OR rc.deducted_amount>0)'], p = [];
  if (q.source_type) { w.push('r.source_type=?'); p.push(q.source_type); }
  if (q.reason_code) { w.push('rc.cancel_reason_code=?'); p.push(q.reason_code); }
  if (q.date_from) { w.push('date(COALESCE(rc.refund_date,rc.cancelled_at))>=?'); p.push(q.date_from); }
  if (q.date_to) { w.push('date(COALESCE(rc.refund_date,rc.cancelled_at))<=?'); p.push(q.date_to); }
  if (q.project_id) { w.push('u.project_id=?'); p.push(+q.project_id); }
  if (q.unit_number) { w.push('u.unit_number LIKE ?'); p.push(`%${q.unit_number}%`); }
  if (q.customer) { w.push('c.name LIKE ?'); p.push(`%${q.customer}%`); }
  if (q.reservation_no) { w.push('r.reservation_no LIKE ?'); p.push(`%${q.reservation_no}%`); }
  if (q.refund_method) { w.push('rc.refund_method=?'); p.push(q.refund_method); }
  if (q.refund_account) { w.push('rc.refund_account LIKE ?'); p.push(`%${q.refund_account}%`); }
  if (q.refund_ref) { w.push('rc.refund_ref_no LIKE ?'); p.push(`%${q.refund_ref}%`); }
  const rows = db.prepare(`SELECT rc.refund_no,rc.refund_amount,rc.deducted_amount,rc.deduction_reason,rc.refund_method,rc.refund_ref_no,rc.refund_date,rc.refund_account,rc.total_paid,rc.cancel_reason_code,rc.reason cancel_reason,rc.cancelled_at,
    r.reservation_no,r.unit_price,r.deposit,r.source_type,rs.sale_no resale_sale_no,c.name customer_name,c.phone customer_phone,u.unit_number,p.name project_name,u2.name cancelled_by_name
    FROM reservation_cancellations rc JOIN reservations r ON r.id=rc.reservation_id
    JOIN customers c ON c.id=r.customer_id JOIN units u ON u.id=r.unit_id JOIN projects p ON p.id=u.project_id
    LEFT JOIN users u2 ON u2.id=rc.cancelled_by LEFT JOIN sales rs ON rs.id=r.resale_sale_id
    WHERE ${w.join(' AND ')} ORDER BY COALESCE(rc.refund_date,rc.cancelled_at) DESC,rc.id DESC LIMIT 2000`).all(...p);
  const totals = rows.reduce((a, x) => {
    a.count++; a.total_paid += x.total_paid || 0; a.deducted += x.deducted_amount || 0; a.refunded += x.refund_amount || 0; return a;
  }, { count: 0, total_paid: 0, deducted: 0, refunded: 0 });
  return { rows, totals, filters: q };
}
app.get('/api/reports/refunds', auth, perm('view_reservations'), wrap((req, res) => res.json(refundsReportData(req.query))));
app.get('/api/reports/projects/export.xlsx', auth, perm('view_projects', 'export_excel'), wrap(async (req, res) => {
  // البيانات المالية حساسة: يتطلب صلاحية عرض الأسعار والمالية
  if (!hasPerm(req.user, 'view_prices') || !canFinance(req.user))
    return res.status(403).json({ error: 'تصدير تقرير المشاريع المالي يتطلب صلاحية عرض الأسعار والتقارير المالية' });
  const q = req.query;
  const d = projectsReportData(q);
  const settings = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x => [x.key, x.value]));
  const projectName = q.project_id ? (db.prepare('SELECT name FROM projects WHERE id=?').get(+q.project_id)?.name || '') : '';
  const unitNumber = q.unit_number || '';
  let logoPath = settings.logo_url ? path.join(uploadDir, path.basename(String(settings.logo_url).replace(/^\//, ''))) : null;
  if (logoPath && !fs.existsSync(logoPath)) logoPath = null;
  const meta = {
    report_no: 'PRJ-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-7),
    created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    data_updated_at: db.prepare("SELECT MAX(updated_at) t FROM units").get().t || new Date().toISOString().slice(0, 10),
    created_by: req.user.name,
    project_name: projectName || 'جميع المشاريع',
    project_code: projectName ? (db.prepare('SELECT code FROM projects WHERE id=?').get(+q.project_id)?.code || '') : '',
    unit_number: unitNumber,
    logoPath: logoPath || null,
  };
  const built = await buildProjectsXlsx({ settings, meta, rows: d.rows, totals: d.totals });
  log(req.user, 'export_excel', 'report', null, { type: 'projects', filename: built.filename, rows: d.rows.length, filters: q });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="report.xlsx"; filename*=UTF-8''${encodeURIComponent(built.filename)}`);
  res.end(built.buffer);
}));
app.get('/api/finance/profit-dashboard', auth, perm('view_financial_reports'), wrap((req,res)=>res.json(profitDashboardData(req.query))));
app.get('/api/finance/audit', auth, perm('view_financial_reports'), wrap((req,res)=>{
  const q=req.query,where=['1=1'],p=[];if(q.sale_id){where.push('fa.sale_id=?');p.push(+q.sale_id);}if(q.date_from){where.push('date(fa.created_at)>=?');p.push(q.date_from);}if(q.date_to){where.push('date(fa.created_at)<=?');p.push(q.date_to);}
  res.json(db.prepare(`SELECT fa.*,u.name user_name,s.sale_no FROM financial_audit fa LEFT JOIN users u ON u.id=fa.user_id LEFT JOIN sales s ON s.id=fa.sale_id WHERE ${where.join(' AND ')} ORDER BY fa.id DESC LIMIT 1000`).all(...p));
}));
// ===== v1.9: فحص السلامة المالية — مطابقة paid_amount مع جدول الدفعات والمعادلة المحاسبية =====
app.get('/api/finance/integrity', auth, perm('view_financial_reports'), wrap((req, res) => {
  const sales = db.prepare("SELECT * FROM sales WHERE status!='cancelled' ORDER BY id").all();
  const issues = [];
  sales.forEach(s => {
    const paid = saleTotalPaid(s.id);
    const disc = saleDiscountsSum(s.id);
    const adj = saleAdjustments(s.id);
    const final = Math.max(0, (s.base_price || s.list_price || 0) - disc + adj.net);
    const remaining = final - paid;
    if (Math.abs(paid - (s.paid_amount || 0)) > 0.01) issues.push({ type: 'paid_mismatch', sale_id: s.id, sale_no: s.sale_no, expected_paid: paid, stored_paid: s.paid_amount });
    if (Math.abs(final - (s.final_price || 0)) > 0.01) issues.push({ type: 'final_mismatch', sale_id: s.id, sale_no: s.sale_no, expected_final: final, stored_final: s.final_price });
    if (Math.abs(remaining - (s.remaining_amount || 0)) > 0.01) issues.push({ type: 'remaining_mismatch', sale_id: s.id, sale_no: s.sale_no, expected_remaining: remaining, stored_remaining: s.remaining_amount });
    const dbl = db.prepare("SELECT 1 FROM reservation_payments rp WHERE rp.sale_id=? AND rp.status='active' LIMIT 1").get(s.id);
    if (dbl) issues.push({ type: 'deposit_not_linked', sale_id: s.id, sale_no: s.sale_no, note: 'يوجد عربون نشط برقم sale_id بدون حالة نقل' });
  });
  // حجوزات نشطة على وحدات عليها بيع نشط
  const conflicts = db.prepare(`SELECT r.id reservation_id,r.reservation_no,u.unit_number FROM reservations r JOIN units u ON u.id=r.unit_id WHERE r.status='active' AND EXISTS(SELECT 1 FROM sales s WHERE s.unit_id=r.unit_id AND s.status='active')`).all();
  conflicts.forEach(c => issues.push({ type: 'active_reservation_with_sale', ...c }));
  res.json({ checked_sales: sales.length, issues, ok: issues.length === 0, formula: 'paid=Σ(دفعات نشطة)+Σ(عربونات مربوطة) • final=base−discounts±adjustments • remaining=final−paid' });
}));

// ==================== المستندات PDF والأرشيف ====================
const DOC_PERMS = {
  search_results: u => hasPerm(u, 'export_pdf'),
  unit_offer: u => hasPerm(u, 'export_pdf'),
  reservation: u => hasPerm(u, 'export_pdf') && (hasPerm(u, 'view_reservations') || hasPerm(u, 'view_sales')),
  sale: u => hasPerm(u, 'export_pdf') && hasPerm(u, 'view_sales') && hasPerm(u, 'view_prices'),
  sale_invoice: u => hasPerm(u, 'export_pdf') && hasPerm(u, 'view_sales') && hasPerm(u, 'view_prices'),
  sales_report: u => hasPerm(u, 'export_pdf') && hasPerm(u, 'view_sales_reports'),
  payments_report: u => hasPerm(u, 'export_pdf') && hasPerm(u, 'view_payments'),
  commissions_report: u => hasPerm(u, 'export_pdf') && hasPerm(u, 'view_commissions'),
  marketers_report: u => hasPerm(u, 'export_pdf') && hasPerm(u, 'view_marketers'),
  marketer_report: u => hasPerm(u, 'export_pdf') && hasPerm(u, 'view_marketer_reports'),
  financial_report: u => hasPerm(u, 'export_pdf') && hasPerm(u, 'view_financial_reports'),
  settlement_report: u => hasPerm(u, 'export_pdf') && hasPerm(u, 'view_settlements'),
  marketer_settlement_invoice: u => hasPerm(u, 'export_pdf') && hasPerm(u, 'view_commissions'),
  cancelled_reservations_report: u => hasPerm(u, 'export_pdf') && hasPerm(u, 'view_reservations'),
  refunds_report: u => hasPerm(u, 'export_pdf') && hasPerm(u, 'view_reservations'),
};
function docData(type, params, user) {
  if (type === 'search_results') {
    const { base, p, total } = unitsQuery(params);
    const rows = db.prepare(`SELECT u.*,p.name project_name,f.name floor_name,m.code model_code,COALESCE(u.rooms,m.rooms) display_rooms,COALESCE(u.area,m.area) display_area,ds.final_price effective_price ${base} ORDER BY p.id DESC,f.floor_order,u.unit_number LIMIT 500`).all(...p);
    rows.forEach(r => { r.effective_price = r.effective_price ?? r.price; });
    const filters = [];
    if (params.project_id) { const pr = db.prepare('SELECT name FROM projects WHERE id=?').get(+params.project_id); if (pr) filters.push(['المشروع', pr.name]); }
    if (params.status) filters.push(['الحالة', params.status.split(',').map(s => STATUS_AR[s] || s).join(' / ')]);
    if (params.rooms) filters.push(['الغرف', params.rooms]);
    if (params.sell_phase) filters.push(['المرحلة', PHASE_AR[params.sell_phase] || params.sell_phase]);
    if (params.price_min || params.price_max) filters.push(['نطاق السعر', `${(+params.price_min || 0).toLocaleString('en-US')} — ${(+params.price_max || '∞').toLocaleString('en-US')}`]);
    if (params.has_discount === '1') filters.push(['خصم', 'وحدات عليها خصم فقط']);
    if (params.search) filters.push(['كلمة البحث', params.search]);
    const prjName = params.project_id ? (db.prepare('SELECT code FROM projects WHERE id=?').get(+params.project_id)?.code || '') : '';
    return { data: { rows, total, filters }, filenameParts: prjName ? ['مشروع_' + prjName] : [], subtitle: filters.map(f => `${f[0]}: ${f[1]}`).join(' • ').slice(0, 90) };
  }
  if (type === 'unit_offer') {
    const u = db.prepare(`SELECT u.*,p.name project_name,f.name floor_name,m.code model_code,m.name model_name,COALESCE(u.rooms,m.rooms) display_rooms,COALESCE(u.bathrooms,m.bathrooms) display_bathrooms,COALESCE(u.area,m.area) display_area,m.description model_description FROM units u JOIN projects p ON p.id=u.project_id JOIN floors f ON f.id=u.floor_id LEFT JOIN models m ON m.id=u.model_id WHERE u.id=?`).get(params.unit_id);
    if (!u) throw Error('الوحدة غير موجودة');
    if (hasPerm(user, 'view_sales')) {
      const sale = db.prepare("SELECT * FROM sales WHERE unit_id=? AND status='active'").get(u.id);
      if (sale) u.sale = sale;
    }
    return { data: { unit: u }, filenameParts: [u.project_name, 'الوحدة_' + u.unit_number], subtitle: `${u.project_name} — الوحدة ${u.unit_number}` };
  }
  if (type === 'reservation') {
    const r = db.prepare(`SELECT r.*,us.name employee_name FROM reservations r JOIN users us ON us.id=r.user_id WHERE r.id=?`).get(params.reservation_id);
    if (!r) throw Error('الحجز غير موجود');
    if (!hasPerm(user, 'view_reservations') && !hasPerm(user, 'view_sales') && r.user_id !== user.id && user.role !== 'super_admin') throw httpError('لا تملك صلاحية مستند هذا الحجز');
    const unit = db.prepare(`SELECT u.*,p.name project_name,f.name floor_name,m.code model_code,COALESCE(u.rooms,m.rooms) display_rooms,COALESCE(u.area,m.area) display_area FROM units u JOIN projects p ON p.id=u.project_id JOIN floors f ON f.id=u.floor_id LEFT JOIN models m ON m.id=u.model_id WHERE u.id=?`).get(r.unit_id);
    const customer = db.prepare('SELECT name,phone FROM customers WHERE id=?').get(r.customer_id);
    return { data: { reservation: r, unit, customer }, filenameParts: [r.reservation_no], subtitle: `${r.reservation_no} — ${customer?.name || ''}` };
  }
  if (type === 'sale' || type === 'sale_invoice') {
    const s = db.prepare(`${SALE_OUT_SQL} WHERE s.id=?`).get(params.sale_id);
    if (!s) throw Error('البيع غير موجود');
    if (user.legacy && s.created_by !== user.id && s.salesperson_id !== user.id) throw httpError('لا تملك صلاحية مستند بيع لم تنشئه أنت');
    const fin = canFinance(user) ? saleFinance(s) : null;
    const discounts = db.prepare("SELECT * FROM discounts WHERE sale_id=? AND status='active' ORDER BY id").all(s.id);
    const expenses = canFinance(user) ? db.prepare("SELECT * FROM expenses WHERE sale_id=? AND status='active' ORDER BY id").all(s.id) : [];
    const prevSale = s.prev_sale_id ? db.prepare('SELECT * FROM sales WHERE id=?').get(s.prev_sale_id) : null;
    const unit = db.prepare(`SELECT u.*,p.name project_name,f.name floor_name,m.code model_code,COALESCE(u.rooms,m.rooms) display_rooms,COALESCE(u.area,m.area) display_area FROM units u JOIN projects p ON p.id=u.project_id JOIN floors f ON f.id=u.floor_id LEFT JOIN models m ON m.id=u.model_id WHERE u.id=?`).get(s.unit_id);
    const customer = db.prepare('SELECT name,phone FROM customers WHERE id=?').get(s.customer_id);
    const payments = db.prepare("SELECT * FROM payments WHERE sale_id=? AND status='active' ORDER BY pay_date,id").all(s.id);
    const full = fullSaleRecord(s.id);
    return { data: { sale: s, unit, customer, payments, finance: fin, discounts, expenses, prevSale, adjustments: full.adjustments, movements: full.movements, settlement: full.settlement, settlement_transactions: full.settlement_transactions, commission_payments: full.commission_payments, beneficiary: full.beneficiary, deposit: full.deposit, reservation_payments: full.reservation_payments }, filenameParts: [s.invoice_no || s.sale_no,s.sale_no], subtitle: `${s.invoice_no || ''} • ${s.sale_no} — ${customer?.name || ''}` };
  }
  if (type === 'sales_report') {
    const d = salesReportData(params);
    const filters = [];
    if (params.date_from) filters.push(['من تاريخ', params.date_from]);
    if (params.date_to) filters.push(['إلى تاريخ', params.date_to]);
    if (params.project_id) { const pr = db.prepare('SELECT name FROM projects WHERE id=?').get(+params.project_id); if (pr) filters.push(['المشروع', pr.name]); }
    if (params.marketer_id) { const mk = db.prepare('SELECT name FROM marketers WHERE id=?').get(+params.marketer_id); if (mk) filters.push(['المسوق', mk.name]); }
    return { data: { ...d, filters }, filenameParts: [], subtitle: filters.map(f => `${f[0]}: ${f[1]}`).join(' • ') };
  }
  if (type === 'payments_report') {
    const d = paymentsReportData(params);
    const filters = [];
    if (params.date_from) filters.push(['من تاريخ', params.date_from]);
    if (params.date_to) filters.push(['إلى تاريخ', params.date_to]);
    if (params.method) filters.push(['الطريقة', { cash: 'كاش', bank_transfer: 'حوالة بنكية', check: 'شيك' }[params.method] || params.method]);
    return { data: { ...d, filters }, filenameParts: [], subtitle: filters.map(f => `${f[0]}: ${f[1]}`).join(' • ') };
  }
  if (type === 'commissions_report') {
    const d = commissionsReportData(params);
    const filters = [];
    if (params.marketer_id) { const mk = db.prepare('SELECT name FROM marketers WHERE id=?').get(+params.marketer_id); if (mk) filters.push(['المسوق', mk.name]); }
    if (params.status) filters.push(['الحالة', { unpaid: 'غير مدفوعة', partial: 'مدفوعة جزئيًا', paid: 'مدفوعة بالكامل' }[params.status] || params.status]);
    return { data: { ...d, filters }, filenameParts: [], subtitle: filters.map(f => `${f[0]}: ${f[1]}`).join(' • ') };
  }
  if (type === 'marketers_report') {
    const rows = db.prepare(`${MARKETER_STATS} ORDER BY sales_total DESC`).all().map(m => ({ ...m, commission_due: Math.max(0, m.commission_total - m.commission_paid) }));
    return { data: { rows }, filenameParts: [], subtitle: 'إحصاءات المسوقين والعمولات' };
  }
  if (type === 'marketer_report') {
    const d = marketersReportData(params);
    const filters = [];
    if (params.project_id) { const pr = db.prepare('SELECT name FROM projects WHERE id=?').get(+params.project_id); if (pr) filters.push(['المشروع', pr.name]); }
    if (params.sale_status) filters.push(['حالة البيع', STATUS_AR[params.sale_status] || params.sale_status]);
    if (params.commission_status) filters.push(['حالة العمولة', { unpaid: 'غير مدفوعة', partial: 'مدفوعة جزئيًا', paid: 'مدفوعة بالكامل' }[params.commission_status] || params.commission_status]);
    filters.push(['الفترة', d.period]);
    const namePart = d.marketer_name ? 'مسوق_' + d.marketer_name : 'المسوقين_إجمالي';
    const datePart = (params.date_from || params.date_to) ? `${params.date_from || ''}_${params.date_to || ''}` : '';
    return { data: { ...d, filters }, filenameParts: ['تقرير', namePart, datePart], subtitle: (d.marketer_name ? `المسوق: ${d.marketer_name}` : 'جميع المسوقين') + ' • ' + d.period, marketerName: d.marketer_name };
  }
  if (type === 'financial_report') {
    const d = financialReportData(params);
    const filters = [];
    if (params.date_from) filters.push(['من تاريخ', params.date_from]);
    if (params.date_to) filters.push(['إلى تاريخ', params.date_to]);
    return { data: { ...d, filters }, filenameParts: [], subtitle: filters.map(f => `${f[0]}: ${f[1]}`).join(' • ') };
  }
  if (type === 'settlement_report') {
    const d = settlementReportDetails(+(params.report_id || 0));
    if (!d) throw Error('تقرير التصفية غير موجود');
    return { data: d, filenameParts: [d.invoice_no,d.report_no, d.sale_no], subtitle: `${d.invoice_no || ''} • ${d.report_no} • البيع ${d.sale_no} • ${d.project_name} — ${d.unit_number}`, marketerName: d.marketer_name || null };
  }
  if (type === 'marketer_settlement_invoice') {
    const batch=db.prepare(`SELECT b.*,m.name marketer_name,m.code marketer_code,m.phone marketer_phone,u.name created_by_name FROM marketer_settlement_batches b JOIN marketers m ON m.id=b.marketer_id LEFT JOIN users u ON u.id=b.created_by WHERE b.id=?`).get(+(params.batch_id||0));
    if(!batch) throw Error('فاتورة تصفية المسوق غير موجودة');
    const items=db.prepare(`SELECT i.*,s.sale_no,s.invoice_no sale_invoice_no,s.sale_date,s.is_resale,s.final_price,s.commission_total,s.commission_paid,u.unit_number,pr.name project_name,c.name customer_name FROM marketer_settlement_items i JOIN sales s ON s.id=i.sale_id JOIN units u ON u.id=s.unit_id JOIN projects pr ON pr.id=u.project_id JOIN customers c ON c.id=s.customer_id WHERE i.batch_id=? ORDER BY i.id`).all(batch.id);
    return {data:{batch,items},filenameParts:[batch.invoice_no,batch.settlement_no],subtitle:`${batch.invoice_no} • ${batch.settlement_no} • ${batch.marketer_name}`,marketerName:batch.marketer_name};
  }
  if (type === 'cancelled_reservations_report' || type === 'refunds_report') {
    const d = type === 'cancelled_reservations_report' ? cancelledReservationsReportData(params) : refundsReportData(params);
    const filters = [];
    if (params.reason_code) filters.push(['سبب الإلغاء', RESERVATION_CANCEL_REASONS[params.reason_code] || params.reason_code]);
    if (params.date_from || params.date_to) filters.push(['الفترة', `${params.date_from || 'البداية'} ← ${params.date_to || 'اليوم'}`]);
    if (params.project_id) { const pr = db.prepare('SELECT name FROM projects WHERE id=?').get(+params.project_id); if (pr) filters.push(['المشروع', pr.name]); }
    if (params.unit_number) filters.push(['الوحدة', params.unit_number]);
    if (params.customer) filters.push(['العميل', params.customer]);
    return { data: { ...d, filters }, filenameParts: type === 'refunds_report' ? ['تقرير_الاستردادات'] : ['تقرير_الحجوزات_الملغاة'], subtitle: filters.map(f => `${f[0]}: ${f[1]}`).join(' • ') };
  }
  throw Error('نوع مستند غير معروف');
}
app.post('/api/documents/generate', auth, wrap(async (req, res) => {
  try {
    const { type, save, params = {} } = req.body;
    const p = DOC_PERMS[type];
    if (!p || !p(req.user)) return res.status(403).json({ error: 'ليس لديك صلاحية إنشاء هذا المستند' });
    if (!hasPerm(req.user, 'export_pdf')) return res.status(403).json({ error: 'ليس لديك صلاحية تصدير PDF' });
    if (save && !hasPerm(req.user, 'save_pdf')) return res.status(403).json({ error: 'ليس لديك صلاحية حفظ PDF في الأرشيف' });
    const settings = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x => [x.key, x.value]));
    const docNo = 'DOC-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-7);
    const { data, filenameParts, subtitle, marketerName } = docData(type, params, req.user);
    const built = await buildDocument({ type, data, filenameParts, settings, user: req.user, docNo, subtitle });
    if (save) {
      let fn = built.filename, n = 1;
      while (fs.existsSync(path.join(ARCHIVE_DIR, fn))) { fn = built.filename.replace('.pdf', `-${++n}.pdf`); }
      fs.writeFileSync(path.join(ARCHIVE_DIR, fn), built.buffer);
      let projectName = null, unitId = null, unitNumber = null, customerName = null;
      if (type === 'search_results' && params.project_id) projectName = db.prepare('SELECT name FROM projects WHERE id=?').get(+params.project_id)?.name || null;
      if (type === 'unit_offer' && data.unit) { unitId = data.unit.id; unitNumber = data.unit.unit_number; projectName = data.unit.project_name; }
      if (type === 'reservation' && data.reservation) { unitId = data.reservation.unit_id; unitNumber = data.unit?.unit_number || null; customerName = data.customer?.name || null; projectName = data.unit?.project_name || null; }
      if ((type === 'sale' || type === 'sale_invoice') && data.sale) { unitId = data.sale.unit_id; unitNumber = data.unit?.unit_number || null; customerName = data.customer?.name || null; projectName = data.unit?.project_name || null; }
      if (type === 'marketer_report' && params.project_id) projectName = db.prepare('SELECT name FROM projects WHERE id=?').get(+params.project_id)?.name || null;
      if (type === 'settlement_report' && data) { unitNumber = data.unit_number || null; customerName = data.new_owner_name || null; projectName = data.project_name || null; }
      const i = db.prepare(`INSERT INTO documents(doc_no,filename,filepath,doc_type,title,project_id,project_name,unit_id,unit_number,customer_name,marketer_name,file_size,pages,created_by,created_by_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(docNo, fn, path.join(ARCHIVE_DIR, fn), type, built.title, params.project_id ? +params.project_id : null, projectName, unitId, unitNumber, customerName, marketerName || null, built.buffer.length, built.pages, req.user.id, req.user.name);
      log(req.user, 'save_document', 'document', i.lastInsertRowid, { doc_no: docNo, filename: fn, type });
      return res.json({ id: i.lastInsertRowid, doc_no: docNo, filename: fn, size: built.buffer.length, pages: built.pages, download_url: `/api/documents/${i.lastInsertRowid}/download` });
    }
    log(req.user, 'export_document', 'document', null, { type });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(built.filename)}`);
    res.end(built.buffer);
  } catch (e) { console.error(e); res.status(e.status || 400).json({ error: e.message }); }
}));
app.get('/api/documents', auth, wrap((req, res) => {
  if (!hasPerm(req.user, 'export_pdf') && !hasPerm(req.user, 'save_pdf') && !hasPerm(req.user, 'manage_docs_archive')) return res.status(403).json({ error: 'ليس لديك صلاحية الوصول للأرشيف' });
  const q = req.query; const where = ['1=1'], p = [];
  if (q.doc_type) { where.push('d.doc_type=?'); p.push(q.doc_type); }
  if (q.project_id) { where.push('d.project_id=?'); p.push(+q.project_id); }
  if (q.date_from) { where.push('date(d.created_at)>=?'); p.push(q.date_from); }
  if (q.date_to) { where.push('date(d.created_at)<=?'); p.push(q.date_to); }
  if (q.q) { where.push('(d.filename LIKE ? OR d.title LIKE ? OR d.doc_no LIKE ? OR COALESCE(d.customer_name,\'\') LIKE ? OR COALESCE(d.unit_number,\'\') LIKE ? OR COALESCE(d.project_name,\'\') LIKE ? OR COALESCE(d.marketer_name,\'\') LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  if (hasPerm(req.user, 'manage_docs_archive')) {
    // يرى كل المستندات
  } else if (req.user.role === 'accountant' && !req.user.permsCustomized) {
    where.push(`(d.created_by=? OR d.doc_type IN ('payments_report','commissions_report','financial_report','sales_report','marketers_report','marketer_report','settlement_report','sale_invoice','marketer_settlement_invoice','sale'))`); p.push(req.user.id);
  } else {
    where.push('d.created_by=?'); p.push(req.user.id);
  }
  res.json(db.prepare(`SELECT d.id,d.doc_no,d.filename,d.doc_type,d.title,d.project_name,d.unit_number,d.customer_name,d.marketer_name,d.file_size,d.pages,d.created_by_name,d.created_at FROM documents d WHERE ${where.join(' AND ')} ORDER BY d.id DESC LIMIT 300`).all(...p));
}));
function docAccess(req) {
  const d = db.prepare('SELECT * FROM documents WHERE id=?').get(req.params.id);
  if (!d) return { err: 404 };
  const u = req.user;
  const isFin = ['payments_report', 'commissions_report', 'financial_report', 'sales_report', 'marketers_report', 'marketer_report', 'settlement_report', 'sale_invoice', 'marketer_settlement_invoice', 'sale'].includes(d.doc_type);
  const allowed = hasPerm(u, 'manage_docs_archive') || d.created_by === u.id || (u.role === 'accountant' && !u.permsCustomized && isFin);
  return allowed ? { doc: d } : { err: 403 };
}
app.get('/api/documents/:id/file', auth, wrap((req, res) => {
  const { doc, err } = docAccess(req);
  if (err === 404) return res.status(404).json({ error: 'المستند غير موجود' });
  if (err === 403) return res.status(403).json({ error: 'لا تملك صلاحية الوصول لهذا المستند' });
  if (!fs.existsSync(doc.filepath)) return res.status(404).json({ error: 'ملف المستند غير موجود على القرص' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="doc.pdf"; filename*=UTF-8''${encodeURIComponent(doc.filename)}`);
  fs.createReadStream(doc.filepath).pipe(res);
}));
app.get('/api/documents/:id/download', auth, wrap((req, res) => {
  const { doc, err } = docAccess(req);
  if (err === 404) return res.status(404).json({ error: 'المستند غير موجود' });
  if (err === 403) return res.status(403).json({ error: 'لا تملك صلاحية الوصول لهذا المستند' });
  if (!fs.existsSync(doc.filepath)) return res.status(404).json({ error: 'ملف المستند غير موجود على القرص' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="doc.pdf"; filename*=UTF-8''${encodeURIComponent(doc.filename)}`);
  fs.createReadStream(doc.filepath).pipe(res);
}));
app.delete('/api/documents/:id', auth, wrap((req, res) => {
  const d = db.prepare('SELECT * FROM documents WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'المستند غير موجود' });
  const can = hasPerm(req.user, 'manage_docs_archive') || d.created_by === req.user.id;
  if (!can) return res.status(403).json({ error: 'لا تملك صلاحية حذف هذا المستند' });
  try { if (fs.existsSync(d.filepath)) fs.unlinkSync(d.filepath); } catch { }
  db.prepare('DELETE FROM documents WHERE id=?').run(req.params.id);
  log(req.user, 'delete_document', 'document', req.params.id, { filename: d.filename });
  res.json({ ok: true });
}));

// ==================== الخصومات / المصروفات / المستثمر / اللوحة المالية (v1.8) ====================
const DISC_TYPE_AR = { amount: 'مبلغ ثابت', percent: 'نسبة مئوية' };

app.get('/api/sales/:id/discounts', auth, perm('view_prices'), wrap((req, res) => {
  res.json(db.prepare(`SELECT d.*,us.name created_by_name FROM discounts d LEFT JOIN users us ON us.id=d.created_by WHERE d.sale_id=? ORDER BY d.id DESC`).all(req.params.id));
}));
app.post('/api/sales/:id/discounts', auth, perm('edit_discounts'), wrap((req, res) => {
  const tx = db.transaction(() => {
    const s = db.prepare("SELECT s.*,u.unit_number FROM sales s JOIN units u ON u.id=s.unit_id WHERE s.id=? AND s.status='active'").get(req.params.id);
    if (!s) throw Error('الصفقة غير نشطة');
    const b = req.body;
    const type = ['amount', 'percent'].includes(b.type) ? b.type : 'amount';
    const value = +b.value || 0;
    if (!(value > 0)) throw Error('قيمة الخصم مطلوبة');
    const base = s.base_price || s.list_price || 0;
    if (type === 'amount' && value > base) throw Error('قيمة الخصم تتجاوز سعر العقد');
    if (type === 'percent' && value > 100) throw Error('النسبة لا تتجاوز 100%');
    const amount = Math.round(type === 'amount' ? value : base * value / 100);
    const currentDisc = saleDiscountsSum(s.id);
    if (currentDisc + amount > base) throw Error(`إجمالي الخصومات سيتجاوز سعر العقد (الحالي ${currentDisc.toLocaleString('en-US')} + الجديد ${amount.toLocaleString('en-US')} > ${base.toLocaleString('en-US')})`);
    const no = 'DSC-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-7);
    const i = db.prepare(`INSERT INTO discounts(discount_no,sale_id,type,value,amount,reason,approved_by,discount_date,created_by) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(no, s.id, type, value, amount, b.reason || '', b.approved_by || req.user.name, b.discount_date || nowDate(), req.user.id);
    recalcSale(s.id);
    const f = saleFinance(db.prepare('SELECT * FROM sales WHERE id=?').get(s.id));
    logUnitEvent(s.unit_id, 'discount', `إضافة خصم ${amount.toLocaleString('en-US')} (${DISC_TYPE_AR[type]})${b.reason ? ' — السبب: ' + b.reason : ''} — اعتمده: ${b.approved_by || req.user.name} — السعر النهائي الآن ${f.final.toLocaleString('en-US')}`, req.user, { amount, reason: b.reason, approved_by: b.approved_by || req.user.name });
    log(req.user, 'add_discount', 'sale', s.id, { no, amount, reason: b.reason });
    financialAudit(req.user, 'add_discount', 'discount', i.lastInsertRowid, s.id, {}, { no, amount, type, value }, b.reason || '');
    return { id: i.lastInsertRowid, discount_no: no, amount, final: f.final, remaining: f.remaining };
  });
  res.json(tx());
}));
app.post('/api/discounts/:id/cancel', auth, perm('edit_discounts'), wrap((req, res) => {
  const tx = db.transaction(() => {
    const d = db.prepare("SELECT d.*,s.unit_id,s.sale_no FROM discounts d JOIN sales s ON s.id=d.sale_id WHERE d.id=? AND d.status='active'").get(req.params.id);
    if (!d) throw Error('الخصم غير موجود أو ملغي');
    if (!req.body.reason) throw Error('سبب الإلغاء مطلوب');
    db.prepare("UPDATE discounts SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancel_reason=? WHERE id=?").run(req.body.reason, d.id);
    recalcSale(d.sale_id);
    logUnitEvent(d.unit_id, 'discount_cancelled', `إلغاء الخصم ${d.amount.toLocaleString('en-US')} من الصفقة ${d.sale_no} — السبب: ${req.body.reason}`, req.user, { amount: d.amount });
    log(req.user, 'cancel_discount', 'sale', d.sale_id, { no: d.discount_no, reason: req.body.reason });
    financialAudit(req.user, 'cancel_discount', 'discount', d.id, d.sale_id, { status: 'active', amount: d.amount }, { status: 'cancelled' }, req.body.reason);
  });
  tx(); res.json({ ok: true });
}));

app.get('/api/sales/:id/expenses', auth, perm('view_prices'), wrap((req, res) => {
  res.json(db.prepare(`SELECT e.*,us.name created_by_name FROM expenses e LEFT JOIN users us ON us.id=e.created_by WHERE e.sale_id=? ORDER BY e.id DESC`).all(req.params.id));
}));
app.post('/api/sales/:id/expenses', auth, perm('edit_sale'), wrap((req, res) => {
  const tx = db.transaction(() => {
    const s = db.prepare("SELECT s.*,u.unit_number FROM sales s JOIN units u ON u.id=s.unit_id WHERE s.id=?").get(req.params.id);
    if (!s) throw Error('الصفقة غير موجودة');
    const b = req.body;
    const amount = +b.amount;
    if (!(amount > 0)) throw Error('قيمة المصروف مطلوبة');
    if (!b.title) throw Error('بيان المصروف مطلوب');
    const no = 'EXP-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-7);
    const i = db.prepare(`INSERT INTO expenses(expense_no,sale_id,title,amount,expense_date,notes,created_by) VALUES(?,?,?,?,?,?,?)`)
      .run(no, s.id, b.title, amount, b.expense_date || nowDate(), b.notes || '', req.user.id);
    const f = saleFinance(db.prepare('SELECT * FROM sales WHERE id=?').get(s.id));
    logUnitEvent(s.unit_id, 'expense', `تسجيل مصروف «${b.title}» بقيمة ${amount.toLocaleString('en-US')} — صافي الربح الآن ${f.net_profit.toLocaleString('en-US')}`, req.user, { amount, title: b.title });
    log(req.user, 'add_expense', 'sale', s.id, { no, amount, title: b.title });
    financialAudit(req.user, 'add_expense', 'expense', i.lastInsertRowid, s.id, {}, { no, amount, title: b.title }, b.notes || '');
    return { id: i.lastInsertRowid, expense_no: no, net_profit: f.net_profit };
  });
  res.json(tx());
}));
app.post('/api/expenses/:id/cancel', auth, perm('edit_sale'), wrap((req, res) => {
  const tx = db.transaction(() => {
    const e = db.prepare("SELECT e.*,s.unit_id,s.sale_no FROM expenses e JOIN sales s ON s.id=e.sale_id WHERE e.id=? AND e.status='active'").get(req.params.id);
    if (!e) throw Error('المصروف غير موجود أو ملغي');
    if (!req.body.reason) throw Error('سبب الإلغاء مطلوب');
    db.prepare("UPDATE expenses SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancel_reason=? WHERE id=?").run(req.body.reason, e.id);
    logUnitEvent(e.unit_id, 'expense_cancelled', `إلغاء المصروف «${e.title}» (${e.amount.toLocaleString('en-US')}) — السبب: ${req.body.reason}`, req.user, { amount: e.amount });
    log(req.user, 'cancel_expense', 'sale', e.sale_id, { no: e.expense_no, reason: req.body.reason });
    financialAudit(req.user, 'cancel_expense', 'expense', e.id, e.sale_id, { status: 'active', amount: e.amount }, { status: 'cancelled' }, req.body.reason);
  });
  tx(); res.json({ ok: true });
}));

app.put('/api/sales/:id/investor', auth, perm('edit_sale'), wrap((req, res) => {
  const s = db.prepare('SELECT * FROM sales WHERE id=?').get(req.params.id);
  if (!s) throw Error('الصفقة غير موجودة');
  const b = req.body;
  const newCost = b.property_cost != null ? +b.property_cost : (b.purchase_cost != null ? +b.purchase_cost : null);
  db.prepare('UPDATE sales SET investor_name=COALESCE(?,investor_name),purchase_cost=COALESCE(?,purchase_cost),property_cost=COALESCE(?,property_cost) WHERE id=?')
    .run(b.investor_name || null, newCost, newCost, req.params.id);
  const f = saleFinance(db.prepare('SELECT * FROM sales WHERE id=?').get(s.id));
  if (newCost != null) financialAudit(req.user, 'update_property_cost', 'sale', s.id, s.id, { property_cost: s.property_cost ?? s.purchase_cost ?? 0 }, { property_cost: newCost }, b.reason || 'تحديث تكلفة العقار');
  logUnitEvent(s.unit_id, 'investor', `تحديث بيانات المستثمر${b.investor_name ? ': ' + b.investor_name : ''}${b.purchase_cost != null ? ` — تكلفة الشراء ${(+b.purchase_cost).toLocaleString('en-US')} — صافي الربح ${f.net_profit.toLocaleString('en-US')} (${f.net_profit_pct ?? '—'}%)` : ''}`, req.user, { investor: b.investor_name, purchase_cost: b.purchase_cost });
  log(req.user, 'update_investor', 'sale', s.id, b);
  res.json({ ok: true, finance: f });
}));

app.get('/api/sales/:id/finance', auth, wrap((req, res) => {
  if (!canFinance(req.user)) return res.status(403).json({ error: 'اللوحة المالية للإدارة والمالية فقط' });
  const s = db.prepare('SELECT * FROM sales WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'الصفقة غير موجودة' });
  res.json(saleFinance(s));
}));
// ===== v1.9: الملخص المالي الموحد للصفقة (المصدر الواحد للأرقام في الواجهة وPDF وExcel) =====
app.get('/api/sales/:id/financial-summary', auth, wrap((req, res) => {
  if (!hasPerm(req.user, 'view_prices')) return res.status(403).json({ error: 'ليس لديك صلاحية عرض الأسعار' });
  const s = db.prepare("SELECT s.*,u.unit_number,p.name project_name,p.code project_code,c.name customer_name,c.phone customer_phone,mk.name marketer_name,mk.code marketer_code FROM sales s JOIN units u ON u.id=s.unit_id JOIN projects p ON p.id=u.project_id JOIN customers c ON c.id=s.customer_id LEFT JOIN marketers mk ON mk.id=s.marketer_id WHERE s.id=?").get(req.params.id);
  if (!s) return res.status(404).json({ error: 'الصفقة غير موجودة' });
  const finance = saleFinance(s);
  const out = {
    sale: { id: s.id, sale_no: s.sale_no, invoice_no: s.invoice_no, sale_date: s.sale_date, status: s.status, is_resale: !!s.is_resale, unit_number: s.unit_number, project_name: s.project_name, customer_name: s.customer_name, customer_phone: s.customer_phone, payment_method: s.payment_method, payment_ref: s.payment_ref, contract_no: s.contract_no },
    finance,
    deposit: saleDepositInfo(s.id),
    payments: db.prepare("SELECT * FROM payments WHERE sale_id=? AND status='active' ORDER BY pay_date,id").all(s.id),
    discounts: db.prepare("SELECT * FROM discounts WHERE sale_id=? AND status='active' ORDER BY id DESC").all(s.id),
    expenses: canFinance(req.user) ? db.prepare("SELECT * FROM expenses WHERE sale_id=? AND status='active' ORDER BY id DESC").all(s.id) : [],
    adjustments: saleAdjustments(s.id),
    commission: { marketer_name: s.marketer_name, marketer_code: s.marketer_code, type: s.commission_type, value: s.commission_value, total: s.commission_total, paid: s.commission_paid, remaining: Math.max(0, s.commission_total - s.commission_paid), status: s.commission_status },
    resale: s.is_resale ? { prev_owner_name: s.prev_owner_name, purchase_price: s.purchase_price, purchase_date: s.purchase_date, prev_sale_id: s.prev_sale_id, prev_owner_finance: finance.prev_owner_finance, seller_name: s.seller_name, investor_name: s.investor_name, property_cost: finance.property_cost, investor_share_pct: (finance.final > 0 && finance.prev_owner_finance) ? Math.round((Math.max(0, finance.prev_owner_finance.remaining) / finance.final) * 10000) / 100 : null } : null,
  };
  res.json(out);
}));

// ==================== المستخدمون والصلاحيات ====================
const validRoles = ['super_admin', 'admin', 'sales_manager', 'accountant', 'reservations_officer', 'sales', 'viewer'];
app.get('/api/permissions-schema', auth, wrap((req, res) => res.json(PERMISSION_SCHEMA)));
app.get('/api/users', auth, perm('view_users'), wrap((req, res) => {
  const rows = db.prepare('SELECT id,name,username,role,active,created_at,permissions FROM users ORDER BY id').all();
  res.json(rows.map(u => { const { perms, customized } = effectivePerms({ role: u.role, permissions: u.permissions }); return { id: u.id, name: u.name, username: u.username, role: u.role, active: !!u.active, created_at: u.created_at, perms_count: [...perms].length, perms_customized: u.role === 'super_admin' ? false : customized }; }));
}));
app.post('/api/users', auth, perm('add_user'), wrap((req, res) => {
  const b = req.body;
  // من غير مدير النظام: يُنشأ المستخدم بصلاحيات فارغة ودور «مشاهدة» لحماية النظام من ترقية ذاتية
  const isSuper = req.user.role === 'super_admin';
  const role = isSuper && b.role && validRoles.includes(b.role) ? b.role : 'viewer';
  if (String(b.password || '').length < 8) throw Error('كلمة المرور يجب ألا تقل عن 8 أحرف');
  const i = db.prepare('INSERT INTO users(name,username,password_hash,role,must_change_password,permissions) VALUES(?,?,?,?,?,?)').run(b.name, b.username, bcrypt.hashSync(b.password, 12), role, 1, isSuper && b.permissions ? JSON.stringify(b.permissions) : null);
  log(req.user, 'create', 'user', i.lastInsertRowid, { name: b.name, role }); res.json({ id: i.lastInsertRowid });
}));
app.put('/api/users/:id', auth, perm('edit_user'), wrap((req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!target) throw Error('المستخدم غير موجود');
  const b = req.body;
  // الدور يعدله مدير النظام فقط
  let role = target.role;
  if (b.role !== undefined) {
    if (req.user.role !== 'super_admin') throw Error('تغيير الدور متاح لمدير النظام فقط');
    if (!validRoles.includes(b.role)) throw Error('صلاحية غير صحيحة');
    role = b.role;
    const activeSupers = db.prepare("SELECT COUNT(*) n FROM users WHERE role='super_admin' AND active=1").get().n;
    if (target.role === 'super_admin' && role !== 'super_admin' && activeSupers <= 1) throw Error('لا يمكن إزالة آخر مدير نظام نشط');
  }
  if (+req.params.id === req.user.id && target.role === 'super_admin' && role !== 'super_admin') throw Error('لا يمكنك تخفيض دورك أنت كمدير النظام');
  db.prepare('UPDATE users SET name=?,role=? WHERE id=?').run(b.name || target.name, role, req.params.id);
  log(req.user, 'update', 'user', req.params.id, { name: b.name || target.name, role }); res.json({ ok: true });
}));
app.post('/api/users/:id/toggle', auth, perm('disable_user'), wrap((req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!target) throw Error('المستخدم غير موجود');
  if (+req.params.id === req.user.id) throw Error('لا يمكنك تعطيل حسابك');
  if (target.role === 'super_admin' && target.active) {
    const activeSupers = db.prepare("SELECT COUNT(*) n FROM users WHERE role='super_admin' AND active=1").get().n;
    if (activeSupers <= 1) throw Error('لا يمكن تعطيل آخر مدير نظام');
  }
  db.prepare('UPDATE users SET active=? WHERE id=?').run(target.active ? 0 : 1, req.params.id);
  log(req.user, target.active ? 'disable' : 'enable', 'user', req.params.id, { name: target.name });
  res.json({ ok: true, active: !target.active });
}));
app.delete('/api/users/:id', auth, perm('delete_user'), wrap((req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!target) throw Error('المستخدم غير موجود');
  if (+req.params.id === req.user.id) throw Error('لا يمكنك حذف حسابك');
  if (target.role === 'super_admin') {
    const activeSupers = db.prepare("SELECT COUNT(*) n FROM users WHERE role='super_admin'").get().n;
    if (activeSupers <= 1) throw Error('لا يمكن حذف آخر مدير نظام');
  }
  const hasOps = db.prepare('SELECT 1 FROM sales WHERE created_by=? OR salesperson_id=? LIMIT 1').get(req.params.id, req.params.id)
    || db.prepare('SELECT 1 FROM payments WHERE created_by=? LIMIT 1').get(req.params.id)
    || db.prepare('SELECT 1 FROM reservations WHERE user_id=? LIMIT 1').get(req.params.id);
  if (hasOps) throw Error('لا يمكن حذف مستخدم له عمليات مسجلة؛ عطّل الحساب بدلًا من حذفه للحفاظ على السجل التاريخي');
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  log(req.user, 'delete', 'user', req.params.id, { name: target.name }); res.json({ ok: true });
}));
// تعديل الصلاحيات التفصيلية — مدير النظام فقط (منع منح النفس صلاحيات)
app.put('/api/users/:id/permissions', auth, roles_super_only(), wrap((req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!target) throw Error('المستخدم غير موجود');
  if (target.role === 'super_admin') throw Error('مدير النظام يملك جميع الصلاحيات تلقائيًا');
  const body = req.body.permissions || {};
  const clean = {};
  ALL_PERMS.forEach(k => { if (body[k] === true) clean[k] = true; });
  db.prepare('UPDATE users SET permissions=? WHERE id=?').run(JSON.stringify(clean), req.params.id);
  log(req.user, 'update_permissions', 'user', req.params.id, { count: Object.keys(clean).length, granted: Object.keys(clean) });
  res.json({ ok: true, perms: Object.keys(clean) });
}));
function roles_super_only() { return (req, res, next) => req.user.role === 'super_admin' ? next() : res.status(403).json({ error: 'تعديل الصلاحيات متاح لمدير النظام فقط' }); }
app.get('/api/users/:id/permissions', auth, perm('view_users'), wrap((req, res) => {
  const target = db.prepare('SELECT id,name,role,permissions FROM users WHERE id=?').get(req.params.id);
  if (!target) throw Error('المستخدم غير موجود');
  const { perms, customized } = effectivePerms(target);
  res.json({ id: target.id, role: target.role, perms: [...perms], customized, defaults: ROLE_DEFAULTS[target.role] || [] });
}));
app.post('/api/users/:id/reset-password', auth, perm('edit_user'), wrap((req, res) => {
  if (String(req.body.password || '').length < 8) throw Error('كلمة المرور يجب ألا تقل عن 8 أحرف');
  // v1.9: إعادة التعيين تُبطل كل جلسات المستخدم الحالية فورًا
  db.prepare('UPDATE users SET password_hash=?,must_change_password=1,token_version=token_version+1 WHERE id=?').run(bcrypt.hashSync(req.body.password, 12), req.params.id);
  log(req.user, 'reset_password', 'user', req.params.id); res.json({ ok: true });
}));

// ==================== النسخ الاحتياطي والاستعادة (مشفرة AES-256-GCM — v1.9) ====================
const BACKUP_MAGIC = Buffer.from('BAYATENC1');
const encKey = () => crypto.createHash('sha256').update(JWT_SECRET).digest();
function encryptBuffer(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([BACKUP_MAGIC, iv, c.getAuthTag(), enc]);
}
function decryptBuffer(buf) {
  if (!buf.slice(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) return buf; // نسخ قديمة غير مشفرة
  const iv = buf.slice(9, 21), tag = buf.slice(21, 37), data = buf.slice(37);
  const d = crypto.createDecipheriv('aes-256-gcm', encKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]);
}
app.post('/api/backups', auth, perm('backup'), wrap((req, res) => {
  db.pragma('wal_checkpoint(TRUNCATE)');
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const name = `bayat-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.bayat`;
  const plain = fs.readFileSync(path.join(dataDir, 'bayat.sqlite'));
  const enc = encryptBuffer(plain);
  fs.writeFileSync(path.join(dir, name), enc);
  const size = enc.length;
  const i = db.prepare('INSERT INTO backups(filename,user_id,size) VALUES(?,?,?)').run(name, req.user.id, size);
  log(req.user, 'backup', 'database', i.lastInsertRowid, { name, encrypted: true });
  res.json({ id: i.lastInsertRowid, filename: name, size, encrypted: true });
}));
app.get('/api/backups', auth, perm('backup'), wrap((req, res) => res.json(db.prepare(`SELECT b.*,u.name user_name FROM backups b LEFT JOIN users u ON u.id=b.user_id ORDER BY b.id DESC`).all())));
app.post('/api/backups/:id/restore', auth, perm('restore'), wrap((req, res) => {
  const b = db.prepare('SELECT * FROM backups WHERE id=?').get(req.params.id);
  if (!b) throw Error('النسخة غير موجودة');
  const src = path.join(dataDir, 'backups', b.filename);
  if (!fs.existsSync(src)) throw Error('ملف النسخة غير موجود على القرص');
  if (!req.body.confirm) throw Error('يتطلب تأكيد الاستعادة');
  const raw = fs.readFileSync(src);
  const dec = decryptBuffer(raw); // تفك تشفير فورًا للتحقق من سلامة المفتاح، وتُخزن مفكوكة للتطبيق عند الإقلاع
  if (!dec.slice(0, 16).equals(Buffer.from('SQLite format 3\u0000'))) throw Error('ملف النسخة تالف أو المفتاح غير صحيح — لا يمكن الاستعادة');
  fs.writeFileSync(path.join(dataDir, 'restore-pending.sqlite'), dec);
  log(req.user, 'restore_backup', 'database', req.params.id, { filename: b.filename, encrypted: raw.slice(0, 9).equals(BACKUP_MAGIC) });
  res.json({ ok: true, restart_required: true, message: 'تم تجهيز النسخة للاستعادة — أغلق التطبيق وافتحه من جديد لتطبيقها' });
}));

app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
const HOST = process.env.HOST || '0.0.0.0';
const httpServer = app.listen(PORT, HOST, () => console.log(`Bayat local engine running on http://${HOST}:${PORT}`));
module.exports = { app, httpServer };
