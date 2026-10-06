/**
 * URL of a file in /public. The web build keeps root-absolute paths ("/logo.jpeg");
 * the desktop build sets PUBLIC_URL=. so the same files resolve next to the bundle
 * when the UI is opened from file://.
 */
export function publicUrl(name) {
  return `${process.env.PUBLIC_URL || ''}/${String(name).replace(/^\/+/, '')}`;
}
