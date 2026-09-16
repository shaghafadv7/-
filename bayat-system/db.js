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
-- ===== v1.9: تقارير وتصفية مستحقات إعادة البيع =====
CREATE TABLE IF NOT EXISTS settlement_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_no TEXT UNIQUE NOT NULL,
  resale_sale_id INTEGER UNIQUE NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'open',
  snapshot TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_settlement_reports_no ON settlement_reports(report_no);
CREATE TABLE IF NOT EXISTS settlement_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES settlement_reports(id) ON DELETE CASCADE,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  party_type TEXT NOT NULL,
  party_id INTEGER,
  party_name TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'receivable',
  gross_amount REAL NOT NULL DEFAULT 0,
  deductions REAL NOT NULL DEFAULT 0,
  net_amount REAL NOT NULL DEFAULT 0,
  source_paid REAL NOT NULL DEFAULT 0,
  settled_amount REAL NOT NULL DEFAULT 0,
  remaining_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid',
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(report_id, party_type)
);
CREATE INDEX IF NOT EXISTS idx_settlement_entries_report ON settlement_entries(report_id, party_type);
CREATE TABLE IF NOT EXISTS settlement_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_no TEXT UNIQUE NOT NULL,
  report_id INTEGER NOT NULL REFERENCES settlement_reports(id) ON DELETE RESTRICT,
  entry_id INTEGER NOT NULL REFERENCES settlement_entries(id) ON DELETE RESTRICT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  amount REAL NOT NULL,
  transaction_date TEXT NOT NULL,
  method TEXT DEFAULT 'cash',
  ref_no TEXT,
  notes TEXT,
  source_type TEXT DEFAULT 'settlement',
  source_id INTEGER,
  status TEXT DEFAULT 'active',
  cancelled_at TEXT,
  cancel_reason TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_settlement_transactions_report ON settlement_transactions(report_id, status);
-- ===== v2.0: التصفية الإجمالية للمسوق والتدقيق المالي =====
CREATE TABLE IF NOT EXISTS marketer_settlement_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  settlement_no TEXT UNIQUE NOT NULL,
  marketer_id INTEGER NOT NULL REFERENCES marketers(id) ON DELETE RESTRICT,
  total_amount REAL NOT NULL DEFAULT 0,
  settlement_date TEXT NOT NULL,
  method TEXT DEFAULT 'cash', ref_no TEXT, notes TEXT,
  status TEXT DEFAULT 'active', cancelled_at TEXT, cancel_reason TEXT,
  created_by INTEGER REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS marketer_settlement_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES marketer_settlement_batches(id) ON DELETE RESTRICT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  commission_payment_id INTEGER NOT NULL REFERENCES commission_payments(id) ON DELETE RESTRICT,
  amount REAL NOT NULL,
  status TEXT DEFAULT 'active', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_marketer_settlement_sale ON marketer_settlement_items(sale_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_marketer_settlement_batch ON marketer_settlement_items(batch_id,status);
CREATE TABLE IF NOT EXISTS financial_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id), action TEXT NOT NULL,
  entity_type TEXT NOT NULL, entity_id INTEGER, sale_id INTEGER,
  old_values TEXT, new_values TEXT, reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_financial_audit_sale ON financial_audit(sale_id,id);
CREATE TABLE IF NOT EXISTS financial_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adjustment_no TEXT UNIQUE NOT NULL,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  invoice_no TEXT,
  adjustment_type TEXT NOT NULL,
  amount REAL NOT NULL,
  adjustment_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  method TEXT DEFAULT 'cash', ref_no TEXT,
  source_payment_id INTEGER REFERENCES payments(id),
  status TEXT DEFAULT 'active', cancelled_at TEXT, cancel_reason TEXT,
  created_by INTEGER REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_financial_adjustments_sale ON financial_adjustments(sale_id,status);
