import React, { useEffect, useState } from 'react';
import { api, getToken } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtDT } from '../lib/format.js';
import { I, Btn, Empty, Skeleton, PageHead, Field, Tabs, Confirm } from '../components/ui.jsx';

// ================= الإعدادات =================
export function Settings() {
  const { can, toast, theme, toggleTheme, setCompany } = useStore();
  const [s, setS] = useState(null);
  const [tab, setTab] = useState('company');
  const [pw, setPw] = useState({ current: '', next: '' });

  useEffect(() => { api('/settings').then(setS).catch(() => {}); }, []);
  const save = async () => {
    try { const r = await api('/settings', { method: 'PUT', body: s }); setS(r); setCompany(r); toast('تم حفظ الإعدادات'); } catch (e) { toast(e.message, 'error'); }
  };
  const changePw = async () => {
    try { await api('/auth/change-password', { method: 'POST', body: pw }); toast('تم تغيير كلمة المرور'); setPw({ current: '', next: '' }); }
    catch (e) { toast(e.message, 'error'); }
  };

  if (!s) return <><PageHead title="الإعدادات" /><Skeleton n={4} /></>;
  const ro = !can('settings', 'manage');
  return (
    <>
      <PageHead title="مركز الإعدادات" sub="هوية الشركة، النظام، المظهر، والأمان" actions={!ro && <Btn onClick={save}><I n="check" s={15} /> حفظ الإعدادات</Btn>} />
      <Tabs tabs={[{ k: 'company', t: 'الشركة' }, { k: 'system', t: 'النظام والمظهر' }, { k: 'security', t: 'الأمان' }]} val={tab} onChange={setTab} />
      <div className="card p-5 mt-4 anim-in" style={{ maxWidth: 720 }}>
        {tab === 'company' && (
          <div className="space-y-3.5">
            <Field label="اسم الشركة"><input className="inp" disabled={ro} value={s.company_name || ''} onChange={e => setS({ ...s, company_name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="هاتف الشركة"><input className="inp num" disabled={ro} value={s.company_phone || ''} onChange={e => setS({ ...s, company_phone: e.target.value })} /></Field>
              <Field label="جوال الشركة"><input className="inp num" disabled={ro} value={s.company_mobile || ''} onChange={e => setS({ ...s, company_mobile: e.target.value })} /></Field>
              <Field label="البريد"><input className="inp" disabled={ro} value={s.company_email || ''} onChange={e => setS({ ...s, company_email: e.target.value })} /></Field>
              <Field label="العملة"><input className="inp" disabled={ro} value={s.currency || ''} onChange={e => setS({ ...s, currency: e.target.value })} /></Field>
            </div>
            <Field label="العنوان"><input className="inp" disabled={ro} value={s.company_address || ''} onChange={e => setS({ ...s, company_address: e.target.value })} /></Field>
            <Field label="تذييل التقارير"><input className="inp" disabled={ro} value={s.reports_footer || ''} onChange={e => setS({ ...s, reports_footer: e.target.value })} /></Field>
          </div>
        )}
        {tab === 'system' && (
          <div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="اللغة"><select className="inp" disabled={ro} value={s.system_language || 'ar'} onChange={e => setS({ ...s, system_language: e.target.value })}><option value="ar">العربية</option><option value="en" disabled>الإنجليزية (قريبًا)</option></select></Field>
              <Field label="الخط"><select className="inp" disabled={ro} value={s.system_font || 'plex'} onChange={e => setS({ ...s, system_font: e.target.value })}><option value="plex">IBM Plex Sans Arabic</option></select></Field>
            </div>
            <Field label="المظهر">
              <div className="flex gap-2">
                <Btn v={theme === 'light' ? 'p' : 'g'} size="sm" onClick={() => theme === 'dark' && toggleTheme()}><I n="sun" s={15} /> فاتح</Btn>
                <Btn v={theme === 'dark' ? 'p' : 'g'} size="sm" onClick={() => theme === 'light' && toggleTheme()}><I n="moon" s={15} /> داكن</Btn>
              </div>
            </Field>
            <div className="rounded-xl p-4 text-[13px] leading-7" style={{ background: 'var(--card2)' }}>
              <b>معلومات النظام</b><br />الإصدار: <b className="num">1.0.0</b> — قاعدة البيانات: <b>SQLite محلية مشفرة الجلسات</b><br />النسخ الاحتياطي: من صفحة النسخ الاحتياطي
            </div>
          </div>
        )}
        {tab === 'security' && (
          <div className="space-y-3.5">
            <b className="text-[14px]">تغيير كلمة المرور</b>
            <Field label="كلمة المرور الحالية"><input type="password" className="inp" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label="كلمة المرور الجديدة (6 أحرف على الأقل)"><input type="password" className="inp" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} /></Field>
            <Btn v="p" size="sm" onClick={changePw}>تغيير كلمة المرور</Btn>
            <div className="rounded-xl p-4 text-[13px] leading-7" style={{ background: 'var(--card2)' }}>
              <b>سياسات الأمان المفعلة:</b> تشفير كلمات المرور (bcrypt) — جلسات JWT تنتهي خلال 24 ساعة — فحص الصلاحيات في الخادم على كل طلب — سجل تدقيق شامل — حد 5 جلسات نشطة.
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ================= النسخ الاحتياطي =================
export function Backup() {
  const { can, toast } = useStore();
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState(null);

  const load = () => api('/backup').then(r => setRows(r.data || [])).catch(() => {});
  useEffect(load, []);

  const create = async () => {
    setBusy(true);
    try { const r = await api('/backup', { method: 'POST' }); toast(`تم إنشاء النسخة ${r.name}`); load(); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <>
      <PageHead title="النسخ الاحتياطي" sub="حماية بياناتك — نسخ، تنزيل، واستعادة"
        actions={can('backup', 'create') && <Btn onClick={create} disabled={busy}><I n="db" s={16} /> {busy ? 'جارٍ الإنشاء...' : 'إنشاء نسخة الآن'}</Btn>} />
      <div className="card p-5 anim-in">
        {rows.length === 0 && <Empty icon="db" title="لا توجد نسخ بعد" sub="أنشئ أول نسخة احتياطية الآن" />}
        <div className="space-y-2.5">
          {rows.map(b => (
            <div key={b.name} className="flex items-center gap-3 rounded-xl p-3" style={{ background: 'var(--card2)' }}>
              <span className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(29,97,245,.12)', color: 'var(--brand)' }}><I n="db" s={19} /></span>
              <div className="flex-1"><b className="num text-[13.5px]">{b.name}</b><div className="text-[11.5px] num" style={{ color: 'var(--ink3)' }}>{(b.size / 1024).toFixed(0)} KB — {fmtDT(b.at)}</div></div>
              {can('backup', 'export') && <a className="btn btn-g btn-sm" href={`/api/backup/${b.name}/download`} onClick={async (e) => {
                e.preventDefault();
                const r = await fetch(`/api/backup/${b.name}/download`, { headers: { Authorization: 'Bearer ' + getToken() } });
                const blob = await r.blob();
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = b.name; a.click();
              }}><I n="dl" s={15} /> تنزيل</a>}
              {can('backup', 'manage') && <Btn v="d" size="sm" onClick={() => setRestore(b)}>استعادة</Btn>}
            </div>
          ))}
        </div>
        <div className="rounded-xl p-4 mt-4 text-[12.5px] leading-7" style={{ background: 'rgba(217,119,6,.08)', color: 'var(--ink2)' }}>
          تنبيه: الاستعادة تستبدل قاعدة البيانات الحالية بالكامل وتتطلب إعادة تشغيل التطبيق. يُنصح بإنشاء نسخة من الوضع الحالي قبل الاستعادة.
        </div>
      </div>
      <Confirm open={!!restore} onClose={() => setRestore(null)} title="استعادة النسخة" msg={`سيتم استبدال البيانات الحالية بنسخة "${restore?.name}" — أعد تشغيل التطبيق بعدها. هل أنت متأكد؟`} okText="استعادة"
        onOk={async () => { try { await api(`/backup/${restore.name}/restore`, { method: 'POST' }); toast('تم تجهيز الاستعادة — أعد تشغيل التطبيق'); setRestore(null); } catch (e) { toast(e.message, 'error'); } }} />
    </>
  );
}
