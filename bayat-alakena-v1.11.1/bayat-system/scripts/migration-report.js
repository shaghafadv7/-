// ============================================================
// تقرير ترحيل العربونات القديمة — v1.9
// ينشئ قاعدة بيانات تحاكي نسخة قديمة (v1.8) ببيانات حقيقية الشكل،
// ثم يشغّل الترحيل (عبر db.js) ويتحقق من المطابقة ويكتب MIGRATION-REPORT.md
// التشغيل: node scripts/migration-report.js
// ============================================================
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bayat-mig-'));
process.env.BAYAT_DATA_DIR = DATA_DIR;

// 1) بناء قاعدة قديمة يدويًا بنفس مخطط v1.8
const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
const dbFile = path.join(DATA_DIR, 'bayat.sqlite');
const db = new Database(dbFile);
db.exec(`
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'sales', active INTEGER NOT NULL DEFAULT 1, must_change_password INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, permissions TEXT);
CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, location TEXT, construction_status TEXT NOT NULL DEFAULT 'under_construction', sales_status TEXT NOT NULL DEFAULT 'available', progress INTEGER DEFAULT 0, start_date TEXT, expected_date TEXT, completed_date TEXT, notes TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE floors (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, name TEXT NOT NULL, floor_order INTEGER NOT NULL, is_roof INTEGER DEFAULT 0, UNIQUE(project_id, floor_order));
CREATE TABLE units (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, floor_id INTEGER NOT NULL, model_id INTEGER, unit_number TEXT NOT NULL, rooms INTEGER, bathrooms INTEGER, area REAL, view TEXT, price REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'available', inventory_type TEXT DEFAULT 'company', notes TEXT, version INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, sell_phase TEXT DEFAULT 'off_plan', owner_name TEXT, seller_name TEXT, prev_price REAL, resale_date TEXT, UNIQUE(project_id, unit_number));
CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, national_id TEXT, source TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, reservation_no TEXT UNIQUE NOT NULL, unit_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, user_id INTEGER NOT NULL, start_at TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, deposit REAL DEFAULT 0, notes TEXT, status TEXT DEFAULT 'active', cancelled_at TEXT, cancel_reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE sales (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_no TEXT UNIQUE NOT NULL, unit_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, created_by INTEGER NOT NULL, salesperson_id INTEGER, sale_date TEXT NOT NULL, list_price REAL DEFAULT 0, final_price REAL NOT NULL, paid_amount REAL DEFAULT 0, remaining_amount REAL DEFAULT 0, contract_no TEXT, notes TEXT, status TEXT DEFAULT 'active', created_at TEXT DEFAULT CURRENT_TIMESTAMP, base_price REAL DEFAULT 0, discount_type TEXT DEFAULT 'none', discount_value REAL DEFAULT 0, discount_amount REAL DEFAULT 0, sale_phase TEXT DEFAULT 'off_plan', payment_method TEXT DEFAULT 'cash', payment_ref TEXT, marketer_id INTEGER, commission_type TEXT DEFAULT 'none', commission_value REAL DEFAULT 0, commission_total REAL DEFAULT 0, commission_paid REAL DEFAULT 0, commission_status TEXT DEFAULT 'none', is_resale INTEGER DEFAULT 0, seller_name TEXT, prev_owner_name TEXT, purchase_price REAL, purchase_date TEXT, investor_name TEXT, purchase_cost REAL, prev_sale_id INTEGER, property_cost REAL, invoice_no TEXT, beneficiary_type TEXT DEFAULT 'company', beneficiary_name TEXT);
CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, payment_no TEXT UNIQUE NOT NULL, sale_id INTEGER NOT NULL, amount REAL NOT NULL, pay_date TEXT NOT NULL, method TEXT DEFAULT 'cash', ref_no TEXT, notes TEXT, status TEXT DEFAULT 'active', cancelled_at TEXT, cancel_reason TEXT, cancelled_by INTEGER, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
// بيانات قديمة
db.prepare("INSERT INTO users(name,username,password_hash,role) VALUES('مدير النظام','admin','x','super_admin')").run();
const P = db.prepare("INSERT INTO projects(code,name) VALUES('108','العزيزية')").run().lastInsertRowid;
const F = db.prepare("INSERT INTO floors(project_id,name,floor_order) VALUES(?,?,1)").run(P, 'الأول').lastInsertRowid;
const mkUnit = price => db.prepare("INSERT INTO units(project_id,floor_id,unit_number,price,status) VALUES(?,?,?,?,?)").run(P, F, 'U' + Math.floor(Math.random() * 9000 + 100), price, 'available').lastInsertRowid;
const mkCust = (n, ph) => db.prepare("INSERT INTO customers(name,phone) VALUES(?,?)").run(n, ph).lastInsertRowid;
const mkRsv = (unit, cust, deposit, status) => db.prepare("INSERT INTO reservations(reservation_no,unit_id,customer_id,user_id,expires_at,deposit,status,created_at) VALUES(?,?,?,1,?,?,?,?)").run('RSV-' + String(Math.floor(Math.random() * 99999)).padStart(7, '0'), unit, cust, '2026-09-30T12:00', deposit, status, '2026-05-10 10:00:00').lastInsertRowid;

// حجوزات نشطة بعربونات
const c1 = mkCust('أحمد', '0501111001'), c2 = mkCust('خالد', '0501111002'), c3 = mkCust('سعد', '0501111003');
const u1 = mkUnit(450000), u2 = mkUnit(400000), u3 = mkUnit(350000);
const r1 = mkRsv(u1, c1, 5000, 'active');
const r2 = mkRsv(u2, c2, 10000, 'active');
// حجز محوّل لبيع (عربون ضمن البيع القديم)
const r3 = mkRsv(u3, c3, 8000, 'converted');
db.prepare("INSERT INTO sales(sale_no,unit_id,customer_id,created_by,sale_date,list_price,final_price,paid_amount,remaining_amount,status,base_price,discount_amount) VALUES('SAL-OLD-1',?,?,1,'2026-06-01',350000,350000,8000,342000,'active',350000,0)").run(u3, c3);
// حجز ملغي بعربون
const c4 = mkCust('فهد', '0501111004');
const u4 = mkUnit(300000);
const r4 = mkRsv(u4, c4, 3000, 'cancelled');
// حجز بدون عربون (لا يُرحل)
const c5 = mkCust('ماجد', '0501111005');
const u5 = mkUnit(280000);
const r5 = mkRsv(u5, c5, 0, 'active');

const before = {
  reservations_total: db.prepare('SELECT COUNT(*) n FROM reservations').get().n,
  reservations_with_deposit: db.prepare('SELECT COUNT(*) n FROM reservations WHERE deposit > 0').get().n,
  deposits_total: db.prepare('SELECT COALESCE(SUM(deposit),0) t FROM reservations WHERE deposit > 0').get().t,
  deposits_active_or_converted: db.prepare("SELECT COALESCE(SUM(deposit),0) t FROM reservations WHERE deposit > 0 AND status IN ('active','converted')").get().t,
  deposits_cancelled: db.prepare("SELECT COALESCE(SUM(deposit),0) t FROM reservations WHERE deposit > 0 AND status='cancelled'").get().t,
};
db.close();

// 2) تشغيل النظام الحالي (db.js ينفذ الترحيل عند الإقلاع)
const { execSync } = require('child_process');
const out = execSync(`node -e "const db=require('./db');process.stdout.write(JSON.stringify(db.prepare('SELECT value FROM settings WHERE key=\\'migration_deposits_v190\\'').get()));"`, { cwd: ROOT, env: { ...process.env, BAYAT_DATA_DIR: DATA_DIR }, encoding: 'utf8' });
const rep = JSON.parse(JSON.parse(out.trim().split('\n').pop()).value);

// 3) التحقق من المطابقة
const db2 = new Database(dbFile);
const after = {
  rp_total: db2.prepare('SELECT COUNT(*) n FROM reservation_payments').get().n,
  rp_amount: db2.prepare('SELECT COALESCE(SUM(amount),0) t FROM reservation_payments').get().t,
  rp_legacy_active: db2.prepare("SELECT COUNT(*) n FROM reservation_payments WHERE payment_no LIKE 'RPY-LEGACY-%' AND status='active'").get().n,
  rp_legacy_cancelled: db2.prepare("SELECT COUNT(*) n FROM reservation_payments WHERE payment_no LIKE 'RPY-LEGACY-%' AND status='cancelled'").get().n,
  linked_to_sale: db2.prepare("SELECT COUNT(*) n FROM reservation_payments WHERE payment_no LIKE 'RPY-LEGACY-%' AND sale_id IS NOT NULL").get().n,
};
db2.close();

const matches = {
  created_equals_with_deposit: rep.created_payments === before.reservations_with_deposit,
  amount_equals: rep.total_amount === before.deposits_total,
  active_matches: after.rp_legacy_active === 3, // r1, r2 نشطة + r3 محوّل (ترحيل: نشط)
  cancelled_matches: after.rp_legacy_cancelled === 1, // r4 ملغي
  not_linked: after.linked_to_sale === 0,
};
const allOk = Object.values(matches).every(Boolean);

const md = `# تقرير ترحيل البيانات — العربونات القديمة إلى دفعات الحجز (v1.9)

**تاريخ التشغيل:** ${new Date().toISOString()} — **الوضع:** محاكاة قاعدة v1.8 ببيانات قديمة الشكل ثم تشغيل الترحيل الفعلي.

## 1) قبل الترحيل (قاعدة قديمة v1.8)

| البند | العدد / المبلغ |
|---|---|
| إجمالي الحجوزات | ${before.reservations_total} |
| حجوزات عليها عربون (deposit > 0) | ${before.reservations_with_deposit} |
| إجمالي العربونات | ${before.deposits_total.toLocaleString('en-US')} ريال |
| منها نشطة/محوّلة | ${before.deposits_active_or_converted.toLocaleString('en-US')} ريال |
| منها ملغاة | ${before.deposits_cancelled.toLocaleString('en-US')} ريال |

## 2) تقرير الترحيل (من الإعدادات — migration_deposits_v190)

\`\`\`json
${JSON.stringify(rep, null, 2)}
\`\`\`

## 3) بعد الترحيل (جدول reservation_payments)

| البند | العدد / المبلغ |
|---|---|
| إجمالي قيود الحجز | ${after.rp_total} |
| إجمالي المبالغ | ${after.rp_amount.toLocaleString('en-US')} ريال |
| قيود نشطة (RPY-LEGACY) | ${after.rp_legacy_active} |
| قيود ملغاة (حجوزات ملغاة — للمراجعة) | ${after.rp_legacy_cancelled} |
| قيود مرتبطة بصفقات قديمة | ${after.linked_to_sale} |

## 4) مطابقة الترحيل

| الفحص | النتيجة |
|---|---|
| عدد القيود المنشأة = عدد الحجوزات ذات العربون | ${matches.created_equals_with_deposit ? '✅' : '❌'} |
| إجمالي المبالغ مطابق قبل/بعد | ${matches.amount_equals ? '✅' : '❌'} |
| القيود النشطة (نشط/محوّل) مطابقة | ${matches.active_matches ? '✅' : '❌'} |
| قيود الحجوزات الملغاة مسجلة كملغاة (لا حذف) | ${matches.cancelled_matches ? '✅' : '❌'} |
| لا ربط بصفقات قديمة (لا تغيير للأرصدة التاريخية) | ${matches.not_linked ? '✅' : '❌'} |

## 5) الخلاصة

${allOk ? '**الترحيل ناجح ومطابق — لا فقد ولا تكرار ولا تغيير في الأرصدة التاريخية.**' : '**توجد فروق — راجع الجدول أعلاه.**'}

ملاحظات:
- الحجوزات الملغاة بعربون: سُجلت القيود بحالة cancelled مع سبب «يراجع يدويًا» لأن مصير المبلغ غير معروف تاريخيًا.
- قيود الترحيل مرقمة بثبات (RPY-LEGACY-رقم الحجز) فلا يمكن أن تتكرر في أي إقلاع لاحق.
- العلامة في settings تمنع إعادة الترحيل نهائيًا.
`;
fs.writeFileSync(path.join(ROOT, 'MIGRATION-REPORT.md'), md);
console.log(md);
console.log('\n==> تم كتابة MIGRATION-REPORT.md — النتيجة:', allOk ? 'مطابقة ✅' : 'فروق ❌');
process.exit(allOk ? 0 : 1);
