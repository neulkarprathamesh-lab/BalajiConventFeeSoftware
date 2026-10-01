/**
 * paths.js — defensive path validation for update payloads.
 *
 * Rejects any relative path that could escape the intended sandbox:
 *   - absolute paths (/etc/passwd, C:\Windows\..., \\server\share)
 *   - drive-letter paths (C:foo, D:\bar)
 *   - UNC paths (\\host\share)
 *   - parent traversal (../, ..\)
 *   - null bytes and other control characters
 *   - reserved Windows device names (CON, PRN, AUX, NUL, COM1..9, LPT1..9)
 *
 * Every path that ships to the update helper flows through isSafeRelative()
 * BEFORE any filesystem I/O. Backend also re-validates via its own
 * updates.py::_validate_payload_paths - defense in depth.
 */

const RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

function isSafeRelative(p) {
  if (typeof p !== 'string') return false;
  if (p.length === 0 || p.length > 4096) return false;
  // Reject null / control chars
  if (/[\x00-\x1f]/.test(p)) return false;
  // Normalise separators for inspection (but the caller should keep whatever
  // separator the manifest used; we only care about safety).
  const norm = p.replace(/\\/g, '/');
  // Reject absolute POSIX paths
  if (norm.startsWith('/')) return false;
  // Reject drive letters (C:, C:/, C:\)
  if (/^[a-zA-Z]:/.test(norm)) return false;
  // Reject UNC \\host\share
  if (p.startsWith('\\\\') || norm.startsWith('//')) return false;
  // Reject parent traversal in any segment
  const segs = norm.split('/');
  for (const s of segs) {
    if (s === '' && segs.length > 1) continue; // tolerate trailing '/'
    if (s === '..' || s === '.') return false;
    // Windows reserved device names (case-insensitive, ignoring extension)
    const base = s.split('.')[0].toUpperCase();
    if (RESERVED.has(base)) return false;
    // Trailing spaces / dots on Windows are unsafe
    if (/[ .]$/.test(s)) return false;
  }
  return true;
}

module.exports = { isSafeRelative };
