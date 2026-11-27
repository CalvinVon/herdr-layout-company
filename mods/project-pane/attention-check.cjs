const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(process.argv[2] || path.join(__dirname, 'main.js'), 'utf8').replace(/^import .*;\n/gm, '').replace('export default class Pane', 'class Pane');
function element() {
  const node = { attrs: {}, children: [] };
  let view;
  view = new Proxy(node, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === 'when') { if (args[0]) args[1](view); }
      else if (key === 'child') target.children.push(args[0]);
      else if (key === 'children') target.children.push(...args[0]);
      else target.attrs[key] = args;
      return view;
    };
  } });
  return view;
}
const pane = { pane: 'p1', terminal: 't1', title: 'Review pending', program: { agent: true, name: 'Agent' } };
let colors, windowActive = true;
let modProps = { pane: 'p1' };
const commands = [];
const api = {
  View: class {}, div: element, svg: element, image: element, h_flex: element, v_flex: element,
  panes: () => [pane], terminals: () => [{ address: 't1', state: 'live' }], spaces: () => [],
  props: () => modProps, theme: () => colors, home: () => '/home', shared: () => null,
  globalThis: { window: { is_window_active: () => windowActive } },
  run(command, args) { commands.push({ command, args }); }, openOverlay() {}, closeOverlay() {}, setShared() {}, notify() {},
};
const Pane = new Function(...Object.keys(api), `${source}\nreturn Pane;`)(...Object.values(api));
const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join(' ');
const byId = (node, id) => node?.attrs?.id?.[0] === id ? node : (node?.children || []).map(child => byId(child, id)).find(Boolean);
const nodes = node => typeof node === 'object' && node ? [node, ...node.children.flatMap(nodes)] : [];
for (const light of [false, true]) {
  colors = { foreground: light ? '#202020' : '#eeeeee', chrome: light ? '#f4f4f4' : '#252525', background: light ? '#ffffff' : '#171717', border: '#777777', dim: '#888888', muted: '#657080', accent: '#4488ff', working: '#4488ff', done: '#44aa66', blocked: light ? '#c4511a' : '#f97316', surface: light ? '#f6f7f9' : '#202020' };
  const timers = [];
  let notifications = 0;
  const cx = { notify() { notifications++; }, timer: { every(ms, callback) { timers.push({ ms, callback }); } } };
  const view = new Pane();
  view.init(undefined, cx);
  let root = view.render(cx);
  root.attrs.on_size_change[0]({ width: 420, height: 34 }, cx);
  for (const focused of [false, true]) {
    pane.focused = focused;
    for (const [status, label, color] of [['working', '运行中', colors.working], ['blocked', '待交互', colors.blocked], ['done', 'Done', colors.done], ['idle', 'idle', colors.dim], [undefined, null, null]]) {
      pane.status = status;
      root = view.render(cx);
      assert.equal(root.attrs.border_l, undefined);
      assert.equal(root.attrs.border_b[0], 1, 'all activity states retain a neutral fine divider');
      assert.equal(root.attrs.border_color[0], focused ? colors.border : colors.chrome);
      if (status === 'idle') assert.equal(root.attrs.bg, undefined, 'idle headers stay transparent even when focused');
      else assert.equal(root.attrs.bg[0], status === 'blocked' ? `${colors.blocked}12` : status === 'working' ? `${colors.working}0d` : focused ? light ? colors.surface : colors.background : colors.chrome);
      const signal = byId(root, 'pane-signal-p1');
      if (label) {
        assert.equal(signal.attrs.accessibility_label[0], label, 'compact signals remain understandable through accessibility and tooltips');
        assert.equal(signal.attrs.tooltip[0], label);
        assert.equal(signal.attrs.text_color[0], color);
      } else assert.equal(signal, undefined, 'ordinary shells keep their program icon');
      if (status === 'blocked') assert.ok(text(signal).includes('!'));
      if (status === 'done') assert.ok(text(signal).includes('✓'));
      const animations = nodes(root).filter(node => node.attrs.loop || node.attrs.spin || node.attrs.frames);
      assert.equal(animations.length, status === 'working' || status === 'blocked' ? 1 : 0, 'working and blocked panes each use one native effect; idle/done never loop');
      if (status === 'working') {
        assert.equal(animations[0], byId(root, 'pane-sweep-p1'));
        assert.equal(animations[0].attrs.loop[0], 'left');
        assert.equal(animations[0].attrs.loop[1].period, 8000);
        const dot = byId(root, 'pane-working-dot-p1');
        assert.equal(dot.attrs.size[0], 10, 'the solid working signal is larger than the idle outline');
        assert.equal(dot.attrs.bg[0], colors.working);
      } else {
        assert.equal(byId(root, 'pane-working-dot-p1'), undefined, 'leaving working removes its solid signal');
      }
      if (status === 'blocked') {
        const attention = byId(root, 'pane-attention-p1');
        assert.equal(animations[0], attention);
        assert.equal(attention.attrs.loop[0], 'opacity');
        assert.equal(attention.attrs.loop[1].period, 2000);
        assert.equal(attention.attrs.bg[0], colors.blocked);
        assert.equal(root.attrs.opacity, undefined, 'only the backdrop breathes; text never fades');
      }
      assert.equal(byId(root, 'pane-activity-p1'), undefined, 'the old right-hand badge is removed');
      const title = root.children.find(node => text(node) === 'Review pending');
      assert.equal(title.attrs.flex_1, undefined, 'titles do not reserve a share of the row and leave an artificial gap before the folder');
      assert.equal(title.attrs.flex_shrink[0], 1, 'titles still shrink in narrow splits');
      assert.equal(title.attrs.min_w[0], 0);
      assert.equal(title.attrs.text_color[0], status === 'working' ? colors.working : status === 'idle' && !focused ? `${colors.muted}e6` : colors.foreground);
      assert.equal(byId(root, 'copy-pane-id-p1').attrs.text_color[0], status === 'idle' && !focused ? colors.dim : colors.working);
      if (status === 'blocked' || status === 'working') assert.ok(title.attrs.font_semibold);
    }
  }
  assert.equal(timers.length, 1, 'the existing lifecycle check is reused without adding animation timers');
  assert.equal(timers[0].ms, 1000);
  const tick = () => timers[0].callback(cx);
  pane.status = 'working';
  tick(); notifications = 0;
  for (let i = 0; i < 50; i++) tick();
  assert.equal(notifications, 0, 'stable lifecycle checks never invalidate the header');
  windowActive = false; tick();
  assert.equal(notifications, 1, 'deactivation invalidates only once to remove the native animation');
  assert.equal(byId(view.render(cx), 'pane-sweep-p1'), undefined);
  pane.status = 'blocked';
  assert.equal(byId(view.render(cx), 'pane-attention-p1'), undefined, 'the waiting effect also stops when the window is inactive');
  pane.status = 'working';
  for (let i = 0; i < 50; i++) tick();
  assert.equal(notifications, 1, 'background checks do not schedule redraws');
  windowActive = true; tick();
  root = view.render(cx);
  assert.ok(byId(root, 'pane-sweep-p1'), 'returning to the window restores the working sweep');
  notifications = 0;
  root.attrs.on_size_change[0]({ width: 420, height: 34 }, cx);
  assert.equal(notifications, 0, 'unchanged sizes do not invalidate the header');
  root.attrs.on_size_change[0]({ width: 240, height: 34 }, cx);
  assert.equal(notifications, 1);
  assert.equal(byId(view.render(cx), 'pane-sweep-p1').attrs.loop[1].to, 240, 'the sweep stays inside a resized header');
  modProps = { moveMenu: true };
  new Pane().init(undefined, { ...cx, focus_handle: () => ({ focus() {} }) });
  assert.equal(timers.length, 1, 'move menus do not start header lifecycle checks');
  modProps = { pane: 'p1' };
  pane.status = 'blocked'; pane.zoomed = false;
  assert.equal(byId(view.render(cx), 'ph-z-p1'), undefined, 'the maximize action is revealed by hover');
  view.render(cx).attrs.on_hover[0](true, cx);
  let maximize = byId(view.render(cx), 'ph-z-p1');
  assert.ok(text(maximize).includes('最大化'));
  assert.equal(maximize.attrs.accessibility_label[0], '最大化分屏');
  let stopped = false;
  maximize.attrs.on_click[0]({}, { stop_propagation() { stopped = true; } });
  assert.equal(stopped, true, 'maximizing does not also trigger the pane header click');
  assert.deepEqual(commands.pop(), { command: 'pane.zoom', args: { pane: 'p1' } });
  pane.zoomed = true;
  maximize = byId(view.render(cx), 'ph-z-p1');
  assert.ok(text(maximize).includes('还原'));
  maximize.attrs.on_click[0]({}, { stop_propagation() {} });
  assert.deepEqual(commands.pop(), { command: 'pane.zoom', args: { pane: 'p1' } });
  view.render(cx).attrs.on_hover[0](false, cx);
  assert.equal(byId(view.render(cx), 'ph-z-p1'), undefined, 'leaving the title bar hides its actions');
}
console.log('A+D pane checks passed: compact signals, light/dark, neutral borders, one native sweep, idle/done recovery, resize, background pause and no stable polling redraws.');
