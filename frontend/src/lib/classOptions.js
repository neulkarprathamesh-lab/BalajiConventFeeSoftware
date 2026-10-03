// Shared ordering, labels and filtering for every class selector.
// Junior College streams use the app's canonical order (see Admin.js JC_STREAMS and
// backend core.JC_STREAM_CANONICAL). Legacy stream names are hidden from selectors
// exactly as the other class dropdowns already do.

export const JC_STREAM_ORDER = ['Arts', 'Commerce', 'Science', 'Bi-Focal'];
export const LEGACY_STREAMS = ['Fisheries', 'Electronics'];

const CLASS_NUMBER = /^Class\s+(\d+)$/i;

function classNumber(name) {
  const m = CLASS_NUMBER.exec((name || '').trim());
  return m ? parseInt(m[1], 10) : null;
}

function streamRank(stream) {
  if (!stream) return -1;
  const i = JC_STREAM_ORDER.indexOf(stream);
  return i >= 0 ? i : JC_STREAM_ORDER.length;
}

export function compareClasses(a, b) {
  const na = classNumber(a.name);
  const nb = classNumber(b.name);
  const aIsClass = na !== null;
  const bIsClass = nb !== null;
  if (aIsClass !== bIsClass) return aIsClass ? 1 : -1; // named levels (KG, Nursery...) before numbered classes
  if (aIsClass && na !== nb) return na - nb;
  const byName = (a.name || '').localeCompare(b.name || '');
  if (byName) return byName;
  const byStream = streamRank(a.stream) - streamRank(b.stream);
  if (byStream) return byStream;
  return (a.medium || '').localeCompare(b.medium || '');
}

export function sortClasses(list) {
  return [...list].sort(compareClasses);
}

// Two records are the same option only when every identifying field matches.
// Such exact duplicates are collapsed; genuinely different streams/mediums are kept.
export function uniqueClasses(list) {
  const seen = new Set();
  return list.filter(c => {
    const key = [c.department_id || '', c.name || '', c.stream || '', c.medium || ''].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Label includes the stream (Junior College) or the medium when the same class name
// appears more than once in the list, so every option is distinguishable.
export function classOptionLabels(list) {
  const counts = {};
  list.forEach(c => { counts[c.name] = (counts[c.name] || 0) + 1; });
  return list.map(c => {
    let label = c.name || '';
    if (c.stream) label += ` — ${c.stream}`;
    else if (c.medium && counts[c.name] > 1) label += ` — ${c.medium}`;
    return { id: c.id, label, record: c };
  });
}

// The option list for one department: legacy streams hidden, exact duplicates removed,
// numerically ordered, and labelled.
export function buildClassOptions(classes, departmentId) {
  const inDept = classes.filter(c =>
    (!departmentId || c.department_id === departmentId) && !LEGACY_STREAMS.includes(c.stream));
  return classOptionLabels(sortClasses(uniqueClasses(inDept)));
}
