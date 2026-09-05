import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { toast } from 'sonner';
import { Undo2, FileSpreadsheet, User as UserIcon, CalendarDays, CheckCircle2, XCircle, ArrowLeft, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

const KIND_LABEL = {
  students: { label: 'Students', endpoint: '/students/bulk-delete', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  fee_structures: { label: 'Fee Structures', endpoint: '/fee-structures/bulk-delete', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
};

export default function ImportsHistory() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/imports/history${kind ? `?kind=${kind}` : ''}`);
      setRows(data || []);
    } catch (e) { toast.error('Failed to load history'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [kind]);

  const undo = async (batch) => {
    if (batch.undone_at) return;
    const label = batch.type === 'fee_structures' ? 'fee-structure batch' : `${batch.created || 0} students`;
    if (!window.confirm(`Roll back this ${label}?\nRecords already in use (with receipts or assigned students) will be safely kept.`)) return;
    try {
      const { data } = await api.post(KIND_LABEL[batch.type].endpoint, { batch_id: batch.id });
      const kept = batch.type === 'fee_structures' ? data.protected_referenced : data.protected_with_receipts;
      toast.success(`✓ Undo done — ${data.deleted} deleted · ${kept || 0} kept (in use)`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Undo failed'); }
  };

  return (
    <>
      <PageHeader
        title="Import History"
        subtitle="Every Excel import is recorded here — with counts, user, timestamp, and one-click undo"
        actions={
          <Link to="/import-excel" data-testid="ih-back" className="h-9 px-3 border border-slate-300 rounded text-sm hover:bg-white flex items-center gap-1.5"><ArrowLeft className="w-4 h-4" /> Back to Excel Import</Link>
        }
      />
      <div className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[11px] uppercase tracking-widest text-slate-500 mr-2">Filter</span>
          {[['','All'],['students','Students'],['fee_structures','Fee Structures']].map(([v,l]) => (
            <button key={v} data-testid={`ih-filter-${v || 'all'}`} onClick={()=>setKind(v)} className={`h-8 px-3 rounded border text-[12px] ${kind===v ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-600">
              <tr className="text-left">
                <th className="px-4 py-2.5">When</th>
                <th className="px-4 py-2.5">Kind</th>
                <th className="px-4 py-2.5">Imported By</th>
                <th className="px-4 py-2.5 text-right">Created</th>
                <th className="px-4 py-2.5 text-right">Updated / Skipped</th>
                <th className="px-4 py-2.5 text-right">Errors</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan="8" className="px-4 py-8 text-center text-slate-500 text-[13px]">Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan="8" className="px-4 py-8 text-center text-slate-500 text-[13px]">No imports yet. Head to <Link to="/import-excel" className="text-blue-700 hover:underline">Excel Import</Link> to load your first file.</td></tr>}
              {rows.map((b, i) => {
                const kl = KIND_LABEL[b.type] || KIND_LABEL.students;
                const created = b.created || 0;
                const other = (b.type === 'fee_structures' ? b.updated : b.skipped) || 0;
                const errs = b.errors_count || 0;
                const dt = b.created_at ? new Date(b.created_at) : null;
                return (
                  <tr key={b.id} data-testid={`ih-row-${i}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-[13px]"><CalendarDays className="w-3.5 h-3.5 text-slate-400" /> {dt ? dt.toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' }) : '—'}</div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">{b.id?.slice(0,8)}…</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 border rounded-full px-2 py-0.5 text-[11px] font-medium ${kl.color}`}><FileSpreadsheet className="w-3 h-3" /> {kl.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-[13px]"><UserIcon className="w-3.5 h-3.5 text-slate-400" /> {b.user_name || '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular text-emerald-700 font-semibold">{created}</td>
                    <td className="px-4 py-3 text-right font-mono tabular text-slate-600">{other}</td>
                    <td className="px-4 py-3 text-right font-mono tabular text-red-700">{errs}</td>
                    <td className="px-4 py-3">
                      {b.undone_at ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5"><XCircle className="w-3 h-3" /> Undone · {b.undone_deleted || 0} removed</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"><CheckCircle2 className="w-3 h-3" /> Active</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {b.undone_at ? (
                        <span className="text-[11px] text-slate-500">by {b.undone_by}</span>
                      ) : (
                        <button data-testid={`ih-undo-${i}`} onClick={()=>undo(b)} className="h-8 px-3 border border-red-300 text-red-700 hover:bg-red-50 rounded text-[12px] flex items-center gap-1.5 ml-auto"><Undo2 className="w-3.5 h-3.5" /> Undo</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 text-[11px] text-slate-500 flex items-center gap-1.5">
          <ExternalLink className="w-3 h-3" /> Undo will skip records already referenced by other data (students with receipts, or fee structures assigned to students).
        </div>
      </div>
    </>
  );
}
