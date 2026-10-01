/**
 * auth-utils.js - pure logic for the updater's authentication and
 * checksum-verification steps. Deliberately has ZERO dependency on
 * `electron` (unlike updater.js) so it can be unit-tested with plain
 * `node`, the same way version-compare.js is.
 */

/**
 * Parses a response from the EXISTING /api/auth/login endpoint (see
 * backend/routers/auth.py). Returns { ok, token, user } on success or
 * { ok: false, error } otherwise. Never throws.
 */
function parseAuthResponse(statusCode, bodyText) {
  let parsed = null;
  try { parsed = bodyText ? JSON.parse(bodyText) : {}; } catch (_) { /* fall through */ }
  if (statusCode !== 200) {
    const detail = parsed && typeof parsed.detail === 'string' ? parsed.detail : `HTTP ${statusCode}`;
    return { ok: false, error: detail };
  }
  if (!parsed || !parsed.token || !parsed.user) {
    return { ok: false, error: 'Login response missing token/user.' };
  }
  return { ok: true, token: parsed.token, user: parsed.user };
}

function isAdminUser(user) {
  return !!(user && user.role === 'administrator');
}

// SHA256SUMS.txt lines look like: "<64-hex-hash>  <filename>    (<n> bytes)"
function parseSha256Sums(text, filename) {
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([0-9a-f]{64})\s+(\S+)/i);
    if (m && m[2] === filename) return m[1].toLowerCase();
  }
  return null;
}

module.exports = { parseAuthResponse, isAdminUser, parseSha256Sums };
