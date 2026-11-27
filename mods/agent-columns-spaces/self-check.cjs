const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const timeSource = fs.readFileSync(path.join(__dirname, 'session-time.js'), 'utf8');
const { sessionTime, staleSession, projectActive } = new Function(timeSource.replace(/^export /gm, '') + '\nreturn {sessionTime, staleSession, projectActive};')();
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
const project = { tabs: [{ id: 'activity' }] };
const members = [{ pane: 'p', tab: 'activity', terminal: 't' }];
const state = new Map([['p', 'working']]);
const statuses = new Map([['t', { status_ms: now - 86400001 }]]);
const noCore = () => null;
assert.equal(projectActive(project, members, state, statuses, noCore, now), true, 'working remains emphasized regardless of age');
state.set('p', 'done');
assert.equal(projectActive(project, members, state, statuses, noCore, now), false, 'old completion is not emphasized');
statuses.get('t').status_ms = now - 86400000;
assert.equal(projectActive(project, members, state, statuses, noCore, now), true, 'completion within one day is emphasized');
state.set('p', 'idle');
assert.equal(projectActive(project, members, state, statuses, noCore, now), true, 'recent idle is emphasized');
statuses.get('t').status_ms = 0;
assert.equal(projectActive(project, members, state, statuses, noCore, now), false, 'missing timestamp is not recent');
project.tabs[0].changed_at = now - 60000;
assert.equal(projectActive(project, members, state, statuses, noCore, now), true, 'recent tab activity substitutes for an unavailable session timestamp');
state.delete('p');
members[0].program = { agent: true };
assert.equal(projectActive(project, members, state, statuses, noCore, now), true, 'recent agent tab stays active when pane status is unavailable');
project.tabs[0].changed_at = now - 86400001;
assert.equal(projectActive(project, members, state, statuses, noCore, now), false, 'old tab activity does not emphasize the project');
const titleSource = fs.readFileSync(path.join(__dirname, 'tab-title.js'), 'utf8');
const { tabTitle, clean } = new Function(titleSource.replace(/^export /gm, '') + '\nreturn {tabTitle, clean};')();
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
const { groupPaths, parentAgent, paneDirectory, spaceAgents, directoryNodes, teamNodes, tabNodes } = new Function(...Object.keys(rules), source.replace(/^import .*;\n/gm, '').replace(/^export /gm, '') + '\nreturn {groupPaths,parentAgent,paneDirectory,spaceAgents,directoryNodes,teamNodes,tabNodes};')(...Object.values(rules));
/** @param {string} id @param {number} [changed_at] @returns {any} */
const tab = (id, changed_at = 0) => ({ id, changed_at, settled: false });
/** @param {string} id @param {any[]} tabs @param {string|null} [machine] @returns {any} */
const space = (id, tabs, machine = null) => ({ id, folder: '/repo', name: id, named: false, machine, tabs, active: false });
/** @param {string} id @param {string} tab @param {string} [cwd] @returns {any} */
const pane = (id, tab, cwd = '/repo') => ({ pane: id, terminal: id, tab, cwd });
const hierarchy = [pane('lead', 'split'), pane('child1', 'split'), pane('child2', 'split'), pane('shell', 'split')];
const hierarchyRaw = new Map([['lead', {}], ['child1', { parent: 'lead' }], ['child2', { parent: 'lead' }], ['shell', {}]]);
const hierarchyStates = new Map([['lead', 'working'], ['child1', 'idle'], ['child2', 'done']]);
assert.equal(parentAgent(hierarchy, hierarchyRaw, hierarchyStates), hierarchy[0], 'ordinary terminals do not hide the agent parent');
hierarchyRaw.get('child2').parent = 'another';
assert.equal(parentAgent(hierarchy, hierarchyRaw, hierarchyStates), null, 'unrelated agents remain separate');
// v4: three projections of the same pane set. Directory is flat (direct agents, no ancestor or
// parent nesting), Team preserves parent-child, Default preserves native tab membership.
const mainTree = { path: '/repo', branch: 'main', name: 'main' };
const featTree = { path: '/worktrees/feature', branch: 'feature', name: 'feature' };
const vp = (id, tabId, path, tree, extra = {}) => ({ pane: id, terminal: id, tab: tabId, cwd: path, workspaceFolder: path, gitTree: tree, worktree: null, ...extra });
const v4Raw = new Map([
  ['lead', { parent: null }], ['sub', { parent: 'lead' }], ['grand', { parent: 'sub' }],
  ['other', { parent: null }], ['plain', { parent: null }], ['solo', { parent: null }],
]);
const v4Group = {
  binding: { machine: null, root: '/repo', git: true, worktrees: [mainTree, featTree] },
  entries: [
    { tab: { id: 't1' }, members: [
      vp('lead', 't1', '/repo', mainTree, { program: { agent: true } }),
      vp('sub', 't1', '/worktrees/feature', featTree, { worktree: featTree }),
      vp('grand', 't1', '/worktrees/feature', featTree, { worktree: featTree }),
    ] },
    { tab: { id: 't2' }, members: [
      vp('other', 't2', '/repo', mainTree),
      vp('plain', 't2', '/notes', null),
    ] },
    { tab: { id: 't3' }, members: [vp('solo', 't3', '/repo', mainTree)] },
  ],
};
const agents = spaceAgents(v4Group, v4Raw);
assert.equal(agents.length, 6, 'spaceAgents keeps every terminal-backed pane exactly once');
assert.equal(paneDirectory(vp('lead', 't1', '/repo', mainTree)).kind, null, 'main checkout directories have no extra badge');
assert.equal(paneDirectory(vp('sub', 't1', '/worktrees/feature', featTree, { worktree: featTree })).kind, 'Worktree');
assert.equal(paneDirectory(vp('plain', 't2', '/notes', null)).kind, '普通目录');
const dirs = directoryNodes(v4Group, v4Raw);
assert.deepEqual(dirs.map(d => d.path), ['/repo', '/worktrees/feature', '/notes'], 'directory groups are flat siblings in first-seen order');
assert.equal(dirs[0].children.map(a => a.agent.terminal).sort().join(','), 'lead,other,solo', 'same-directory agents across tabs share one group');
assert.equal(dirs[1].children.map(a => a.agent.terminal).sort().join(','), 'grand,sub', 'same-tab different-directory agents split into their own group');
assert.equal(dirs[2].children.map(a => a.agent.terminal).join(','), 'plain', 'non-Git directory is its own group');
assert.ok(dirs.every(d => d.children.every(a => a.children.length === 0)), 'directory view is flat, no parent/child nesting');
const teams = teamNodes(v4Group, v4Raw);
assert.deepEqual(teams.map(t => t.agent.terminal).sort(), ['lead', 'other', 'plain', 'solo'], 'team roots are parentless agents');
const leadTeam = teams.find(t => t.agent.terminal === 'lead');
assert.deepEqual(leadTeam.children.map(c => c.agent.terminal), ['sub'], 'child nests under its parent');
assert.deepEqual(leadTeam.children[0].children.map(c => c.agent.terminal), ['grand'], 'grandchild nests deeper (3 levels)');
const tabs = tabNodes(v4Group, v4Raw);
assert.deepEqual(tabs.map(t => t.tab.id), ['t1', 't2', 't3'], 'default view keeps native tab order');
assert.deepEqual(tabs[0].children.map(a => a.agent.terminal), ['lead', 'sub', 'grand'], 'default view keeps native pane order');
const flatten = node => node.kind === 'agent' ? [node.agent.terminal, ...node.children.flatMap(flatten)] : node.children.flatMap(flatten);
for (const view of [dirs, teams, tabs]) {
  assert.deepEqual(view.flatMap(flatten).sort(), agents.map(a => a.terminal).sort(), 'every view preserves the exact agent set, no loss or duplication');
}
const containsTerminal = (node, terminal) => node.kind === 'agent'
  ? (node.agent.terminal === terminal || node.children.some(child => containsTerminal(child, terminal)))
  : node.children.some(child => containsTerminal(child, terminal));
