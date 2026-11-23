// Run with: NODE_OPTIONS=--experimental-vm-modules node render-check.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

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
let storage = new Map();
const sharedStorage = new Map();
let chart = { period: '7d', since: '2026-11-11T00:00:00Z', series: [{ label: 'Nov 17', calls: 1 }] };
let usage = { period: 'today', since: '2026-11-17T00:00:00Z', calls: 1, series: [{ label: '00', calls: 1 }] };
let quotas = [], history = [], active = [], recent = [], chartUnavailable = false;
let focus = null, terminalList = [], agentList = [], openFiles = '';
let panelHidden = true, overlayProps = {}, windowActive = true;
const filesByPid = new Map();
let sessionExecs = 0;
const fetchCalls = [];
let concurrencyUnavailable = false;
let heldLookup = null;
const context = vm.createContext({
  console, Date: Clock, URL, Map, Set,
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  window: { is_window_active: () => windowActive, paint_path: (geometry, color) => element('path').geometry(geometry).color(color) },
  fetch: async input => {
    const url = new URL(input);
    fetchCalls.push(url.pathname);
    const data = url.pathname.endsWith('/requests') ? { rows: recent }
      : url.pathname.endsWith('/history') ? { data: history }
      : url.pathname.endsWith('/quotas') ? { data: quotas }
      : url.pathname.endsWith('/concurrency') ? { active }
      : url.searchParams.get('period') === 'today' ? usage : chart;
    return { ok: !(chartUnavailable && url.pathname.endsWith('/usage') && url.searchParams.get('period') !== 'today') && !(concurrencyUnavailable && url.pathname.endsWith('/concurrency')), json: async () => structuredClone(data) };
  },
});
const dependencies = {
  'gpui-kit': { View: class {}, div: () => element('div'), svg: value => element('svg').source(value), image: value => element('image').source(value), PathBuilder: { fill: path, stroke: path } },
  'gpui-base': { h_flex: () => element('h'), v_flex: () => element('v') },
  herdr: { home: () => '/test', appHome: () => '/test', readTextFile: async () => '{}', theme: () => colors, nextCommand: () => new Promise(() => {}), exec: async (_cmd, args) => {
    if (args?.[0]?.endsWith('terminal-session.cjs')) sessionExecs++;
    if (heldLookup && args?.[1] === heldLookup.pid) { heldLookup.started(); await heldLookup.wait; }
    const output = filesByPid.get(args?.[1]) ?? openFiles;
    return { stdout: output.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i)?.[0] ?? '' };
  }, focused: () => focus, terminals: () => terminalList, agents: () => agentList, props: () => overlayProps, shared: key => sharedStorage.get(key), setShared: (key, value) => sharedStorage.set(key, value), layout: () => ({ children: [{ id: 'magpie-panel', hidden: panelHidden }] }) },
};
const mainUrl = process.env.MAGPIE_MAIN ? pathToFileURL(process.env.MAGPIE_MAIN) : new URL('./main.js', import.meta.url);
const main = new vm.SourceTextModule(await readFile(mainUrl, 'utf8'), { context });
await main.link(async name => {
  if (name.startsWith('./')) {
    const module = new vm.SourceTextModule(await readFile(new URL(name, mainUrl), 'utf8'), { context });
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
fetchCalls.length = 0;
notifications = 0;
recent = [{ route_id: 9, model: 'recent-only' }];
active = [{ route: 10, model: 'active-only' }];
now += 5000;
await refresh();
assert.equal(notifications, 0, 'route-only changes must not rebuild the usage page');
assert.ok(texts(panel.render(cx)).includes(`上次成功读取 · ${new Date(now).toLocaleTimeString()}`));
assert.equal(fetchCalls.some(path => /\/(?:requests|concurrency|route)$/.test(path)), false, 'the usage page must not issue routing-only requests');
concurrencyUnavailable = true;
await refresh();
assert.equal(panel.error, '', 'unavailable routing services must not block usage updates');
concurrencyUnavailable = false;

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
assert.ok(!texts(root).includes('无法识别当前会话'), 'an unidentified active session must not get a duplicate status card');
panel.active = [];
assert.ok(texts(panel.render(cx)).includes('无法识别当前会话'), 'show identification status when there are no active requests');
focus = { terminal: 't1' };
terminalList = [{ address: 't1', foreground: { pid: 123 } }];
await refresh();
assert.equal(panel.focusSession, null);
const sessionId = '01234567-89ab-cdef-0123-456789abcdef';
openFiles = `n/test/sessions/rollout-${sessionId}.jsonl`;
await refresh();
assert.equal(panel.focusSession, sessionId, 'retry a failed lookup when the process later opens its session');
terminalList[0].report = { app: 'pi', msg: '1117｜探索｜连接 Chrome' };
panel.active = [];
assert.ok(texts(panel.render(cx)).includes('1117｜探索｜连接 Chrome'), 'the idle current session shows its name');
assert.ok(texts(panel.render(cx)).includes('t1'), 'the idle current session displays its HC address');
panel.active = [{ route: 7, agent: 'codex', session: sessionId, model: 'model' }];
root = panel.render(cx);
assert.ok(texts(root).includes('当前会话'), 'the matched active request is marked as current');
assert.ok(texts(root).includes('1117｜探索｜连接 Chrome'), 'the active current session shows its name');
assert.ok(!texts(root).includes('当前会话暂无进行中的请求'));
const otherSession = '11234567-89ab-cdef-0123-456789abcdef';
terminalList.push({ address: 't2', foreground: { pid: 234 } });
agentList = [{ address: 't1', status: 'working' }, { address: 't2', status: 'working' }];
filesByPid.set('234', `n/test/sessions/rollout-${otherSession}.jsonl`);
active = [{ route: 7, agent: 'omp', session: sessionId }, { route: 8, agent: 'omp', session: otherSession }];
await refresh();
assert.deepEqual(Array.from(panel.sessionTerminals[sessionId]), ['t1']);
assert.deepEqual(Array.from(panel.sessionTerminals[otherSession]), ['t2']);
root = panel.render(cx);
assert.ok(texts(root).includes('t1') && texts(root).includes('t2'), 'resolved HC addresses appear for their sessions');
const cachedExecs = sessionExecs;
await refresh();
assert.equal(sessionExecs, cachedExecs, 'unchanged terminal identities reuse successful session discovery');
const resumedSession = '21234567-89ab-cdef-0123-456789abcdef';
openFiles = resumedSession;
active[0] = { ...active[0], session: resumedSession };
now += 15001;
await refresh();
assert.equal(panel.focusSession, resumedSession, 'a resumed session in the same process is rediscovered within 15 seconds');
assert.deepEqual(Array.from(panel.sessionTerminals[resumedSession]), ['t1']);
openFiles = sessionId;
active[0] = { ...active[0], session: sessionId };
now += 15001;
await refresh();
let lookupStarted, lookupFinished;
const lookupStart = new Promise(resolve => { lookupStarted = resolve; });
const lookupWait = new Promise(resolve => { lookupFinished = resolve; });
heldLookup = { pid: '333', started: lookupStarted, wait: lookupWait };
terminalList.push({ address: 't3', foreground: { pid: 333 }, report: { msg: 'Next terminal' } });
filesByPid.set('333', '31234567-89ab-cdef-0123-456789abcdef');
focus = { terminal: 't3' };
panel.refresh(cx);
await lookupStart;
try {
  assert.equal(texts(panel.render(cx)).includes('当前会话'), false, 'pending discovery must not label the previous session as current for the next terminal');
} finally {
  lookupFinished(); heldLookup = null;
}
await refresh();
terminalList.pop(); filesByPid.delete('333'); focus = { terminal: 't1' };
await refresh();
agentList = [];
active = [];
panel.routes = { [sessionId]: { id: 11, tries: [{ model: 'real-model' }], group: 'gpt' } };
panel.active = [
  { route: 10, agent: 'omp', session: sessionId, ms: 4600 },
  { route: 11, agent: 'omp', session: sessionId, ms: 3100 },
  { route: 12, agent: 'codex', session: 'other', served: 'other-model', ms: 1000 },
  { route: 13, agent: 'omp', ms: 900 },
  { route: 14, agent: 'omp', ms: 800 },
];
root = panel.render(cx);
assert.ok(byId(root, 'route-decision-0') && byId(root, 'route-decision-1') && byId(root, 'route-decision-2') && byId(root, 'route-decision-3'));
assert.equal(byId(root, 'route-decision-4'), undefined, 'same-session requests use one card; unknown sessions remain separate');
assert.ok(byId(root, 'route-decision-request-0-0') && byId(root, 'route-decision-request-0-1'), 'both concurrent requests remain visible');
assert.ok(texts(byId(root, 'route-decision-0')).includes('2 个请求'));
assert.ok(texts(byId(root, 'route-decision-0')).includes('real-model'));
assert.ok(texts(byId(root, 'route-decision-0')).includes('等待模型'));
panel.active[0].phase = 'upstream';
assert.ok(texts(byId(panel.render(cx), 'route-decision-0')).includes('模型信息不可用'), 'an upstream request without route details is not presented as waiting');
panel.active = [{ route: 8, agent: 'codex', session: 'other', model: 'model' }];
assert.ok(texts(panel.render(cx)).includes('当前会话暂无进行中的请求'), 'retain the idle current session alongside another session’s request');
for (const floating of [false, true]) {
  overlayProps = floating ? { overlay: 'magpie-drawer' } : {};
  const lifecycle = new main.namespace.default();
  let refreshes = 0;
  const lifecycleTimers = [];
  lifecycle.refresh = () => { refreshes++; };
  lifecycle.init(undefined, { ...cx, spawn: () => {}, timer: { every: (ms, body) => lifecycleTimers.push({ ms, body }) } });
  assert.equal(refreshes, floating ? 1 : 0, 'a floating Magpie must read immediately even when its docked panel is hidden');
  const poll = lifecycleTimers.find(timer => timer.ms === 5000).body;
  const resume = lifecycleTimers.find(timer => timer.ms === 1000).body;
  poll(cx);
  assert.equal(refreshes, floating ? 2 : 0, 'a floating Magpie must keep polling while the docked panel stays hidden');
  if (floating) {
    windowActive = false;
    poll(cx);
    assert.equal(refreshes, 2, 'background windows still defer polling');
    windowActive = true;
    resume(cx);
    assert.equal(refreshes, 3, 'the floating panel resumes deferred polling when the window becomes active');
  } else {
    panelHidden = false;
    resume(cx);
    assert.equal(refreshes, 1, 'showing the docked panel resumes its deferred polling');
    panelHidden = true;
  }
}
overlayProps = {};
sharedStorage.clear();
storage = new Map([
  ['magpie-live.overview-order', '["decisions","usage","graph"]'],
  ['magpie-live.hidden-sections', '["quotas","requests"]'],
  ['magpie-live.pinned-sections', '["decisions"]'],
  ['magpie-live.chart-metric', 'cost'],
]);
const docked = new main.namespace.default();
docked.init(undefined, { ...cx, spawn: () => {} });
overlayProps = { overlay: 'magpie-drawer' };
storage = new Map();
const floating = new main.namespace.default();
floating.init(undefined, { ...cx, spawn: () => {} });
for (const field of ['overviewOrder', 'hiddenSections', 'pinnedSections', 'chartMetric']) {
  assert.equal(JSON.stringify(floating[field]), JSON.stringify(docked[field]), `the drawer must preserve the docked panel's ${field} with separate per-copy storage`);
}
floating.setPage('usage', cx);
overlayProps = {};
docked.render(cx);
assert.equal(docked.page, 'usage', 'changes made in the drawer must also appear when the docked panel returns');
floating.setPage('routing', cx);
overlayProps = { overlay: 'magpie-drawer' };
const floatingRoot = floating.render(cx);
const pinUsage = byId(floatingRoot, 'overview-pin-usage');
assert.ok(pinUsage);
pinUsage.attrs.on_click[0]({}, { ...cx, stop_propagation() {} });
overlayProps = {};
docked.render(cx);
assert.ok(docked.pinnedSections.includes('usage'), 'pinning a section in the drawer must update the docked layout');
console.log('Magpie checks passed: shared dock/drawer preferences, overlay initial load/polling/resume, refresh, page isolation, chart values/tooltips/geometry, resize, time, quota history and hidden routes.');
