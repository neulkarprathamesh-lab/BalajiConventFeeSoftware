import React, { useState, useEffect } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { Calculator, CheckCircle2, AlertTriangle, Loader2, PauseCircle, PlayCircle, Bus, Users, CalendarDays } from 'lucide-react';

const MONTHS = [
  ['01', 'January'], ['02', 'February'], ['03', 'March'], ['04', 'April'],
  ['05', 'May'], ['06', 'June'], ['07', 'July'], ['08', 'August'],
  ['09', 'September'], ['10', 'October'], ['11', 'November'], ['12', 'December'],
];

/**
 * Admin -> Bus Fees -> Generate Monthly Bus Fees.
 * Creates a DUE (bus_charges row) for every active student with an active
 * bus assignment for the chosen month - never a receipt/payment. Fully
 * idempotent: generating the same month twice never double-charges (the
 * backend checks (student, academic_year, month, charge_type) before every
 * insert), so this is safe to click again if unsure, and safe to run
 * alongside the automatic monthly job.
 */
export default function BusFees() {
  const { user } = useAuth();
  const canGenerate = ['administrator', 'manager'].includes(user?.role);
  const [ay, setAy] = useState('2026-27');
  const [month, setMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dash, setDash] = useState(null);
  const [toggleBusy, setToggleBusy] = useState(false);
  const isAdmin = user?.role === 'administrator';

  const loadDash = () => api.get('/bus-charges/dashboard').then(r => setDash(r.data)).catch(() => {});
  useEffect(() => { loadDash(); }, []);

  const stopCharging = async () => {
    const reason = window.prompt('Reason for stopping bus fee charging for ALL students (required):');
    if (reason === null) return; // cancelled
    if (!reason.trim()) return toast.error('A reason is required.');
    if (!window.confirm('Stop bus-fee charging for ALL students?\n\nExisting charges will remain unchanged. No new monthly bus charges will be generated while charging is stopped.')) return;
    setToggleBusy(true);
    try {
      await api.post('/bus-charges/stop', { reason });
      toast.success('Bus fee charging stopped globally.');
      loadDash();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setToggleBusy(false);
  };
  const resumeCharging = async () => {
    if (!window.confirm('Resume bus-fee charging for all students?\n\nMonths that were skipped while charging was stopped will NOT be automatically back-charged — only a Generate action for those specific months would do that.')) return;
    setToggleBusy(true);
    try {
      await api.post('/bus-charges/resume', { reason: '' });
      toast.success('Bus fee charging resumed.');
      loadDash();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setToggleBusy(false);
  };

  const monthKey = `${year}-${month}`;

  const runPreview = async () => {
    setBusy(true); setResult(null);
    try {
      const { data } = await api.post('/bus-charges/preview', { academic_year: ay, month: monthKey });
      setPreview(data);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Preview failed'); }
    setBusy(false);
  };

  const commit = async () => {
    if (!window.confirm(`Generate bus charges for ${preview.month_label}? This creates ${preview.to_generate} new due(s) totalling ${inr(preview.total_new_amount)}. Already-charged students are skipped automatically.`)) return;
    setBusy(true);
    try {
      const { data } = await api.post('/bus-charges/generate', { academic_year: ay, month: monthKey });
      setResult(data);
      setPreview(null);
      if (data.blocked) toast.error(data.blocked_reason);
      else toast.success(`${data.generated} charge(s) generated, ${data.already_existing} already existed.`);
      loadDash();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Generation failed'); }
    setBusy(false);
  };

  if (!canGenerate) {
    return (
      <div className="p-6">
        <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-sm">
          Generating monthly bus fees is available to Administrators and Managers only.
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Bus Fees" subtitle="Monthly bus-fee generation — creates a due amount, never a receipt/payment. Safe to run more than once." />
      <div className="p-6 space-y-4 max-w-3xl">
        {dash && (
          <div className={`rounded-lg border-2 p-4 ${dash.charging_active ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`} data-testid="bf-charging-status">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Bus Fee Charging</div>
                <div className={`font-heading text-xl font-bold ${dash.charging_active ? 'text-emerald-700' : 'text-rose-700'}`} data-testid="bf-charging-label">
                  {dash.charging_active ? 'ACTIVE' : 'STOPPED'}
                </div>
              </div>
              {isAdmin && (
                dash.charging_active ? (
                  <button onClick={stopCharging} disabled={toggleBusy} data-testid="bf-stop-charging" className="h-9 px-4 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded text-sm font-semibold inline-flex items-center gap-1.5">
                    <PauseCircle className="w-4 h-4" /> Stop Bus Fee Charges
                  </button>
                ) : (
                  <button onClick={resumeCharging} disabled={toggleBusy} data-testid="bf-resume-charging" className="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded text-sm font-semibold inline-flex items-center gap-1.5">
                    <PlayCircle className="w-4 h-4" /> Resume Bus Fee Charges
                  </button>
                )
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
              <DashStat icon={Users} label="Active Bus Students" value={dash.active_bus_students} />
              <DashStat icon={CalendarDays} label={dash.current_month_label} value={`${dash.current_month_charges_count} charged · ${inr(dash.current_month_charges_total)}`} small />
              <DashStat icon={Bus} label={`${dash.previous_month_label} Outstanding`} value={inr(dash.previous_month_outstanding)} />
              <DashStat icon={AlertTriangle} label="Total Bus Outstanding" value={inr(dash.total_bus_outstanding)} tone={dash.total_bus_outstanding > 0 ? 'text-rose-700' : ''} />
            </div>
            {!dash.charging_active && (
              <div className="mt-3 text-[12px] text-rose-800">
                No new monthly bus charges will be generated while charging is stopped. Existing charges, student bus assignments, and stop fees are untouched.
              </div>
            )}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded p-4">
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Academic Year</div>
              <input className="w-full h-9 px-3 border border-slate-300 rounded text-sm" value={ay} onChange={e => { setAy(e.target.value); setPreview(null); setResult(null); }} data-testid="bf-year" />
            </label>
            <label className="block">
              <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Month</div>
              <select className="w-full h-9 px-3 border border-slate-300 rounded text-sm bg-white" value={month} onChange={e => { setMonth(e.target.value); setPreview(null); setResult(null); }} data-testid="bf-month">
                {MONTHS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="block">
              <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Calendar Year</div>
              <input type="number" className="w-full h-9 px-3 border border-slate-300 rounded text-sm" value={year} onChange={e => { setYear(e.target.value); setPreview(null); setResult(null); }} data-testid="bf-cyear" />
            </label>
          </div>
          <button onClick={runPreview} disabled={busy} data-testid="bf-preview" className="mt-3 h-9 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            {busy && !preview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />} Preview
          </button>
        </div>

        {preview && (
          <div className="bg-white border border-slate-200 rounded overflow-hidden" data-testid="bf-preview-panel">
            <div className="px-4 py-3 border-b border-slate-200 font-heading font-medium">{preview.month_label} — Preview</div>
            <div className="grid grid-cols-4 gap-3 p-4 bg-slate-50 border-b border-slate-200 text-sm">
              <Stat label="Active Bus Students" value={preview.active_bus_students} />
              <Stat label="Already Generated" value={preview.already_generated} tone="text-amber-700" />
              <Stat label="To Generate" value={preview.to_generate} tone="text-blue-700" />
              <Stat label="Total New Amount" value={inr(preview.total_new_amount)} tone="text-emerald-700" />
            </div>
            {preview.to_generate > 0 ? (
              <>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full dense-table text-[12px]">
                    <thead className="bg-white sticky top-0"><tr className="text-left text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200"><th className="pl-3 py-1.5">Student</th><th>Area — Stop</th><th className="text-right pr-3">Amount</th></tr></thead>
                    <tbody>
                      {preview.rows.map(r => (
                        <tr key={r.student_id} className="border-b border-slate-100">
                          <td className="pl-3 py-1">{r.name} <span className="text-slate-400">· {r.admission_no}</span></td>
                          <td>{r.main_area} — {r.stop_name}</td>
                          <td className="text-right pr-3 font-mono">{inr(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end px-4 py-3 border-t border-slate-200 bg-slate-50">
                  <button onClick={commit} disabled={busy} data-testid="bf-commit" className="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded text-sm font-semibold inline-flex items-center gap-1.5">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Confirm &amp; Generate
                  </button>
                </div>
              </>
            ) : (
              <div className="p-4 text-sm text-slate-500 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Nothing to generate — every actively bus-assigned student already has a charge for {preview.month_label} (or no student is currently bus-assigned).</div>
            )}
          </div>
        )}

        {result && (
          <div className="bg-white border-2 border-emerald-300 rounded overflow-hidden" data-testid="bf-result-panel">
            <div className="px-4 py-3 border-b border-emerald-200 bg-emerald-50 font-heading font-medium flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-emerald-700" /> {result.month_label} — Complete</div>
            <div className="grid grid-cols-4 gap-3 p-4 text-sm">
              <Stat label="Generated" value={result.generated} tone="text-emerald-700" />
              <Stat label="Already Existing" value={result.already_existing} tone="text-amber-700" />
              <Stat label="Failed" value={result.failed} tone={result.failed ? 'text-rose-700' : ''} />
              <Stat label="Total New Charges" value={inr(result.total_amount)} />
            </div>
            {result.errors.length > 0 && (
              <div className="px-4 pb-4">
                <div className="text-[12px] text-rose-700 font-semibold mb-1">Errors</div>
                {result.errors.map((e, i) => <div key={i} className="text-[12px] text-rose-600">{e.name}: {e.error}</div>)}
              </div>
            )}
          </div>
        )}

        <div className="text-[11px] text-slate-500">
          An automatic daily job also generates the current month's charges in the background — this button and the automatic job share the same idempotency check, so running both never double-charges anyone.
        </div>
      </div>
    </>
  );
}

const Stat = ({ label, value, tone = 'text-slate-900' }) => (
  <div>
    <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
    <div className={`font-heading font-semibold text-lg tabular ${tone}`}>{value}</div>
  </div>
);

const DashStat = ({ icon: Icon, label, value, tone = 'text-slate-900', small = false }) => (
  <div className="bg-white/70 rounded p-2.5 border border-white">
    <div className="text-[9px] uppercase tracking-widest text-slate-500 flex items-center gap-1"><Icon className="w-3 h-3" /> {label}</div>
    <div className={`font-heading font-semibold ${small ? 'text-[13px]' : 'text-lg'} tabular mt-0.5 ${tone}`}>{value}</div>
  </div>
);
