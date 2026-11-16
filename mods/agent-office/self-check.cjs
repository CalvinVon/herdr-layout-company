const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
/** @returns {any} */
function element() {
  /** @type {{props: Record<string, any>, nodes: any[]}} */
  const data = { props: {}, nodes: [] };
  /** @type {any} */
  let view;
  view = new Proxy(data, { get(target, key) {
    if (key in target) return Reflect.get(target, key);
    /** @param {...any} args */
    const method = (...args) => {
      if (key === 'child') target.nodes.push(args[0]);
      else if (key === 'children') target.nodes.push(...args[0]);
      else if (key === 'when') { if (args[0]) args[1](view); }
      else target.props[key === 'loop' ? `loop:${args[0]}` : String(key)] = key === 'loop' ? args[1] : args[0];
      return view;
    };
    return method;
  } });
  return view;
}
/** @param {string} filename @param {Record<string, any>} env @returns {any} */
function load(filename, env) {
  const source = fs.readFileSync(path.join(__dirname, filename), 'utf8');
  const names = [...source.matchAll(/^export (?:const|let|function|class) (\w+)/gm)].map(match => match[1]);
  const main = source.match(/export default class (\w+)/)?.[1];
  const body = source.replace(/^import .*;\n/gm, '').replace(/export default class /, 'class ').replace(/^export /gm, '');
  return new Function(...Object.keys(env), body + '\nreturn {' + names.map(name => `get ${name}(){return ${name};}`).join(',') + (main ? `${names.length ? ',' : ''}default:${main}` : '') + '};')(...Object.values(env));
}
const A = load('art.js', { div: element });
const D = load('decor.js', { div: element, A, run() {} });
const T = load('themes.js', { div: element, A, D });
const model = load('projects.js', {});
const S = load('wall-services.js', {});
/** @type {any[]} */
const agents = [
  { address: 'a', pane: 'pane-a', status: 'idle', focused: true, space_name: 'repo', tab: 'shared-tab' },
  { address: 'b', pane: 'pane-b', status: 'idle', focused: false, space_name: 'repo', tab: 'shared-tab' },
  { address: 'c', pane: 'pane-c', status: 'idle', focused: false, space_name: 'workshop', tab: 'other-tab' },
  { address: 'd', pane: 'pane-d', status: 'idle', focused: false, space_name: 'repo', tab: 'solo-tab' },
];
/** @param {string} pane @param {string} tab @param {string} space */
const member = (pane, tab, space) => ({ pane, terminal: pane, tab, space });
/** @type {any[]} */
const groups = [
  { id: 'alpha', name: 'epower-thanos-app', folder: '/alpha', machine: null, target: { space: 'space-a' }, members: [member('pane-a', 'shared-tab', 'space-a'), member('pane-d', 'solo-tab', 'space-a'), member('pane-b', 'shared-tab', 'space-a')] },
  { id: 'beta', name: 'compound-powers', folder: '/beta', machine: null, target: { space: 'space-c' }, members: [member('pane-c', 'other-tab', 'space-c')] },
  { id: 'empty', name: 'mythos', folder: '/empty', machine: null, target: { space: 'space-empty' }, members: [] },
];
assert.deepEqual(model.projectRooms(groups, agents, T.themeFor, {}).map(room => room.id), ['alpha', 'beta', 'empty']);
assert.deepEqual(model.projectRooms([...groups].reverse(), agents, T.themeFor, {}).map(room => room.id), ['empty', 'beta', 'alpha']);
let focus = { pane: 'pane-a', space: 'space-a' };
/** @returns {any[]} */
const noRows = () => [];
/** @type {Record<string, any>} */
const sharedValues = {};
const openedFiles = [];
let zoom = 1;
globalThis.window = { paint_path: () => element(), is_window_active: () => true };
const env = { ...model, View: class {}, div: element, svg: element, Scrollbar: { vertical: element }, PathBuilder: { fill: () => ({ add_polygon() {}, build: () => ({}) }) }, A, T, D, S, agents: () => agents, terminals: noRows, spaces: noRows, panes: noRows, machines: noRows,
  focused: () => focus, shared: (/** @type {string} */ key) => key === 'workspace.office-groups' ? groups : sharedValues[key],
  setShared(/** @type {string} */ key, /** @type {any} */ value) { sharedValues[key] = value; }, run() {}, openOverlay() {}, exec(command, args) { openedFiles.push({ command, args }); return Promise.resolve({ code: 0 }); }, window: () => ({ platform: 'macos' }), settings: () => ({ zoom }), hc() {}, writeTextFile() {} };
