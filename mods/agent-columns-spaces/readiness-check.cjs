const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function load(file, exports, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export default /gm, '').replace(/^export /gm, '');
  return new Function(...Object.keys(imports), `${source}\nreturn {${exports}};`)(...Object.values(imports));
}
const home = load('space-home.js', 'homeTab,sessionTabs,retainSpace');
const rules = load('project-bindings.js', 'resolveProject,readWorktrees,primarySpace,rememberWorktrees,consumeProjectRequest,mergeBindings,projectKey,bindingFor,worktreeFor', home);
const groups = load('path-groups.js', 'groupPaths,parentAgent', { ...home, ...rules });
const titles = load('tab-title.js', 'clean,tabTitle');

// Existing three-folder, non-Git binding schema; no dependency on these paths existing on the test host.
const paths = ['/home/fixture/Documents/workspace', '/home/fixture/Documents', '/home/fixture/Downloads'];
function fixture(machine = null) {
  const folders = paths.map(folder => ({ path: folder, projectKey: rules.projectKey(machine, folder), root: folder,
    name: folder.split('/').at(-1), git: false, worktrees: [{ path: folder, branch: '', name: folder.split('/').at(-1) }] }));
  return { version: 1, bindings: { calvin: { ...folders[0], machine, initialFolder: paths[0], folders,
    primarySpace: 'calvin', terminalWorktrees: {}, terminalFolders: {} } } };
}

function harness({ machine = null, saved = fixture(machine), readFailure, failRead = false, git = false } = {}) {
  let text = JSON.stringify(saved, null, 2) + '\n', props = { coordinator: true };
  const state = new Map([['workspace.project-owner', 'unmounted-sidebar'], ['workspace.project-status', { ready: false, error: 'null' }]]);
  const scene = [{ id: 'calvin', folder: paths[0], machine, name: 'calvin', active: true,
    tabs: [{ id: 'session', active: true }, { id: 'home' }] }];
  const panes = [{ pane: 'target', tab: 'session', terminal: 'terminal', cwd: paths[0], focused: true },
    { pane: 'home', tab: 'home', mod: 'space-home' }, { pane: 'foreign', tab: 'foreign-tab', terminal: 'other' }];
  const commands = [], executions = [], warnings = [], pending = [], timers = [];
  let writes = 0, writeFailure = false;
  let clock = Date.now();
  let worktreeText = `worktree ${paths[0]}\0branch refs/heads/main\0\0`;
  const api = {
    ...home, ...rules, ...groups, ...titles, View: class {}, div: () => ({ empty: true }),
    Date: class extends Date { static now() { return clock; } },
    props: () => props, placement: () => null, blockCollapsed: () => false,
    spaces: () => scene, panes: () => panes, terminals: () => [{ address: 'terminal', cwd: paths[0] }],
    machines: () => [{ name: machine, layout: 'ready' }],
    shared: key => state.get(key), setShared: (key, value) => { state.set(key, value); },
    appHome: () => '/fixture', home: () => paths[0],
    readTextFile: async () => { if (failRead) throw readFailure; return text; },
    writeTextFile: async (_file, next, expected) => {
      if (writeFailure) throw writeFailure === 'null' ? 'null' : null;
      assert.equal(expected, text, 'persistence must retain compare-and-swap protection'); text = next; writes++;
    },
    exec: async (command, args, options) => {
      executions.push({ command, args, options });
      assert.equal(options.on, machine, 'folder resolution must use the target machine');
      if (options.cwd === '/missing') return { code: 1, stdout: '', stderr: 'No such directory' };
      if (command === 'pwd') return { code: 0, stdout: `${options.cwd}\n`, stderr: '' };
      assert.equal(command, 'git');
      if (git) return { code: 0, stdout: args[0] === 'worktree' ? worktreeText : `${paths[0]}\n`, stderr: '' };
      return { code: 128, stdout: '', stderr: 'fatal: not a git repository' };
    },
    run: (name, args) => { commands.push({ name, args }); }, pickFolder: async () => null,
    notify: warning => warnings.push(warning), closeOverlay: () => {}, window: () => ({ platform: 'macos' }),
    nextCommand: () => new Promise(() => {}),
  };
  const retained = load('retained-parts.js', 'RetainedParts', { View: api.View, div: api.div });
  const { SpacesTabs } = load('main.js', 'SpacesTabs', { ...api, ...retained });
  const { NewMenu } = load('../agent-columns-new-menu/main.js', 'NewMenu', api);
  const cx = { spawn: task => pending.push(Promise.resolve().then(() => task(cx))), notify() {}, sleep: async () => {},
    timer: { every: (ms, callback) => timers.push({ ms, callback }) },
    focus_handle: () => { throw new Error('headless coordinator must not allocate UI focus handles'); } };
  const service = new SpacesTabs();
  async function drain() { while (pending.length) await pending.shift(); }
  return { state, commands, executions, warnings, service, NewMenu, cx, drain, timers,
    read: () => JSON.parse(text), writes: () => writes,
    advance: ms => { clock += ms; },
    worktrees: text => { worktreeText = text; },
    failWrite: value => { writeFailure = value; },
    async tick() { timers.find(timer => timer.ms === 1000).callback(cx); await drain(); },
    mountSidebar() {
      props = {};
      const sidebar = new SpacesTabs();
      sidebar.init({}, { ...cx, spawn() {}, focus_handle: () => ({ is_focused: () => false }) });
      props = { coordinator: true };
    },
  };
}

