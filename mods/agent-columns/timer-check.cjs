const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8').replace(/^import .*;\n/gm, '').replace('export default class ', 'class ');
for (const floating of [false, true]) for (const active of [false, true]) for (const hidden of [false, true]) for (const collapsed of [false, true]) for (const role of [undefined, 'header']) {
  let polls = 0, scans = 0, redraws = 0;
  const timers = new Map();
  const api = {
    View: class {}, InputState: { new: () => ({ on() {} }) },
    props: () => ({ role, ...(floating ? { overlay: 'drawer' } : {}) }),
    terminals: () => { scans++; return []; },
    spaces: () => [{ id: 'space', tabs: [{ id: 'tab' }] }], panes: () => [],
    reportedAgents: () => [{ address: 'agent', tab: 'tab', status: 'working' }],
    layout: () => ({ id: 'root', children: [{ id: 'sidebar', hidden }] }),
    blockCollapsed: () => collapsed, shared: () => undefined,
  };
  globalThis.window = { is_window_active: () => active };
  const Board = new Function(...Object.keys(api), `${source}\nreturn Board;`)(...Object.values(api));
  const board = new Board();
  board.refreshUnreported = () => { polls++; };
  board.init({}, { spawn() {}, notify() { redraws++; }, timer: { every(ms, callback) { timers.set(ms, callback); } } });
  const ownsPolls = !role && !floating;
  assert.equal(polls, ownsPolls ? 1 : 0, 'only the docked Agents instance starts fallback status polling');
  assert.equal(timers.has(2000), ownsPolls, 'drawer copies consume shared fallback status without a second poller');
  timers.get(2000)?.({});
  assert.equal(polls, ownsPolls ? 2 : 0, 'the docked owner keeps fallback data fresh even while hidden or collapsed');
  timers.get(1000)({ notify() { redraws++; } });
  const displays = !role && active && !collapsed && (floating || !hidden);
  assert.equal(scans, displays ? 1 : 0, 'hidden, collapsed and inactive displays skip agent model scans');
  assert.equal(redraws, displays ? 1 : 0, 'only an expanded visible Agents board refreshes its working durations');
}
console.log('Agents timers passed: one fallback poller, live drawer durations and no hidden/collapsed display scans.');
