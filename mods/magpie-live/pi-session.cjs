const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const [cwd, title] = process.argv.slice(2);
const root = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
const directory = path.join(root, 'sessions', `--${cwd.replace(/^\/+|\/+$/g, '').replace(/\//g, '-')}--`);
const matches = [];
try {
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith('.jsonl')) continue;
    const lines = fs.readFileSync(path.join(directory, name), 'utf8').split('\n');
    let header, latest;
    for (const line of lines) {
      if (line.includes('"type":"session"') || line.includes('"type":"session_info"')) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'session') header = entry;
          else if (entry.type === 'session_info') latest = entry.name;
        } catch {}
      }
    }
    if (header?.cwd === cwd && latest === title && /^[0-9a-f-]{36}$/i.test(header.id)) matches.push(header.id);
  }
} catch {}
if (matches.length === 1) console.log(matches[0]);
