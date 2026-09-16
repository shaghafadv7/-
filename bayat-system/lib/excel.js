// ============================================================
// بيات الأكنة — مولد تقرير المشاريع Excel (XLSX حقيقي)
// v1.9 — RTL، AutoFilter، Freeze Panes، تنسيق ريال سعودي،
// إجماليات أعلى وأسفل خارج نطاق الفلتر، بدون دمج خلايا في جدول البيانات
// ============================================================
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const MONEY = '#,##0.00 "ر.س"';
// تحويل رقم العمود إلى حروف (1→A، 26→Z، 27→AA)
function colLetter(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const STATUS_AR = {
  available: 'متاح', reserved: 'محجوز', contracted: 'متعاقد', sold: 'مباع', paid: 'مسدد بالكامل',
  unavailable: 'غير متاح', resale: 'إعادة بيع', owner: 'للمالك', investment: 'استثمار',
  active: 'نشط', cancelled: 'ملغي', converted: 'محوّل لبيع', resold: 'أعيد بيعها',
  open: 'مفتوحة', partial: 'جزئية', settled: 'تمت التصفية', none: '—', unpaid: 'غير مدفوعة',
};
const METHOD_AR = { cash: 'كاش', bank_transfer: 'حوالة بنكية', check: 'شيك' };
const PHASE_AR = { off_plan: 'تحت الإنشاء', completed: 'مكتمل' };

// ألوان حالات الوحدات (خلفية/نص) — مطابقة لألوان النظام
const STATUS_COLORS = {
  available: ['#E8F4EF', '#267456'], reserved: ['#FFF1E5', '#A85F28'], contracted: ['#E8EFF8', '#315F91'],
  sold: ['#F5E6E8', '#982D36'], paid: ['#E4F2EC', '#1E6B4F'], resale: ['#EFE9F9', '#6B4FA3'],
  owner: ['#EEF3E6', '#55703A'], unavailable: ['#ECEFF2', '#657080'], cancelled: ['#ECEFF2', '#657080'],
  converted: ['#E8EFF8', '#315F91'], active: ['#E8F4EF', '#267456'], resold: ['#E8EFF8', '#315F91'],
  settled: ['#E8F4EF', '#267456'], open: ['#F5E6E8', '#982D36'], partial: ['#FFF1E5', '#A85F28'],
  unpaid: ['#F5E6E8', '#982D36'],
};

// تعريف الأعمدة: مفتاح = حقل الصف، w = العرض، money = تنسيق ريال، status = تلوين حسب الحالة
const COLS = [
  { header: 'المشروع', key: 'project_name', w: 18 },
  { header: 'رقم الوحدة', key: 'unit_number', w: 10 },
  { header: 'الدور', key: 'floor_name', w: 12 },
  { header: 'النموذج', key: 'model_code', w: 9 },
  { header: 'عدد الغرف', key: 'display_rooms', w: 8 },
  { header: 'المساحة (م²)', key: 'display_area', w: 9 },
  { header: 'حالة الوحدة', key: 'unit_status', w: 12, status: 'unit' },
  { header: 'آخر تحديث للوحدة', key: 'unit_updated', w: 12 },
  { header: 'رقم البيع', key: 'sale_no', w: 14 },
  { header: 'تاريخ البيع', key: 'sale_date', w: 11 },
  { header: 'اسم المشتري', key: 'customer_name', w: 16 },
  { header: 'قيمة الوحدة (السعر الأساسي)', key: 'base_price', w: 13, money: true },
  { header: 'الخصم', key: 'discount_amount', w: 11, money: true },
  { header: 'السعر النهائي', key: 'final_price', w: 13, money: true },
  { header: 'مبلغ الحجز (العربون)', key: 'deposit_amount', w: 12, money: true },
  { header: 'رقم قيد الحجز', key: 'deposit_payment_no', w: 15 },
  { header: 'تاريخ الحجز', key: 'deposit_date', w: 11 },
  { header: 'طريقة دفع الحجز', key: 'deposit_method', w: 12 },
  { header: 'رقم التحويل / الشيك', key: 'deposit_ref_no', w: 12 },
  { header: 'إجمالي المدفوع', key: 'paid_amount', w: 13, money: true },
  { header: 'المتبقي على العميل', key: 'remaining_amount', w: 13, money: true },
  { header: 'تكلفة العقار', key: 'property_cost', w: 12, money: true },
  { header: 'المصروفات', key: 'expenses', w: 10, money: true },
  { header: 'عمولة المسوق', key: 'commission_total', w: 11, money: true },
  { header: 'المدفوع للمسوق', key: 'commission_paid', w: 11, money: true },
  { header: 'المتبقي للمسوق', key: 'commission_remaining', w: 11, money: true },
  { header: 'الربح الإجمالي', key: 'gross_profit', w: 11, money: true },
  { header: 'صافي الربح', key: 'net_profit', w: 11, money: true },
  { header: 'نسبة المستثمر', key: 'investor_share_pct', w: 10 },
  { header: 'صافي مستحق المستثمر', key: 'investor_due', w: 12, money: true },
  { header: 'التسويات', key: 'adjustments_net', w: 10, money: true },
  { header: 'المبالغ المسددة', key: 'collected', w: 12, money: true },
  { header: 'الذمم غير المحصلة', key: 'receivable', w: 13, money: true },
  { header: 'المالك السابق', key: 'prev_owner_name', w: 16 },
  { header: 'سعر الشراء السابق', key: 'purchase_price', w: 12, money: true },
  { header: 'تاريخ الشراء السابق', key: 'purchase_date', w: 11 },
  { header: 'قيمة إعادة البيع', key: 'resale_price', w: 12, money: true },
  { header: 'المتبقي للعميل السابق', key: 'prev_remaining', w: 12, money: true },
  { header: 'خصومات إعادة البيع', key: 'resale_discount', w: 11, money: true },
  { header: 'ربح إعادة البيع', key: 'resale_gross_profit', w: 11, money: true },
  { header: 'صافي ربح إعادة البيع', key: 'resale_net_profit', w: 11, money: true },
  { header: 'بيانات التسوية', key: 'settlement_info', w: 18 },
];

function moneyVal(v) { return v == null || isNaN(v) ? null : Math.round(+v * 100) / 100; }
function cleanPart(s) { return String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60); }

