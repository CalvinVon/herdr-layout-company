import { retainSpace } from "./space-home.js";

// Project identity is bound to a Space; live pane cwd never participates.
/** @typedef {{path: string, branch: string, name: string}} Worktree */
/** @typedef {{path: string, projectKey: string, root: string, name: string, git?: boolean, worktrees: Worktree[]}} WorkspaceFolder */
/** @typedef {{projectKey: string, root: string, name: string, machine: string|null, worktrees: Worktree[], git?: boolean, initialFolder?: string, primarySpace?: string, folders?: WorkspaceFolder[], terminalWorktrees?: Record<string,string>, terminalFolders?: Record<string,string>}} Binding */
/** @typedef {{id?: string, action: string, homeOnly?: boolean, agentKey?: string, folder?: string, folders?: string[], machine?: string|null, space?: string, pane?: string, direction?: string, argv?: string[], name?: string}} ProjectRequest */
/** @typedef {{spaces: typeof import('herdr').spaces, panes: typeof import('herdr').panes, exec: typeof import('herdr').exec, run: typeof import('herdr').run, pickFolder: typeof import('herdr').pickFolder, sleep: (ms: number) => Promise<void>}} LaunchApi */
/** @param {string} path */
export const normalizePath = path => {
  const value = String(path || "").replace(/\\/g, "/");
  const prefix = value.startsWith("/") ? "/" : value.match(/^[A-Za-z]:\//)?.[0] ?? "";
  const parts = [];
  for (const part of value.slice(prefix.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length && parts[parts.length - 1] !== "..") parts.pop();
    else if (part !== ".." || !prefix) parts.push(part);
  }
  return prefix + parts.join("/");
};
/** @param {string|null} machine @param {string} root */
export const projectKey = (machine, root) => JSON.stringify([machine || null, normalizePath(root)]);
/** @param {string} path */
const basename = path => path.split("/").filter(Boolean).pop() || path;
/** @param {string} text */
const line = text => text.replace(/\r?\n$/, "");

/** @param {string} text @returns {Worktree[]} */
export function parseWorktrees(text) {
  const list = [];
  let current;
  for (const item of text.split("\0")) {
    if (item.startsWith("worktree ")) {
      current = { path: normalizePath(item.slice(9)), branch: "", name: "" };
      list.push(current);
    } else if (current && item.startsWith("branch ")) current.branch = item.slice(7).replace(/^refs\/heads\//, "");
  }
  for (const tree of list) tree.name = tree.branch || basename(tree.path);
  return list;
}

/** @param {string} folder @param {string|null} machine @param {typeof import('herdr').exec} execute @returns {Promise<Binding>} */
export async function resolveProject(folder, machine, execute) {
  const on = machine || null;
  const location = await execute("pwd", ["-P"], { cwd: folder, on });
  if (location.code !== 0) throw new Error(location.stderr || "无法读取项目目录");
  const cwd = normalizePath(line(location.stdout));
  if (!cwd) throw new Error("项目目录为空");
  const top = await execute("git", ["rev-parse", "--show-toplevel"], { cwd, on });
  if (top.code !== 0) {
    if (!/not a git repository/i.test(top.stderr)) throw new Error(top.stderr || "无法读取 Git 项目");
    return { projectKey: projectKey(on, cwd), root: cwd, name: basename(cwd), machine: on, git: false, worktrees: [{ path: cwd, branch: "", name: basename(cwd) }], initialFolder: cwd };
  }
  const result = await execute("git", ["worktree", "list", "--porcelain", "-z"], { cwd, on });
  if (result.code !== 0) throw new Error(result.stderr || "无法读取 Git worktree");
  const worktrees = parseWorktrees(result.stdout);
  if (!worktrees.length) throw new Error("Git 未返回主 worktree");
  const root = worktrees[0].path;
  return { projectKey: projectKey(on, root), root, name: basename(root), machine: on, git: true, worktrees, initialFolder: cwd };
}

/** @param {import('herdr').SpaceInfo} space @param {Record<string,Binding>} bindings @returns {Binding} */
export function bindingFor(space, bindings) {
  return bindings[space.id] ?? { projectKey: projectKey(space.machine, space.folder), root: normalizePath(space.folder), name: basename(normalizePath(space.folder)) || space.name, machine: space.machine || null, worktrees: [], terminalWorktrees: {} };
}

/** @param {string} key @param {import('herdr').SpaceInfo[]} spaces @param {Record<string,Binding>} bindings */
export function primarySpace(key, spaces, bindings) {
  const candidates = spaces.filter(space => !bindings[space.id]?.folders && bindings[space.id]?.projectKey === key);
  const remembered = candidates.map(space => bindings[space.id].primarySpace).find(id => candidates.some(space => space.id === id));
  return candidates.find(space => space.id === remembered) ?? candidates[0];
}

/** @param {Binding} binding @param {{address: string, cwd?: string}|undefined} terminal @param {string} tab */
export function worktreeFor(binding, terminal, tab) {
  const saved = terminal && binding.terminalWorktrees?.[terminal.address];
  const launch = saved ?? (terminal && binding.terminalFolders?.[terminal.address]) ?? terminal?.cwd;
  if (!launch) return null;
  const trees = binding.folders ? binding.folders.filter(folder => folder.git).flatMap(folder => folder.worktrees) : binding.git ? binding.worktrees : [];
  return [...trees].sort((a, b) => b.path.length - a.path.length)
    .find(tree => launch === tree.path || launch.startsWith(tree.path + "/")) ?? null;
}

/** @param {import('herdr').SpaceInfo} space @param {Binding} binding @param {import('herdr').PaneInfo[]} panes @param {Map<string,any>} terminals */
export function rememberWorktrees(space, binding, panes, terminals) {
  binding.terminalWorktrees ??= {};
  binding.terminalFolders ??= {};
  const tabs = new Set(space.tabs.map(tab => tab.id));
  let changed = false;
  for (const pane of panes) {
    if (!pane.terminal || !tabs.has(pane.tab) || binding.terminalWorktrees[pane.terminal]) continue;
    const terminal = terminals.get(pane.terminal);
    if (!(pane.terminal in binding.terminalFolders) && typeof terminal?.cwd === "string") { binding.terminalFolders[pane.terminal] = terminal.cwd; changed = true; }
    const tree = worktreeFor(binding, terminals.get(pane.terminal), pane.tab);
    if (tree) { binding.terminalWorktrees[pane.terminal] = tree.path; changed = true; }
  }
  return changed;
}

/** @param {ProjectRequest} request @param {LaunchApi} api @param {Record<string,Binding>} bindings */
export async function launchProject(request, api, bindings) {
  const all = api.spaces();
  const target = request.space ? all.find(space => space.id === request.space) : undefined;
  if (request.space && !target) throw new Error("目标 Space 已关闭");
  let folder = request.folder ?? "";
  const machine = target ? target.machine : request.machine ?? null;
  if (request.action === "create-space" || request.action === "update-folders") {
    if (!Array.isArray(request.folders) || !request.folders.length) throw new Error("请至少添加一个文件夹");
    if (request.folder && !request.folders.includes(request.folder)) throw new Error("请选择 Space 中的工作目录");
    /** @type {WorkspaceFolder[]} */
    const folders = [];
    /** @type {string|undefined} */
    let initialFolder;
    for (const path of request.folders) {
      if (typeof path !== "string" || !path.trim() || !/^(\/|[A-Za-z]:[\\/])/.test(path)) throw new Error("请填写文件夹的绝对路径");
      const project = await resolveProject(path, machine, api.exec);
      if (path === request.folder) initialFolder = project.initialFolder;
      if (!folders.some(item => item.path === project.initialFolder)) folders.push({ path: project.initialFolder, projectKey: project.projectKey, root: project.root, name: basename(project.initialFolder), git: project.git, worktrees: project.worktrees });
    }
    if (request.action === "update-folders") {
      if (!target || !bindings[target.id]) throw new Error("Space 的文件夹尚未就绪");
      bindings[target.id].folders = folders;
    } else {
      const first = folders[0];
      initialFolder ??= first.path;
      const before = new Set(api.spaces().map(space => space.id));
      api.run("space.new", { name: request.name?.trim() || first.name, folder: initialFolder, machine: machine || "", ...(request.argv ? { argv: request.argv } : {}) });
      const findCreated = () => api.spaces().find(space => !before.has(space.id) && (space.machine || null) === (machine || null) && normalizePath(space.folder) === initialFolder);
      let created = findCreated();
      for (let attempt = 0; !created && attempt < 50; attempt++) {
        await api.sleep(100);
        created = findCreated();
      }
      if (!created) throw new Error("创建命令已发送，但尚未确认新 Space。请先查看左侧列表，避免重复创建。");
      bindings[created.id] = { ...first, machine: machine || null, initialFolder, folders, primarySpace: created.id, terminalWorktrees: {}, terminalFolders: {} };
      const bootstrap = created.tabs.filter(tab => api.panes().some(pane => pane.tab === tab.id && pane.terminal));
      const home = await retainSpace(created, api);
      if (request.homeOnly) {
        if (!home) throw new Error("新 Space 已关闭，未能显示首页");
        for (const tab of bootstrap) api.run("tab.close", { id: tab.id, confirmed: true });
        let current = api.spaces().find(space => space.id === created.id);
        for (let attempt = 0; current?.tabs.some(tab => bootstrap.some(item => item.id === tab.id)) && attempt < 50; attempt++) {
          await api.sleep(100);
          current = api.spaces().find(space => space.id === created.id);
        }
        if (!current || current.tabs.some(tab => bootstrap.some(item => item.id === tab.id))) throw new Error("首页已创建，但初始空终端尚未确认关闭，请先查看 Space，避免重复创建。");
        api.run("space.select", { id: created.id });
        api.run("tab.select", { id: home.id });
      }
    }
    return true;
  }
  if (request.action === "pick-project") {
    if (machine) throw new Error("请在菜单中填写远程项目目录");
    folder = (await api.pickFolder({ prompt: "打开项目" })) ?? "";
    if (!folder) return false;
  }
  if (request.action === "new-tab" || request.action === "split") {
    const binding = target && bindings[target.id];
    if (!target || !binding) throw new Error("项目绑定尚未就绪");
    folder ||= binding.folders?.[0]?.path ?? binding.root;
    const project = await resolveProject(folder, machine, api.exec);
    if (!(binding.folders ?? [binding]).some(item => item.projectKey === project.projectKey)) throw new Error("目录不在这个 Space 的文件夹中，请先在管理文件夹中添加");
    for (const value of Object.values(bindings)) {
      if (value.projectKey === project.projectKey) value.worktrees = project.worktrees;
      for (const item of value.folders ?? []) if (item.projectKey === project.projectKey) item.worktrees = project.worktrees;
    }
    if (request.action === "split") {
      const pane = api.panes().find(pane => pane.pane === request.pane && pane.terminal && target.tabs.some(tab => tab.id === pane.tab));
      if (!pane) throw new Error("目标分屏已关闭或不属于这个 Space");
      api.run("pane.focus", { pane: pane.pane });
      api.run("terminal.open", { place: request.direction === "down" ? "down" : "right", folder: project.initialFolder, ...(request.argv ? { argv: request.argv } : {}) });
    } else api.run("tab.new", { space: target.id, folder: project.initialFolder, ...(request.argv ? { argv: request.argv, name: request.name } : {}) });
    return true;
  }
  if (!folder) throw new Error("请选择项目目录");
  const project = await resolveProject(folder, machine, api.exec);
  const existing = primarySpace(project.projectKey, api.spaces(), bindings);
  if (existing) {
    for (const value of Object.values(bindings)) if (value.projectKey === project.projectKey) value.worktrees = project.worktrees;
    api.run("space.select", { id: existing.id });
    if (request.action === "open-worktree" || request.argv) api.run("tab.new", { space: existing.id, folder: project.initialFolder, ...(request.argv ? { argv: request.argv, name: request.name } : {}) });
  } else {
    const before = new Set(api.spaces().map(space => space.id));
    api.run("space.new", { name: project.name, folder: project.initialFolder, machine: machine || "", ...(request.argv ? { argv: request.argv } : {}) });
    const created = api.spaces().find(space => !before.has(space.id) && (space.machine || null) === (machine || null) && normalizePath(space.folder) === project.initialFolder);
    if (created) bindings[created.id] = { ...project, primarySpace: created.id, terminalWorktrees: {} };
  }
  return true;
}

/** @param {Record<string,Binding>} latest @param {Record<string,Binding>} proposed */
export function mergeBindings(latest, proposed) {
  const result = { ...latest, ...proposed };
  for (const [id, previous] of Object.entries(latest)) if (proposed[id]) {
    result[id] = previous.projectKey !== proposed[id].projectKey ? previous : { ...previous, ...proposed[id],
      terminalFolders: { ...proposed[id].terminalFolders, ...previous.terminalFolders },
      terminalWorktrees: { ...proposed[id].terminalWorktrees, ...previous.terminalWorktrees } };
  }
  return result;
}

/** @param {LaunchApi & {shared: typeof import('herdr').shared, setShared: typeof import('herdr').setShared}} api @param {Record<string,Binding>} bindings @param {string} owner */
export async function consumeProjectRequest(api, bindings, owner) {
  const queue = api.shared("workspace.project-requests");
  if (!Array.isArray(queue) || !queue.length) return;
  const owns = () => api.shared("workspace.project-owner") === owner;
  const assertOwner = () => { if (!owns()) throw new Error("项目操作的布局已切换"); };
  assertOwner();
  const active = /** @type {{id:string,owner:string,phase:string}|null} */ (api.shared("workspace.project-inflight"));
  if (active && active.owner !== owner && active.phase !== "resolving") {
    const waiting = [...queue].reverse().find(request => request.id) ?? queue[queue.length - 1];
    api.setShared("workspace.project-requests", []);
    api.setShared("workspace.project-inflight", null);
    return { id: waiting.id ?? JSON.stringify(waiting), ok: false, error: `布局已重新加载，已取消 ${queue.length} 项未完成的操作。请重新添加文件夹或创建 Agent。` };
  }
  const request = queue[0], id = request.id ?? JSON.stringify(request);
  api.setShared("workspace.project-inflight", { id, owner, phase: "resolving" });
  let dispatched = false, cancelled = false;
  let result;
  try {
    await launchProject(request, { ...api,
      run(name, args) { assertOwner(); dispatched = true; api.setShared("workspace.project-inflight", { id, owner, phase: "dispatching" }); return api.run(name, args); },
      async pickFolder(options) {
        api.setShared("workspace.project-inflight", { id, owner, phase: "picking" });
        const folder = await api.pickFolder(options);
        cancelled = !folder;
        if (folder && !owns()) {
          const pending = api.shared("workspace.project-requests");
          if (Array.isArray(pending) && (pending[0]?.id ?? JSON.stringify(pending[0])) === id) api.setShared("workspace.project-requests", [{ ...request, action: "open-project", folder }, ...pending.slice(1)]);
        }
        return folder;
      },
    }, bindings);
    if (owns()) {
      if (dispatched && request.agentKey) {
        const machine = api.spaces().find(space => space.id === request.space)?.machine ?? request.machine ?? "";
        api.setShared("workspace.recent-agents", { ...api.shared("workspace.recent-agents"), [machine]: request.agentKey });
      }
      result = { id, ok: true };
    }
  } catch (error) { if (owns()) result = { id, ok: false, error: String(error) }; }
  finally {
    const claim = /** @type {{id:string,owner:string}|null} */ (api.shared("workspace.project-inflight"));
    if (claim?.owner === owner && claim.id === id) {
      if (dispatched || cancelled || owns()) {
        const pending = api.shared("workspace.project-requests");
        if (Array.isArray(pending) && (pending[0]?.id ?? JSON.stringify(pending[0])) === id) api.setShared("workspace.project-requests", pending.slice(1));
      }
      api.setShared("workspace.project-inflight", null);
    }
  }
  return result;
}
