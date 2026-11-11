import { bindingFor, primarySpace, worktreeFor } from "./project-bindings.js";
import { sessionTabs } from "./space-home.js";

/** @param {any} tab @param {import('herdr').PaneInfo[]} members @param {Map<string,any>} raw */
export const activity = (tab, members, raw) => Math.max(tab.changed_at ?? 0, ...members.map(pane => {
  const terminal = raw.get(pane.terminal);
  return terminal?.status_ms ?? terminal?.created_ms ?? 0;
}));

/** @param {import('herdr').SpaceInfo[]} spaces @param {import('herdr').PaneInfo[]} panes @param {Record<string,import('./project-bindings.js').Binding>} bindings @param {Map<string,any>} raw */
export function groupPaths(spaces, panes, bindings, raw) {
  return spaces.map(space => {
    const binding = bindingFor(space, bindings);
    const primary = primarySpace(binding.projectKey, spaces, bindings);
    const entries = sessionTabs(space, panes).filter(tab => !tab.settled).map(tab => {
      const worktrees = new Map();
      const members = panes.filter(pane => pane.tab === tab.id).map(pane => {
        const tree = worktreeFor(binding, raw.get(pane.terminal), tab.id);
        const worktree = tree && (binding.worktrees.length > 1 || tree.path !== binding.root) ? tree : null;
        if (worktree) worktrees.set(worktree.path, `worktree · ${worktree.name}`);
        return { ...pane, worktree, gitTree: tree, workspaceFolder: binding.terminalFolders?.[pane.terminal] ?? raw.get(pane.terminal)?.cwd ?? pane.cwd };
      });
      members.sort((a, b) => activity({ changed_at: 0 }, [b], raw) - activity({ changed_at: 0 }, [a], raw));
      return { space, tab, members, worktrees, latest: activity(tab, members, raw) };
    });
    entries.sort((a, b) => b.latest - a.latest);
    return { id: space.id, projectKey: binding.folders ? `space:${space.id}` : binding.projectKey, folder: binding.folders?.[0]?.path ?? binding.root, name: space.named ? space.name : binding.name, machine: binding.machine,
      space, binding, duplicateOf: !binding.folders && primary && primary.id !== space.id ? primary.id : null, entries, active: space.active, latest: Math.max(0, ...entries.map(entry => entry.latest)) };
  });
}
