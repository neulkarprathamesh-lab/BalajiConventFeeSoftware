import { useEffect, useRef } from 'react';

// Shared "stay live while this screen is open" behavior for every screen
// that should reflect a transaction committed on ANOTHER PC without the
// user touching anything - no server-push infrastructure exists in this
// app (pure REST, see backend/routers/sync.py), so this is the same
// polling + visibility/focus/online-triggered refetch pattern first used on
// Dashboard.js, now shared so every screen that needs it behaves
// identically instead of re-implementing its own interval.
//
// `callback` is called immediately on mount is NOT assumed - callers keep
// their own initial load() (often inside a filter-dependent effect); this
// hook only adds the ongoing "keep it fresh" behavior on top.
export default function useLiveRefresh(callback, intervalMs = 10000) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const run = () => cbRef.current();
    const t = setInterval(run, intervalMs);
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', run);
    window.addEventListener('online', run);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', run);
      window.removeEventListener('online', run);
    };
  }, [intervalMs]);
}
