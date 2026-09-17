// Smart Secretary — API part 2: estate, finance, dashboard, search, reports, backup, assistant
const express = require('express');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { db, flush, DATA_DIR, DB_PATH } = require('./db');
const { auth, requirePerm: P, audit, can } = require('./auth');

const R = express.Router();
const today = () => new Date().toISOString().slice(0, 10);
function pageParams(q, def = 'id') {
  const page = Math.max(1, parseInt(q.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(q.limit) || 20));
  return { page, limit, offset: (page - 1) * limit };
}
function pushAudit(req, action, module, entity, id, details) { audit({ ...req.user, ip: req.ip }, action, module, entity, id, details); }
function notify(userId, type, title, body = '', link = '') {
  try { db.prepare('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?,?,?,?,?)').run(userId, type, title, body, link); } catch {}
}
function notifyRole(roleName, type, title, body, link) {
  try {
    db.prepare(`SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name=? AND u.status='active' AND u.deleted_at IS NULL`).all(roleName)
      .forEach(u => notify(u.id, type, title, body, link));
  } catch {}
}
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
function settingsObj() {
  const o = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(r => o[r.key] = r.value);
  return o;
}

// ---------- reservations ----------
R.get('/reservations', auth, P('reservations', 'view'), (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  let w = '1=1', ps = [];
  if (req.query.q) { w += ' AND (r.code LIKE ? OR c.name LIKE ? OR u.code LIKE ?)'; ps.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.status) { w += ' AND r.status=?'; ps.push(req.query.status); }
  if (req.query.project_id) { w += ' AND u.project_id=?'; ps.push(req.query.project_id); }
  const total = db.prepare(`SELECT COUNT(*) c FROM reservations r JOIN units u ON u.id=r.unit_id JOIN clients c ON c.id=r.client_id WHERE ${w}`).get(...ps).c;
  const rows = db.prepare(`SELECT r.*, c.name client_name, c.phone client_phone, u.code unit_code, u.price unit_price, p.code project_code, p.name project_name, e.name employee_name
    FROM reservations r JOIN units u ON u.id=r.unit_id JOIN clients c ON c.id=r.client_id JOIN projects p ON p.id=u.project_id LEFT JOIN users e ON e.id=r.employee_id
    WHERE ${w} ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(...ps, limit, offset);
  res.json({ data: rows, total, page, pages: Math.ceil(total / limit) || 1 });
});
R.post('/reservations', auth, P('reservations', 'create'), (req, res) => {
  const { unit_id, client_id, price, discount = 0, deposit = 0, deposit_method = 'cash', deposit_ref = '', reservation_date, expiry_date, employee_id, notes } = req.body || {};
  if (!unit_id || !client_id || price === undefined || !reservation_date) return res.status(400).json({ error: 'الوحدة والعميل والسعر وتاريخ الحجز حقول مطلوبة' });
  const unit = db.prepare('SELECT * FROM units WHERE id=?').get(unit_id);
  if (!unit) return res.status(404).json({ error: 'الوحدة غير موجودة' });
  if (!['available', 'resale'].includes(unit.status)) return res.status(400).json({ error: `الوحدة ${unit.code} غير متاحة للحجز (حالتها: ${unit.status})` });
  const pr = num(price), dc = num(discount), dp = num(deposit);
  if (pr <= 0) return res.status(400).json({ error: 'السعر يجب أن يكون أكبر من صفر' });
  if (dc < 0 || dc > pr) return res.status(400).json({ error: 'الخصم غير منطقي — يجب أن يكون بين 0 والسعر' });
  if (dp < 0 || dp > pr - dc) return res.status(400).json({ error: 'العربون غير منطقي — يجب ألا يتجاوز الصافي' });
  const code = `R-${new Date().getFullYear()}-${String(db.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM reservations').get().n).padStart(4, '0')}`;
  const info = db.prepare(`INSERT INTO reservations (code, unit_id, client_id, price, discount, deposit, deposit_method, deposit_ref, reservation_date, expiry_date, employee_id, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, unit_id, client_id, pr, dc, dp, deposit_method, deposit_ref, reservation_date, expiry_date || null, employee_id || req.user.id, notes || '', req.user.id);
  db.prepare(`UPDATE units SET status='reserved', updated_at=datetime('now','localtime') WHERE id=?`).run(unit_id);
  pushAudit(req, 'create', 'reservations', 'reservation', info.lastInsertRowid, `${code} — وحدة ${unit.code} — عميل ${client_id}`);
  notifyRole('admin', 'reservation', `حجز جديد ${code}`, `وحدة ${unit.code} — ${Number(pr).toLocaleString('en')}`, '/reservations');
  res.status(201).json({ id: info.lastInsertRowid, code });
});
R.get('/reservations/:id', auth, P('reservations', 'view'), (req, res) => {
  const row = db.prepare(`SELECT r.*, c.name client_name, c.phone client_phone, u.code unit_code, p.code project_code, p.name project_name, e.name employee_name
    FROM reservations r JOIN units u ON u.id=r.unit_id JOIN clients c ON c.id=r.client_id JOIN projects p ON p.id=u.project_id LEFT JOIN users e ON e.id=r.employee_id WHERE r.id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'الحجز غير موجود' });
  res.json(row);
});
R.post('/reservations/:id/cancel', auth, P('reservations', 'edit'), (req, res) => {
  const r = db.prepare('SELECT * FROM reservations WHERE id=?').get(req.params.id);
  if (!r || r.status !== 'active') return res.status(400).json({ error: 'الحجز غير نشط' });
  const { cancel_reason, refund_amount = 0, deducted_amount = 0, refund_status = 'pending' } = req.body || {};
  if (!cancel_reason) return res.status(400).json({ error: 'سبب الإلغاء مطلوب' });
  const rf = num(refund_amount), dd = num(deducted_amount);
  if (rf < 0 || dd < 0 || rf + dd - r.deposit > 0.01) return res.status(400).json({ error: 'المسترد + المخصوم يجب ألا يتجاوز العربون' });
  db.prepare(`UPDATE reservations SET status='cancelled', cancel_reason=?, refund_amount=?, deducted_amount=?, refund_status=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(cancel_reason, rf, dd, refund_status, r.id);
  db.prepare(`UPDATE units SET status='available', updated_at=datetime('now','localtime') WHERE id=?`).run(r.unit_id);
  pushAudit(req, 'update', 'reservations', 'reservation', r.id, `إلغاء ${r.code} — ${cancel_reason}`);
  res.json({ ok: true });
});

// ---------- sales & finance ----------
function saleCalc(sale) {
  const paid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE sale_id=?').get(sale.id).s;
  return { ...sale, paid, remaining: Math.max(0, num(sale.net_price) - num(sale.down_payment) - num(paid) + 0) , total_paid: num(sale.down_payment) + num(paid) };
}
R.get('/sales', auth, P('sales', 'view'), (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  let w = '1=1', ps = [];
  if (req.query.q) { w += ' AND (s.code LIKE ? OR c.name LIKE ? OR u.code LIKE ?)'; ps.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.status) { w += ' AND s.status=?'; ps.push(req.query.status); }
  if (req.query.project_id) { w += ' AND p.id=?'; ps.push(req.query.project_id); }
  const total = db.prepare(`SELECT COUNT(*) c FROM sales s JOIN units u ON u.id=s.unit_id JOIN clients c ON c.id=s.client_id WHERE ${w}`).get(...ps).c;
  const rows = db.prepare(`SELECT s.*, c.name client_name, u.code unit_code, p.code project_code FROM sales s JOIN units u ON u.id=s.unit_id JOIN clients c ON c.id=s.client_id JOIN projects p ON p.id=u.project_id WHERE ${w} ORDER BY s.id DESC LIMIT ? OFFSET ?`).all(...ps, limit, offset).map(saleCalc);
  res.json({ data: rows, total, page, pages: Math.ceil(total / limit) || 1 });
});
R.post('/sales', auth, P('sales', 'create'), (req, res) => {
  const { reservation_id, unit_id, client_id, sale_price, discount = 0, down_payment = 0, broker_id = null, commission = null, broker_name = '', payment_method = 'transfer', reference_no = '', sale_date, notes } = req.body || {};
  let unit, client, resv = null;
  if (reservation_id) {
    resv = db.prepare('SELECT * FROM reservations WHERE id=?').get(reservation_id);
    if (!resv || resv.status !== 'active') return res.status(400).json({ error: 'الحجز غير نشط' });
    unit = db.prepare('SELECT * FROM units WHERE id=?').get(resv.unit_id);
    client = { id: resv.client_id };
  } else {
    if (!unit_id || !client_id) return res.status(400).json({ error: 'الوحدة والعميل مطلوبان' });
    unit = db.prepare('SELECT * FROM units WHERE id=?').get(unit_id);
    client = { id: client_id };
    if (!['available', 'resale', 'reserved'].includes(unit?.status)) return res.status(400).json({ error: 'الوحدة غير متاحة للبيع' });
  }
  const sp = num(sale_price ?? resv?.price), dc = num(discount ?? resv?.discount), dp = num(down_payment);
  if (sp <= 0) return res.status(400).json({ error: 'سعر البيع يجب أن يكون أكبر من صفر' });
  if (dc < 0 || dc > sp) return res.status(400).json({ error: 'الخصم يجب أن يكون بين 0 وسعر البيع' });
  const net = sp - dc;
  let broker = null, cm = num(commission), bname = broker_name;
  if (broker_id) {
    broker = db.prepare('SELECT * FROM brokers WHERE id=? AND deleted_at IS NULL').get(broker_id);
    if (!broker) return res.status(404).json({ error: 'الوسيط غير موجود' });
    if (!bname) bname = broker.name;
    if (commission === null || commission === undefined || commission === '') cm = Math.round(net * num(broker.commission_rate) / 100 * 100) / 100;
  }
  if (dp < 0 || dp > net) return res.status(400).json({ error: 'الدفعة الأولى يجب ألا تتجاوز الصافي' });
  if (cm < 0 || cm > net) return res.status(400).json({ error: 'العمولة يجب أن تكون بين 0 والصافي' });
  const settlement = net - cm;
  const code = `S-${new Date().getFullYear()}-${String(db.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM sales').get().n).padStart(4, '0')}`;
  const info = db.prepare(`INSERT INTO sales (code, reservation_id, unit_id, client_id, sale_price, discount, net_price, down_payment, commission, commission_due, broker_id, broker_name, settlement, payment_method, reference_no, sale_date, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, reservation_id || null, unit.id, client.id, sp, dc, net, dp, cm, cm, broker ? broker.id : null, bname, settlement, payment_method, reference_no, sale_date || today(), notes || '', req.user.id);
  db.prepare(`UPDATE units SET status='sold', updated_at=datetime('now','localtime') WHERE id=?`).run(unit.id);
  if (resv) db.prepare(`UPDATE reservations SET status='completed', updated_at=datetime('now','localtime') WHERE id=?`).run(resv.id);
  const invCode = `INV-${new Date().getFullYear()}-${String(info.lastInsertRowid).padStart(4, '0')}`;
  db.prepare('INSERT INTO invoices (code, sale_id, client_id, amount, issued_at) VALUES (?,?,?,?,?)').run(invCode, info.lastInsertRowid, client.id, net, sale_date || today());
  pushAudit(req, 'create', 'sales', 'sale', info.lastInsertRowid, `${code} — صافي ${net}`);
  notifyRole('admin', 'sale', `عملية بيع جديدة ${code}`, `صافي ${Number(net).toLocaleString('en')}`, '/sales');
  res.status(201).json({ id: info.lastInsertRowid, code, net_price: net, settlement });
});
R.get('/sales/:id', auth, P('sales', 'view'), (req, res) => {
  const s = db.prepare(`SELECT s.*, c.name client_name, c.phone client_phone, u.code unit_code, u.area, u.rooms, p.code project_code, p.name project_name FROM sales s JOIN clients c ON c.id=s.client_id JOIN units u ON u.id=s.unit_id JOIN projects p ON p.id=u.project_id WHERE s.id=?`).get(req.params.id);
  if (!s) return res.status(404).json({ error: 'العملية غير موجودة' });
  s.payments = db.prepare('SELECT * FROM payments WHERE sale_id=? ORDER BY id').all(s.id);
  s.invoice = db.prepare('SELECT * FROM invoices WHERE sale_id=?').get(s.id);
  res.json(saleCalc(s));
});
R.post('/sales/:id/payments', auth, P('finance', 'create'), (req, res) => {
  const s = db.prepare('SELECT * FROM sales WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'العملية غير موجودة' });
  const { amount, method = 'transfer', reference_no = '', paid_at, notes = '' } = req.body || {};
  const am = num(amount);
  if (am <= 0) return res.status(400).json({ error: 'المبلغ يجب أن يكون أكبر من صفر' });
  const calc = saleCalc(s);
  if (am - calc.remaining > 0.01) return res.status(400).json({ error: `المبلغ يتجاوز المتبقي (${Number(calc.remaining).toLocaleString('en')})` });
  const info = db.prepare('INSERT INTO payments (sale_id, amount, method, reference_no, paid_at, notes, created_by) VALUES (?,?,?,?,?,?,?)')
    .run(s.id, am, method, reference_no, paid_at || today(), notes, req.user.id);
  pushAudit(req, 'create', 'finance', 'payment', info.lastInsertRowid, `دفعة ${am} لعملية ${s.code}`);
  res.status(201).json({ id: info.lastInsertRowid });
});
R.get('/finance/summary', auth, P('finance', 'view'), (req, res) => {
  const sales = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(net_price),0) total, COALESCE(SUM(down_payment),0) down, COALESCE(SUM(commission),0) comm FROM sales WHERE status='active'`).get();
  const paid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments').get().s;
  const byMonth = db.prepare(`SELECT substr(sale_date,1,7) m, COUNT(*) n, SUM(net_price) total FROM sales WHERE sale_date >= date('now','-12 months') GROUP BY m ORDER BY m`).all();
  const overdueRes = db.prepare(`SELECT COUNT(*) c FROM reservations WHERE status='active' AND expiry_date IS NOT NULL AND expiry_date < date('now')`).get().c;
  res.json({ sales, paid, outstanding: sales.total - sales.down - paid, byMonth, overdueRes });
});

// ---------- notifications ----------
R.get('/notifications', auth, (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  let w = 'user_id=?', ps = [req.user.id];
  if (req.query.unread === '1') w += ' AND is_read=0';
  const total = db.prepare(`SELECT COUNT(*) c FROM notifications WHERE ${w}`).get(...ps).c;
  const rows = db.prepare(`SELECT * FROM notifications WHERE ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...ps, limit, offset);
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).c;
  res.json({ data: rows, total, unread, page, pages: Math.ceil(total / limit) || 1 });
});
R.put('/notifications/read-all', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});
R.put('/notifications/:id/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});
R.delete('/notifications/:id', auth, (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- audit ----------
R.get('/audit', auth, P('audit', 'view'), (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  let w = '1=1', ps = [];
  if (req.query.q) { w += ' AND (username LIKE ? OR details LIKE ? OR entity LIKE ?)'; ps.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.module) { w += ' AND module=?'; ps.push(req.query.module); }
  if (req.query.action) { w += ' AND action=?'; ps.push(req.query.action); }
  if (req.query.from) { w += ' AND date(created_at) >= ?'; ps.push(req.query.from); }
  if (req.query.to) { w += ' AND date(created_at) <= ?'; ps.push(req.query.to); }
  const total = db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE ${w}`).get(...ps).c;
  res.json({ data: db.prepare(`SELECT * FROM audit_logs WHERE ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...ps, limit, offset), total, page, pages: Math.ceil(total / limit) || 1 });
});

// ---------- settings ----------
const SET_KEYS = ['company_name', 'company_phone', 'company_mobile', 'company_email', 'company_address', 'company_logo', 'system_language', 'system_theme', 'system_font', 'currency', 'reports_footer'];
R.get('/settings', auth, P('settings', 'view'), (req, res) => res.json(settingsObj()));
R.get('/settings/public', auth, (req, res) => {
  const s = settingsObj();
  res.json({ company_name: s.company_name, company_logo: s.company_logo, currency: s.currency, system_theme: s.system_theme });
});
R.put('/settings', auth, P('settings', 'manage'), (req, res) => {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  Object.entries(req.body || {}).forEach(([k, v]) => { if (SET_KEYS.includes(k)) up.run(k, String(v ?? '')); });
  pushAudit(req, 'update', 'settings', 'settings', null, 'تعديل الإعدادات');
  res.json(settingsObj());
});

// ---------- dashboard ----------
R.get('/dashboard', auth, (req, res) => {
  const t = today(), uid = req.user.id, p = req.user.perms;
  const out = { stats: {}, focus: [], charts: {}, lists: {} };
  if (can(p, 'tasks', 'view')) {
    out.stats.tasksToday = db.prepare(`SELECT COUNT(*) c FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('completed','cancelled') AND due_date=?`).get(t).c;
    out.stats.overdue = db.prepare(`SELECT COUNT(*) c FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('completed','cancelled') AND due_date IS NOT NULL AND due_date<?`).get(t).c;
    out.stats.myTasks = db.prepare(`SELECT COUNT(*) c FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('completed','cancelled') AND assignee_id=?`).get(uid).c;
    out.charts.tasksByStatus = db.prepare(`SELECT status, COUNT(*) n FROM tasks WHERE deleted_at IS NULL GROUP BY status`).all();
    out.lists.myTasks = db.prepare(`SELECT t.*, u.name assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.deleted_at IS NULL AND t.status NOT IN ('completed','cancelled') AND (t.assignee_id=? OR t.due_date<=?) ORDER BY t.due_date IS NULL, t.due_date LIMIT 8`).all(uid, t);
  }
  if (can(p, 'appointments', 'view')) {
    out.stats.todayAppts = db.prepare(`SELECT COUNT(*) c FROM appointments WHERE deleted_at IS NULL AND status='scheduled' AND date=?`).get(t).c;
    out.stats.weekAppts = db.prepare(`SELECT COUNT(*) c FROM appointments WHERE deleted_at IS NULL AND status='scheduled' AND date BETWEEN ? AND date(?,'+7 days')`).get(t, t).c;
    out.lists.upcoming = db.prepare(`SELECT a.*, c.name client_name FROM appointments a LEFT JOIN clients c ON c.id=a.client_id WHERE a.deleted_at IS NULL AND a.status='scheduled' AND a.date>=? ORDER BY a.date, a.start_time LIMIT 6`).all(t);
  }
  if (can(p, 'clients', 'view')) {
    out.stats.clients = db.prepare(`SELECT COUNT(*) c FROM clients WHERE deleted_at IS NULL`).get().c;
    out.stats.newClients = db.prepare(`SELECT COUNT(*) c FROM clients WHERE deleted_at IS NULL AND date(created_at) >= date('now','-30 days')`).get().c;
  }
  if (can(p, 'calls', 'view')) {
    out.stats.callsToday = db.prepare(`SELECT COUNT(*) c FROM calls WHERE deleted_at IS NULL AND date(started_at)=?`).get(t).c;
    out.stats.missed = db.prepare(`SELECT COUNT(*) c FROM calls WHERE deleted_at IS NULL AND result='missed' AND follow_up_done=0`).get().c;
    out.charts.callsByResult = db.prepare(`SELECT result, COUNT(*) n FROM calls WHERE deleted_at IS NULL AND started_at >= date('now','-30 days') GROUP BY result`).all();
  }
  if (can(p, 'files', 'view')) out.lists.recentFiles = db.prepare(`SELECT f.*, u.name uploader FROM files f LEFT JOIN users u ON u.id=f.uploaded_by WHERE f.deleted_at IS NULL ORDER BY f.id DESC LIMIT 6`).all();
  if (can(p, 'reservations', 'view')) {
    out.stats.activeRes = db.prepare(`SELECT COUNT(*) c FROM reservations WHERE status='active'`).get().c;
    out.stats.expiringRes = db.prepare(`SELECT COUNT(*) c FROM reservations WHERE status='active' AND expiry_date IS NOT NULL AND expiry_date <= date('now','+3 days')`).get().c;
  }
  if (can(p, 'sales', 'view')) {
    out.stats.monthSales = db.prepare(`SELECT COALESCE(SUM(net_price),0) s FROM sales WHERE substr(sale_date,1,7)=strftime('%Y-%m','now','localtime')`).get().s;
    out.charts.salesByMonth = db.prepare(`SELECT substr(sale_date,1,7) m, SUM(net_price) total FROM sales WHERE sale_date >= date('now','-6 months') GROUP BY m ORDER BY m`).all();
  }
  if (can(p, 'units', 'view')) out.stats.unitsAvail = db.prepare(`SELECT COUNT(*) c FROM units WHERE status IN ('available','resale')`).get().c;
  out.stats.unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(uid).c;
  // تركيز اليوم: أهم ما يحتاج الانتباه
  const f = [];
  (out.lists.myTasks || []).filter(x => x.due_date && x.due_date <= t).forEach(x => f.push({ kind: 'task', label: `مهمة مستحقة: ${x.title}`, link: '/tasks', level: x.due_date < t ? 'danger' : 'warn' }));
  (out.lists.upcoming || []).filter(a => a.date === t).forEach(a => f.push({ kind: 'appointment', label: `موعد اليوم ${a.start_time}: ${a.title}`, link: '/appointments', level: 'info' }));
  if (out.stats.expiringRes) f.push({ kind: 'reservation', label: `${out.stats.expiringRes} حجوزات تنتهي قريبًا`, link: '/reservations', level: 'warn' });
  if (out.stats.missed) f.push({ kind: 'call', label: `${out.stats.missed} اتصالات فائتة تحتاج متابعة`, link: '/calls', level: 'warn' });
  out.focus = f.slice(0, 8);
  res.json(out);
});

// ---------- global search ----------
R.get('/search', auth, (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ groups: [] });
  const like = `%${q}%`, p = req.user.perms, groups = [];
  const g = (key, title, icon, link, rows) => { if (rows.length) groups.push({ key, title, icon, link, rows }); };
  if (can(p, 'clients', 'view')) g('clients', 'العملاء', 'users', '/clients', db.prepare('SELECT id, name title, phone sub FROM clients WHERE deleted_at IS NULL AND (name LIKE ? OR phone LIKE ? OR company LIKE ?) LIMIT 5').all(like, like, like));
  if (can(p, 'tasks', 'view')) g('tasks', 'المهام', 'check', '/tasks', db.prepare('SELECT id, title, status sub FROM tasks WHERE deleted_at IS NULL AND title LIKE ? LIMIT 5').all(like));
  if (can(p, 'appointments', 'view')) g('appointments', 'المواعيد', 'calendar', '/appointments', db.prepare('SELECT id, title, date sub FROM appointments WHERE deleted_at IS NULL AND title LIKE ? LIMIT 5').all(like));
  if (can(p, 'calls', 'view')) g('calls', 'الاتصالات', 'phone', '/calls', db.prepare('SELECT id, contact_name title, phone sub FROM calls WHERE deleted_at IS NULL AND (contact_name LIKE ? OR phone LIKE ?) LIMIT 5').all(like, like));
  if (can(p, 'notes', 'view')) g('notes', 'الملاحظات', 'note', '/notes', db.prepare('SELECT id, COALESCE(NULLIF(title,\'\'), substr(body,1,40)) title, type sub FROM notes WHERE deleted_at IS NULL AND (title LIKE ? OR body LIKE ?) LIMIT 5').all(like, like));
  if (can(p, 'files', 'view')) g('files', 'الملفات', 'file', '/files', db.prepare('SELECT id, original_name title, category sub FROM files WHERE deleted_at IS NULL AND original_name LIKE ? LIMIT 5').all(like));
  if (can(p, 'units', 'view')) g('units', 'الوحدات', 'home', '/projects', db.prepare('SELECT id, code title, status sub FROM units WHERE deleted_at IS NULL AND code LIKE ? LIMIT 5').all(like));
  if (can(p, 'projects', 'view')) g('projects', 'المشاريع', 'building', '/projects', db.prepare('SELECT id, name title, code sub FROM projects WHERE (name LIKE ? OR code LIKE ?) LIMIT 5').all(like, like));
  if (can(p, 'users', 'view')) g('users', 'المستخدمون', 'user', '/users', db.prepare('SELECT id, name title, username sub FROM users WHERE deleted_at IS NULL AND (name LIKE ? OR username LIKE ?) LIMIT 5').all(like, like));
  if (can(p, 'sales', 'view')) g('sales', 'المبيعات', 'money', '/sales', db.prepare('SELECT s.id, s.code title, c.name sub FROM sales s JOIN clients c ON c.id=s.client_id WHERE s.code LIKE ? OR c.name LIKE ? LIMIT 5').all(like, like));
  if (can(p, 'reservations', 'view')) g('reservations', 'الحجوزات', 'key', '/reservations', db.prepare('SELECT r.id, r.code title, c.name sub FROM reservations r JOIN clients c ON c.id=r.client_id WHERE r.code LIKE ? OR c.name LIKE ? LIMIT 5').all(like, like));
  if (can(p, 'finance', 'view') || can(p, 'sales', 'view')) {
    g('invoices', 'الفواتير', 'invoice', '/sales', db.prepare('SELECT id, code title, amount sub FROM invoices WHERE code LIKE ? LIMIT 5').all(like));
    g('payments', 'الدفعات', 'cash', '/sales', db.prepare('SELECT p.id, (\'دفعة #\' || p.id) title, p.reference_no sub FROM payments p WHERE p.reference_no LIKE ? LIMIT 5').all(like));
  }
  res.json({ groups });
});

// ---------- reports ----------
const REPORTS = {
  tasks: { title: 'تقرير المهام', module: 'tasks', cols: ['id', 'title', 'assignee', 'priority', 'status', 'due_date', 'category'] },
  clients: { title: 'تقرير العملاء', module: 'clients', cols: ['id', 'code', 'name', 'phone', 'status', 'category'] },
  appointments: { title: 'تقرير المواعيد', module: 'appointments', cols: ['id', 'title', 'client', 'date', 'time', 'status'] },
  calls: { title: 'تقرير الاتصالات', module: 'calls', cols: ['id', 'contact', 'phone', 'direction', 'result', 'date'] },
  activity: { title: 'تقرير النشاط', module: 'audit', cols: ['id', 'user', 'action', 'module', 'details', 'date'] },
  users: { title: 'تقرير المستخدمين', module: 'users', cols: ['id', 'name', 'username', 'role', 'status', 'last_login'] },
  reservations: { title: 'تقرير الحجوزات', module: 'reservations', cols: ['id', 'code', 'unit', 'client', 'price', 'deposit', 'status', 'date'] },
  sales: { title: 'تقرير المبيعات', module: 'sales', cols: ['id', 'code', 'unit', 'client', 'net', 'paid', 'remaining', 'date'] },
  finance: { title: 'التقرير المالي', module: 'finance', cols: ['id', 'code', 'client', 'net', 'commission', 'settlement', 'date'] },
  units: { title: 'تقرير الوحدات', module: 'units', cols: ['id', 'code', 'project', 'rooms', 'area', 'price', 'status'] }
};
function reportRows(name, f = {}) {
  switch (name) {
    case 'tasks': return db.prepare(`SELECT t.id, t.title, u.name assignee, t.priority, t.status, t.due_date, t.category FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.deleted_at IS NULL ${f.status ? 'AND t.status=?' : ''} ORDER BY t.id DESC LIMIT 1000`).all(...(f.status ? [f.status] : []));
    case 'clients': return db.prepare(`SELECT id, code, name, phone, status, category FROM clients WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1000`).all();
    case 'appointments': return db.prepare(`SELECT a.id, a.title, c.name client, a.date, a.start_time time, a.status FROM appointments a LEFT JOIN clients c ON c.id=a.client_id WHERE a.deleted_at IS NULL ORDER BY a.date DESC LIMIT 1000`).all();
    case 'calls': return db.prepare(`SELECT id, contact_name contact, phone, direction, result, substr(started_at,1,10) date FROM calls WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1000`).all();
    case 'activity': return db.prepare(`SELECT id, username user, action, module, details, substr(created_at,1,16) date FROM audit_logs ORDER BY id DESC LIMIT 1000`).all();
    case 'users': return db.prepare(`SELECT u.id, u.name, u.username, r.name_ar role, u.status, u.last_login_at last_login FROM users u JOIN roles r ON r.id=u.role_id WHERE u.deleted_at IS NULL`).all();
    case 'reservations': return db.prepare(`SELECT r.id, r.code, u.code unit, c.name client, r.price, r.deposit, r.status, r.reservation_date date FROM reservations r JOIN units u ON u.id=r.unit_id JOIN clients c ON c.id=r.client_id ORDER BY r.id DESC LIMIT 1000`).all();
    case 'sales': return db.prepare(`SELECT s.id, s.code, u.code unit, c.name client, s.net_price net, (s.down_payment + COALESCE((SELECT SUM(amount) FROM payments WHERE sale_id=s.id),0)) paid, (s.net_price - s.down_payment - COALESCE((SELECT SUM(amount) FROM payments WHERE sale_id=s.id),0)) remaining, s.sale_date date FROM sales s JOIN units u ON u.id=s.unit_id JOIN clients c ON c.id=s.client_id ORDER BY s.id DESC LIMIT 1000`).all();
    case 'finance': return db.prepare(`SELECT s.id, s.code, c.name client, s.net_price net, s.commission, s.settlement, s.sale_date date FROM sales s JOIN clients c ON c.id=s.client_id ORDER BY s.id DESC LIMIT 1000`).all();
    case 'units': return db.prepare(`SELECT u.id, u.code, p.code project, u.rooms, u.area, u.price, u.status FROM units u JOIN projects p ON p.id=u.project_id ORDER BY u.code LIMIT 1000`).all();
    default: return null;
  }
}
R.get('/reports', auth, P('reports', 'view'), (req, res) => {
  res.json({ reports: Object.entries(REPORTS).map(([k, v]) => ({ key: k, ...v })) });
});
R.get('/reports/:name', auth, P('reports', 'view'), (req, res) => {
  const def = REPORTS[req.params.name];
  if (!def) return res.status(404).json({ error: 'التقرير غير موجود' });
  if (!can(req.user.perms, def.module, 'view')) return res.status(403).json({ error: 'صلاحية مرفوضة لهذا التقرير' });
  const rows = reportRows(req.params.name, req.query);
  res.json({ def, rows, meta: { no: `REP-${Date.now().toString(36).toUpperCase()}`, date: new Date().toLocaleString('en-GB'), user: req.user.name, company: settingsObj() } });
});
R.get('/reports/:name/excel', auth, P('reports', 'export'), async (req, res) => {
  const def = REPORTS[req.params.name];
  if (!def) return res.status(404).json({ error: 'التقرير غير موجود' });
  const rows = reportRows(req.params.name, req.query);
  const s = settingsObj();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Smart Secretary';
  const ws = wb.addWorksheet(def.title, { views: [{ rightToLeft: true }] });
  const COLS_AR = { id: 'م', title: 'العنوان', assignee: 'المسؤول', priority: 'الأولوية', status: 'الحالة', due_date: 'الاستحقاق', category: 'التصنيف', code: 'الكود', name: 'الاسم', phone: 'الهاتف', client: 'العميل', date: 'التاريخ', time: 'الوقت', contact: 'جهة الاتصال', direction: 'الاتجاه', result: 'النتيجة', user: 'المستخدم', action: 'الإجراء', module: 'الوحدة', details: 'التفاصيل', username: 'المستخدم', role: 'الدور', last_login: 'آخر دخول', unit: 'الوحدة', price: 'السعر', deposit: 'العربون', net: 'الصافي', paid: 'المدفوع', remaining: 'المتبقي', commission: 'العمولة', settlement: 'التسوية', project: 'المشروع', rooms: 'الغرف', area: 'المساحة' };
  ws.mergeCells(1, 1, 1, def.cols.length);
  ws.getCell(1, 1).value = s.company_name || 'Smart Secretary';
  ws.getCell(1, 1).font = { bold: true, size: 16 };
  ws.getCell(2, 1).value = `${def.title} — ${new Date().toLocaleDateString('en-GB')} — ${req.user.name}`;
  const brandPrimary = (s.brand_primary || '#7c3aed').replace('#', '');
  const header = ws.getRow(4);
  def.cols.forEach((c, i) => { const cell = header.getCell(i + 1); cell.value = COLS_AR[c] || c; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + brandPrimary } }; });
  rows.forEach(r => ws.addRow(def.cols.map(c => r[c] ?? '')));
  ws.columns.forEach(c => c.width = 22);
  pushAudit(req, 'export', 'reports', 'report', null, def.title);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="report-${req.params.name}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ---------- backup ----------
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
R.get('/backup', auth, P('backup', 'view'), (req, res) => {
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db'))
    .map(f => ({ name: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size, at: fs.statSync(path.join(BACKUP_DIR, f)).mtime }))
    .sort((a, b) => b.at - a.at);
  res.json({ data: files });
});
R.post('/backup', auth, P('backup', 'create'), (req, res) => {
  const name = `backup-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.db`;
  try { flush(); } catch {}
  fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, name));
  pushAudit(req, 'create', 'backup', 'backup', null, name);
  res.status(201).json({ name });
});
R.get('/backup/:name/download', auth, P('backup', 'export'), (req, res) => {
  const fp = path.join(BACKUP_DIR, path.basename(req.params.name));
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'النسخة غير موجودة' });
  pushAudit(req, 'export', 'backup', 'backup', null, req.params.name);
  res.download(fp);
});
R.post('/backup/:name/restore', auth, P('backup', 'manage'), (req, res) => {
  const fp = path.join(BACKUP_DIR, path.basename(req.params.name));
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'النسخة غير موجودة' });
  fs.copyFileSync(fp, DB_PATH + '.restore');
  pushAudit(req, 'update', 'backup', 'restore', null, req.params.name);
  res.json({ ok: true, needRestart: true, message: 'تم تجهيز الاستعادة — أعد تشغيل التطبيق لإتمامها' });
});

// ---------- smart assistant (محلي، يحترم الصلاحيات) ----------
R.post('/assistant', auth, P('assistant', 'view'), (req, res) => {
  const text = String(req.body?.text || '').trim();
  const confirmed = !!req.body?.confirmed;
  const pending = req.body?.pending;
  const p = req.user.perms, t = today();
  const out = { reply: '', cards: [], actions: [], pending: null };
  if (pending && confirmed) {
    if (pending.intent === 'add_task' && can(p, 'tasks', 'create')) {
      const info = db.prepare('INSERT INTO tasks (title, assignee_id, due_date, status, created_by) VALUES (?,?,?,?,?)')
        .run(pending.title, req.user.id, pending.due || t, 'new', req.user.id);
      pushAudit(req, 'create', 'tasks', 'task', info.lastInsertRowid, 'عبر المساعد الذكي: ' + pending.title);
      out.reply = `تم إنشاء المهمة: ${pending.title} (مستحقة ${pending.due || 'اليوم'})`;
      out.actions = [{ label: 'فتح المهام', link: '/tasks' }];
      return res.json(out);
    }
    if (pending.intent === 'add_note' && can(p, 'notes', 'create')) {
      db.prepare('INSERT INTO notes (title, body, user_id) VALUES (?,?,?)').run(pending.title, pending.title, req.user.id);
      out.reply = `تم حفظ الملاحظة: ${pending.title}`;
      out.actions = [{ label: 'فتح الملاحظات', link: '/notes' }];
      return res.json(out);
    }
    return res.json({ reply: 'انتهت صلاحية التأكيد أو لا تملك الصلاحية.' });
  }
  const has = (...words) => words.some(w => text.includes(w));
  if (has('مهام') && has('اليوم') || text.includes('مهامي')) {
    if (!can(p, 'tasks', 'view')) return res.json({ reply: 'لا تملك صلاحية عرض المهام.' });
    const rows = db.prepare(`SELECT id, title, priority, due_date, status FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('completed','cancelled') AND (due_date<=? OR assignee_id=?) ORDER BY due_date LIMIT 10`).all(t, req.user.id);
    out.reply = rows.length ? `لديك ${rows.length} مهام تحتاج انتباهك:` : 'لا توجد مهام مستحقة — يومك منظم.';
    out.cards = rows.map(r => ({ title: r.title, sub: `استحقاق: ${r.due_date || '—'} — ${r.status}`, link: '/tasks' }));
    out.actions = [{ label: 'فتح المهام', link: '/tasks' }];
  } else if (has('متأخر')) {
    const rows = db.prepare(`SELECT id, title, due_date FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('completed','cancelled') AND due_date<? LIMIT 10`).all(t);
    out.reply = rows.length ? `${rows.length} مهام متأخرة:` : 'لا توجد مهام متأخرة.';
    out.cards = rows.map(r => ({ title: r.title, sub: `كان الاستحقاق: ${r.due_date}`, link: '/tasks' }));
  } else if (has('مواعيد', 'موعد', 'اجتماع')) {
    if (!can(p, 'appointments', 'view')) return res.json({ reply: 'لا تملك صلاحية عرض المواعيد.' });
    const rows = db.prepare(`SELECT a.title, a.date, a.start_time, c.name client FROM appointments a LEFT JOIN clients c ON c.id=a.client_id WHERE a.deleted_at IS NULL AND a.status='scheduled' AND a.date>=? ORDER BY a.date, a.start_time LIMIT 8`).all(t);
    out.reply = rows.length ? 'مواعيدك القادمة:' : 'لا توجد مواعيد قادمة مجدولة.';
    out.cards = rows.map(r => ({ title: r.title, sub: `${r.date} ${r.start_time} — ${r.client || 'بدون عميل'}`, link: '/appointments' }));
  } else if (has('متابعة') && has('عملاء', 'عميل')) {
    if (!can(p, 'clients', 'view')) return res.json({ reply: 'لا تملك صلاحية عرض العملاء.' });
    const rows = db.prepare(`SELECT c.id, c.name, c.phone FROM clients c LEFT JOIN calls cl ON cl.client_id=c.id WHERE c.deleted_at IS NULL AND c.status IN ('potential','active') GROUP BY c.id ORDER BY MAX(cl.started_at) IS NULL DESC, MAX(cl.started_at) LIMIT 8`).all();
    out.reply = 'عملاء قد يحتاجون متابعة:';
    out.cards = rows.map(r => ({ title: r.name, sub: r.phone || '', link: '/clients' }));
  } else if (has('حجوزات', 'حجز')) {
    if (!can(p, 'reservations', 'view')) return res.json({ reply: 'لا تملك صلاحية عرض الحجوزات.' });
    const rows = db.prepare(`SELECT r.code, r.status, r.reservation_date, u.code unit, c.name client FROM reservations r JOIN units u ON u.id=r.unit_id JOIN clients c ON c.id=r.client_id WHERE r.status='active' ORDER BY r.id DESC LIMIT 8`).all();
    out.reply = rows.length ? `لديك ${rows.length} حجوزات نشطة:` : 'لا توجد حجوزات نشطة حاليًا.';
    out.cards = rows.map(r => ({ title: `${r.code} — ${r.unit}`, sub: `${r.client} — ${r.reservation_date}`, link: '/reservations' }));
  } else if (has('مبيعات', 'مبيع')) {
    if (!can(p, 'sales', 'view')) return res.json({ reply: 'لا تملك صلاحية عرض المبيعات.' });
    const s = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(net_price),0) total FROM sales`).get();
    out.reply = `إجمالي المبيعات: ${s.n} عمليات بقيمة ${Number(s.total).toLocaleString('en')} ${settingsObj().currency || ''}`;
    out.actions = [{ label: 'فتح المبيعات', link: '/sales' }];
  } else if (has('وحدات', 'شقق', 'متاح')) {
    if (!can(p, 'units', 'view')) return res.json({ reply: 'لا تملك صلاحية عرض الوحدات.' });
    const rows = db.prepare(`SELECT u.code, u.price, u.rooms, p.code project FROM units u JOIN projects p ON p.id=u.project_id WHERE u.status IN ('available','resale') ORDER BY u.price LIMIT 8`).all();
    out.reply = `يوجد ${db.prepare(`SELECT COUNT(*) c FROM units WHERE status IN ('available','resale')`).get().c} وحدات متاحة:`;
    out.cards = rows.map(r => ({ title: `${r.code} — مشروع ${r.project}`, sub: `${r.rooms} غرف — ${Number(r.price).toLocaleString('en')}`, link: '/units' }));
  } else if (has('أضف مهمة', 'اضف مهمة', 'مهمة جديدة', 'أنشئ مهمة', 'انشئ مهمة')) {
    if (!can(p, 'tasks', 'create')) return res.json({ reply: 'لا تملك صلاحية إنشاء المهام.' });
    let title = text.replace(/أضف مهمة|اضف مهمة|مهمة جديدة|أنشئ مهمة|انشئ مهمة|لـ|:/g, '').trim() || 'مهمة جديدة';
    let due = t;
    if (text.includes('غد')) { const d = new Date(); d.setDate(d.getDate() + 1); due = d.toISOString().slice(0, 10); }
    out.reply = `سأنشئ مهمة: "${title}" مستحقة ${due}. أكّد التنفيذ.`;
    out.pending = { intent: 'add_task', title, due };
  } else if (has('ملاحظة', 'سجل ملاحظة', 'احفظ')) {
    if (!can(p, 'notes', 'create')) return res.json({ reply: 'لا تملك صلاحية إنشاء الملاحظات.' });
    const title = text.replace(/سجل ملاحظة|ملاحظة|احفظ|:|"/g, '').trim() || 'ملاحظة جديدة';
    out.reply = `سأحفظ ملاحظة: "${title}". أكّد التنفيذ.`;
    out.pending = { intent: 'add_note', title };
  } else if (has('مساعدة', 'ماذا يمكنك', 'أوامر')) {
    out.reply = 'يمكنني مساعدتك في: مهامي اليوم — المواعيد القادمة — العملاء الذين يحتاجون متابعة — الحجوزات الحالية — المبيعات — الوحدات المتاحة — إضافة مهمة — حفظ ملاحظة. العمليات الحساسة (الحذف والمالية) تتطلب تأكيدًا ولا أنفذها تلقائيًا.';
  } else {
    out.reply = 'لم أفهم طلبك تمامًا. جرّب: "ما هي مهامي اليوم؟" أو "اعرض الحجوزات الحالية" أو اكتب "مساعدة".';
  }
  res.json(out);
});

module.exports = R;
