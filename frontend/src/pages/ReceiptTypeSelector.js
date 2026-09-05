import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { toast } from 'sonner';
import { GraduationCap, BookOpen, Award, Bus, ClipboardList, Wallet, ArrowRight, School } from 'lucide-react';

const ICONS = { GraduationCap, BookOpen, Award, Bus, ClipboardList, Wallet, School };

export default function ReceiptTypeSelector() {
  const nav = useNavigate();
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get('/receipt-types?category=school').then(r => {
      // include bus too — the selector shows school+bus tiles
      api.get('/receipt-types?category=bus').then(b => setTypes([...(r.data||[]), ...(b.data||[])])).catch(()=>setTypes(r.data||[]));
    }).catch(() => toast.error('Failed to load receipt types')).finally(()=>setLoading(false));
  }, []);

  const pick = (t) => {
    // Route to the cashier UI with the type pre-loaded via query string
    nav(`/new-receipt/entry?type=${t.id}`);
  };

  return (
    <>
      <PageHeader title="New Receipt" subtitle="Pick the receipt type — the software auto-loads the correct template, prefix and fee heads" />
      <div className="p-6">
        {loading ? (
          <div className="text-center text-sm text-slate-500 py-10">Loading receipt types…</div>
        ) : types.length === 0 ? (
          <div className="text-center text-sm text-slate-500 py-10">No receipt types configured. Go to <b>Settings → Receipt Types</b>.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {types.sort((a,b) => (a.display_order||0)-(b.display_order||0)).map(t => {
              const Icon = ICONS[t.icon] || School;
              return (
                <button key={t.id} data-testid={`rt-tile-${t.code}`} onClick={()=>pick(t)}
                  className="group text-left bg-white border border-slate-200 rounded-lg p-5 hover:border-blue-500 hover:shadow-md transition-all">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${t.category==='bus' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                      <Icon className="w-6 h-6" strokeWidth={1.75} />
                    </div>
                    <span className="text-[10px] font-mono font-bold px-2 py-1 rounded bg-slate-900 text-white">{t.code}</span>
                  </div>
                  <div className="font-heading font-semibold text-slate-900 leading-tight">{t.name}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{t.department_name}</div>
                  <div className="text-[12px] text-slate-600 mt-2 line-clamp-2">{t.description || '—'}</div>
                  <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-blue-700 group-hover:text-blue-900 font-semibold flex items-center gap-1">
                    Open cashier <ArrowRight className="w-3 h-3" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