-- ===== v1.9: دفعات الحجز (العربون) — دفعة أولى من قيمة البيع =====
CREATE TABLE IF NOT EXISTS reservation_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_no TEXT UNIQUE NOT NULL,          -- رقم القيد المالي الفريد (RPY-سنة-رقم)
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  amount REAL NOT NULL,
  pay_date TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',      -- cash / bank_transfer / check
  ref_no TEXT,                              -- رقم التحويل البنكي أو رقم الشيك
  check_date TEXT,                          -- تاريخ الشيك
  check_status TEXT DEFAULT 'pending',      -- pending / cleared / bounced
  check_due_date TEXT,                      -- تاريخ استحقاق الشيك
  bank TEXT,                                -- البنك
  received_by TEXT,                         -- الحساب أو الجهة المستلمة
  receipt_no TEXT,                          -- رقم سند القبض
  sale_id INTEGER REFERENCES sales(id),     -- يُربط بعملية البيع عند تحويل الحجز
  status TEXT NOT NULL DEFAULT 'active',    -- active / transferred / linked_to_sale / cancelled / refunded
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TEXT, cancel_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_rp_reservation ON reservation_payments(reservation_id, status);
CREATE INDEX IF NOT EXISTS idx_rp_sale ON reservation_payments(sale_id, status);
CREATE INDEX IF NOT EXISTS idx_rp_unit ON reservation_payments(unit_id, status);
-- منع ربط دفعة الحجز الواحدة بأكثر من عملية بيع
CREATE UNIQUE INDEX IF NOT EXISTS one_rp_sale_link ON reservation_payments(sale_id) WHERE sale_id IS NOT NULL AND status IN ('transferred','linked_to_sale');
-- ===== v1.10: سجل إلغاء الحجوزات والاستردادات (لا يُحذف أي سجل أصلي) =====
CREATE TABLE IF NOT EXISTS reservation_cancellations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_no TEXT UNIQUE,                      -- رقم عملية الاسترداد (RFD-سنة-رقم) عند وجود استرداد
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,                       -- سبب الإلغاء (نص)
  cancel_reason_code TEXT DEFAULT 'other',    -- customer_request / incomplete_payment / expired / unit_change / booking_error / other
  cancelled_at TEXT DEFAULT CURRENT_TIMESTAMP,
  cancelled_by INTEGER REFERENCES users(id),
  total_paid REAL DEFAULT 0,                  -- إجمالي المبلغ المدفوع للحجز قبل الإلغاء
  amount_returned INTEGER DEFAULT 0,          -- هل أُعيد المبلغ للعميل؟
  refund_amount REAL DEFAULT 0,               -- قيمة المبلغ المرتجع
  deducted_amount REAL DEFAULT 0,             -- قيمة المبلغ المخصوم
  deduction_reason TEXT,                      -- سبب الخصم
  refund_method TEXT,                         -- cash / bank_transfer / check
  refund_ref_no TEXT,                         -- رقم العملية المرجعي للاسترداد
  refund_date TEXT,                           -- تاريخ الاسترداد
  refund_account TEXT,                        -- الحساب أو الخزينة التي صُرف منها
  notes TEXT,                                 -- ملاحظات الإلغاء
  status TEXT DEFAULT 'none',                 -- none (بدون استرداد) / active (استرداد مسجل) / cancelled
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rc_reservation ON reservation_cancellations(reservation_id);
CREATE INDEX IF NOT EXISTS idx_rc_reason ON reservation_cancellations(cancel_reason_code, cancelled_at);
CREATE INDEX IF NOT EXISTS idx_rc_refund ON reservation_cancellations(refund_no) WHERE refund_no IS NOT NULL;
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
  token_version: 'INTEGER DEFAULT 0', // v1.9: إبطال الجلسات — يُرفع عند تغيير كلمة المرور أو إعادة تعيينها
});
ensureColumns('activity_log', {
  ip: 'TEXT',      // v1.9: عنوان IP للعملية
  device: 'TEXT',  // v1.9: الجهاز/المتصفح للعملية
});
ensureColumns('documents', {
  marketer_name: 'TEXT', // المسوق المرتبط بتقرير المسوقين
  reservation_id: 'INTEGER', // v1.10: المستندات المرتبطة بالحجز
});
ensureColumns('reservations', {
  marketer_id: 'INTEGER',       // v1.10: المسوق المرتبط بالحجز
  unit_price: 'REAL',           // v1.10: سعر الوحدة لحظة الحجز (لقطة)
  cancel_reason_code: 'TEXT',   // v1.10: رمز سبب الإلغاء للتصفية والتقارير
  source_type: "TEXT DEFAULT 'direct'", // v1.11: مصدر الحجز: direct عادي / resale إعادة بيع
  resale_sale_id: 'INTEGER',    // v1.11: رقم عملية إعادة البيع المرتبطة (صفقة resold) — يربط الحجز بعملية إعادة البيع
  unit_status_before: "TEXT DEFAULT 'available'", // v1.11: حالة الوحدة قبل الحجز (available/resale) لاستعادتها عند الإلغاء
});
db.exec("CREATE INDEX IF NOT EXISTS idx_reservations_source ON reservations(source_type, status);");
ensureColumns('reservation_payments', {
  deposit_account: 'TEXT',      // v1.10: الحساب البنكي أو الخزينة التي أودع فيها المبلغ
  payment_status: "TEXT DEFAULT 'received'", // v1.10: received مستلمة / deposited مودعة / refunded مرتجعة / cancelled ملغاة / pending معلقة
});
ensureColumns('payments', {
  received_by: 'TEXT',          // v1.10: اسم المستلم للمال
  deposit_account: 'TEXT',      // v1.10: الحساب البنكي أو الخزينة التي أودع فيها المبلغ
  payment_status: "TEXT DEFAULT 'received'", // v1.10: حالة الدفعة المالية
  // ===== v1.12: حقول طرق الدفع لدفعات البيع (كانت موجودة لدفعات الحجز فقط) =====
  bank: 'TEXT',                 // البنك — للحوالة البنكية والشيك
  check_due_date: 'TEXT',       // تاريخ استحقاق الشيك
  check_status: 'TEXT',         // حالة الشيك: pending / cleared / bounced
  updated_at: 'TEXT',           // v1.12: توقيت آخر تعديل
  updated_by: 'INTEGER',        // v1.12: من قام بالتعديل
});
ensureColumns('sales', {
  prev_owner_name: 'TEXT',     // المالك السابق عند إعادة البيع
  purchase_price: 'REAL',      // سعر الشراء الأصلي (صفقة المالك السابق)
  purchase_date: 'TEXT',       // تاريخ الشراء الأصلي
  investor_name: 'TEXT',       // المستثمر
  purchase_cost: 'REAL',       // تكلفة الشراء للاستثمار (رأس المال)
  prev_sale_id: 'INTEGER',     // رابط صفقة الشراء السابقة (المالك السابق)
  property_cost: 'REAL',       // تكلفة العقار لهذه العملية — منفصلة عن سعر البيع
  invoice_no: 'TEXT',          // رقم فاتورة البيع الفريد
  beneficiary_type: "TEXT DEFAULT 'company'", // company / investor
  beneficiary_name: 'TEXT',
});
ensureColumns('commission_payments', {
  settlement_batch_id: 'INTEGER', // رابط التصفية الإجمالية للمسوق
  received_by: 'TEXT',            // v1.11.1: اسم المستلم للمال
  deposit_account: 'TEXT',        // v1.11.1: الحساب/البنك المودع فيه
  payment_status: "TEXT DEFAULT 'received'", // v1.11.1: حالة الدفعة (مستلمة/مودعة/...)
});
ensureColumns('settlement_reports', {
  invoice_no: 'TEXT',
});
ensureColumns('marketer_settlement_batches', {
  invoice_no: 'TEXT',
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
// ترحيل آمن للسجلات القائمة: لا يغير أي قيمة مالية أو رقم بيع
const legacySales = db.prepare("SELECT id,is_resale,prev_owner_name,seller_name FROM sales WHERE invoice_no IS NULL OR invoice_no='' ORDER BY id").all();
const setLegacyInvoice = db.prepare("UPDATE sales SET invoice_no=?,beneficiary_type=CASE WHEN is_resale=1 THEN 'investor' ELSE 'company' END,beneficiary_name=CASE WHEN is_resale=1 THEN COALESCE(prev_owner_name,seller_name,'مستثمر') ELSE 'الشركة' END WHERE id=?");
legacySales.forEach(s => setLegacyInvoice.run(`INV-LEGACY-${String(s.id).padStart(6,'0')}`, s.id));
db.prepare("SELECT id FROM settlement_reports WHERE invoice_no IS NULL OR invoice_no='' ORDER BY id").all().forEach(r => db.prepare('UPDATE settlement_reports SET invoice_no=? WHERE id=?').run(`IINV-LEGACY-${String(r.id).padStart(6,'0')}`,r.id));
db.prepare("SELECT id FROM marketer_settlement_batches WHERE invoice_no IS NULL OR invoice_no='' ORDER BY id").all().forEach(r => db.prepare('UPDATE marketer_settlement_batches SET invoice_no=? WHERE id=?').run(`MINV-LEGACY-${String(r.id).padStart(6,'0')}`,r.id));
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_invoice_no ON sales(invoice_no); CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_invoice_no ON settlement_reports(invoice_no) WHERE invoice_no IS NOT NULL; CREATE UNIQUE INDEX IF NOT EXISTS idx_marketer_batch_invoice_no ON marketer_settlement_batches(invoice_no) WHERE invoice_no IS NOT NULL;");

// ============================================================
// v1.12: فهارس الأداء ومنع التكرار المالي
// لا تحذف أي بيانات ولا تغير أي قيمة — قيود وفهارس فقط.
// ============================================================
db.exec(`
-- أداء: الاستعلامات المالية الأكثر تكرارًا (الدفعات/الخصومات/المصروفات/العمولات لكل صفقة)
CREATE INDEX IF NOT EXISTS idx_payments_sale_status ON payments(sale_id, status, payment_status);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(pay_date);
CREATE INDEX IF NOT EXISTS idx_rp_sale ON reservation_payments(sale_id, status, payment_status);
CREATE INDEX IF NOT EXISTS idx_rp_reservation ON reservation_payments(reservation_id, status);
CREATE INDEX IF NOT EXISTS idx_rp_date ON reservation_payments(pay_date);
CREATE INDEX IF NOT EXISTS idx_discounts_sale_status ON discounts(sale_id, status);
CREATE INDEX IF NOT EXISTS idx_expenses_sale_status ON expenses(sale_id, status);
CREATE INDEX IF NOT EXISTS idx_cp_sale_status ON commission_payments(sale_id, status);
CREATE INDEX IF NOT EXISTS idx_adjustments_sale_status ON financial_adjustments(sale_id, status, adjustment_type);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_unit_status ON sales(unit_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_units_project_status ON units(project_id, status);
-- منع التكرار: كل عربون يُربط بصفقة بيع واحدة فقط ومرة واحدة فقط
CREATE UNIQUE INDEX IF NOT EXISTS uq_rp_payment_no ON reservation_payments(payment_no);
`);
// منع ربط نفس دفعة الحجز بأكثر من بيع يتحقق منطقيًا في الخادم (سجل واحد = sale_id واحد)،
// والفهرس أعلاه يضمن تفرد رقم القيد. لا يمكن أن يظهر العربون مرتين في المدفوع لأن
// المحرك المالي يقرأ الحالات ('transferred','linked_to_sale') من سجل واحد فقط.

const defaults = {
  company_name_ar: 'شركة بيات الأكنة للتطوير العقاري',
  company_name_en: 'BAYAT ALAKENA', primary_color: '#972B32', secondary_color: '#192E56',
  accent_color: '#B79552', logo_url: '', app_version: '1.12.2',
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
  // v1.12: فرض الحقول المحاسبية الكاملة لكل طريقة دفع (0 = مرن، 1 = صارم)
  strict_payment_fields: '0',
};
const putSetting = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
Object.entries(defaults).forEach(([k, v]) => putSetting.run(k, v));
db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('app_version','1.12.2',CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value='1.12.2',updated_at=CURRENT_TIMESTAMP`).run();
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  db.prepare(`INSERT INTO users(name,username,password_hash,role,must_change_password)
    VALUES (?,?,?,?,1)`).run('مدير النظام', 'admin', bcrypt.hashSync('Admin@103', 12), 'super_admin');
}

// ============================================================
// v1.9: ترحيل العربونات القديمة إلى جدول دفعات الحجز (reservation_payments)
// قاعدة صارمة: لا تُغيّر أي قيمة مالية تاريخية — تُنشأ الدفعات كسجل
// موثق مرتبط بالحجز/العميل/الوحدة/المشروع، ولا تُربط بمبيعات قديمة
// (sale_id=NULL) حتى لا يتغير paid_amount/remaining لأي صفقة سابقة.
// ============================================================
function migrateLegacyDeposits() {
  const markKey = 'migration_deposits_v190';
  const done = db.prepare('SELECT value FROM settings WHERE key=?').get(markKey);
  if (done) { try { return JSON.parse(done.value); } catch { return {}; } }
  const report = {
    run_at: new Date().toISOString(),
    reservations_with_deposit: 0,
    created_payments: 0,
    total_amount: 0,
    skipped_cancelled: 0,
    already_have_payment: 0,
  };
  const insert = db.prepare(`INSERT INTO reservation_payments(payment_no,reservation_id,customer_id,unit_id,project_id,amount,pay_date,method,notes,status,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  const hasRp = db.prepare('SELECT 1 FROM reservation_payments WHERE reservation_id=? LIMIT 1');
  const tx = db.transaction(() => {
    const rows = db.prepare(`SELECT r.id reservation_id,r.customer_id,r.unit_id,r.deposit,r.status,r.created_at,u.project_id
      FROM reservations r JOIN units u ON u.id=r.unit_id WHERE r.deposit > 0 ORDER BY r.id`).all();
    for (const r of rows) {
      if (hasRp.get(r.reservation_id)) { report.already_have_payment++; continue; }
      report.reservations_with_deposit++;
      report.total_amount += r.deposit;
      const cancelled = r.status === 'cancelled' || r.status === 'expired';
      // القيد: RPY-LEGACY-<رقم الحجز> — ثابت ومستقر لمنع الترحيل المكرر
      const no = 'RPY-LEGACY-' + String(r.reservation_id).padStart(6, '0');
      insert.run(no, r.reservation_id, r.customer_id, r.unit_id, r.project_id, r.deposit,
        String(r.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10), 'cash',
        cancelled ? 'ترحيل عربون سابق — الحجز ملغي/منتهٍ، يُراجع يدويًا قبل أي استخدام' : 'ترحيل عربون سابق من النسخ السابقة (v1.9) — غير مربوط بصفقة سابقة',
        cancelled ? 'cancelled' : 'active', null);
      report.created_payments++;
      if (cancelled) report.skipped_cancelled++;
    }
  });
  tx();
  db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`)
    .run(markKey, JSON.stringify(report));
  return report;
}
// تطبيق الترحيل عند الإقلاع — آمن ومتكرر (لا ينشئ دفعة مكررة أبدًا)
const migrationReport = migrateLegacyDeposits();
if (migrationReport.created_payments > 0) {
  console.log(`[v1.9] تم ترحيل ${migrationReport.created_payments} عربون قديم بإجمالي ${migrationReport.total_amount} — راجع إعدادات النظام للتقرير الكامل`);
}
module.exports = db;
