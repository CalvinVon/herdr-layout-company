import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, panes, terminals, machines, theme, layout, run, shared, setShared, openOverlay, exec, nextCommand, appHome, home, readTextFile, writeTextFile, pickFolder, notify, placement, props } from "herdr";
import { blockCollapsed, toggleBlock, restoreZoom, maximizePane } from "./sidebar-collapse.js";
import { groupPaths, directoryNodes, teamNodes, tabNodes } from "./path-groups.js";
import { resolveProject, readWorktrees, projectKey, primarySpace, rememberWorktrees, consumeProjectRequest, mergeBindings } from "./project-bindings.js";
import { clean, tabTitle } from "./tab-title.js";
import { homeTab, retainSpace, sessionTabs } from "./space-home.js";
import { projectActive, sessionTime, staleSession } from "./session-time.js";
import { RetainedParts } from "./retained-parts.js";

// Same avatar colors as the shipped spaces sidebar (it stores the pick in "space.colors").
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const PALETTE = Object.keys(MARK);
const spaceColor = (sp, i) => {
  const c = (shared("space.colors") ?? {})[sp.id] ?? PALETTE[i % PALETTE.length];
  return c.startsWith("#") ? c : (MARK[c] ?? theme()[c]);
};
const avatar = (sp, i) => {
  const fill = spaceColor(sp, i);
  return div().size(18).flex_none().rounded(5).bg(fill).flex().items_center().justify_center()
    .text_size(10.5).font_bold().text_color("#ffffff").child([...sp.name][0]?.toUpperCase() ?? "?");
};
// Project menus keep creation and worktree actions on the shared binding.
const menu = (tab, target) => openOverlay({ mod: "project-menu", kind: "popup", width: 200, height: 260, props: { tab, target } });
const statusDot = (status, id) => div().id(`status-dot-${id}`).absolute().right(0).top(11).size(6).rounded(3)
  .bg(status === "working" ? theme().working : theme().done)
  .when(status === "working", dot => dot.loop("top", { from: 9, to: 13, period: 1000 }));
const sessionIcon = (pane, id) => div().id(`session-icon-${id}`).absolute().left(0).top(0).size(15)
  .child((!pane ? svg("mods/workspace-chrome/layers.svg").text_color(theme().muted) : pane.program?.key === "omp" ? svg("mods/magpie-live/omp.svg").text_color(theme().muted) : pane.program?.icon ? (pane.program.tint ? svg(pane.program.icon).text_color(theme().muted) : image(pane.program.icon)) : svg("icons/shell.svg").text_color(theme().muted)).size(15));
// The native loop cannot pause between round trips, so phases drive transitions.
const sweepLeft = -0.605, sweepRight = 1.05;
const workingSweep = (id, phase, width, color) => {
  const position = phase === 1 ? sweepRight : sweepLeft;
  const duration = phase === 1 || phase === 2 ? 1600 : 0;
  return div().id(`${id}-clip`).size_full().relative().rounded(6).overflow_hidden()
    .child(div().id(id).absolute().left(width * position).top(0).w(width * 0.55).h_full()
      .transition("left", { duration, easing: "linear" })
      .child(svg("mods/agent-columns-spaces/working-sweep.svg").size_full().text_color(color)));
};
// Small clickable glyph; stops the click so the row behind it doesn't also fire.
const btn = (id, icon, fn) => div().id(id).flex_none().size(22).flex().items_center().justify_center().rounded(6)
  .text_color(theme().muted).cursor_pointer().hover((s) => s.bg(theme().hover).text_color(theme().foreground))
  .child(svg(`mods/workspace-chrome/${icon}.svg`).size(13))
  .on_click((_e, cx) => { cx.stop_propagation(); fn(); });
const paneTitle = (p) => clean(p.title) || p.program?.name || "Terminal";
const roleTitle = (title, p, raw) => {
  const role = raw.get(p?.terminal)?.labels?.role?.trim();
  return role && !title.startsWith(`${role}：`) && !title.startsWith(`${role}:`) ? `${role}：${title}` : title;
};
const folderBadge = (path, stale) => div().id(`folder-badge-${path}`).size(11).flex_none().tooltip(`工作目录：${path}`)
  .child(svg("mods/files/folder.svg").size(11).text_color(theme().dim).when(stale, el => el.opacity(0.65)));
const worktreeTooltip = tree => `Worktree · ${tree.name}\n分支：${tree.branch || "detached HEAD"}\n${tree.path}`;


