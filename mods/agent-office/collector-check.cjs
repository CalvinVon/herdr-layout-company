const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
function load(file, env) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const names = [...source.matchAll(/^export (?:const|function|class) (\w+)/gm)].map(match => match[1]);
  const main = source.match(/export default class (\w+)/)?.[1];
  const body = source.replace(/^import .*;\n/gm, '').replace(/export default class /, 'class ').replace(/^export /gm, '');
  return new Function(...Object.keys(env), body + '\nreturn {' + names.join(',') + (main ? `${names.length ? ',' : ''}default:${main}` : '') + '};')(...Object.values(env));
}
const model = load('projects.js', {}), S = load('wall-services.js', {});
const room = { id: 'room-a', projectKey: 'local:a', machine: null, members: [{ terminal: 't1', pane: 'p1', tab: 'tab1' }, { terminal: 't2', pane: 'p2', tab: 'tab1' }, { terminal: 't3', pane: 'p3', tab: 'tab1' }] };
const agent = { address: 't1', pane: 'p1', tab: 'tab1', title: 'π > 完成黑板', status: 'working', app: 'omp' };
const secondAgent = { ...agent, address: 't3', pane: 'p3', title: '第二个会话' };
let focus = { terminal: 't1', pane: 'p1', tab: 'tab1' };
const service = { address: 't2', state: 'live', foreground: { name: 'node', pid: 44, argv: ['npm run serve:web'] } };
let publications = [{ id: 'agent-1', kind: 'note', name: '结论', text: '接口已确认', published: true, source: 'Agent · t1' }, { id: 'agent-2', kind: 'file', name: '报告', path: '/tmp/report.html', published: true, source: 'Agent · t1' }];
const sharedValues = { 'workspace.office-groups': [room] };
const files = new Map(), pending = [], timers = new Map();
let windowActive = true, executions = 0;
globalThis.window = { is_window_active: () => windowActive };
const cx = { notify() {}, timer: { every(ms, fn) { timers.set(ms, fn); }, after() {} }, spawn(fn) { pending.push(Promise.resolve().then(() => fn(cx))); } };
async function flush() { while (pending.length) await Promise.all(pending.splice(0)); }
const env = { ...model, S, View: class {}, div() {}, svg() {}, A: {}, T: {}, D: {},
  agents: () => [agent, secondAgent], terminals: () => [service, { address: 't1', foreground: { pid: 77 } }, { address: 't3', foreground: { pid: 88 } }], spaces: () => [], panes: () => [], machines: () => [{ name: null, layout: 'ready' }],
  focused: () => focus, shared: key => sharedValues[key], setShared: (key, value) => { sharedValues[key] = value; },
  appHome: () => '/app', readTextFile: async file => files.get(file) ?? null,
  writeTextFile: async (file, text, expected) => { if ((files.get(file) ?? null) !== expected) throw Error('stale'); files.set(file, text); },
  exec: async (command, args) => {
    executions++;
    if (command === 'mktemp') return { code: 0, stdout: '/tmp/wall-test\n' };
    if (args?.[1] === 'list') return { code: 0, stdout: JSON.stringify({ rooms: { 'local:a': publications } }) };
    if (args?.[1] === 'remove') { publications = publications.filter(card => card.id !== args[5]); return { code: 0, stdout: '' }; }
    if (args?.[0]?.endsWith('session-goal.cjs')) return { code: 0, stdout: JSON.stringify({ text: args[1] === '88' ? '第二个请求' : '优先恢复二维码', todo: args[1] === '88' ? [] : [{ text: '恢复二维码', status: 'in_progress' }, { text: '验证展示', status: 'pending' }] }) };
    if (args?.[0]?.endsWith('wall-observer.cjs')) return { code: 0, stdout: JSON.stringify({ parsed: { urls: ['http://localhost:8081/'] }, qr: Array.from({ length: 21 }, () => Array(21).fill(true)), qrKind: 'generated', qrUrl: 'http://localhost:8081/', complete: true }) };
    throw Error('unexpected command');
  }, run() {}, openOverlay() {}, fetch: async () => ({ ok: false }) };
env.VirtualListScrollHandle = { new: () => ({ scroll_to_item() {} }) };
const Office = load('main.js', env).default;
(async () => {
  const office = new Office(); office.init({}, cx); await flush();
  let snapshot = JSON.parse(files.get('/tmp/wall-test/services.json'))['local:a'];
  assert.ok(snapshot.some(card => card.kind === 'goal' && card.text === '优先恢复二维码' && card.source === '当前请求'));
  assert.equal(snapshot[0].kind, 'goal');
  assert.deepEqual(snapshot[0].tasks, [{ text: '恢复二维码', status: 'in_progress' }, { text: '验证展示', status: 'pending' }]);
  assert.ok(snapshot.some(card => card.kind === 'note' && card.text === '接口已确认'));
  assert.ok(snapshot.some(card => card.kind === 'file' && card.path === '/tmp/report.html'));
  assert.ok(snapshot.some(card => card.id === 't2' && card.qrKind === 'generated' && card.qr.length === 21));
  timers.get(500)(cx); await flush();
  const activeExecutions = executions;
  windowActive = false;
  timers.get(2000)(cx); await flush();
  timers.get(2000)(cx); await flush();
  assert.equal(executions, activeExecutions, 'inactive routine ticks must not launch collector subprocesses');
  windowActive = true;
  timers.get(500)(cx); await flush();
  assert.ok(executions > activeExecutions, 'reactivation refreshes even when the terminal focus is unchanged');
  const resumedExecutions = executions;
  timers.get(500)(cx); await flush();
  assert.equal(executions, resumedExecutions, 'active focus checks must not repeatedly collect unchanged state');
  focus = { terminal: 't3', pane: 'p3', tab: 'tab1' };
  timers.get(500)(cx);
  assert.equal(office.wallGoal, null);
  await flush();
  snapshot = JSON.parse(files.get('/tmp/wall-test/services.json'))['local:a'];
  assert.ok(snapshot.some(card => card.id === 'goal:t3' && card.text === '第二个请求'));
  assert.equal(snapshot.some(card => card.id === 'goal:t1'), false);
  focus = {};
  timers.get(500)(cx);
  assert.equal(office.wallGoal.card.id, 'goal:t3');
  focus = { terminal: 't1', pane: 'p1', tab: 'tab1' };
  timers.get(500)(cx); await flush();
  sharedValues['office-wall.remove-request'] = { token: 1, roomKey: 'local:a', id: 'agent-1' };
  office.refreshWall(cx); await flush();
  snapshot = JSON.parse(files.get('/tmp/wall-test/services.json'))['local:a'];
  assert.equal(snapshot.some(card => card.id === 'agent-1'), false);
  assert.equal(snapshot.some(card => card.id === 'agent-2'), true);
  sharedValues['office-wall.remove-request'] = { token: 2, roomKey: 'local:a', id: 'goal:t1' };
  office.refreshWall(cx); await flush();
  snapshot = JSON.parse(files.get('/tmp/wall-test/services.json'))['local:a'];
  assert.equal(snapshot.some(card => card.id === 'goal:t1'), false);
  console.log('Collector goal, agent publication, QR and removal integration checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
