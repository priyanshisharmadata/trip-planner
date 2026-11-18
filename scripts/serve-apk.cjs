const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const port = 8787;
const apkPath = path.resolve(__dirname, '../artifacts/roam-trip-planner.apk');
const downloadRoute = '/roam-trip-planner.apk';

function respond(req, res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    respond(req, res, 405, 'Use GET or HEAD.', undefined, { Allow: 'GET, HEAD' });
    return;
  }
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    respond(req, res, 400, 'Invalid request.');
    return;
  }
  // Only these two exact routes exist; request paths never select a filesystem path.
  if (pathname !== '/' && pathname !== downloadRoute) {
    respond(req, res, 404, 'Not found.');
    return;
  }
  let stat;
  try {
    stat = await fs.promises.stat(apkPath);
    if (!stat.isFile() || stat.size === 0) throw new Error('APK unavailable');
  } catch {
    respond(req, res, 503, 'The Roam APK is still being prepared. Please try this link again shortly.', undefined, { 'Retry-After': '10' });
    return;
  }
  if (pathname === '/') {
    const size = (stat.size / (1024 * 1024)).toFixed(1);
    respond(req, res, 200, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Get Roam</title><style>body{font:17px system-ui;margin:0;padding:40px 24px;background:#f6f7f2;color:#1d332a}main{max-width:440px;margin:8vh auto}h1{font-size:42px;margin-bottom:12px}p{line-height:1.6;color:#52655a}a{display:block;padding:18px;border-radius:14px;background:#245c44;color:white;text-align:center;text-decoration:none;font-weight:700;margin:28px 0}small{line-height:1.7;display:block}</style><main><h1>Your next adventure.</h1><p>Roam is ready for your Android phone. Plan trips, organize your days, and save everything locally.</p><a href="${downloadRoute}">Download Roam APK · ${size} MB</a><small>Open the downloaded file to install. If Android asks, allow installation from your browser. Expo Go and a development server are not needed after installation.</small></main></html>`, 'text/html; charset=utf-8');
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': 'attachment; filename="roam-trip-planner.apk"',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(apkPath);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
});

server.on('error', (error) => {
  console.error(`APK server failed: ${error.code || error.message}`);
  process.exitCode = 1;
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Roam APK server: http://localhost:${port}/`);
  const addresses = new Set(Object.values(os.networkInterfaces()).flat().filter(Boolean)
    .filter((entry) => !entry.internal && (entry.family === 'IPv4' || entry.family === 4))
    .map((entry) => entry.address)
    .filter((address) => /^10\./.test(address) || /^192\.168\./.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address)));
  for (const address of addresses) {
    console.log(`Phone download (same network): http://${address}:${port}${downloadRoute}`);
  }
  if (!addresses.size) console.log('No private IPv4 address found. Connect this computer and phone to the same network.');
  console.log('Only the Roam APK and its download page are served. Missing APK requests return HTTP 503.');
});
