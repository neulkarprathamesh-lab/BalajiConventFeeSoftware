import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';

const CURRENT_VERSION = '1.0.0';
import {
  LayoutDashboard, Users, Receipt, FileEdit, CalendarClock, Bell,
  FileText, BarChart3, LogOut, Wallet, Shield, XCircle, Award, Bus, GraduationCap, Mail, Settings2, User as UserIcon, Lock as LockIcon, ClipboardList, BookOpen, Sunset, Rocket, Stethoscope, Bomb, Landmark
} from 'lucide-react';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['*'] },
  { to: '/students', label: 'Students', icon: Users, roles: ['*'] },
  { to: '/import-excel', label: 'Excel Import', icon: FileText, roles: ['administrator','manager','accountant'] },
  { to: '/imports-history', label: 'Import History', icon: ClipboardList, roles: ['administrator','manager','accountant'] },
  { to: '/new-receipt', label: 'New Receipt', icon: Receipt, roles: ['*'] },
  { to: '/finance', label: 'Finance / Voucher', icon: Wallet, roles: ['administrator','manager','accountant'] },
  { to: '/receipts', label: 'Receipts', icon: FileText, roles: ['*'] },
  { to: '/adjustments', label: 'Fee Adjustments (Legacy)', icon: FileEdit, roles: ['*'] },
  { to: '/fee-adjustment-applications', label: 'Fee Adjustment Applications', icon: Landmark, roles: ['*'] },
  { to: '/extensions', label: 'Payment Extensions', icon: CalendarClock, roles: ['*'] },
  { to: '/reminders', label: 'Reminders', icon: Bell, roles: ['*'] },
  { to: '/bus-routes', label: 'Bus Routes', icon: Bus, roles: ['*'] },
  { to: '/bus-stops', label: 'Bus Stop Master', icon: Bus, roles: ['administrator','manager','accountant'] },
  { to: '/bus-fees', label: 'Bus Fees', icon: Bus, roles: ['administrator','manager'] },
  { to: '/bus-fee-report', label: 'Bus Fee Report', icon: Bus, roles: ['administrator','manager','accountant'] },
  { to: '/fee-notices', label: 'Fee Notices', icon: Mail, roles: ['*'] },
  { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['*'] },
  { to: '/defaulters', label: 'Defaulters', icon: XCircle, roles: ['*'] },
  { to: '/cancellations', label: 'Cancellations', icon: XCircle, roles: ['administrator','manager','accountant'] },
  { to: '/concessions', label: 'Concession Ledger', icon: Award, roles: ['administrator','manager','accountant'] },
  { to: '/promotion', label: 'Promotion & Rollover', icon: GraduationCap, roles: ['administrator','manager'] },
  { to: '/assign-students', label: 'Assign Students', icon: ClipboardList, roles: ['administrator','manager','accountant'] },
  { to: '/fee-structure', label: 'Fee Structure', icon: Wallet, roles: ['administrator','manager','accountant'] },
  { to: '/bulk-fee-update', label: 'Bulk Fee Detail Update', icon: Landmark, roles: ['administrator','manager','accountant'] },
  { to: '/fee-brochure', label: 'Fee Brochure', icon: BookOpen, roles: ['*'] },
  { to: '/kiosk-poster', label: 'Kiosk QR Poster', icon: BookOpen, roles: ['administrator','manager','accountant'] },
  { to: '/settings', label: 'Settings', icon: Settings2, roles: ['administrator'] },
  { to: '/config-snapshots', label: 'Config Snapshots', icon: BookOpen, roles: ['administrator','manager'] },
  { to: '/software-updates', label: 'Software Updates', icon: Rocket, roles: ['administrator','manager'] },
  { to: '/diagnostics', label: 'System Diagnostics', icon: Stethoscope, roles: ['*'] },
  { to: '/delivery-center', label: 'Delivery Center', icon: Rocket, roles: ['administrator'] },
  { to: '/factory-reset', label: 'Factory Reset', icon: Bomb, roles: ['administrator'] },
  { to: '/admin', label: 'Administration', icon: Shield, roles: ['administrator'] },
];

const roleColors = {
  administrator: 'bg-slate-900 text-white',
  manager: 'bg-blue-700 text-white',
  accountant: 'bg-emerald-700 text-white',
  cashier: 'bg-amber-700 text-white',
};

