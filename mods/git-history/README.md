# Git history panel

Personal native Herdr mod used by Office and agent-columns.

History draws commit nodes and colored parent edges from `git log --all --topo-order`. Labels show local branches, existing remote-tracking branches, tags and HEAD. Selecting a commit displays its metadata, file statistics and patch below the graph. Merge previews compare with the first parent.

The panel follows the focused terminal's repository and worktree. A refresh reads local Git data every 15 seconds; it does not fetch. The first page contains 120 commits; “加载更早的提交” adds another 120. Diff previews show up to 1,500 lines and 4,000 characters per line. Switching selection or worktree invalidates older detail responses.

History / Changes switches between the graph and Herdr's existing working-tree Changes panel. History is read-only; the separate native Changes Commit button stages all changes and commits them when invoked.

Native actions: `layout.select --stack git-body --child git-history` / `git-changes`, `git-history.refresh`, `git-history.next`, `git-history.previous`. The panel header closes with `layout.hide --id panel`.

Checks: `node self-check.cjs`, `herdr-app check <this-directory>`, then inspect both layouts. The self-check uses a temporary Git repository to verify octopus merges, parent-lane continuity, branch labels, detached HEAD and stale-response isolation; it deletes that repository afterwards.
