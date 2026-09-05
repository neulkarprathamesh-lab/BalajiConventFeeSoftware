import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Rocket, X, Sparkles } from 'lucide-react';

/**
 * OnboardingPopover — shows once, the first time an administrator signs in on a fresh install.
 * Server-side flag lives in `settings.onboarded_at` / `settings.onboarding_dismissed_at`.
 */
export default function OnboardingPopover({ user }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    if (!user || user.role !== 'administrator') return;
    if (localStorage.getItem('bc.onboarding.seen') === '1') return;
    api.get('/onboarding/status').then(r => {
      if (r.data?.first_run) setShow(true);
    }).catch(() => {});
  }, [user]);

  const finish = async (action) => {
    setBusy(true);
    try {
      await api.post(`/onboarding/${action}`);
    } catch { /* offline is fine */ }
    localStorage.setItem('bc.onboarding.seen', '1');
    setShow(false);
    setBusy(false);
    if (action === 'complete') nav('/setup-wizard');
  };

  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 no-print" data-testid="onboarding-popover">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
        <div className="relative px-6 py-5 bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
          <button onClick={() => finish('skip')} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center" data-testid="onboarding-skip">
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-white/15 flex items-center justify-center">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <div className="text-[11px] tracking-widest uppercase text-slate-500 leading-tight">Fee Software · v1.0</div>
              <div className="text-[13px] text-blue-100 mt-0.5">Let's get your school ready in about 5 minutes.</div>
            </div>
          </div>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm text-slate-700 leading-relaxed mb-4">
            The <span className="font-semibold">Setup Wizard</span> walks you through everything you need before the first cashier logs in:
          </p>
          <ul className="text-sm text-slate-700 space-y-2 mb-5">
            <li className="flex gap-2"><span className="text-blue-600 font-semibold">1.</span> Set your school name & receipt header</li>
            <li className="flex gap-2"><span className="text-blue-600 font-semibold">2.</span> Confirm departments and class list</li>
            <li className="flex gap-2"><span className="text-blue-600 font-semibold">3.</span> Import students + fee structures from Excel</li>
            <li className="flex gap-2"><span className="text-blue-600 font-semibold">4.</span> Create cashier / accountant / manager accounts</li>
            <li className="flex gap-2"><span className="text-blue-600 font-semibold">5.</span> Set your Administrator PIN &amp; take the first backup</li>
          </ul>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => finish('complete')}
              disabled={busy}
              className="h-10 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
              data-testid="onboarding-start"
            >
              <Rocket className="w-4 h-4" /> Take me to Setup Wizard
            </button>
            <button
              onClick={() => finish('skip')}
              disabled={busy}
              className="h-10 px-3 text-slate-600 hover:text-slate-900 text-sm"
              data-testid="onboarding-later"
            >
              I'll do this later
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-4">This popover only appears on the very first admin sign-in. You can always find the wizard under the Administration menu.</p>
        </div>
      </div>
    </div>
  );
}
