// Smart Secretary — Server entry
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const jwt = require('jsonwebtoken');

const DATA_BASE = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const RESTORE = path.join(DATA_BASE, 'smart-secretary.db.restore');
const DBF = process.env.DB_PATH || path.join(DATA_BASE, 'smart-secretary.db');
if (fs.existsSync(RESTORE)) {
  try {
    if (fs.existsSync(DBF)) fs.copyFileSync(DBF, DBF + '.before-restore-' + Date.now());
    fs.copyFileSync(RESTORE, DBF);
    fs.unlinkSync(RESTORE);
    console.log('[DB] restored from backup');
  } catch (e) { console.error('[DB] restore failed', e.message); }
}

const { db, init, DATA_DIR } = require('./db');
const { auth, requirePerm: P, audit, JWT_SECRET } = require('./auth');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => { const t = Date.now(); res.on('finish', () => { if (process.env.LOG === '1') console.log(req.method, req.url, res.statusCode, Date.now() - t + 'ms'); }); next(); });

// ---------- file uploads ----------
const FILES_DIR = path.join(DATA_DIR, 'files');
if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const d = path.join(FILES_DIR, new Date().toISOString().slice(0, 7));
    fs.mkdirSync(d, { recursive: true });
    cb(null, d);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + path.extname(file.originalname || '').slice(0, 10))
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

app.get('/api/files', auth, P('files', 'view'), (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1), limit = Math.min(100, parseInt(req.query.limit) || 24);
  let w = 'f.deleted_at IS NULL', ps = [];
  if (req.query.q) { w += ' AND (f.original_name LIKE ? OR f.category LIKE ?)'; ps.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.category) { w += ' AND f.category=?'; ps.push(req.query.category); }
  const total = db.prepare(`SELECT COUNT(*) c FROM files f WHERE ${w}`).get(...ps).c;
  const rows = db.prepare(`SELECT f.*, u.name uploader FROM files f LEFT JOIN users u ON u.id=f.uploaded_by WHERE ${w} ORDER BY f.id DESC LIMIT ? OFFSET ?`).all(...ps, limit, (page - 1) * limit);
  res.json({ data: rows, total, page, pages: Math.ceil(total / limit) || 1 });
});
app.post('/api/files/upload', auth, P('files', 'create'), upload.array('files', 10), (req, res) => {
  const { category = 'general', tags = '[]', client_id, task_id, appointment_id, project_id, unit_id } = req.body || {};
  const ins = db.prepare('INSERT INTO files (name, original_name, stored_name, mime, size, category, tags, client_id, task_id, appointment_id, project_id, unit_id, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const out = (req.files || []).map(f => {
    const info = ins.run(f.originalname, f.originalname, path.relative(FILES_DIR, f.path), f.mimetype, f.size, category, tags,
      client_id || null, task_id || null, appointment_id || null, project_id || null, unit_id || null, req.user.id);
    audit({ ...req.user, ip: req.ip }, 'create', 'files', 'file', info.lastInsertRowid, f.originalname);
    return { id: info.lastInsertRowid, name: f.originalname, size: f.size };
  });
  // إشعار للمدير عند رفع ملف مهم
  res.status(201).json({ files: out });
});
app.put('/api/files/:id', auth, P('files', 'edit'), (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'الملف غير موجود' });
  const { name, category, tags } = req.body || {};
  db.prepare('UPDATE files SET original_name=?, category=?, tags=? WHERE id=?').run(name || f.original_name, category || f.category, tags || f.tags, f.id);
  audit({ ...req.user, ip: req.ip }, 'update', 'files', 'file', f.id, name || '');
  res.json({ ok: true });
});
app.delete('/api/files/:id', auth, P('files', 'delete'), (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'الملف غير موجود' });
  db.prepare('UPDATE files SET deleted_at=datetime(\'now\',\'localtime\') WHERE id=?').run(f.id);
  audit({ ...req.user, ip: req.ip }, 'delete', 'files', 'file', f.id, f.original_name);
  res.json({ ok: true });
});
// تحميل/معاينة آمنة برمز مؤقت
app.get('/api/files/:id/raw', (req, res) => {
  try {
    const payload = jwt.verify(req.query.token || '', JWT_SECRET);
    const f = db.prepare('SELECT * FROM files WHERE id=? AND deleted_at IS NULL').get(req.params.id);
    if (!f) return res.status(404).send('غير موجود');
    const fp = path.join(FILES_DIR, f.stored_name);
    if (!fp.startsWith(FILES_DIR) || !fs.existsSync(fp)) return res.status(404).send('غير موجود');
    if (req.query.dl === '1') res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
    else res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Content-Type', f.mime || 'application/octet-stream');
    fs.createReadStream(fp).pipe(res);
  } catch { res.status(401).send('غير مصرح'); }
});

app.use('/api', require('./api'));
app.use('/api', require('./api2'));

app.get('/api/health', (req, res) => res.json({ ok: true, version: '1.0.0', time: new Date().toISOString() }));

// production: serve built client
const DIST = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(path.join(DIST, 'index.html'))) {
  app.use(express.static(DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(DIST, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'خطأ داخلي في الخادم' });
});

const PORT = process.env.PORT || 3847;
init().then(() => {
  app.listen(PORT, '127.0.0.1', () => console.log(`[API] Smart Secretary on http://127.0.0.1:${PORT}`));
}).catch((e) => { console.error('[DB] init failed:', e.message); process.exit(1); });
