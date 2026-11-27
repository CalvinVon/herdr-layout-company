const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
  .replace(/^import .*;\n/gm, '').replace('export default class SpaceHome', 'class SpaceHome');
function element() {
  const state = { props: {}, nodes: [] };
  let proxy;
  proxy = new Proxy(state, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === 'child') target.nodes.push(args[0]);
      else if (key === 'children') target.nodes.push(...args[0]);
      else if (key === 'when') { if (args[0]) args[1](proxy); }
      else target.props[key] = args.length ? args[0] : true;
      return proxy;
    };
  }});
  return proxy;
}
const folders = Array.from({ length: 8 }, (_, index) => ({ path: `/repo/folder-${index}` }));
const space = { id: 'space', name: 'Example', tabs: [] };
const bindings = { space: { folders } };
const target = { space: 'space', launcher: true };
const state = new Map([['workspace.project-bindings', bindings], ['workspace.project-status', { ready: true }]]);
const Home = new Function('View', 'div', 'svg', 'image', 'v_flex', 'h_flex', 'props', 'spaces', 'panes', 'shared', 'setShared', 'theme', 'openOverlay', 'closeOverlay', 'knownAgents', 'window', 'notify', `${source}\nreturn SpaceHome;`)(
  class {}, element, element, element, element, element, () => target,
  () => [space], () => [], key => state.get(key),
  (key, value) => state.set(key, value), () => ({ accent: 'accent' }), () => {}, () => {}, () => [], () => ({}), () => {},
);
const home = new Home();
home.width = 900;
home.agents = [];
const root = home.render();
function findParent(node, id) {
  if (!node || !node.nodes) return null;
  if (node.nodes.some(child => child?.props?.id === id)) return node;
  for (const child of node.nodes) { const result = findParent(child, id); if (result) return result; }
  return null;
}
const viewport = findParent(root, 'space-home-directory-list');
assert(viewport, 'directory list has a bounded parent viewport');
assert.equal(viewport.props.h, 230);
const list = viewport.nodes.find(child => child?.props?.id === 'space-home-directory-list');
assert.equal(list.props.overflow_y_scrollbar, true);
assert.equal(list.nodes.filter(child => child?.props?.id?.startsWith('space-home-folder-')).length, 8);
let stopped = false;
viewport.props.on_scroll_wheel({}, { stop_propagation() { stopped = true; } });
assert(stopped, 'directory wheel events do not reach the outer page');
target.folder = '/repo/folder-3/subdir';
const subdirectoryHome = new Home();
subdirectoryHome.init({}, { spawn() {} });
const subdirectoryRoot = subdirectoryHome.render();
const subdirectoryList = findParent(subdirectoryRoot, 'space-home-directory-list').nodes.find(child => child?.props?.id === 'space-home-directory-list');
const subdirectoryRow = subdirectoryList.nodes.find(child => child?.props?.tooltip === target.folder);
assert(subdirectoryRow, 'a supplied subdirectory remains selectable even when it is not a configured root');
assert.equal(subdirectoryRow.props.border_color, 'accent', 'the supplied subdirectory stays selected');
assert.equal(subdirectoryList.nodes.filter(child => child?.props?.id?.startsWith('space-home-folder-')).length, 9);
const terminal = findParent(subdirectoryRoot, 'space-home-tool-terminal').nodes.find(child => child?.props?.id === 'space-home-tool-terminal');
terminal.props.on_click({}, { notify() {} });
const request = state.get('workspace.project-requests').at(-1);
assert.equal(request.folder, target.folder, 'the queued launch retains the directory + subdirectory rather than falling back to the first root');
assert.equal(request.space, space.id);
assert.equal(request.action, 'new-tab');
target.folder = folders[3].path;
const configuredHome = new Home();
configuredHome.init({}, { spawn() {} });
const configuredRoot = configuredHome.render();
const configuredList = findParent(configuredRoot, 'space-home-directory-list').nodes.find(child => child?.props?.id === 'space-home-directory-list');
assert.equal(configuredList.nodes.filter(child => child?.props?.id?.startsWith('space-home-folder-')).length, 8, 'a supplied configured folder is not duplicated');
console.log('directory scroll checks passed');
