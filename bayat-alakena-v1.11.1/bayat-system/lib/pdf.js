// ============================================================
// محرك مستندات PDF عربي RTL بهوية بيات الأكنة — v1.5
// الأساس المنطقي: النص العربي يُمرر كما هو (fontkit يتولى
// التشكيل واتجاه RTL) — ورمز الريال السعودي يُرسم متجهيًا.
// ============================================================
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { SAR_MARK, drawRiyalPDF, BBOX: SAR_BBOX } = require('./riyal');
const { buildNormalization } = require('./fontfit');

// اختيار خط النظام: Expo Arabic إن وُجد وإلا أميري
function pickFonts() {
  const dir = path.join(__dirname, '..', 'fonts');
  const expoReg = ['ExpoArabic-Book.ttf', 'ExpoArabic-Regular.ttf'].find(f => fs.existsSync(path.join(dir, f)));
  const expoBold = ['ExpoArabic-Medium.ttf', 'ExpoArabic-Bold.ttf'].find(f => fs.existsSync(path.join(dir, f)));
  if (expoReg) return { reg: path.join(dir, expoReg), bold: path.join(dir, expoBold || expoReg), name: 'Expo Arabic' };
  return { reg: path.join(dir, 'Amiri-Regular.ttf'), bold: path.join(dir, 'Amiri-Bold.ttf'), name: 'Amiri' };
}
const FONT_FILES = pickFonts();
const FONT_NORM = buildNormalization(FONT_FILES.reg);


// ============================================================
// ترتيب العناصر البصري (RTL) — الطبقة الوحيدة المسؤولة عن
// اتجاه النص: تعكس ترتيب الكلمات/الجزر اللاتينية مرة واحدة،
// وتبقي حروف كل كلمة كما هي (fontkit يتولى ترتيب الحروف).
// تُطبق عند نقاط الإخراج النهائية فقط — لا انعكاس مزدوج.
// ============================================================
const AR_CHAR = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
function visualTokenOrder(str) {
  const s = String(str ?? '');
  if (!AR_CHAR.test(s)) return s; // نص لاتيني/أرقام: يبقى كما هو
  const tokens = s.split(/\s+/).filter(Boolean);
  const isR = t => AR_CHAR.test(t);
  const isL = t => /[A-Za-z0-9]/.test(t);
  const elements = [];
  let island = null;
  const flush = () => { if (island) { elements.push({ ltr: island }); island = null; } };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (isR(t)) { flush(); elements.push({ rtl: t }); continue; }
    if (isL(t)) { island = island || []; island.push(t); continue; }
    const prevL = i > 0 && isL(tokens[i - 1]);
    const nextL = i + 1 < tokens.length && isL(tokens[i + 1]);
    if (island && (prevL || nextL)) island.push(t);
    else if (nextL) island = [t];
    else { flush(); elements.push({ rtl: t }); }
  }
  flush();
  const out = [];
  for (let i = elements.length - 1; i >= 0; i--) {
    const e = elements[i];
    if (e.ltr) out.push(...e.ltr);
    else out.push(e.rtl);
  }
  return out.join(' ');
}

const fmtMoney = n => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(+n || 0));
const fmtNum = n => new Intl.NumberFormat('en-US').format(+n || 0);

// توافق قديم: تُستخدم في أماكن محدودة وتعيد النص كما هو (منطقي)
function visualWord(w) { return String(w); }
function visualTokens(text) { return String(text ?? '').split(/\s+/).filter(Boolean); }

