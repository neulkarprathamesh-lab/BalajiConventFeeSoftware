import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { toast } from 'sonner';
import { Archive, Download, Search, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/**
 * Receipt Archives — Admin-only. Every academic session beyond the active
 * 2-session retention window (see backend routers/receipt_archives.py) gets
 * archived here as a validated ZIP; opening this page also runs the
 * idempotent archive check (safe no-op when nothing is due). Nothing here
 * ever deletes or duplicates a receipt — archived receipts still live in the
 * same db.receipts collection, just no longer shown in the normal Student
 * Payment Receipt History for anyone.
 */
export default function ReceiptArchives() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [selectedYear, setSelectedYear] = useState('');
  const [q, setQ] = useState('');
  const [receiptType, setReceiptType] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/receipt-archives').then(r => setOverview(r.data)).catch(() => toast.error('Failed to load archives')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const runNow = async () => {
    try {
      const { data } = await api.post('/receipt-archives/run');
      toast.success(data.processed > 0 ? `Archived ${data.processed} session(s)` : 'Nothing to archive right now');
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };

  const searchArchive = async (ay) => {
    setSelectedYear(ay);
    setSearching(true);
    try {
      const p = new URLSearchParams();
      if (q) p.set('q', q);
      if (receiptType) p.set('receipt_type', receiptType);
      const { data } = await api.get(`/receipt-archives/${ay}/receipts?${p.toString()}`);
      setSearchResults(data);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to search archive'); setSearchResults(null); }
    setSearching(false);
  };

  const download = async (ay) => {
    try {
      const { data } = await api.get(`/receipt-archives/${ay}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url; a.download = `BalajiConvent-Receipts-${ay}.zip`; a.click();
      URL.revokeObjectURL(url);
      toast.success('Archive downloaded');
    } catch (e) { toast.error(e?.response?.data?.detail || 'Download failed'); }
  };

  const STATUS_TONE = { valid: 'bg-emerald-100 text-emerald-800', failed: 'bg-red-100 text-red-800' };

  return (
    <>
      <PageHeader title="Receipt Archives" subtitle="Admin-only — sessions older than the active 2-session window, archived as validated ZIPs" actions={
        <button onClick={runNow} className="h-9 px-3 bg-slate-900 text-white rounded text-sm flex items-center gap-1.5 hover:bg-slate-800" data-testid="ra-run">
          <RefreshCw className="w-4 h-4" /> Check &amp; Archive Now
        </button>
      } />
      <div className="p-6 space-y-5">
        {loading ? <div className="text-sm text-slate-500">Loading…</div> : overview && (
          <>
            <div className="bg-white border border-slate-200 rounded p-4 flex flex-wrap gap-6 text-sm">
              <div><span className="text-slate-500">Active sessions: </span><b>{overview.active_academic_years.join(', ') || '—'}</b></div>
              <div><span className="text-slate-500">Not yet archived: </span><b>{overview.archivable_academic_years.join(', ') || 'none'}</b></div>
            </div>

            <div className="bg-white border border-slate-200 rounded overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200"><h3 className="font-heading font-medium">Archived Sessions</h3></div>
              <table className="w-full dense-table" data-testid="ra-table">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600">
                  <th>Academic Year</th><th>Archive File</th><th>Archive Date</th><th className="text-right">Receipt Count</th><th className="text-right">Total Archived Amount</th><th>Status</th><th></th>
                </tr></thead>
                <tbody>
                  {overview.archives.length === 0 && <tr><td colSpan="7" className="text-center py-8 text-slate-500">No archives yet</td></tr>}
                  {overview.archives.map(a => (
                    <tr key={a.id}>
                      <td className="font-medium">{a.academic_year}</td>
                      <td className="font-mono text-[12px] text-slate-600">{a.filename || '—'}</td>
                      <td className="text-[12px] text-slate-500">{new Date(a.created_at).toLocaleString('en-IN')}</td>
                      <td className="text-right tabular">{a.receipt_count ?? '—'}</td>
                      <td className="text-right tabular font-medium">{a.total_amount != null ? inr(a.total_amount) : '—'}</td>
                      <td><span className={`text-[11px] px-1.5 py-0.5 rounded font-semibold uppercase ${STATUS_TONE[a.status] || 'bg-slate-100 text-slate-700'}`} title={a.error || ''}>{a.status}</span></td>
                      <td className="text-right">
                        {a.status === 'valid' && (
                          <div className="flex gap-2 justify-end">
                            <button onClick={() => searchArchive(a.academic_year)} className="h-7 px-2 border border-slate-300 rounded text-[11px] flex items-center gap-1 hover:bg-slate-50" data-testid={`ra-search-${a.academic_year}`}>
                              <Search className="w-3 h-3" /> Search
                            </button>
                            <button onClick={() => download(a.academic_year)} className="h-7 px-2 border border-slate-300 rounded text-[11px] flex items-center gap-1 hover:bg-slate-50" data-testid={`ra-download-${a.academic_year}`}>
                              <Download className="w-3 h-3" /> Download
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedYear && (
              <div className="bg-white border border-slate-200 rounded overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                  <h3 className="font-heading font-medium flex items-center gap-2"><Archive className="w-4 h-4" /> Searching {selectedYear}</h3>
                  <div className="flex gap-2">
                    <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&searchArchive(selectedYear)}
                      placeholder="Student name, admission no., or receipt number…"
                      className="h-9 px-3 border border-slate-300 rounded text-sm w-72" data-testid="ra-q" />
                    <select value={receiptType} onChange={e=>setReceiptType(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm bg-white">
                      <option value="">All Types</option>
                      <option value="school">School</option>
                      <option value="bus">Bus</option>
                      <option value="misc">Misc</option>
                      <option value="debit_voucher">Debit Voucher</option>
                    </select>
                    <button onClick={() => searchArchive(selectedYear)} className="h-9 px-4 bg-slate-900 text-white rounded text-sm">Search</button>
                  </div>
                </div>
                <table className="w-full dense-table">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600">
                    <th>Number</th><th>Date</th><th>Type</th><th>Student</th><th>Admission No.</th><th className="text-right">Amount</th><th>Mode</th><th>Status</th>
                  </tr></thead>
                  <tbody>
                    {searching && <tr><td colSpan="8" className="text-center py-6 text-slate-500">Searching…</td></tr>}
                    {!searching && searchResults?.receipts.length === 0 && <tr><td colSpan="8" className="text-center py-6 text-slate-500">No matching receipts</td></tr>}
                    {!searching && searchResults?.receipts.map(r => (
                      <tr key={r.id} className="cursor-pointer" onClick={() => nav(`/receipts/${r.id}`)} data-testid={`ra-result-${r.number}`}>
                        <td className="font-mono text-[12px]">{r.number}</td>
                        <td className="text-[12px] text-slate-500">{new Date(r.created_at).toLocaleString('en-IN')}</td>
                        <td className="capitalize text-slate-600">{r.receipt_type?.replace('_',' ')}</td>
                        <td>{r.student_snapshot?.name || r.payer_name || '—'}</td>
                        <td className="font-mono text-[12px]">{r.student_snapshot?.admission_no || '—'}</td>
                        <td className="text-right tabular font-medium">{inr(r.total)}</td>
                        <td className="uppercase text-[11px]">{r.payment_mode}</td>
                        <td>{r.status === 'cancelled' ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-semibold">VOIDED</span> : <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">{r.status}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
