// Temporary static server for previewing the receipt-redesign build only.
// Serves build-preview/ with SPA fallback. Not part of the app; safe to delete.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'build-preview');
const PORT = process.env.PORT || 3099;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json',
};

const SAVE_DIR = path.join(__dirname, 'preview-captures');
if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR);

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/_save')) {
    const name = new URL(req.url, 'http://x').searchParams.get('name') || 'capture.png';
    const out = path.join(SAVE_DIR, name.replace(/[^\w.-]/g, '_'));
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      fs.writeFileSync(out, Buffer.concat(chunks));
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('saved:' + out);
    });
    return;
  }
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.join(ROOT, reqPath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) filePath = path.join(ROOT, 'index.html');
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}).listen(PORT, () => console.log(`preview server on :${PORT}`));
