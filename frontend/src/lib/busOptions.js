// Display helpers for school buses. The data comes from the Bus Master (bus_routes); this only
// orders and labels it. The common registration prefix is shown once, centrally, here.
export const BUS_DISPLAY_ORDER = ['N426', 'N1078', 'N4978', 'Y7178', 'AT478', 'BG7978', 'BL8279', 'CT5578', 'CT5778'];

const PREFIX_KEY = 'MH40';

export function normalizeRegistration(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function shortIdentifier(registrationOrCode) {
  let key = normalizeRegistration(registrationOrCode);
  if (key.startsWith(PREFIX_KEY)) key = key.slice(PREFIX_KEY.length);
  return key;
}

function busRank(bus) {
  const short = shortIdentifier(bus.vehicle_no || bus.code || bus.name);
  const i = BUS_DISPLAY_ORDER.indexOf(short);
  return i >= 0 ? i : BUS_DISPLAY_ORDER.length;
}

export function sortBuses(list) {
  return [...list].sort((a, b) => {
    const r = busRank(a) - busRank(b);
    if (r) return r;
    return shortIdentifier(a.vehicle_no || a.code).localeCompare(shortIdentifier(b.vehicle_no || b.code));
  });
}

// "N426 — MH 40 N426": short identifier first, full registration after it.
export function busLabel(bus) {
  const short = shortIdentifier(bus.vehicle_no || bus.code || bus.name);
  const full = bus.vehicle_no || '';
  return full ? `${short} — ${full}` : short;
}

export function busOptions(list) {
  return sortBuses(list).map(b => ({ id: b.id, label: busLabel(b), bus: b }));
}
