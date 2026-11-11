const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const timeSource = fs.readFileSync(path.join(__dirname, 'session-time.js'), 'utf8');
const { sessionTime, staleSession } = new Function(timeSource.replace(/^export /gm, '') + '\nreturn {sessionTime, staleSession};')();
const now = new Date(2026, 10, 11, 12).getTime();
assert.equal(sessionTime(new Date(2026, 10, 11, 9, 5).getTime(), now), '今天 09:05');
assert.equal(sessionTime(new Date(2026, 10, 10, 8, 6).getTime(), now), '昨天 08:06');
assert.equal(sessionTime(new Date(2026, 10, 9, 17, 7).getTime(), now), '周一 17:07');
assert.equal(sessionTime(new Date(2026, 10, 6, 18, 8).getTime(), now), '上周五 18:08');
assert.equal(sessionTime(new Date(2026, 10, 4, 18).getTime(), now), '11月4日');
assert.equal(sessionTime(null, now), '—');
assert.equal(sessionTime(new Date(2025, 11, 31, 23, 5).getTime(), new Date(2026, 0, 1, 9).getTime()), '昨天 23:05');
assert.equal(staleSession(now - 2 * 86400000, now), false);
assert.equal(staleSession(now - 2 * 86400000 - 1, now), true);
assert.equal(staleSession(null, now), false);
const titleSource = fs.readFileSync(path.join(__dirname, 'tab-title.js'), 'utf8');
const { tabTitle } = new Function(titleSource.replace(/^export /gm, '') + '\nreturn {tabTitle};')();
const titleTab = { id: 'session', name: '1', named: false };
const titlePanes = [{ tab: 'session', terminal: 'lead', title: '◐ π > Office design', program: { agent: true, name: 'Oh My Pi (OMP)', key: 'omp' } }, { tab: 'session', terminal: 'worker', title: 'Worker task' }];
assert.equal(tabTitle(titleTab, titlePanes), 'π > Office design');
assert.equal(tabTitle({ ...titleTab, name: 'Oh My Pi (OMP)', named: true }, titlePanes), 'π > Office design');
assert.equal(tabTitle({ ...titleTab, name: 'Custom tab', named: true }, titlePanes), 'Custom tab');
titlePanes[0].title = '◐ π > Updated task';
assert.equal(tabTitle(titleTab, titlePanes), 'π > Updated task');
assert.equal(tabTitle(titleTab, [{ ...titlePanes[0], title: '/repo' }]), '1');
assert.equal(tabTitle(titleTab, [{ ...titlePanes[0], tab: 'other' }]), '1');
const rulesSource = fs.readFileSync(path.join(__dirname, 'project-bindings.js'), 'utf8');
const homeSource = fs.readFileSync(path.join(__dirname, 'space-home.js'), 'utf8');
const homeRules = new Function(homeSource.replace(/^export /gm, '') + '\nreturn {homeTab,sessionTabs,retainSpace};')();
/** @type {typeof import('./project-bindings.js')} */
const rules = new Function(...Object.keys(homeRules), rulesSource.replace(/^import .*;\n/gm, '').replace(/^export /gm, '') + '\nreturn {normalizePath,projectKey,parseWorktrees,resolveProject,bindingFor,primarySpace,worktreeFor,rememberWorktrees,launchProject,mergeBindings,consumeProjectRequest,homeTab,sessionTabs,retainSpace};')(...Object.values(homeRules));
const source = fs.readFileSync(path.join(__dirname, 'path-groups.js'), 'utf8');
/** @type {typeof import('./path-groups.js')} */
const { groupPaths } = new Function(...Object.keys(rules), source.replace(/^import .*;\n/gm, '').replace(/^export /gm, '') + '\nreturn {groupPaths};')(...Object.values(rules));
/** @param {string} id @param {number} [changed_at] @returns {any} */
const tab = (id, changed_at = 0) => ({ id, changed_at, settled: false });
/** @param {string} id @param {any[]} tabs @param {string|null} [machine] @returns {any} */
const space = (id, tabs, machine = null) => ({ id, folder: '/repo', name: id, named: false, machine, tabs, active: false });
/** @param {string} id @param {string} tab @param {string} [cwd] @returns {any} */
const pane = (id, tab, cwd = '/repo') => ({ pane: id, terminal: id, tab, cwd });
const spaces = [space('a', [tab('a', 100), tab('split', 200)]), space('b', [tab('b', 300)]), space('remote', [tab('remote', 400)], 'server')];
const panes = [pane('a', 'a'), pane('split-main', 'split'), pane('split-feature', 'split', '/worktrees/feature'), pane('b', 'b'), pane('remote', 'remote')];
const trees = [{ path: '/repo', branch: 'main', name: 'main' }, { path: '/worktrees/feature', branch: 'feature', name: 'feature' }];
/** @type {Record<string,any>} */
const bindings = Object.fromEntries(spaces.map(sp => [sp.id, { projectKey: rules.projectKey(sp.machine, '/repo'), root: '/repo', name: 'repo', machine: sp.machine, git: true, worktrees: trees, primarySpace: sp.machine ? 'remote' : 'a', terminalWorktrees: {} }]));
const raw = new Map(panes.map(p => [p.terminal, { address: p.terminal, cwd: p.cwd, status_ms: p.pane === 'split-feature' ? 500 : 0 }]));
for (const sp of spaces) rules.rememberWorktrees(sp, bindings[sp.id], panes, raw);
const original = JSON.stringify({ spaces, panes });
const groups = groupPaths(spaces, panes, bindings, raw);
assert.deepEqual(groups.map(g => [g.space.id, g.machine, g.folder]), [['a', null, '/repo'], ['b', null, '/repo'], ['remote', 'server', '/repo']]);
assert.deepEqual(groups.map(g => g.entries.map(e => e.tab.id)), [['split', 'a'], ['b'], ['remote']]);
assert.deepEqual(groupPaths([...spaces].reverse(), panes, bindings, raw).map(g => g.id), ['remote', 'b', 'a']);
assert.deepEqual(groups[0].entries[0].members.map(p => p.pane), ['split-feature', 'split-main']);
assert.deepEqual(new Set(groups[0].entries[0].worktrees.keys()), new Set(['/worktrees/feature', '/repo']));
const singleTreeBindings = { a: { ...bindings.a, worktrees: [trees[0]] } };
const singleTreePane = groupPaths([spaces[0]], panes, singleTreeBindings, raw)[0].entries.find(entry => entry.tab.id === 'a').members[0];
assert.equal(singleTreePane.worktree, null);
assert.equal(singleTreePane.gitTree.branch, 'main');
const detached = groupPaths([spaces[0]], panes, { a: { ...singleTreeBindings.a, worktrees: [{ ...trees[0], branch: '' }] } }, raw)[0].entries.find(entry => entry.tab.id === 'a').members[0];
assert.equal(detached.gitTree.branch, '');
assert.equal(groups.find(group => group.id === 'b').duplicateOf, 'a');
assert.notEqual(groups[0].projectKey, groups[2].projectKey);
assert.equal(JSON.stringify({ spaces, panes }), original);
panes[0].cwd = '/completely/different/repository'; spaces[0].name = 'auto-name-after-cd';
const afterCd = groupPaths(spaces, panes, JSON.parse(JSON.stringify(bindings)), raw);
assert.deepEqual(afterCd.map(g => [g.id, g.folder, g.name, g.entries.map(e => e.tab.id)]), groups.map(g => [g.id, g.folder, g.name, g.entries.map(e => e.tab.id)]));
const unbound = groupPaths([space('a', [tab('a')])], [pane('x', 'a', '/one/shared'), pane('y', 'a', '/two/shared')], {}, new Map());
assert.deepEqual(unbound.map(g => g.folder), ['/repo']);
assert.deepEqual(unbound[0].entries[0].members.map(p => p.pane), ['x', 'y']);
const multiTab = groupPaths([space('a', [tab('first'), tab('second')])], [pane('one', 'first', '/one'), pane('two', 'second', '/two')], bindings, new Map());
assert.deepEqual(multiTab.map(g => g.entries.map(e => e.tab.id)), [['first', 'second']]);
assert.deepEqual(groupPaths([space('a', [{ ...tab('a'), settled: true }])], [pane('a', 'a')], bindings, raw).map(g => g.entries.length), [0]);
assert.deepEqual(groupPaths([], [], bindings, raw), []);
const emptySpace = space('retained', [tab('space-home')]);
const emptyPanes = [{ pane: 'home', tab: 'space-home', terminal: null, mod: 'space-home' }];
const emptyGroups = groupPaths([emptySpace], emptyPanes, {}, new Map());
assert.equal(emptyGroups.length, 1, '清空会话后仍发布同一个 Space');
assert.equal(emptyGroups[0].id, 'retained');
assert.deepEqual(emptyGroups[0].entries, [], '首页不能混入会话列表和办公室成员');
assert.equal(groupPaths([emptySpace], [...emptyPanes, pane('mixed-terminal', 'space-home')], {}, new Map())[0].entries.length, 1, '首页被分屏后不能隐藏真实终端');
assert.equal(rules.normalizePath('/repo/./child/../'), '/repo');
for (const mod of ['agent-columns', 'agent-columns-spaces']) {
  const helper = fs.readFileSync(path.join(__dirname, '..', mod, 'sidebar-collapse.js'), 'utf8');
  let tree = { id: 'root', children: [{ id: 'spaces', size: { weight: 1.5 }, min: 130 }, { id: 'agents', size: { px: 420 }, min: 220, max: 900 }] };
  const saved = new Map([['layout', 'office']]);
  /** @param {string} command @param {{layout: any}} args */
  const dispatch = (command, args) => { assert.equal(command, 'layout.set'); tree = args.layout; };
  /** @param {string} key */
  const get = key => saved.get(key);
  /** @param {string} key @param {any} value */
  const set = (key, value) => saved.set(key, JSON.parse(JSON.stringify(value)));
  const { toggleBlock, blockCollapsed } = new Function('layout', 'run', 'shared', 'setShared', helper.replace(/^import .*;\n/gm, '').replace(/export /g, '') + '\nreturn { toggleBlock, blockCollapsed };')(
    () => tree, dispatch, get, set,
  );
  const before = structuredClone(tree);
  toggleBlock('spaces');
  assert.equal(blockCollapsed('spaces'), true);
  assert.deepEqual(tree.children[0], { id: 'spaces', size: { px: 38 }, min: 38, max: 38 });
  assert.deepEqual(tree.children[1], before.children[1]);
  toggleBlock('agents');
  assert.equal(blockCollapsed('agents'), true);
  toggleBlock('spaces');
  assert.deepEqual(tree.children[0], before.children[0]);
  toggleBlock('agents');
  assert.deepEqual(tree, before);
  toggleBlock('missing');
  assert.deepEqual(tree, before);
}
async function gitProjectChecks() {
  const os = require('node:os'); const { execFileSync } = require('node:child_process');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-project-rules-'));
  try {
    const repo = path.join(temp, 'repo with spaces'), wt = path.join(temp, 'feature tree'), alias = path.join(temp, 'alias'), plain = path.join(temp, 'plain');
    fs.mkdirSync(repo); fs.mkdirSync(plain);
    execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', repo]);
    execFileSync('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'fixture']);
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'feature', wt]);
    fs.symlinkSync(repo, alias);
    /** @type {typeof import('herdr').exec} */
    const execute = async (command, args, options) => {
      try { return { code: 0, stdout: execFileSync(command, args, { cwd: options?.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), stderr: '' }; }
      catch (error) { return { code: error.status || 1, stdout: String(error.stdout || ''), stderr: String(error.stderr || '') }; }
    };
    const main = await rules.resolveProject(repo, null, execute), linked = await rules.resolveProject(wt, null, execute), throughAlias = await rules.resolveProject(alias, null, execute);
    assert.equal(linked.projectKey, main.projectKey); assert.equal(throughAlias.projectKey, main.projectKey);
    assert.equal(main.root, fs.realpathSync(repo)); assert.equal(linked.initialFolder, fs.realpathSync(wt));
    assert.equal(main.worktrees.find(tree => tree.name === 'feature').path, fs.realpathSync(wt));
    assert.notEqual((await rules.resolveProject(repo, 'remote-machine', execute)).projectKey, main.projectKey);
    assert.equal((await rules.resolveProject(plain, null, execute)).root, fs.realpathSync(plain));
    /** @type {any[]} */ const scene = [];
    /** @type {any[]} */ const scenePanes = [];
    /** @type {Record<string,any>} */ const registry = {};
    let focusPane = '', selected = '';
    /** @type {any} */
    const api = { spaces: () => scene, panes: () => scenePanes, exec: execute, pickFolder: async () => null,
      run(name, args) {
        if (name === 'space.new') {
          const id = `space-${scene.length}`, host = { ...space(id, [tab(`tab-${scene.length}`)], args.machine || null), folder: args.folder };
          scene.push(host); scenePanes.push(pane(`pane-${scenePanes.length}`, host.tabs[0].id, args.folder)); selected = id;
        } else if (name === 'space.select') selected = args.id;
        else if (name === 'tab.new') { const host = scene.find(sp => sp.id === args.space); const child = tab(`tab-${scenePanes.length}`); host.tabs.push(child); scenePanes.push(args.mod ? { pane: `pane-${scenePanes.length}`, tab: child.id, terminal: null, mod: args.mod } : pane(`pane-${scenePanes.length}`, child.id, args.folder)); }
        else if (name === 'pane.focus') focusPane = args.pane;
        else if (name === 'terminal.open') scenePanes.push(pane(`pane-${scenePanes.length}`, scenePanes.find(p => p.pane === focusPane).tab, args.folder));
        return null;
      } };
    await rules.launchProject({ action: 'open-project', folder: alias }, api, registry);
    const owner = scene[0];
    await rules.launchProject({ action: 'open-project', folder: wt }, api, registry);
    assert.equal(scene.length, 1); assert.equal(selected, owner.id);
    await rules.launchProject({ action: 'open-worktree', folder: wt }, api, registry);
    assert.equal(scene.length, 1); assert.equal(owner.tabs.length, 2); assert.equal(scenePanes[1].cwd, linked.initialFolder);
    scenePanes[0].cwd = plain;
    await rules.launchProject({ action: 'split', space: owner.id, pane: scenePanes[0].pane }, api, registry);
    assert.equal(scenePanes[2].tab, scenePanes[0].tab); assert.equal(scenePanes[2].cwd, main.root);
    const before = JSON.stringify({ scene, scenePanes });
    await assert.rejects(rules.launchProject({ action: 'new-tab', space: owner.id, folder: plain }, api, registry), Error);
    assert.equal(JSON.stringify({ scene, scenePanes }), before);
    scene.push({ ...owner, id: 'legacy-duplicate', tabs: [] }); registry['legacy-duplicate'] = { ...registry[owner.id] };
    await rules.launchProject({ action: 'open-project', folder: repo }, api, registry);
    assert.equal(scene.length, 2); assert.equal(selected, owner.id); assert.equal(scene[1].tabs.length, 0);
    assert.equal(await rules.launchProject({ action: 'pick-project' }, api, registry), false);
    assert.equal(scene.length, 2);
    const tabCount = owner.tabs.length;
    await rules.launchProject({ action: 'open-project', folder: repo, argv: ['fixture-agent'] }, api, registry);
    assert.equal(scene.length, 2); assert.equal(owner.tabs.length, tabCount + 1);
    const latest = JSON.parse(JSON.stringify(registry)), proposed = JSON.parse(JSON.stringify(registry));
    latest[owner.id].terminalWorktrees = { previous: main.root };
    proposed[owner.id].terminalWorktrees = { added: linked.initialFolder };
    proposed[owner.id].worktrees = [...main.worktrees, { path: '/new-tree', branch: 'new', name: 'new' }];
    const merged = rules.mergeBindings(latest, proposed);
    assert.deepEqual(merged[owner.id].terminalWorktrees, { added: linked.initialFolder, previous: main.root });
    assert.equal(merged[owner.id].worktrees.at(-1).path, '/new-tree');
    registry[owner.id].folders = [
      { ...main, path: main.root },
      { ...(await rules.resolveProject(plain, null, execute)), path: fs.realpathSync(plain) },
    ];
    await assert.doesNotReject(rules.launchProject({ action: 'new-tab', space: owner.id, folder: plain, argv: ['fixture-agent'] }, api, registry), 'Space 中登记的另一个项目目录必须可以启动 Agent');
    assert.equal(scenePanes.at(-1).cwd, fs.realpathSync(plain));
    /** @type {Map<string,any>} */
    const state = new Map([['workspace.project-owner', 'old'], ['workspace.project-requests', [{ id: 'handoff', action: 'new-tab', space: owner.id }]]]);
    /** @type {any} */ let release;
    const gate = new Promise(resolve => { release = resolve; });
    const bus = { ...api, shared: (/** @type {string} */ key) => state.get(key), setShared: (/** @type {string} */ key, /** @type {any} */ value) => { state.set(key, value); return null; } };
    const countBeforeHandoff = owner.tabs.length;
    const oldJob = rules.consumeProjectRequest({ ...bus, exec: async (...args) => { await gate; return execute(...args); } }, registry, 'old');
    state.set('workspace.project-owner', 'new'); release(); await oldJob;
    assert.equal(owner.tabs.length, countBeforeHandoff); assert.equal(state.get('workspace.project-requests').length, 1);
    await rules.consumeProjectRequest(bus, registry, 'new');
    assert.equal(owner.tabs.length, countBeforeHandoff + 1); assert.deepEqual(state.get('workspace.project-requests'), []);
    for (const phase of ['picking', 'dispatching']) {
      const stale = { id: `stale-${phase}`, action: 'pick-project' };
      const waiting = { id: `waiting-${phase}`, action: 'create-space', folders: [repo] };
      state.set('workspace.project-inflight', { id: stale.id, owner: 'dead-owner', phase });
      state.set('workspace.project-requests', [stale, waiting, { action: 'new-tab', space: owner.id, argv: ['fixture-agent'] }]);
      const beforeRecovery = JSON.stringify({ scene, scenePanes });
      const interrupted = await rules.consumeProjectRequest(bus, registry, 'new');
      assert.equal(interrupted?.id, waiting.id, '失效实例的文件夹选择或派发不能永久锁住后来的保存弹窗');
      assert.equal(interrupted.ok, false);
      assert.deepEqual(state.get('workspace.project-requests'), [], '恢复时取消积压操作，不能突然启动旧 Agent 或重复创建 Space');
      assert.equal(state.get('workspace.project-inflight'), null);
      assert.equal(JSON.stringify({ scene, scenePanes }), beforeRecovery);
      state.set('workspace.project-requests', [{ id: `retry-${phase}`, action: 'update-folders', space: owner.id, folders: [plain] }]);
      assert.equal((await rules.consumeProjectRequest(bus, registry, 'new')).ok, true, '取消旧请求后新保存可以执行');
    }
    const nested = path.join(repo, '中文子目录'); fs.mkdirSync(nested);
    let queuedCreation, creationTicks = 0, creationDispatches = 0;
    const delayedApi = { ...api,
      run(name, args) { if (name === 'space.new') { queuedCreation = args; creationDispatches++; return null; } return api.run(name, args); },
      async sleep() { if (++creationTicks === 2) api.run('space.new', queuedCreation); },
    };
    await assert.doesNotReject(rules.launchProject({ action: 'create-space', name: '跨项目任务', folders: [repo, plain, alias, nested] }, delayedApi, registry), '原生命令返回后下一帧才出现 Space，不能提前报创建失败');
    assert.equal(creationDispatches, 1, '等待确认期间不能重复发送创建命令');
    assert.equal(creationTicks, 2);
    const multi = scene.at(-1), multiBinding = registry[multi.id];
    assert.equal(scene.length, 3);
    assert.deepEqual(multiBinding.folders.map(item => item.path), [fs.realpathSync(repo), fs.realpathSync(plain), fs.realpathSync(nested)]);
    await rules.launchProject({ action: 'new-tab', space: multi.id, folder: nested, argv: ['fixture-agent'] }, api, registry);
    assert.equal(scenePanes.at(-1).cwd, fs.realpathSync(nested), '选中的子文件夹不能被替换为 Git 根目录');
    const beforeEdit = JSON.stringify({ scene, scenePanes });
    const previousBinding = JSON.stringify(registry[multi.id]);
    await assert.rejects(rules.launchProject({ action: 'update-folders', space: multi.id, folders: [plain, path.join(temp, 'missing')] }, api, registry));
    assert.equal(JSON.stringify(registry[multi.id]), previousBinding, '无效文件夹不产生部分保存');
    await rules.launchProject({ action: 'update-folders', space: multi.id, folders: [plain] }, api, registry);
    assert.equal(JSON.stringify({ scene, scenePanes }), beforeEdit, '移除只改变清单，不能改变或关闭已有会话');
    await rules.launchProject({ action: 'new-tab', space: multi.id }, api, registry);
    assert.equal(scenePanes.at(-1).cwd, fs.realpathSync(plain));
    await assert.rejects(rules.launchProject({ action: 'new-tab', space: multi.id, folder: repo }, api, registry));
    await assert.rejects(rules.launchProject({ action: 'update-folders', space: multi.id, folders: [] }, api, registry));
    const countBeforeInvalid = scene.length;
    await assert.rejects(rules.launchProject({ action: 'create-space', folders: [plain, path.join(temp, 'missing')] }, api, registry));
    assert.equal(scene.length, countBeforeInvalid);
    await rules.launchProject({ action: 'create-space', folders: [plain] }, api, registry);
    assert.equal(scene.length, countBeforeInvalid + 1, '相同目录可用于不同 Space');
    const reloaded = JSON.parse(JSON.stringify(registry));
    assert.deepEqual(reloaded[multi.id].folders.map(item => item.path), [fs.realpathSync(plain)]);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
gitProjectChecks().then(() => console.log('Passed: stable Space binding across cd/reload, real Git/worktree/symlink identity, machine isolation, project reuse without merging duplicates, bound Tab/split launch and independent collapse.')).catch(error => { console.error(error); process.exitCode = 1; });
