import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { TrendingUp, Receipt, Bell, AlertTriangle, Clock, CheckCircle2, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import OnboardingPopover from '@/components/OnboardingPopover';

const KPI = ({ label, value, hint, icon: Icon, tone = 'default', testid }) => {
  const tones = {
    default: 'text-slate-900',
    success: 'text-emerald-700',
    warning: 'text-amber-700',
    danger: 'text-red-700',
    primary: 'text-blue-700',
  };
  return (
    <div data-testid={testid} className="bg-white border border-slate-200 rounded p-4 hover:shadow-sm transition-shadow duration-150">
      <div className="flex items-start justify-between mb-2">
        <div className="text-[11px] tracking-widest uppercase text-slate-500 font-medium">{label}</div>
        <Icon className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
      </div>
      <div className={`font-heading text-3xl font-semibold tabular tracking-tight ${tones[tone]}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
    </div>
  );
};

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [diag, setDiag] = useState(null);
  const nav = useNavigate();
  const { user } = useAuth();
  useEffect(() => {
    api.get('/dashboard').then(r => setD(r.data));
    api.get('/diagnostics/latest').then(r => setDiag(r.data)).catch(() => {});
  }, []);
  if (!d) return <div className="p-8 text-sm text-slate-500">Loading…</div>;

  // Overnight-fail banner: last snapshot within 30h AND failed
  let overnightFail = null;
  if (diag && diag.created_at && diag.overall_ok === false) {
    const ageH = (Date.now() - new Date(diag.created_at).getTime()) / 3_600_000;
    if (ageH < 30) overnightFail = diag;
  }

  return (
    <>
      <PageHeader title="Dashboard" subtitle={new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })} />
      <OnboardingPopover user={user} />
      <div className="p-6 space-y-6">
        {overnightFail && (
          <div className="bg-rose-50 border-l-4 border-rose-500 rounded p-4 flex items-start gap-3" data-testid="overnight-diag-banner">
            <ShieldAlert className="w-5 h-5 text-rose-700 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold text-rose-900">Overnight diagnostics found {overnightFail.failing?.length || 0} issue{(overnightFail.failing?.length || 0) === 1 ? '' : 's'}</div>
              <div className="text-[13px] text-rose-800">
                {(overnightFail.failing || []).slice(0,3).join(' · ') || 'One or more checks are failing'}
                {' '}— checked {new Date(overnightFail.created_at).toLocaleString('en-IN')}.
              </div>
            </div>
            <button onClick={() => nav('/diagnostics')} className="h-9 px-3 bg-rose-600 hover:bg-rose-700 text-white text-sm rounded" data-testid="overnight-diag-review">Open Diagnostics →</button>
          </div>
        )}
        {d.pending_big_waivers > 0 && (
          <div className="bg-amber-50 border-l-4 border-amber-500 rounded p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold text-amber-900">{d.pending_big_waivers} high-value waiver{d.pending_big_waivers===1?'':'s'} pending administrator approval</div>
              <div className="text-[13px] text-amber-800">These exceed the manager cap and need an admin's decision before they can be applied.</div>
            </div>
            <button onClick={() => nav('/adjustments')} className="h-9 px-3 bg-amber-600 hover:bg-amber-700 text-white text-sm rounded">Review →</button>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KPI testid="kpi-collection" label="Today's Collection" value={inr(d.collection_today)} hint={`${d.receipts_today_count} receipts issued`} icon={TrendingUp} tone="primary" />
          <KPI testid="kpi-receipts" label="Receipts Today" value={d.receipts_today_count} icon={Receipt} />
          <KPI testid="kpi-pending" label="Pending Approvals" value={d.pending_approvals} hint={`${d.pending_adjustments} adj · ${d.pending_extensions} ext`} icon={Clock} tone="warning" />
          <KPI testid="kpi-today" label="Due Today" value={d.due_today} icon={Bell} tone="warning" />
          <KPI testid="kpi-tomorrow" label="Due Tomorrow" value={d.due_tomorrow} icon={Bell} />
          <KPI testid="kpi-overdue" label="Overdue" value={d.overdue} icon={AlertTriangle} tone="danger" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white border border-slate-200 rounded lg:col-span-2">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-heading font-medium text-slate-900">Recent Receipts</h3>
              <button onClick={() => nav('/receipts')} className="text-xs text-blue-700 hover:underline">View all →</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full dense-table" data-testid="recent-receipts">
                <thead>
                  <tr className="text-left text-slate-600 text-[11px] uppercase tracking-wide">
                    <th>Receipt #</th><th>Type</th><th>Payer</th><th>Dept</th><th className="text-right">Amount</th><th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recent_receipts.length === 0 && <tr><td colSpan="6" className="text-center py-6 text-slate-500">No receipts yet today</td></tr>}
                  {d.recent_receipts.map(r => (
                    <tr key={r.id} className="cursor-pointer" onClick={() => nav(`/receipts/${r.id}`)}>
                      <td className="font-mono text-[12px] text-slate-900">{r.number}</td>
                      <td className="text-[12px] capitalize text-slate-600">{r.receipt_type?.replace('_',' ')}</td>
                      <td>{r.payer_name || '-'}</td>
                      <td className="text-slate-600">{r.department_code}</td>
                      <td className="tabular text-right font-medium">{inr(r.total)}</td>
                      <td className="text-slate-500 text-[12px]">{new Date(r.created_at).toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'})}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded">
            <div className="px-4 py-3 border-b border-slate-200">
              <h3 className="font-heading font-medium text-slate-900">Collection by Department</h3>
            </div>
            <div className="p-4 space-y-3">
              {d.dept_totals_today.length === 0 && <div className="text-sm text-slate-500">No collections yet</div>}
              {d.dept_totals_today.map(x => (
                <div key={x.department} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{x.department}</span>
                  <span className="font-mono tabular font-medium">{inr(x.total)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
