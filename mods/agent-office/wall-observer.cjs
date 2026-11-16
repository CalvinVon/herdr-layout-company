const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { makeUrlQR } = require('./link-qr.cjs');

const source = fs.readFileSync(path.join(__dirname, 'wall-services.js'), 'utf8').replace(/^export /gm, '');
const { extractTerminalQR, extractService } = new Function(source + '\nreturn {extractTerminalQR, extractService};')();
const [address, history = '200'] = process.argv.slice(2);
if (!address || !/^\d+$/.test(history)) throw new Error('Invalid terminal observation arguments');

function observe() {
  return new Promise((resolve, reject) => {
    const child = spawn('hc', ['attach', '--observe', '--history', history, address], { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    let size = 0, truncated = false;
    const timer = setTimeout(() => child.kill(), 1200);
    child.stdout.on('data', chunk => {
      const remaining = 2 * 1024 * 1024 - size;
      if (chunk.length > remaining) truncated = true;
      if (remaining > 0) { chunks.push(chunk.subarray(0, remaining)); size += Math.min(chunk.length, remaining); }
      if (truncated) child.kill();
    });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', () => { clearTimeout(timer); resolve({ qr: extractTerminalQR(Buffer.concat(chunks).toString('utf8')), truncated }); });
  });
}

Promise.all([
  promisify(execFile)('hc', ['read', address, '--json', '--lines', history], { timeout: 20000, maxBuffer: 8 * 1024 * 1024 }),
  observe(),
]).then(([snapshot, observed]) => {
  const data = JSON.parse(snapshot.stdout);
  const parsed = extractService(data.text ?? '');
  const generated = observed.qr ? null : makeUrlQR(parsed?.urls);
  process.stdout.write(JSON.stringify({ parsed, qr: observed.qr ?? generated?.qr ?? null, ...(observed.qr ? { qrKind: 'terminal' } : generated ? { qrKind: 'generated', qrUrl: generated.url } : {}), complete: data.complete === true && !observed.truncated }));
}).catch(error => { console.error(error.message); process.exitCode = 1; });
