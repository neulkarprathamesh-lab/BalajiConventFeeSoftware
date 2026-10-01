/**
 * version-compare.js — proper semver-aware version comparison.
 *
 * Handles:
 *   - 1.0.10 > 1.0.9    (numeric compare, NOT string compare)
 *   - 2.0.0 > 1.99.99
 *   - 1.0.0-rc.1 < 1.0.0
 *   - 1.0.0-alpha.2 > 1.0.0-alpha.1
 *   - null / undefined / malformed -> treated as 0.0.0
 *
 * Returns:
 *   compare(a, b) -> -1 if a<b, 0 if equal, 1 if a>b
 *   gt(a, b)      -> a > b
 *   isUpgrade(installed, remote) -> true iff remote is a strict upgrade
 *
 * Zero external dependencies so it works on any Node runtime.
 */

function parse(v) {
  if (typeof v !== 'string') return { core: [0, 0, 0], pre: null };
  const cleaned = v.trim().replace(/^v/, '');
  const [coreStr, preStr] = cleaned.split('-', 2);
  const parts = coreStr.split('.').map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  while (parts.length < 3) parts.push(0);
  return { core: parts.slice(0, 3), pre: preStr || null };
}

function comparePre(a, b) {
  // Absence of prerelease > presence (per semver: 1.0.0 > 1.0.0-rc.1)
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const aa = a.split('.');
  const bb = b.split('.');
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i++) {
    const av = aa[i];
    const bv = bb[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    const an = /^\d+$/.test(av) ? parseInt(av, 10) : null;
    const bn = /^\d+$/.test(bv) ? parseInt(bv, 10) : null;
    if (an !== null && bn !== null) {
      if (an !== bn) return an < bn ? -1 : 1;
    } else if (an !== null) {
      return -1; // numeric identifiers always have lower precedence
    } else if (bn !== null) {
      return 1;
    } else {
      if (av !== bv) return av < bv ? -1 : 1;
    }
  }
  return 0;
}

function compare(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  return comparePre(pa.pre, pb.pre);
}

function gt(a, b) { return compare(a, b) === 1; }
function isUpgrade(installed, remote) { return compare(remote, installed) === 1; }

module.exports = { parse, compare, gt, isUpgrade };
