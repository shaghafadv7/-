import React, { useEffect, useState } from 'react';
import { api, excelUrl } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { I, Btn, Empty, Skeleton, ErrBox, PageHead } from '../components/ui.jsx';

const ICONS = { tasks: 'check', clients: 'users', appointments: 'cal', calls: 'phone', activity: 'hist', users: 'user', reservations: 'key', sales: 'wallet', finance: 'money', units: 'home' };
const COLS_AR = { id: 'م', title: 'العنوان', assignee: 'المسؤول', priority: 'الأولوية', status: 'الحالة', due_date: 'الاستحقاق', category: 'التصنيف', code: 'الكود', name: 'الاسم', phone: 'الهاتف', client: 'العميل', date: 'التاريخ', time: 'الوقت', contact: 'جهة الاتصال', direction: 'الاتجاه', result: 'النتيجة', user: 'المستخدم', action: 'الإجراء', module: 'الوحدة', details: 'التفاصيل', username: 'المستخدم', role: 'الدور', last_login: 'آخر دخول', unit: 'الوحدة', price: 'السعر', deposit: 'العربون', net: 'الصافي', paid: 'المدفوع', remaining: 'المتبقي', commission: 'العمولة', settlement: 'التسوية', project: 'المشروع', rooms: 'الغرف', area: 'المساحة' };

export default function Reports() {
  const { can, toast } = useStore();
  const [list, setList] = useState([]);
  const [sel, setSel] = useState(null);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api('/reports').then(r => { setList(r.reports || []); setBusy(false); }).catch(() => setBusy(false));
  }, []);

  const open = async (rep) => {
    if (!can(rep.module)) { toast('لا تملك صلاحية هذا التقرير', 'error'); return; }
    setSel(rep); setLoading(true); setData(null);
    try { const r = await api('/reports/' + rep.key); setData(r); }
    catch (e) { toast(e.message, 'error'); }
    setLoading(false);
  };
  const doPrint = () => window.print();
  const doExcel = async () => {
    try { await excelUrl(sel.key); toast('تم تنزيل ملف Excel'); }
    catch (e) { toast(e.message, 'error'); }
  };

  if (busy) return <><PageHead title="مركز التقارير" /><Skeleton n={3} /></>;

  return (
    <>
      <div className="no-print">
        <PageHead title="مركز التقارير" sub="تقارير احترافية بهوية الشركة — عرض، طباعة، وتصدير Excel" />
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3.5 mb-5 anim-in">
          {list.map(r => (
            <div key={r.key} className={`card card-h p-4 cursor-pointer text-center ${sel?.key === r.key ? '!border-[var(--brand)]' : ''}`} onClick={() => open(r)} style={sel?.key === r.key ? { borderColor: 'var(--brand)', boxShadow: '0 0 0 3px rgba(29,97,245,.14)' } : {}}>
              <span className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center mb-2" style={{ background: 'linear-gradient(135deg, rgba(29,97,245,.13), rgba(124,58,237,.1))', color: 'var(--brand)' }}><I n={ICONS[r.key] || 'chart'} s={24} /></span>
              <b className="text-[13.5px]">{r.title}</b>
            </div>
          ))}
        </div>

        {loading && <Skeleton n={4} />}
        {!loading && !data && <div className="card"><Empty icon="chart" title="اختر تقريرًا لعرضه" sub="اضغط على أي بطاقة بالأعلى" /></div>}

        {!loading && data && (
          <div className="card p-5 anim-in">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
              <div><b className="text-[16px]">{data.def.title}</b><div className="text-[12px] num" style={{ color: 'var(--ink3)' }}>عدد السجلات: {data.rows.length}</div></div>
              <div className="flex gap-2">
                {can('reports', 'export') && <Btn v="g" size="sm" onClick={doExcel}><I n="dl" s={15} /> Excel</Btn>}
                {can('reports', 'print') && <Btn v="p" size="sm" onClick={doPrint}><I n="print" s={15} /> طباعة / PDF</Btn>}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="tbl min-w-[600px]">
                <thead><tr>{data.def.cols.map(c => <th key={c}>{COLS_AR[c] || c}</th>)}</tr></thead>
                <tbody>
                  {data.rows.slice(0, 200).map((r, i) => <tr key={i}>{data.def.cols.map(c => <td key={c} className="text-[12.5px]">{String(r[c] ?? '—').slice(0, 60)}</td>)}</tr>)}
                </tbody>
              </table>
              {data.rows.length > 200 && <div className="text-[12px] mt-2" style={{ color: 'var(--ink3)' }}>عرض أول 200 سجل — صدّر Excel للكامل</div>}
            </div>
          </div>
        )}
      </div>

      {/* ورقة الطباعة RTL */}
      {data && (
        <div className="print-area">
          <div className="print-sheet p-8">
            <div className="rpt-head">
              <div>
                <div className="text-[20px] font-bold">{data.meta.company.company_name}</div>
                <div className="text-[12px]">{data.meta.company.company_address} — {data.meta.company.company_phone}</div>
              </div>
              <div className="text-left">
                <div className="text-[17px] font-bold">{data.def.title}</div>
                <div className="text-[11px]">رقم التقرير: {data.meta.no}</div>
                <div className="text-[11px]">التاريخ: {data.meta.date}</div>
                <div className="text-[11px]">المستخدم: {data.meta.user}</div>
              </div>
            </div>
            <table>
              <thead><tr>{data.def.cols.map(c => <th key={c}>{COLS_AR[c] || c}</th>)}</tr></thead>
              <tbody>{data.rows.map((r, i) => <tr key={i}>{data.def.cols.map(c => <td key={c}>{String(r[c] ?? '—')}</td>)}</tr>)}</tbody>
            </table>
            <div className="rpt-foot">
              <span>{data.meta.company.reports_footer}</span>
              <span>صفحة 1 — إجمالي السجلات: {data.rows.length}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
