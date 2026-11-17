// Run with: NODE_OPTIONS=--experimental-vm-modules node render-check.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Substitute the native host and I/O only; execute the real mod and comparison module.
let now = Date.parse('2026-11-17T12:30:00Z');
const NativeDate = Date;
class Clock extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const colors = { surface: '#202020', foreground: '#eeeeee', muted: '#888888', dim: '#666666', accent: '#4488ff', border: '#333333', raised: '#252525', selected: '#303040', working: '#88ff88', done: '#00ff00', blocked: '#ff0000' };
const built = [];
function element(kind) {
  const target = { kind, attrs: {}, nodes: [] };
  const proxy = new Proxy(target, {
    get(object, name) {
      if (name in object) return object[name];
      if (name === 'when') return (condition, body) => condition ? body(proxy) : proxy;
      if (name === 'child') return child => { object.nodes.push(child); return proxy; };
      if (name === 'children') return children => { object.nodes.push(...children); return proxy; };
      return (...args) => { object.attrs[name] = args; return proxy; };
    },
  });
  built.push(target);
  return proxy;
}
const pathBuilds = [];
function path() {
  const commands = [];
  const builder = new Proxy({}, { get: (_target, name) => name === 'build'
    ? () => { pathBuilds.push(commands); return commands; }
    : (...args) => { commands.push([name, ...args]); return builder; } });
  return builder;
}
const storage = new Map();
let chart = { period: '7d', since: '2026-11-11T00:00:00Z', series: [{ label: 'Nov 17', calls: 1 }] };
let usage = { period: 'today', since: '2026-11-17T00:00:00Z', calls: 1, series: [{ label: '00', calls: 1 }] };
let quotas = [], history = [], active = [], recent = [], chartUnavailable = false;
const context = vm.createContext({
  console, Date: Clock, URL, Map, Set,
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  window: { is_window_active: () => true, paint_path: (geometry, color) => element('path').geometry(geometry).color(color) },
  fetch: async input => {
    const url = new URL(input);
    const data = url.pathname.endsWith('/requests') ? { rows: recent }
      : url.pathname.endsWith('/history') ? { data: history }
      : url.pathname.endsWith('/quotas') ? { data: quotas }
      : url.pathname.endsWith('/concurrency') ? { active }
      : url.searchParams.get('period') === 'today' ? usage : chart;
    return { ok: !(chartUnavailable && url.pathname.endsWith('/usage') && url.searchParams.get('period') !== 'today'), json: async () => structuredClone(data) };
  },
});
const dependencies = {
  'gpui-kit': { View: class {}, div: () => element('div'), svg: value => element('svg').source(value), image: value => element('image').source(value), PathBuilder: { fill: path, stroke: path } },
  'gpui-base': { h_flex: () => element('h'), v_flex: () => element('v') },
  herdr: { home: () => '/test', readTextFile: async () => '{}', theme: () => colors, nextCommand: () => new Promise(() => {}), exec: async () => ({ stdout: '' }), focused: () => null, terminals: () => [], agents: () => [], layout: () => ({ children: [{ id: 'magpie-panel', hidden: true }] }) },
};
const main = new vm.SourceTextModule(await readFile(new URL('./main.js', import.meta.url), 'utf8'), { context });
await main.link(async name => {
  if (name.startsWith('./')) {
    const module = new vm.SourceTextModule(await readFile(new URL(name, import.meta.url), 'utf8'), { context });
    await module.link(() => { throw new Error('Unexpected nested import'); });
    return module;
  }
  const exports = dependencies[name];
  return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
});
await main.evaluate();
const jobs = [];
let notifications = 0;
const timers = [];
const cx = {
  notify: () => { notifications++; },
  spawn: body => { jobs.push(body(cx)); },
  timer: { every: (ms, body) => { timers.push({ ms, body }); } },
  new: (Class, props) => { const view = new Class(); view.init?.(props, cx); return { set_props: value => view.update?.(value), view }; },
};
const panel = new main.namespace.default();
panel.init(undefined, { ...cx, spawn: () => {} });
panel.configDir = '/test';
panel.chartGranularity = 'day';
async function refresh() {
  panel.refresh(cx);
  while (jobs.length) await Promise.all(jobs.splice(0));
}
await refresh();
notifications = 0;
chart = { ...chart, series: [{ label: 'Nov 17', calls: 9 }] };
await refresh();
assert.ok(notifications > 0, 'a chart-only response change must invalidate the visible panel');
assert.equal(panel.chartUsage.series[0].calls, 9);

