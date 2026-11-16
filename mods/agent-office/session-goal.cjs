const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function latestRequest(rows) {
  const records = new Map(rows.filter(row => row && typeof row.id === 'string').map(row => [row.id, row]));
  const leaf = [...rows].reverse().find(row => row?.type === 'message' && typeof row.id === 'string' && ['user', 'assistant'].includes(row.message?.role));
  const visited = new Set();
  let row = leaf;
  while (row && !visited.has(row.id)) {
    visited.add(row.id);
    if (row.type === 'message' && row.message?.role === 'user') {
      const content = row.message.content;
      const parts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text) : [];
      const text = parts.join(' ').replace(/<system-(?:notice|reminder)>[\s\S]*?<\/system-(?:notice|reminder)>/g, ' ').replace(/<\/?[a-z][^>]*>/gi, ' ').replace(/\[Image #\d+(?:,[^\]]*)?\]/g, ' ').replace(/\s+/g, ' ').trim();
      if (text) return [...text].slice(0, 180).join('');
    }
    row = records.get(row.parentId);
  }
  return null;
}

function latestTodo(rows) {
  const records = new Map(rows.filter(row => row && typeof row.id === 'string').map(row => [row.id, row]));
  const leaf = [...rows].reverse().find(row => row?.type === 'message' && typeof row.id === 'string' && ['user', 'assistant'].includes(row.message?.role));
  const visited = new Set();
  let row = leaf;
  while (row && !visited.has(row.id)) {
    visited.add(row.id);
    const details = row.message?.toolName === 'todo' ? row.message?.details : null;
    if (Array.isArray(details?.phases)) return details.phases.flatMap(phase => (phase.tasks ?? []).map(task => ({ text: task.content, status: task.status === 'completed' ? 'done' : task.status })));
    row = records.get(row.parentId);
  }
  return [];
}

function readTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, start = Math.max(0, size - 2 * 1024 * 1024), buffer = Buffer.alloc(size - start);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.subarray(0, bytes).toString('utf8').split('\n');
    if (start) lines.shift();
    return lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  } finally { fs.closeSync(fd); }
}

function currentRequest(pid) {
  if (!/^\d+$/.test(pid)) throw new Error('Invalid process id');
  const root = fs.realpathSync(path.join(os.homedir(), '.omp', 'agent', 'sessions')) + path.sep;
  const output = execFileSync('/usr/sbin/lsof', ['-Fn', '-p', pid], { encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
  const files = [...new Set(output.split('\n').filter(line => line.startsWith('n') && line.endsWith('.jsonl')).flatMap(line => {
    try { const file = fs.realpathSync(line.slice(1)); return file.startsWith(root) ? [file] : []; } catch { return []; }
  }))];
  if (files.length !== 1) return null;
  const rows = readTail(files[0]);
  return { text: latestRequest(rows), todo: latestTodo(rows) };
}

module.exports = { latestRequest, latestTodo };
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(currentRequest(process.argv[2] ?? ''))); }
  catch { process.stdout.write(JSON.stringify({ text: null, todo: [] })); }
}