async function buildProjectsXlsx({ settings = {}, meta = {}, rows = [], totals = null }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.created_by || '';
  const ws = wb.addWorksheet('تقرير المشاريع', { views: [{ rightToLeft: true, showGridLines: false }] });
  const lastCol = COLS.length;
  const lastColLetter = colLetter(lastCol);

  const navy = 'FF192E56', gold = 'FFB79552', white = 'FFFFFFFF', ink = 'FF17243E', muted = 'FF7B8493', line = 'FFE5E8EE';
  const merge = (row, from, to) => ws.mergeCells(row, from, row, to);
  const setRow = (row, text, { bold = false, size = 11, color = ink, fill = null, align = 'center', height = 18 } = {}) => {
    const r = ws.getRow(row);
    r.height = height;
    r.getCell(1).value = text;
    merge(row, 1, lastCol);
    const c = r.getCell(1);
    c.font = { name: 'Tahoma', size, bold, color: { argb: color } };
    c.alignment = { horizontal: align, vertical: 'middle' };
    if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    return r;
  };

  // ===== رأس التقرير =====
  let r = 1;
  // الشعار إن وجد
  const logoPath = meta.logoPath && fs.existsSync(meta.logoPath) ? meta.logoPath : null;
  let rowH = 42;
  if (logoPath) {
    const ext = path.extname(logoPath).toLowerCase().replace('.', '') === 'jpg' ? 'jpeg' : 'png';
    try {
      const imgId = wb.addImage({ filename: logoPath, extension: ext });
      ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 84, height: 42 } });
      merge(1, 2, lastCol); // النص بجانب الشعار
      rowH = 48;
    } catch { merge(1, 1, lastCol); }
  } else merge(1, 1, lastCol);
  const hdr = ws.getRow(r); hdr.height = rowH;
  const hc = hdr.getCell(1);
  hc.value = settings.company_name_ar || 'شركة بيات الأكنة للتطوير العقاري';
  hc.font = { name: 'Tahoma', size: 16, bold: true, color: { argb: white } };
  hc.alignment = { horizontal: 'center', vertical: 'middle' };
  hc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
  r++;
  setRow(r, 'تقرير المشاريع — Excel', { bold: true, size: 14, color: navy, height: 22 }); r++;
  setRow(r, 'المشروع: ' + (meta.project_name || 'جميع المشاريع'), { bold: true, size: 13, color: 'FF8A6D1F', fill: 'FFF7F0E1', height: 22 }); r++;
  setRow(r, `رقم التقرير: ${meta.report_no || '—'}   •   تاريخ الإنشاء: ${meta.created_at}   •   آخر تحديث للبيانات: ${meta.data_updated_at}   •   أنشأه: ${meta.created_by || '—'}`, { size: 10.5, color: muted, height: 20 }); r++;
  // ===== الإجماليات العليا — خارج نطاق الفلتر =====
  if (totals) {
    const tRow = ws.getRow(r); tRow.height = 20;
    tRow.getCell(1).value = `الإجماليات (خارج نطاق الفلتر):  ${totals.units || 0} وحدة  |  إجمالي المبيعات ${moneyVal(totals.final) || 0} ر.س  |  الخصومات ${moneyVal(totals.discount) || 0} ر.س  |  المحصل ${moneyVal(totals.paid) || 0} ر.س  |  المتبقي ${moneyVal(totals.remaining) || 0} ر.س  |  عمولات المسوقين ${moneyVal(totals.commission_total) || 0} ر.س  |  صافي الربح ${moneyVal(totals.net_profit) || 0} ر.س`;
    merge(r, 1, lastCol);
    const c = tRow.getCell(1);
    c.font = { name: 'Tahoma', size: 10.5, bold: true, color: { argb: 'FF1E6B4F' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F4EF' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    r++;
  }
  r++; // صف فارغ قبل الجدول

  // ===== جدول البيانات (يبدأ من هنا نطاق الفلتر) =====
  const headerRow = r;
  const hr = ws.getRow(headerRow);
  hr.height = 34;
  COLS.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: 'Tahoma', size: 9.5, bold: true, color: { argb: white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { top: { style: 'thin', color: { argb: 'FFD5D9E2' } }, bottom: { style: 'thin', color: { argb: 'FFD5D9E2' } }, left: { style: 'thin', color: { argb: 'FFD5D9E2' } }, right: { style: 'thin', color: { argb: 'FFD5D9E2' } } };
  });
  r++;

  const dataStart = r;
  rows.forEach(row => {
    const rr = ws.getRow(r);
    COLS.forEach((c, i) => {
      let v = row[c.key];
      const cell = rr.getCell(i + 1);
      if (c.money) {
        cell.value = moneyVal(v);
        cell.numFmt = MONEY;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else {
        cell.value = v == null ? '—' : v;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
      cell.font = { name: 'Tahoma', size: 9 };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFEDF0F2' } } };
      // تلوين الحالة
      if (c.status) {
        const sKey = c.status === 'unit' ? row.unit_status : row.sale_status;
        const [bg, fg] = STATUS_COLORS[sKey] || STATUS_COLORS.none || ['FFF4F5F7', 'FF657080'];
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.font = { name: 'Tahoma', size: 9, bold: true, color: { argb: fg } };
      }
    });
    r++;
  });
  const dataEnd = r - 1;

  // ===== الإجماليات السفلية — صف خارج نطاق الفلتر =====
  r++; // صف فارغ
  const trow = ws.getRow(r); trow.height = 22;
  trow.getCell(1).value = 'الإجماليات النهائية';
  trow.getCell(1).font = { name: 'Tahoma', size: 10, bold: true, color: { argb: navy } };
  trow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
  trow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3EFE3' } };
  const totalKeys = ['base_price', 'discount_amount', 'final_price', 'deposit_amount', 'paid_amount', 'remaining_amount', 'property_cost', 'expenses', 'commission_total', 'commission_paid', 'commission_remaining', 'gross_profit', 'net_profit', 'investor_due', 'adjustments_net', 'collected', 'receivable', 'purchase_price', 'resale_price', 'prev_remaining', 'resale_discount', 'resale_gross_profit', 'resale_net_profit'];
  COLS.forEach((c, i) => {
    if (c.money && totalKeys.includes(c.key) && dataEnd >= dataStart) {
      const cl = colLetter(i + 1);
      const cell = trow.getCell(i + 1);
      cell.value = { formula: `SUM(${cl}${dataStart}:${cl}${dataEnd})`, result: totals && totals[c.key] != null ? moneyVal(totals[c.key]) : 0 };
      cell.numFmt = MONEY;
      cell.font = { name: 'Tahoma', size: 9.5, bold: true, color: { argb: navy } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3EFE3' } };
    }
  });
  const totalsRow = r;

  // ===== AutoFilter على نطاق البيانات فقط (خارج الإجماليات) =====
  if (dataEnd >= dataStart) {
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: dataEnd, column: lastCol } };
  }
  // ===== Freeze Panes أسفل رأس الجدول =====
  ws.views = [{ rightToLeft: true, showGridLines: false, state: 'frozen', xSplit: 0, ySplit: headerRow }];
  // ===== عرض الأعمدة =====
  COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });
  ws.getRow(headerRow).commit();

  // ===== اسم الملف المنظم =====
  const date = (meta.date || new Date().toISOString().slice(0, 10)).replace(/-/g, '-');
  const parts = ['تقرير_المشاريع'];
  if (meta.project_code) parts.push(cleanPart(meta.project_code));
  if (meta.unit_number) parts.push(cleanPart(meta.unit_number));
  parts.push(date);
  const filename = parts.join('_') + '.xlsx';

  const buf = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buf), filename, totalsRow };
}

module.exports = { buildProjectsXlsx, COLS, STATUS_AR, METHOD_AR, PHASE_AR };
