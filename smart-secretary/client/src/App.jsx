import React, { useEffect, useState, lazy, Suspense } from 'react';
import { api, getToken } from './lib/api.js';
import { useStore } from './lib/store.js';
import { Toasts, NoPerm } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import Assistant from './components/Assistant.jsx';
import Login from './pages/Login.jsx';
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Tasks = lazy(() => import('./pages/Tasks.jsx'));
const Calendar = lazy(() => import('./pages/Calendar.jsx'));
const Clients = lazy(() => import('./pages/Clients.jsx'));
const Calls = lazy(() => import('./pages/Calls.jsx'));
const Notes = lazy(() => import('./pages/Notes.jsx'));
const Files = lazy(() => import('./pages/Files.jsx'));
const Projects = lazy(() => import('./pages/Projects.jsx'));
const Reservations = lazy(() => import('./pages/Reservations.jsx'));
const Sales = lazy(() => import('./pages/Sales.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Notifications = lazy(() => import('./pages/Notifications.jsx'));
const Users = lazy(() => import('./pages/Admin.jsx').then(m => ({ default: m.Users })));
const Roles = lazy(() => import('./pages/Admin.jsx').then(m => ({ default: m.Roles })));
const Audit = lazy(() => import('./pages/Admin.jsx').then(m => ({ default: m.Audit })));
const Settings = lazy(() => import('./pages/Settings.jsx').then(m => ({ default: m.Settings })));
const Backup = lazy(() => import('./pages/Settings.jsx').then(m => ({ default: m.Backup })));
const PageLoader = () => (<div className="space-y-3 pt-2"><div className="skel" style={{ height: 120 }} /><div className="skel" style={{ height: 220 }} /></div>);

const ROUTES = {
  dashboard: { c: Dashboard, m: 'dashboard' },
  tasks: { c: Tasks, m: 'tasks' },
  appointments: { c: Calendar, m: 'appointments' },
  clients: { c: Clients, m: 'clients' },
  calls: { c: Calls, m: 'calls' },
  notes: { c: Notes, m: 'notes' },
  files: { c: Files, m: 'files' },
  projects: { c: Projects, m: 'projects' },
  reservations: { c: Reservations, m: 'reservations' },
  sales: { c: Sales, m: 'sales' },
  reports: { c: Reports, m: 'reports' },
  notifications: { c: Notifications, m: 'notifications' },
  users: { c: Users, m: 'users' },
  roles: { c: Roles, m: 'roles' },
  audit: { c: Audit, m: 'audit' },
  settings: { c: Settings, m: 'settings' },
  backup: { c: Backup, m: 'backup' },
};

export default function App() {
  const { user, setAuth, setCompany, toasts, setOnline, can } = useStore();
  const [route, setRoute] = useState(() => (location.hash || '#/dashboard').replace('#/', ''));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const f = () => setRoute((location.hash || '#/dashboard').replace('#/', ''));
    window.addEventListener('hashchange', f);
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => { window.removeEventListener('hashchange', f); window.removeEventListener('online', on); window.removeEventListener('offline', on); };
  }, []);

  useEffect(() => {
    (async () => {
      if (!getToken()) { setReady(true); return; }
      try {
        const me = await api('/auth/me');
        setAuth(me.user, me.perms);
        try { setCompany(await api('/settings/public')); } catch {}
      } catch { /* يبقى في الدخول */ }
      setReady(true);
    })();
  }, []);

  if (!ready) return <div className="h-full flex items-center justify-center"><div className="text-center"><div className="skel mx-auto" style={{ width: 64, height: 64, borderRadius: 18 }} /><div className="mt-3 font-bold">Smart Secretary</div></div></div>;
  if (!user) return <><Login onDone={() => location.hash = '#/dashboard'} /><Toasts toasts={toasts} /></>;
  if (route === 'login') { location.hash = '#/dashboard'; return null; }

  const R = ROUTES[route];
  const Page = R?.c;
  const allowed = R ? can(R.m) : false;

  return (
    <>
      <Layout route={route}>
        {!R && <div className="card p-10 text-center"><b>الصفحة غير موجودة</b></div>}
        {R && !allowed && <NoPerm />}
        {R && allowed && <Page key={route} />}
      </Layout>
      <CommandPalette />
      <Assistant />
      <Toasts toasts={toasts} />
    </>
  );
}