class ArabicPDF {
  constructor({ settings = {}, title = '', subtitle = '', user = null, docNo = '', type = 'doc', landscape = false }) {
    this.W = landscape ? 841.89 : 595.28;
    this.H = landscape ? 595.28 : 841.89;
    this.MG = 42;
    this.settings = settings;
    this.coAr = settings.company_name_ar || '';
    this.coEn = settings.company_name_en || '';
    this.siteName = settings.site_name || this.coAr || '';
    this.title = title; this.subtitle = subtitle; this.user = user; this.docNo = docNo;
    this.navy = settings.secondary_color || '#192E56';
    this.wine = settings.primary_color || '#972B32';
    this.gold = settings.accent_color || '#B79552';
    this.ink = '#1d2a42'; this.muted = '#718096'; this.line = '#e5e8ee';
    this.doc = new PDFDocument({ size: [this.W, this.H], margin: this.MG, bufferPages: true, autoFirstPage: false,
      info: { Title: title, Author: this.coEn || 'BAYAT ALAKENA' } });
    this.doc.registerFont('ar', FONT_FILES.reg);
    this.doc.registerFont('arb', FONT_FILES.bold);
    this.font = 'ar'; this.size = 10;
    this.pageNo = 0;
    this.doc.on('pageAdded', () => {
      this.pageNo++;
      // منع التقسيم التلقائي للصفحات من pdfkit — المحرك يدير الفواصل بنفسه
      // (يحمي منطقة الفوتر المحجوزة من دخول المحتوى أو العكس)
      try { this.doc.page.maxY = () => this.H; } catch { }
      this._header();
    });
    this._logoPath = this._resolveLogo(); // قبل الصفحة الأولى كي يظهر الشعار في كل الترويسات
    this.doc.addPage();
    this.y = 128;
    this.chunks = [];
    this.doc.on('data', c => this.chunks.push(c));
  }
  _resolveLogo() {
    const url = this.settings.logo_url || '';
    if (!url.startsWith('/uploads/')) return null;
    const dir = process.env.BAYAT_UPLOAD_DIR || path.join(__dirname, '..', 'public', 'uploads');
    const p = path.join(dir, path.basename(url));
    return fs.existsSync(p) ? p : null;
  }

  // منطقة المحتوى المسموحة — الفوتر محجوز دائمًا أسفلها
  contentBottom() { return this.H - 60; }

  // ===== ترويسة وتذييل =====
  _header() {
    const d = this.doc;
    const cAr = this.coAr || this.siteName;
    if (this.pageNo === 1) {
      d.rect(0, 0, this.W, 110).fill(this.navy);
      d.rect(0, 110, this.W, 3).fill(this.gold);
      d.rect(0, 113, this.W, 1.5).fill(this.wine);
      const lx = this.W - this.MG - 56;
      if (this._logoPath) { try { d.save(); d.circle(lx + 28, 56, 27).clip(); d.image(this._logoPath, lx, 28, { fit: [56, 56] }); d.restore(); } catch { this._monogram(lx, 28); } }
      else this._monogram(lx, 28);
      const nameX = this.W - this.MG - 70;
      this._drawLogical(nameX, 26, cAr, '#ffffff', true, 16.5, 'right', 310);
      this._drawLogical(nameX, 55, this.coEn || '', this.gold, false, 8.5, 'right', 310);
      this._drawLogical(nameX, 70, this.siteName, '#c9d3e4', false, 8.5, 'right', 310);
      const now = new Date();
      const dt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      this._drawLineLeft([this.title], this.MG, 24, 250, this.gold, true, 13.5);
      if (this.subtitle) this._drawLineLeft([this.subtitle], this.MG, 46, 250, '#dfe6f2', false, 9);
      this._drawLineLeft(['رقم المستند: ' + (this.docNo || '—')], this.MG, 72, 250, '#aeb9cf', false, 7.5);
      this._drawLineLeft(['أنشأه: ' + (this.user?.name || 'النظام') + ' • ' + dt], this.MG, 84, 250, '#aeb9cf', false, 7.5);
      this.y = 132;
    } else {
      d.rect(0, 0, this.W, 34).fill(this.navy);
      d.rect(0, 34, this.W, 1.5).fill(this.gold);
      let nameX2 = this.W - this.MG;
      if (this._logoPath) { try { d.image(this._logoPath, this.W - this.MG - 22, 5, { fit: [24, 24] }); nameX2 -= 30; } catch { } }
      this._drawLogical(nameX2, 6, cAr || this.siteName, '#ffffff', true, 9.5, 'right', 260);
      this._drawLineLeft([this.title], this.MG, 11, 250, this.gold, false, 8.5);
      this.y = 52;
    }
    d.fillColor(this.ink);
  }
  _monogram(x, y) {
    const d = this.doc;
    d.save(); d.circle(x + 28, y + 28, 27); d.lineWidth(1.4); d.strokeColor(this.gold); d.stroke(); d.restore();
    d.fillColor(this.gold).font('arb').fontSize(30);
    d.text((this.siteName || 'ب').trim()[0] || 'ب', x + 19, y + 11, { lineBreak: false });
  }
  // سطر تواصل مركزي من إعدادات الشركة
  _contactLine() {
    const s = this.settings;
    const parts = [];
    if (s.phone_main) parts.push('هاتف: ' + s.phone_main + (s.phone_extra ? ' / ' + s.phone_extra : ''));
    if (s.whatsapp && s.whatsapp !== s.phone_main) parts.push('واتساب: ' + s.whatsapp);
    if (s.email) parts.push(s.email);
    if (s.contact_website || s.website) parts.push(s.contact_website || s.website);
    return parts.join('  •  ');
  }
  // لف نص إلى أسطر بعرض معين (للفوتر) — بلا تدفق صفحات
  _wrapToWidth(str, maxW, size, bold = false) {
    const d = this.doc;
    d.font(bold ? 'arb' : 'ar').fontSize(size);
    const out = [];
    let line = '';
    for (const word of String(str ?? '').split(/\s+/).filter(Boolean)) {
      const cand = line ? line + ' ' + word : word;
      if (d.widthOfString(cand) <= maxW || !line) line = cand;
      else { out.push(line); line = word; }
    }
    if (line) out.push(line);
    return out;
  }

