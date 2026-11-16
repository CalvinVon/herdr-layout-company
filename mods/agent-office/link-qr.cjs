const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'qr-encoder.js'), 'utf8').replace(/^export /m, '');
const qrcode = new Function(source + '\nreturn qrcode;')();
qrcode.stringToBytes = text => [...Buffer.from(text, 'utf8')];

function makeUrlQR(urls) {
  const candidates = [];
  for (const url of urls ?? []) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      const host = parsed.hostname.toLowerCase();
      candidates.push({ url, local: host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || /^127\./.test(host) || host === '[::1]' || host === '[::]' });
    } catch { continue; }
  }
  candidates.sort((a, b) => Number(a.local) - Number(b.local));
  for (const { url } of candidates) {
    for (let version = 1; version <= 40; version++) {
      try {
        const code = qrcode(version, 'L');
        code.addData(url);
        code.make();
        const size = code.getModuleCount();
        return { url, qr: Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => code.isDark(y, x))) };
      } catch (error) {
        if (!String(error).includes('code length overflow')) throw error;
      }
    }
  }
  return null;
}

module.exports = { makeUrlQR };
