import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { toast } from 'sonner';
import { Plus, Bus, Pencil, Trash2, PowerOff, Power, Search, TrendingUp, TrendingDown, IndianRupee, BarChart3, Users, Upload, Download, CheckCircle2, XCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import * as XLSX from 'xlsx';

/**
 * Bus Stop Manager — Administrator page under Bus Routes.
 * Add / edit / deactivate stops and update fares for future academic years.
 * Stops used by any student cannot be deleted (must set inactive instead).
 */
export default function BusStops() {
  const { user } = useAuth();
  const canEdit = ['administrator', 'manager', 'accountant'].includes(user?.role);
  const canDelete = user?.role === 'administrator';
  const canBulk = ['administrator', 'manager'].includes(user?.role);
  const [stops, setStops] = useState([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // full stop being edited (null = closed)
  const [creating, setCreating] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [tab, setTab] = useState('stops'); // stops | reports
  const [areaReport, setAreaReport] = useState([]);
  const [withoutStop, setWithoutStop] = useState([]);
  const [stopWise, setStopWise] = useState([]);

  const load = () => api.get('/bus-stops').then(r => setStops(r.data));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (tab !== 'reports') return;
    api.get('/reports/bus/area-wise').then(r => setAreaReport(r.data)).catch(() => {});
    api.get('/reports/bus/without-stop').then(r => setWithoutStop(r.data)).catch(() => {});
    api.get('/reports/bus/stop-wise').then(r => setStopWise(r.data)).catch(() => {});
  }, [tab]);

  const [seeding, setSeeding] = useState(false);
  const seed2026 = async () => {
    if (!window.confirm('Load the confirmed 2026-27 bus stops (31 stops across 14 areas)? Existing stops for 2026-27 are kept — only missing ones are added.')) return;
    setSeeding(true);
    try {
      const { data } = await api.post('/bus-stops/seed-2026');
      toast.success(`${data.created} stop(s) added, ${data.skipped} already existed.`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setSeeding(false);
  };

  const toggleActive = async (s) => {
    try {
      await api.patch(`/bus-stops/${s.id}`, { active: !s.active });
      toast.success(s.active ? 'Stop set inactive' : 'Stop re-activated');
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };
  const remove = async (s) => {
    if (!window.confirm(`Delete stop #${s.stop_no} — ${s.stop_name}? Students assigned to this stop must be reassigned first.`)) return;
    try {
      await api.delete(`/bus-stops/${s.id}`);
      toast.success('Stop deleted');
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };

  const filtered = stops.filter(s => {
    if (!q) return true;
    const needle = q.toLowerCase();
    return String(s.stop_no).includes(needle) || (s.stop_name || '').toLowerCase().includes(needle) || (s.main_area || '').toLowerCase().includes(needle);
  });
  const activeCount = stops.filter(s => s.active !== false).length;
  const totalCollection = stops.reduce((sum, s) => sum + (s.active !== false ? Number(s.monthly_fee || 0) : 0), 0);

  return (
    <>
      <PageHeader
        title="Bus Stop Master"
        subtitle={`${stops.length} stops · ${activeCount} active · avg ₹${stops.length ? Math.round(totalCollection / activeCount) : 0}/student/month`}
        actions={canEdit && (
          <div className="flex gap-2">
            {canBulk && (
              <button data-testid="bs-seed" onClick={seed2026} disabled={seeding} className="h-9 px-3 border border-slate-300 text-slate-800 rounded text-sm flex items-center gap-1.5 hover:bg-white disabled:opacity-60">
                <Bus className="w-4 h-4" /> {seeding ? 'Loading…' : 'Load 2026-27 (31 stops)'}
              </button>
            )}
            {canBulk && (
              <button data-testid="bs-bulk" onClick={() => setBulk(true)} className="h-9 px-3 border border-slate-300 text-slate-800 rounded text-sm flex items-center gap-1.5 hover:bg-white">
                <TrendingUp className="w-4 h-4" /> Bulk Fare Update
              </button>
            )}
            {canBulk && (
              <button data-testid="bs-assign" onClick={() => setAssignOpen(true)} className="h-9 px-3 border border-slate-300 text-slate-800 rounded text-sm flex items-center gap-1.5 hover:bg-white">
                <Upload className="w-4 h-4" /> Bulk Assign Students
              </button>
            )}
            <button data-testid="bs-new" onClick={() => setCreating(true)} className="h-9 px-3 bg-blue-600 text-white rounded text-sm flex items-center gap-1.5 hover:bg-blue-700">
              <Plus className="w-4 h-4" /> New Stop
            </button>
          </div>
        )}
      />
      <div className="p-6 space-y-4">
        <div className="flex gap-2 border-b border-slate-200">
          {[['stops', 'Stops'], ['reports', 'Reports']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 text-sm border-b-2 ${tab === k ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-slate-600'}`} data-testid={`bs-tab-${k}`}>{l}</button>
          ))}
        </div>
        {tab === 'reports' ? (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 font-heading font-medium text-sm flex items-center gap-1.5"><BarChart3 className="w-4 h-4" /> Area-wise Student Count &amp; Collection</div>
              <table className="w-full dense-table">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600 bg-slate-50"><th className="pl-3 py-2">Main Area</th><th className="text-right">Stops</th><th className="text-right">Students</th><th className="text-right pr-3">Monthly Collection</th></tr></thead>
                <tbody>
                  {areaReport.map(a => (
                    <tr key={a.main_area}><td className="pl-3 font-medium">{a.main_area}</td><td className="text-right">{a.stop_count}</td><td className="text-right">{a.student_count}</td><td className="text-right pr-3 tabular font-mono">{inr(a.monthly_collection)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bg-white border border-slate-200 rounded overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 font-heading font-medium text-sm flex items-center gap-1.5"><Bus className="w-4 h-4" /> Stop-wise Student List</div>
              <table className="w-full dense-table">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600 bg-slate-50"><th className="pl-3 py-2">Area</th><th>Stop</th><th className="text-right">Students</th><th className="text-right pr-3">Collection</th></tr></thead>
                <tbody>
                  {stopWise.filter(s => s.student_count > 0).map(s => (
                    <tr key={s.id}><td className="pl-3 text-slate-600">{s.main_area}</td><td>{s.stop_name}</td><td className="text-right">{s.student_count}</td><td className="text-right pr-3 tabular font-mono">{inr(s.monthly_collection)}</td></tr>
                  ))}
                  {stopWise.filter(s => s.student_count > 0).length === 0 && <tr><td colSpan="4" className="text-center py-6 text-slate-500">No students assigned to any stop yet</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="bg-white border border-slate-200 rounded overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 font-heading font-medium text-sm flex items-center gap-1.5"><Users className="w-4 h-4" /> Students Without a Bus Stop ({withoutStop.length})</div>
              <table className="w-full dense-table">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600 bg-slate-50"><th className="pl-3 py-2">Admission No</th><th>Name</th></tr></thead>
                <tbody>
                  {withoutStop.slice(0, 100).map(s => (
                    <tr key={s.id}><td className="pl-3 font-mono text-[12px]">{s.admission_no}</td><td>{s.name}</td></tr>
                  ))}
                  {withoutStop.length === 0 && <tr><td colSpan="2" className="text-center py-6 text-slate-500">Every active student has a bus stop assigned</td></tr>}
                </tbody>
              </table>
              {withoutStop.length > 100 && <div className="px-3 py-2 text-[12px] text-slate-500 border-t border-slate-100">…and {withoutStop.length - 100} more</div>}
            </div>
          </div>
        ) : (
        <>
        <div className="bg-white border border-slate-200 rounded p-3 flex items-center gap-3">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            className="flex-1 h-8 text-sm outline-none"
            placeholder="Search stop number, area or name…"
            value={q} onChange={e => setQ(e.target.value)}
            data-testid="bs-search"
          />
          <span className="text-[11px] text-slate-500">{filtered.length} shown</span>
        </div>

        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <table className="w-full dense-table">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-600 bg-slate-50">
                <th className="pl-3 py-2 w-16">#</th>
                <th>Main Area</th>
                <th>Sub Stop</th>
                <th className="text-right w-32">Monthly Fee</th>
                <th className="w-20">Year</th>
                <th className="w-24">Status</th>
                {canEdit && <th className="w-40 text-right pr-3">Actions</th>}
              </tr>
            </thead>
            <tbody data-testid="bs-table">
              {filtered.length === 0 && (
                <tr><td colSpan={canEdit ? 7 : 6} className="text-center py-8 text-slate-500">No stops match — try clearing the search or add one from the button above.</td></tr>
              )}
              {filtered.map(s => (
                <tr key={s.id} className={s.active === false ? 'opacity-50' : ''} data-testid={`bs-row-${s.stop_no}`}>
                  <td className="pl-3 font-mono text-[13px]">{s.stop_no}</td>
                  <td className="text-slate-600">{s.main_area}</td>
                  <td className="font-medium">{s.stop_name}</td>
                  <td className="text-right tabular font-mono">{inr(s.monthly_fee)}</td>
                  <td className="text-[12px] text-slate-500">{s.academic_year}</td>
                  <td>
                    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${s.active !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                      {s.active !== false ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {canEdit && (
                    <td className="text-right pr-3 space-x-1">
                      <button onClick={() => setEditing(s)} className="h-7 px-2 border border-slate-300 rounded text-[11px] hover:bg-slate-50 inline-flex items-center gap-1" data-testid={`bs-edit-${s.stop_no}`}>
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                      <button onClick={() => toggleActive(s)} className="h-7 px-2 border border-slate-300 rounded text-[11px] hover:bg-slate-50 inline-flex items-center gap-1" data-testid={`bs-toggle-${s.stop_no}`}>
                        {s.active !== false ? <><PowerOff className="w-3 h-3" /> Deactivate</> : <><Power className="w-3 h-3" /> Activate</>}
                      </button>
                      {canDelete && (
                        <button onClick={() => remove(s)} className="h-7 px-2 border border-red-300 text-red-700 rounded text-[11px] hover:bg-red-50 inline-flex items-center gap-1" data-testid={`bs-del-${s.stop_no}`}>
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
        )}
      </div>

      {editing && <StopModal stop={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
      {creating && <StopModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />}
      {bulk && <BulkFareModal stops={stops} onClose={() => setBulk(false)} onDone={() => { setBulk(false); load(); }} />}
      {assignOpen && <BulkAssignModal onClose={() => setAssignOpen(false)} onDone={() => setAssignOpen(false)} />}
    </>
  );
}

function BulkAssignModal({ onClose, onDone }) {
  const fileRef = React.useRef();
  const [state, setState] = useState(null); // { rows, filename, preview, stage }
  const [downloading, setDownloading] = useState(false);

  const downloadTemplate = async () => {
    setDownloading(true);
    try {
      const { data } = await api.get('/bus-assignment-template.xlsx', { params: { academic_year: '2026-27' }, responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([data]));
      const a = document.createElement('a');
      a.href = url; a.download = 'Bus_Assignment_Template_2026-27.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error('Could not download template'); }
    setDownloading(false);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames.find(n => n !== 'BusStopMaster' && n !== 'Lists') || wb.SheetNames[0];
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
    const headerIdx = raw.findIndex(row => row.some(c => String(c).trim() === 'Admission No.'));
    if (headerIdx === -1) { toast.error('Could not find the header row in this file'); return; }
    const headers = raw[headerIdx].map(h => String(h).trim());
    const col = (name) => headers.indexOf(name);
    const rows = raw.slice(headerIdx + 1)
      .filter(r => r[col('Admission No.')])
      .map(r => ({
        admission_no: String(r[col('Admission No.')]).trim(),
        bus_required: String(r[col('Bus Required (Yes/No)')] || r[col('Bus Required')] || '').trim(),
        main_stop: String(r[col('Main Stop')] || '').trim(),
        sub_stop: String(r[col('Sub Stop')] || '').trim(),
      }));
    if (!rows.length) { toast.error('No data rows found'); return; }
    setState({ rows, filename: file.name, preview: null, stage: 'preview' });
    fileRef.current.value = '';
    try {
      const { data } = await api.post('/bus-assignment/bulk-import', { rows, preview: true, academic_year: '2026-27' });
      setState(prev => ({ ...prev, preview: data }));
    } catch (ex) { toast.error(ex?.response?.data?.detail || 'Preview failed'); setState(null); }
  };

  const confirm = async () => {
    if (!state) return;
    setState(prev => ({ ...prev, stage: 'committing' }));
    try {
      const { data } = await api.post('/bus-assignment/bulk-import', { rows: state.rows, preview: false, academic_year: '2026-27' });
      toast.success(`✓ ${data.assigned} assigned, ${data.removed} removed, ${data.errors.length} skipped`);
      onDone();
    } catch (ex) { toast.error(ex?.response?.data?.detail || 'Import failed'); setState(prev => ({ ...prev, stage: 'preview' })); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded shadow-lg w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="px-5 py-3 border-b border-slate-200 font-heading font-medium flex items-center justify-between">
          <span>Bulk Assign Students to Bus Stops</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>
        {!state ? (
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-600">Download the template — it already has every student and a real Main Stop → Sub Stop dropdown built from the current Bus Stop Master. Fill it in, then upload it here.</p>
            <div className="flex gap-2">
              <button onClick={downloadTemplate} disabled={downloading} className="h-9 px-4 border border-slate-300 rounded text-sm hover:bg-slate-50 flex items-center gap-1.5"><Download className="w-4 h-4" /> {downloading ? 'Preparing…' : 'Download Template (XLSX)'}</button>
              <label className="h-9 px-4 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 flex items-center gap-1.5 cursor-pointer">
                <Upload className="w-4 h-4" /> Upload Filled File
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />
              </label>
            </div>
          </div>
        ) : !state.preview ? (
          <div className="p-8 text-center text-sm text-slate-500">Validating…</div>
        ) : (
          <>
            <div className="p-4 grid grid-cols-4 gap-2 text-center border-b border-slate-200">
              <div className="border border-slate-200 rounded p-2"><div className="text-lg font-heading font-semibold">{state.preview.total_rows}</div><div className="text-[10px] uppercase text-slate-500">Total Rows</div></div>
              <div className="border border-slate-200 rounded p-2"><div className="text-lg font-heading font-semibold text-emerald-700 flex items-center justify-center gap-1"><CheckCircle2 className="w-4 h-4" />{state.preview.rows_to_assign}</div><div className="text-[10px] uppercase text-slate-500">To Assign</div></div>
              <div className="border border-slate-200 rounded p-2"><div className="text-lg font-heading font-semibold text-blue-700">{state.preview.rows_to_remove}</div><div className="text-[10px] uppercase text-slate-500">To Remove</div></div>
              <div className="border border-slate-200 rounded p-2"><div className="text-lg font-heading font-semibold text-red-700 flex items-center justify-center gap-1"><XCircle className="w-4 h-4" />{state.preview.invalid_rows}</div><div className="text-[10px] uppercase text-slate-500">Invalid</div></div>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-3">
              {state.preview.invalid.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-wide text-red-700">Invalid rows (will NOT be imported — no new stop is ever created from a typo)</div>
                  {state.preview.invalid.map((e, i) => <div key={i} className="text-[12px] text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1">Row {e.row}: {e.error}</div>)}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
              <button onClick={onClose} className="h-9 px-3 border border-slate-300 rounded text-sm">Cancel — Nothing Imported</button>
              <button onClick={confirm} disabled={state.stage === 'committing' || (state.preview.rows_to_assign + state.preview.rows_to_remove) === 0}
                className="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded text-sm font-semibold">
                {state.stage === 'committing' ? 'Importing…' : `Confirm (${state.preview.rows_to_assign + state.preview.rows_to_remove} rows)`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BulkFareModal({ stops, onClose, onDone }) {
  const [op, setOp] = useState('increase_percent');
  const [value, setValue] = useState('10');
  const [roundTo, setRoundTo] = useState('10');
  const [effective, setEffective] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const runPreview = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/bus-stops/bulk-update', {
        operation: op, value: parseFloat(value) || 0, round_to: parseInt(roundTo, 10) || 1,
        preview: true, effective_date: effective, reason,
      });
      setPreview(data);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Preview failed'); }
    setBusy(false);
  };
  const apply = async () => {
    if (!window.confirm(`Apply new fares to ${preview.rows.length} stops? This affects ${preview.total_students_affected} students and cannot be undone from this screen (roll back via a config snapshot).`)) return;
    setBusy(true);
    try {
      const { data } = await api.post('/bus-stops/bulk-update', {
        operation: op, value: parseFloat(value) || 0, round_to: parseInt(roundTo, 10) || 1,
        preview: false, effective_date: effective, reason,
      });
      toast.success(`${data.stops_changed} stops updated · new monthly total ₹${data.total_new}`);
      onDone();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setBusy(false);
  };
  const OpBtn = ({ v, label, Icon }) => (
    <button
      type="button" onClick={() => { setOp(v); setPreview(null); }}
      className={`h-9 px-3 rounded text-[12px] font-medium inline-flex items-center gap-1.5 border ${op === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
      data-testid={`bulk-op-${v}`}
    >
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 no-print" data-testid="bulk-modal">
      <div className="w-full max-w-3xl bg-white rounded-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="font-heading font-semibold flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Bulk Bus Fare Update</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="flex flex-wrap gap-2">
            <OpBtn v="increase_percent" label="Increase by %" Icon={TrendingUp} />
            <OpBtn v="decrease_percent" label="Decrease by %" Icon={TrendingDown} />
            <OpBtn v="increase_fixed" label="Increase by ₹" Icon={IndianRupee} />
            <OpBtn v="decrease_fixed" label="Decrease by ₹" Icon={IndianRupee} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Value {op.endsWith('percent') ? '(%)' : '(₹)'}</div>
              <input type="number" min="0" step="0.5" value={value} onChange={e => { setValue(e.target.value); setPreview(null); }}
                className="w-full h-9 px-3 border border-slate-300 rounded text-sm text-right font-mono" data-testid="bulk-value" />
            </label>
            <label className="block">
              <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Round new fare to nearest ₹</div>
              <select value={roundTo} onChange={e => { setRoundTo(e.target.value); setPreview(null); }} className="w-full h-9 px-3 border border-slate-300 rounded text-sm bg-white">
                <option value="1">No rounding</option>
                <option value="10">₹10</option>
                <option value="50">₹50</option>
                <option value="100">₹100</option>
              </select>
            </label>
            <label className="block">
              <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Effective from</div>
              <input type="date" value={effective} onChange={e => setEffective(e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded text-sm" data-testid="bulk-effective" />
            </label>
          </div>
          <label className="block">
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Reason (recorded in audit log)</div>
            <input value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Annual fare revision for 2026-27" className="w-full h-9 px-3 border border-slate-300 rounded text-sm" data-testid="bulk-reason" />
          </label>
          <button onClick={runPreview} disabled={busy} data-testid="bulk-preview" className="h-9 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            {busy ? 'Working…' : 'Preview Changes →'}
          </button>

          {preview && (
            <div className="border border-slate-200 rounded overflow-hidden" data-testid="bulk-preview-table">
              <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 border-b border-slate-200 text-sm">
                <div><div className="text-[10px] uppercase tracking-widest text-slate-500">Stops touched</div><div className="font-heading font-semibold text-lg">{preview.rows.length}</div></div>
                <div><div className="text-[10px] uppercase tracking-widest text-slate-500">Students affected</div><div className="font-heading font-semibold text-lg">{preview.total_students_affected}</div></div>
                <div><div className="text-[10px] uppercase tracking-widest text-slate-500">Monthly total</div><div className="font-heading font-semibold text-lg tabular">{inr(preview.total_current)} → {inr(preview.total_new)}</div></div>
              </div>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full dense-table text-[12px]">
                  <thead className="bg-white sticky top-0"><tr className="text-left text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200"><th className="pl-3 py-1.5">#</th><th>Stop</th><th className="text-right">Current</th><th className="text-right">New</th><th className="text-right">Δ</th><th className="text-right pr-3">Students</th></tr></thead>
                  <tbody>
                    {preview.rows.map(r => (
                      <tr key={r.id} className="border-b border-slate-100">
                        <td className="pl-3 py-1 font-mono">{r.stop_no}</td>
                        <td>{r.stop_name}</td>
                        <td className="text-right font-mono">{inr(r.current_fare)}</td>
                        <td className="text-right font-mono font-semibold">{inr(r.new_fare)}</td>
                        <td className={`text-right font-mono ${r.delta > 0 ? 'text-emerald-700' : r.delta < 0 ? 'text-rose-700' : 'text-slate-400'}`}>{r.delta > 0 ? '+' : ''}{inr(r.delta)}</td>
                        <td className="text-right pr-3">{r.students_affected}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button onClick={onClose} className="h-9 px-3 border border-slate-300 rounded text-sm">Cancel</button>
          <button onClick={apply} disabled={!preview || busy}
            className="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white rounded text-sm font-semibold"
            data-testid="bulk-apply">
            {busy ? 'Applying…' : preview ? 'Confirm & Apply' : 'Run preview first'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StopModal({ stop, onClose, onDone }) {
  const isEdit = !!stop;
  const [f, setF] = useState({
    stop_no: stop?.stop_no ?? '',
    main_area: stop?.main_area ?? '',
    stop_name: stop?.stop_name ?? '',
    monthly_fee: stop?.monthly_fee ?? '',
    academic_year: stop?.academic_year ?? '2026-27',
  });
  const [busy, setBusy] = useState(false);
  const yearChanged = isEdit && f.academic_year !== stop.academic_year;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (isEdit) {
        await api.patch(`/bus-stops/${stop.id}`, {
          main_area: f.main_area,
          stop_name: f.stop_name,
          monthly_fee: parseFloat(f.monthly_fee) || 0,
          academic_year: f.academic_year,
        });
        toast.success(yearChanged
          ? `New fare row created for ${f.academic_year} — ${stop.academic_year}'s fare stays ${stop.monthly_fee} for historical records.`
          : 'Bus stop updated');
      } else {
        await api.post('/bus-stops', {
          stop_no: parseInt(f.stop_no, 10),
          main_area: f.main_area,
          stop_name: f.stop_name,
          monthly_fee: parseFloat(f.monthly_fee) || 0,
          academic_year: f.academic_year,
        });
        toast.success('Bus stop added');
      }
      onDone();
    } catch (ex) { toast.error(ex?.response?.data?.detail || 'Failed'); }
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-white rounded shadow-lg w-full max-w-md" data-testid="bs-modal">
        <div className="px-5 py-3 border-b border-slate-200 font-heading font-medium flex items-center gap-2">
          <Bus className="w-4 h-4" />{isEdit ? `Edit Stop #${stop.stop_no}` : 'New Bus Stop'}
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Stop Number *</div>
            <input required type="number" min="1" disabled={isEdit}
              className="w-full h-9 px-3 border border-slate-300 rounded text-sm bg-white disabled:bg-slate-100"
              value={f.stop_no} onChange={e => setF({ ...f, stop_no: e.target.value })}
              data-testid="bs-input-no"
            />
          </label>
          <label className="block">
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Main Area *</div>
            <input required className="w-full h-9 px-3 border border-slate-300 rounded text-sm"
              value={f.main_area} onChange={e => setF({ ...f, main_area: e.target.value })}
              placeholder="Butibori"
              data-testid="bs-input-area"
            />
          </label>
          <label className="block">
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Sub Stop / Landmark *</div>
            <input required className="w-full h-9 px-3 border border-slate-300 rounded text-sm"
              value={f.stop_name} onChange={e => setF({ ...f, stop_name: e.target.value })}
              placeholder="Rukmini Township (near Mamu Panvel)"
              data-testid="bs-input-name"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Monthly Fee (₹) *</div>
              <input required type="number" min="0" step="10"
                className="w-full h-9 px-3 border border-slate-300 rounded text-sm text-right font-mono"
                value={f.monthly_fee} onChange={e => setF({ ...f, monthly_fee: e.target.value })}
                data-testid="bs-input-fee"
              />
            </label>
            <label className="block">
              <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Academic Year</div>
              <input className="w-full h-9 px-3 border border-slate-300 rounded text-sm"
                value={f.academic_year} onChange={e => setF({ ...f, academic_year: e.target.value })}
              />
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button type="button" onClick={onClose} className="h-9 px-3 border border-slate-300 rounded text-sm">Cancel</button>
          <button data-testid="bs-submit" disabled={busy} className="h-9 px-4 bg-blue-600 text-white rounded text-sm disabled:opacity-60">
            {busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Stop'}
          </button>
        </div>
      </form>
    </div>
  );
}