export default function Layout() {
  const { user, logout, lock } = useAuth();
  const navigate = useNavigate();
  const [update, setUpdate] = useState(null);
  const [diagFail, setDiagFail] = useState(0);   // count of failing server-side checks; drives red badge

  useEffect(() => {
    if (localStorage.getItem('bc.update.dismiss') === CURRENT_VERSION) return;
    fetch('/downloads/version.json?_=' + Date.now()).then(r => r.json()).then(v => {
      if (v?.version && v.version !== CURRENT_VERSION) setUpdate(v);
    }).catch(() => {});
  }, []);
  const dismissUpdate = () => { localStorage.setItem('bc.update.dismiss', CURRENT_VERSION); setUpdate(null); };

  // Poll diagnostics summary in the background so a red badge appears on the sidebar
  // whenever any server-side check turns red — without the user needing to open the page.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const run = async () => {
      try {
        // Authenticated endpoint - must go through the shared `api` instance
        // so the Authorization: Bearer <token> interceptor attaches. A raw
        // axios call here previously 401'd on every poll, permanently
        // showing a false "1 diagnostic check failing" badge regardless of
        // actual system health.
        const r = await api.get('/diagnostics');
        if (cancelled) return;
        const fails = (r.data?.server_side_checks || []).filter(c => !c.ok).length;
        setDiagFail(fails);
      } catch {
        if (!cancelled) setDiagFail(1); // reaching the endpoint failed → Main Server issue
      }
    };
    run();
    const t = setInterval(run, 5 * 60 * 1000);   // every 5 minutes
    return () => { cancelled = true; clearInterval(t); };
  }, [user]);

  const visible = nav.filter(n => n.roles.includes('*') || n.roles.includes(user?.role));

  return (
    <div className="h-screen flex bg-slate-50 overflow-hidden">
      {update && user?.role === 'administrator' && (
        <div data-testid="update-banner" className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-slate-900 px-4 py-2 flex items-center justify-center gap-3 text-[12px] no-print">
          <Rocket className="w-4 h-4" />
          <span><b>New version {update.version} available</b> — released {new Date(update.published_at).toLocaleDateString('en-IN')}. {update.notes}</span>
          <a href={update.download_url} download className="ml-2 h-7 px-3 bg-slate-900 text-white rounded text-[11px] font-semibold hover:bg-slate-800">Download</a>
          <button data-testid="update-dismiss" onClick={dismissUpdate} className="h-7 px-2 text-slate-700 hover:text-slate-900 text-[11px]">Dismiss</button>
        </div>
      )}
      <aside className="w-60 bg-slate-900 text-slate-100 flex flex-col no-print">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <img src="/school-logo.jpeg" alt="Balaji Convent" className="w-10 h-10 rounded-full object-cover ring-1 ring-slate-700" data-testid="sidebar-logo" />
            <div>
              <div className="font-heading font-bold text-[15px] leading-tight" data-testid="sidebar-app-name">Balaji FeeHub</div>
              <div className="text-[9px] tracking-[0.2em] uppercase text-slate-400 leading-tight">Balaji Convent · Butibori</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 py-3 px-2 overflow-y-auto">
          {visible.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              data-testid={`nav-${item.to.replace(/\//g,'') || 'home'}`}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded text-[13px] mb-0.5 transition-colors duration-150 ${
                  isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <item.icon className="w-4 h-4" strokeWidth={1.75} />
              <span className="flex-1">{item.label}</span>
              {item.to === '/diagnostics' && diagFail > 0 && (
                <span
                  data-testid="nav-diagnostics-badge"
                  title={`${diagFail} diagnostic check${diagFail > 1 ? 's' : ''} failing`}
                  className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold bg-rose-500 text-white animate-pulse"
                >
                  {diagFail}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-semibold">
              {user?.name?.[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium truncate">{user?.name}</div>
              <span className={`inline-block text-[10px] tracking-wide uppercase px-1.5 py-0.5 rounded ${roleColors[user?.role] || 'bg-slate-700'}`}>
                {user?.role}
              </span>
            </div>
          </div>
          <button
            data-testid="profile-btn"
            onClick={() => navigate('/profile')}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-[13px] text-slate-300 hover:text-white hover:bg-slate-800 rounded mb-0.5"
          >
            <UserIcon className="w-4 h-4" /> My Profile
          </button>
          <button
            data-testid="lock-btn"
            onClick={lock}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-[13px] text-slate-300 hover:text-white hover:bg-slate-800 rounded mb-0.5"
          >
            <LockIcon className="w-4 h-4" /> Lock Screen
          </button>
          <button
            data-testid="logout-btn"
            onClick={async () => { await logout(); navigate('/login'); }}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-[13px] text-slate-300 hover:text-white hover:bg-slate-800 rounded"
          >
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 flex flex-col overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between no-print">
      <div>
        <h1 className="font-heading text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <div className="text-[13px] text-slate-500 mt-0.5">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}

export const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n || 0);
