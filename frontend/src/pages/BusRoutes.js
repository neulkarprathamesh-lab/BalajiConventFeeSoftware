import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { toast } from 'sonner';
import { Plus, X, Bus, Printer, ArrowLeft, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function BusRoutes() {
  const [routes, setRoutes] = useState([]);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const { user } = useAuth();
  const canEdit = ['administrator','manager','accountant'].includes(user?.role);

  const load = () => api.get('/bus-routes').then(r => setRoutes(r.data));
  useEffect(() => { load(); }, []);

  if (detail) return <RouteDetail id={detail} onBack={() => setDetail(null)} />;

  return (
    <>
      <PageHeader title="Bus Route Book" subtitle={`${routes.length} route${routes.length===1?'':'s'} · click a route for the monthly roster`}
        actions={canEdit && <button data-testid="br-new" onClick={()=>setOpen(true)} className="h-9 px-3 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 flex items-center gap-1.5"><Plus className="w-4 h-4" />New Route</button>}
      />
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {routes.length === 0 && (
            <div className="col-span-full bg-white border border-slate-200 rounded p-8 text-center text-sm text-slate-500">
              No bus routes yet. Add your first route to start tracking driver-wise collections.
            </div>
          )}
          {routes.map(r => (
            <button key={r.id} onClick={()=>setDetail(r.id)} className="text-left bg-white border border-slate-200 rounded p-4 hover:border-blue-600 hover:shadow-sm transition-all duration-150" data-testid={`br-card-${r.code}`}>
              <div className="flex items-start justify-between mb-2">
                <div className="w-10 h-10 rounded bg-amber-100 text-amber-700 flex items-center justify-center"><Bus className="w-5 h-5" strokeWidth={1.75} /></div>
                <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${r.active !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>{r.active !== false ? 'Active' : 'Inactive'}</span>
              </div>
              <div className="font-heading font-semibold text-slate-900">{r.name}</div>
              <div className="text-[11px] font-mono text-slate-500 mb-2">{r.code} · {r.vehicle_no || 'No vehicle'}</div>
              <div className="text-[12px] text-slate-600">Driver: <span className="text-slate-900">{r.driver_name || '—'}</span></div>
              <div className="text-[12px] text-slate-600">{r.driver_mobile || '—'}</div>
              <div className="border-t border-slate-100 mt-3 pt-2 flex items-center justify-between text-[12px]">
                <span className="text-slate-500">{r.stops?.length || 0} stops</span>
                <span className="font-mono tabular font-semibold text-slate-900">{inr(r.monthly_fee)}/mo</span>
              </div>
            </button>
          ))}
        </div>
      </div>
      {open && <NewRoute onClose={() => { setOpen(false); load(); }} />}
    </>
  );
}

function NewRoute({ onClose }) {
  const [f, setF] = useState({ name:'', code:'', driver_name:'', driver_mobile:'', vehicle_no:'', monthly_fee: 0, stops: [] });
  const [stopName, setStopName] = useState(''); const [stopFee, setStopFee] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try { await api.post('/bus-routes', { ...f, monthly_fee: parseFloat(f.monthly_fee)||0 }); toast.success('Route created'); onClose(); }
    catch (ex) { toast.error(ex?.response?.data?.detail || 'Failed'); }
  };
  const addStop = () => {
    if (!stopName) return;
    setF({...f, stops: [...f.stops, { name: stopName, monthly_fee: parseFloat(stopFee)||0 }]});
    setStopName(''); setStopFee('');
  };
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-white rounded shadow-lg w-full max-w-lg" data-testid="br-form">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200"><h3 className="font-heading font-medium">New Bus Route</h3><button type="button" onClick={onClose}><X className="w-4 h-4 text-slate-400" /></button></div>
        <div className="p-5 grid grid-cols-2 gap-4">
          <F label="Route Name *"><input required className={inp} value={f.name} onChange={e=>setF({...f, name:e.target.value})} placeholder="Butibori Main" /></F>
          <F label="Route Code *"><input required className={inp} value={f.code} onChange={e=>setF({...f, code:e.target.value.toUpperCase()})} placeholder="R01" /></F>
          <F label="Driver Name"><input className={inp} value={f.driver_name} onChange={e=>setF({...f, driver_name:e.target.value})} /></F>
          <F label="Driver Mobile"><input className={inp} value={f.driver_mobile} onChange={e=>setF({...f, driver_mobile:e.target.value})} /></F>
          <F label="Vehicle No"><input className={inp} value={f.vehicle_no} onChange={e=>setF({...f, vehicle_no:e.target.value})} placeholder="MH-31-AB-1234" /></F>
          <F label="Base Monthly Fee (₹)"><input type="number" className={inp} value={f.monthly_fee} onChange={e=>setF({...f, monthly_fee:e.target.value})} /></F>
          <div className="col-span-2">
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Stops (optional slabs)</div>
            <div className="flex gap-2 mb-2">
              <input className={inp} placeholder="Stop name" value={stopName} onChange={e=>setStopName(e.target.value)} />
              <input type="number" className={`${inp} w-32`} placeholder="Fee" value={stopFee} onChange={e=>setStopFee(e.target.value)} />
              <button type="button" onClick={addStop} className="h-9 px-3 border border-slate-300 rounded text-sm">Add</button>
            </div>
            {f.stops.length > 0 && (
              <div className="border border-slate-200 rounded">
                {f.stops.map((s, i) => (
                  <div key={i} className="flex justify-between items-center px-3 py-1.5 border-b border-slate-100 last:border-0 text-sm">
                    <span>{s.name}</span>
                    <div className="flex items-center gap-3"><span className="font-mono tabular text-slate-700">{inr(s.monthly_fee)}</span><button type="button" onClick={()=>setF({...f, stops: f.stops.filter((_,x)=>x!==i)})}><Trash2 className="w-3.5 h-3.5 text-red-600" /></button></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50"><button type="button" onClick={onClose} className="h-9 px-3 border border-slate-300 rounded text-sm">Cancel</button><button data-testid="br-submit" className="h-9 px-4 bg-blue-600 text-white rounded text-sm">Save Route</button></div>
      </form>
    </div>
  );
}

function RouteDetail({ id, onBack }) {
  const [data, setData] = useState(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0,7));
  const load = () => api.get(`/bus-routes/${id}/roster?month=${month}`).then(r => setData(r.data));
  useEffect(() => { load(); }, [id, month]);
  if (!data) return <div className="p-8 text-sm text-slate-500">Loading…</div>;
  const r = data.route;

  return (
    <>
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between no-print">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1.5"><ArrowLeft className="w-4 h-4" /> Routes</button>
          <div>
            <h1 className="font-heading text-xl font-semibold">{r.name}</h1>
            <div className="text-[12px] text-slate-500 font-mono">{r.code} · {r.vehicle_no || 'No vehicle'} · Driver: {r.driver_name || '—'} ({r.driver_mobile || '—'})</div>
          </div>
        </div>
        <div className="flex gap-2">
          <input type="month" value={month} onChange={e=>setMonth(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm" />
          <button onClick={()=>window.print()} className="h-9 px-3 bg-slate-900 text-white text-sm rounded flex items-center gap-1.5"><Printer className="w-4 h-4" />Print Roster</button>
        </div>
      </div>
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-4 gap-4">
          <Card label="Students on route" value={data.students_count} />
          <Card label="Monthly fee / student" value={inr(r.monthly_fee)} />
          <Card label="Expected collection" value={inr(data.expected)} />
          <Card label={`Collected · ${month}`} value={inr(data.collected)} tone="text-emerald-700" />
        </div>

        <div className="print-page bg-white border border-slate-300 rounded overflow-hidden">
          <div className="p-4 border-b border-slate-300 text-center">
            <div className="font-heading font-bold text-lg">BALAJI CONVENT & JUNIOR COLLEGE</div>
            <div className="text-[12px] text-slate-700">Bus Route Roster — {r.name} ({r.code}) — {month}</div>
          </div>
          <table className="w-full dense-table">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th>#</th><th>Adm No</th><th>Student</th><th>Mobile</th><th className="text-right">Paid</th><th>Status</th></tr></thead>
            <tbody>
              {data.roster.length === 0 && <tr><td colSpan="6" className="text-center py-6 text-slate-500">No students assigned to this route. Set `bus_route = {r.code}` on students in the Students page.</td></tr>}
              {data.roster.map((s, i) => (
                <tr key={s.student_id}>
                  <td>{i+1}</td>
                  <td className="font-mono text-[12px]">{s.admission_no}</td>
                  <td className="font-medium">{s.name}</td>
                  <td className="font-mono text-[12px]">{s.guardian_mobile || '—'}</td>
                  <td className="text-right tabular font-medium">{inr(s.paid_this_month)}</td>
                  <td><span className={`text-[11px] uppercase px-1.5 py-0.5 rounded ${s.status==='paid'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700'}`}>{s.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-2 gap-8 p-6 mt-10 text-[11px] text-slate-600">
            <div className="border-t border-slate-400 pt-1 text-center">Driver's Signature</div>
            <div className="border-t border-slate-400 pt-1 text-center">Accountant</div>
          </div>
        </div>

        {r.stops?.length > 0 && (
          <div className="bg-white border border-slate-200 rounded no-print">
            <div className="px-4 py-2 border-b border-slate-200 font-heading font-medium text-sm">Route Stops</div>
            <table className="w-full dense-table"><tbody>
              {r.stops.map((s, i) => <tr key={i}><td>{i+1}</td><td>{s.name}</td><td className="text-right tabular font-medium">{inr(s.monthly_fee)}</td></tr>)}
            </tbody></table>
          </div>
        )}
      </div>
    </>
  );
}

const inp = "w-full h-9 px-3 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none bg-white";
const F = ({label, children}) => <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">{label}</div>{children}</label>;
const Card = ({label, value, tone='text-slate-900'}) => (
  <div className="bg-white border border-slate-200 rounded p-4">
    <div className="text-[11px] tracking-widest uppercase text-slate-500">{label}</div>
    <div className={`font-heading text-2xl font-semibold tabular mt-1 ${tone}`}>{value}</div>
  </div>
);
