import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import api from '@/lib/api';
import { inr } from '@/components/Layout';
import { useAuth } from '@/context/AuthContext';
import {
  Search, GraduationCap, Phone, IdCard, CheckCircle2, Info, Printer,
  FileText, Banknote, Smartphone, CreditCard, Sparkles, Settings2, Wallet, ArrowUpDown, Users, Zap
} from 'lucide-react';
import { toast } from 'sonner';

const TABS = [
  { v: 'school',    l: 'Regular Fee',   sub: 'Quarterly / term-wise' },
  { v: 'installment', l: 'Installment', sub: 'Approved instalments' },
  { v: 'misc',      l: 'Other Charges', sub: 'Custom line items' },
];

const MODES = [
  { v: 'cash', l: 'Cash', icon: Banknote },
  { v: 'upi',  l: 'UPI',  icon: Smartphone },
  { v: 'card', l: 'Card', icon: CreditCard },
];

const PRIORITY = ['tuition', 'transport', 'bus', 'computer', 'activity', 'library'];
const priorityIndex = (name = '') => {
  const n = String(name).toLowerCase();
  for (let i = 0; i < PRIORITY.length; i++) if (n.includes(PRIORITY[i])) return i;
  return PRIORITY.length;
};

// Build "lines" for a single student from their ledger
const linesFromLedger = (l, forTab, studentId, studentName) => {
  if (!l) return [];
  const fs = l.fee_structure;
  if (!fs || !Array.isArray(fs.items) || !fs.items.length) return [];
  const paidByHead = {};
  for (const r of (l.receipts || [])) {
    if (r.status === 'cancelled') continue;
    if (['refund','debit_voucher'].includes(r.receipt_type)) continue;
    for (const line of (r.lines || [])) {
      const key = (line.fee_head_name || '').trim().toLowerCase();
      paidByHead[key] = (paidByHead[key] || 0) + Number(line.amount || 0);
    }
  }
  const rows = fs.items.map((it, i) => {
    const label = it.fee_head_name || it.name || `Head ${i+1}`;
    const total = Number(it.amount || 0);
    const paid = paidByHead[label.trim().toLowerCase()] || 0;
    const outstanding = Math.max(0, total - paid);
    return {
      key: `${studentId}::fh-${i}`,
      student_id: studentId,
      student_name: studentName,
      label, outstanding,
      include: outstanding > 0,
      amount: outstanding,
    };
  }).filter(r => r.outstanding > 0);
  rows.sort((a, b) => priorityIndex(a.label) - priorityIndex(b.label));
  return rows;
};

