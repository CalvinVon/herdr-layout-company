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
let colors;
const api = {
  View: class {}, div: element, svg: element, image: element, h_flex: element, v_flex: element,
  panes: () => [pane], terminals: () => [{ address: 't1', state: 'live' }], spaces: () => [],
  props: () => ({ pane: 'p1' }), theme: () => colors, home: () => '/home', shared: () => null,
  run() {}, openOverlay() {}, closeOverlay() {}, setShared() {}, notify() {},
};
const Pane = new Function(...Object.keys(api), `${source}\nreturn Pane;`)(...Object.values(api));
const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join(' ');
for (const light of [false, true]) {
  colors = { foreground: light ? '#202020' : '#eeeeee', chrome: light ? '#f4f4f4' : '#252525', background: light ? '#ffffff' : '#171717', border: '#777777', dim: '#888888', accent: '#4488ff', working: '#4488ff', done: '#44aa66', blocked: light ? '#c4511a' : '#f97316' };
  colors.surface = light ? '#f6f7f9' : '#202020';
  const view = new Pane();
  for (const focused of [false, true]) {
    pane.focused = focused; pane.status = 'blocked';
    const warning = view.render({});
    assert.equal(warning.attrs.border_color[0], focused ? colors.accent : colors.blocked, 'focused warnings use the focus color while unfocused warnings use the warning color');
    assert.equal(warning.attrs.border_b[0], 2);
    assert.equal(warning.attrs.bg[0], `${colors.blocked}${focused ? '33' : '1a'}`);
    assert.ok(text(warning).includes('Needs you'), 'the status remains understandable without color');
    const title = warning.children.find(node => text(node) === 'Review pending');
    assert.ok(title.attrs.font_semibold);
    assert.equal(title.attrs.text_color[0], colors.foreground, 'warning titles retain readable text contrast');
    for (const status of ['working', 'idle', 'done']) {
      pane.status = status;
      const recovered = view.render({});
      assert.equal(recovered.attrs.bg[0], focused ? light ? colors.surface : colors.background : colors.chrome);
      assert.equal(recovered.attrs.border_b[0], 1);
      assert.equal(recovered.attrs.border_color[0], focused ? colors.border : colors.chrome);
      assert.ok(!text(recovered).includes('Needs you'), 'leaving blocked clears the warning');
    }
  }
}
console.log('Needs-you header passed: light/dark themes, focused/unfocused warning and recovery to working/idle/done.');
