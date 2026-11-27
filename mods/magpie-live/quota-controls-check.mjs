// node --experimental-vm-modules quota-controls-check.mjs [path/to/main.js]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

function element() {
  const node = { attrs: {}, nodes: [] };
  const proxy = new Proxy(node, { get(target, name) {
    if (name in target) return target[name];
    if (name === 'when') return (condition, body) => condition ? body(proxy) : proxy;
    if (name === 'child') return child => { node.nodes.push(child); return proxy; };
    if (name === 'children') return children => { node.nodes.push(...children); return proxy; };
    return (...args) => { node.attrs[name] = args; return proxy; };
  } });
  return proxy;
}
const stored = new Map(), shared = new Map();
let overlay = {};
const theme = { surface: '#fff', foreground: '#111', muted: '#888', dim: '#999', raised: '#eee', accent: '#06f', border: '#ddd' };
const deps = {
  'gpui-kit': { View: class {}, div: element, svg: element, image: element, PathBuilder: {} },
  'gpui-base': { h_flex: element, v_flex: element },
  herdr: { home: () => '/test', appHome: () => '/test', readTextFile() {}, theme: () => theme, nextCommand() {}, exec() {}, focused: () => null,
    terminals: () => [], agents: () => [], layout: () => ({}), props: () => overlay, shared: key => shared.get(key), setShared: (key, value) => shared.set(key, value) },
};
const context = vm.createContext({ console, Date, Map, Set, window: { is_window_active: () => true },
  localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) } });
const sourceUrl = process.argv[2] ? pathToFileURL(process.argv[2]) : new URL('./main.js', import.meta.url);
const main = new vm.SourceTextModule(await readFile(sourceUrl, 'utf8'), { context });
await main.link(async name => {
  if (name.startsWith('./')) {
    const mod = new vm.SourceTextModule(await readFile(new URL(name, sourceUrl), 'utf8'), { context });
    await mod.link(() => { throw new Error('Unexpected nested import'); });
    return mod;
  }
  const exports = deps[name];
  return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
});
await main.evaluate();
const cx = { notify() {}, stop_propagation() {}, spawn() {}, timer: { every() {} }, new: () => ({ set_props() {} }) };
function create() { const view = new main.namespace.default(); view.init({}, cx); return view; }
function nodes(root) { return root && typeof root === 'object' ? [root, ...(root.nodes || []).flatMap(nodes)] : []; }
const byId = (root, id) => nodes(root).find(node => node.attrs?.id?.[0] === id);
const click = (root, id) => { const control = byId(root, id); assert.ok(control, `Missing ${id}`); control.attrs.on_click[0]({}, cx); };
const panel = create();
panel.page = 'routing';
panel.quotas = [
  { provider: 'codex', name: 'Codex', user: 'one@example.test', windows: [{ name: 'hour', remaining: 80 }, { name: 'week', remaining: 20 }] },
  { provider: 'grok', name: 'Grok', balance: 0 },
];
const original = JSON.stringify(panel.quotas);
function removeProvider(index) {
  const root = panel.providerQuotas(theme);
  byId(root, `provider-icon-${index}`).attrs.on_hover[0](true, cx);
  click(panel.providerQuotas(theme), `provider-visibility-${index}`);
}
assert.equal(byId(panel.providerQuotas(theme), 'provider-visibility-0'), undefined, 'Delete does not consume title space before hovering');
byId(panel.providerQuotas(theme), 'provider-icon-0').attrs.on_hover[0](true, cx);
assert.ok(byId(panel.providerQuotas(theme), 'provider-visibility-0'), 'Hovering the provider icon exposes removal in the same slot');
byId(panel.providerQuotas(theme), 'provider-icon-0').attrs.on_hover[0](false, cx);
assert.equal(byId(panel.providerQuotas(theme), 'provider-visibility-0'), undefined, 'Leaving the icon restores the provider logo');
panel.width = 220;
assert.equal(byId(panel.providerQuotas(theme), 'provider-quota-columns').nodes.length, 1, 'Narrow panel uses one card per row');
panel.width = 600;
assert.equal(byId(panel.providerQuotas(theme), 'provider-quota-columns').nodes.length, 2, 'Wide panel uses two columns');
const quotaArea = byId(panel.render(cx), 'provider-quota-list');
quotaArea.attrs.on_size_change[0]({ width: 199 }, cx);
assert.equal(byId(panel.providerQuotas(theme), 'provider-quota-columns').nodes.length, 1, 'Column count uses the actual quota area, not the wider panel');
quotaArea.attrs.on_size_change[0]({ width: 200 }, cx);
assert.equal(byId(panel.providerQuotas(theme), 'provider-quota-columns').nodes.length, 2, 'A 200px quota area already uses two columns');
click(panel.providerQuotas(theme), 'quota-down-0');
const order = JSON.stringify(panel.providerOrder);
removeProvider(0);
assert.equal(byId(panel.providerQuotas(theme), 'provider-quota-0'), undefined, 'Removed provider card disappears');
assert.ok(byId(panel.providerQuotas(theme), 'provider-quota-1'), 'Other providers remain');
overlay = { overlay: 'drawer' };
const drawer = create();
assert.equal(JSON.stringify(drawer.hiddenProviders), JSON.stringify(panel.hiddenProviders), 'Card removal is shared and survives reopening');
removeProvider(1);
assert.equal(nodes(panel.providerQuotas(theme)).filter(node => /^provider-quota-\d+$/.test(node.attrs?.id?.[0])).length, 0);
click(panel.render(cx), 'quota-reset');
assert.equal(nodes(panel.providerQuotas(theme)).filter(node => /^provider-quota-\d+$/.test(node.attrs?.id?.[0])).length, 2, 'Reset restores even an all-removed list');
panel.editQuotas = true;
click(panel.providerQuotas(theme), 'quota-visibility-1-0');
assert.equal(panel.hiddenQuotas.length, 1, 'Existing per-window hiding still works');
click(panel.render(cx), 'quota-reset');
assert.equal(panel.hiddenQuotas.length, 0, 'Reset also restores hidden quota windows');
assert.equal(JSON.stringify(panel.providerOrder), order, 'Reset preserves user ordering');
assert.equal(JSON.stringify(panel.quotas), original, 'No quota data is deleted or changed');
drawer.syncPreferences();
assert.equal(drawer.hiddenProviders.length, 0, 'Reset synchronizes with the other panel copy');
assert.equal(JSON.parse(shared.get('magpie-live.preferences')['magpie-live.hidden-providers']).length, 0);