  addFooters() {
    const d = this.doc;
    const range = d.bufferedPageRange();
    const total = range.count;
    const footTop = this.H - 56; // منطقة الفوتر المحجوزة
    const W = this.W, M = this.MG;
    for (let i = range.start; i < range.start + range.count; i++) {
      d.switchToPage(i);
      d.rect(0, footTop, W, 1.2).fill(this.gold);
      // يمين: الشركة + اسم الموقع + الحقوق (لف تلقائي داخل المنطقة)
      const brand = ((this.coAr || this.siteName) + ' — ' + this.siteName + ' — جميع الحقوق محفوظة').replace(/^ — /, '');
      this._wrapToWidth(brand, 230, 7).forEach((ln, k) => {
        d.font('ar').fontSize(7).fillColor('#9aa3b2');
        d.text(visualTokenOrder(ln), W - M - 230, footTop + 6 + k * 8.5, { width: 230, align: 'right', lineBreak: false });
      });
      // يسار: بيانات التواصل (لف تلقائي داخل المنطقة)
      const cl = this._contactLine();
      if (cl) this._wrapToWidth(cl, 210, 6.8).forEach((ln, k) => {
        d.font('ar').fontSize(6.8).fillColor('#8f99ab');
        d.text(visualTokenOrder(ln), M, footTop + 6 + k * 8.2, { width: 210, align: 'left', lineBreak: false });
      });
      // منتصف: رقم الصفحة (سطر واحد ثابت)
      d.font('arb').fontSize(7.5).fillColor('#7c879b');
      d.text(visualTokenOrder(`صفحة ${i + 1 - range.start} من ${total}`), W / 2 - 70, footTop + 8, { width: 140, align: 'center', lineBreak: false });
    }
    d.switchToPage(range.start + range.count - 1);
  }

  // ===== طبقة الرسم المنطقية =====
  _sarW(size) { return size * 1.08 * (SAR_BBOX.w / SAR_BBOX.h); }
  _segWidths(str, size, bold = false) {
    const d = this.doc; d.font(bold ? 'arb' : 'ar').fontSize(size);
    const segs = String(str ?? '').split(SAR_MARK);
    const gap = d.widthOfString(' ');
    let total = 0;
    segs.forEach((s, i) => {
      if (s) total += d.widthOfString(s);
      if (i < segs.length - 1) { total += this._sarW(size); if (s) total += gap; }
    });
    return total;
  }
  // يرسم كتلًا منطقية من اليمين لليسار مع قص اختياري
  _drawLogicalBlocks(xRight, y, str, color, bold, size, rowH, clipX, clipW) {
    const d = this.doc;
    d.font(bold ? 'arb' : 'ar').fontSize(size).fillColor(color || this.ink);
    const segs = String(str ?? '').split(SAR_MARK);
    const gap = d.widthOfString(' ');
    let xr = xRight;
    d.save();
    if (clipW != null) d.rect(clipX, y - 3, clipW, rowH + 6).clip();
    segs.forEach((s, i) => {
      if (i > 0) { const sw = this._sarW(size); drawRiyalPDF(d, xr, y + size * 0.85, size, color || this.ink); xr -= sw + gap; }
      if (s) { const vs = visualTokenOrder(s); const w = d.widthOfString(vs); d.text(vs, xr - w, y, { lineBreak: false }); xr -= w + gap; }
    });
    d.restore();
  }
  _drawLogical(xRight, y, str, color, bold, size, align = 'right', maxW = null) {
    const total = this._segWidths(str, size, bold);
    let xr = xRight;
    if (align === 'center' && maxW) xr = xRight - Math.max(0, maxW - total) / 2;
    const clipW = (maxW ? Math.min(maxW, total) : total) + 2;
    this._drawLogicalBlocks(xr, y, str, color, bold, size, size + 14, xr - clipW, clipW);
    return total;
  }
  _drawLineRight(tokens, xRight, y, maxW, color, bold = false, size = 10) {
    return this._drawLogical(xRight, y, tokens.join(' '), color, bold, size, 'right', maxW);
  }
  _drawLineLeft(tokens, xLeft, y, maxW, color, bold = false, size = 10) {
    const d = this.doc; d.font(bold ? 'arb' : 'ar').fontSize(size).fillColor(color || this.ink);
    const str = visualTokenOrder(tokens.join(' '));
    d.save(); d.rect(xLeft, y - 3, maxW + 2, size + 14).clip();
    d.text(str, xLeft, y, { width: maxW, align: 'left', lineBreak: false });
    d.restore();
    return d.widthOfString(str);
  }

