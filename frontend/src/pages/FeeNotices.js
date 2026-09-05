import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { Printer, FileText, Languages } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

const NT = {
  en: { title: 'OUTSTANDING FEE NOTICE', date: 'Date', student: 'Student', admNo: 'Admission No', class: 'Class', guardian: 'Guardian', contact: 'Contact', intro: 'Dear Parent / Guardian, our records show the following pending fee for your ward. Kindly clear it at the school fee counter at the earliest.', particulars: 'Particulars', amount: 'Amount', academic: 'Academic Fee (Annual)', busFee: 'Bus Fee', months: 'months', total: 'Total Annual Fee', less: 'Less: Amount Paid', concession: 'Less: Concession / Adjustment', addRefund: 'Add: Refunded', outstanding: 'Amount Outstanding', footer: 'Fee counter timing: 9:00 AM – 3:00 PM (Mon–Sat). Modes accepted: Cash / Cheque / DD / UPI / NEFT.', ack: 'Acknowledgement / Return Slip', received: 'Received on', parentSign: "Parent / Guardian Signature", teacher: 'Class Teacher', scanForLedger: 'Scan for ledger' },
  mr: { title: 'थकबाकी फी सूचना', date: 'दिनांक', student: 'विद्यार्थी', admNo: 'प्रवेश क्रमांक', class: 'वर्ग', guardian: 'पालक', contact: 'संपर्क', intro: 'प्रिय पालक/पालक, आमच्या नोंदीनुसार आपल्या पाल्याची खालील फी थकीत आहे. कृपया शाळेच्या फी काउंटरवर लवकरात लवकर भरा.', particulars: 'तपशील', amount: 'रक्कम', academic: 'शैक्षणिक फी (वार्षिक)', busFee: 'बस फी', months: 'महिने', total: 'एकूण वार्षिक फी', less: 'वजा: भरलेली रक्कम', concession: 'वजा: सूट / समायोजन', addRefund: 'अधिक: परतावा', outstanding: 'थकबाकी', footer: 'फी काउंटर वेळ: सकाळी ९:०० ते दुपारी ३:०० (सोम–शनि). पद्धती: रोख / धनादेश / डी.डी. / UPI / NEFT.', ack: 'पावती / परत स्लिप', received: 'मिळाल्याची तारीख', parentSign: 'पालकांची स्वाक्षरी', teacher: 'वर्गशिक्षक', scanForLedger: 'खात्यासाठी स्कॅन करा' },
};