const Office = load('main.js', env).default;
const cx = { timer: { every() {}, after() {} }, notify() {}, spawn() {} };
const office = new Office(); office.init({}, cx);
Object.assign(office, {
  room: noRows, prop: element, person: element, interns: noRows, graduates: noRows, leavers: noRows, kitty: element,
  /** @param {string} address @param {string} spot @param {number} x @param {number} y */
  walk(address, spot, x, y) { return (office.at[address] = { spot, x, y }); },
});
const initialSize = office.size;
let measuredRoom;
office.room = (width, height) => { measuredRoom = { width, height }; return []; };
office.size = { width: 900, height: 225 };
zoom = 0.9;
office.render(cx);
assert.equal(measuredRoom.height, 250, 'zoomed viewport height is converted back to design units');
assert.ok(measuredRoom.width >= 1000, 'zoomed viewport width is converted back to design units');
zoom = 1;
office.size = initialSize;
office.room = noRows;
/** @param {any} node @returns {string[]} */
function lamps(node) { return [...(node?.props?.id?.startsWith('desk-lamp-') ? [node.props.id] : []), ...(node?.nodes ?? []).flatMap(lamps)]; }
/** @param {number} hour @param {number} [minute] */
function scene(hour, minute = 0) { office.now = new Date(2026, 10, 4, hour, minute); return office.render(cx); }
assert.deepEqual(lamps(scene(14)), []);
assert.equal(office.currentProject.id, 'alpha');
assert.deepEqual(Object.keys(office.desk).sort(), ['a', 'b', 'd']);
assert.equal(office.desk.b, office.desk.a + 1);
assert.deepEqual(lamps(scene(19, 59)), []);
assert.deepEqual(lamps(scene(20)), ['desk-lamp-0']);
assert.deepEqual(lamps(scene(5, 59)), ['desk-lamp-0']);
assert.deepEqual(lamps(scene(6)), []);
agents[0].focused = false; agents[1].focused = true; focus = { pane: 'pane-b', space: 'space-a' };
assert.deepEqual(lamps(scene(23)), ['desk-lamp-1']);
assert.equal(office.at.a.spot, 'cooler'); assert.equal(office.at.b.spot, 'cooler');
agents[1].focused = false; agents[2].focused = true; focus = { pane: 'pane-c', space: 'space-c' };
scene(23); assert.equal(office.currentProject.id, 'beta'); assert.deepEqual(Object.keys(office.desk), ['c']);
agents[2].focused = false; agents[0].focused = true; focus = { pane: 'pane-a', space: 'space-a' };
scene(23); assert.equal(office.currentProject.id, 'alpha'); assert.equal(office.desk.b, 1);
agents[0].focused = false; assert.deepEqual(lamps(scene(23)), []);
agents[0].status = 'working'; assert.deepEqual(lamps(scene(23)), ['desk-lamp-0']);
agents[1].focused = true; assert.deepEqual(lamps(scene(23)), ['desk-lamp-0', 'desk-lamp-1']);
const sleeping = office.screen('idle', true, 4, false), active = office.screen('idle', true, 4, true);
assert.notEqual(active.props.bg, sleeping.props.bg);
assert.equal(sleeping.nodes.some((/** @type {any} */ node) => node.props?.['loop:left']), true);
assert.equal(active.nodes.some((/** @type {any} */ node) => node.props?.['loop:left'] || node.props?.['loop:width']), false);
assert.equal(office.screen('working', false, 4, true).nodes.some((/** @type {any} */ node) => node.props?.['loop:width']), true);
const selection = new model.ProjectSelection();
/** @returns {any[]} */
const rooms = () => model.projectRooms(groups, agents, T.themeFor, selection.targets);
assert.equal(selection.choose(rooms(), { pane: 'pane-b', space: 'space-a' }, null).id, 'alpha');
assert.equal(selection.targets.alpha.pane, 'pane-b');
assert.equal(selection.choose(rooms(), { pane: null, space: 'space-empty' }, null).id, 'empty');
assert.equal(selection.choose(rooms(), { pane: 'pane-c', space: 'space-c' }, null).id, 'beta');
assert.equal(selection.choose(rooms(), { pane: 'pane-c', space: 'space-c' }, { id: 'empty', token: 1 }).id, 'empty');
assert.equal(selection.choose(rooms(), { pane: 'pane-c', space: 'space-c' }, { id: 'empty', token: 2 }).id, 'empty');
assert.equal(model.projectRooms(groups, agents, T.themeFor, { alpha: { pane: 'closed' } }).find((/** @type {any} */ room) => room.id === 'alpha').target.pane, 'pane-b');
sharedValues['agent-office.requested-project'] = { id: 'empty', token: 99 };
const reopened = new Office(); reopened.init({}, cx);
const reopenedRooms = model.projectRooms(groups, agents, T.themeFor, reopened.projectSelection.targets);
assert.equal(reopened.projectSelection.choose(reopenedRooms, { pane: 'pane-a', space: 'space-a' }, sharedValues['agent-office.requested-project']).id, 'alpha');
delete sharedValues['agent-office.requested-project'];
const partyOffice = new Office(); partyOffice.init({}, cx); partyOffice.useProject({ id: 'alpha' });
const now = Date.now(); partyOffice.finishes = [now, now, now];
/** @type {any[]} */
const callbacks = [];
const partyCx = { timer: { after: (/** @type {number} */ _ms, /** @type {any} */ callback) => callbacks.push(callback) }, notify() {} };
partyOffice.track([], now, partyCx); partyOffice.useProject({ id: 'beta' });
const otherParty = { start: now + 100 }; partyOffice.party = otherParty;
callbacks[0](partyCx); assert.equal(partyOffice.party, otherParty);
partyOffice.useProject({ id: 'alpha' }); partyOffice.track([], now + 8 * 60 * 1000 + 100, partyCx); assert.equal(partyOffice.party, null);
for (const name of ['epower-thanos-app', 'compound-powers', 'mythos']) {
 const project = { id: name, name };
 for (const count of [0, 3, 12, 50]) {
  const g = T.officeGeometry(600, 170, count, project);
  assert.ok(g.contentWidth >= 600);
  assert.ok(40 + g.wallHeight + g.wallStagger <= g.wallBottom);
  for (let i = 0; i < count; i++) {
   const p = g.deskPos(i);
   assert.equal(p.y, g.floorY); assert.ok(p.y >= g.wallBottom);
   assert.ok(p.x >= 0 && p.x + g.slot <= Math.min(g.zoneX, g.coolerX, g.couchX));
   if (i) assert.ok(p.x >= g.deskPos(i - 1).x + g.slot);
  }
 }
 const g = T.officeGeometry(1000, 250, 3, project);
 const sky = { top: '#101828', bottom: '#182c40', stars: true };
 const backdrop = T.roomBackdrop(1000, 250, g, project, sky);
 assert.equal(backdrop.find((/** @type {any} */ node) => node.props.id === 'project-banner').nodes[0], name);
 const window = D.windowPane(0, 0, 120, 100, sky, null, true);
 assert.equal(window.nodes[0].props.bg, sky.top);
 assert.ok(window.nodes.some((/** @type {any} */ node) => node.props['loop:opacity']));
}
assert.equal(new Set(['epower-thanos-app', 'compound-powers', 'mythos'].map(name => T.themeFor({ name }).kind)).size, 3);
office.room = Office.prototype.room;
const wallAgents = [{ address: 'a', pane: 'pane-a', space_name: 'Alice', status: 'idle' }, { address: 'remote/t1', pane: 'pane-r', space_name: 'Remote', status: 'blocked' }];
office.at.a = { spot: 'couch' }; office.party = { start: Date.now() }; office.weather = null;
const wall = office.room(1200, 250, T.officeGeometry(1200, 250, 3, { name: 'mythos' }), { top: '#abc', bottom: '#def' }, wallAgents, [{ address: 'a', turn: 9 }, { address: 'child', parent: 'a', state: 'live' }], Date.now(), 'winter');
/** @param {any} node @returns {string} */
const text = node => typeof node === 'string' ? node : (node?.nodes ?? []).map(text).join(' ');
const wallRoot = { nodes: wall };
const numberAt = (/** @type {string} */ id) => Number(text(find(wallRoot, id)).match(/\d+\s*$/)?.[0]);
assert.equal(numberAt('office-count-working'), 0); assert.equal(numberAt('office-count-blocked'), 1);
assert.equal(numberAt('office-count-idle'), 0); assert.equal(numberAt('office-count-napping'), 1); assert.equal(numberAt('office-count-interns'), 1);
assert.ok(find(wallRoot, 'office-service-wall'));
const originalWallProject = office.currentProject;
office.currentProject = { ...originalWallProject, projectKey: 'local:test', machine: null };
office.wallCards['local:test'] = { t1: { id: 't1', name: 'web', status: 'running', urls: ['http://localhost:8081/'], qr: Array.from({ length: 21 }, () => Array(21).fill(true)) } };
const serviceWall = { nodes: office.room(1400, 250, T.officeGeometry(1400, 250, 3, office.currentProject), { top: '#abc', bottom: '#def' }, [], [], Date.now(), null) };
assert.ok(text(serviceWall).includes('http://localhost:8081/'));
assert.ok(find(serviceWall, 'office-wall-qr'));
const wallBoard = find(serviceWall, 'office-service-wall');
const wallFixtures = find(serviceWall, 'wall-fixtures');
assert.equal(wallBoard.props.left + wallBoard.props.w + 12, wallFixtures.props.left);
office.wallCards['local:test'].t1.qr = Array.from({ length: 37 }, () => Array(37).fill(true));
const compactWall = { nodes: office.room(1400, 209, T.officeGeometry(1400, 209, 3, office.currentProject), { top: '#abc', bottom: '#def' }, [], [], Date.now(), null) };
assert.ok(find(compactWall, 'office-wall-qr').props.size >= 90);
office.wallCards['local:test'] = {
  web: { id: 'web', name: 'web', urls: ['http://localhost:8081/', 'http://192.0.2.1:8081/'] },
  drn: { id: 'drn', name: 'drn', urls: ['http://192.0.2.1:3000/'], qr: Array.from({ length: 21 }, () => Array(21).fill(true)) },
};
const pairedWall = { nodes: office.room(1400, 250, T.officeGeometry(1400, 250, 3, office.currentProject), { top: '#abc', bottom: '#def' }, [], [], Date.now(), null) };
assert.ok(text(pairedWall).includes('http://192.0.2.1:3000/'));
assert.ok(text(pairedWall).includes('http://localhost:8081/'));
assert.ok(text(pairedWall).includes('drn'));
office.wallExtras = { 'local:test': [{ id: 'goal:t1', kind: 'goal', name: '当前会话目标', text: '修复二维码', tasks: [{ text: '检查二维码', status: 'done' }, { text: '验证长任务可以换行显示', status: 'in_progress' }] }, { id: 'agent:1', kind: 'note', name: '关键结论', text: '接口已确认', published: true }, { id: 'agent:2', kind: 'file', name: '可视化报告', path: '/tmp/report.html', source: 'Agent · t1', published: true }] };
const extendedWall = { nodes: office.room(1600, 250, T.officeGeometry(1600, 250, 3, office.currentProject), { top: '#abc', bottom: '#def' }, [], [], Date.now(), null) };
assert.ok(text(extendedWall).includes('修复二维码'));
assert.ok(text(extendedWall).includes('接口已确认'));
assert.ok(text(extendedWall).includes('可视化报告'));
assert.ok(text(extendedWall).includes('终端原码'));
assert.ok(text(extendedWall).includes('Agent · t1'));
const todoBoard = find(extendedWall, 'office-todo-board');
const todoScroll = find(todoBoard, 'office-todo-scroll');
const goalCard = find(extendedWall, 'office-wall-card-0');
assert.ok(todoScroll && find(todoScroll, 'office-todo-0') && find(todoScroll, 'office-todo-1'));
assert.ok(text(todoScroll).includes('检查二维码') && text(todoScroll).includes('验证长任务可以换行显示'));
assert.ok(!text(goalCard).includes('检查二维码'));
assert.ok(!text(extendedWall).includes('点击查看全部'));
let scrollStopped = false;
todoBoard.props.on_scroll_wheel({}, { stop_propagation() { scrollStopped = true; } });
assert.equal(scrollStopped, true);
const fileCard = find(extendedWall, 'office-wall-card-4');
assert.ok(fileCard && typeof fileCard.props.on_click === 'function');
let stopped = false;
fileCard.props.on_click({}, { stop_propagation() { stopped = true; }, spawn(fn) { fn({ notify() {} }); } });
assert.equal(stopped, true);
assert.deepEqual(openedFiles.at(-1), { command: 'open', args: ['/tmp/report.html'] });
office.currentProject = originalWallProject;
assert.ok(text(wallRoot).includes(wallAgents[0].space_name));
assert.ok(find(wallRoot, 'office-party')); assert.ok(find(wallRoot, 'call-remote/t1'));
office.party = null;
const previousProject = office.currentProject;
office.currentProject = { ...previousProject, members: [] };
const emptyWall = { nodes: office.room(1200, 250, T.officeGeometry(1200, 250, 0, office.currentProject), { top: '#abc', bottom: '#def' }, [], [], Date.now(), null) };
assert.ok(find(emptyWall, 'employee-cat')); assert.ok(text(emptyWall).includes('Office Cat'));
office.currentProject = { ...previousProject, members: [member('shell', 'tab', 'space')] };
const shellWall = { nodes: office.room(1200, 250, T.officeGeometry(1200, 250, 0, office.currentProject), { top: '#abc', bottom: '#def' }, [], [], Date.now(), null) };
assert.equal(find(shellWall, 'employee-cat'), undefined);
office.currentProject = previousProject;
for (const when of ['newyear', 'valentine', null]) {
 const other = { nodes: office.room(1200, 250, T.officeGeometry(1200, 250, 3, { name: 'mythos' }), { top: '#abc', bottom: '#def' }, [], [], Date.now(), when) };
 assert.equal(Boolean(find(other, 'office-season-banner')), Boolean(when));
 assert.equal(find(other, 'office-party'), undefined); assert.equal(find(other, 'office-count-napping'), undefined);
}
/** @param {any} node @returns {number} */
function celestialCount(node) { return Number(node?.props?.id === 'office-celestial') + (node?.nodes ?? []).reduce((sum, child) => sum + celestialCount(child), 0); }
for (const name of ['epower-thanos-app', 'compound-powers', 'mythos']) {
 office.currentProject = { id: name, name };
 const g = T.officeGeometry(1200, 250, 3, office.currentProject);
 for (const stars of [false, true]) {
  office.weather = 'clear';
  const sky = { top: '#abc', bottom: '#def', stars };
  for (const occupants of [[], wallAgents]) {
   assert.equal(celestialCount({ nodes: office.room(1200, 250, g, sky, occupants, [], Date.now(), null) }), 1);
  }
 }
 office.weather = 'rain';
 assert.equal(celestialCount({ nodes: office.room(1200, 250, g, { top: '#abc', bottom: '#def', stars: false }, [], [], Date.now(), null) }), 0);
 const spans = [[g.zoneX, A.COUNTER.width], [g.coolerX, A.COOLER.width], [g.couchX, A.COUCH.width]].sort((a, b) => a[0] - b[0]);
 for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][0] + spans[i - 1][1] * g.P);
 assert.ok(40 + g.wallHeight + g.wallStagger <= g.wallBottom);
 assert.ok(g.wallLeft + g.wallWidth <= g.contentWidth);
}
const arrangements = ['epower-thanos-app', 'compound-powers', 'mythos'].map(name => {
 const g = T.officeGeometry(1200, 250, 3, { id: name, name });
 return [g.zoneX, g.coolerX, g.couchX].map(x => Math.sign(x - g.coolerX)).join(',');
});
assert.equal(new Set(arrangements).size, 3);
async function weatherChecks() {
 const oldFetch = global.fetch;
 try {
  const w = new Office(); w.weather = 'rain';
 /** @type {any[]} */
  let replies = [{ ok: true, json: async () => ({ success: true, latitude: 91, longitude: 1 }) }];
  global.fetch = async () => replies.shift();
 /** @type {Promise<void>[]} */ const jobs = []; const context = { spawn(/** @type {(cx:any)=>Promise<void>} */ fn) { jobs.push(fn({ notify() {} })); } };
  w.refreshWeather(context); await jobs.pop(); assert.equal(w.weather, 'rain'); assert.equal(w.where, undefined);
  replies = [{ ok: true, json: async () => ({ success: true, latitude: 31.25, longitude: 121.49 }) }, { ok: false }];
  w.refreshWeather(context); await jobs.pop(); assert.equal(w.weather, 'rain'); assert.deepEqual(w.where, { lat: '31.3', lon: '121.5' });
  replies = [{ ok: true, json: async () => ({ current: {} }) }];
  w.refreshWeather(context); await jobs.pop(); assert.equal(w.weather, 'rain');
  replies = [{ ok: true, json: async () => ({ current: { weather_code: 75 } }) }];
  w.refreshWeather(context); await jobs.pop(); assert.equal(w.weather, 'snow');
 } finally { global.fetch = oldFetch; }
}
const weatherVerification = weatherChecks();
const B = load('../office-building/main.js', { ...env, h_flex: element, theme: () => ({ chrome: '#20232a', foreground: '#eee', muted: '#999' }), props: () => ({}), closeOverlay() { assert.fail('Embedded navigation must not close an overlay'); } });
/** @param {any} node @param {string} id @returns {any} */
function find(node, id) { return node?.props?.id === id ? node : (node?.nodes ?? []).map((/** @type {any} */ child) => find(child, id)).find(Boolean); }
const betaIndex = office.overviewSnapshot.findIndex((/** @type {any} */ room) => room.id === 'beta');
find(B.officeMiniMap(office.overviewSnapshot, 250), `office-mini-room-${betaIndex}`).props.on_click();
scene(23); assert.equal(office.currentProject.id, 'beta');
office.size.width = 500;
const sceneView = find(scene(23), 'office-scene');
sceneView.props.on_scroll_wheel({ delta: { x: 0, y: -100 }, bounds: { width: 500 } }, cx);
assert.equal(office.sceneOffset, 100);
assert.equal(find(scene(23), 'office-scene').nodes[0].props.left, -100);
sceneView.props.on_scroll_wheel({ delta: { x: 0, y: 10000 }, bounds: { width: 500 } }, cx);
assert.equal(office.sceneOffset, 0);
weatherVerification.then(() => console.log('Passed: grounded desk geometry, restored live-state wall fixtures, seasonal conditions, weather error retention, project navigation and day/night lighting.')).catch(error => { console.error(error); process.exitCode = 1; });
