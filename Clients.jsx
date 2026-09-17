import React, { useEffect, useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtD, L } from '../lib/format.js';
import { I, Btn, Badge, Empty, Skeleton, ErrBox, PageHead, Modal, Drawer, Field, SearchInp, Confirm, Avatar, Pagination } from '../components/ui.jsx';
import AttachFiles from '../components/AttachFiles.jsx';

const STC = { active: 'b-green', potential: 'b-amber', inactive: 'b-gray', vip: 'b-purple', blocked: 'b-red' };

export default function Clients() {
  const { can, toast } = useStore();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [profile, setProfile] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [users, setUsers] = useState([]);

  const load = () => {
    setBusy(true); setErr('');
    api('/clients' + q({ page, limit: 12, q: search, status: fStatus }))
      .then(r => { setRows(r.data); setTotal(r.total); setBusy(false); }).catch(e => { setErr(e.message); setBusy(false); });
  };
  useEffect(() => { setPage(1); }, [search, fStatus]);
  useEffect(load, [page, search, fStatus]);
  useEffect(() => {
    api('/users/list').then(r => setUsers(r.data || [])).catch(() => {});
    if (sessionStorage.getItem('ss_quick') === 'new-client') { sessionStorage.removeItem('ss_quick'); setEdit({}); }
  }, []);

  const openProfile = async (c) => {
    setProfile(c);
    try { const r = await api(`/timeline/client/${c.id}`); setTimeline(r.events || []); } catch { setTimeline([]); }
  };
  const save = async (f) => {
    if (!f.name?.trim()) { toast('اسم العميل مطلوب', 'error'); return; }
    try {
      if (f.id) await api('/clients/' + f.id, { method: 'PUT', body: f });
      else await api('/clients', { method: 'POST', body: { ...f, code: f.code || ('C-' + Date.now().toString(36).toUpperCase()), created_by: useStore.getState().user.id } });
      toast('تم حفظ العميل'); setEdit(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHead title="إدارة العملاء" sub="ملف متكامل لكل عميل مع سجل تفاعلات زمني"
        actions={can('clients', 'create') && <Btn onClick={() => setEdit({})}><I n="plus" s={16} /> عميل جديد</Btn>} />

      <div className="card p-3.5 mb-4 flex gap-2.5 flex-wrap items-center anim-in">
        <SearchInp value={search} onChange={setSearch} ph="بحث بالاسم، الجوال، الشركة..." className="flex-1 min-w-[220px]" />
        <select className="inp" style={{ width: 150 }} value={fStatus} onChange={e => setFStatus(e.target.value)}>
          <option value="">كل الحالات</option>{Object.entries(L.clientStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {err && <ErrBox msg={err} retry={load} />}
      {busy && <Skeleton n={4} />}
      {!busy && !err && rows.length === 0 && <div className="card"><Empty icon="users" title="لا يوجد عملاء" sub="أضف عميلك الأول" action={can('clients', 'create') && <Btn onClick={() => setEdit({})}>عميل جديد</Btn>} /></div>}

      {!busy && !err && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3.5 anim-in">
          {rows.map(c => (
            <div key={c.id} className="card card-h p-4 cursor-pointer" onClick={() => openProfile(c)}>
              <div className="flex items-start gap-3">
                <Avatar name={c.name} s={46} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[15px] truncate">{c.name}</div>
                  <div className="text-[12.5px] truncate" style={{ color: 'var(--ink2)' }}>{c.company || c.job_title || c.city || '—'}</div>
                </div>
                <Badge c={STC[c.status] || 'b-gray'}>{L.clientStatus[c.status]}</Badge>
              </div>
              <div className="flex items-center gap-4 mt-3 text-[12.5px]" style={{ color: 'var(--ink2)' }}>
                {c.phone && <span className="flex items-center gap-1 num"><I n="phone" s={14} />{c.phone}</span>}
                {c.email && <span className="flex items-center gap-1 truncate"><I n="send" s={14} />{c.email}</span>}
              </div>
              <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
                <span className="text-[11.5px] num" style={{ color: 'var(--ink3)' }}>{c.code} — {fmtD(c.created_at)}</span>
                <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                  {can('clients', 'edit') && <button className="icon-btn" onClick={() => setEdit(c)}><I n="edit" s={16} /></button>}
                  {can('clients', 'delete') && <button className="icon-btn" onClick={() => setDel(c)}><I n="trash" s={16} /></button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} pages={Math.ceil(total / 12)} total={total} onGo={setPage} />

      {/* نموذج */}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل العميل' : 'عميل جديد'} w={640}
        actions={<><Btn onClick={() => save(edit)}><I n="check" s={15} /> حفظ العميل</Btn><Btn v="g" onClick={() => setEdit(null)}>إلغاء</Btn></>}>
        {edit && <ClientForm f={edit} set={setEdit} users={users} />}
      </Modal>

      {/* الملف + التايم لاين */}
      <Drawer open={!!profile} onClose={() => setProfile(null)} title="ملف العميل" w={480}>
        {profile && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={profile.name} s={58} />
              <div><div className="font-bold text-[17px]">{profile.name}</div><div className="text-[12.5px]" style={{ color: 'var(--ink2)' }}>{profile.company} {profile.job_title ? `— ${profile.job_title}` : ''}</div></div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[13px] rounded-xl p-3" style={{ background: 'var(--card2)' }}>
              <div>الجوال: <b className="num">{profile.phone || '—'}</b></div>
              <div>البريد: <b>{profile.email || '—'}</b></div>
              <div>المدينة: <b>{profile.city || '—'}</b></div>
              <div>الحالة: <Badge c={STC[profile.status]}>{L.clientStatus[profile.status]}</Badge></div>
              <div className="col-span-2">العنوان: <b>{profile.address || '—'}</b></div>
              {profile.notes && <div className="col-span-2">ملاحظات: {profile.notes}</div>}
            </div>
            {profile && <AttachFiles entity={{ client_id: profile.id }} />}
            <div>
              <b className="text-[14px]">السجل الزمني للتفاعلات</b>
              <div className="mt-3 space-y-0 relative">
                {timeline.length === 0 && <div className="text-[12.5px]" style={{ color: 'var(--ink3)' }}>لا توجد تفاعلات مسجلة بعد</div>}
                {timeline.map((t, i) => (
                  <div key={i} className="flex gap-3 pb-4 relative">
                    {i < timeline.length - 1 && <span className="absolute right-[15px] top-8 bottom-0 w-0.5" style={{ background: 'var(--line)' }} />}
                    <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10" style={{ background: 'var(--bg2)', color: 'var(--brand)' }}>
                      <I n={t.kind === 'task' ? 'check' : t.kind === 'appointment' ? 'cal' : t.kind === 'call' ? 'phone' : t.kind === 'reservation' ? 'key' : t.kind === 'sale' ? 'wallet' : t.kind === 'payment' ? 'money' : t.kind === 'invoice' ? 'file' : t.kind === 'file' ? 'folder' : 'note'} s={15} />
                    </span>
                    <div className="flex-1 rounded-xl p-2.5" style={{ background: 'var(--card2)' }}>
                      <div className="text-[13px] font-bold">{t.title}</div>
                      {t.sub && <div className="text-[12px]" style={{ color: 'var(--ink2)' }}>{t.sub}</div>}<div className="text-[11.5px] num" style={{ color: 'var(--ink3)' }}>{fmtD(t.date)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Drawer>

      <Confirm open={!!del} onClose={() => setDel(null)} title="حذف العميل" msg={`سيتم حذف "${del?.name}" وجميع روابطه`} okText="حذف"
        onOk={async () => { try { await api('/clients/' + del.id, { method: 'DELETE' }); toast('تم حذف العميل'); setDel(null); load(); } catch (e) { toast(e.message, 'error'); } }} />
    </>
  );
}

function ClientForm({ f, set, users }) {
  const S = (k, v) => set(x => ({ ...x, [k]: v }));
  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="اسم العميل *"><input className="inp" value={f.name || ''} onChange={e => S('name', e.target.value)} /></Field>
        <Field label="الشركة"><input className="inp" value={f.company || ''} onChange={e => S('company', e.target.value)} /></Field>
        <Field label="الوظيفة"><input className="inp" value={f.job_title || ''} onChange={e => S('job_title', e.target.value)} /></Field>
        <Field label="الجوال"><input className="inp num" value={f.phone || ''} onChange={e => S('phone', e.target.value)} placeholder="05xxxxxxxx" /></Field>
        <Field label="جوال إضافي"><input className="inp num" value={f.phone2 || ''} onChange={e => S('phone2', e.target.value)} /></Field>
        <Field label="البريد"><input className="inp" type="email" value={f.email || ''} onChange={e => S('email', e.target.value)} /></Field>
        <Field label="المدينة"><input className="inp" value={f.city || ''} onChange={e => S('city', e.target.value)} /></Field>
        <Field label="التصنيف"><select className="inp" value={f.category || 'general'} onChange={e => S('category', e.target.value)}><option value="general">عام</option><option value="buyer">مشترٍ</option><option value="seller">بائع</option><option value="broker">وسيط</option><option value="partner">شريك</option></select></Field>
        <Field label="الحالة"><select className="inp" value={f.status || 'active'} onChange={e => S('status', e.target.value)}>{Object.entries(L.clientStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="المسؤول"><select className="inp" value={f.assigned_to || ''} onChange={e => S('assigned_to', e.target.value || null)}><option value="">— بدون —</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
      </div>
      <Field label="العنوان"><input className="inp" value={f.address || ''} onChange={e => S('address', e.target.value)} /></Field>
      <Field label="ملاحظات"><textarea className="inp" rows={2} value={f.notes || ''} onChange={e => S('notes', e.target.value)} /></Field>
    </div>
  );
}