export default function FeeNotices() {
  const [depts, setDepts] = useState([]);
  const [classes, setClasses] = useState([]);
  const [dept, setDept] = useState('');
  const [cls, setCls] = useState('');
  const [minAmount, setMinAmount] = useState(1);
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState({});
  const [lang, setLang] = useState('en');

  useEffect(() => {
    api.get('/departments').then(r => setDepts(r.data));
    api.get('/classes').then(r => setClasses(r.data));
  }, []);

  const availClasses = classes.filter(c => c.department_id === dept);
  const run = async () => {
    const p = new URLSearchParams();
    if (dept) p.set('department_id', dept);
    if (cls) p.set('class_id', cls);
    p.set('min_amount', minAmount);
    const { data } = await api.get(`/notices/outstanding?${p.toString()}`);
    setData(data);
    setSelected(Object.fromEntries(data.students.map(s => [s.student_id, true])));
  };
  const toggle = (id) => setSelected({...selected, [id]: !selected[id]});
  const toggleAll = () => {
    const all = data.students.every(s => selected[s.student_id]);
    setSelected(Object.fromEntries(data.students.map(s => [s.student_id, !all])));
  };
  const selectedCount = data?.students.filter(s => selected[s.student_id]).length || 0;

  return (
    <>
      <PageHeader title="Term Fee Notices" subtitle="Auto-generate printable outstanding-fee notices for parents (PTM handouts)"
        actions={
          <div className="flex gap-2 no-print">
            <div className="inline-flex border border-slate-300 rounded overflow-hidden">
              <button data-testid="fn-lang-en" onClick={()=>setLang('en')} className={`h-9 px-3 text-xs ${lang==='en' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'}`}>English</button>
              <button data-testid="fn-lang-mr" onClick={()=>setLang('mr')} className={`h-9 px-3 text-xs ${lang==='mr' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'}`}>मराठी</button>
            </div>
            {data && data.students.length > 0 && (
              <button data-testid="fn-print" onClick={()=>window.print()} className="h-9 px-3 bg-blue-600 text-white text-sm rounded flex items-center gap-1.5 hover:bg-blue-700">
                <Printer className="w-4 h-4" /> Print {selectedCount} Notice{selectedCount===1?'':'s'}
              </button>
            )}
          </div>
        }
      />
      <div className="p-6 space-y-4">
        <div className="bg-white border border-slate-200 rounded p-4 flex flex-wrap gap-3 items-end no-print">
          <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Department</div>
            <select value={dept} onChange={e=>{setDept(e.target.value); setCls('');}} className="h-9 px-3 border border-slate-300 rounded text-sm bg-white"><option value="">All</option>{depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </div>
          <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Class</div>
            <select value={cls} onChange={e=>setCls(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm bg-white"><option value="">All</option>{availClasses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </div>
          <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Min Outstanding (₹)</div>
            <input type="number" value={minAmount} onChange={e=>setMinAmount(e.target.value)} className="h-9 w-28 px-3 border border-slate-300 rounded text-sm" />
          </div>
          <button data-testid="fn-run" onClick={run} className="h-9 px-4 bg-slate-900 text-white rounded text-sm">Generate</button>
        </div>

        {data && (
          <>
            <div className="bg-white border border-slate-200 rounded no-print">
              <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between">
                <div className="text-sm text-slate-700"><b>{data.count}</b> students have outstanding fees · <b>{selectedCount}</b> selected to print</div>
                <button onClick={toggleAll} className="text-xs text-blue-700 hover:underline">Toggle all</button>
              </div>
              <table className="w-full dense-table">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th className="w-8"></th><th>Adm No</th><th>Student</th><th>Class</th><th>Guardian</th><th className="text-right">Total Fee</th><th className="text-right">Paid</th><th className="text-right">Outstanding</th></tr></thead>
                <tbody>
                  {data.students.length === 0 && <tr><td colSpan="8" className="text-center py-6 text-slate-500">No students with outstanding fees</td></tr>}
                  {data.students.map(s => (
                    <tr key={s.student_id}>
                      <td><input type="checkbox" checked={!!selected[s.student_id]} onChange={()=>toggle(s.student_id)} /></td>
                      <td className="font-mono text-[12px]">{s.admission_no}</td>
                      <td className="font-medium">{s.name}</td>
                      <td className="text-[12px]">{s.class_name}</td>
                      <td className="text-[12px]">{s.guardian_name || '-'} <span className="text-slate-500 font-mono">{s.guardian_mobile}</span></td>
                      <td className="text-right tabular text-[12px]">{inr(s.total_fee)}</td>
                      <td className="text-right tabular text-[12px] text-emerald-700">{inr(s.paid)}</td>
                      <td className="text-right tabular font-semibold text-red-700">{inr(s.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Printable notice sheets */}
            <div className="hidden print:block space-y-0" data-testid="fn-print-area">
              {data.students.filter(s => selected[s.student_id]).map(s => <Notice key={s.student_id} s={s} lang={lang} />)}
            </div>

            {/* Preview */}
            {selectedCount > 0 && (
              <div className="space-y-4">
                <div className="text-[11px] uppercase tracking-widest text-slate-500 font-medium no-print">Preview (first notice) — {lang === 'mr' ? 'मराठी' : 'English'}</div>
                <Notice s={data.students.find(x => selected[x.student_id])} lang={lang} preview />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Notice({ s, preview = false, lang = 'en' }) {
  const t = NT[lang] || NT.en;
  const lookupUrl = `${window.location.origin}/parent/${s.admission_no}`;
  return (
    <div className={`bg-white border border-slate-300 mx-auto ${preview ? 'max-w-2xl' : ''}`} style={{ pageBreakAfter: 'always', minHeight: preview ? undefined : '95vh' }} lang={lang}>
      <div className="p-6">
        <div className="flex items-center gap-4 border-b-2 border-slate-900 pb-3 mb-4">
          <img src="/school-logo.jpeg" alt="logo" className="w-16 h-16 rounded-full object-cover" />
          <div className="flex-1">
            <div className="font-heading text-xl font-bold tracking-tight">{lang==='mr' ? 'बालाजी कॉन्व्हेंट व कनिष्ठ महाविद्यालय' : 'BALAJI CONVENT & JUNIOR COLLEGE'}</div>
            <div className="text-[12px] text-slate-700">{lang==='mr' ? 'बुटीबोरी, नागपूर' : 'Butibori, Nagpur'} · {s.department_name} · {lang==='mr' ? 'शैक्षणिक वर्ष' : 'Academic Year'} {s.academic_year || '—'}</div>
          </div>
          <div className="text-center">
            <QRCodeSVG value={lookupUrl} size={64} level="M" includeMargin={false} />
            <div className="text-[8px] uppercase tracking-widest text-slate-500 mt-1">{t.scanForLedger}</div>
          </div>
        </div>
        <div className="text-center text-[13px] uppercase tracking-widest font-semibold my-3">{t.title}</div>
        <div className="text-sm mb-4">{t.date}: <span className="font-mono">{new Date().toLocaleDateString(lang==='mr'?'mr-IN':'en-IN')}</span></div>
        <div className="grid grid-cols-2 gap-2 text-sm mb-4 border border-slate-300 p-3 rounded">
          <div><span className="text-slate-500">{t.student}: </span><b>{s.name}</b></div>
          <div><span className="text-slate-500">{t.admNo}: </span><span className="font-mono">{s.admission_no}</span></div>
          <div><span className="text-slate-500">{t.class}: </span>{s.class_name}</div>
          <div><span className="text-slate-500">{t.guardian}: </span>{s.guardian_name || '—'}</div>
          <div className="col-span-2"><span className="text-slate-500">{t.contact}: </span>{s.guardian_mobile || '—'}</div>
        </div>
        <p className="text-sm text-slate-800 mb-3">{t.intro}</p>
        <table className="w-full text-sm border-t border-b border-slate-400 my-3">
          <thead><tr className="border-b border-slate-400"><th className="text-left py-1.5">{t.particulars}</th><th className="text-right">{t.amount}</th></tr></thead>
          <tbody>
            <tr><td className="py-1">{t.academic}</td><td className="text-right tabular">{inr(s.academic_fee ?? s.total_fee)}</td></tr>
            {s.bus_fee_annual > 0 && (
              <tr><td className="py-1">{t.busFee} — Route {s.bus_route_code} {s.bus_route_name ? `(${s.bus_route_name})` : ''} · {inr(s.bus_monthly_fee)} × {s.bus_months} {t.months}</td><td className="text-right tabular">{inr(s.bus_fee_annual)}</td></tr>
            )}
            <tr className="border-t border-slate-200"><td className="py-1 font-medium">{t.total}</td><td className="text-right tabular font-medium">{inr(s.total_fee)}</td></tr>
            <tr><td className="py-1">{t.less}</td><td className="text-right tabular text-emerald-700">− {inr(s.paid)}</td></tr>
            {s.adjusted > 0 && <tr><td className="py-1">{t.concession}</td><td className="text-right tabular text-emerald-700">− {inr(s.adjusted)}</td></tr>}
            {s.refunded > 0 && <tr><td className="py-1">{t.addRefund}</td><td className="text-right tabular">+ {inr(s.refunded)}</td></tr>}
          </tbody>
          <tfoot><tr className="border-t-2 border-slate-900"><td className="py-2 font-semibold">{t.outstanding}</td><td className="text-right tabular font-bold text-red-700 text-lg">{inr(s.outstanding)}</td></tr></tfoot>
        </table>
        <div className="text-[12px] text-slate-600 mt-3">{t.footer}</div>
        <div className="mt-8 pt-4 border-t border-dashed border-slate-400">
          <div className="text-[11px] text-slate-500 uppercase tracking-widest text-center mb-3">— {t.ack} —</div>
          <div className="grid grid-cols-2 gap-4 text-[12px]">
            <div>{t.student}: <b>{s.name}</b> ({s.admission_no})</div>
            <div>{t.class}: {s.class_name}</div>
            <div>{t.outstanding}: <b className="text-red-700 tabular">{inr(s.outstanding)}</b></div>
            <div>{t.received}: _______________</div>
          </div>
          <div className="grid grid-cols-2 gap-8 mt-8 text-[11px] text-slate-600">
            <div className="border-t border-slate-400 pt-1 text-center">{t.parentSign}</div>
            <div className="border-t border-slate-400 pt-1 text-center">{t.teacher}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
