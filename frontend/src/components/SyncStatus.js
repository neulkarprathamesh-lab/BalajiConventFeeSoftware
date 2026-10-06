import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { startAutoSync, kickSync } from '@/lib/syncEngine';
import useSyncStatus from '@/lib/useSyncStatus';
import { describeStatus } from '@/lib/syncPolicy';

const DOT = {
  green: 'bg-emerald-400',
  amber: 'bg-amber-400 animate-pulse',
  red: 'bg-red-400',
  slate: 'bg-slate-400 animate-pulse',
};

const TITLE_CLASS = {
  green: 'text-emerald-300',
  amber: 'text-amber-300',
  red: 'text-red-300',
  slate: 'text-slate-300',
};

/**
 * Always-visible connection badge: Connected / Syncing / Offline / Sign in to
 * sync / Sync problem, with the last-synced time or the number of changes still
 * waiting. Background sync starts here (see syncEngine.startAutoSync); a click
 * runs a pass immediately.
 */
export default function SyncStatus() {
  const state = useSyncStatus();
  const nav = useNavigate();
  const needsSignIn = state.status === 'auth_required';

  useEffect(() => {
    const stop = startAutoSync();
    return () => { stop && stop(); };
  }, []);

  const d = describeStatus(state);

  return (
    <button
      type="button"
      data-testid="sync-status-btn"
      data-status={state.status}
      onClick={() => (needsSignIn ? nav('/login') : kickSync())}
      title={needsSignIn ? 'Sign in to the Main Server to send the waiting changes' : (state.lastError || 'Click to check the Main Server now')}
      className="w-full flex items-start gap-2 px-2 py-1.5 text-[13px] text-slate-300 hover:text-white hover:bg-slate-800 rounded mb-0.5"
    >
      <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${DOT[d.tone]}`} aria-hidden="true" />
      <span className="flex-1 text-left min-w-0">
        <span className={`block leading-tight font-medium ${TITLE_CLASS[d.tone]}`} data-testid="sync-status-title">{d.title}</span>
        <span className="block text-[10px] text-slate-500 leading-tight truncate" data-testid="sync-status-detail">{d.detail}</span>
      </span>
    </button>
  );
}
