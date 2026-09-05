import React, { useState } from 'react';
import { PageHeader } from '@/components/Layout';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, Smartphone, ScanLine } from 'lucide-react';

const LOGO = "/school-logo.jpeg";

const T = {
  en: {
    schoolLine: 'BALAJI CONVENT',
    schoolLine2: '& JUNIOR COLLEGE',
    address: 'BUTIBORI, NAGPUR — 441122',
    tipBadge: "PARENTS — HERE'S A QUICK TIP",
    heading1: 'SCAN THE QR CODE',
    heading2: 'ON ANY RECEIPT',
    sub: "to instantly view your child's",
    subHighlight: 'complete fee ledger',
    steps: [
      { t: '1. OPEN CAMERA', s: 'on your phone', icon: Smartphone },
      { t: '2. POINT AT QR', s: 'on the receipt', icon: ScanLine },
      { t: '3. TAP THE LINK', s: 'see your ledger', icon: null, check: true },
    ],
    sample: 'SAMPLE QR — EVERY RECEIPT HAS ITS OWN',
    safe: '100% Safe · View-Only · No login required',
    help: 'Any issue? Please visit the school office — 9:00 AM to 3:00 PM (Mon–Sat)',
    tagline: 'SHAPING TOMORROW · BUILDING EXCELLENCE',
  },
  mr: {
    schoolLine: 'बालाजी कॉन्व्हेंट',
    schoolLine2: 'व कनिष्ठ महाविद्यालय',
    address: 'बुटीबोरी, नागपूर — ४४११२२',
    tipBadge: 'पालकांसाठी — एक झटपट सूचना',
    heading1: 'पावतीवरील QR कोड',
    heading2: 'स्कॅन करा',
    sub: 'आणि आपल्या पाल्याचे',
    subHighlight: 'संपूर्ण फी खाते पहा',
    steps: [
      { t: '१. कॅमेरा उघडा', s: 'तुमच्या फोनवर', icon: Smartphone },
      { t: '२. QR वर धरा', s: 'पावतीवरील', icon: ScanLine },
      { t: '३. लिंकवर टॅप करा', s: 'तुमचे खाते पहा', icon: null, check: true },
    ],
    sample: 'नमुना QR — प्रत्येक पावतीवर वेगळा',
    safe: '१००% सुरक्षित · फक्त पाहण्यासाठी · लॉगिन गरजेचे नाही',
    help: 'काही अडचण असल्यास शाळेच्या कार्यालयात भेट द्या — सकाळी ९:०० ते दुपारी ३:०० (सोम–शनि)',
    tagline: 'उज्ज्वल भविष्य · उत्कर्ष घडवत आहे',
  },
};

export default function KioskPoster() {
  const [lang, setLang] = useState('en');
  const t = T[lang];
  const base = window.location.origin;

  return (
    <>
      <PageHeader title="Kiosk QR Poster" subtitle="Print an A4 poster for the fee counter and PTM registration desk"
        actions={
          <div className="flex gap-2 no-print">
            <div className="inline-flex border border-slate-300 rounded overflow-hidden">
              <button data-testid="poster-lang-en" onClick={()=>setLang('en')} className={`h-9 px-3 text-xs ${lang==='en' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>English</button>
              <button data-testid="poster-lang-mr" onClick={()=>setLang('mr')} className={`h-9 px-3 text-xs ${lang==='mr' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>मराठी</button>
            </div>
            <button data-testid="poster-print" onClick={()=>window.print()} className="h-9 px-3 bg-blue-600 text-white text-sm rounded flex items-center gap-1.5 hover:bg-blue-700">
              <Printer className="w-4 h-4" /> Print A4
            </button>
          </div>
        }
      />
      <div className="p-6">
        <div className="print-page bg-white border-8 border-double border-slate-900 mx-auto max-w-2xl p-10 text-center relative overflow-hidden" data-testid={`kiosk-poster-${lang}`} lang={lang}>
          <div className="absolute top-0 left-0 w-full h-2 bg-slate-900"></div>
          <div className="absolute bottom-0 left-0 w-full h-2 bg-slate-900"></div>

          <img src={LOGO} alt="logo" className="w-28 h-28 rounded-full object-cover mx-auto mb-4 ring-4 ring-slate-900" />
          <div className="font-heading text-3xl font-black tracking-tight uppercase leading-tight">{t.schoolLine}</div>
          <div className="font-heading text-lg font-bold tracking-wider text-slate-800">{t.schoolLine2}</div>
          <div className="text-[13px] text-slate-600 mb-6 mt-1">{t.address}</div>

          <div className="inline-flex items-center gap-2 bg-amber-100 border-2 border-amber-500 rounded-full px-4 py-1 text-amber-900 font-bold text-sm mb-6">
            <ScanLine className="w-4 h-4" /> {t.tipBadge}
          </div>

          <div className="font-heading text-4xl font-black tracking-tight leading-tight mb-2 text-slate-900">
            {t.heading1}<br/>{t.heading2}
          </div>
          <div className="text-lg text-slate-700 mb-8">
            {t.sub} <span className="font-bold underline decoration-amber-500 decoration-4 underline-offset-4">{t.subHighlight}</span>
          </div>

          <div className="grid grid-cols-3 gap-4 items-start bg-slate-50 border-2 border-slate-300 rounded-lg p-6 my-6">
            {t.steps.map((step, i) => (
              <div key={i} className="text-center">
                <div className={`w-16 h-16 ${step.check ? 'bg-emerald-600' : 'bg-slate-900'} text-white rounded-full flex items-center justify-center mx-auto mb-2 font-bold text-2xl`}>
                  {step.check ? '✓' : step.icon ? <step.icon className="w-8 h-8" /> : ''}
                </div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-slate-700">{step.t}</div>
                <div className="text-[11px] text-slate-500 mt-1">{step.s}</div>
              </div>
            ))}
          </div>

          <div className="bg-slate-900 text-white rounded-lg p-6 mt-4">
            <div className="text-[11px] uppercase tracking-widest text-slate-300">{t.sample}</div>
            <div className="flex justify-center my-3 bg-white rounded p-3 mx-auto w-fit">
              <QRCodeSVG value={`${base}/lookup/BC2026-000123`} size={140} level="M" includeMargin={false} />
            </div>
            <div className="text-[13px] text-slate-200 mt-2">{t.safe}</div>
          </div>

          <div className="text-[13px] text-slate-700 mt-6 italic">{t.help}</div>
          <div className="text-[11px] text-slate-500 mt-4 tracking-widest">{t.tagline}</div>
        </div>
      </div>
    </>
  );
}
