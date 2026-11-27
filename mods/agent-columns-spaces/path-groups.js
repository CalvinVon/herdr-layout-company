import { bindingFor, primarySpace, worktreeFor, projectKey, normalizePath } from "./project-bindings.js";
import { sessionTabs } from "./space-home.js";

/** @param {any} tab @param {import('herdr').PaneInfo[]} members @param {Map<string,any>} raw */
export const activity = (tab, members, raw) => Math.max(tab.changed_at ?? 0, ...members.map(pane => {
  const terminal = raw.get(pane.terminal);
  return terminal?.status_ms ?? terminal?.created_ms ?? 0;
}));

export function parentAgent(members, raw, states) {
  const agents = members.filter(pane => pane.terminal && (pane.program?.agent || states.get(pane.pane)));
  return agents.find(pane => agents.some(child => raw.get(child.terminal)?.parent === pane.terminal)
    && agents.every(child => child === pane || raw.get(child.terminal)?.parent === pane.terminal)) ?? null;
}

/** @param {string} path */
const baseName = path => (path || "").split("/").filter(Boolean).pop() || path;

// Resolve a pane to its bound working directory (never drifts with cd) plus branch/kind context.
// The directory is the remembered launch folder, not the worktree root: two terminals bound to
// different subdirectories of one repository stay in distinct groups.
/** @param {any} pane pane carrying worktree/gitTree/workspaceFolder */
export function paneDirectory(pane) {
  const path = normalizePath(pane.workspaceFolder ?? pane.cwd ?? "");
  const tree = pane.gitTree;
  const branch = tree?.branch || "";
  const kind = !tree?.path ? "普通目录" : pane.worktree ? "Worktree" : null;
  return { path, branch, name: baseName(path) || "普通目录", kind, worktree: pane.worktree };
}

// Terminal-backed panes of one Space, in native tab then member order. One leaf per pane;
// the same pane is projected into every view without duplication or loss.
/** @param {any} group @param {Map<string,any>} raw */
export function spaceAgents(group, raw) {
  const list = [];
  for (const entry of group.entries) {
    for (const pane of entry.members) {
      if (!pane.terminal) continue;
      list.push({ pane, terminal: pane.terminal, tab: entry.tab, parent: raw.get(pane.terminal)?.parent ?? null, directory: paneDirectory(pane) });
    }
  }
  return list;
}

/** @param {any} agent */
const agentNode = agent => ({ kind: "agent", key: agent.terminal, agent, children: [] });

// Directory view: flat sibling directory groups, each with only its own agents. No ancestor
// nesting and no empty parent directories.
/** @param {any} group @param {Map<string,any>} raw */
export function directoryNodes(group, raw) {
  const map = new Map();
  for (const agent of spaceAgents(group, raw)) {
    const dir = agent.directory;
    const key = dir.path;
    let node = map.get(key);
    if (!node) { node = { kind: "directory", key, name: dir.name, branch: dir.branch, path: dir.path, kindTag: dir.kind, worktree: dir.worktree, children: [] }; map.set(key, node); }
    node.children.push(agentNode(agent));
  }
  return [...map.values(), ...tabNodes(group, raw).filter(node => !node.children.length)];
}

// Team view: parent-child forest from terminal.parent, one tree per root agent. A team spans
// tabs and directories; unrelated agents stay standalone.
/** @param {any} group @param {Map<string,any>} raw */
export function teamNodes(group, raw) {
  const agents = spaceAgents(group, raw);
  const byTerminal = new Map(agents.map(agent => [agent.terminal, agent]));
  const childrenOf = new Map();
  for (const agent of agents) {
    const parent = agent.parent && byTerminal.has(agent.parent) ? agent.parent : null;
    if (parent) { const list = childrenOf.get(parent) ?? []; list.push(agent); childrenOf.set(parent, list); }
  }
  const build = agent => ({ kind: "agent", key: agent.terminal, agent, children: (childrenOf.get(agent.terminal) ?? []).map(build) });
  return [...agents.filter(agent => !(agent.parent && byTerminal.has(agent.parent))).map(build), ...tabNodes(group, raw).filter(node => !node.children.length)];
}

// Default view: native tab groups, each with its own agents in tab order.
/** @param {any} group @param {Map<string,any>} raw */
export function tabNodes(group, raw) {
  const map = new Map();
  for (const { tab } of group.entries) map.set(tab.id, { kind: "tab", key: tab.id, tab, children: [] });
  for (const agent of spaceAgents(group, raw)) map.get(agent.tab.id).children.push(agentNode(agent));
  return [...map.values()];
}


/** @param {import('herdr').SpaceInfo[]} spaces @param {import('herdr').PaneInfo[]} panes @param {Record<string,import('./project-bindings.js').Binding>} bindings @param {Map<string,any>} raw */
export function groupPaths(spaces, panes, bindings, raw) {
  return spaces.map(space => {
    const binding = bindingFor(space, bindings);
    const primary = primarySpace(binding.projectKey, spaces, bindings);
    const entries = sessionTabs(space, panes).filter(tab => !tab.settled).map(tab => {
      const worktrees = new Map();
      const members = panes.filter(pane => pane.tab === tab.id).map(pane => {
        const tree = worktreeFor(binding, raw.get(pane.terminal), tab.id);
        const project = tree && (binding.folders ?? [binding]).find(folder => folder.worktrees.some(item => item.path === tree.path));
        const worktree = project && tree.path !== project.root ? tree : null;
        if (worktree) worktrees.set(worktree.path, `worktree · ${worktree.name}`);
        return { ...pane, worktree, gitTree: tree, workspaceFolder: binding.terminalFolders?.[pane.terminal] ?? raw.get(pane.terminal)?.cwd ?? pane.cwd };
      });
      return { space, tab, members, worktrees, latest: activity(tab, members, raw) };
    });
    // Tab order is the source of truth: a row dropped here moves the same tab the top bar shows.
    entries.sort((a, b) => space.tabs.findIndex(tab => tab.id === a.tab.id) - space.tabs.findIndex(tab => tab.id === b.tab.id));
    return { id: space.id, projectKey: binding.folders ? `space:${space.id}` : binding.projectKey, folder: binding.folders?.[0]?.path ?? binding.root, name: space.named ? space.name : binding.name, machine: binding.machine,
      space, binding, duplicateOf: !binding.folders && primary && primary.id !== space.id ? primary.id : null, entries, active: space.active, latest: Math.max(0, ...entries.map(entry => entry.latest)) };
  });
}
