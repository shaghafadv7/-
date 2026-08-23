const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// في نسخة سطح المكتب يحدد Electron مجلد البيانات بجانب ملف البرنامج.
// وفي وضع التطوير تبقى القاعدة داخل مجلد data في المشروع.
const dataDir = process.env.BAYAT_DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
// استعادة نسخة احتياطية معلّقة: تُطبق قبل فتح القاعدة عند الإقلاع التالي
const pendingRestore = path.join(dataDir, 'restore-pending.sqlite');
const dbFile = path.join(dataDir, 'bayat.sqlite');
if (fs.existsSync(pendingRestore)) {
  try {
    for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbFile + ext); } catch { } }
    fs.copyFileSync(pendingRestore, dbFile);
    fs.unlinkSync(pendingRestore);
    console.log('تمت استعادة النسخة الاحتياطية المعلّقة بنجاح');
  } catch (e) { console.error('فشل تطبيق الاستعادة:', e.message); }
}
const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'sales', active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  location TEXT, construction_status TEXT NOT NULL DEFAULT 'under_construction',
  sales_status TEXT NOT NULL DEFAULT 'available', progress INTEGER DEFAULT 0,
  start_date TEXT, expected_date TEXT, completed_date TEXT, notes TEXT,
  active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS floors (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  name TEXT NOT NULL, floor_order INTEGER NOT NULL, is_roof INTEGER DEFAULT 0,
  UNIQUE(project_id, floor_order)
);
CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  code TEXT NOT NULL, name TEXT, type TEXT DEFAULT 'apartment', rooms INTEGER NOT NULL DEFAULT 1,
  bathrooms INTEGER DEFAULT 1, area REAL, view TEXT, base_price REAL DEFAULT 0, description TEXT,
  active INTEGER DEFAULT 1, UNIQUE(project_id, code)
);
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  floor_id INTEGER NOT NULL REFERENCES floors(id) ON DELETE RESTRICT,
  model_id INTEGER REFERENCES models(id) ON DELETE SET NULL, unit_number TEXT NOT NULL,
  rooms INTEGER, bathrooms INTEGER, area REAL, view TEXT, price REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available', inventory_type TEXT DEFAULT 'company', notes TEXT,
  version INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, unit_number)
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL,
  email TEXT, national_id TEXT, source TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_units_search ON units(project_id, status, rooms, floor_id, price);
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, reservation_no TEXT UNIQUE NOT NULL,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  user_id INTEGER NOT NULL REFERENCES users(id), start_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL, deposit REAL DEFAULT 0, notes TEXT, status TEXT DEFAULT 'active',
  cancelled_at TEXT, cancel_reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_reservation ON reservations(unit_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_no TEXT UNIQUE NOT NULL,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  salesperson_id INTEGER REFERENCES users(id),
  sale_date TEXT NOT NULL,
  list_price REAL DEFAULT 0,
  final_price REAL NOT NULL,
  paid_amount REAL DEFAULT 0,
  remaining_amount REAL DEFAULT 0,
  contract_no TEXT,
  notes TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_sale_per_unit ON sales(unit_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL,
  entity_type TEXT NOT NULL, entity_id TEXT, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, user_id INTEGER,
  size INTEGER, status TEXT DEFAULT 'success', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS marketers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  phone TEXT, notes TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS unit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, title TEXT NOT NULL, details TEXT,
  user_id INTEGER, user_name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_unit_events ON unit_events(unit_id, id);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_no TEXT UNIQUE NOT NULL,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  amount REAL NOT NULL, pay_date TEXT NOT NULL,
  method TEXT DEFAULT 'cash', ref_no TEXT, notes TEXT,
  status TEXT DEFAULT 'active', cancelled_at TEXT, cancel_reason TEXT, cancelled_by INTEGER,
  created_by INTEGER REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments(sale_id, status);
-- ===== v1.8: الخصومات كبند مستقل =====
CREATE TABLE IF NOT EXISTS discounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discount_no TEXT UNIQUE NOT NULL,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  type TEXT NOT NULL DEFAULT 'amount',   -- amount / percent
  value REAL DEFAULT 0,                  -- القيمة الأصلية (نسبة أو مبلغ)
  amount REAL NOT NULL,                  -- القيمة المالية المحسوبة
  reason TEXT,                           -- سبب الخصم
  approved_by TEXT,                      -- من اعتمد الخصم
  discount_date TEXT,
  status TEXT DEFAULT 'active',
  cancelled_at TEXT, cancel_reason TEXT,
  created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_discounts_sale ON discounts(sale_id, status);
-- ===== v1.8: مصروفات الصفقة (لحساب صافي الربح) =====
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_no TEXT UNIQUE NOT NULL,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  amount REAL NOT NULL,
  expense_date TEXT,
  notes TEXT,
  status TEXT DEFAULT 'active',
  cancelled_at TEXT, cancel_reason TEXT,
  created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_expenses_sale ON expenses(sale_id, status);
CREATE TABLE IF NOT EXISTS commission_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cp_no TEXT UNIQUE NOT NULL,
  marketer_id INTEGER NOT NULL REFERENCES marketers(id) ON DELETE RESTRICT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  amount REAL NOT NULL, pay_date TEXT NOT NULL,
  method TEXT DEFAULT 'cash', ref_no TEXT, notes TEXT,
  status TEXT DEFAULT 'active', cancelled_at TEXT, cancel_reason TEXT,
  created_by INTEGER REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cp_marketer ON commission_payments(marketer_id, status);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT UNIQUE NOT NULL, filename TEXT NOT NULL, filepath TEXT NOT NULL,
  doc_type TEXT NOT NULL, title TEXT NOT NULL,
  project_id INTEGER, project_name TEXT, unit_id INTEGER, unit_number TEXT,
  customer_name TEXT, file_size INTEGER, pages INTEGER,
  created_by INTEGER, created_by_name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_documents_search ON documents(doc_type, project_id, created_at);
`);

// ===== الترقيات على الجداول القائمة (تعمل مع قواعد v1.0/v1.1 وقواعد جديدة) =====
function ensureColumns(table, cols) {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
  for (const [name, ddl] of Object.entries(cols)) {
    if (!have.has(name)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`).run();
  }
}
ensureColumns('users', {
  permissions: 'TEXT', // JSON للصلاحيات التفصيلية (فارغ = الأدوار الافتراضية)
});
ensureColumns('documents', {
  marketer_name: 'TEXT', // المسوق المرتبط بتقرير المسوقين
});
ensureColumns('sales', {
  prev_owner_name: 'TEXT',     // المالك السابق عند إعادة البيع
  purchase_price: 'REAL',      // سعر الشراء الأصلي (صفقة المالك السابق)
  purchase_date: 'TEXT',       // تاريخ الشراء الأصلي
  investor_name: 'TEXT',       // المستثمر
  purchase_cost: 'REAL',       // تكلفة الشراء للاستثمار (رأس المال)
  prev_sale_id: 'INTEGER',     // رابط صفقة الشراء السابقة (المالك السابق)
});
ensureColumns('units', {
  sell_phase: "TEXT DEFAULT 'off_plan'",   // مرحلة البيع: off_plan تحت الإنشاء / completed مكتمل
  owner_name: 'TEXT',                      // المالك أو المساهم الحالي
  seller_name: 'TEXT',                     // البائع/المساهم في حالة إعادة البيع
  prev_price: 'REAL',                      // السعر السابق قبل إعادة البيع
  resale_date: 'TEXT',                     // تاريخ عرض إعادة البيع
});
ensureColumns('sales', {
  base_price: 'REAL DEFAULT 0',            // السعر الأساسي قبل الخصم
  discount_type: "TEXT DEFAULT 'none'",    // none / amount / percent
  discount_value: 'REAL DEFAULT 0',
  discount_amount: 'REAL DEFAULT 0',       // قيمة الخصم المحسوبة
  sale_phase: "TEXT DEFAULT 'off_plan'",   // بيع تحت الإنشاء أو بعد الاكتمال
  payment_method: "TEXT DEFAULT 'cash'",   // cash / bank_transfer / check
  payment_ref: 'TEXT',                     // رقم الشيك أو الحوالة
  marketer_id: 'INTEGER REFERENCES marketers(id) ON DELETE SET NULL',
  commission_type: "TEXT DEFAULT 'none'",  // none / amount / percent
  commission_value: 'REAL DEFAULT 0',
  commission_total: 'REAL DEFAULT 0',
  commission_paid: 'REAL DEFAULT 0',
  commission_status: "TEXT DEFAULT 'none'",// none / unpaid / partial / paid / cancelled
  is_resale: 'INTEGER DEFAULT 0',          // عملية إعادة بيع
  seller_name: 'TEXT',                     // المالك البائع في إعادة البيع
});

