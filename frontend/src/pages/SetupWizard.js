import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { useAuth } from '@/context/AuthContext';
import { CheckCircle2, Circle, Rocket, Shield, Save, Users, Wallet, HardDrive, Sparkles, ExternalLink, Info, Server, Wifi, ArrowRight } from 'lucide-react';

const STORAGE_KEY = 'bc.setup.wizard.completed';

const STEPS = [
  { id: 'password', title: 'Change the default admin password', icon: Shield, help: "Sign out and back in with the new password. Never share the admin login.", cta: { to: '/profile', label: 'Open My Profile' } },
  { id: 'school',   title: 'Set your school name, address, phone, email', icon: Save, help: 'These appear on every receipt and printed notice.', cta: { to: '/settings', label: 'Open Settings' } },
  { id: 'staff',    title: 'Create individual logins for cashier, accountant, manager', icon: Users, help: 'Do not let people share the admin login — every action is audited per user.', cta: { to: '/admin', label: 'Open Administration' } },
  { id: 'ip',       title: "Fix the Main PC's LAN IP (e.g. 192.168.1.10)", icon: Wifi, help: 'Set a static IP on the Main PC. Open Windows Firewall for ports 8001 and 3000 for Private/Domain profiles only.' },
  { id: 'fees',     title: 'Seed or import fee structures for 2026-27', icon: Wallet, help: 'Fastest option: click "Seed 2026 Fee Structures" in Fee Structure. Or import from Excel.', cta: { to: '/fee-structure', label: 'Open Fee Structure' } },
  { id: 'backup',   title: 'Schedule daily mongodump to a USB drive', icon: HardDrive, help: 'See section 5 of the Self-Host Guide. Rotate two USB drives weekly.' },
  { id: 'client',   title: 'Install desktop shortcut on every cashier PC', icon: Server, help: "Run install-client-pc.bat from the ZIP on each cashier PC — creates a Chrome PWA pointing at the Main PC's IP." },
  { id: 'test',     title: 'Issue one test receipt from a cashier PC and print it', icon: Rocket, help: "End-to-end proof: cashier logs in, allocates a fee, prints, then it appears in Receipts + Day-End Summary." },
];

export default function SetupWizard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [done, setDone] = useState({});
  useEffect(() => {
    try { setDone(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')); } catch {}
  }, []);
  const toggle = (id) => {
    const next = { ...done, [id]: !done[id] };
    setDone(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };
  const completed = STEPS.filter(s => done[s.id]).length;
  const pct = Math.round((completed / STEPS.length) * 100);

  return (
    <>
      <PageHeader
        title="First-Boot Setup Wizard"
        subtitle="Follow the checklist below to get the school ready in about 30 minutes."
        actions={
          <a data-testid="wiz-open-zip" href="/downloads/BalajiConventFeeSoftware-v1.0.zip" download className="h-9 px-3 bg-slate-900 text-white rounded text-sm flex items-center gap-1.5"><ExternalLink className="w-4 h-4" /> Install Package</a>
        }
      />
      <div className="p-6 max-w-4xl">
        {/* Progress banner */}
        <div className={`p-5 rounded-lg border-2 mb-6 ${pct === 100 ? 'bg-emerald-50 border-emerald-500' : 'bg-blue-50 border-blue-500'}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-widest font-bold text-slate-600">Setup progress</div>
              <div className="font-heading text-3xl font-bold text-slate-900 mt-0.5" data-testid="wiz-percent">{completed} / {STEPS.length} done · {pct}%</div>
            </div>
            {pct === 100 ? (
              <div className="text-emerald-700 font-heading font-bold text-lg flex items-center gap-2"><Sparkles className="w-6 h-6" /> Ready for daily use!</div>
            ) : (
              <div className="text-slate-600 text-sm">Tick each step as you complete it. Progress is saved on this device.</div>
            )}
          </div>
          <div className="mt-3 h-2 bg-white rounded-full overflow-hidden border border-slate-200">
            <div className={`h-full ${pct === 100 ? 'bg-emerald-500' : 'bg-blue-600'} transition-all`} style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-3">
          {STEPS.map((s, i) => {
            const on = !!done[s.id];
            return (
              <div key={s.id} data-testid={`wiz-step-${s.id}`} className={`bg-white border rounded-lg p-4 flex items-start gap-3 transition-colors ${on ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200 hover:border-slate-300'}`}>
                <button onClick={() => toggle(s.id)} data-testid={`wiz-toggle-${s.id}`} className="flex-shrink-0 mt-0.5">
                  {on ? <CheckCircle2 className="w-6 h-6 text-emerald-600 fill-emerald-100" /> : <Circle className="w-6 h-6 text-slate-300" />}
                </button>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-widest text-slate-400 font-bold">Step {i+1}</span>
                    <s.icon className={`w-4 h-4 ${on ? 'text-emerald-600' : 'text-slate-500'}`} />
                  </div>
                  <div className={`font-heading font-semibold text-slate-900 mt-0.5 ${on ? 'line-through text-slate-500' : ''}`}>{s.title}</div>
                  <div className="text-[12px] text-slate-600 mt-1 flex items-start gap-1.5"><Info className="w-3 h-3 mt-0.5 flex-shrink-0" /> {s.help}</div>
                </div>
                {s.cta && !on && (
                  <button onClick={() => nav(s.cta.to)} data-testid={`wiz-cta-${s.id}`} className="h-8 px-3 border border-slate-300 rounded text-[12px] hover:bg-slate-50 flex items-center gap-1 whitespace-nowrap">
                    {s.cta.label} <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {pct === 100 && (
          <div className="mt-6 p-4 bg-emerald-100 border border-emerald-300 rounded-lg text-emerald-900 text-sm">
            <b>All done.</b> The school is ready. Bookmark this page in case someone new joins and needs to redo the checklist.
          </div>
        )}

        <div className="mt-6 text-[11px] text-slate-500">Signed in as <b>{user?.name}</b> · Wizard progress is saved in this browser only. Uses no server-side state.</div>
      </div>
    </>
  );
}