  // ===== نص متعدد الأسطر (لف منطقي) =====
  text(str, { x = null, y = null, w = null, size = 10, color = null, bold = false, align = 'right', lineGap = 5 } = {}) {
    const d = this.doc;
    if (x != null) this.xLeft = x; else x = this.xLeft ?? this.MG;
    if (w != null) this.textW = w; else w = this.textW ?? (this.W - 2 * this.MG);
    if (y != null) this.y = y;
    const col = color || this.ink;
    d.font(bold ? 'arb' : 'ar').fontSize(size).fillColor(col);
    const sp = d.widthOfString(' ');
    const words = String(str ?? '').split(/\s+/).filter(Boolean);
    const lines = [[]]; let wcur = 0;
    for (const word of words) {
      const ww = word.includes(SAR_MARK)
        ? word.split(SAR_MARK).reduce((a, s, i, arr) => a + d.widthOfString(s) + (i < arr.length - 1 ? this._sarW(size) : 0), 0)
        : d.widthOfString(word);
      if (wcur && wcur + sp + ww > w) { lines.push([]); wcur = 0; }
      lines[lines.length - 1].push(word);
      wcur += (wcur ? sp : 0) + ww;
    }
    for (const line of lines) {
      if (this.y + size + 10 > this.contentBottom()) { d.addPage(); }
      this._drawLogical(x + w, this.y, line.join(' '), col, bold, size, align, w);
      this.y += size + lineGap;
    }
    return this.y;
  }

  sectionTitle(t) {
    const d = this.doc;
    if (this.y + 30 > this.contentBottom()) d.addPage();
    d.save(); d.circle(this.W - this.MG - 4, this.y + 7, 3.2).fill(this.gold); d.restore();
    d.rect(this.W - this.MG - 10, this.y + 1, 3.2, 12).fill(this.wine);
    this._drawLogical(this.W - this.MG - 20, this.y - 1, t, this.navy, true, 12.5);
    this.y += 24;
  }

  kvGrid(pairs, { cols = 3, boxH = 44 } = {}) {
    const d = this.doc;
    const gap = 8; const bw = (this.W - 2 * this.MG - gap * (cols - 1)) / cols;
    pairs.forEach((p, i) => {
      if (i % cols === 0 && this.y + boxH + 6 > this.contentBottom()) d.addPage();
      const col = i % cols;
      const x = this.W - this.MG - bw - col * (bw + gap);
      const y = this.y + Math.floor(i / cols) * (boxH + gap);
      d.save(); this.rrect(x, y, bw, boxH, 5); d.lineWidth(.8); d.strokeColor(this.line); d.fillAndStroke('#f8f7f4', this.line); d.restore();
      d.rect(x, y, 2.5, boxH).fill(this.gold);
      this._drawLogical(x + bw - 8, y + 6, String(p[0]), this.muted, false, 7.5, 'right', bw - 16);
      this._drawLogical(x + bw - 8, y + 20, String(p[1] ?? '—'), this.ink, true, 10.5, 'right', bw - 16);
    });
    this.y += Math.ceil(pairs.length / cols) * (boxH + gap) + 6;
    return this.y;
  }