const defaults = {
  company_name_ar: 'شركة بيات الأكنة للتطوير العقاري',
  company_name_en: 'BAYAT ALAKENA', primary_color: '#972B32', secondary_color: '#192E56',
  accent_color: '#B79552', logo_url: '', app_version: '1.8.0',
  // ===== بيانات الشركة المركزية (v1.4) =====
  site_name: 'بيات الأكنة',            // اسم الموقع / النظام — يُسحب مركزيًا في كل الواجهة والمستندات
  phone_main: '0543537870',             // الهاتف الرئيسي
  phone_extra: '0563056320',            // هاتف إضافي
  whatsapp: '0543537870',               // واتساب
  email: '',                            // البريد الإلكتروني
  address: '',                          // العنوان
  cr_number: '',                        // السجل التجاري
  tax_number: '',                       // الرقم الضريبي
  doc_footer_note: '',                  // بيانات إضافية تظهر في المستندات
  contact_phone: '0543537870 - 0563056320', contact_website: 'www.bayatalkenna.com',
  contact_instagram: '@bayatalakenna',
};
const putSetting = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
Object.entries(defaults).forEach(([k, v]) => putSetting.run(k, v));
db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('app_version','1.8.0',CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value='1.8.0',updated_at=CURRENT_TIMESTAMP`).run();
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  db.prepare(`INSERT INTO users(name,username,password_hash,role,must_change_password)
    VALUES (?,?,?,?,1)`).run('مدير النظام', 'admin', bcrypt.hashSync('Admin@103', 12), 'super_admin');
}
module.exports = db;
