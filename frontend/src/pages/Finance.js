import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { Wallet, Plus, Trash2, Search, Building2 } from 'lucide-react';

export default function Finance() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [dvType, setDvType] = useState(null);
  const [payee, setPayee] = useState('');
  const [department, setDepartment] = useState('');
  const [departments, setDepartments] = useState([]);
  const [purpose, setPurpose] = useState('');
  const [lines, setLines] = useState([{ head: '', amount: '' }]);
  const [mode, setMode] = useState('cash');
  const [ref, setRef] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/receipt-types?category=finance'),
      api.get('/departments'),
    ]).then(([rt, d]) => {
      const dv = (rt.data || []).find(t => t.code === 'DV');
      setDvType(dv || null);
      setDepartments(d.data || []);
      if (d.data?.[0]) setDepartment(d.data[0].id);
    });
  }, []);

  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const canSubmit = payee.trim() && department && lines.some(l => Number(l.amount) > 0 && l.head.trim()) && !busy;

  const setLine = (i, k, v) => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [k]: v } : l));
  const addLine = () => setLines(prev => [...prev, { head: '', amount: '' }]);
  const removeLine = (i) => setLines(prev => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/receipts', {
        receipt_type: 'debit_voucher',
        department_id: department,
        payer_name: payee.trim(),
        purpose: purpose || null,
        payment_mode: mode,
        payment_reference: ref || null,
        lines: lines.filter(l => Number(l.amount) > 0 && l.head.trim()).map(l => ({ fee_head_id: null, fee_head_name: l.head.trim(), amount: Number(l.amount) })),
        remarks: remarks || null,
      });
      toast.success(`Debit Voucher ${data.number} issued`);
      nav(`/receipts/${data.id}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to create voucher');
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Finance · Debit Voucher"
        subtitle={dvType ? `Prefix: ${dvType.code} · ${dvType.description || 'Expense / refund / vendor payment'}` : 'Loading…'}
      />
      <div className="p-6 max-w-3xl">
        {user?.role === 'cashier' && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-[13px] text-red-800 mb-4">Debit vouchers require Manager or Administrator role.</div>
        )}
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Payee / Vendor Name" required>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input data-testid="dv-payee" value={payee} onChange={e=>setPayee(e.target.value)} className="w-full h-10 pl-10 pr-3 border border-slate-300 rounded" placeholder="e.g. Electricity Board / Vendor Name" />
              </div>
            </Field>
            <Field label="Department (for accounting)" required>
              <div className="relative">
                <Building2 className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <select data-testid="dv-dept" value={department} onChange={e=>setDepartment(e.target.value)} className="w-full h-10 pl-10 pr-3 border border-slate-300 rounded bg-white">
                  {departments.map(d => <option key={d.id} value={d.id}>{`${d.name} (${d.code})`}</option>)}
                </select>
              </div>
            </Field>
            <Field label="Purpose" span={2}>
              <input value={purpose} onChange={e=>setPurpose(e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded" placeholder="e.g. Monthly electricity bill – July" />
            </Field>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-widest text-slate-600 font-bold mb-2">Line Items</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase text-slate-500 border-b border-slate-200">
                  <th className="py-1.5">Head / Description</th>
                  <th className="py-1.5 w-40 text-right">Amount (₹)</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1.5"><input data-testid={`dv-head-${i}`} value={l.head} onChange={e=>setLine(i,'head',e.target.value)} className="w-full h-9 px-2 border border-slate-300 rounded" placeholder="e.g. Electricity bill / stationery" /></td>
                    <td className="py-1.5"><input data-testid={`dv-amt-${i}`} type="number" min="0" step="1" value={l.amount} onChange={e=>setLine(i,'amount',e.target.value)} className="w-full h-9 px-2 border border-slate-300 rounded text-right font-mono" /></td>
                    <td className="py-1.5 text-center">{lines.length > 1 && <button onClick={()=>removeLine(i)} className="text-red-600"><Trash2 className="w-4 h-4" /></button>}</td>
                  </tr>
                ))}
                <tr><td colSpan="3" className="py-2"><button onClick={addLine} data-testid="dv-add-line" className="text-[12px] text-blue-700 hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Add another line</button></td></tr>
                <tr className="bg-slate-50 font-semibold">
                  <td className="py-2 text-right pr-2">Total</td>
                  <td className="py-2 text-right font-mono text-lg tabular text-slate-900" data-testid="dv-total">{inr(total)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Payment Mode">
              <select value={mode} onChange={e=>setMode(e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded bg-white">
                {['cash','cheque','dd','upi','neft','card','other'].map(m => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Reference (cheque no / UPI ref)">
              <input value={ref} onChange={e=>setRef(e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded" />
            </Field>
            <Field label="Remarks" span={2}>
              <input value={remarks} onChange={e=>setRemarks(e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded" />
            </Field>
          </div>

          <button data-testid="dv-submit" disabled={!canSubmit} onClick={submit}
            className="w-full h-11 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded text-sm font-semibold flex items-center justify-center gap-2">
            <Wallet className="w-4 h-4" /> Issue Debit Voucher · {inr(total)}
          </button>
        </div>
      </div>
    </>
  );
}

const Field = ({ label, children, span = 1, required = false }) => (
  <label className={`block ${span === 2 ? 'col-span-2' : ''}`}>
    <div className="text-[11px] uppercase tracking-widest text-slate-600 mb-1">{label}{required && <span className="text-red-600 ml-0.5">*</span>}</div>
    {children}
  </label>
);