function nodes(root) {
  if (!root || typeof root !== 'object') return [];
  if (Object.hasOwn(root, 'view')) return nodes(root.view.render(cx));
  return [root, ...root.nodes.flatMap(nodes)];
}
function texts(root) {
  return nodes(root).flatMap(node => node.nodes.filter(value => typeof value === 'string'));
}
function byId(root, id) { return nodes(root).find(node => node.attrs.id?.[0] === id); }
function sizedChart(width) {
  const first = panel.usageChart(colors);
  byId(first, 'usage-chart-bars').attrs.on_size_change[0]({ width, height: 56 }, cx);
  return byId(panel.usageChart(colors), 'usage-chart-bars');
}

notifications = 0;
await refresh();
assert.equal(notifications, 0, 'identical responses should not invalidate the routing view');
chartUnavailable = true;
await refresh();
assert.ok(texts(panel.usageChart(colors)).includes('走势数据暂不可用'));
chartUnavailable = false;
await refresh();
assert.ok(texts(panel.usageChart(colors)).includes('最高 9'));

panel.setPage('usage', cx);
await refresh();
notifications = 0;
recent = [{ route_id: 9, model: 'recent-only' }];
active = [{ route: 10, model: 'active-only' }];
now += 5000;
await refresh();
assert.equal(notifications, 0, 'route-only changes must not rebuild the usage page');
assert.ok(texts(panel.render(cx)).includes(`上次成功读取 · ${new Date(now).toLocaleTimeString()}`));

// Zero values remain absent, small positives keep their 2px minimum, and every bucket retains its tooltip.
panel.period = '30d';
panel.usage = { period: '30d' };
panel.chartUsage = { period: '30d', series: Array.from({ length: 30 }, (_, i) => ({ label: `day-${i}`, calls: i === 0 ? 0 : i === 1 ? 0.01 : i + 1, cost: 0.25, unpriced: i === 2 })) };
panel.comparison = { note: 'comparison' };
panel.comparisonCache = { baseline: { series: Array.from({ length: 30 }, (_, i) => ({ label: `prior-${i}`, calls: 15, cost: 0.5 })) } };
let bars = sizedChart(329);
assert.equal(nodes(bars).length, 33, '30 paired buckets use two paths and retain all 30 hit regions');
assert.equal(nodes(bars).filter(node => node.attrs.tooltip).length, 30);
assert.equal(nodes(bars).find(node => node.attrs.tooltip)?.attrs.tooltip[0], 'day-0 · 本期 0 · 对照 prior-0 15');
const painted = () => nodes(bars).filter(node => node.kind === 'path');
assert.equal(painted()[0].attrs.opacity[0], 0.45);
assert.equal(painted()[0].attrs.geometry[0].filter(command => command[0] === 'move_to').length, 30);
assert.equal(painted()[1].attrs.geometry[0].filter(command => command[0] === 'move_to').length, 29);
const starts = painted()[1].attrs.geometry[0].filter(command => command[0] === 'move_to');
assert.equal(starts[0][2], 53, 'small positive current value starts two pixels above the baseline');
assert.equal(starts.at(-1)[2], 3, 'maximum current value remains 52 pixels high');
const lastCommands = painted()[1].attrs.geometry[0];
assert.ok(lastCommands.some(command => command[0] === 'line_to' && command[1] === 329), 'last bar reaches the right edge');
const pathsBefore = pathBuilds.length;
panel.usageChart(colors);
assert.equal(pathBuilds.length, pathsBefore, 'unchanged chart repaint reuses immutable native geometry');
bars = sizedChart(629);
assert.ok(painted()[1].attrs.geometry[0].some(command => command[0] === 'line_to' && command[1] === 629), 'resize rebuilds geometry');
colors.accent = '#ff8844';
bars = byId(panel.usageChart(colors), 'usage-chart-bars');
assert.equal(painted()[1].attrs.color[0], '#ff8844', 'cached geometry still follows current theme');
panel.chartMetric = 'cost';
assert.ok(texts(panel.usageChart(colors)).includes('部分费用未计价，图中仅含已计价金额'));
panel.comparison = null;
bars = sizedChart(329);
assert.equal(nodes(bars).filter(node => node.kind === 'path').length, 1, 'unavailable comparison removes previous bars');
panel.chartMetric = 'calls';
panel.chartUsage = { period: 'today', since: '2026-11-17T00:00:00Z', series: Array.from({ length: 24 }, (_, i) => ({ label: `${i}:00`, calls: i + 1 })) };
panel.usage = { period: 'today' };
now = Date.parse('2026-11-17T12:59:00Z');
assert.equal(nodes(panel.usageChart(colors)).filter(node => node.attrs.tooltip).length, 13);
now = Date.parse('2026-11-17T13:00:00Z');
assert.equal(nodes(panel.usageChart(colors)).filter(node => node.attrs.tooltip).length, 14, 'hour rollover invalidates cached visible buckets');

