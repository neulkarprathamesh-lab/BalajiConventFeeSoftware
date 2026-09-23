import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { Download, Lock, KeyRound } from 'lucide-react';
import { getDeviceId } from '@/lib/syncEngine';
import useLiveRefresh from '@/lib/useLiveRefresh';

/**
 * Live Fee Update — one fee head at a time (a dropdown, not a multi-select
 * checkbox grid) so the table stays to a fixed, readable set of columns:
 * Class/Medium/Stream/Admission No./Student/Current Fee/Total Paid/Balance/
 * Updated Fee/Action. "Updated Fee" always starts blank — typing a value and
 * saving calls the SAME existing POST /students/{id}/fee-update endpoint
 * used before (never a receipt, never touches Total Paid, mandatory reason,
 * fully audited server-side). No backend change was needed for this: the
 * endpoint already accepts one fee head just as well as several.
 */
export default function LiveFeeUpdate() {
  const { user } = useAuth();
  // Cashier gets the same live Total/Paid/Balance grid as everyone else (the
  // read endpoint has no role restriction) but never the ability to change a
  // student's fee amount — POST /students/{id}/fee-update stays restricted
  // to administrator/manager/accountant server-side. This mirrors that on
  // the UI so a cashier isn't shown a Save button that would just 403.
  const canWrite = ['administrator', 'manager', 'accountant'].includes(user?.role);
  const [academicYear, setAcademicYear] = useState('2026-27');
  const [classId, setClassId] = useState('');
  const [section, setSection] = useState('');
  const [medium, setMedium] = useState('');
  const [stream, setStream] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [classes, setClasses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [feeHeadOptions, setFeeHeadOptions] = useState([]);
  const [selectedHead, setSelectedHead] = useState('Tuition Fee');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState({}); // studentId -> value
  const [reasons, setReasons] = useState({});
  const [saving, setSaving] = useState(null);

  // Temporary class-level Fee Edit Access (for cashier only - see
  // backend/routers/fee_edit_access.py). A cashier never gets the Master PIN;
  // instead they may hold zero or more time-boxed grants, each scoped to one
  // class/medium + school|bus|both, tied to THIS device. Polled periodically
  // so an Admin revocation or a natural expiry is reflected within seconds
  // without the cashier needing to reload the page.
  const [activeGrants, setActiveGrants] = useState([]);
  const [requestOpen, setRequestOpen] = useState(false);
  const deviceId = getDeviceId();

  const loadActiveGrants = () => {
    if (canWrite) return;
    api.get(`/fee-edit-access/my-active?device_id=${encodeURIComponent(deviceId)}`)
      .then(r => setActiveGrants(r.data || [])).catch(() => {});
  };
  useEffect(() => {
    api.get('/classes').then(r => setClasses(r.data || []));
    api.get('/departments').then(r => setDepartments(r.data || []));
    api.get('/fee-update/fee-head-options').then(r => setFeeHeadOptions(r.data || []));
    loadActiveGrants();
    const t = setInterval(loadActiveGrants, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which of the cashier's active grants (if any) covers THIS row for the
  // CURRENTLY selected fee head - matches class_id exactly, medium only if
  // the grant was scoped to one, and school/bus scope (a "both" grant always
  // matches). Never matches a class/scope the grant doesn't explicitly cover.
  const grantForRow = (row) => {
    const requiredScope = selectedHead === 'Bus Fee' ? 'bus' : 'school';
    return activeGrants.find(g =>
      g.class_id === row.class_id &&
      (g.scope === 'both' || g.scope === requiredScope) &&
      (!g.medium || g.medium === row.medium)
    ) || null;
  };

  const buildParams = () => new URLSearchParams({
    academic_year: academicYear,
    ...(classId ? { class_id: classId } : {}),
    ...(section ? { section } : {}),
    ...(medium ? { medium } : {}),
    ...(stream ? { stream } : {}),
    ...(departmentId ? { department_id: departmentId } : {}),
    fee_heads: selectedHead,
  });

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/fee-update/students?${buildParams()}`);
      setRows(data || []);
    } catch (e) { toast.error('Could not load'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [academicYear, classId, section, medium, stream, departmentId, selectedHead]);
  // Safe to auto-refresh: "Updated Fee"/"Reason" inputs are bound to the
  // separate edits/reasons state below, not to a row's live data, so a
  // background reload of `rows` never clobbers an in-progress typed edit.
  useLiveRefresh(load, 10000);

  const headEditable = selectedHead && selectedHead !== 'Bus Fee' && selectedHead !== 'Previous Year Balance';
  const canEditHead = canWrite && headEditable;
  const canEditRow = (row) => headEditable && (canWrite || !!grantForRow(row));

  const save = async (row) => {
    const sid = row.student_id;
    const newFee = edits[sid];
    const reason = reasons[sid];
    if (!newFee) return toast.error('Enter an updated fee first');
    if (!reason || !reason.trim()) return toast.error('A reason is required');
    setSaving(sid);
    try {
      const { data } = await api.post(`/students/${sid}/fee-update`, {
        fee_head_name: selectedHead, academic_year: academicYear, new_fee: Number(newFee), reason: reason.trim(),
        device_id: deviceId,
      });
      toast.success(`Updated — new balance ${inr(data.new_balance)}`);
      setEdits(prev => { const n = { ...prev }; delete n[sid]; return n; });
      setReasons(prev => { const n = { ...prev }; delete n[sid]; return n; });
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Update failed'); }
    finally { setSaving(null); }
  };

  const exportCsv = () => {
    api.get(`/fee-update/export.csv?${buildParams()}`, { responseType: 'blob' }).then(res => {
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a'); a.href = url; a.download = `Live_Fee_Update_${academicYear}_${selectedHead.replace(/\s+/g,'-')}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
    }).catch(() => toast.error('Export failed'));
  };

  return (
    <div>
      <PageHeader title="Live Fee Update" subtitle={canWrite ? "Update a student's fee for one fee head at a time — never creates a receipt; audited." : "View-only unless you hold a temporary Fee Edit Access grant for a class."}
        actions={!canWrite && (
          <button onClick={() => setRequestOpen(true)} data-testid="lfu-request-access" className="h-9 px-3 border border-blue-300 text-blue-700 rounded text-sm inline-flex items-center gap-1.5 hover:bg-blue-50">
            <KeyRound className="w-4 h-4" /> Request Edit Access
          </button>
        )}
      />
      <div className="p-6 space-y-4">
        {!canWrite && activeGrants.length === 0 && (
          <div className="text-[12px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2 flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" /> You have view-only access here. Fee amounts can only be changed by an Administrator/Manager/Accountant, or with a temporary Fee Edit Access grant.
          </div>
        )}
        {!canWrite && activeGrants.length > 0 && (
          <div className="text-[12px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2 space-y-1">
            {activeGrants.map(g => (
              <div key={g.id} className="flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" />
                Temporary Edit Access — <strong>{g.class_name}{g.medium ? ` (${g.medium})` : ''}</strong> · {g.scope === 'both' ? 'School Fee + Bus Fee' : g.scope === 'bus' ? 'Bus Fee' : 'School Fee'} · until {new Date(g.expires_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </div>
            ))}
          </div>
        )}
        {requestOpen && (
          <RequestAccessModal classes={classes} deviceId={deviceId} onClose={() => setRequestOpen(false)} onSubmitted={loadActiveGrants} />
        )}
        <div className="bg-white border border-slate-200 rounded p-4 flex flex-wrap gap-3 items-end">
          <Field label="Academic Year"><input value={academicYear} onChange={e => setAcademicYear(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm w-28" /></Field>
          <Field label="Class">
            <select value={classId} onChange={e => setClassId(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm">
              <option value="">All</option>
              {classes.filter(c => !['Fisheries', 'Electronics'].includes(c.stream)).map(c => <option key={c.id} value={c.id}>{c.name}{c.medium ? ` · ${c.medium}` : ''}{c.stream ? ` · ${c.stream}` : ''}</option>)}
            </select>
          </Field>
          <Field label="Section"><input value={section} onChange={e => setSection(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm w-20" /></Field>
          <Field label="Medium"><input value={medium} onChange={e => setMedium(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm w-36" /></Field>
          <Field label="Dept/Stream">
            <select value={departmentId} onChange={e => setDepartmentId(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm">
              <option value="">All</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <input placeholder="Stream (JC only)" value={stream} onChange={e => setStream(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm w-32" />
          <Field label="Fee Head">
            <select value={selectedHead} onChange={e => setSelectedHead(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm bg-white font-medium" data-testid="lfu-head-select">
              {feeHeadOptions.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </Field>
          <button onClick={exportCsv} className="h-9 px-3 border border-slate-300 rounded text-sm inline-flex items-center gap-1.5 hover:bg-slate-50 ml-auto" data-testid="lfu-export"><Download className="w-4 h-4" /> Export Report</button>
        </div>

        {!canEditHead && canWrite && (
          <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            "{selectedHead}" is view-only here — {selectedHead === 'Bus Fee' ? 'update it from Live Bus Fee Update instead.' : 'it is set from the opening-balance panel on the student profile instead.'}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded lfu-scroll-x">
          <table className="w-full text-[13px]" data-testid="lfu-grid">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200 whitespace-nowrap">
                <th className="px-3 py-2">Class</th><th className="px-2">Medium</th><th className="px-2">Stream</th>
                <th className="px-2">Admission No.</th><th className="px-2">Student</th>
                <th className="px-2 text-right">Current Fee</th><th className="px-2 text-right">Total Paid</th><th className="px-2 text-right">Balance</th>
                <th className="px-2">Updated Fee</th><th className="px-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10} className="py-6 text-center text-slate-500">Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={10} className="py-6 text-center text-slate-500">No students match these filters.</td></tr>}
              {rows.map(r => {
                const fh = r.fee_heads[selectedHead] || {};
                const sid = r.student_id;
                const rowEditable = canEditRow(r);
                return (
                  <tr key={sid} className="border-b border-slate-50 whitespace-nowrap" data-testid={`lfu-row-${r.admission_no}`}>
                    <td className="px-3 py-1.5">{r.class_name}</td>
                    <td className="px-2">{r.medium}</td>
                    <td className="px-2">{r.stream || '—'}</td>
                    <td className="px-2 font-mono">{r.admission_no}</td>
                    <td className="px-2 font-medium">{r.student_name}</td>
                    <td className="px-2 text-right font-mono">{fh.current != null ? inr(fh.current) : '—'}</td>
                    <td className="px-2 text-right font-mono text-emerald-700">{inr(r.overall_paid || 0)}</td>
                    <td className="px-2 text-right font-mono">{inr(r.overall_balance || 0)}</td>
                    <td className="px-2 py-1.5">
                      {rowEditable ? (
                        <input type="number" placeholder="Enter amount" value={edits[sid] || ''} onChange={e => setEdits(p => ({ ...p, [sid]: e.target.value }))}
                          className="h-8 w-28 px-2 border border-slate-300 rounded text-right font-mono text-[12px]" data-testid={`lfu-newfee-${r.admission_no}`} />
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-2">
                      {rowEditable && edits[sid] && (
                        <div className="flex items-center gap-1.5">
                          <input placeholder="Reason (required)" value={reasons[sid] || ''} onChange={e => setReasons(p => ({ ...p, [sid]: e.target.value }))}
                            className="h-8 w-32 px-2 border border-slate-300 rounded text-[12px]" data-testid={`lfu-reason-${r.admission_no}`} />
                          <button onClick={() => save(r)} disabled={saving === sid} className="h-8 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded text-[12px] font-medium disabled:opacity-50" data-testid={`lfu-save-${r.admission_no}`}>
                            {saving === sid ? '…' : 'Update'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const Field = ({ label, children }) => (
  <label className="block">
    <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{label}</div>
    {children}
  </label>
);

// Cashier-side "Request Edit Access" - creates a pending request for one
// class/medium + scope, sent to Admin's Fee Edit Access Requests screen for
// approval with the Master PIN. Never touches the PIN itself.
function RequestAccessModal({ classes, deviceId, onClose, onSubmitted }) {
  const [classId, setClassId] = useState('');
  const [medium, setMedium] = useState('');
  const [scope, setScope] = useState('school');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!classId) return toast.error('Select a class');
    if (!reason.trim()) return toast.error('A reason is required');
    setBusy(true);
    try {
      const cls = classes.find(c => c.id === classId);
      await api.post('/fee-edit-access/requests', {
        device_id: deviceId, class_id: classId, class_name: cls?.name,
        medium: medium.trim() || null, scope, reason: reason.trim(),
      });
      toast.success('Request sent to Admin for approval.');
      onSubmitted();
      onClose();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not send request'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="bg-white rounded-lg shadow-2xl w-full max-w-md border-t-4 border-blue-600">
        <div className="p-5 space-y-3">
          <div className="font-heading font-semibold text-lg">Request Fee Edit Access</div>
          <div className="text-[12px] text-slate-600">Sent to an Administrator/Manager for approval. Access is temporary and limited to the class/scope you select.</div>
          <Field label="Class">
            <select value={classId} onChange={e => setClassId(e.target.value)} required className="w-full h-10 px-2 border border-slate-300 rounded text-sm bg-white" data-testid="fea-class">
              <option value="">Select class</option>
              {classes.filter(c => !['Fisheries', 'Electronics'].includes(c.stream)).map(c => <option key={c.id} value={c.id}>{c.name}{c.medium ? ` · ${c.medium}` : ''}{c.stream ? ` · ${c.stream}` : ''}</option>)}
            </select>
          </Field>
          <Field label="Medium (optional)">
            <input value={medium} onChange={e => setMedium(e.target.value)} placeholder="e.g. Semi English" className="w-full h-10 px-2 border border-slate-300 rounded text-sm" data-testid="fea-medium" />
          </Field>
          <Field label="Scope">
            <select value={scope} onChange={e => setScope(e.target.value)} className="w-full h-10 px-2 border border-slate-300 rounded text-sm bg-white" data-testid="fea-scope">
              <option value="school">School Fee</option>
              <option value="bus">Bus Fee</option>
              <option value="both">School Fee + Bus Fee</option>
            </select>
          </Field>
          <Field label="Reason">
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Why does this class/group need a fee correction?" className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm" data-testid="fea-reason" />
          </Field>
        </div>
        <div className="flex gap-2 p-4 border-t border-slate-100">
          <button type="button" onClick={onClose} className="flex-1 h-9 border border-slate-300 rounded text-sm">Cancel</button>
          <button type="submit" disabled={busy} className="flex-1 h-9 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-semibold disabled:opacity-50" data-testid="fea-submit">
            {busy ? 'Sending…' : 'Send Request'}
          </button>
        </div>
      </form>
    </div>
  );
}
