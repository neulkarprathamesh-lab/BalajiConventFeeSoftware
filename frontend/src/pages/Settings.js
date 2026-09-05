import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { toast } from 'sonner';
import { Settings2, Save } from 'lucide-react';

export default function Settings() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/settings').then(r => setS(r.data)); }, []);
  if (!s) return <div className="p-8 text-sm text-slate-500">Loading…</div>;

  const set = (k, v) => setS({ ...s, [k]: v });
  const save = async () => {
    setBusy(true);
    try { const { data } = await api.patch('/settings', s); setS(data); toast.success('Settings saved'); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setBusy(false);
  };

  return (
    <>
      <PageHeader title="School Settings" subtitle="Customize the software — school info, notice footer, and bus fee configuration"
        actions={<button data-testid="settings-save" onClick={save} disabled={busy} className="h-9 px-3 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-60 flex items-center gap-1.5"><Save className="w-4 h-4" />Save Changes</button>}
      />
      <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-5xl">

        <div className="bg-white border border-slate-200 rounded p-5">
          <div className="flex items-center gap-2 mb-4"><Settings2 className="w-5 h-5 text-slate-600" /><h3 className="font-heading font-medium">School Identity</h3></div>
          <div className="space-y-3">
            <F label="School Name"><input className={inp} value={s.school_name || ''} onChange={e=>set('school_name', e.target.value)} /></F>
            <F label="Address"><input className={inp} value={s.school_address || ''} onChange={e=>set('school_address', e.target.value)} /></F>
            <div className="grid grid-cols-2 gap-3">
              <F label="Phone"><input className={inp} value={s.school_phone || ''} onChange={e=>set('school_phone', e.target.value)} /></F>
              <F label="Email"><input className={inp} value={s.school_email || ''} onChange={e=>set('school_email', e.target.value)} /></F>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-5">
          <div className="flex items-center gap-2 mb-4"><Settings2 className="w-5 h-5 text-slate-600" /><h3 className="font-heading font-medium">Receipt & Notice Text</h3></div>
          <div className="space-y-3">
            <F label="Receipt Footer"><textarea rows="2" className={inp} value={s.receipt_footer || ''} onChange={e=>set('receipt_footer', e.target.value)} /></F>
            <F label="Fee Notice Footer"><textarea rows="3" className={inp} value={s.notice_footer || ''} onChange={e=>set('notice_footer', e.target.value)} /></F>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-5">
          <div className="flex items-center gap-2 mb-4"><Settings2 className="w-5 h-5 text-slate-600" /><h3 className="font-heading font-medium">Bus Fee & Approval Caps</h3></div>
          <div className="space-y-3">
            <F label="Bus Months per Year (used when computing outstanding bus fee)"><input type="number" min="1" max="12" className={inp} value={s.bus_annual_months || 12} onChange={e=>set('bus_annual_months', parseInt(e.target.value) || 12)} /></F>
            <F label="Manager Waiver Cap (₹) — adjustments above this need administrator approval"><input type="number" min="0" className={inp} value={s.manager_waiver_cap ?? 5000} onChange={e=>set('manager_waiver_cap', parseFloat(e.target.value) || 0)} /></F>
            <div className="text-[12px] text-slate-500">If a student's <span className="font-mono">bus_route</span> is set on the Students page, their fee notice adds <span className="font-mono">route.monthly_fee × months</span> to the outstanding.</div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-5 bg-slate-50">
          <div className="flex items-center gap-2 mb-2"><Settings2 className="w-5 h-5 text-slate-600" /><h3 className="font-heading font-medium">User & Role Management</h3></div>
          <div className="text-sm text-slate-600 mb-3">Only administrators can create user IDs and assign roles. Manage staff logins here:</div>
          <a href="/admin" className="inline-flex h-9 px-3 items-center bg-slate-900 text-white rounded text-sm hover:bg-slate-800">Open Administration →</a>
        </div>
      </div>
    </>
  );
}
const inp = "w-full h-9 px-3 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none bg-white";
const F = ({label, children}) => <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">{label}</div>{children}</label>;
