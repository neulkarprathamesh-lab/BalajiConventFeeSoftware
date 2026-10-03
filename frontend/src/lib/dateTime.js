// Formats the backend-generated created_at (UTC ISO string) for display in school local time.
// Legacy or unreadable values show as a dash rather than an invented time.
const DISPLAY_TIME_ZONE = 'Asia/Kolkata';

export function formatAddedOn(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).formatToParts(d).forEach(p => { parts[p.type] = p.value; });
  return `${parts.day}-${parts.month}-${parts.year} ${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
}
