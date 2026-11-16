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
const Home = new Function('View', 'div', 'svg', 'image', 'v_flex', 'h_flex', 'props', 'spaces', 'panes', 'shared', 'setShared', 'theme', 'openOverlay', 'closeOverlay', 'knownAgents', 'window', 'notify', `${source}\nreturn SpaceHome;`)(
  class {}, element, element, element, element, element, () => ({ space: 'space', launcher: true }),
  () => [space], () => [], key => key === 'workspace.project-bindings' ? bindings : null,
  () => {}, () => ({}), () => {}, () => {}, () => [], () => ({}), () => {},
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
console.log('directory scroll checks passed');