const reset = '2026-11-17T14:00:00Z';
panel.quotas = [{ provider: 'codex', user: 'user@example.com', windows: [{ name: 'hour', remaining: 50, resetsAt: reset }] }];
panel.history = [{ provider: 'codex', user: 'user@example.com', lines: [{ name: 'hour', points: [
  { left: 80, start: '2026-11-17T10:00:00Z', resetsAt: reset },
  { left: 50, start: '2026-11-17T12:00:00Z', resetsAt: reset },
] }] }];
assert.ok(texts(panel.providerQuotas(colors)).includes('0%'), 'pace uses the latest matching reset start');
let quotaTree = panel.quotaCards(colors)[0];
byId(quotaTree, 'quota-trend-0-0').attrs.on_size_change[0]({ width: 101, height: 22 }, cx);
quotaTree = panel.quotaCards(colors)[0];
assert.equal(nodes(quotaTree).filter(node => node.kind === 'path').length, 1);
panel.history = structuredClone(panel.history);
panel.history[0].lines[0].points[1].left = 25;
quotaTree = panel.quotaCards(colors)[0];
assert.equal(nodes(quotaTree).filter(node => node.kind === 'path').length, 1, 'same-size history update must not erase the chart while awaiting a nonexistent resize');
panel.showRemaining = false;
quotaTree = panel.quotaCards(colors)[0];
assert.ok(nodes(quotaTree).find(node => node.kind === 'path').attrs.geometry[0].some(command => command[0] === 'move_to' && command[2] === 7), 'used mode converts the latest 25% remaining to a 15px bar');
now = Date.parse('2026-11-17T13:30:00Z');
assert.ok(texts(panel.providerQuotas(colors)).includes('+25%'), 'pace advances even if quota and history values are unchanged');

panel.page = 'routing';
panel.active = [{ route: 7, agent: 'codex', provider: 'codex', model: 'model', started: now }];
panel.hiddenSections = ['graph', 'decisions', 'requests'];
built.length = 0;
panel.render(cx);
assert.equal(built.filter(node => node.attrs.id?.[0]?.startsWith('route-decision-') || node.attrs.id?.[0]?.startsWith('route-request-')).length, 0, 'hidden route rows must not be constructed');
assert.equal(built.filter(node => node.attrs.source?.[0] === 'mods/magpie-live/magpie.svg').length, 0, 'hidden graph must not construct its hub');
panel.hiddenSections = [];
let root = panel.render(cx);
assert.ok(byId(root, 'route-decision-0'));
assert.ok(byId(root, 'route-request-0'));
assert.ok(texts(root).some(text => text.includes('model')));
assert.ok(timers.every(timer => timer.ms >= 1000), 'static routes have no animation-frequency timer');
assert.equal(built.filter(node => node.attrs.transition).length, 0, 'static routes do not schedule position transitions');
console.log('Magpie checks passed: refresh, page isolation, chart values/tooltips/geometry, resize, time, quota history and hidden routes.');
