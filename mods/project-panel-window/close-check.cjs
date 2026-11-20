const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function element() {
  const node = { props: {}, nodes: [] };
  const view = new Proxy(node, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === 'child') target.nodes.push(args[0]);
      else if (key === 'children') target.nodes.push(...args[0]);
      else if (key === 'when') { if (args[0]) args[1](view); }
      else target.props[key] = args[0];
      return view;
    };
  } });
  return view;
}
function find(node, id) {
  if (!node || typeof node !== 'object') return null;
  if (node.props.id === id) return node;
  for (const child of node.nodes) { const result = find(child, id); if (result) return result; }
  return null;
}
function load(file, name, env) {
  const source = fs.readFileSync(file, 'utf8').replace(/^import .*;\n/gm, '').replace(`export default class ${name}`, `class ${name}`);
  return new Function(...Object.keys(env), `${source}\nreturn ${name};`)(...Object.values(env));
}
const root = process.env.MOD_ROOT || path.dirname(__dirname);
function fixture(panel, mode = 'floating', history = false) {
  const values = new Map([['layout', 'office'], ['project-tabs.panel-mode', mode], ['project-tabs.floating-panel', mode === 'floating' && panel ? { space: 's1', panel, history } : null]]);
  const overlays = new Map(), closing = [];
  let next = 0;
  const tree = { children: [{ id: 'panel', hidden: mode === 'floating' || !panel, children: [{ id: 'panel-body', active: panel || 'files', children: [
    { id: 'files', content: { mod: 'files-markdown' } },
    { id: 'changes', children: [{ id: 'git-body', active: history ? 'git-history' : 'git-changes', children: [{ id: 'git-changes', content: { mod: 'changes' } }, { id: 'git-history', content: { mod: 'git-history' } }] }] },
    { id: 'editor', content: { terminal: 'ttt1' } },
  ] }] }] };
  const layoutNode = (id, node = tree) => node.id === id ? node : (node.children || []).map(child => layoutNode(id, child)).find(Boolean);
  const storage = new Map();
  const env = {
    View: class {}, div: element, svg: element, image: element, h_flex: element,
    theme: () => ({ selected: 'selected', chrome: 'chrome' }), window: () => ({}),
    spaces: () => [{ id: 's1', active: true, tabs: [] }], panes: () => [], terminals: () => [{ address: 'ttt1', state: 'live' }], machines: () => [],
    layout: () => tree,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    run: (command, args) => {
      if (command === 'layout.hide' || command === 'layout.show') layoutNode(args.id).hidden = command === 'layout.hide';
      else if (command === 'layout.select') layoutNode(args.stack).active = args.child;
      else assert.fail(`Unexpected native command: ${command}`);
    },
    shared: key => values.get(key), setShared: (key, value) => values.set(key, value),
    closeOverlay: id => { const overlay = overlays.get(id); if (overlay) { overlays.delete(id); closing.push(overlay); } },
  };
  const reviews = path.join(root, 'project-tabs/review-targets.js');
  if (fs.existsSync(reviews)) Object.assign(env, new Function(fs.readFileSync(reviews, 'utf8').replace(/^export /gm, '') + '\nreturn { observeReviews, reviewTargets };')());
  env.openOverlay = spec => {
    const id = `overlay-${++next}`;
    const headerProps = { ...spec.layout.children[0].content.props, overlay: id };
    const Header = load(path.join(root, 'project-panel-window/main.js'), 'PanelWindow', { ...env, props: () => headerProps });
    overlays.set(id, { header: new Header(), spec });
    return id;
  };
  const Tabs = load(path.join(root, 'project-tabs/main.js'), 'Tabs', env);
  const tabs = Object.assign(new Tabs(), {
    panelMode: mode, panels: { s1: panel }, space: 's1', editors: { s1: 'ttt1' }, editorErrors: {}, editorPending: {},
    reviewObserved: new Map(), reviewCleanup: new Set(), reviewSeen: new Set(),
  });
  const render = () => tabs.render({ notify() {}, spawn() { assert.fail('This journey must not start background work'); } });
  const flushClose = () => { for (const overlay of closing.splice(0)) overlay.header.close?.({}); };
  return { values, overlays, closing, tabs, render, flushClose, dismiss: env.closeOverlay, layoutNode };
}