export default function NewReceipt() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState('school');

  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [student, setStudent] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [siblings, setSiblings] = useState([]);           // [{student, ledger}]
  const [includeSiblings, setIncludeSiblings] = useState(false);
  const [busy, setBusy] = useState(false);

  const [lines, setLines] = useState([]);
  const [amountPaying, setAmountPaying] = useState('');
  const [installments, setInstallments] = useState([]);

  const [mode, setMode] = useState('cash');
  const [ref, setRef] = useState('');
  const [remarks, setRemarks] = useState('');
  const [receiptTypes, setReceiptTypes] = useState([]);
  const [receiptTypeId, setReceiptTypeId] = useState('');
  const [rtidTouched, setRtidTouched] = useState(false);
  const [deptsById, setDeptsById] = useState({});

  const debounceRef = useRef(0);

  useEffect(() => {
    const sid = sp.get('student');
    if (sid) api.get(`/students/${sid}`).then(r => selectStudent(r.data));
    api.get('/receipt-types').then(r => setReceiptTypes((r.data || []).filter(t => t.enabled !== false)));
    api.get('/departments').then(r => setDeptsById(Object.fromEntries((r.data || []).map(d => [d.id, d]))));
  }, []);

  // Suggest the matching approved receipt template (EP/MP/SEC/JC/…) once we know
  // the student's department, but never override a cashier's own explicit choice.
  useEffect(() => {
    if (!student || rtidTouched || receiptTypes.length === 0 || Object.keys(deptsById).length === 0) return;
    const code = deptsById[student.department_id]?.code;
    const match = receiptTypes.find(t => (t.applicable_dept_codes || []).length === 1 && t.applicable_dept_codes[0] === code)
      || receiptTypes.find(t => (t.applicable_dept_codes || []).includes(code));
    if (match) setReceiptTypeId(match.id);
  }, [student, receiptTypes, deptsById]); // eslint-disable-line

  useEffect(() => {
    if (!q || q.length < 2) { setResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try { const { data } = await api.get(`/students?q=${encodeURIComponent(q)}&limit=8`); setResults(data); }
      catch { setResults([]); }
    }, 220);
  }, [q]);

  const selectStudent = async (s) => {
    setStudent(s); setResults([]); setQ(''); setIncludeSiblings(false); setSiblings([]);
    setBusy(true);
    try {
      const [ledResp, sibResp] = await Promise.all([
        api.get(`/students/${s.id}/ledger`),
        api.get(`/students/${s.id}/siblings`).catch(() => ({ data: { siblings: [] } })),
      ]);
      setLedger(ledResp.data);
      const primaryLines = linesFromLedger(ledResp.data, tab, s.id, s.name);
      setLines(primaryLines);
      // Auto-suggest: pre-fill amountPaying with the FIRST (highest-priority) pending head's outstanding
      if (tab === 'school' && primaryLines.length) {
        const first = primaryLines[0];
        const suggested = String(Math.round(Number(first.outstanding || 0)));
        setAmountPaying(suggested);
        setTimeout(() => distribute(suggested, primaryLines), 0);
      } else {
        setAmountPaying('');
      }
      // Load siblings' ledgers in the background
      const sibs = sibResp.data?.siblings || [];
      if (sibs.length) {
        const sibLedgers = await Promise.all(sibs.map(x => api.get(`/students/${x.id}/ledger`).then(r => ({ student: x, ledger: r.data })).catch(() => null)));
        setSiblings(sibLedgers.filter(Boolean));
      }
      // Extensions
      try {
        const ext = await api.get(`/extensions?student_id=${s.id}&status=approved`);
        const pending = (ext.data || []).flatMap(e => (e.installments || []).map((it, idx) => ({
          ext_id: e.id, idx, name: it.name || `Installment ${idx+1}`, amount: it.amount, due_date: it.due_date, paid: !!it.paid,
        }))).filter(i => !i.paid);
        setInstallments(pending);
      } catch { setInstallments([]); }
    } catch (e) { toast.error('Could not load student ledger'); }
    finally { setBusy(false); }
  };

  // Rebuild lines when siblings toggle changes or tab changes
  const rebuildLines = (forTab, withSiblings) => {
    if (!ledger || !student) { setLines([]); return; }
    if (forTab === 'misc') {
      setLines([{ key: 'row-1', student_id: student.id, student_name: student.name, label: '', outstanding: 0, include: true, amount: '' }]);
      return;
    }
    if (forTab === 'installment') { setLines([]); return; }
    let all = linesFromLedger(ledger, forTab, student.id, student.name);
    if (withSiblings) {
      for (const s of siblings) {
        all = all.concat(linesFromLedger(s.ledger, forTab, s.student.id, s.student.name));
      }
      // sort by priority across all students
      all.sort((a, b) => priorityIndex(a.label) - priorityIndex(b.label));
    }
    setLines(all);
  };

  useEffect(() => { if (student && ledger) { rebuildLines(tab, includeSiblings); if (tab !== 'school') setAmountPaying(''); } }, [tab]);
  useEffect(() => { if (student && ledger) { rebuildLines(tab, includeSiblings); if (amountPaying) setTimeout(() => distribute(amountPaying), 30); } }, [includeSiblings, siblings.length]);

  const totalPending = useMemo(
    () => lines.reduce((s, l) => s + Number(l.outstanding || 0), 0)
      + (tab === 'installment' ? installments.reduce((s, i) => s + Number(i.amount || 0), 0) : 0),
    [lines, installments, tab]
  );
  const totalAllocated = useMemo(
    () => lines.filter(l => l.include).reduce((s, l) => s + Number(l.amount || 0), 0)
      + (tab === 'installment' ? installments.filter(i => i.include).reduce((s, i) => s + Number(i.amount || 0), 0) : 0),
    [lines, installments, tab]
  );

  const distribute = (val, baseLines) => {
    let remaining = Math.max(0, Number(val) || 0);
    const base = (baseLines || lines).slice().sort((a, b) => priorityIndex(a.label) - priorityIndex(b.label));
    const next = base.map(l => {
      if (!l.include) return { ...l, amount: 0 };
      const take = Math.min(remaining, l.outstanding);
      remaining -= take;
      return { ...l, amount: take };
    });
    setLines(next);
  };

  const onAmountPayingChange = (v) => { setAmountPaying(v); if (tab === 'school') distribute(v); };
  const payFullOutstanding = () => {
    const t = lines.reduce((s, l) => s + (l.include ? Number(l.outstanding || 0) : 0), 0);
    setAmountPaying(String(t)); distribute(t);
  };
  const suggestNextQuarter = () => {
    // Auto-suggest = outstanding of highest-priority pending head (currently first row)
    const first = lines.find(l => l.include && l.outstanding > 0);
    if (!first) return;
    const v = String(Math.round(first.outstanding));
    setAmountPaying(v); distribute(v);
  };

  const toggleInclude = (key) => {
    setLines(prev => prev.map(l => l.key === key ? { ...l, include: !l.include, amount: !l.include ? l.outstanding : 0 } : l));
    setTimeout(() => amountPaying && distribute(amountPaying), 0);
  };
  const setLineAmount = (key, v) => {
    const cleaned = v === '' ? '' : Math.max(0, Number(v));
    setLines(prev => prev.map(l => l.key === key ? { ...l, amount: cleaned === '' ? 0 : Math.min(cleaned, l.outstanding) } : l));
  };
  const setLineLabel = (key, v) => setLines(prev => prev.map(l => l.key === key ? { ...l, label: v } : l));
  const addCustomLine = () => setLines(prev => [...prev, { key: `row-${Date.now()}`, student_id: student.id, student_name: student.name, label: '', outstanding: 0, include: true, amount: '' }]);
  const removeLine = (key) => setLines(prev => prev.filter(l => l.key !== key));

  const remainingAfter = Math.max(0, totalPending - totalAllocated);
  const canSubmit = student && totalAllocated > 0 && !busy;

  const submit = async (thenPrint = true) => {
    if (!student) return toast.error('Select a student first');
    if (tab === 'installment') {
      const payloadLines = installments.filter(i => i.include).map(i => ({ fee_head_id: null, fee_head_name: i.name, installment: i.name, amount: Number(i.amount || 0) }));
      if (!payloadLines.length) return toast.error('Select at least one instalment');
      setBusy(true);
      try {
        const { data } = await api.post('/receipts', {
          receipt_type: 'school', department_id: student.department_id, receipt_type_id: receiptTypeId || null, student_id: student.id,
          payer_name: student.name, payment_mode: mode, payment_reference: ref || null, lines: payloadLines, remarks: remarks || null,
          metadata: { class_name: student.class_name, guardian_name: student.guardian_name, guardian_mobile: student.guardian_mobile },
        });
        toast.success(`Receipt ${data.number} created`);
        if (thenPrint) nav(`/receipts/${data.id}`); else nav('/receipts');
      } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
      finally { setBusy(false); }
      return;
    }

    // Group lines by student_id
    const byStudent = {};
    for (const l of lines) {
      if (!l.include || Number(l.amount) <= 0) continue;
      const sid = l.student_id || student.id;
      byStudent[sid] = byStudent[sid] || { student_id: sid, student_name: l.student_name, lines: [] };
      byStudent[sid].lines.push({ fee_head_id: null, fee_head_name: (l.label || 'Fee').trim(), amount: Number(l.amount) });
    }
    const groups = Object.values(byStudent);
    if (!groups.length) return toast.error('Nothing to charge — allocate at least one head');
    if (tab === 'misc' && groups.some(g => g.lines.some(l => !l.fee_head_name))) return toast.error('Give a label for each line');

    // Look up dept_id for each student (for siblings we already have via siblings state)
    const sidToDept = { [student.id]: student.department_id };
    for (const s of siblings) sidToDept[s.student.id] = s.student.department_id;

    setBusy(true);
    const receiptType = tab === 'misc' ? 'misc' : 'school';
    const createdReceipts = [];
    try {
      for (const g of groups) {
        const dept_id = sidToDept[g.student_id];
        const { data } = await api.post('/receipts', {
          receipt_type: receiptType, department_id: dept_id, receipt_type_id: g.student_id === student.id ? (receiptTypeId || null) : null, student_id: g.student_id,
          payer_name: g.student_name, payment_mode: mode, payment_reference: ref || null,
          lines: g.lines, remarks: remarks || null,
          metadata: { class_name: student.class_name, guardian_name: student.guardian_name, guardian_mobile: student.guardian_mobile, sibling_group_size: groups.length > 1 ? groups.length : undefined },
        });
        createdReceipts.push(data);
      }
      if (createdReceipts.length === 1) {
        toast.success(`Receipt ${createdReceipts[0].number} created`);
        if (thenPrint) nav(`/receipts/${createdReceipts[0].id}`); else nav('/receipts');
      } else {
        toast.success(`${createdReceipts.length} receipts created (one per student)`);
        if (thenPrint) nav(`/receipts/${createdReceipts[0].id}`); else nav('/receipts');
      }
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to create receipt'); }
    finally { setBusy(false); }
  };

  const siblingGroups = useMemo(() => {
    if (!includeSiblings) return null;
    const groups = {};
    for (const l of lines) {
      const key = l.student_id;
      groups[key] = groups[key] || { student_id: key, name: l.student_name, allocated: 0 };
      if (l.include) groups[key].allocated += Number(l.amount || 0);
    }
    return Object.values(groups).filter(g => g.allocated > 0);
  }, [lines, includeSiblings]);

  return (
    <div className="min-h-full flex flex-col">
      <div className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between no-print">
        <div className="flex items-center gap-3">
          <img src="/school-logo.jpeg" alt="logo" className="w-9 h-9 rounded-full object-cover ring-1 ring-slate-700" />
          <div>
            <div className="font-heading font-semibold leading-tight">Balaji Convent · Receipt Manager</div>
            <div className="text-[11px] text-slate-400 tracking-wide uppercase">Cashier Console</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-800 rounded-full pl-1 pr-3 py-1">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-[12px] font-semibold">{user?.name?.[0]?.toUpperCase() || 'C'}</div>
            <div className="text-[12px] leading-tight">
              <div className="font-medium">{user?.name}</div>
              <div className="text-[10px] text-slate-400 capitalize">{user?.role}</div>
            </div>
          </div>
          <Link to="/new-receipt-advanced" data-testid="nr-advanced-link" className="h-8 px-3 rounded bg-slate-800 hover:bg-slate-700 text-[12px] flex items-center gap-1.5"><Settings2 className="w-3.5 h-3.5" /> Advanced Types</Link>
        </div>
      </div>

      <div className="bg-white border-b border-slate-200 px-6 pt-3 no-print">
        <div className="flex items-end gap-2">
          <div className="text-[11px] uppercase tracking-widest text-slate-500 mr-3 mb-2">Receipt Type</div>
          {TABS.map(t => (
            <button key={t.v} data-testid={`nr-tab-${t.v}`} onClick={() => setTab(t.v)}
              className={`px-4 pt-2 pb-2.5 -mb-px border-b-2 transition-colors ${tab===t.v ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              <div className="text-[13px] font-semibold">{t.l}</div>
              <div className="text-[10px] text-slate-400">{t.sub}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 no-print">
        {!student ? (
          <div className="max-w-3xl">
            <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-1.5">Find Student</div>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-4 top-3.5 text-slate-400" />
              <input data-testid="nr-search" autoFocus value={q} onChange={e=>setQ(e.target.value)}
                placeholder="Search by admission no., name or mobile…"
                className="w-full h-11 pl-11 pr-4 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none bg-white shadow-sm" />
              {results.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
                  {results.map(s => (
                    <button key={s.id} data-testid={`nr-result-${s.admission_no}`} onClick={() => selectStudent(s)}
                      className="w-full text-left px-4 py-2.5 hover:bg-blue-50 border-b border-slate-100 last:border-0 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">{s.name}</div>
                        <div className="text-[11px] text-slate-500 font-mono">{s.admission_no}</div>
                      </div>
                      <div className="text-[11px] text-slate-500">{s.guardian_mobile || ''}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-4 py-3 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-heading font-bold text-lg">
                  {(student.name || '').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase()}
                </div>
                <div>
                  <div className="font-heading text-lg font-semibold text-slate-900 leading-tight" data-testid="nr-student-name">{student.name}</div>
                  <div className="flex items-center gap-4 text-[12px] text-slate-600 mt-1">
                    <span className="inline-flex items-center gap-1"><IdCard className="w-3.5 h-3.5" /> <span className="font-mono">{student.admission_no}</span></span>
                    <span className="inline-flex items-center gap-1"><GraduationCap className="w-3.5 h-3.5" /> {student.class_name || ledger?.student?.class_name || '—'}</span>
                    <span className="inline-flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> <span className="font-mono">{student.guardian_mobile ? student.guardian_mobile.replace(/^(\d{2})(\d+)(\d{2})$/, '$1******$3') : '—'}</span></span>
                  </div>
                </div>
              </div>
              <button data-testid="nr-change-student" onClick={() => { setStudent(null); setLedger(null); setLines([]); setSiblings([]); setIncludeSiblings(false); setAmountPaying(''); }} className="text-xs text-blue-700 hover:underline">Change student</button>
            </div>
            {siblings.length > 0 && (
              <div className="mt-2 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-[13px]">
                <Users className="w-4 h-4 text-amber-700" />
                <div className="flex-1">
                  <span className="font-medium text-amber-900">{siblings.length} sibling{siblings.length>1?'s':''} on same guardian mobile</span>
                  <span className="text-amber-800 ml-2">— {siblings.map(s=>s.student.name).join(', ')}</span>
                </div>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" data-testid="nr-include-siblings" checked={includeSiblings} onChange={e=>setIncludeSiblings(e.target.checked)} className="w-4 h-4" />
                  <span className="text-[12px] font-medium text-amber-900">Include siblings in one payment</span>
                </label>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-6 bg-slate-100">
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-heading font-semibold text-lg">Payment Details</h3>
            {student && tab === 'school' && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Allocated automatically
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="text-[10px] uppercase tracking-widest text-slate-500">Total Outstanding{includeSiblings ? ' (Family)' : ''}</div>
              <div className="font-heading text-2xl font-bold tabular text-slate-900 mt-0.5" data-testid="nr-total-pending">{inr(totalPending)}</div>
            </div>
            <div className="bg-emerald-50 border-2 border-emerald-200 rounded-lg p-3">
              <div className="text-[10px] uppercase tracking-widest text-emerald-700">Parent Will Pay</div>
              <div className="font-heading text-2xl font-bold tabular text-emerald-800 mt-0.5" data-testid="nr-total-allocated">{inr(totalAllocated)}</div>
            </div>
            <div className={`border rounded-lg p-3 ${remainingAfter>0 ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
              <div className={`text-[10px] uppercase tracking-widest ${remainingAfter>0 ? 'text-amber-700' : 'text-slate-500'}`}>Balance After</div>
              <div className={`font-heading text-2xl font-bold tabular mt-0.5 ${remainingAfter>0 ? 'text-amber-800' : 'text-slate-900'}`} data-testid="nr-remaining">{inr(remainingAfter)}</div>
            </div>
          </div>

          {tab === 'school' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3 bg-blue-50/60 border border-blue-200 rounded-lg p-3">
              <div className="md:col-span-2">
                <label className="text-[10px] uppercase tracking-widest text-blue-800 flex items-center gap-1.5 mb-1"><Wallet className="w-3.5 h-3.5" /> Amount Paying (auto-distributes ↓)</label>
                <input data-testid="nr-amount-paying" type="number" min="0" step="1" value={amountPaying}
                  onChange={e=>onAmountPayingChange(e.target.value)} placeholder="e.g. 5000"
                  className="w-full h-11 px-3 border-2 border-blue-300 rounded-lg font-mono text-lg font-semibold text-blue-900 bg-white focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none" />
                <div className="text-[11px] text-blue-800 mt-1 flex items-center gap-1"><ArrowUpDown className="w-3 h-3" /> Order: {PRIORITY.map(p=>p[0].toUpperCase()+p.slice(1)).join(' → ')} → others</div>
              </div>
              <div className="flex flex-col justify-end gap-2">
                <button data-testid="nr-next-quarter" onClick={suggestNextQuarter} className="h-9 px-3 border-2 border-blue-300 text-blue-800 hover:bg-blue-100 rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1.5"><Zap className="w-3.5 h-3.5" /> Next Quarter</button>
                <button data-testid="nr-pay-full" onClick={payFullOutstanding} className="h-9 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Full Outstanding</button>
                <button onClick={()=>{ setAmountPaying(''); distribute(0); }} className="h-7 px-3 border border-slate-300 rounded text-[11px] hover:bg-white">Clear</button>
              </div>
            </div>
          )}

          {!student ? (
            <div className="border-2 border-dashed border-slate-200 rounded-lg p-10 text-center text-sm text-slate-500">Select a student to see their pending fee heads</div>
          ) : tab === 'installment' ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-600 border-b border-slate-200">
                  <th className="w-12 py-2">Pay</th><th>Installment</th><th>Due Date</th><th className="text-right">Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                {installments.length === 0 && <tr><td colSpan="4" className="py-6 text-center text-slate-500 text-[13px]">No pending approved installments for this student.</td></tr>}
                {installments.map((it, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2"><input type="checkbox" data-testid={`nr-ins-${i}`} checked={!!it.include} onChange={e=>setInstallments(prev=>prev.map((x,ix)=>ix===i?{...x, include: e.target.checked}:x))} /></td>
                    <td className="py-2">{it.name}</td>
                    <td className="py-2 text-slate-600">{it.due_date || '—'}</td>
                    <td className="py-2 text-right font-mono">{Number(it.amount).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-600 border-b border-slate-200">
                  <th className="w-12 py-2">Include</th>
                  <th>Fee Component</th>
                  {includeSiblings && <th>Student</th>}
                  {tab === 'school' && <th className="text-right">Outstanding (₹)</th>}
                  <th className="text-right">Amount (₹)</th>
                  {tab === 'misc' && <th className="w-10"></th>}
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && tab === 'school' && <tr><td colSpan={includeSiblings ? 5 : 4} className="py-6 text-center text-slate-500 text-[13px]">No pending fee heads found. This student may be fully paid, or has no fee structure assigned.</td></tr>}
                {lines.map((l, i) => (
                  <tr key={l.key} className="border-b border-slate-100">
                    <td className="py-2"><input type="checkbox" data-testid={`nr-fh-inc-${i}`} checked={!!l.include} onChange={()=>toggleInclude(l.key)} /></td>
                    <td className="py-2">
                      {tab === 'misc' ? (
                        <input data-testid={`nr-fh-name-${i}`} value={l.label} onChange={e=>setLineLabel(l.key, e.target.value)} placeholder="e.g. Late Fee, Bonafide Cert" className="w-full h-8 px-2 border border-slate-300 rounded text-sm bg-white" />
                      ) : (
                        <span className="font-medium text-slate-800">{l.label}</span>
                      )}
                    </td>
                    {includeSiblings && <td className="py-2"><span className={`text-[11px] px-2 py-0.5 rounded-full ${l.student_id===student.id ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}>{l.student_name}</span></td>}
                    {tab === 'school' && <td className="py-2 text-right font-mono text-slate-600">{Number(l.outstanding).toFixed(2)}</td>}
                    <td className="py-2 text-right">
                      <input data-testid={`nr-fh-amt-${i}`} type="number" min="0" step="1" value={l.amount === 0 && !l.include ? '' : l.amount} onChange={e=>setLineAmount(l.key, e.target.value)}
                        className="h-8 w-28 px-2 border border-slate-300 rounded text-right font-mono text-sm bg-white" disabled={!l.include} />
                    </td>
                    {tab === 'misc' && <td className="py-2 text-right"><button onClick={()=>removeLine(l.key)} className="text-xs text-red-600 hover:underline">Remove</button></td>}
                  </tr>
                ))}
                {tab === 'misc' && (
                  <tr><td colSpan={includeSiblings ? 5 : 4} className="py-2"><button onClick={addCustomLine} className="text-xs text-blue-700 hover:underline">+ Add another line</button></td></tr>
                )}
                <tr className="bg-slate-50 font-semibold">
                  <td colSpan={(tab === 'school' ? 3 : 2) + (includeSiblings ? 1 : 0)} className="py-2 text-right">Total Allocated</td>
                  <td className="py-2 text-right font-mono text-lg text-emerald-700" data-testid="nr-total-alloc-row">{inr(totalAllocated)}</td>
                  {tab === 'misc' && <td></td>}
                </tr>
              </tbody>
            </table>
          )}
        </div>

        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 shadow-sm h-fit">
          <h3 className="font-heading font-semibold text-lg mb-3">Receipt Format</h3>
          <select data-testid="nr-receipt-format" value={receiptTypeId}
            onChange={e => { setRtidTouched(true); setReceiptTypeId(e.target.value); }}
            className="w-full h-10 px-3 border border-slate-300 rounded text-sm bg-white mb-4">
            <option value="">— Select approved receipt type —</option>
            {receiptTypes.map(t => {
              const code = deptsById[student?.department_id]?.code;
              const compatible = !t.applicable_dept_codes || !code || t.applicable_dept_codes.includes(code);
              return <option key={t.id} value={t.id}>{t.code} — {t.name}{compatible ? '' : ' (not for this student)'}</option>;
            })}
          </select>

          <h3 className="font-heading font-semibold text-lg mb-3">Payment Mode</h3>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {MODES.map(m => (
              <button key={m.v} data-testid={`nr-mode-${m.v}`} onClick={()=>setMode(m.v)}
                className={`flex flex-col items-center gap-1 h-20 rounded-lg border-2 transition-colors ${mode===m.v ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 hover:border-slate-300 text-slate-700'}`}>
                <m.icon className="w-6 h-6" strokeWidth={1.75} />
                <div className="text-[12px] font-medium">{m.l}</div>
                {mode===m.v && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 -mt-1" />}
              </button>
            ))}
          </div>

          <label className="block mb-3">
            <div className="text-[11px] uppercase tracking-widest text-slate-600 flex items-center gap-1 mb-1">Reference / UPI ID <Info className="w-3 h-3 text-slate-400" /></div>
            <input data-testid="nr-ref" value={ref} onChange={e=>setRef(e.target.value)} placeholder={mode==='upi' ? 'name@paytm' : mode==='card' ? 'Last 4 digits' : 'optional'} className="w-full h-10 px-3 border border-slate-300 rounded text-sm bg-white focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none" />
          </label>

          <label className="block mb-3">
            <div className="text-[11px] uppercase tracking-widest text-slate-600 mb-1">Amount Received (₹)</div>
            <input data-testid="nr-amount-received" readOnly value={totalAllocated.toFixed(2)} className="w-full h-11 px-3 border border-slate-300 rounded font-mono text-lg font-semibold bg-slate-50" />
          </label>

          {siblingGroups && siblingGroups.length > 1 && (
            <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded text-[11px]">
              <div className="font-semibold text-amber-900 mb-1 flex items-center gap-1"><Users className="w-3 h-3" /> Family split — {siblingGroups.length} receipts will be issued</div>
              {siblingGroups.map(g => <div key={g.student_id} className="flex justify-between text-amber-800"><span>{g.name}</span><span className="font-mono">{inr(g.allocated)}</span></div>)}
            </div>
          )}

          <label className="block mb-4">
            <div className="text-[11px] uppercase tracking-widest text-slate-600 mb-1">Remarks</div>
            <input value={remarks} onChange={e=>setRemarks(e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded text-sm bg-white focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none" />
          </label>

          <button data-testid="nr-submit" disabled={!canSubmit} onClick={()=>submit(true)}
            className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2 shadow-sm">
            <Printer className="w-5 h-5" /> Create {siblingGroups && siblingGroups.length > 1 ? `${siblingGroups.length} Receipts` : '& Print Receipt'} · {inr(totalAllocated)}
          </button>
          <button data-testid="nr-save-draft" disabled={!canSubmit} onClick={()=>submit(false)}
            className="mt-2 w-full h-10 border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-lg text-sm text-slate-700 flex items-center justify-center gap-1.5">
            <FileText className="w-4 h-4" /> Save & Continue Later
          </button>

          <div className="text-[11px] text-slate-500 mt-4 border-t border-slate-100 pt-3 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>Receipt number is generated centrally. Prints as the official 210 × 142.8 mm landscape receipt (A5 media).</span>
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border-t border-blue-200 px-6 py-2 text-[12px] text-blue-900 flex items-center justify-between no-print">
        <span className="inline-flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> Receipt number will be generated centrally when you click <b>Create &amp; Print</b>.</span>
        {student && <span>Cashier: <b>{user?.name}</b> · Mode: <b className="capitalize">{mode}</b> · Allocated: <b>{inr(totalAllocated)}</b></span>}
      </div>
    </div>
  );
}
