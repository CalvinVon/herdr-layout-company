const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8').replace(/^import .*;\n/gm, '').replace('export default class ', 'class ');

for (const floating of [false, true]) for (const active of [false, true]) for (const hidden of [false, true]) {
  const state = { active, hidden };
  let notifications = 0, focusChecks = 0;
  const timers = new Map(), delayed = [];
  globalThis.window = { is_window_active: () => state.active };
  const api = {
    View: class {}, props: () => floating ? { overlay: 'drawer' } : {}, placement: () => null,
    blockCollapsed: () => false, spaces: () => [{ id: 'space' }],
    layout: () => ({ children: [{ id: 'sidebar', hidden: state.hidden }] }),
  };
  const Spaces = new Function(...Object.keys(api), `${source}\nreturn SpacesTabs;`)(...Object.values(api));
  const cx = {
    notify() { notifications++; }, spawn() {},
    timer: { every(ms, callback) { timers.set(ms, callback); }, after(_ms, callback) { delayed.push(callback); } },
    focus_handle: () => ({ is_focused() { focusChecks++; return false; }, release() {} }),
  };
  const sidebar = new Spaces(); sidebar.init({}, cx); sidebar.hasWorking = true;
  notifications = 0; focusChecks = 0;
  timers.get(1000)(cx); timers.get(5700)(cx);
  const shouldRun = active && (floating || !hidden);
  assert.equal(focusChecks > 0, shouldRun, `focus checks: floating=${floating}, active=${active}, hidden=${hidden}`);
  assert.equal(notifications > 0, shouldRun, `notifications: floating=${floating}, active=${active}, hidden=${hidden}`);
  state.active = false;
  const before = notifications;
  for (const callback of delayed) callback(cx);
  assert.equal(notifications, before, 'sweep callbacks scheduled while visible must stop when the app becomes inactive');
  sidebar.hasWorking = false;
  timers.get(60000)(cx);
  assert.equal(notifications, before, 'inactive idle sidebars must not repaint on the minute timer');
}
console.log('Sidebar timers passed: fixed/drawer visibility, inactive windows, focus checks, delayed sweeps and idle updates.');