  // ===== لف نص خلية إلى أسطر حسب عرض العمود (منطقي — BiDi يتولاه fontkit لكل سطر) =====
  _wrapCell(str, maxW, size, bold) {
    const d = this.doc;
    d.font(bold ? 'arb' : 'ar').fontSize(size);
    const wordW = word => {
      let w = 0;
      const parts = String(word).split(SAR_MARK);
      parts.forEach((s, i) => {
        if (s) w += d.widthOfString(s);
        if (i < parts.length - 1) w += this._sarW(size);
      });
      return w;
    };
    const out = [];
    for (const word of String(str ?? '').split(/\s+/).filter(Boolean)) {
      let ww = wordW(word);
      if (ww > maxW && word.length > 3) {
        // كلمة واحدة أطول من العمود: تُقسم قسريًا دون فقد أي محرف
        let chunk = '';
        for (const ch of word) {
          const cw = wordW(ch);
          if (chunk && wordW(chunk) + cw > maxW) { out.push(chunk); chunk = ch; }
          else chunk += ch;
        }
        if (chunk) out.push(chunk);
        continue;
      }
      const last = out.length ? out[out.length - 1] : null;
      if (last && wordW(last) + d.widthOfString(' ') + ww <= maxW) out[out.length - 1] = last + ' ' + word;
      else out.push(word);
    }
    return out.length ? out : [''];
  }