for (const panel of ['files', 'changes', 'editor']) {
  const f = fixture(panel);
  let view = f.render();
  const first = f.tabs.floatingPanel.id;
  assert.equal(find(view, `panel-${panel}`).props.bg, 'selected');
  f.dismiss(first);
  f.flushClose();
  assert.equal(f.values.get('project-tabs.floating-panel'), null, `${panel}: native dismissal must reset the open state`);
  view = f.render();
  assert.equal(find(view, `panel-${panel}`).props.bg, 'chrome', `${panel}: dismissed button must stop highlighting`);
  find(view, `panel-${panel}`).props.on_click();
  view = f.render();
  assert.equal(f.overlays.size, 1, `${panel}: one click must reopen the panel`);
  assert.notEqual(f.tabs.floatingPanel.id, first);
  assert.equal(find(view, `panel-${panel}`).props.bg, 'selected');
}

const switched = fixture('files');
let view = switched.render();
find(view, 'panel-changes').props.on_click();
view = switched.render();
switched.flushClose();
assert.equal(switched.values.get('project-tabs.floating-panel').panel, 'changes', 'Closing the replaced Files instance must preserve Changes');
assert.equal(find(view, 'panel-changes').props.bg, 'selected');
const current = switched.overlays.get(switched.tabs.floatingPanel.id);
find(current.header.render(), 'history').props.on_click();
switched.render();
switched.flushClose();
assert.equal(switched.values.get('project-tabs.floating-panel').history, true, 'Closing the old Changes view must preserve History');
const history = switched.overlays.get(switched.tabs.floatingPanel.id);
find(history.header.render(), 'close').props.on_click();
switched.flushClose();
assert.equal(switched.values.get('project-tabs.floating-panel'), null, 'The title-bar close must also reset state');
console.log('Native dismissal clears panel highlighting; one click reopens; replaced overlays preserve the new panel and History.');

for (const panel of ['files', 'changes', 'editor', null]) {
  for (const mode of ['inline', 'floating']) {
    const f = fixture(panel, mode, panel === 'changes');
    if (panel === 'files') f.values.set('files-markdown.current', { context: 'current-folder', file: 'plan.md', preview: false });
    let view = f.render();
    find(view, 'panel-mode').props.on_click();
    view = f.render();
    f.flushClose();
    const floating = mode === 'inline';
    assert.equal(f.tabs.panelMode, floating ? 'floating' : 'inline');
    if (panel) {
      assert.equal(find(view, `panel-${panel}`).props.bg, 'selected', `${panel}: switching ${mode} must keep the open panel`);
      assert.equal(floating ? f.values.get('project-tabs.floating-panel')?.panel : f.layoutNode('panel-body').active, panel);
      assert.equal(floating ? f.overlays.size : Number(!f.layoutNode('panel').hidden), 1);
      if (panel === 'changes') assert.equal(floating ? f.values.get('project-tabs.floating-panel').history : f.layoutNode('git-body').active === 'git-history', true);
      if (panel === 'files') assert.deepEqual(f.values.get('files-markdown.restore'), { context: 'current-folder', file: 'plan.md', preview: false, mode: floating ? 'floating' : 'inline' });
    } else {
      assert.equal(f.overlays.size, 0, 'Switching with all panels closed must not open one');
      assert.equal(f.layoutNode('panel').hidden, true);
    }
    assert.equal(f.tabs.editors.s1, 'ttt1', 'Editor terminal must survive a mode switch');
  }
}
console.log('Mode switches preserve the open Files/Changes/Editor panel and History; closed panels stay closed.');