const titleWorking = (title) => /^[◐◓◑◒✳✻✽✶✷✸✹✺]/u.test((title ?? "").trim());
const coreState = (address) => {
  const entry = shared("agent-columns.core-status")?.[address];
  return entry && Date.now() - entry.checked < 6500 ? entry : null;
};
const stateOf = (p, terminal) => {
  const status = p.status ?? terminal?.status ?? coreState(p.terminal)?.status;
  const command = terminal?.foreground?.argv?.[0]?.split(/[\\/]/).pop();
  const agent = p.program?.agent || ["claude", "codex", "pi", "omp"].includes(command);
  return status === "error" ? "blocked" : status ?? (agent && titleWorking(terminal?.title ?? p.title) ? "working" : null);
};
const duration = (ms) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(seconds / 60), s = String(seconds % 60).padStart(2, "0");
  return m < 60 ? `${m}:${s}` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${s}`;
};
const updateTime = (timestamp, now, t) => div().flex_none().text_size(10).text_color(t.dim)
  .when(staleSession(timestamp, now), el => el.opacity(0.65))
  .tooltip(timestamp ? "最近状态更新时间" : "暂无状态更新时间").child(sessionTime(timestamp, now));
const rank = { blocked: 4, done: 3, working: 2, idle: 1 };

export default class SpacesTabs extends View {
  /** @param {any} _props @param {import("gpui-kit").Context} cx */
  init(_props, cx) {
    this.coordinator = props()?.coordinator === true;
    /** @type {Record<string,import('./project-bindings.js').Binding>} */
    this.bindings = {};
    if (this.coordinator) {
      this.projectOwner = `${Date.now()}-${Math.random()}`;
      setShared("workspace.project-owner", this.projectOwner);
      setShared("workspace.project-status", { ready: false, error: "正在读取 Space 文件夹，请稍后重试。" });
      this.bindingFile = `${appHome()}/project-bindings.json`;
      this.bindingText = null;
      /** @type {Record<string,{checked:number,message:string}>} */
      this.bindingFailures = {};
      /** @type {Record<string,number>} */
      this.metadataChecked = {};
      this.refreshProjects(cx);
      cx.timer.every(1000, cx => { this.refreshProjects(cx); this.publishOffices(); });
      return;
    }
    this.floating = Boolean(placement() || props()?.overlay);
    this.parts = new RetainedParts();
    const legacyView = shared("agent-columns.directory-mode");
    if (typeof legacyView === "string" && shared("agent-columns.view") == null) setShared("agent-columns.view", legacyView === "flat" ? "default" : "directory");
    const uiVisible = () => globalThis.window.is_window_active()
      && (this.floating || layout()?.children?.some(node => node.id === "sidebar" && !node.hidden));
    this.dragFocus = {};
    this.syncDragFocus(cx);
    if (!this.floating && blockCollapsed("spaces")) toggleBlock("spaces");
    cx.spawn(async () => { for (;;) {
      const command = await nextCommand();
      if (command === "toggle-block") this.cycleFold();
      else if (command === "view.directory" || command === "view-directory") this.setMode("directory");
      else if (command === "view.team" || command === "view-team") this.setMode("team");
      else if (command === "view.default" || command === "view-default") this.setMode("default");
      else if (command === "view.fold" || command === "view-fold") setShared("agent-columns.view-fold-all", shared("agent-columns.view-fold-all") !== true);
    } });
    /** @type {Record<string, number>} */
    this.workingSince = {};
    this.sweepPhase = 0;
    cx.timer.every(1000, cx => {
      if (!uiVisible()) return;
      this.syncDragFocus(cx);
      this.parts.sync(cx);
      if (this.hasWorking) this.parts.notify("time", cx);
    });
    cx.timer.every(60000, cx => { if (uiVisible()) cx.notify(); });
    // Travel out and back continuously, then pause 2.5s before the next round trip.
    cx.timer.every(5700, cx => {
      if (!this.hasWorking || !uiVisible()) return;
      this.setSweepPhase(0, cx);
      cx.timer.after(60, cx => { if (uiVisible()) this.setSweepPhase(1, cx); });
      cx.timer.after(1660, cx => { if (uiVisible()) this.setSweepPhase(2, cx); });
      cx.timer.after(3260, cx => { if (uiVisible()) this.setSweepPhase(3, cx); });
    });
  }
  setMode(value) {
    if (shared("agent-columns.view") === value) return;
    setShared("agent-columns.fold-step", 0);
    if (value === "team") {
      const folded = { ...(shared("agent-columns.view-folded") ?? {}) };
      const all = panes(), raw = new Map(terminals().map(terminal => [terminal.address, terminal]));
      for (const group of groupPaths(spaces(), all, shared("workspace.project-bindings") ?? this.bindings, raw)) {
        for (const owner of teamNodes(group, raw)) if (owner.children.length) folded[`${group.id}::agent::${owner.key}`] = true;
      }
      setShared("agent-columns.view-folded", folded);
    }
    setShared("agent-columns.view", value);
  }
  cycleFold() {
    const step = shared("agent-columns.fold-step") ?? 0;
    const mode = shared("agent-columns.view");
    if (step === 0) {
      const folded = { ...(shared("agent-columns.view-folded") ?? {}) };
      const raw = new Map(terminals().map(terminal => [terminal.address, terminal]));
      for (const group of groupPaths(spaces(), panes(), shared("workspace.project-bindings") ?? this.bindings, raw)) {
        const nodes = mode === "team" ? teamNodes(group, raw) : mode === "default" ? tabNodes(group, raw) : directoryNodes(group, raw);
        for (const node of nodes) if (node.children.length) folded[`${group.id}::${node.kind}::${node.key}`] = true;
      }
      setShared("agent-columns.view-folded", folded);
    } else if (step === 2) setShared("agent-columns.view-folded", {});
    setShared("agent-columns.view-fold-all", false);
    setShared("agent-columns.spaces-folded", { ...(shared("agent-columns.spaces-folded") ?? {}), ...Object.fromEntries(spaces().map(space => [space.id, step === 1])) });
    setShared("agent-columns.fold-step", (step + 1) % 3);
  }
  setSweepPhase(phase, cx) {
    this.sweepPhase = phase;
    this.parts.setSweepPhase(phase, cx);
  }
  sweep(id, width, color) {
    return this.parts.element(id, "sweep", (entry, mountToken) => workingSweep(id, entry.phase, width, color)
      .when(Boolean(mountToken), el => el.on_size_change((_size, cx) => this.parts.mounted(id, mountToken, cx))), el => el.absolute().left(0).top(0).size_full(), JSON.stringify([id, width, color]));
  }
  icon(pane, status, id) {
    return div().size(18).flex_none().relative()
      .child(this.parts.element(`icon-${id}`, "body", () => sessionIcon(pane, id), el => el.size(18)))
      .when(["working", "done"].includes(status), el => el.child(this.parts.element(`pulse-${id}`, "pulse", () => div().size_full().relative().child(statusDot(status, id)), dot => dot.absolute().left(0).top(0).size(18), JSON.stringify([id, status, theme().working, theme().done]))));
  }
  syncDragFocus(cx) {
    const ids = new Set(spaces().map(space => space.id));
    for (const id of ids) if (!this.dragFocus[id]) this.dragFocus[id] = cx.focus_handle();
    for (const id of Object.keys(this.dragFocus)) if (!ids.has(id)) { this.dragFocus[id].release(); delete this.dragFocus[id]; }
    const focused = Object.keys(this.dragFocus).find(id => this.dragFocus[id].is_focused());
    if (focused !== this.focusedDrag) { this.focusedDrag = focused; cx.notify(); }
  }
  publishOffices() {
    if (shared("workspace.project-owner") !== this.projectOwner) return;
    const all = panes();
    const rawList = terminals();
    const sig = JSON.stringify([
      all.map(p => [p.pane, p.tab, p.title, p.focused, p.status, p.branch, p.workspaceFolder]),
      spaces().map(s => [s.id, s.name, s.active, s.tabs.map(t => [t.id, t.name, t.named, t.status, t.active])]),
      rawList.map(t => [t.address, t.parent, t.status, t.status_ms]),
    ]);
    if (sig === this.publishSig) return;
    this.publishSig = sig;
    const activeSpace = spaces().find(space => space.active);
    const activePane = all.find(pane => pane.focused);
    const activeWindow = `${activeSpace?.id ?? ""}:${activeSpace?.tabs.find(tab => tab.active)?.id ?? ""}:${activePane?.pane ?? ""}`;
    if (this.activeWindow && this.activeWindow !== activeWindow && activeSpace) {
      const folded = shared("agent-columns.spaces-folded") ?? {};
      if (folded[activeSpace.id]) setShared("agent-columns.spaces-folded", { ...folded, [activeSpace.id]: false });
    }
    this.activeWindow = activeWindow;
    const raw = new Map(terminals().map(terminal => [terminal.address, terminal]));
    const labels = Object.fromEntries(spaces().flatMap(space => space.tabs.map(tab => {
      const mine = all.filter(p => p.tab === tab.id);
      const status = [tab.status, ...mine.map(p => stateOf(p, raw.get(p.terminal)))].sort((a, b) => (rank[b] ?? 0) - (rank[a] ?? 0))[0];
      return [tab.id, { name: tabTitle(tab, all), status: status ?? null }];
    })));
    // A name that changes with a running timer would re-render every mod each tick; statuses publish at once.
    const statusOf = JSON.stringify(Object.fromEntries(Object.entries(labels).map(([id, label]) => [id, label.status])));
    const nameOf = JSON.stringify(Object.fromEntries(Object.entries(labels).map(([id, label]) => [id, label.name])));
    if (statusOf !== this.labelStatus || (nameOf !== this.labelNames && Date.now() - (this.labelAt ?? 0) >= 2000)) {
      this.labelStatus = statusOf;
      this.labelNames = nameOf;
      this.labelAt = Date.now();
      setShared("workspace.tab-labels", labels);
    }
    const groups = groupPaths(spaces(), all, this.bindings, raw);
    const snapshot = groups.map(group => ({
      id: group.id, projectKey: group.projectKey, name: group.name, folder: group.folder, machine: group.machine, duplicateOf: group.duplicateOf,
      target: { space: group.space.id },
      members: group.entries.flatMap(entry => entry.members.map(pane => ({ pane: pane.pane, terminal: pane.terminal, tab: entry.tab.id, space: entry.space.id, worktree: pane.worktree }))),
    }));
    const encoded = JSON.stringify(snapshot);
    if (encoded !== this.officeSnapshot) {
      this.officeSnapshot = encoded;
      setShared("workspace.office-groups", snapshot);
    }
  }
  /** @param {import('gpui-kit').Context} cx */
  refreshProjects(cx) {
    if (this.projectBusy || this.bindingLoadFailed || shared("workspace.project-owner") !== this.projectOwner) return;
    this.projectBusy = true;
    cx.spawn(async cx => {
      let result;
      try {
        if (!this.bindingsLoaded) {
          this.bindingText = await readTextFile(this.bindingFile);
          if (this.bindingText !== null) {
            const saved = JSON.parse(this.bindingText);
            if (saved.version !== 1 || !saved.bindings || Array.isArray(saved.bindings) || typeof saved.bindings !== "object"
              || Object.values(saved.bindings).some(binding => !binding || typeof binding.root !== "string" || typeof binding.projectKey !== "string" || !Array.isArray(binding.worktrees)
                || (binding.folders !== undefined && (!Array.isArray(binding.folders) || !binding.folders.length || binding.folders.some(folder => !folder || typeof folder.path !== "string" || typeof folder.root !== "string" || typeof folder.projectKey !== "string" || !Array.isArray(folder.worktrees)))))) throw new Error("项目绑定文件格式不正确，已停止写入");
            this.bindings = saved.bindings;
          }
          this.bindingsLoaded = true;
        }
        const liveIds = new Set(spaces().map(space => space.id));
        const available = new Set(machines().filter(machine => machine.layout === "ready").map(machine => machine.name));
        for (const [id, binding] of Object.entries(this.bindings)) if (!liveIds.has(id) && available.has(binding.machine)) delete this.bindings[id];
        const raw = new Map(terminals().map(terminal => [terminal.address, terminal]));
        for (const space of spaces()) {
          if (!this.bindings[space.id] && Date.now() - (this.bindingFailures[space.id]?.checked ?? 0) > 30000) {
            try {
              let folder = space.folder;
              if (!folder) {
                if (!space.machine) folder = home();
                else {
                  const result = await exec("printenv", ["HOME"], { on: space.machine });
                  if (result.code !== 0 || !result.stdout.trim()) throw new Error("无法读取远程主目录");
                  folder = result.stdout.trim();
                }
              }
              this.bindings[space.id] = await resolveProject(folder, space.machine, exec);
              this.metadataChecked[this.bindings[space.id].projectKey] = Date.now();
              delete this.bindingFailures[space.id];
            } catch (error) { this.bindingFailures[space.id] = { checked: Date.now(), message: String(error) }; }
          }
          const binding = this.bindings[space.id];
          if (binding) {
            for (const project of binding.folders ?? [binding]) {
              if (!project.git || Date.now() - (this.metadataChecked[project.projectKey] ?? 0) <= 30000) continue;
              this.metadataChecked[project.projectKey] = Date.now();
              try {
                const worktrees = await readWorktrees(project.root, binding.machine, exec);
                if (projectKey(binding.machine, worktrees[0].path) !== project.projectKey) throw new Error("项目根目录已改变，请显式打开新项目");
                for (const value of Object.values(this.bindings)) {
                  if (value.projectKey === project.projectKey) value.worktrees = worktrees;
                  for (const folder of value.folders ?? []) if (folder.projectKey === project.projectKey) folder.worktrees = worktrees;
                }
                delete this.bindingFailures[space.id];
              } catch (error) { this.bindingFailures[space.id] = { checked: Date.now(), message: String(error) }; }
            }
            binding.primarySpace = primarySpace(binding.projectKey, spaces(), this.bindings)?.id;
            rememberWorktrees(space, binding, panes(), raw);
          }
        }
        const assertOwner = () => { if (shared("workspace.project-owner") !== this.projectOwner) throw new Error("项目操作的布局已切换"); };
        assertOwner();
        for (const space of spaces()) {
          if (available.has(space.machine)) await retainSpace(space, { spaces, panes, run: (name, args) => { assertOwner(); return run(name, args); }, sleep: ms => cx.sleep(ms) });
        }
        result = await consumeProjectRequest({ spaces, panes, exec, run, pickFolder, shared, setShared, sleep: ms => cx.sleep(ms) }, this.bindings, this.projectOwner);
        assertOwner();
        let text = JSON.stringify({ version: 1, bindings: this.bindings }, null, 2) + "\n";
        if (text !== this.bindingText) {
          try { await writeTextFile(this.bindingFile, text, this.bindingText); }
          catch {
            const current = await readTextFile(this.bindingFile);
            const saved = current === null ? { bindings: {} } : JSON.parse(current);
            this.bindings = mergeBindings(saved.bindings, this.bindings);
            text = JSON.stringify({ version: 1, bindings: this.bindings }, null, 2) + "\n";
            assertOwner();
            await writeTextFile(this.bindingFile, text, current);
          }
          this.bindingText = text;
        }
        const encoded = JSON.stringify(this.bindings);
        if (encoded !== this.bindingSnapshot) {
          this.bindingSnapshot = encoded;
          setShared("workspace.project-bindings", this.bindings);
        }
        if (result) {
          setShared("workspace.project-result", result);
          if (!result.ok) notify({ title: "Space 操作未完成", body: result.error, level: "warning" });
        }
        const status = { ready: true, errors: this.bindingFailures };
        const statusText = JSON.stringify(status);
        if (statusText !== this.projectStatusText) { this.projectStatusText = statusText; setShared("workspace.project-status", status); }
        this.publishOffices();
      } catch (error) {
        if (shared("workspace.project-owner") !== this.projectOwner) return;
        if (!this.bindingsLoaded) this.bindingLoadFailed = true;
        if (result) setShared("workspace.project-result", { id: result.id, ok: false, error: `保存文件夹失败：${String(error)}` });
        this.projectStatusText = "";
        const message = error == null || String(error) === "null" ? "文件夹服务读取或保存失败，请重新加载布局后重试。" : String(error);
        setShared("workspace.project-status", { ready: false, error: message });
      } finally { this.projectBusy = false; }
      if (shared("workspace.project-owner") === this.projectOwner && this.bindingSnapshot !== this.renderedBindingSnapshot) { this.renderedBindingSnapshot = this.bindingSnapshot; cx.notify(); }
    });
  }
  render() {
    if (this.coordinator) return div();
    const t = theme();
    const folded = /** @type {Record<string, boolean>} */ (shared("agent-columns.spaces-folded") ?? {});
    /** @param {string} id */
    const toggleFold = id => {
      const current = /** @type {Record<string, boolean>} */ (shared("agent-columns.spaces-folded") ?? {});
      setShared("agent-columns.spaces-folded", { ...current, [id]: !current[id] });
    };
    const mode = ["directory", "team", "default"].includes(shared("agent-columns.view")) ? shared("agent-columns.view") : "directory";
    const foldStep = shared("agent-columns.fold-step") ?? 0;
    const foldHint = foldStep === 1 ? "折叠全部 Space" : foldStep === 2 ? "展开全部 Space 和会话" : mode === "team" ? "折叠至 Team Owner" : mode === "default" ? "折叠至 Tab" : "折叠至目录";
    const groupFolded = /** @type {Record<string, boolean>} */ (shared("agent-columns.view-folded") ?? {});
    const foldAll = shared("agent-columns.view-fold-all") === true;
    const toggleGroupFold = key => setShared("agent-columns.view-folded", { ...groupFolded, [key]: !groupFolded[key] });
    const activateSpace = group => {
      if (sessionTabs(group.space, panes()).length) { toggleFold(group.id); return; }
      const home = homeTab(group.space, panes());
      if (!home) { notify({ title: "Space 首页尚未准备好", body: "请稍后再试。", level: "warning" }); return; }
      run("space.select", { id: group.space.id });
      run("tab.select", { id: home.id });
    };
    const all = panes();
    const raw = new Map(terminals().map(terminal => [terminal.address, terminal]));
    const bindings = shared("workspace.project-bindings") ?? this.bindings;
    const labels = shared("workspace.tab-labels") ?? {};
    const officeRooms = shared("layout") === "office" ? shared("agent-office.projects") : null;
    const activeOffice = Array.isArray(officeRooms) ? officeRooms.find(room => room.active)?.id : null;
    const hoveredOffice = shared("layout") === "office" ? shared("agent-office.hovered-project") : null;
    const states = new Map(all.map(p => [p.pane, stateOf(p, raw.get(p.terminal))]));
    const allSpacesFolded = spaces().length > 0 && spaces().every(space => folded[space.id]);
    const now = Date.now();
    const sweepWidth = Math.max(0, (this.width ?? 320) - 16);
    this.hasWorking = false;
    for (const p of all) {
      if (states.get(p.pane) === "working") {
        this.workingSince[p.pane] ??= coreState(p.terminal)?.since ?? now;
        this.hasWorking = true;
      } else delete this.workingSince[p.pane];
    }
    const groups = groupPaths(spaces(), all, bindings, raw);
    this.parts.begin(JSON.stringify([all, [...raw], spaces(), bindings, labels, folded, mode, groupFolded, foldAll, t, this.width,
      this.hoveredSpace, this.hoveredTab, this.hoveredPane, this.focusedDrag, activeOffice, hoveredOffice,
      this.draggingSpace, this.pressedSpace, this.overSpace, this.draggingTab, this.pressedTab, this.overTab, this.dropAfter,
      shared("space.colors"), shared("agent-columns.core-status"), Math.floor(now / 60000)]));
    // One aggregation layer: switch between directory / branch / flat organization without
    // changing Space, tab, pane or terminal identity. Directory groups fold independently.
    const modeBar = () => {
      const option = (value, label) => div().flex_1().h(20).flex().items_center().justify_center().rounded(4).text_size(11)
        .bg(mode === value ? t.selected : t.chrome + "00").text_color(mode === value ? t.foreground : t.muted)
        .cursor_pointer().hover(s => s.text_color(t.foreground)).role("button").accessibility_label(label)
        .on_click((_e, cx) => { cx.stop_propagation(); this.setMode(value); }).child(label);
      return h_flex().id("view-mode").h(28).flex_none().px(8).mb(6).items_center()
        .child(h_flex().flex_1().h(24).px(2).py(2).gap(2).rounded(6).bg(t.raised).accessibility_label("列表组织方式")
          .child(option("directory", "目录")).child(option("team", "Team")).child(option("default", "默认")));
    };
    const focusedPane = all.find(p => p.focused);
    const focusedTerminal = focusedPane?.terminal ?? null;
    const foldKey = (node, group) => `${group.id}::${node.kind}::${node.key}`;
    const nodeWorking = node => node.kind === "agent"
      ? (states.get(node.agent.pane.pane) === "working" || node.children.some(nodeWorking))
      : node.children.some(nodeWorking);
    const nodeContains = (node, terminal) => node.kind === "agent"
      ? (node.agent.terminal === terminal || node.children.some(child => nodeContains(child, terminal)))
      : node.children.some(child => nodeContains(child, terminal));
    const memberCount = node => node.kind === "agent" ? 1 + node.children.reduce((n, c) => n + memberCount(c), 0) : node.children.reduce((n, c) => n + memberCount(c), 0);
    // Tree geometry: icons sit at 39 + depth*16; a group/team-root hangs a chevron at 20 and its
    // trunk runs at the parent's icon axis. Ancestor trunks pass through as continuous verticals.
    const iconX = depth => 39 + depth * 16;
    const trunkX = depth => depth === 0 ? 12 : iconX(depth - 1);
    const hangX = depth => depth === 0 ? 20 : iconX(depth);
    const treeLines = (depth, isLast, trunks) => {
      const lines = [];
      for (const x of trunks) lines.push(div().absolute().left(x).top(0).bottom(0).w(1).bg(t.dim + "4d"));
      const tX = trunkX(depth), sw = hangX(depth) - tX - 1;
      if (isLast) lines.push(div().absolute().left(tX).top(0).w(sw).h(15).border_l(1).border_b(1).border_color(t.dim + "59").rounded_bl(5));
      else {
        lines.push(div().absolute().left(tX).top(0).bottom(0).w(1).bg(t.dim + "4d"));
        lines.push(div().absolute().left(tX).top(14).w(sw).h(1).bg(t.dim + "4d"));
      }
      return lines;
    };
    // Continuous block background: the weak-highlight block keeps only its outer corners; the
    // focused row's full-width bar stays straight.
    const roundRow = (el, corner) => corner === "top" ? el.rounded_t(6) : corner === "bottom" ? el.rounded_b(6) : corner === "single" ? el.rounded(6) : el;
    // One agent leaf: the focused row keeps a full-width highlight; rows inside the focused
    // block get a weak wash. No border, left block, ring or multi-select marker.
    const agentRow = (agent, group, depth, inBlock, childrenCount, isLast, trunks, closed, hasWorking, onToggle, corner) => {
      const p = agent.pane;
      const status = states.get(p.pane);
      const stale = staleSession(raw.get(p.terminal)?.status_ms ?? coreState(p.terminal)?.since, now);
      const isAgent = Boolean(p.program?.agent || status);
      const isFocused = agent.terminal === focusedTerminal;
      const title = roleTitle(paneTitle(p), p, raw);
      const indent = hangX(depth);
      const roundCorner = isFocused ? "none" : (inBlock ? corner : "single");
      const bg = isFocused ? t.selected : inBlock ? t.accent + "14" : status === "done" ? t.done + "18" : t.chrome + "00";
      const lead = depth === 0 ? (childrenCount > 0
        ? div().size(14).flex_none().flex().items_center().justify_center().text_color(t.muted).cursor_pointer()
            .tooltip(closed ? "展开 Team" : "折叠 Team").on_click((_e, cx) => { cx.stop_propagation(); onToggle(); })
            .child(svg(`mods/workspace-chrome/chevron-${closed ? "right" : "down"}.svg`).size(12))
        : div().size(14).flex_none()) : null;
      return roundRow(h_flex().id(`agent-${group.id}-${p.pane}`).relative().w_full().h(30).flex_none().items_center().gap(4).pl(indent).pr(8), roundCorner)
        .bg(bg).hover((s) => s.bg(isFocused ? t.selected : inBlock ? t.accent + "1e" : t.hover)).cursor_pointer()
        .when(status === "working" || (closed && hasWorking), el => el.child(this.sweep(`sweep-agent-${p.pane}`, sweepWidth, t.working)))
        .children(treeLines(depth, isLast, trunks))
        .when(Boolean(lead), el => el.child(lead))
        .on_hover((hovered, cx) => { this.hoveredPane = hovered ? p.pane : (this.hoveredPane === p.pane ? null : this.hoveredPane); cx.notify(); })
        .on_click(event => { restoreZoom(agent.tab.id, p.pane, p.terminal); run("space.select", { id: group.space.id }); run("tab.select", { id: agent.tab.id }); run("pane.focus", { pane: p.pane }); if (event.click_count === 2 && isAgent) maximizePane(p.pane); })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); menu("pane", { pane: p.pane, terminal: p.terminal }); })
        .child(this.icon(p, status, `agent-${p.pane}`))
        .child(this.parts.element(`body-agent-${group.id}-${p.pane}`, "body", () => h_flex().size_full().items_center().gap(4)
          .when(Boolean(p.terminal && raw.get(p.terminal) && isAgent), el => el.child(div().id(`role-agent-${p.pane}`).size(13).flex_none().tooltip(raw.get(p.terminal).parent ? `子 Agent · 父级：${raw.get(p.terminal).parent}` : "主 Agent")
            .child(svg(`mods/agent-columns-spaces/agent-chat-${raw.get(p.terminal).parent ? "worker" : "lead"}.svg`).size(13).text_color(raw.get(p.terminal).parent ? t.muted : t.accent))))
          .when(Boolean(p.terminal && isAgent), el => el.child(div().id(`id-agent-${p.pane}`).max_w(70).flex_none().truncate().text_size(9).line_height(12).text_color(t.working).tooltip(p.terminal).child(p.terminal)))
          .child(div().id(`label-agent-${p.pane}`).min_w(0).flex_shrink_1().truncate().text_size(12).line_height(16).text_color(stale ? t.dim : isFocused ? t.foreground : t.muted)
            .tooltip(status === "done" ? `${title} · 已完成，待查看` : title).child(title))
          .when(Boolean(p.workspaceFolder) && p.workspaceFolder !== p.gitTree?.path, el => el.child(folderBadge(p.workspaceFolder, stale)))
          .when(Boolean(p.worktree), el => el.child(div().id(`branch-agent-${p.pane}`).size(11).flex_none().tooltip(worktreeTooltip(p.worktree)).child(svg("mods/workspace-chrome/git-branch.svg").size(11).text_color(stale ? t.dim : t.muted))))
          .child(div().flex_1().min_w(0)), el => el.w_full().h(24).flex_1().min_w(0)))
        .when(childrenCount > 1, el => el.child(div().flex_none().px(5).py(2).rounded(4).bg(t.raised).text_size(10).text_color(t.muted).tooltip(`${childrenCount} 成员`).child(String(childrenCount))))
        .child(this.parts.element(`time-agent-${group.id}-${p.pane}`, "time", () => h_flex().w(60).h(22).flex_none().relative().items_center().justify_end().gap(2)
          .when(this.hoveredPane !== p.pane && status === "done", el => el.child(div().text_size(10).text_color(t.foreground).tooltip("已完成，待查看").child("✓")))
          .when(this.hoveredPane !== p.pane && status !== "working", el => el.child(updateTime(raw.get(p.terminal)?.status_ms ?? coreState(p.terminal)?.since, Date.now(), t)))
          .when(this.hoveredPane !== p.pane && status === "working", el => { const start = raw.get(p.terminal)?.status_ms ?? coreState(p.terminal)?.since; return el.child(div().text_size(10).text_color(t.working).tooltip(start ? "本轮 agent 已工作时长" : "从本次观察到 Working 起计时").child(`${start ? "" : "~"}${duration(Date.now() - (start ?? this.workingSince[p.pane]))}`)); })
          .when(this.hoveredPane === p.pane, el => el.child(btn(`close-agent-${p.pane}`, "x", () => run("pane.close", { pane: p.pane })).absolute().right(0).top(0).bg(t.chrome))), el => el.w(60).h(22).flex_none()));
    };
    // Directory / tab group header; the plus opens the launcher with the directory context.
    const groupHeader = (node, group, depth, inBlock, isLast, trunks, corner) => {
      const key = foldKey(node, group);
      const closed = groupFolded[key] || foldAll;
      const isDirectory = node.kind === "directory";
      const title = isDirectory ? node.name : (labels[node.tab.id]?.name ?? tabTitle(node.tab, all));
      const hasWorking = nodeWorking(node);
      const indent = hangX(depth);
      const countText = node.children.length;
      const roundCorner = inBlock ? corner : "single";
      return roundRow(h_flex().id(`grp-${group.id}-${node.kind}-${node.key}`).relative().w_full().h(30).flex_none().pl(indent).pr(8).items_center().gap(5), roundCorner)
        .bg(inBlock ? t.accent + "14" : t.chrome + "00").hover((s) => s.bg(inBlock ? t.accent + "1e" : t.hover)).cursor_pointer()
        .tooltip(isDirectory ? (node.worktree ? `${node.path}\n${worktreeTooltip(node.worktree)}` : node.path) : `${node.tab.id} · ${title}`)
        .when(closed && hasWorking, el => el.child(this.sweep(`sweep-grp-${key}`, sweepWidth, t.working)))
        .children(treeLines(depth, isLast, trunks))
        .on_click((_e, cx) => { cx.stop_propagation(); if (countText) toggleGroupFold(key); else { run("space.select", { id: group.space.id }); run("tab.select", { id: node.tab.id }); } })
        .child(div().size(14).flex_none().flex().items_center().justify_center().text_color(t.muted)
          .when(countText > 0, el => el.child(svg(`mods/workspace-chrome/chevron-${closed ? "right" : "down"}.svg`).size(12))))
        .child(svg(isDirectory ? "mods/files/folder.svg" : "mods/workspace-chrome/layers.svg").size(13).text_color(t.dim))
        .child(div().flex_1().min_w(0).truncate().text_size(12).flex().items_center().gap(4)
          .child(div().truncate().when(hasWorking, el => el.font_black()).text_color(hasWorking ? t.foreground : t.muted).child(title))
          .when(isDirectory && Boolean(node.branch), el => el.child(h_flex().flex_none().items_center().gap(2).tooltip(node.worktree ? worktreeTooltip(node.worktree) : `${node.branch} · ${node.path}`)
            .child(svg("mods/workspace-chrome/git-branch.svg").size(10).text_color(t.dim)).child(div().text_size(10).text_color(t.dim).truncate().child(node.branch))))
          .when(isDirectory && node.kindTag, el => el.child(div().flex_none().px(4).py(1).rounded(3).bg(t.raised).text_size(9).text_color(t.dim).tooltip(node.worktree ? worktreeTooltip(node.worktree) : node.path).child(node.kindTag))))
        .child(div().flex_none().flex().items_center().gap(4)
          .when(countText > 0, el => el.child(div().text_size(10).text_color(t.dim).tooltip(`${countText} 会话`).child(String(countText))))
          .when(hasWorking && closed, el => el.child(div().size(6).rounded(3).bg(t.working)))
          .when(isDirectory, el => el.child(btn(`new-agent-${group.id}-${node.key}`, "plus", () => openOverlay({ mod: "space-home", kind: "dialog", width: 860, height: 680, props: { space: group.space.id, folder: node.path, launcher: true } })))));
    };
    // Build one Space's view nodes and render them recursively. Ancestor trunks are passed down
    // so the outer vertical line stays continuous through a group's children and the gap.
    const spaceNodes = group => mode === "directory" ? directoryNodes(group, raw) : mode === "team" ? teamNodes(group, raw) : tabNodes(group, raw);
    const renderNode = (node, group, depth, inBlock, isLast, trunks = [], chainLast = true) => {
      const key = foldKey(node, group);
      const closed = groupFolded[key] || foldAll;
      const children = node.children ?? [];
      const rendered = !closed ? children : [];
      const corner = depth === 0
        ? (rendered.length ? "top" : "single")
        : (chainLast && !rendered.length ? "bottom" : "middle");
      const childTrunks = isLast ? trunks : [...trunks, trunkX(depth)];
      const renderChild = (child, ci) => {
        const childIsLast = ci === rendered.length - 1;
        return renderNode(child, group, depth + 1, inBlock, childIsLast, childTrunks, chainLast && childIsLast);
      };
      if (node.kind === "agent") return [agentRow(node.agent, group, depth, inBlock, children.length ? memberCount(node) : 0, isLast, trunks, closed, closed && nodeWorking(node), () => toggleGroupFold(key), corner), ...rendered.flatMap(renderChild)];
      return [groupHeader(node, group, depth, inBlock, isLast, trunks, corner), ...rendered.flatMap(renderChild)];
    };
    return v_flex().id("spaces-root").size_full().bg(t.chrome).px(8).pb(8).overflow_hidden()
      .on_size_change((size, cx) => { if (this.width !== size.width) { this.width = size.width; cx.notify(); } })
      .on_hover((hovered, cx) => {
        if (hovered) return;
        let changed = false;
        if (this.pressedSpace) { this.pressedSpace = null; this.overSpace = null; this.draggingSpace = false; changed = true; }
        if (this.pressedTab) { this.pressedTab = null; this.overTab = null; this.draggingTab = false; changed = true; }
        if (changed) cx.notify();
      })
      .on_mouse_up("left", (_event, cx) => {
        let changed = false;
        if (this.pressedSpace) { this.pressedSpace = null; this.overSpace = null; this.draggingSpace = false; changed = true; }
        if (this.pressedTab) { this.pressedTab = null; this.overTab = null; this.draggingTab = false; changed = true; }
        if (changed) cx.notify();
      })
      .child(h_flex().id("spaces-header").h(30).flex_none().px(8).gap(6).items_center().text_size(11.5).text_color(t.dim).cursor_pointer()
        .tooltip(foldHint).hover(s => s.bg(t.hover))
        .on_click((_event, cx) => { cx.stop_propagation(); this.cycleFold(); })
        .child(div().id("spaces-title").flex_1().h_full().flex().items_center().child("Spaces")
          .on_click((_event, cx) => { cx.stop_propagation(); this.cycleFold(); }))
        .child(btn("fold-spaces", allSpacesFolded ? "chevron-right" : "chevron-down", () => this.cycleFold())
          .tooltip(foldHint))
        .child(btn("new-space", "plus", () => openOverlay({ mod: "space-folders", kind: "dialog", width: 560, height: 500, props: { machine: spaces().find(space => space.active)?.machine } }))))
      .child(modeBar())
      .child(v_flex().id("spaces-list").w_full().flex_1().min_h(0).overflow_y_scrollbar().children(groups.map((group, i) =>
        v_flex().id(`space-card-${group.id}`).relative().w_full().mb(4).rounded(6)
          .bg(group.id === hoveredOffice ? t.hover : group.id === activeOffice ? t.selected : t.chrome)
          .when(this.draggingSpace && this.pressedSpace === group.id, el => el.opacity(0.5))
          .when(this.draggingSpace && this.overSpace === group.id && this.pressedSpace !== group.id, el => el.child(div().absolute().left(4).right(4).when(this.dropAfter, line => line.bottom(0)).when(!this.dropAfter, line => line.top(0)).h(2).bg(t.accent)))
          .on_mouse_move((event, cx) => {
            if (!this.pressedSpace) return;
            const source = spaces().find(space => space.id === this.pressedSpace);
            const dragging = this.draggingSpace || Math.hypot(event.position.x - this.pressPosition.x, event.position.y - this.pressPosition.y) >= 5;
            const over = dragging && source && (source.machine ?? null) === (group.machine ?? null) ? group.id : null;
            const after = event.local_position.y >= event.bounds.height / 2;
            if (dragging !== this.draggingSpace || over !== this.overSpace || after !== this.dropAfter) {
              this.draggingSpace = dragging; this.overSpace = over; this.dropAfter = after; cx.notify();
            }
          })
          .on_mouse_up("left", (_event, cx) => {
            if (!this.pressedSpace) return;
            const from = this.pressedSpace, over = this.overSpace, dragging = this.draggingSpace, after = this.dropAfter;
            this.pressedSpace = null; this.overSpace = null; this.draggingSpace = false;
            if (dragging && over === group.id && from !== over) {
              const ordered = spaces();
              const fromIndex = ordered.findIndex(space => space.id === from);
              const targetIndex = ordered.findIndex(space => space.id === over);
              if (fromIndex !== -1 && targetIndex !== -1) {
                const index = targetIndex - (fromIndex < targetIndex ? 1 : 0) + (after ? 1 : 0);
                if (index !== fromIndex) run("space.move", { id: from, index: index + 1 });
              }
              cx.stop_propagation();
            }
            cx.notify();
          })
          .children([
        div().relative().w_full().h(34).flex_none().rounded(6).bg(t.chrome + "00").hover(s => s.bg(t.hover))
          .on_hover((hovered, cx) => { this.hoveredSpace = hovered ? group.id : (this.hoveredSpace === group.id ? null : this.hoveredSpace); cx.notify(); })
          .when(Boolean(folded[group.id]) && group.entries.some(entry => entry.members.some(pane => states.get(pane.pane) === "working")), el => el.child(this.sweep(`sweep-space-${group.id}`, sweepWidth, t.working)))
          .child(this.parts.element(`body-space-${group.id}`, "body", () => h_flex().id(`folder-${group.id}`).relative().w_full().h(34).items_center().gap(7).px(8).py(6).rounded(6)
          .on_click(() => activateSpace(group))
          .cursor_pointer()
          .tooltip((group.binding.folders ?? [{ path: group.folder }]).map(folder => `${group.machine ? group.machine + ":" : ""}${folder.path}`).join("\n"))
          .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); menu("space", { id: group.space.id }); })
          .child(div().id(`folder-fold-${group.id}`).size(14).flex_none().flex().items_center().justify_center().text_color(t.muted)
            .tooltip(sessionTabs(group.space, all).length ? (folded[group.id] ? "展开 Space" : "折叠 Space") : "打开 Space 首页")
            .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
            .on_click((_event, cx) => { cx.stop_propagation(); activateSpace(group); })
            .child(svg(`mods/workspace-chrome/chevron-${folded[group.id] ? "right" : "down"}.svg`).size(12)))
          .child(div().id(`space-home-${group.id}`).cursor_pointer().tooltip(sessionTabs(group.space, all).length ? (folded[group.id] ? "展开 Space" : "折叠 Space") : "打开 Space 首页")
            .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
            .on_click((_event, cx) => { cx.stop_propagation(); activateSpace(group); })
            .child(avatar({ ...group.space, name: group.name }, i)))
          .child(div().id(`folder-title-${group.id}`).flex_1().min_w(0).truncate().text_size(13.5).text_color(t.dim).when(projectActive(group.space, all, states, raw, coreState, now), el => el.font_black().text_color(t.foreground))
            .tooltip(sessionTabs(group.space, all).length ? (folded[group.id] ? "展开 Space" : "折叠 Space") : "打开 Space 首页")
            .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
            .on_click((_event, cx) => { cx.stop_propagation(); activateSpace(group); })
            .child(group.machine ? `${group.name} · ${group.machine}` : group.name))
          .child(div().id(`space-tail-${group.id}`).flex_none().flex().items_center().gap(4).justify_end()
            .child((this.hoveredSpace === group.id || this.focusedDrag === group.id)
              ? div().id(`drag-space-${group.id}`).size(16).flex_none().flex().items_center().justify_center().text_size(13).text_color(t.dim)
                  .hover(s => s.text_color(t.muted))
                  .cursor_grab().tooltip("拖动排序；键盘上下键调整顺序").role("button").accessibility_label(`调整 ${group.name} 顺序`)
                  .when(Boolean(this.dragFocus[group.id]), el => el.track_focus(this.dragFocus[group.id]).tab_index(0))
                  .on_key_down((event, cx) => {
                    const direction = event.key === "up" ? -1 : event.key === "down" ? 1 : 0;
                    if (!direction) return;
                    const ordered = spaces(), index = ordered.findIndex(space => space.id === group.id), next = ordered[index + direction];
                    if (next && (next.machine ?? null) === (group.machine ?? null)) run("space.move", { id: group.id, index: index + direction + 1 });
                    cx.stop_propagation();
                  })
                  .on_mouse_down("left", (event, cx) => { cx.stop_propagation(); this.pressedSpace = group.id; this.pressPosition = event.position; this.overSpace = null; this.draggingSpace = false; })
                  .on_click((_event, cx) => cx.stop_propagation()).child("⋮⋮")
              : div().size(16).flex_none())
            .child(div().id(`manage-folders-${group.id}`).text_size(10).text_color(t.dim).cursor_pointer().tooltip("管理 Space 文件夹")
              .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
              .on_click((_event, cx) => { cx.stop_propagation(); openOverlay({ mod: "space-folders", kind: "dialog", width: 560, height: 500, props: { edit: true, space: group.space.id } }); })
              .child(`${group.binding.folders?.length ?? 1}目录`)))
          , el => el.w_full().h(34))),
        ...(folded[group.id] ? [] : spaceNodes(group)).flatMap((node, ni) => renderNode(node, group, 0, nodeContains(node, focusedTerminal), ni === spaceNodes(group).length - 1)),
      ]))));
  }
}
