import React, { useEffect, useState } from 'react';
import api, { API_BASE } from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { toast } from 'sonner';
import { Camera, Plus, Download, GitCompare, Trash2, RotateCcw, Layers } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

/**
 * Configuration Snapshots — per academic year archive.
 * Each snapshot captures every school-configuration collection (settings, departments,
 * classes, fee structures, receipt types, bus routes, bus stops) so admins can compare
 * years, export any snapshot as a ZIP, or restore one after dual-auth.
 */
export default function ConfigSnapshots() {
  const { user } = useAuth();
  const canEdit = user?.role === 'administrator';
  const [rows, setRows] = useState([]);
  const [creating, setCreating] = useState(false);
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [compareResult, setCompareResult] = useState(null);

  const load = () => api.get('/snapshots').then(r => setRows(r.data));
  useEffect(() => { load(); }, []);

  const askPin = () => window.prompt('Administrator PIN required:') || '';
  const download = async (id, ay) => {
    const pin = askPin();
    if (!pin) return;
    try {
      const r = await fetch(`${API_BASE}/api/snapshots/${id}/export`, {
        credentials: 'include', headers: { 'X-Admin-Pin': pin },
      });
      if (!r.ok) throw new Error(await r.text());
      const blob = await r.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `config-snapshot-${ay}.zip`; a.click(); URL.revokeObjectURL(a.href);
      toast.success('Snapshot exported');
    } catch (e) { toast.error(e.message || 'Failed'); }
  };
  const del = async (id) => {
    if (!window.confirm('Delete this snapshot? This cannot be undone.')) return;
    try { await api.delete(`/snapshots/${id}`); toast.success('Deleted'); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };
  const restore = async (id, ay) => {
    if (!window.confirm(`RESTORE snapshot for ${ay}? Every current configuration row (fees, receipt types, bus stops, etc.) will be replaced. Historical student records and receipts are untouched. You'll need your Admin PIN AND password.`)) return;
    const pin = window.prompt('Administrator PIN:'); if (!pin) return;
    const pwd = window.prompt('Administrator password:'); if (!pwd) return;
    try {
      const r = await fetch(`${API_BASE}/api/snapshots/${id}/restore`, {
        method: 'POST', credentials: 'include',
        headers: { 'X-Admin-Pin': pin, 'X-Admin-Password': pwd },
      });
      if (!r.ok) throw new Error(await r.text());
      toast.success('Snapshot restored — reloading the app…');
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) { toast.error(e.message || 'Failed'); }
  };
  const runCompare = async () => {
    if (!compareA || !compareB || compareA === compareB) return toast.error('Pick two different snapshots');
    try {
      const { data } = await api.get(`/snapshots/${compareA}/compare/${compareB}`);
      setCompareResult(data);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };

  return (
    <>
      <PageHeader
        title="Configuration Snapshots"
        subtitle="Archive the school's configuration each academic year for easy comparison and rollback."
        actions={canEdit && (
          <button onClick={() => setCreating(true)} className="h-9 px-3 bg-blue-600 text-white rounded text-sm flex items-center gap-1.5" data-testid="snap-new">
            <Plus className="w-4 h-4" /> New Snapshot
          </button>
        )}
      />
      <div className="p-6 space-y-6" data-testid="snapshots-page">
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full dense-table">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-600 bg-slate-50">
                <th className="pl-3 py-2 w-32">Year</th>
                <th>Label</th>
                <th className="w-28 text-right">Records</th>
                <th className="w-40">Created</th>
                <th className="text-right pr-3 w-72">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan="5" className="text-center py-8 text-slate-500">No snapshots yet. Create one at the end of each academic year to keep a permanent record of your configuration.</td></tr>
              )}
              {rows.map(s => (
                <tr key={s.id} data-testid={`snap-row-${s.id}`}>
                  <td className="pl-3 font-mono font-semibold text-slate-900">{s.academic_year}</td>
                  <td>
                    <div className="font-medium">{s.label}</div>
                    {s.notes && <div className="text-[11px] text-slate-500">{s.notes}</div>}
                  </td>
                  <td className="text-right font-mono">{s.total_records}</td>
                  <td className="text-[12px] text-slate-600">{new Date(s.created_at).toLocaleString('en-IN')}<div className="text-[10px] text-slate-400">by {s.created_by}</div></td>
                  <td className="text-right pr-3 space-x-1">
                    <button onClick={() => download(s.id, s.academic_year)} className="h-7 px-2 border border-slate-300 rounded text-[11px] inline-flex items-center gap-1 hover:bg-slate-50" data-testid={`snap-export-${s.id}`}><Download className="w-3 h-3" /> Export</button>
                    {canEdit && (
                      <>
                        <button onClick={() => restore(s.id, s.academic_year)} className="h-7 px-2 border border-amber-300 text-amber-800 rounded text-[11px] inline-flex items-center gap-1 hover:bg-amber-50" data-testid={`snap-restore-${s.id}`}><RotateCcw className="w-3 h-3" /> Restore</button>
                        <button onClick={() => del(s.id)} className="h-7 px-2 border border-red-300 text-red-700 rounded text-[11px] inline-flex items-center gap-1 hover:bg-red-50"><Trash2 className="w-3 h-3" /> Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length >= 2 && (
          <div className="bg-white border border-slate-200 rounded-xl p-4" data-testid="snap-compare">
            <div className="font-heading font-semibold mb-3 flex items-center gap-2"><GitCompare className="w-4 h-4" /> Compare two snapshots</div>
            <div className="flex flex-wrap gap-2 items-end">
              <label className="block">
                <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Snapshot A</div>
                <select value={compareA} onChange={e => setCompareA(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm bg-white min-w-[220px]">
                  <option value="">— pick —</option>
                  {rows.map(s => <option key={s.id} value={s.id}>{`${s.academic_year} — ${s.label}`}</option>)}
                </select>
              </label>
              <label className="block">
                <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Snapshot B</div>
                <select value={compareB} onChange={e => setCompareB(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm bg-white min-w-[220px]">
                  <option value="">— pick —</option>
                  {rows.map(s => <option key={s.id} value={s.id}>{`${s.academic_year} — ${s.label}`}</option>)}
                </select>
              </label>
              <button onClick={runCompare} className="h-9 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded text-sm">Compare →</button>
            </div>
            {compareResult && (
              <div className="mt-4 border border-slate-200 rounded overflow-hidden">
                <table className="w-full dense-table text-[12px]">
                  <thead><tr className="bg-slate-50 text-left text-[10px] uppercase tracking-widest text-slate-500"><th className="pl-3 py-2">Collection</th><th className="text-right">A</th><th className="text-right">B</th><th className="text-right">Added</th><th className="text-right">Removed</th><th className="text-right pr-3">Changed</th></tr></thead>
                  <tbody>
                    {compareResult.per_collection.map(c => (
                      <tr key={c.collection} className="border-b border-slate-100">
                        <td className="pl-3 py-1.5 font-medium">{c.collection}</td>
                        <td className="text-right font-mono">{c.count_a}</td>
                        <td className="text-right font-mono">{c.count_b}</td>
                        <td className={`text-right font-mono ${c.added ? 'text-emerald-700 font-semibold' : ''}`}>{c.added || '—'}</td>
                        <td className={`text-right font-mono ${c.removed ? 'text-rose-700 font-semibold' : ''}`}>{c.removed || '—'}</td>
                        <td className={`text-right pr-3 font-mono ${c.changed ? 'text-amber-700 font-semibold' : ''}`}>{c.changed || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      {creating && <SnapshotCreateModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />}
    </>
  );
}

function SnapshotCreateModal({ onClose, onDone }) {
  const [ay, setAy] = useState('2026-27');
  const [label, setLabel] = useState('End of 2026-27');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    const pin = window.prompt('Administrator PIN required to create a snapshot:');
    if (!pin) { setBusy(false); return; }
    try {
      const r = await fetch(`${API_BASE}/api/snapshots`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Pin': pin },
        body: JSON.stringify({ academic_year: ay, label, notes }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      toast.success(`Snapshot created — ${data.total_records} records archived`);
      onDone();
    } catch (e) { toast.error(e.message || 'Failed'); }
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-md bg-white rounded-xl shadow-2xl" data-testid="snap-create-modal">
        <div className="px-5 py-3 border-b border-slate-200 font-heading font-semibold flex items-center gap-2"><Camera className="w-4 h-4" /> Create Snapshot</div>
        <div className="p-5 space-y-3">
          <label className="block">
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Academic Year *</div>
            <input required value={ay} onChange={e => setAy(e.target.value)} placeholder="2026-27" className="w-full h-9 px-3 border border-slate-300 rounded text-sm" data-testid="snap-ay" />
          </label>
          <label className="block">
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Label</div>
            <input value={label} onChange={e => setLabel(e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded text-sm" />
          </label>
          <label className="block">
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Notes (optional)</div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows="3" placeholder="Fee revision approved by the trustee committee on 12-May-2026." className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
          </label>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button type="button" onClick={onClose} className="h-9 px-3 border border-slate-300 rounded text-sm">Cancel</button>
          <button disabled={busy} className="h-9 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm disabled:opacity-60" data-testid="snap-create-submit">
            {busy ? 'Saving…' : 'Create Snapshot'}
          </button>
        </div>
      </form>
    </div>
  );
}