// Unique highlight: a focused agent's terminal lives in exactly one block per view, so the
// weak highlight can never tint two directories/teams/tabs at once (same-tab cross-directory included).
for (const terminal of agents.map(a => a.terminal)) {
  for (const view of [dirs, teams, tabs]) {
    assert.equal(view.filter(node => containsTerminal(node, terminal)).length, 1, `terminal ${terminal} belongs to exactly one block per view`);
  }
}
const modSpace = space('mods', [tab('home-only'), { ...tab('docs-before'), name: 'Docs', named: true }, tab('mixed'), tab('docs-after')]);
const modPanes = [
  { pane: 'home-only', tab: 'home-only', terminal: null, mod: 'space-home' },
  { pane: 'docs-before', tab: 'docs-before', terminal: null, mod: 'files' },
  pane('mixed-terminal', 'mixed'), { pane: 'mixed-mod', tab: 'mixed', terminal: null, mod: 'files' },
  { pane: 'docs-after', tab: 'docs-after', terminal: null, mod: 'editor' },
];
const modGroup = groupPaths([modSpace], modPanes, {}, new Map())[0];
for (const projection of [directoryNodes, teamNodes, tabNodes]) {
  const nodes = projection(modGroup, new Map());
  assert.deepEqual(nodes.filter(node => node.kind === 'tab' && !node.children.length).map(node => node.tab.id), ['docs-before', 'docs-after'], 'every view retains mod-only tabs without duplicating mixed tabs or the dedicated homepage');
  assert.deepEqual(nodes.flatMap(flatten), ['mixed-terminal'], 'mod tabs introduce no empty directory or duplicate terminal');
  assert(nodes.every(node => node.kind !== 'directory' || node.children.length > 0));
}
assert.deepEqual(tabNodes(modGroup, new Map()).map(node => node.tab.id), ['docs-before', 'mixed', 'docs-after'], 'default keeps mod-only tabs in original native tab order');
const nativePanes = [pane('native-shell', 'native'), { ...pane('native-child', 'native'), status: 'working', program: { agent: true } }, { ...pane('native-owner', 'native'), status: 'idle', program: { agent: true } }];
const nativeRaw = new Map([['native-shell', { status_ms: 100 }], ['native-child', { parent: 'native-owner', status_ms: 300 }], ['native-owner', { status_ms: 200 }]]);
const nativeOrder = () => tabNodes(groupPaths([space('native-space', [tab('native')])], nativePanes, {}, nativeRaw)[0], nativeRaw)[0].children.map(node => node.agent.terminal);
assert.deepEqual(nativeOrder(), ['native-shell', 'native-child', 'native-owner'], 'groupPaths through default projection preserves native pane order across roles and statuses');
nativeRaw.get('native-owner').status_ms = 900;
nativeRaw.get('native-child').status_ms = 0;
assert.deepEqual(nativeOrder(), ['native-shell', 'native-child', 'native-owner'], 'status timestamp updates cannot move default rows');
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
assert.deepEqual(groups.map(g => g.entries.map(e => e.tab.id)), [['a', 'split'], ['b'], ['remote']]);
assert.deepEqual(groups[0].entries.map(e => e.tab.id), spaces[0].tabs.map(t => t.id), 'sidebar rows follow tab order');
assert.deepEqual(groupPaths([...spaces].reverse(), panes, bindings, raw).map(g => g.id), ['remote', 'b', 'a']);
assert.deepEqual(groups[0].entries[1].members.map(p => p.pane), ['split-main', 'split-feature']);
assert.deepEqual(new Set(groups[0].entries[1].worktrees.keys()), new Set(['/worktrees/feature']));
assert.equal(groups[0].entries[1].members.find(p => p.pane === 'split-main').worktree, null, 'a main checkout stays primary when linked worktrees exist');
assert.equal(groups[0].entries[1].members.find(p => p.pane === 'split-feature').worktree.path, '/worktrees/feature');
const otherTrees = [{ path: '/second', branch: 'feature_fjh', name: 'feature_fjh' }, { path: '/second-linked', branch: '', name: 'second-linked' }];
const folderPanes = [...panes, pane('second-main', 'split', '/second'), pane('second-linked', 'split', '/second-linked/subdir'), pane('plain', 'split', '/notes')];
const folderRaw = new Map([...raw, ...folderPanes.slice(panes.length).map(p => [p.terminal, { address: p.terminal, cwd: p.cwd }])]);
const folderBindings = { a: { ...bindings.a, folders: [
  { root: '/repo', git: true, worktrees: trees },
  { root: '/second', git: true, worktrees: otherTrees },
  { root: '/notes', git: false, worktrees: [{ path: '/notes', branch: '', name: 'notes' }] },
] } };
const folderGroup = groupPaths([spaces[0]], folderPanes, folderBindings, folderRaw)[0];
const folderMembers = folderGroup.entries.flatMap(entry => entry.members);
assert.equal(folderMembers.find(p => p.terminal === 'second-main').worktree, null, 'each repository in a multi-folder Space has its own main checkout');
assert.equal(folderMembers.find(p => p.terminal === 'second-linked').worktree.path, '/second-linked', 'detached linked worktrees keep their identity inside subdirectories');
assert.equal(folderMembers.find(p => p.terminal === 'plain').worktree, null, 'non-Git folders never become worktrees');
assert.deepEqual([...folderGroup.entries.find(entry => entry.tab.id === 'split').worktrees.keys()].sort(), ['/second-linked', '/worktrees/feature']);
const folderDirs = directoryNodes(folderGroup, folderRaw);
assert.equal(folderDirs.find(dir => dir.path === '/second').kindTag, null, 'main checkouts in multi-folder Spaces have no extra badge');
assert.equal(folderDirs.find(dir => dir.path === '/second-linked/subdir').kindTag, 'Worktree');
assert.equal(folderDirs.find(dir => dir.path === '/second-linked/subdir').worktree.path, '/second-linked', 'directory hover identifies the worktree root rather than just its launch subdirectory');
const teamPanes = v4Group.entries.flatMap(entry => entry.members);
const teamSpace = space('team-space', v4Group.entries.map(entry => entry.tab));
let viewSpaces = [teamSpace], viewPanes = teamPanes;
function element(asset) {
  const state = { props: asset ? { asset } : {}, nodes: [] };
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
const elements = node => node?.nodes ? [node, ...node.nodes.flatMap(elements)] : [];
const retainedSource = fs.readFileSync(path.join(__dirname, 'retained-parts.js'), 'utf8');
const { RetainedParts } = new Function('View', 'div', retainedSource.replace(/^import .*;\n/gm, '').replace(/^export /gm, '') + '\nreturn {RetainedParts};')(class {}, element);
const sidebarCommands = [];
const viewState = new Map([
  ['agent-columns.view', 'directory'],
  ['agent-columns.view-folded', { 'team-space::directory::/repo': true, 'team-space::agent::lead': false }],
  ['workspace.project-bindings', { 'team-space': bindings.a }],
]);
const viewApi = {
  View: class {}, div: element, svg: element, image: element, h_flex: element, v_flex: element,
  groupPaths, teamNodes, directoryNodes, tabNodes, ...homeRules, tabTitle, clean, sessionTime, staleSession, projectActive,
  theme: () => ({ chrome: '#101010', accent: '#22a99a', working: '#5b8def', done: '#3fae6a' }), run: (name, args) => sidebarCommands.push([name, args]),
  spaces: () => viewSpaces, panes: () => viewPanes,
  terminals: () => viewPanes.filter(p => p.terminal).map(p => ({ address: p.terminal, cwd: p.cwd, ...v4Raw.get(p.terminal) })),
  shared: key => viewState.get(key), setShared: (key, value) => viewState.set(key, value),
};
const sidebarSource = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8').replace(/^import .*;\n/gm, '').replace('export default class ', 'class ');
const Sidebar = new Function(...Object.keys(viewApi), `${sidebarSource}\nreturn SpacesTabs;`)(...Object.values(viewApi));
const sidebar = new Sidebar();
sidebar.setMode('team');
assert.equal(viewState.get('agent-columns.view'), 'team');
assert.deepEqual(viewState.get('agent-columns.view-folded'), { 'team-space::directory::/repo': true, 'team-space::agent::lead': true }, 'entering Team folds the owner with children, preserving other views and standalone sessions');
viewState.get('agent-columns.view-folded')['team-space::agent::lead'] = false;
sidebar.setMode('team');
assert.equal(viewState.get('agent-columns.view-folded')['team-space::agent::lead'], false, 'staying in Team preserves manual expansion');
sidebar.setMode('default');
assert.equal(viewState.get('agent-columns.view-folded')['team-space::agent::lead'], false, 'leaving Team preserves existing fold states');
sidebar.setMode('team');
assert.equal(viewState.get('agent-columns.view-folded')['team-space::agent::lead'], true, 're-entering Team restores the owner-only default');
for (const mode of ['directory', 'team', 'default']) {
  viewState.set('agent-columns.view', mode);
  viewState.set('agent-columns.fold-step', 0);
  for (let round = 0; round < 2; round++) {
    viewState.set('agent-columns.spaces-folded', { 'team-space': true });
    viewState.set('agent-columns.view-fold-all', true);
    sidebar.cycleFold();
    const group = groupPaths([teamSpace], teamPanes, { 'team-space': bindings.a }, new Map(viewApi.terminals().map(t => [t.address, t])))[0];
    const nodes = (mode === 'team' ? teamNodes : mode === 'default' ? tabNodes : directoryNodes)(group, v4Raw);
    assert.equal(viewState.get('agent-columns.spaces-folded')['team-space'], false, 'first click exposes the logical group level');
    assert.equal(viewState.get('agent-columns.view-fold-all'), false, 'group disclosure remains individually usable');
    for (const node of nodes.filter(node => node.children.length)) assert.equal(viewState.get('agent-columns.view-folded')[`${group.id}::${node.kind}::${node.key}`], true, `${mode} first click folds its logical groups`);
    assert.equal(viewState.get('agent-columns.fold-step'), 1);
    sidebar.cycleFold();
    assert.equal(viewState.get('agent-columns.spaces-folded')['team-space'], true, 'second click folds every Space');
    assert.equal(viewState.get('agent-columns.fold-step'), 2);
    sidebar.cycleFold();
    assert.equal(viewState.get('agent-columns.spaces-folded')['team-space'], false, 'third click expands every Space');
    assert.deepEqual(viewState.get('agent-columns.view-folded'), {}, 'third click expands all groups and descendants');
    assert.equal(viewState.get('agent-columns.fold-step'), 0, 'the three-step cycle repeats');
  }
}
viewState.set('agent-columns.fold-step', 2);
sidebar.setMode('directory');
assert.equal(viewState.get('agent-columns.fold-step'), 0, 'switching views starts at its own logical group level');
sidebar.width = 320;
sidebar.parts = new RetainedParts();
sidebar.workingSince = {};
sidebar.dragFocus = {};
teamPanes[0].status = 'idle';
teamPanes[1].status = 'working';
const idleAt = Date.now() - 60000;
v4Raw.get('lead').status_ms = idleAt;
viewState.set('agent-columns.view', 'team');
viewState.set('agent-columns.spaces-folded', {});
viewState.set('agent-columns.view-fold-all', false);
for (const closed of [true, false]) {
  viewState.set('agent-columns.view-folded', { 'team-space::agent::lead': closed });
  const rendered = sidebar.render(), rows = elements(rendered);
  const owner = rows.find(node => node.props.id === 'agent-team-space-lead');
  assert(owner);
  const ownerElements = elements(owner);
  assert.equal(ownerElements.some(node => node.props.id === 'sweep-agent-lead'), closed, 'idle owner summarizes working descendants only while folded');
  assert.equal(ownerElements.some(node => node.props.id === 'status-dot-agent-lead'), false, 'child activity does not replace the owner idle status');
  assert.equal(ownerElements.find(node => node.props.tooltip === '最近状态更新时间')?.nodes[0], sessionTime(idleAt, Date.now()), 'owner retains its own idle timestamp in either fold state');
  assert.equal(rows.some(node => node.props.id === 'agent-team-space-sub'), !closed, 'expansion exposes the child session');
  assert.equal(rows.some(node => node.props.id === 'sweep-agent-sub'), !closed, 'expanded working child carries its own activity sweep');
  assert.equal(sidebar.workingSince.lead, undefined, 'child work does not start an owner working timer');
}
viewSpaces = [modSpace]; viewPanes = modPanes;
viewState.set('workspace.project-bindings', {});
viewState.set('agent-columns.view-folded', {});
for (const mode of ['directory', 'team', 'default']) {
  viewState.set('agent-columns.view', mode);
  const rendered = sidebar.render(), rows = elements(rendered);
  for (const id of ['docs-before', 'docs-after']) {
    const row = rows.find(node => node.props.id === `grp-mods-tab-${id}`);
    assert(row, `${mode} renders a reachable mod-only tab`);
    assert.equal(elements(row).some(node => node.props.asset?.includes('chevron-')), false, 'a mod-only tab has no futile disclosure arrow');
    assert.equal(elements(row).some(node => node.props.tooltip === '0 会话'), false, 'a mod-only tab has no empty session count');
    row.props.on_click({}, { stop_propagation() {} });
    assert.deepEqual(sidebarCommands.slice(-2), [['space.select', { id: modSpace.id }], ['tab.select', { id }]], 'clicking a mod-only row selects its original Space and tab');
    assert.deepEqual(viewState.get('agent-columns.view-folded'), {}, 'mod-only navigation does not create an empty folded branch');
  }
  assert.equal(rows.filter(node => node.props.id === 'agent-mods-mixed-terminal').length, 1, 'mixed tabs render their terminal once');
  assert.equal(rows.some(node => node.props.id === 'grp-mods-tab-home-only'), false, 'dedicated homepage stays outside sidebar projections');
  assert.equal(rendered.props.pb + rows.find(node => node.props.id === 'spaces-header').props.h + rows.find(node => node.props.id === 'view-mode').props.h + rows.find(node => node.props.id === 'view-mode').props.mb, 72, 'fixed Spaces controls require 72px');
}
const layoutNodes = node => [node, ...(node.children ?? []).flatMap(layoutNodes)];
for (const name of ['office', 'agent-columns']) {
  const blocks = layoutNodes(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'layouts', `${name}.json`), 'utf8')));
  assert.equal(blocks.find(node => node.id === 'spaces').min, 72, `${name} keeps both Spaces control rows visible at minimum size`);
  assert.equal(blocks.find(node => node.id === 'agents').min, 40, `${name} preserves the Agents minimum`);
}
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
  let tree = { id: 'root', children: [{ id: 'spaces', size: { weight: 1.5 }, min: 38 }, { id: 'agents', size: { px: 420 }, min: 40 }] };
  const saved = new Map([['layout', 'office']]);
  const zoomCalls = [];
  const activeSpaces = [{ active: true, tabs: [{ id: 'current', active: true }] }];
  const zoomPanes = [{ pane: 'p1', terminal: 't1', tab: 'current', zoomed: true }, { pane: 'p2', terminal: 't2', tab: 'other', zoomed: true }];
  /** @param {string} command @param {{id: string, px?: number, weight?: number}} args */
  const dispatch = (command, args) => {
    if (command === 'pane.zoom') { zoomCalls.push(args.pane); return; }
    assert.equal(command, 'layout.resize');
    const block = tree.children.find(child => child.id === args.id);
    block.size = args.px !== undefined ? { px: args.px } : { weight: args.weight };
  };
  /** @param {string} key */
  const get = key => saved.get(key);
  /** @param {string} key @param {any} value */
  const set = (key, value) => saved.set(key, JSON.parse(JSON.stringify(value)));
  const { toggleBlock, blockCollapsed, restoreZoom, maximizePane } = new Function('layout', 'run', 'shared', 'setShared', 'spaces', 'panes', helper.replace(/^import .*;\n/gm, '').replace(/export /g, '') + '\nreturn { toggleBlock, blockCollapsed, restoreZoom, maximizePane };')(
    () => tree, dispatch, get, set, () => activeSpaces, () => zoomPanes,
  );
  restoreZoom('current', 'p1', 't1');
  assert.deepEqual(zoomCalls, [], 'selecting the same agent keeps zoom');
  restoreZoom('current', 'p3', 't3');
  restoreZoom('other', 'p2', 't2');
  assert.deepEqual(zoomCalls, ['p1', 'p1'], 'switching agents restores only the visible tab');
  zoomPanes[0].zoomed = false;
  restoreZoom('other', 'p2', 't2');
  assert.equal(zoomCalls.length, 2, 'unzoomed navigation does not toggle zoom');
  maximizePane('p1');
  assert.deepEqual(zoomCalls, ['p1', 'p1', 'p1'], 'double click maximizes an unzoomed pane');
  zoomPanes[0].zoomed = true;
  maximizePane('p1');
  maximizePane('missing');
  assert.equal(zoomCalls.length, 3, 'already zoomed or missing panes are not toggled');
  const before = structuredClone(tree);
  toggleBlock('spaces');
  assert.equal(blockCollapsed('spaces'), true);
  assert.deepEqual(tree.children[0], { id: 'spaces', size: { px: 38 }, min: 38 });
  assert.deepEqual(tree.children[1], before.children[1]);
  toggleBlock('agents');
  assert.equal(blockCollapsed('agents'), true);
  assert.deepEqual(tree.children[1], { id: 'agents', size: { px: 40 }, min: 40 });
  toggleBlock('spaces');
  assert.equal(blockCollapsed('spaces'), false);
  assert.deepEqual(tree.children[0], before.children[0]);
  toggleBlock('agents');
  assert.equal(blockCollapsed('agents'), false);
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
    const unlistedSubdir = path.join(repo, 'unlisted-launch-subdir'); fs.mkdirSync(unlistedSubdir);
    await rules.launchProject({ action: 'new-tab', space: multi.id, folder: unlistedSubdir }, api, registry);
    assert.equal(scenePanes.at(-1).cwd, fs.realpathSync(unlistedSubdir), 'an unlisted subdirectory in a registered Git project retains its launch path');
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
