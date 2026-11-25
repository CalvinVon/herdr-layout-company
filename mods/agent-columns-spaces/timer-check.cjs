const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8').replace(/^import .*;\n/gm, '').replace('export default class ', 'class ');
const element = () => ({ child() { return this; } });
const RetainedParts = new Function('View', 'div', `${fs.readFileSync(path.join(__dirname, 'retained-parts.js'), 'utf8').replace(/^import .*;\n/gm, '').replace('export class ', 'class ')}\nreturn RetainedParts;`)(class {}, element);

for (const floating of [false, true]) for (const active of [false, true]) for (const hidden of [false, true]) {
  const state = { active, hidden };
  let notifications = 0, focusChecks = 0;
  const childNotifications = [];
  const timers = new Map(), delayed = [];
  globalThis.window = { is_window_active: () => state.active };
  const api = {
    View: class {}, RetainedParts, props: () => floating ? { overlay: 'drawer' } : {}, placement: () => null,
    blockCollapsed: () => false, spaces: () => [{ id: 'space' }],
    layout: () => ({ children: [{ id: 'sidebar', hidden: state.hidden }] }),
  };
  const Spaces = new Function(...Object.keys(api), `${source}\nreturn SpacesTabs;`)(...Object.values(api));
  const cx = {
    notify(target) { if (target) childNotifications.push(target); else notifications++; }, spawn() {},
    new(Part, props) { const view = new Part(); view.init(props); return { view, release() {} }; },
    timer: { every(ms, callback) { timers.set(ms, callback); }, after(ms, callback) { delayed.push({ ms, callback }); } },
    focus_handle: () => ({ is_focused() { focusChecks++; return false; }, release() {} }),
  };
  const sidebar = new Spaces(); sidebar.init({}, cx); sidebar.hasWorking = true;
  sidebar.parts.begin('stable');
  for (const kind of ['body', 'pulse', 'time', 'sweep']) sidebar.parts.element(kind, kind, () => element());
  sidebar.parts.sync(cx);
  sidebar.parts.mounted('sweep', sidebar.parts.entries.get('sweep').mountToken, cx);
  notifications = 0; focusChecks = 0; childNotifications.length = 0;
  timers.get(1000)(cx); timers.get(5700)(cx);
  const shouldRun = active && (floating || !hidden);
  assert.equal(focusChecks > 0, shouldRun, `focus checks: floating=${floating}, active=${active}, hidden=${hidden}`);
  assert.equal(notifications, 0, `animation timers must not rebuild the sidebar: floating=${floating}, active=${active}, hidden=${hidden}`);
  const kindOf = handle => [...sidebar.parts.entries.values()].find(entry => entry.handle === handle).kind;
  assert.deepEqual(childNotifications.map(kindOf), shouldRun ? ['time', 'sweep'] : []);
  assert.deepEqual(delayed.map(item => item.ms), shouldRun ? [60, 1660, 3260] : []);
  if (shouldRun) {
    for (const { callback } of delayed) callback(cx);
    assert.deepEqual(childNotifications.map(kindOf), ['time', 'sweep', 'sweep', 'sweep', 'sweep']);
    assert.equal(sidebar.sweepPhase, 3);
    assert.equal(notifications, 0, 'delayed sweeps must notify only retained sweep children');
    timers.get(60000)(cx);
    assert.equal(notifications, 1, 'a quiet working row must not suppress the visible minute refresh');
  }
  state.active = false;
  const before = notifications, childrenBefore = childNotifications.length;
  for (const { callback } of delayed) callback(cx);
  assert.equal(childNotifications.length, childrenBefore, 'scheduled sweeps must stop when the app becomes inactive');
  assert.equal(notifications, before, 'sweep callbacks scheduled while visible must stop when the app becomes inactive');
  sidebar.hasWorking = false;
  timers.get(60000)(cx);
  assert.equal(notifications, before, 'inactive idle sidebars must not repaint on the minute timer');
  state.active = true;
  timers.get(60000)(cx);
  assert.equal(notifications, before + Number(floating || !hidden), 'visible idle sidebars retain the minute refresh');
}
console.log('Sidebar timers passed: fixed/drawer visibility, inactive windows, child-only elapsed/sweep notifications and unchanged phase timing.');