async function checkWriteFailure(failure) {
  const h = harness();
  h.failWrite(failure);
  h.service.init({}, h.cx); await h.drain();
  assert.equal(h.state.get('workspace.project-status').ready, false);
  assert.match(h.state.get('workspace.project-status').error, /文件夹服务/);
  assert.equal(h.writes(), 0);
  assert.deepEqual(h.read().bindings.calvin.folders, fixture().bindings.calvin.folders);
  h.failWrite(false); await h.tick();
  assert.equal(h.state.get('workspace.project-status').ready, true, 'a later successful persistence restores readiness');
}

async function check() {
  await checkWriteFailure(true);
  await checkWriteFailure('null');
  for (const name of ['office', 'agent-columns']) {
    const layout = JSON.parse(fs.readFileSync(path.join(__dirname, '../../layouts', `${name}.json`), 'utf8'));
    const service = layout.children.filter(node => node.content?.props?.coordinator === true);
    assert.equal(service.length, 1, `${name} must mount exactly one coordinator outside the hideable sidebar`);
    assert.equal(service[0].content.mod, 'agent-columns-spaces');
    assert.equal(service[0].hidden, undefined);
    assert.equal(service[0].size.px, 0);
  }
  const gitSaved = fixture();
  gitSaved.bindings.calvin.git = true;
  gitSaved.bindings.calvin.folders[0].git = true;
  const metadata = harness({ saved: gitSaved, git: true });
  metadata.service.init({}, metadata.cx); await metadata.drain();
  assert.deepEqual(metadata.executions.map(call => call.args), [['worktree', 'list', '--porcelain', '-z']], 'periodic metadata uses the validated root without resolving it again');
  metadata.advance(6000); await metadata.tick();
  assert.equal(metadata.executions.length, 1, 'unchanged project metadata is not polled every five seconds');
  metadata.worktrees(`worktree ${paths[0]}\0branch refs/heads/main\0\0worktree /feature\0branch refs/heads/feature\0\0`);
  metadata.advance(30000); await metadata.tick();
  assert.equal(metadata.executions.length, 2);
  assert.equal(metadata.service.bindings.calvin.worktrees[1].branch, 'feature', 'external worktree changes remain discoverable');
  for (const machine of [null, 'remote-machine']) {
    const h = harness({ machine });
    h.service.init({}, h.cx);
    assert.notEqual(h.state.get('workspace.project-owner'), 'unmounted-sidebar');
    assert.equal(h.state.get('workspace.project-status').ready, false, 'readiness stays gated during load');
    assert.deepEqual(h.service.render(), { empty: true });
    await h.drain();
    assert.equal(h.state.get('workspace.project-status').ready, true, 'hidden sidebar must not strand persisted null failure');
    assert.deepEqual(h.state.get('workspace.project-bindings').calvin.folders.map(folder => folder.path), paths);
    assert.deepEqual(h.read().bindings.calvin.folders, fixture(machine).bindings.calvin.folders);
    const owner = h.state.get('workspace.project-owner');
    h.mountSidebar();
    assert.equal(h.state.get('workspace.project-owner'), owner, 'sidebar copies cannot take ownership');
    assert.deepEqual(h.commands, [], 'initializing a binding with an existing home launches nothing');
    for (const folder of paths) {
      const menu = new h.NewMenu();
      menu.space = { id: 'calvin', machine, tabs: [{ id: 'session' }] };
      menu.pane = 'target'; menu.folder = folder; menu.direction = 'down';
      menu.create();
      assert.equal(h.state.get('workspace.project-requests').length, 1);
      await h.tick();
      assert.deepEqual(h.commands.slice(-2), [{ name: 'pane.focus', args: { pane: 'target' } },
        { name: 'terminal.open', args: { place: 'down', folder } }]);
      assert.deepEqual(h.state.get('workspace.project-requests'), []);
    }
    for (const request of [
      { folder: '/missing' }, { folder: '/unregistered' }, { pane: 'foreign', folder: paths[0] }, { space: 'closed', folder: paths[0] },
    ]) {
      const count = h.commands.length;
      h.state.set('workspace.project-requests', [{ id: JSON.stringify(request), action: 'split', space: 'calvin', pane: 'target', ...request }]);
      await h.tick();
      assert.equal(h.state.get('workspace.project-result').ok, false);
      assert.equal(h.commands.length, count, 'invalid path, membership and target must remain rejected');
    }
    h.state.set('workspace.project-status', { ready: false, error: 'load failed' });
    const menu = new h.NewMenu(); menu.create();
    assert.deepEqual(h.state.get('workspace.project-requests'), [], 'launcher must retain the readiness gate');
  }
  for (const failure of [null, 'null']) {
    const h = harness({ failRead: true, readFailure: failure });
    h.service.init({}, h.cx); await h.drain();
    assert.equal(h.state.get('workspace.project-status').ready, false);
    assert.match(h.state.get('workspace.project-status').error, /文件夹服务/);
    assert.equal(h.writes(), 0, 'failed loading must never replace saved folders');
  }
  const corrupt = harness({ saved: { version: 1, bindings: { calvin: { root: paths[0] } } } });
  corrupt.service.init({}, corrupt.cx); await corrupt.drain();
  assert.equal(corrupt.state.get('workspace.project-status').ready, false);
  assert.match(corrupt.state.get('workspace.project-status').error, /格式不正确/);
  assert.equal(corrupt.writes(), 0);
  console.log('Passed: persistent coordinator, three-folder split queue, machine scope, readiness and target/path safeguards.');
}
check().catch(error => { console.error(error); process.exitCode = 1; });
