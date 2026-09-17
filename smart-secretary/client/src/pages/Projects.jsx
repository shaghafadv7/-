import React, { useEffect, useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtN, L, badge, todayStr } from '../lib/format.js';
import { I, Btn, Badge, Empty, Skeleton, ErrBox, PageHead, Modal, Field, SearchInp, Drawer, Confirm, Tabs, Stat } from '../components/ui.jsx';

export default function Projects() {
  const { can, toast, project: gProject, company } = useStore();
  const [projects, setProjects] = useState([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null); // مشروع مفصل
  const [tree, setTree] = useState(null);
  const [units, setUnits] = useState([]);
  const [search, setSearch] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [editP, setEditP] = useState(null);
  const [editU, setEditU] = useState(null);
  const [reserveU, setReserveU] = useState(null);
  const [clients, setClients] = useState([]);

  const load = () => {
    setBusy(true); setErr('');
    api('/projects' + q({ limit: 100 }))
      .then(r => { setProjects(r.data || []); setBusy(false); }).catch(e => { setErr(e.message); setBusy(false); });
  };
  const loadUnits = (pid) => {
    api('/units' + q({ limit: 300, project_id: pid || gProject || undefined, q: search, status: fStatus }))
      .then(r => setUnits(r.data || [])).catch(() => {});
  };
  useEffect(load, []);
  useEffect(() => { api('/clients' + q({ limit: 300 })).then(r => setClients(r.data || [])).catch(() => {}); }, []);
  useEffect(() => { loadUnits(sel?.id); }, [sel, gProject, search, fStatus]);

  const openProject = async (p) => {
    setSel(p);
    try { const r = await api(`/projects/${p.id}/tree`); setTree(r); } catch { setTree(null); }
  };
  const saveProject = async (f) => {
    if (!f.code?.trim() || !f.name?.trim()) { toast('كود المشروع واسمه مطلوبان', 'error'); return; }
    try {
      if (f.id) await api('/projects/' + f.id, { method: 'PUT', body: f });
      else await api('/projects', { method: 'POST', body: f });
      toast('تم حفظ المشروع'); setEditP(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };
  const saveUnit = async (f) => {
    if (!f.code?.trim() || !f.project_id || !(+f.price > 0)) { toast('الكود والمشروع وسعر صالح مطلوبة', 'error'); return; }
    try {
      if (f.id) await api('/units/' + f.id, { method: 'PUT', body: f });
      else await api('/units', { method: 'POST', body: f });
      toast('تم حفظ الوحدة'); setEditU(null); loadUnits(sel?.id); load(); if (sel) openProject(sel);
    } catch (e) { toast(e.message, 'error'); }
  };
  const doReserve = async (f) => {
    try {
      const r = await api('/reservations', { method: 'POST', body: f });
      toast(`تم إنشاء الحجز ${r.code}`);
      setReserveU(null); loadUnits(sel?.id); load(); if (sel) openProject(sel);
    } catch (e) { toast(e.message, 'error'); }
  };

  const cur = company.currency || 'ر.س';

  return (
    <>
      <PageHead title="المشاريع والوحدات" sub="مشاريع 101 — 108: المباني، الأدوار، الوحدات والحجز"
        actions={can('projects', 'create') && <Btn v="g" onClick={() => setEditP({})}><I n="plus" s={15} /> مشروع جديد</Btn>} />

      {err && <ErrBox msg={err} retry={load} />}
      {busy && <Skeleton n={3} />}

      {!busy && !err && !sel && (
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3.5 anim-in">
          {projects.map(p => {
            const pct = p.units_count ? Math.round((p.sold_count / p.units_count) * 100) : 0;
            return (
              <div key={p.id} className="card card-h p-4 cursor-pointer" onClick={() => openProject(p)}>
                <div className="flex items-center justify-between mb-2">
                  <span className="w-11 h-11 rounded-xl grad-bg text-white flex items-center justify-center font-bold text-[15px] num">{p.code}</span>
                  <Badge c={p.status === 'active' ? 'b-green' : 'b-gray'}>{p.status === 'active' ? 'نشط' : p.status === 'upcoming' ? 'قادم' : p.status === 'completed' ? 'مكتمل' : 'موقوف'}</Badge>
                </div>
                <b className="text-[15px]">{p.name}</b>
                <div className="text-[12px]" style={{ color: 'var(--ink2)' }}>{p.city}</div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <div className="rounded-lg py-1.5" style={{ background: 'var(--card2)' }}><div className="font-bold num">{p.units_count || 0}</div><div className="text-[10.5px]" style={{ color: 'var(--ink3)' }}>وحدة</div></div>
                  <div className="rounded-lg py-1.5" style={{ background: 'rgba(22,163,74,.1)' }}><div className="font-bold num" style={{ color: 'var(--ok)' }}>{p.available_count || 0}</div><div className="text-[10.5px]" style={{ color: 'var(--ink3)' }}>متاح</div></div>
                  <div className="rounded-lg py-1.5" style={{ background: 'rgba(29,97,245,.1)' }}><div className="font-bold num" style={{ color: 'var(--brand)' }}>{p.sold_count || 0}</div><div className="text-[10.5px]" style={{ color: 'var(--ink3)' }}>مباع</div></div>
                </div>
                <div className="h-2 rounded-full mt-3" style={{ background: 'var(--bg2)' }}><div className="h-full rounded-full grad-bg transition-all" style={{ width: pct + '%' }} /></div>
                <div className="text-[11px] mt-1 num" style={{ color: 'var(--ink3)' }}>نسبة البيع {pct}%</div>
                {can('projects', 'edit') && <div className="mt-2" onClick={e => e.stopPropagation()}><Btn v="g" size="xs" onClick={() => setEditP(p)}><I n="edit" s={13} /> تعديل</Btn></div>}
              </div>
            );
          })}
        </div>
      )}

      {!busy && !err && sel && (
        <div className="anim-in">
          <div className="flex items-center gap-2 mb-4">
            <Btn v="g" size="sm" onClick={() => { setSel(null); setTree(null); }}>→ عودة للمشاريع</Btn>
            <b className="text-[16px]">مشروع {sel.code} — {sel.name}</b>
            {can('units', 'create') && <Btn size="sm" className="mr-auto" onClick={() => setEditU({ project_id: sel.id, status: 'available', rooms: 3 })}><I n="plus" s={14} /> وحدة جديدة</Btn>}
          </div>

          <div className="card p-3.5 mb-4 flex gap-2.5 flex-wrap items-center">
            <SearchInp value={search} onChange={setSearch} ph="بحث برقم الوحدة..." className="flex-1 min-w-[180px]" />
            <Tabs tabs={[{ k: '', t: 'الكل' }, ...Object.entries(L.unitStatus).map(([k, t]) => ({ k, t }))]} val={fStatus} onChange={setFStatus} />
          </div>

          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {units.map(u => (
              <div key={u.id} className="card card-h p-4">
                <div className="flex items-center justify-between">
                  <b className="text-[15px] num">{u.code}</b>
                  <Badge c={badge.unitStatus[u.status]}>{L.unitStatus[u.status]}</Badge>
                </div>
                <div className="text-[12.5px] mt-1" style={{ color: 'var(--ink2)' }}>{u.building_name || ''} {u.floor_name ? `— ${u.floor_name}` : ''} — {u.type === 'villa' ? 'فيلا' : 'شقة'}</div>
                <div className="flex gap-4 mt-2.5 text-[13px]">
                  <span><I n="grid" s={13} /> <b className="num">{u.rooms}</b> غرف</span>
                  <span>المساحة <b className="num">{fmtN(u.area)}</b> م²</span>
                </div>
                <div className="mt-2 text-[17px] font-bold num" style={{ color: 'var(--brand)' }}>{fmtN(u.price)} <span className="text-[12px] font-semibold" style={{ color: 'var(--ink3)' }}>{cur}</span></div>
                <div className="flex gap-1.5 mt-3">
                  {(u.status === 'available' || u.status === 'resale') && can('reservations', 'create') && <Btn size="sm" onClick={() => setReserveU(u)}><I n="key" s={14} /> حجز</Btn>}
                  {can('units', 'edit') && <Btn v="g" size="sm" onClick={() => setEditU(u)}><I n="edit" s={14} /></Btn>}
                </div>
              </div>
            ))}
          </div>
          {units.length === 0 && <div className="card mt-2"><Empty icon="home" title="لا توجد وحدات مطابقة" /></div>}

          {/* هيكل المباني */}
          {tree && tree.buildings?.length > 0 && (
            <div className="card p-5 mt-5">
              <b className="text-[15px]">هيكل المشروع</b>
              {tree.buildings.map(b => (
                <div key={b.id} className="mt-3 rounded-xl p-3" style={{ background: 'var(--card2)' }}>
                  <b className="text-[13.5px]">مبنى {b.name} — {b.floors_count} أدوار</b>
                  {b.floors.map(f => (
                    <div key={f.id} className="mt-2 mr-3">
                      <span className="text-[12.5px] font-semibold" style={{ color: 'var(--ink2)' }}>{f.name}:</span>
                      <span className="text-[12.5px]"> {f.units.map(u => u.code).join('، ') || '—'}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* مشروع */}
      <Modal open={!!editP} onClose={() => setEditP(null)} title={editP?.id ? 'تعديل المشروع' : 'مشروع جديد'} w={520}
        actions={<><Btn onClick={() => saveProject(editP)}>حفظ</Btn><Btn v="g" onClick={() => setEditP(null)}>إلغاء</Btn></>}>
        {editP && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="كود المشروع *"><input className="inp num" value={editP.code || ''} onChange={e => setEditP({ ...editP, code: e.target.value })} placeholder="101" /></Field>
              <Field label="اسم المشروع *"><input className="inp" value={editP.name || ''} onChange={e => setEditP({ ...editP, name: e.target.value })} /></Field>
              <Field label="المدينة"><input className="inp" value={editP.city || ''} onChange={e => setEditP({ ...editP, city: e.target.value })} /></Field>
              <Field label="الحالة"><select className="inp" value={editP.status || 'active'} onChange={e => setEditP({ ...editP, status: e.target.value })}><option value="active">نشط</option><option value="upcoming">قادم</option><option value="completed">مكتمل</option><option value="paused">موقوف</option></select></Field>
            </div>
            <Field label="العنوان"><input className="inp" value={editP.address || ''} onChange={e => setEditP({ ...editP, address: e.target.value })} /></Field>
            <Field label="الوصف"><textarea className="inp" rows={2} value={editP.description || ''} onChange={e => setEditP({ ...editP, description: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      {/* وحدة */}
      <Modal open={!!editU} onClose={() => setEditU(null)} title={editU?.id ? 'تعديل الوحدة' : 'وحدة جديدة'} w={560}
        actions={<><Btn onClick={() => saveUnit(editU)}>حفظ الوحدة</Btn><Btn v="g" onClick={() => setEditU(null)}>إلغاء</Btn></>}>
        {editU && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="كود الوحدة *"><input className="inp num" value={editU.code || ''} onChange={e => setEditU({ ...editU, code: e.target.value })} placeholder="101-A1" /></Field>
              <Field label="المشروع *"><select className="inp" value={editU.project_id || ''} onChange={e => setEditU({ ...editU, project_id: +e.target.value })}>{projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
              <Field label="النوع"><select className="inp" value={editU.type || 'apartment'} onChange={e => setEditU({ ...editU, type: e.target.value })}><option value="apartment">شقة</option><option value="villa">فيلا</option><option value="office">مكتب</option><option value="shop">محل</option></select></Field>
              <Field label="الحالة"><select className="inp" value={editU.status || 'available'} onChange={e => setEditU({ ...editU, status: e.target.value })}>{Object.entries(L.unitStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="الغرف"><input type="number" min={1} className="inp num" value={editU.rooms ?? 3} onChange={e => setEditU({ ...editU, rooms: +e.target.value })} /></Field>
              <Field label="المساحة م²"><input type="number" min={0} className="inp num" value={editU.area || 0} onChange={e => setEditU({ ...editU, area: +e.target.value })} /></Field>
            </div>
            <Field label={`السعر (${cur}) *`}><input type="number" min={0} className="inp num" value={editU.price || 0} onChange={e => setEditU({ ...editU, price: +e.target.value })} /></Field>
            <Field label="وصف"><input className="inp" value={editU.description || ''} onChange={e => setEditU({ ...editU, description: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      {/* حجز */}
      <ReserveModal open={!!reserveU} unit={reserveU} clients={clients} cur={cur} onClose={() => setReserveU(null)} onSave={doReserve} />
    </>
  );
}

export function ReserveModal({ open, unit, clients, cur, onClose, onSave }) {
  const [f, setF] = useState({});
  useEffect(() => { if (open && unit) setF({ unit_id: unit.id, price: unit.price, discount: 0, deposit: 0, deposit_method: 'cash', reservation_date: todayStr(), expiry_date: '', client_id: '', notes: '' }); }, [open]);
  const S = (k, v) => setF(x => ({ ...x, [k]: v }));
  const net = (+f.price || 0) - (+f.discount || 0);
  return (
    <Modal open={open} onClose={onClose} title={`حجز الوحدة ${unit?.code}`} w={560}
      actions={<><Btn onClick={() => onSave(f)}><I n="key" s={15} /> تأكيد الحجز</Btn><Btn v="g" onClick={onClose}>إلغاء</Btn></>}>
      <div className="space-y-3">
        <div className="rounded-xl p-3 text-[13px]" style={{ background: 'rgba(29,97,245,.07)' }}>سعر الوحدة: <b className="num">{fmtN(unit?.price)} {cur}</b></div>
        <Field label="العميل *"><select className="inp" value={f.client_id || ''} onChange={e => S('client_id', +e.target.value)}><option value="">— اختر العميل —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}</select></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={`السعر (${cur})`}><input type="number" min={0} className="inp num" value={f.price || 0} onChange={e => S('price', +e.target.value)} /></Field>
          <Field label="الخصم"><input type="number" min={0} className="inp num" value={f.discount || 0} onChange={e => S('discount', +e.target.value)} /></Field>
          <Field label="الصافي"><input className="inp num" disabled value={fmtN(net)} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="العربون"><input type="number" min={0} className="inp num" value={f.deposit || 0} onChange={e => S('deposit', +e.target.value)} /></Field>
          <Field label="طريقة الدفع"><select className="inp" value={f.deposit_method || 'cash'} onChange={e => S('deposit_method', e.target.value)}>{Object.entries(L.payMethod).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="رقم المرجع"><input className="inp num" value={f.deposit_ref || ''} onChange={e => S('deposit_ref', e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="تاريخ الحجز *"><input type="date" className="inp" value={f.reservation_date || ''} onChange={e => S('reservation_date', e.target.value)} /></Field>
          <Field label="ينتهي بتاريخ"><input type="date" className="inp" value={f.expiry_date || ''} onChange={e => S('expiry_date', e.target.value)} /></Field>
        </div>
        <Field label="ملاحظات"><input className="inp" value={f.notes || ''} onChange={e => S('notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