  table({ cols, rows, totals = null, fontSize = 8, headerBg = null, rowH = null }) {
    const d = this.doc;
    const pad = 6;
    const avail = this.W - 2 * this.MG;
    const cellStr = (c, r) => { const v = c.fn ? c.fn(r) : r[c.key]; return String((v && typeof v === 'object') ? v.t : (v ?? '')); };
    const cellColor = (c, r) => { const v = c.fn ? c.fn(r) : r[c.key]; return (v && typeof v === 'object' && v.c) ? v.c : null; };
    const sizeOf = c => c.size || fontSize;
    // 1) الحد الأدنى لكل عمود = أعرض كلمة غير قابلة للكسر + الحشو
    const minW = cols.map((c, ci) => {
      d.font(c.bold ? 'arb' : 'ar').fontSize(sizeOf(c));
      let mx = 0;
      const texts = [String(c.label ?? '')];
      rows.forEach(r => texts.push(cellStr(c, r)));
      if (totals) texts.push(String((totals[ci] && typeof totals[ci] === 'object') ? totals[ci].t : (totals[ci] ?? '')));
      for (const t of texts) for (const word of t.split(/\s+/)) {
        let w = 0;
        word.split(SAR_MARK).forEach((s, i, a) => { if (s) w += d.widthOfString(s); if (i < a.length - 1) w += this._sarW(sizeOf(c)); });
        mx = Math.max(mx, w);
      }
      return mx + 2 * pad + 2;
    });
    // 2) توزيع الأعمدة أو تقسيمها أفقيًا على صفحات إضافية
    let groups, widthsFor;
    const sumMin = minW.reduce((a, b) => a + b, 0);
    if (sumMin <= avail) {
      groups = [cols.map((_, i) => i)];
      let widths = cols.map((c, i) => Math.max(c.w * avail, minW[i]));
      const s = widths.reduce((a, b) => a + b, 0);
      if (s > avail) {
        const flex = widths.reduce((a, w, i) => a + (w - minW[i]), 0);
        widths = widths.map((w, i) => flex > 0 ? w - (w - minW[i]) * (s - avail) / flex : w);
      } else if (s < avail) {
        widths = widths.map(w => w + (avail - s) * (w / s));
      }
      widthsFor = idxs => idxs.map(i => widths[i]);
    } else {
      groups = []; let cur = [], curW = 0;
      minW.forEach((mw, i) => {
        if (curW + mw > avail && cur.length) { groups.push(cur); cur = []; curW = 0; }
        cur.push(i); curW += mw;
      });
      if (cur.length) groups.push(cur);
      widthsFor = idxs => {
        const ws = idxs.map(i => minW[i]);
        const s = ws.reduce((a, b) => a + b, 0);
        return s < avail ? ws.map(w => w + (avail - s) * (w / s)) : ws;
      };
    }
    // 3) الرسم لكل مجموعة أعمدة (المجموعات الإضافية تبدأ بصفحة جديدة)
    groups.forEach((idxs, gi) => {
      if (gi > 0) d.addPage();
      const widths = widthsFor(idxs);
      const gCols = idxs.map(i => cols[i]);
      const lefts = []; let ax = this.W - this.MG;
      widths.forEach(w => { lefts.push({ x: ax - w, w }); ax -= w; });
      const drawHeader = () => {
        if (this.y + 30 > this.contentBottom()) d.addPage();
        d.rect(this.MG, this.y, avail, Math.max(rowH ? rowH + 4 : 26, 24)).fill(headerBg || this.navy);
        gCols.forEach((c, j) => {
          const lines = this._wrapCell(String(c.label ?? ''), widths[j] - 2 * pad, sizeOf(c), true);
          const lh = (sizeOf(c)) + 3;
          const h = Math.max(rowH ? rowH + 4 : 26, 24);
          let ty = this.y + (h - lines.length * lh) / 2 + 1;
          d.font('arb').fontSize(sizeOf(c)).fillColor('#ffffff');
          lines.forEach(ln => { this._drawLogicalBlocks(lefts[j].x + widths[j] - pad, ty, ln, '#ffffff', true, sizeOf(c), lh, lefts[j].x, widths[j]); ty += lh; });
        });
        this.y += Math.max(rowH ? rowH + 4 : 26, 24);
      };
      drawHeader();
      const drawBodyRow = (cells, { bg, fg = this.ink, bold = false }) => {
        // لف كل خلية وحساب ارتفاع الصف ديناميكيًا
        const wrapped = cells.map((cell, j) => this._wrapCell(String(cell.t ?? cell ?? ''), widths[j] - 2 * pad, sizeOf(gCols[j]), bold || gCols[j].bold));
        const lh = fontSize + 3.2;
        const minH = rowH || 22;
        const h = Math.max(minH, Math.max(...wrapped.map(l => l.length)) * lh + 6);
        if (this.y + h > this.contentBottom()) { d.addPage(); drawHeader(); } // تكرار رأس الجدول في الصفحة الجديدة
        if (bg) d.rect(this.MG, this.y, avail, h).fill(bg);
        wrapped.forEach((lines, j) => {
          let ty = this.y + (h - lines.length * lh) / 2 + 1;
          const color = cells[j] && typeof cells[j] === 'object' && cells[j].c ? cells[j].c : fg;
          lines.forEach(ln => {
            this._drawLogicalBlocks(lefts[j].x + widths[j] - pad, ty, ln, color, bold || gCols[j].bold, sizeOf(gCols[j]), lh, lefts[j].x, widths[j]);
            ty += lh;
          });
        });
        d.strokeColor(this.line).lineWidth(.5);
        if (!bg) { d.moveTo(this.MG, this.y + h).lineTo(this.W - this.MG, this.y + h).stroke(); }
        this.y += h;
      };
      rows.forEach((r, ri) => drawBodyRow(gCols.map(c => (c.fn ? c.fn(r) : r[c.key])), { bg: ri % 2 ? '#f6f5f1' : null, fg: this.ink }));
      if (totals) drawBodyRow(idxs.map(i => (typeof totals[i] === 'object' ? totals[i] : totals[i])), { bg: '#efe9dc', fg: this.navy, bold: true });
      this.y += 4;
    });
    return this.y;
  }

  space(h = 10) { this.y += h; if (this.y > this.contentBottom()) this.doc.addPage(); }

  noteBox(text, { color = '#8a6d1f', bg = '#fdf6e3' } = {}) {
    const d = this.doc;
    const w = this.W - 2 * this.MG;
    const lines = Math.max(1, Math.ceil(this._measureLines(text, w - 24, 8.5)));
    const h = lines * 14 + 12;
    if (this.y + h > this.contentBottom()) d.addPage();
    d.save(); this.rrect(this.MG, this.y, w, h, 6); d.fillAndStroke(bg, this.line); d.restore();
    d.rect(this.W - this.MG - 3, this.y, 3, h).fill(this.gold);
    this.text(text, { x: this.MG + 10, w: w - 26, size: 8.5, color });
    this.y += 4;
  }
  _measureLines(str, w, size) {
    const d = this.doc; d.font('ar').fontSize(size);
    const sp = d.widthOfString(' ');
    let n = 1, cur = 0;
    for (const word of String(str).split(/\s+/)) {
      const ww = word.includes(SAR_MARK) ? this._sarW(size) : d.widthOfString(word);
      if (cur && cur + sp + ww > w) { n++; cur = 0; }
      cur += (cur ? sp : 0) + ww;
    }
    return n;
  }

