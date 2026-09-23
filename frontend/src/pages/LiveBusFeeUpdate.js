import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import useLiveRefresh from '@/lib/useLiveRefresh';

/**
 * Live Bus Fee Update — SEPARATE from normal Live Fee Update, per explicit
 * instruction. Main Area -> Sub Stop -> active students only. "Updated
 * Monthly Fee" is blank until entered. Stop-wide update calls the existing,
 * already-safe PATCH /bus-stops/{id} (same-year edits in place; never
 * touches historical bus_charges, which store their own amount). Individual
 * update calls POST /students/{id}/bus-assignment with monthly_fee_override,
 * which closes the student's current assignment and opens a new one — the
 * exact mechanism this app already uses for bus-stop changes, so future
 * charge generation picks up the new fee correctly and history is untouched.
 */
export default function LiveBusFeeUpdate() {
  const { user } = useAuth();
  // Same split as Live Fee Update: reading this grid has no role restriction
  // server-side, but PATCH /bus-stops and POST .../bus-assignment stay
  // administrator/manager/accountant-only — cashier gets the live view, not
  // the ability to change a fare.
  const canWrite = ['administrator', 'manager', 'accountant'].includes(user?.role);
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stopEdits, setStopEdits] = useState({}); // stopId -> {fee, reason}
  const [studentEdits, setStudentEdits] = useState({}); // studentId -> {fee, reason}
  const [busy, setBusy] = useState(null);
  const [confirmStop, setConfirmStop] = useState(null); // stop object pending bulk confirmation

  const load = () => {
    setLoading(true);
    api.get('/bus-fee-update/hierarchy').then(r => setAreas(r.data || [])).catch(() => toast.error('Could not load')).finally(() => setLoading(false));
  };
  useEffect(load, []);
  // Same reasoning as Live Fee Update: stopEdits/studentEdits are separate
  // state from `areas`, so a background reload never clobbers an
  // in-progress typed edit.
  useLiveRefresh(load, 10000);

  const submitStopUpdate = async (stop) => {
    const edit = stopEdits[stop.stop_id];
    if (!edit?.fee) return toast.error('Enter an updated monthly fee first');
    if (!edit?.reason?.trim()) return toast.error('A reason is required');
    setBusy(stop.stop_id);
    try {
      await api.patch(`/bus-stops/${stop.stop_id}`, { monthly_fee: Number(edit.fee), reason: edit.reason.trim() });
      toast.success(`${stop.stop_name}: fee updated for ${stop.active_student_count} active student(s), effective going forward`);
      setStopEdits(p => { const n = { ...p }; delete n[stop.stop_id]; return n; });
      setConfirmStop(null);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Update failed'); }
    finally { setBusy(null); }
  };

  const submitStudentUpdate = async (student, stop) => {
    const edit = studentEdits[student.student_id];
    if (!edit?.fee) return toast.error('Enter an updated monthly fee first');
    if (!edit?.reason?.trim()) return toast.error('A reason is required');
    setBusy(student.student_id);
    try {
      await api.post(`/students/${student.student_id}/bus-assignment`, {
        stop_no: stop.stop_no, monthly_fee_override: Number(edit.fee), reason: edit.reason.trim(),
      });
      toast.success(`${student.student_name}: individual fee updated, effective going forward`);
      setStudentEdits(p => { const n = { ...p }; delete n[student.student_id]; return n; });
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Update failed'); }
    finally { setBusy(null); }
  };

  return (
    <div>
      <PageHeader title="Live Bus Fee Update" subtitle={canWrite ? "Separate from normal fee update. New fee applies going forward only — historical bus charges are never rewritten." : "View-only: current bus fee and pending status for every active bus student."} />
      <div className="p-6 space-y-4">
        {!canWrite && (
          <div className="text-[12px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2">
            You have view-only access here. Bus fares can only be changed by an Administrator, Manager, or Accountant.
          </div>
        )}
        {loading && <div className="text-slate-500 text-sm">Loading…</div>}
        {!loading && areas.length === 0 && <div className="text-slate-500 text-sm">No active bus stops with students found.</div>}
        {areas.map(area => (
          <div key={area.main_area} className="bg-white border border-slate-200 rounded" data-testid={`lbfu-area-${area.main_area}`}>
            <div className="px-4 py-2 border-b border-slate-200 font-heading font-semibold bg-slate-50">{area.main_area}</div>
            {area.stops.map(stop => (
              <div key={stop.stop_id} className="border-b border-slate-100 last:border-0">
                <div className="px-4 py-2 flex items-center justify-between flex-wrap gap-2">
                  <div className="font-medium text-slate-800">
                    {stop.stop_name} <span className="text-slate-400 text-[12px]">· Stop #{stop.stop_no} · {stop.active_student_count} active student(s)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-slate-500">Current ₹{stop.monthly_fee}</span>
                    {canWrite && <input type="number" placeholder="Updated fee" value={stopEdits[stop.stop_id]?.fee || ''}
                      onChange={e => setStopEdits(p => ({ ...p, [stop.stop_id]: { ...p[stop.stop_id], fee: e.target.value } }))}
                      className="h-8 w-24 px-2 border border-slate-300 rounded text-right font-mono text-[12px]" data-testid={`lbfu-stopfee-${stop.stop_id}`} />}
                    {canWrite && stopEdits[stop.stop_id]?.fee && (
                      <>
                        <input placeholder="Reason" value={stopEdits[stop.stop_id]?.reason || ''}
                          onChange={e => setStopEdits(p => ({ ...p, [stop.stop_id]: { ...p[stop.stop_id], reason: e.target.value } }))}
                          className="h-8 w-32 px-2 border border-slate-300 rounded text-[12px]" />
                        <button onClick={() => setConfirmStop(stop)} className="h-8 px-3 bg-amber-600 text-white rounded text-[12px]" data-testid={`lbfu-stopsave-${stop.stop_id}`}>
                          Update all {stop.active_student_count}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {confirmStop?.stop_id === stop.stop_id && (
                  <div className="mx-4 mb-2 p-3 bg-amber-50 border border-amber-200 rounded text-[13px]">
                    Update the monthly fee from ₹{stop.monthly_fee} to ₹{stopEdits[stop.stop_id]?.fee} for all <b>{stop.active_student_count}</b> active students at {stop.stop_name}?
                    Historical charges are not affected — this applies going forward only.
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => submitStopUpdate(stop)} disabled={busy === stop.stop_id} className="h-8 px-3 bg-amber-600 text-white rounded text-[12px] disabled:opacity-50">
                        {busy === stop.stop_id ? 'Updating…' : 'Confirm'}
                      </button>
                      <button onClick={() => setConfirmStop(null)} className="h-8 px-3 border border-slate-300 rounded text-[12px]">Cancel</button>
                    </div>
                  </div>
                )}
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="pl-8 py-1">Admission No.</th><th>Student</th><th>Class</th><th>Medium</th>
                      <th className="text-right">Current Monthly Fee</th><th>Updated Monthly Fee</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {stop.students.map(st => (
                      <tr key={st.student_id} className="border-t border-slate-50">
                        <td className="pl-8 py-1 font-mono">{st.admission_no}</td>
                        <td>{st.student_name}</td><td>{st.class_name}</td><td>{st.medium}</td>
                        <td className="text-right font-mono">{inr(st.current_monthly_fee || 0)}</td>
                        <td>
                          {canWrite ? <input type="number" placeholder="—" value={studentEdits[st.student_id]?.fee || ''}
                            onChange={e => setStudentEdits(p => ({ ...p, [st.student_id]: { ...p[st.student_id], fee: e.target.value } }))}
                            className="h-7 w-20 px-1.5 border border-slate-300 rounded text-right font-mono text-[11px]" data-testid={`lbfu-studfee-${st.student_id}`} /> : <span className="text-slate-300">—</span>}
                        </td>
                        <td>
                          {canWrite && studentEdits[st.student_id]?.fee && (
                            <div className="flex items-center gap-1">
                              <input placeholder="Reason" value={studentEdits[st.student_id]?.reason || ''}
                                onChange={e => setStudentEdits(p => ({ ...p, [st.student_id]: { ...p[st.student_id], reason: e.target.value } }))}
                                className="h-7 w-24 px-1.5 border border-slate-300 rounded text-[11px]" />
                              <button onClick={() => submitStudentUpdate(st, stop)} disabled={busy === st.student_id} className="h-7 px-2 bg-blue-600 text-white rounded text-[11px] disabled:opacity-50">
                                {busy === st.student_id ? '…' : 'Save'}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
