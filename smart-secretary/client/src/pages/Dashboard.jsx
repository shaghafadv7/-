import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid } from 'recharts';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtN, timeGreet, L, badge } from '../lib/format.js';
import { I, Stat, Badge, Empty, Skeleton, ErrBox, PageHead, Btn, Avatar } from '../components/ui.jsx';
import { go } from '../components/Layout.jsx';

const COLORS = ['#1d61f5', '#7c3aed', '#16a34a', '#d97706', '#dc2626', '#0284c7'];

export default function Dashboard() {
  const { user, can, company } = useStore();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  const load = () => { setErr(''); api('/dashboard').then(setD).catch(e => setErr(e.message)); };
  useEffect(load, []);

  if (err) return <><PageHead title="لوحة القيادة" /><ErrBox msg={err} retry={load} /></>;
  if (!d) return <><PageHead title="لوحة القيادة" /><Skeleton n={5} /></>;
  const s = d.stats || {};

  const quick = [
    can('tasks', 'create') && { t: 'مهمة', icon: 'plus', fn: () => { sessionStorage.setItem('ss_quick', 'new-task'); go('tasks'); } },
    can('appointments', 'create') && { t: 'موعد', icon: 'cal', fn: () => { sessionStorage.setItem('ss_quick', 'new-appt'); go('appointments'); } },
    can('clients', 'create') && { t: 'عميل', icon: 'user', fn: () => { sessionStorage.setItem('ss_quick', 'new-client'); go('clients'); } },
    can('calls', 'create') && { t: 'اتصال', icon: 'phone', fn: () => { sessionStorage.setItem('ss_quick', 'new-call'); go('calls'); } },
    can('notes', 'create') && { t: 'ملاحظة', icon: 'note', fn: () => { sessionStorage.setItem('ss_quick', 'new-note'); go('notes'); } },
    can('files', 'create') && { t: 'ملف', icon: 'ul', fn: () => go('files') },
    can('reports') && { t: 'تقرير', icon: 'chart', fn: () => go('reports') },
  ].filter(Boolean);

  const tasksPie = (d.charts.tasksByStatus || []).map(x => ({ name: L.taskStatus[x.status] || x.status, value: x.n }));
  const salesLine = (d.charts.salesByMonth || []).map(x => ({ name: x.m?.slice(2), value: x.total }));

  return (
    <>
      <div className="card p-5 mb-5 anim-in overflow-hidden relative">
        <div className="absolute top-0 left-0 w-64 h-64 rounded-full opacity-10 pointer-events-none" style={{ background: 'radial-gradient(circle,#1d61f5,transparent)' }} />
        <div className="flex items-center gap-4 flex-wrap">
          <Avatar name={user?.name} s={56} />
          <div className="flex-1 min-w-[200px]">
            <h1 className="text-[20px] font-bold">{timeGreet()}، {user?.name?.split(' ')[0]} <span className="grad-text">— يوم منظم بانتظارك</span></h1>
            <p className="text-[13px]" style={{ color: 'var(--ink2)' }}>{company.company_name} — نظرة شاملة على أعمالك اليوم</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Btn v="p" onClick={() => useStore.getState().setAssistant(true)}><I n="bot" s={16} /> المساعد الذكي</Btn>
            <Btn v="g" onClick={() => useStore.getState().setPalette(true)}><I n="search" s={16} /> بحث <kbd className="text-[10px] opacity-60 num">Ctrl K</kbd></Btn>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5 anim-in">
        {can('tasks') && <Stat icon="check" label="مهام اليوم" value={fmtN(s.tasksToday)} color="#1d61f5" onClick={() => go('tasks')} />}
        {can('tasks') && <Stat icon="alert" label="مهام متأخرة" value={fmtN(s.overdue)} sub={s.overdue ? 'تحتاج تدخلًا فوريًا' : 'ممتاز — لا يوجد'} color="#dc2626" onClick={() => go('tasks')} />}
        {can('appointments') && <Stat icon="cal" label="مواعيد اليوم" value={fmtN(s.todayAppts)} sub={`${fmtN(s.weekAppts || 0)} هذا الأسبوع`} color="#7c3aed" onClick={() => go('appointments')} />}
        {can('clients') && <Stat icon="users" label="العملاء" value={fmtN(s.clients)} sub={`+${fmtN(s.newClients || 0)} هذا الشهر`} color="#16a34a" onClick={() => go('clients')} />}
        {can('calls') && <Stat icon="phone" label="اتصالات اليوم" value={fmtN(s.callsToday)} sub={s.missed ? `${fmtN(s.missed)} فائتة` : ''} color="#0284c7" onClick={() => go('calls')} />}
        {can('reservations') && <Stat icon="key" label="حجوزات نشطة" value={fmtN(s.activeRes)} sub={s.expiringRes ? `${fmtN(s.expiringRes)} تنتهي قريبًا` : ''} color="#d97706" onClick={() => go('reservations')} />}
        {can('sales') && <Stat icon="wallet" label="مبيعات الشهر" value={fmtN(s.monthSales)} color="#16a34a" onClick={() => go('sales')} />}
        {can('units') && <Stat icon="home" label="وحدات متاحة" value={fmtN(s.unitsAvail)} color="#1d61f5" onClick={() => go('projects')} />}
      </div>

      <div className="grid lg:grid-cols-3 gap-3.5 mb-5">
        {/* تركيز اليوم */}
        <div className="card p-5 anim-in">
          <div className="flex items-center gap-2 mb-4"><span style={{ color: 'var(--warn)' }}><I n="star" s={19} /></span><b className="text-[15px]">تركيز اليوم</b></div>
          {(d.focus || []).length === 0 && <Empty icon="check" title="يومك صافٍ" sub="لا توجد عناصر عاجلة — أحسنت!" />}
          <div className="space-y-2.5">
            {(d.focus || []).map((f, i) => (
              <div key={i} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 cursor-pointer hover:opacity-85 text-[13px] font-semibold"
                style={{ background: f.level === 'danger' ? 'rgba(220,38,38,.08)' : f.level === 'warn' ? 'rgba(217,119,6,.09)' : 'rgba(29,97,245,.07)', color: f.level === 'danger' ? 'var(--danger)' : f.level === 'warn' ? '#b45309' : 'var(--brand)' }}
                onClick={() => location.hash = '#' + f.link}>
                <I n={f.kind === 'task' ? 'check' : f.kind === 'appointment' ? 'cal' : f.kind === 'call' ? 'phone' : 'key'} s={17} />
                {f.label}
              </div>
            ))}
          </div>
          {/* إجراءات سريعة */}
          <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--line)' }}>
            <b className="text-[13.5px]">إجراءات سريعة</b>
            <div className="flex gap-2 flex-wrap mt-2.5">
              {quick.map((a, i) => <button key={i} onClick={a.fn} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12.5px] font-bold transition-all hover:-translate-y-0.5" style={{ background: 'var(--bg2)' }}><I n={a.icon} s={15} />{a.t}</button>)}
            </div>
          </div>
        </div>

        {/* مهامي */}
        {can('tasks') && <div className="card p-5 anim-in">
          <div className="flex items-center justify-between mb-3"><b className="text-[15px]">مهامي العاجلة</b><button className="text-[12.5px] font-bold" style={{ color: 'var(--brand)' }} onClick={() => go('tasks')}>عرض الكل ←</button></div>
          {(d.lists.myTasks || []).length === 0 && <Empty icon="check" title="لا توجد مهام" sub="أنت متفرغ تمامًا" />}
          <div className="space-y-2">
            {(d.lists.myTasks || []).slice(0, 6).map(t => (
              <div key={t.id} className="rounded-xl px-3 py-2.5 cursor-pointer hover:opacity-85" style={{ background: 'var(--card2)' }} onClick={() => go('tasks')}>
                <div className="text-[13.5px] font-bold truncate">{t.title}</div>
                <div className="flex gap-1.5 mt-1.5 items-center"><Badge c={badge.priority[t.priority] || 'b-gray'}>{L.priority[t.priority]}</Badge><span className="text-[11.5px] num" style={{ color: 'var(--ink3)' }}>{t.due_date || 'بدون تاريخ'}</span></div>
              </div>
            ))}
          </div>
        </div>}

        {/* المواعيد القادمة */}
        {can('appointments') && <div className="card p-5 anim-in">
          <div className="flex items-center justify-between mb-3"><b className="text-[15px]">المواعيد القادمة</b><button className="text-[12.5px] font-bold" style={{ color: 'var(--brand)' }} onClick={() => go('appointments')}>التقويم ←</button></div>
          {(d.lists.upcoming || []).length === 0 && <Empty icon="cal" title="لا توجد مواعيد" sub="جدولك خالٍ" />}
          <div className="space-y-2.5">
            {(d.lists.upcoming || []).map(a => (
              <div key={a.id} className="flex gap-3 items-center cursor-pointer" onClick={() => go('appointments')}>
                <div className="w-12 shrink-0 rounded-xl text-center py-1.5" style={{ background: 'linear-gradient(135deg, rgba(29,97,245,.14), rgba(124,58,237,.12))' }}>
                  <div className="text-[15px] font-bold num leading-5">{(a.date || '').slice(8)}</div>
                  <div className="text-[10.5px] num" style={{ color: 'var(--ink2)' }}>{(a.date || '').slice(5, 7)}</div>
                </div>
                <div className="min-w-0"><div className="text-[13px] font-bold truncate">{a.title}</div><div className="text-[12px] num" style={{ color: 'var(--ink2)' }}>{a.start_time} — {a.client_name || 'بدون عميل'}</div></div>
              </div>
            ))}
          </div>
        </div>}
      </div>

      {/* رسوم */}
      <div className="grid lg:grid-cols-2 gap-3.5">
        {tasksPie.length > 0 && (
          <div className="card p-5 anim-in">
            <b className="text-[15px]">المهام حسب الحالة</b>
            <div className="h-[230px] mt-2" dir="ltr">
              <ResponsiveContainer><PieChart>
                <Pie data={tasksPie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3} label={({ name, value }) => `${name} ${value}`}>
                  {tasksPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie><Tooltip />
              </PieChart></ResponsiveContainer>
            </div>
          </div>
        )}
        {salesLine.length > 0 && (
          <div className="card p-5 anim-in">
            <b className="text-[15px]">المبيعات — آخر الشهور</b>
            <div className="h-[230px] mt-2" dir="ltr">
              <ResponsiveContainer><LineChart data={salesLine}>
                <CartesianGrid strokeDasharray="3 3" opacity={.3} /><XAxis dataKey="name" /><YAxis /><Tooltip />
                <Line type="monotone" dataKey="value" stroke="#1d61f5" strokeWidth={2.5} dot={{ r: 4 }} />
              </LineChart></ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
