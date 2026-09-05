import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { toast } from 'sonner';
import { FileDown, FileSpreadsheet, FileText, Search } from 'lucide-react';

export default function BusFeeReport() {
  const [rows, setRows] = useState([]);
  const [classes, setClasses] = useState([]);
  const [busStops, setBusStops] = useState([]);
  const [filters, setFilters] = useState({ student: '', admission_no: '', class_id: '', medium: '', main_stop: '', sub_stop: '', bus_status: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/classes').then(r => setClasses(r.data)).catch(() => {});
    api.get('/bus-stops').then(r => setBusStops(r.data || [])).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const { data } = await api.get('/reports/bus/detailed', { params: { ...params, format: 'json' } });
      setRows(data);
    } catch (e) { toast.error('Could not load report'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const mainStops = [...new Set(busStops.map(s => s.main_area))].sort();
  const subStops = filters.main_stop ? busStops.filter(s => s.main_area === filters.main_stop) : busStops;

  const exportFile = async (format) => {
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const { data } = await api.get('/reports/bus/detailed', { params: { ...params, format }, responseType: 'blob' });
      const mime = { csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' }[format];
      const url = URL.createObjectURL(new Blob([data], { type: mime }));
      if (format === 'pdf') { window.open(url, '_blank'); return; }
      const a = document.createElement('a');
      a.href = url; a.download = `Bus_Fee_Report.${format}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error('Export failed'); }
  };

  const totalOutstanding = rows.reduce((s, r) => s + (r.outstanding_balance || 0), 0);
  const totalPaid = rows.reduce((s, r) => s + (r.amount_paid || 0), 0);

  return (
    <>
      <PageHeader title="Bus Fee Report" subtitle="Dedicated bus billing report — kept separate from the normal school Fee Report"
        actions={
          <div className="flex gap-2 no-print">
            <button onClick={() => exportFile('csv')} className="h-9 px-3 border border-slate-300 rounded text-sm hover:bg-slate-50 flex items-center gap-1.5"><FileText className="w-4 h-4" /> CSV</button>
            <button onClick={() => exportFile('xlsx')} className="h-9 px-3 border border-slate-300 rounded text-sm hover:bg-slate-50 flex items-center gap-1.5"><FileSpreadsheet className="w-4 h-4" /> Excel</button>
            <button onClick={() => exportFile('pdf')} className="h-9 px-3 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 flex items-center gap-1.5"><FileDown className="w-4 h-4" /> PDF</button>
          </div>
        }
      />
      <div className="p-6 space-y-4">
        <div className="bg-white border border-slate-200 rounded p-3 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 items-end">
          <F label="Student"><input value={filters.student} onChange={e=>setFilters({...filters, student: e.target.value})} className={inp} /></F>
          <F label="Admission No."><input value={filters.admission_no} onChange={e=>setFilters({...filters, admission_no: e.target.value})} className={inp} /></F>
          <F label="Class"><select value={filters.class_id} onChange={e=>setFilters({...filters, class_id: e.target.value})} className={inp}>
            <option value="">All</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></F>
          <F label="Medium"><select value={filters.medium} onChange={e=>setFilters({...filters, medium: e.target.value})} className={inp}>
            <option value="">All</option><option>English Medium</option><option>Semi Medium (Marathi)</option><option>Junior College</option>
          </select></F>
          <F label="Main Stop"><select value={filters.main_stop} onChange={e=>setFilters({...filters, main_stop: e.target.value, sub_stop: ''})} className={inp}>
            <option value="">All</option>{mainStops.map(a => <option key={a} value={a}>{a}</option>)}
          </select></F>
          <F label="Sub Stop"><select value={filters.sub_stop} onChange={e=>setFilters({...filters, sub_stop: e.target.value})} className={inp}>
            <option value="">All</option>{[...new Set(subStops.map(s=>s.stop_name))].sort().map(n => <option key={n} value={n}>{n}</option>)}
          </select></F>
          <F label="Bus Status"><select value={filters.bus_status} onChange={e=>setFilters({...filters, bus_status: e.target.value})} className={inp}>
            <option value="">All</option><option value="active">Active</option><option value="inactive">Inactive</option>
          </select></F>
          <button onClick={load} disabled={loading} className="h-9 px-3 bg-slate-900 text-white rounded text-sm flex items-center gap-1.5 justify-center disabled:opacity-60"><Search className="w-4 h-4" /> {loading ? 'Loading…' : 'Search'}</button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Card label="Students" value={rows.length} />
          <Card label="Amount Paid" value={inr(totalPaid)} tone="text-emerald-700" />
          <Card label="Outstanding Balance" value={inr(totalOutstanding)} tone="text-red-700" />
        </div>

        <div className="bg-white border border-slate-200 rounded overflow-hidden overflow-x-auto">
          <table className="w-full dense-table">
            <thead>
              <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600 text-left">
                <th className="pl-3 py-2">Student</th><th>Admission No.</th><th>Class</th><th>Medium</th>
                <th>Main Stop</th><th>Sub Stop</th><th className="text-right">Monthly Fee</th>
                <th className="text-right">Paid</th><th className="text-right">Outstanding</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={10} className="text-center py-8 text-sm text-slate-500">No students match these filters.</td></tr>}
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="pl-3 py-1.5 font-medium">{r.student_name}</td>
                  <td className="font-mono text-[12px]">{r.admission_no}</td>
                  <td>{r.class_name}</td>
                  <td className="text-[12px]">{r.medium}</td>
                  <td>{r.main_stop || '—'}</td>
                  <td>{r.sub_stop || '—'}</td>
                  <td className="text-right font-mono tabular">{inr(r.monthly_bus_fee)}</td>
                  <td className="text-right font-mono tabular text-emerald-700">{inr(r.amount_paid)}</td>
                  <td className="text-right font-mono tabular font-semibold text-red-700">{inr(r.outstanding_balance)}</td>
                  <td><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${r.bus_status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{r.bus_status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

const inp = "w-full h-9 px-2 border border-slate-300 rounded text-sm bg-white";
const F = ({ label, children }) => <label className="block"><div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{label}</div>{children}</label>;
const Card = ({ label, value, tone }) => (
  <div className="bg-white border border-slate-200 rounded p-3">
    <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
    <div className={`font-heading text-xl font-semibold mt-1 ${tone || 'text-slate-900'}`}>{value}</div>
  </div>
);