  bigNumber(label, value, sub = '') {
    const d = this.doc;
    const w = (this.W - 2 * this.MG - 4 * 10) / 5;
    if (this.y + 64 > this.contentBottom()) d.addPage();
    d.save(); this.rrect(this.W - this.MG - w, this.y, w, 62, 7); d.fillAndStroke('#f8f7f4', this.line); d.restore();
    d.rect(this.W - this.MG - w, this.y, w, 3).fill(this.navy);
    const x = this.W - this.MG - w;
    this._drawLogical(x + w - 8, this.y + 8, label, this.muted, false, 7.5, 'right', w - 16);
    this._drawLogical(x + w - 8, this.y + 22, fmtMoney(value), this.wine, true, 15, 'right', w - 16);
    if (sub) this._drawLogical(x + w - 8, this.y + 43, sub, this.muted, false, 7.5, 'right', w - 16);
    this.y += 74;
  }

  contactBand() {
    const d = this.doc, s = this.settings;
    const lines = [];
    const contactParts = [];
    if (s.phone_main) contactParts.push('هاتف: ' + s.phone_main + (s.phone_extra ? ' - ' + s.phone_extra : ''));
    if (s.whatsapp && s.whatsapp !== s.phone_main) contactParts.push('واتساب: ' + s.whatsapp);
    if (contactParts.length) lines.push('للتواصل والحجز: ' + contactParts.join('  •  '));
    const infoParts = [];
    if (s.email) infoParts.push('البريد: ' + s.email);
    if (s.address) infoParts.push('العنوان: ' + s.address);
    if (s.contact_website) infoParts.push(s.contact_website);
    if (s.contact_instagram) infoParts.push(s.contact_instagram);
    if (infoParts.length) lines.push(infoParts.join('  •  '));
    const official = [];
    if (s.cr_number) official.push('س.ت: ' + s.cr_number);
    if (s.tax_number) official.push('الرقم الضريبي: ' + s.tax_number);
    if (official.length) lines.push(official.join('  •  '));
    if (s.doc_footer_note) lines.push(String(s.doc_footer_note));
    const h = 22 + lines.length * 13;
    if (this.y + h > this.contentBottom()) d.addPage();
    d.rect(this.MG, this.y, this.W - 2 * this.MG, h).fill(this.navy);
    d.rect(this.MG, this.y, this.W - 2 * this.MG, 1.5).fill(this.gold);
    lines.forEach((ln, i) => {
      const isLtr = !/[\u0600-\u06FF]/.test(ln);
      if (isLtr) d.font('ar').fontSize(8).fillColor(this.gold).text(visualTokenOrder(ln), this.MG + 12, this.y + 8 + i * 13, { width: this.W - 2 * this.MG - 24, align: 'left', lineBreak: false });
      else this._drawLogical(this.W - this.MG - 12, this.y + 8 + i * 13, ln, i === 0 ? '#ffffff' : '#e8ecf5', i === 0, i === 0 ? 9.5 : 8.5, 'right', this.W - 2 * this.MG - 24);
    });
    this.y += h + 10;
  }

  rrect(x, y, w, h, r = 5) {
    const d = this.doc;
    const k = 0.5523 * r;
    d.moveTo(x + r, y);
    d.lineTo(x + w - r, y);
    d.bezierCurveTo(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
    d.lineTo(x + w, y + h - r);
    d.bezierCurveTo(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
    d.lineTo(x + r, y + h);
    d.bezierCurveTo(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
    d.lineTo(x, y + r);
    d.bezierCurveTo(x, y + r - k, x + r - k, y, x + r, y);
  }

  async buffer() {
    this.addFooters();
    return new Promise((resolve, reject) => {
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks)));
      this.doc.on('error', reject);
      this.doc.end();
    });
  }
}

module.exports = { ArabicPDF, visualWord, visualTokens, fmtMoney, fmtNum, FONT_FILES, FONT_NORM, SAR_MARK, visualTokenOrder };
