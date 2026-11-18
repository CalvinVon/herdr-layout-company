const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
  .replace(/^import .*;\n/gm, '').replace('export default class Pane', 'class Pane');
const controls = new Map();
function element() {
  const state = {};
  const proxy = new Proxy({}, { get(_target, key) {
    if (key === 'id') return value => { state.id = value; return proxy; };
    if (key === 'on_click') return fn => { if (state.id) controls.set(state.id, fn); return proxy; };
    if (key === 'when') return (condition, fn) => condition ? (fn(proxy) || proxy) : proxy;
    return () => proxy;
  }});
  return proxy;
}
const pane = { pane: 'p1', terminal: 't1', tab: 'tab1', title: '◐ π > 子 Agent 任务', program: { agent: true, name: 'Oh My Pi (OMP)' } };
const terminal = { address: 't1', state: 'live' };
const space = { id: 's1', active: true, tabs: [{ id: 'tab1', name: '父任务', named: true }] };
let overlay;
const calls = [];
const Pane = new Function('View', 'div', 'svg', 'image', 'h_flex', 'v_flex', 'panes', 'terminals', 'spaces', 'props', 'run', 'openOverlay', 'closeOverlay', 'theme', 'home', 'shared', 'setShared', 'notify', `${source}\nreturn Pane;`)(
  class {}, element, element, element, element, element,
  () => [pane, { pane: 'p2', tab: 'tab1' }], () => [terminal], () => [space], () => ({ pane: 'p1' }),
  (command, args) => calls.push({ command, args }), value => { overlay = value; }, () => {}, () => ({ dim: '#777777', muted: '#888888' }), () => '/home', () => null, () => {}, () => {},
);
const view = new Pane();
view.hovered = true;
view.render({});
let copied, stopped = false;
controls.get('copy-pane-id-p1')({}, { stop_propagation() { stopped = true; }, write_to_clipboard(value) { copied = value; } });
assert.equal(copied, 't1');
assert.equal(stopped, true, 'copying an ID does not activate the pane header');
assert.deepEqual(calls, []);
controls.get('pane-head-p1')({ click_count: 1 });
assert.deepEqual(calls.splice(0), [{ command: 'pane.focus', args: { pane: 'p1' } }]);
controls.get('pane-head-p1')({ click_count: 2 });
assert.deepEqual(calls.splice(0), [{ command: 'pane.focus', args: { pane: 'p1' } }, { command: 'pane.zoom', args: { pane: 'p1' } }]);
assert(controls.has('ph-tab-p1'), 'Agent split exposes the move action');
controls.get('ph-tab-p1')({}, { stop_propagation() {} });
assert.equal(overlay.props.name, 'π > 子 Agent 任务', 'new tab follows the moved pane rather than the parent tab');
console.log('move name check passed');
