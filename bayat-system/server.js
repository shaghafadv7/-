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
const db = require('./db');
const { buildDocument } = require('./lib/pdfdocs');

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
app.use(helmet({ contentSecurityPolicy: false })); app.use(cors()); app.use(express.json({ limit: '2mb' })); app.use(morgan('tiny'));
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
    ['view_reservations', 'عرض الحجوزات'], ['add_reservation', 'إضافة حجز'], ['edit_reservation', 'تعديل حجز'], ['cancel_reservation', 'إلغاء حجز']] },
  { key: 'sales', label: 'المبيعات', items: [
    ['view_sales', 'عرض المبيعات'], ['add_sale', 'إضافة عملية بيع'], ['edit_sale', 'تعديل عملية بيع'], ['cancel_sale', 'إلغاء عملية بيع'],
    ['view_prices', 'عرض الأسعار'], ['view_discounts', 'عرض الخصومات'], ['edit_discounts', 'تعديل الخصومات'],
    ['view_payments', 'عرض الدفعات'], ['add_payment', 'تسجيل دفعات']] },
  { key: 'customers', label: 'العملاء', items: [
    ['view_customers', 'عرض العملاء'], ['add_customer', 'إضافة عميل'], ['edit_customer', 'تعديل بيانات العميل'], ['delete_customer', 'حذف العميل']] },
  { key: 'marketers', label: 'المسوقون', items: [
    ['view_marketers', 'عرض المسوقين'], ['add_marketer', 'إضافة مسوق'], ['edit_marketer', 'تعديل مسوق'], ['disable_marketer', 'تعطيل مسوق'],
    ['view_marketer_sales', 'عرض مبيعات المسوقين'], ['view_commissions', 'عرض العمولات'], ['pay_commission', 'تسجيل دفعة للمسوق']] },
  { key: 'reports', label: 'التقارير', items: [
    ['view_sales_reports', 'عرض تقارير المبيعات'], ['view_financial_reports', 'عرض التقارير المالية'], ['view_marketer_reports', 'عرض تقارير المسوقين'],
    ['create_reports', 'إنشاء التقارير'], ['export_pdf', 'تصدير PDF'], ['print_reports', 'طباعة التقارير'], ['save_pdf', 'حفظ PDF']] },
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
  sales_manager: P('view_projects', 'view_units', 'view_reservations', 'add_reservation', 'edit_reservation', 'cancel_reservation',
    'view_sales', 'add_sale', 'view_prices', 'view_discounts', 'view_payments', 'view_customers', 'add_customer',
    'view_marketers', 'add_marketer', 'edit_marketer', 'disable_marketer', 'view_marketer_sales', 'view_commissions',
    'view_sales_reports', 'view_financial_reports', 'view_marketer_reports', 'create_reports', 'export_pdf', 'print_reports', 'save_pdf', 'manage_docs_archive'),
  accountant: P('view_projects', 'view_units', 'view_reservations', 'view_sales', 'add_sale', 'view_prices', 'view_discounts', 'view_payments', 'add_payment',
    'view_customers', 'view_marketers', 'view_marketer_sales', 'view_commissions', 'pay_commission',
    'view_sales_reports', 'view_financial_reports', 'view_marketer_reports', 'create_reports', 'export_pdf', 'print_reports', 'save_pdf'),
  reservations_officer: P('view_projects', 'view_units', 'view_reservations', 'add_reservation', 'edit_reservation', 'cancel_reservation',
    'view_sales', 'add_sale', 'view_prices', 'view_discounts', 'view_customers', 'add_customer', 'export_pdf', 'print_reports', 'save_pdf'),
  sales: P('view_projects', 'view_units', 'view_reservations', 'add_reservation', 'edit_reservation', 'cancel_reservation',
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
    const current = db.prepare('SELECT id,name,username,role,active,must_change_password,permissions FROM users WHERE id=?').get(payload.id);
    if (!current || !current.active) throw Error('inactive');
    const { perms, customized } = effectivePerms(current);
    // النطاق القديم: أدوار المبيعات/الحجوزات بدون تجاوب مخصص ترى مبيعاتها فقط (حفاظًا على السلوك السابق)
    const legacy = !customized && ['sales', 'reservations_officer'].includes(current.role);
    req.user = { id: current.id, name: current.name, username: current.username, role: current.role, mustChangePassword: !!current.must_change_password, perms, permsCustomized: customized, legacy };
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
function log(user, action, type, id, details = {}) { db.prepare('INSERT INTO activity_log(user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)').run(user?.id || null, action, type, String(id || ''), JSON.stringify(details)); }
function logUnitEvent(unitId, eventType, title, user, details = {}) {
  db.prepare('INSERT INTO unit_events(unit_id,event_type,title,details,user_id,user_name) VALUES (?,?,?,?,?,?)')
    .run(unitId, eventType, title, JSON.stringify(details), user?.id || null, user?.name || 'النظام');
}
const httpError = (msg, status = 403) => Object.assign(new Error(msg), { status });
const wrap = fn => (req, res) => { try { fn(req, res) } catch (e) { console.error(e); const msg = String(e.message).includes('UNIQUE') ? 'البيانات موجودة مسبقًا' : (String(e.message).includes('FOREIGN KEY') ? 'لا يمكن تنفيذ العملية لوجود بيانات مرتبطة' : e.message); res.status(e.status || 400).json({ error: msg }); } };
const nowDate = () => new Date().toISOString().slice(0, 10);

// ==================== حسابات مالية موحدة ====================
// ===== الحسابات المالية الموحدة (v1.8) =====
// العقد − الخصومات − المدفوعات = المتبقي (السالب = رصيد مستحق للعميل)
function saleDiscountsSum(saleId) {
  return db.prepare("SELECT COALESCE(SUM(amount),0) t FROM discounts WHERE sale_id=? AND status='active'").get(saleId).t;
}
function saleExpensesSum(saleId) {
  return db.prepare("SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE sale_id=? AND status='active'").get(saleId).t;
}
function recalcSale(saleId) {
  const s = db.prepare("SELECT * FROM sales WHERE id=?").get(saleId);
  if (!s) return;
  const base = s.base_price || s.list_price || 0;
  const discounts = s.status === 'cancelled' ? 0 : saleDiscountsSum(saleId);
  const final = Math.max(0, base - discounts);
  const paid = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE sale_id=? AND status='active'").get(saleId).t;
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
  const final = Math.max(0, base - discounts);
  const paid = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE sale_id=? AND status='active'").get(s.id).t;
  const remaining = final - paid;
  const expenses = saleExpensesSum(s.id);
  const commission = s.commission_total || 0;
  const purchaseCost = s.purchase_cost ?? s.purchase_price ?? 0;
  const grossProfit = final - purchaseCost;
  const netProfit = grossProfit - expenses - commission;
  const pct = v => purchaseCost > 0 ? Math.round(v / purchaseCost * 10000) / 100 : null;
  return {
    base, discounts, final, paid, remaining,
    client_state: remaining > 0.001 ? 'due_from_client' : (remaining < -0.001 ? 'due_to_client' : 'settled'),
    client_due: remaining > 0 ? remaining : 0,          // مستحق على العميل
    client_credit: remaining < 0 ? -remaining : 0,      // مستحق للعميل
    purchase_cost: purchaseCost,
    resale_price: s.is_resale ? final : null,
    expenses, commission,
    gross_profit: grossProfit,
    gross_profit_pct: pct(grossProfit),
    net_profit: netProfit,
    net_profit_pct: pct(netProfit),
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
  const token = jwt.sign(user, JWT_SECRET, { expiresIn: '10h' });
  log(user, 'login', 'session', u.id);
  res.json({ token, user });
}));
app.get('/api/me', auth, wrap((req, res) => {
  const row = db.prepare('SELECT id,name,username,role,must_change_password,permissions FROM users WHERE id=?').get(req.user.id);
  res.json(safeUser(row));
}));
app.post('/api/change-password', auth, wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(req.body.currentPassword || '', u.password_hash)) return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
  if (String(req.body.newPassword || '').length < 8) return res.status(400).json({ error: 'كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف' });
  db.prepare('UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?').run(bcrypt.hashSync(req.body.newPassword, 12), u.id);
  log(req.user, 'change_password', 'user', u.id); res.json({ ok: true });
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
    out.finance = {
      sales_count: db.prepare("SELECT COUNT(*) n FROM sales WHERE status='active'").get().n,
      final_total: db.prepare("SELECT COALESCE(SUM(final_price),0) t FROM sales WHERE status='active'").get().t,
      paid_total: db.prepare("SELECT COALESCE(SUM(paid_amount),0) t FROM sales WHERE status='active'").get().t,
      remaining_total: db.prepare("SELECT COALESCE(SUM(remaining_amount),0) t FROM sales WHERE status='active'").get().t,
      commission_due: db.prepare("SELECT COALESCE(SUM(commission_total),0) t FROM sales WHERE status='active' AND commission_status IN ('unpaid','partial')").get().t,
      commission_remaining: db.prepare("SELECT COALESCE(SUM(commission_total-commission_paid),0) t FROM sales WHERE status='active' AND commission_status IN ('unpaid','partial')").get().t,
      commission_paid: db.prepare("SELECT COALESCE(SUM(commission_paid),0) t FROM sales WHERE status='active'").get().t,
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

function unitsQuery(q) {
  const where = ['p.active=1'], p = [];
  if (q.project_id) { where.push('u.project_id=?'); p.push(+q.project_id); }
  if (q.floor_id) { where.push('u.floor_id=?'); p.push(+q.floor_id); }
  if (q.model_id) { where.push('u.model_id=?'); p.push(+q.model_id); }
  if (q.status) { where.push(`u.status IN (${String(q.status).split(',').map(s => `'` + String(s).replace(/'/g, '') + `'`).join(',')})`); }
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
      if (hasPerm(req.user, 'view_payments')) u.payments = db.prepare("SELECT * FROM payments WHERE sale_id=? AND status='active' ORDER BY pay_date,id").all(u.sale.id);
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

// ==================== الحجوزات ====================
app.post('/api/reservations', auth, perm('add_reservation'), wrap((req, res) => {
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
    const no = 'RSV-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-7);
    const i = db.prepare(`INSERT INTO reservations(reservation_no,unit_id,customer_id,user_id,expires_at,deposit,notes) VALUES(?,?,?,?,?,?,?)`).run(no, b.unit_id, cid, req.user.id, b.expires_at, +b.deposit || 0, b.notes || '');
    const ch = db.prepare(`UPDATE units SET status='reserved',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('available','resale')`).run(b.unit_id);
    if (ch.changes !== 1) throw Error('تم حجز الوحدة بواسطة مستخدم آخر');
    logUnitEvent(b.unit_id, 'reserved', `حجز الوحدة للعميل ${cust?.name || ''} حتى ${String(b.expires_at).slice(0, 10)}${(+b.deposit || 0) > 0 ? ` بعربون ${(+b.deposit).toLocaleString('en-US')}` : ''}`, req.user, { reservation_no: no, customer: cust?.name, deposit: +b.deposit || 0 });
    log(req.user, 'reserve', 'unit', b.unit_id, { reservation_no: no, customer_id: cid });
    return { id: i.lastInsertRowid, reservation_no: no };
  });
  res.json(tx());
}));
app.get('/api/reservations', auth, perm('view_reservations'), wrap((req, res) => {
  const full = hasPerm(req.user, 'view_customers');
  const sql = `SELECT r.*,u.unit_number,p.name project_name,c.name customer_name,c.phone customer_phone,us.name employee_name FROM reservations r JOIN units u ON u.id=r.unit_id JOIN projects p ON p.id=u.project_id JOIN customers c ON c.id=r.customer_id JOIN users us ON us.id=r.user_id ${full ? '' : 'WHERE r.user_id=?'} ORDER BY r.id DESC LIMIT 300`;
  const rows = full ? db.prepare(sql).all() : db.prepare(sql).all(req.user.id);
  if (!full) rows.forEach(x => { x.customer_name = 'عميل الحجز'; x.customer_phone = maskPhone(x.customer_phone); delete x.notes; });
  res.json(rows);
}));
app.put('/api/reservations/:id', auth, perm('edit_reservation'), wrap((req, res) => {
  const r = db.prepare("SELECT * FROM reservations WHERE id=? AND status='active'").get(req.params.id);
  if (!r) throw Error('الحجز غير نشط');
  if (req.user.legacy && req.user.role === 'sales' && r.user_id !== req.user.id) throw Error('لا يمكنك تعديل حجز مستخدم آخر');
  const b = req.body;
  db.prepare('UPDATE reservations SET expires_at=COALESCE(?,expires_at),deposit=COALESCE(?,deposit),notes=COALESCE(?,notes) WHERE id=?')
    .run(b.expires_at || null, b.deposit != null ? +b.deposit : null, b.notes != null ? b.notes : null, req.params.id);
  logUnitEvent(r.unit_id, 'reservation_updated', `تعديل بيانات الحجز ${r.reservation_no}`, req.user, { reservation_id: r.id });
  log(req.user, 'update_reservation', 'reservation', req.params.id, b);
  res.json({ ok: true });
}));
app.post('/api/reservations/:id/cancel', auth, perm('cancel_reservation'), wrap((req, res) => {
  const tx = db.transaction(() => {
    const r = db.prepare(`SELECT * FROM reservations WHERE id=? AND status='active'`).get(req.params.id);
    if (!r) throw Error('الحجز غير نشط');
    if (req.user.legacy && req.user.role === 'sales' && r.user_id !== req.user.id) throw Error('لا يمكنك إلغاء حجز مستخدم آخر');
    db.prepare(`UPDATE reservations SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancel_reason=? WHERE id=?`).run(req.body.reason || '', r.id);
    db.prepare(`UPDATE units SET status='available',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='reserved'`).run(r.unit_id);
    logUnitEvent(r.unit_id, 'reservation_cancelled', `إلغاء الحجز ${r.reservation_no}${req.body.reason ? ' — السبب: ' + req.body.reason : ''}`, req.user, { reservation_id: r.id, reason: req.body.reason });
    log(req.user, 'cancel_reservation', 'unit', r.unit_id, { reservation_id: r.id, reason: req.body.reason });
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

app.post('/api/sales', auth, perm('add_sale'), wrap((req, res) => {
  const b = req.body;
  const result = db.transaction(() => {
    const u = db.prepare('SELECT * FROM units WHERE id=?').get(b.unit_id);
    if (!u) throw Error('الوحدة غير موجودة');
    if (u.status === 'sold' || u.status === 'paid' || db.prepare("SELECT 1 FROM sales WHERE unit_id=? AND status='active'").get(u.id)) throw Error('الوحدة مباعة مسبقًا');
    if (!['available', 'reserved', 'contracted', 'resale'].includes(u.status)) throw Error('حالة الوحدة لا تسمح بتسجيل البيع');
    const isResale = u.status === 'resale';
    let customerId = b.customer_id;
    const activeReservation = db.prepare("SELECT * FROM reservations WHERE unit_id=? AND status='active'").get(u.id);
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
    const paid = Math.max(0, +b.paid_amount || 0);
    if (paid > finalPrice) throw Error('المبلغ المدفوع لا يمكن أن يتجاوز السعر النهائي');
    const method = ['cash', 'bank_transfer', 'check'].includes(b.payment_method) ? b.payment_method : 'cash';
    if ((method === 'check' || method === 'bank_transfer') && !b.payment_ref) throw Error(method === 'check' ? 'رقم الشيك مطلوب' : 'رقم الحوالة أو مرجع العملية مطلوب');
    let marketer = null;
    if (b.marketer_id) {
      marketer = db.prepare('SELECT * FROM marketers WHERE id=? AND active=1').get(b.marketer_id);
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
      .run(no, u.id, customerId, req.user.id, b.salesperson_id || req.user.id, b.sale_date || nowDate(), u.price, finalPrice, 0, finalPrice, b.contract_no || '', b.notes || '', base, dType, dValue, discountAmount, salePhase, method, b.payment_ref || '', marketer?.id || null, cType, cValue, cTotal, 0, cTotal > 0 ? 'unpaid' : 'none', isResale ? 1 : 0, isResale ? (u.seller_name || u.owner_name || '') : '', prevOwnerName, purchasePrice, purchaseDate, investorName, purchaseCost, prevSaleId);
    if (activeReservation) db.prepare("UPDATE reservations SET status='converted' WHERE id=?").run(activeReservation.id);
    if (discountAmount > 0) {
      const dno = 'DSC-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-7);
      db.prepare(`INSERT INTO discounts(discount_no,sale_id,type,value,amount,reason,approved_by,discount_date,created_by) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(dno, i.lastInsertRowid, dType, dValue, discountAmount, b.discount_reason || 'خصم عند تسجيل البيع', b.discount_approved_by || req.user.name, b.sale_date || nowDate(), req.user.id);
    }
    if (paid > 0) {
      const pno = 'PAY-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-7);
      db.prepare(`INSERT INTO payments(payment_no,sale_id,amount,pay_date,method,ref_no,notes,created_by) VALUES(?,?,?,?,?,?,?,?)`).run(pno, i.lastInsertRowid, paid, b.sale_date || nowDate(), method, b.payment_ref || '', 'دفعة افتتاحية عند تسجيل البيع', req.user.id);
    }
    recalcSale(i.lastInsertRowid);
    db.prepare(`UPDATE units SET status=?,owner_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(paid >= finalPrice ? 'paid' : 'sold', cust?.name || '', u.id);
    logUnitEvent(u.id, 'sold', `${isResale ? 'إعادة بيع الوحدة' : 'بيع الوحدة'} للعميل ${cust?.name || ''} بسعر نهائي ${finalPrice.toLocaleString('en-US')}${discountAmount > 0 ? ` (خصم ${discountAmount.toLocaleString('en-US')})` : ''} — رقم البيع ${no}${isResale && prevOwnerName ? ` — المالك السابق: ${prevOwnerName} (شراء: ${(purchasePrice || 0).toLocaleString('en-US')}${purchaseDate ? ' بتاريخ ' + purchaseDate : ''})` : ''}`, req.user, { sale_no: no, final_price: finalPrice, discount: discountAmount, paid, prev_owner: prevOwnerName, purchase_price: purchasePrice, purchase_date: purchaseDate });
    if (marketer && cTotal > 0) logUnitEvent(u.id, 'commission', `ربط المسوق ${marketer.name} بعمولة ${cTotal.toLocaleString('en-US')}`, req.user, { marketer: marketer.name, commission: cTotal });
    log(req.user, 'create_sale', 'unit', u.id, { sale_id: i.lastInsertRowid, sale_no: no, final_price: finalPrice, discount: discountAmount, marketer: marketer?.name || null, commission: cTotal, is_resale: isResale });
    return { id: i.lastInsertRowid, sale_no: no, final_price: finalPrice, discount_amount: discountAmount };
  })();
  res.json(result);
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
app.post('/api/sales/:id/payments', auth, perm('add_payment'), wrap((req, res) => {
  const tx = db.transaction(() => {
    const s = db.prepare("SELECT s.*,c.name customer_name FROM sales s JOIN customers c ON c.id=s.customer_id WHERE s.id=? AND s.status IN ('active','resold')").get(req.params.id);
    if (!s) throw Error('البيع غير نشط');
    const amount = +req.body.amount;
    if (!(amount > 0)) throw Error('مبلغ الدفعة مطلوب');
    const method = ['cash', 'bank_transfer', 'check'].includes(req.body.method) ? req.body.method : 'cash';
    if ((method === 'check' || method === 'bank_transfer') && !req.body.ref_no) throw Error(method === 'check' ? 'رقم الشيك مطلوب' : 'رقم الحوالة مطلوب');
    // الدفع الزائد مسموح وينتج رصيدًا مستحقًا للعميل (يظهر في اللوحة المالية)
    const no = 'PAY-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-7);
    db.prepare(`INSERT INTO payments(payment_no,sale_id,amount,pay_date,method,ref_no,notes,created_by) VALUES(?,?,?,?,?,?,?,?)`)
      .run(no, s.id, amount, req.body.pay_date || nowDate(), method, req.body.ref_no || '', req.body.notes || '', req.user.id);
    recalcSale(s.id);
    const after = db.prepare('SELECT paid_amount,remaining_amount FROM sales WHERE id=?').get(s.id);
    logUnitEvent(s.unit_id, 'payment', `تسجيل دفعة ${amount.toLocaleString('en-US')} (${{ cash: 'كاش', bank_transfer: 'حوالة بنكية', check: 'شيك' }[method]}) على البيع ${s.sale_no} — المدفوع الآن ${after.paid_amount.toLocaleString('en-US')} والمتبقي ${after.remaining_amount.toLocaleString('en-US')}`, req.user, { amount, sale_no: s.sale_no });
    log(req.user, 'payment', 'sale', s.id, { payment_no: no, amount });
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
  });
  tx(); res.json({ ok: true });
}));

// ==================== المسوقون والعمولات ====================
const MARKETER_STATS = `SELECT mk.*,
 (SELECT COUNT(*) FROM sales s WHERE s.marketer_id=mk.id AND s.status!='cancelled') units_count,
 (SELECT COALESCE(SUM(s.final_price),0) FROM sales s WHERE s.marketer_id=mk.id AND s.status!='cancelled') sales_total,
 (SELECT COALESCE(SUM(s.commission_total),0) FROM sales s WHERE s.marketer_id=mk.id AND s.status='active') commission_total,
 (SELECT COALESCE(SUM(s.commission_paid),0) FROM sales s WHERE s.marketer_id=mk.id AND s.status='active') commission_paid
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

app.get('/api/commissions', auth, perm('view_commissions'), wrap((req, res) => {
  const q = req.query; const where = ["s.marketer_id IS NOT NULL"], p = [];
  if (q.status) { where.push('s.commission_status=?'); p.push(q.status); } else { where.push("s.status='active'"); }
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
    const s = db.prepare("SELECT s.*,mk.name marketer_name FROM sales s LEFT JOIN marketers mk ON mk.id=s.marketer_id WHERE s.id=? AND s.status='active'").get(req.params.id);
    if (!s) throw Error('الصفقة غير نشطة');
    if (!s.marketer_id || !(s.commission_total > 0)) throw Error('لا توجد عمولة مسجلة على هذه الصفقة');
    const amount = +req.body.amount;
    if (!(amount > 0)) throw Error('مبلغ الدفعة مطلوب');
    const due = s.commission_total - s.commission_paid;
    if (amount > due) throw Error(`المبلغ يتجاوز المتبقي للمسوق (${due.toLocaleString('en-US')})`);
    const method = ['cash', 'bank_transfer', 'check'].includes(req.body.method) ? req.body.method : 'cash';
    const no = 'CMP-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-7);
    db.prepare(`INSERT INTO commission_payments(cp_no,marketer_id,sale_id,amount,pay_date,method,ref_no,notes,created_by) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(no, s.marketer_id, s.id, amount, req.body.pay_date || nowDate(), method, req.body.ref_no || '', req.body.notes || '', req.user.id);
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
  const where = ["s.marketer_id IS NOT NULL", "s.status='active'"], p = [];
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
    m.commission_total += r.sale_status === 'active' ? (r.commission_total || 0) : 0;
    m.commission_paid += r.sale_status === 'active' ? (r.commission_paid || 0) : 0;
    if (r.sale_status === 'active') m.statuses.add(r.commission_status);
    summaryMap.set(r.marketer_id, m);
  });
  const summary = [...summaryMap.values()].map(m => {
    const st = m.statuses.has('unpaid') ? 'unpaid' : m.statuses.has('partial') ? 'partial' : m.statuses.has('paid') ? 'paid' : m.statuses.has('cancelled') ? 'cancelled' : 'none';
    return { ...m, commission_due: Math.max(0, m.commission_total - m.commission_paid), commission_status: st, statuses: undefined };
  });
  const totals = rows.reduce((a, r) => ({ ops: a.ops + 1, sales_total: a.sales_total + r.final_price, commission_total: a.commission_total + (r.sale_status === 'active' ? (r.commission_total || 0) : 0), commission_paid: a.commission_paid + (r.sale_status === 'active' ? (r.commission_paid || 0) : 0) }), { ops: 0, sales_total: 0, commission_total: 0, commission_paid: 0 });
  totals.commission_due = Math.max(0, totals.commission_total - totals.commission_paid);
  const period = q.date_from || q.date_to ? `${q.date_from || 'البداية'} ← ${q.date_to || 'اليوم'}` : 'كل الفترات';
  return { rows, summary, totals, period, marketer_name: q.marketer_id ? (summary[0]?.marketer_name || '') : null, marketer_phone: q.marketer_id ? (summary[0]?.phone || '') : null };
}
function financialReportData(q = {}) {
  const where = ["s.status!='cancelled'"], p = [];
  if (q.date_from) { where.push('s.sale_date>=?'); p.push(q.date_from); }
  if (q.date_to) { where.push('s.sale_date<=?'); p.push(q.date_to); }
  const sales = db.prepare(`SELECT s.*,strftime('%Y-%m',s.sale_date) ym FROM sales s WHERE ${where.join(' AND ')}`).all(...p);
  const payWhere = ["py.status='active'"], pp = [];
  if (q.date_from) { payWhere.push('py.pay_date>=?'); pp.push(q.date_from); }
  if (q.date_to) { payWhere.push('py.pay_date<=?'); pp.push(q.date_to); }
  const payments = db.prepare(`SELECT py.amount,strftime('%Y-%m',py.pay_date) ym FROM payments py WHERE ${payWhere.join(' AND ')}`).all(...pp);
  const cpsWhere = ["cp.status='active'"], cpp = [];
  if (q.date_from) { cpsWhere.push('cp.pay_date>=?'); cpp.push(q.date_from); }
  if (q.date_to) { cpsWhere.push('cp.pay_date<=?'); cpp.push(q.date_to); }
  const cps = db.prepare(`SELECT cp.amount,strftime('%Y-%m',cp.pay_date) ym FROM commission_payments cp WHERE ${cpsWhere.join(' AND ')}`).all(...cpp);
  const summary = {
    final_total: sales.reduce((a, s) => a + s.final_price, 0),
    discount_total: sales.reduce((a, s) => a + (s.discount_amount || 0), 0),
    paid_total: sales.reduce((a, s) => a + s.paid_amount, 0),
    remaining_total: sales.reduce((a, s) => a + s.remaining_amount, 0),
    commission_due: sales.filter(s => s.status === 'active').reduce((a, s) => a + (s.commission_total || 0), 0),
    commission_paid: sales.filter(s => s.status === 'active').reduce((a, s) => a + (s.commission_paid || 0), 0),
    marketers_count: db.prepare('SELECT COUNT(*) n FROM marketers WHERE active=1').get().n,
    sold_units: db.prepare("SELECT COUNT(*) n FROM units WHERE status IN ('sold','paid')").get().n,
    available_units: db.prepare("SELECT COUNT(*) n FROM units WHERE status IN ('available','resale')").get().n,
  };
  const months = {};
  const M = () => ({ month: '', sales_count: 0, final_total: 0, discount_total: 0, paid_total: 0, commission_total: 0, marketer_paid: 0 });
  sales.forEach(s => { const m = months[s.ym] ||= { ...M(), month: s.ym }; m.sales_count++; m.final_total += s.final_price; m.discount_total += s.discount_amount || 0; m.paid_total += s.paid_amount; if (s.status === 'active') m.commission_total += s.commission_total || 0; });
  payments.forEach(x => { const m = months[x.ym] ||= { ...M(), month: x.ym }; m.paid_total += x.amount; });
  cps.forEach(x => { const m = months[x.ym] ||= { ...M(), month: x.ym }; m.marketer_paid += x.amount; });
  return { summary, months: Object.values(months).sort((a, b) => b.month.localeCompare(a.month)) };
}
app.get('/api/reports/sales', auth, perm('view_sales_reports', 'create_reports'), wrap((req, res) => res.json(salesReportData(req.query))));
app.get('/api/reports/payments', auth, perm('view_payments', 'create_reports'), wrap((req, res) => res.json(paymentsReportData(req.query))));
app.get('/api/reports/commissions', auth, perm('view_commissions', 'create_reports'), wrap((req, res) => res.json(commissionsReportData(req.query))));
app.get('/api/reports/financial', auth, perm('view_financial_reports', 'create_reports'), wrap((req, res) => res.json(financialReportData(req.query))));
app.get('/api/reports/marketers', auth, perm('view_marketer_reports', 'create_reports'), wrap((req, res) => res.json(marketersReportData(req.query))));

// ==================== المستندات PDF والأرشيف ====================
const DOC_PERMS = {
  search_results: u => hasPerm(u, 'export_pdf'),
  unit_offer: u => hasPerm(u, 'export_pdf'),
  reservation: u => hasPerm(u, 'export_pdf') && (hasPerm(u, 'view_reservations') || hasPerm(u, 'view_sales')),
  sale: u => hasPerm(u, 'export_pdf') && hasPerm(u, 'view_sales') && hasPerm(u, 'view_prices'),
  sales_report: u => hasPerm(u, 'export_pdf') && hasPerm(u, 'view_sales_reports'),
  payments_report: u => hasPerm(u, 'export_pdf') && hasPerm(u, 'view_payments'),
  commissions_report: u => hasPerm(u, 'export_pdf') && hasPerm(u, 'view_commissions'),
  marketers_report: u => hasPerm(u, 'export_pdf') && hasPerm(u, 'view_marketers'),
  marketer_report: u => hasPerm(u, 'export_pdf') && hasPerm(u, 'view_marketer_reports'),
  financial_report: u => hasPerm(u, 'export_pdf') && hasPerm(u, 'view_financial_reports'),
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
  if (type === 'sale') {
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
    return { data: { sale: s, unit, customer, payments, finance: fin, discounts, expenses, prevSale }, filenameParts: [s.sale_no], subtitle: `${s.sale_no} — ${customer?.name || ''}` };
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
      if (type === 'sale' && data.sale) { unitId = data.sale.unit_id; unitNumber = data.unit?.unit_number || null; customerName = data.customer?.name || null; projectName = data.unit?.project_name || null; }
      if (type === 'marketer_report' && params.project_id) projectName = db.prepare('SELECT name FROM projects WHERE id=?').get(+params.project_id)?.name || null;
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
  if (q.q) { where.push('(d.filename LIKE ? OR d.title LIKE ? OR d.doc_no LIKE ? OR COALESCE(d.customer_name,"") LIKE ? OR COALESCE(d.unit_number,"") LIKE ? OR COALESCE(d.project_name,"") LIKE ? OR COALESCE(d.marketer_name,"") LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  if (hasPerm(req.user, 'manage_docs_archive')) {
    // يرى كل المستندات
  } else if (req.user.role === 'accountant' && !req.user.permsCustomized) {
    where.push(`(d.created_by=? OR d.doc_type IN ('payments_report','commissions_report','financial_report','sales_report','marketers_report','marketer_report','sale'))`); p.push(req.user.id);
  } else {
    where.push('d.created_by=?'); p.push(req.user.id);
  }
  res.json(db.prepare(`SELECT d.id,d.doc_no,d.filename,d.doc_type,d.title,d.project_name,d.unit_number,d.customer_name,d.marketer_name,d.file_size,d.pages,d.created_by_name,d.created_at FROM documents d WHERE ${where.join(' AND ')} ORDER BY d.id DESC LIMIT 300`).all(...p));
}));
function docAccess(req) {
  const d = db.prepare('SELECT * FROM documents WHERE id=?').get(req.params.id);
  if (!d) return { err: 404 };
  const u = req.user;
  const isFin = ['payments_report', 'commissions_report', 'financial_report', 'sales_report', 'marketers_report', 'marketer_report', 'sale'].includes(d.doc_type);
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
  });
  tx(); res.json({ ok: true });
}));

app.put('/api/sales/:id/investor', auth, perm('edit_sale'), wrap((req, res) => {
  const s = db.prepare('SELECT * FROM sales WHERE id=?').get(req.params.id);
  if (!s) throw Error('الصفقة غير موجودة');
  const b = req.body;
  db.prepare('UPDATE sales SET investor_name=COALESCE(?,investor_name),purchase_cost=COALESCE(?,purchase_cost) WHERE id=?')
    .run(b.investor_name || null, b.purchase_cost != null ? +b.purchase_cost : null, req.params.id);
  const f = saleFinance(db.prepare('SELECT * FROM sales WHERE id=?').get(s.id));
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
  db.prepare('UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?').run(bcrypt.hashSync(req.body.password, 12), req.params.id);
  log(req.user, 'reset_password', 'user', req.params.id); res.json({ ok: true });
}));

// ==================== النسخ الاحتياطي والاستعادة ====================
app.post('/api/backups', auth, perm('backup'), wrap((req, res) => {
  db.pragma('wal_checkpoint(TRUNCATE)');
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const name = `bayat-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
  fs.copyFileSync(path.join(dataDir, 'bayat.sqlite'), path.join(dir, name));
  const size = fs.statSync(path.join(dir, name)).size;
  const i = db.prepare('INSERT INTO backups(filename,user_id,size) VALUES(?,?,?)').run(name, req.user.id, size);
  log(req.user, 'backup', 'database', i.lastInsertRowid, { name }); res.json({ id: i.lastInsertRowid, filename: name, size });
}));
app.get('/api/backups', auth, perm('backup'), wrap((req, res) => res.json(db.prepare(`SELECT b.*,u.name user_name FROM backups b LEFT JOIN users u ON u.id=b.user_id ORDER BY b.id DESC`).all())));
app.post('/api/backups/:id/restore', auth, perm('restore'), wrap((req, res) => {
  const b = db.prepare('SELECT * FROM backups WHERE id=?').get(req.params.id);
  if (!b) throw Error('النسخة غير موجودة');
  const src = path.join(dataDir, 'backups', b.filename);
  if (!fs.existsSync(src)) throw Error('ملف النسخة غير موجود على القرص');
  if (!req.body.confirm) throw Error('يتطلب تأكيد الاستعادة');
  // تُطبَّق الاستعادة عند الإقلاع التالي (بعد إغلاق التطبيق) لضمان سلامة القاعدة
  fs.copyFileSync(src, path.join(dataDir, 'restore-pending.sqlite'));
  log(req.user, 'restore_backup', 'database', req.params.id, { filename: b.filename });
  res.json({ ok: true, restart_required: true, message: 'تم تجهيز النسخة للاستعادة — أغلق التطبيق وافتحه من جديد لتطبيقها' });
}));

app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
const httpServer = app.listen(PORT, '127.0.0.1', () => console.log(`Bayat local engine running on http://127.0.0.1:${PORT}`));
module.exports = { app, httpServer };
