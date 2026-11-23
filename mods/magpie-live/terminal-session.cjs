const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const UUID = /^[0-9a-f-]{36}$/i;

function resolveSession(pid, cwd, { run = execFileSync, read = fs.readFileSync, home = os.homedir(), env = process.env } = {}, title = '') {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  // Claude publishes the current session even when its transcript is closed.
  try {
    const entry = JSON.parse(read(path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'sessions', `${pid}.json`), 'utf8'));
    if (entry.pid === pid && UUID.test(entry.sessionId) && (!cwd || entry.cwd === cwd)) return entry.sessionId;
  } catch {}
  const processes = run('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' });
  const byTitle = (candidates) => {
    if (!title || !cwd) return null;
    let database;
    try {
      const { DatabaseSync } = require('node:sqlite');
      database = new DatabaseSync(path.join(env.CODEX_HOME || path.join(home, '.codex'), 'state_5.sqlite'), { readOnly: true });
      const rows = database.prepare('SELECT id FROM threads WHERE cwd = ? AND title = ? AND archived = 0').all(cwd, title);
      const matches = rows.filter(row => UUID.test(row.id) && (!candidates || candidates.has(row.id)));
      return matches.length === 1 ? matches[0].id : null;
    } catch { return null; } finally { database?.close(); }
  };
  let level = [pid];
  const visited = new Set();
  while (level.length) {
    const ids = new Set();
    for (const current of level) {
      visited.add(current);
      let files;
      try { files = run('/usr/sbin/lsof', ['-Fn', '-p', String(current)], { encoding: 'utf8' }); }
      catch (error) { files = error.stdout || ''; }
      for (const line of String(files).split('\n')) {
        const owner = line.match(/\/session-owners\/([0-9a-f-]{36})\.lock$/i);
        if (owner) ids.add(owner[1]);
        if (!/\/sessions\/.*[0-9a-f-]{36}\.jsonl$/i.test(line)) continue;
        // Resumed Codex filenames can contain the old ID. The header is authoritative.
        let fd;
        try {
          fd = fs.openSync(line.slice(1), 'r');
          const buffer = Buffer.alloc(65536);
          const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
          const entry = JSON.parse(buffer.toString('utf8', 0, length).split('\n')[0]);
          const header = entry.type === 'session_meta' ? entry.payload : entry;
          if (UUID.test(header?.id) && (!cwd || header.cwd === cwd)) ids.add(header.id);
        } catch {} finally { if (fd !== undefined) fs.closeSync(fd); }
      }
    }
    if (ids.size) return ids.size === 1 ? [...ids][0] : byTitle(ids);
    level = processes.trim().split('\n').flatMap(line => {
      const [child, parent] = line.trim().split(/\s+/).map(Number);
      return level.includes(parent) && !visited.has(child) ? [child] : [];
    });
  }
  return byTitle();
}
module.exports = { resolveSession };
if (require.main === module) {
  try { const id = resolveSession(Number(process.argv[2]), process.argv[3], undefined, process.argv[4]); if (id) console.log(id); }
  catch { process.exitCode = 1; }
}