panel.editQuotas = false;
panel.providerOrder = ['codex', 'grok', 'kimi', 'zcode'];
panel.quotas = [
  { provider: 'codex', name: 'Codex', balance: 10 },
  { provider: 'grok', name: 'Grok', balance: 20 },
  { provider: 'kimi', name: 'Kimi', user: 'test', windows: [{ name: 'week', remaining: 50 }] },
  { provider: 'zcode', name: 'ZCode', balance: 30 },
];
panel.hiddenProviders = ['grok'];
panel.hiddenQuotas = [JSON.stringify(['kimi', 'test', 'week'])];
click(panel.providerQuotas(theme), 'quota-up-3');
assert.equal(JSON.stringify(panel.providerOrder), JSON.stringify(['zcode', 'grok', 'kimi', 'codex']), 'A single arrow click must cross hidden providers and providers with no visible quota rows');
let sorted = panel.providerQuotas(theme);
assert.equal(byId(sorted, 'quota-up-0'), undefined, 'The first visible card has no backward arrow');
assert.equal(byId(sorted, 'quota-down-3'), undefined, 'The last visible card has no forward arrow');
click(sorted, 'quota-down-0');
assert.equal(JSON.stringify(panel.providerOrder), JSON.stringify(['codex', 'grok', 'kimi', 'zcode']), 'Forward movement must also skip invisible neighbors');
const arrow = byId(panel.providerQuotas(theme), 'quota-down-0');
let stopped = 0;
arrow.attrs.on_mouse_down[1]({}, { ...cx, stop_propagation() { stopped++; } });
arrow.attrs.on_click[0]({}, { ...cx, stop_propagation() { stopped++; } });
assert.equal(stopped, 2, 'Arrow press and click stay inside the control');
assert.equal(JSON.parse(shared.get('magpie-live.preferences')['magpie-live.provider-order'])[0], 'zcode', 'The resulting order is saved');
console.log('Quota arrows: hidden neighbors, empty providers, visible boundaries and isolated pointer events passed.');
console.log('Quota cards: individual removal, reorder, persistence, shared reset, all-hidden recovery and unchanged source data passed.');
