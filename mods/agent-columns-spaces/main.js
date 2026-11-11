import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, panes, terminals, machines, theme, layout, run, shared, setShared, openOverlay, exec, nextCommand, appHome, home, readTextFile, writeTextFile, pickFolder, notify } from "herdr";
import { blockCollapsed, toggleBlock } from "./sidebar-collapse.js";
import { groupPaths } from "./path-groups.js";
import { resolveProject, primarySpace, rememberWorktrees, consumeProjectRequest, mergeBindings } from "./project-bindings.js";
import { clean, tabTitle } from "./tab-title.js";
import { homeTab, retainSpace, sessionTabs } from "./space-home.js";
import { sessionTime, staleSession } from "./session-time.js";

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
const sessionIcon = (pane, status, id) => div().size(18).flex_none().relative()
  .child(div().id(`session-icon-${id}`).absolute().left(0).top(0).size(15)
    .child((pane?.program?.icon ? (pane.program.tint ? svg(pane.program.icon).text_color(theme().muted) : image(pane.program.icon)) : svg("icons/shell.svg").text_color(theme().muted)).size(15)))
  .when(["working", "done"].includes(status), el => el.child(statusDot(status, id)));
const workingSweep = (id, phase, width, color) => div().absolute().left(0).right(0).top(0).bottom(0).rounded(6).overflow_hidden()
  .child(div().id(id).absolute().left(width * (phase === 0 ? -0.605 : phase === 1 ? 0.3 : 1.05)).top(0).w(width * 0.55).h_full().opacity(phase === 2 ? 0 : 1)
    .transition("left", { duration: phase === 0 ? 0 : phase === 1 ? 1600 : 650, easing: "linear" })
    .transition("opacity", { duration: phase === 2 ? 650 : 0, easing: "ease-out" })
    .child(svg("mods/agent-columns-spaces/working-sweep.svg").size_full().text_color(color)));
// Small clickable glyph; stops the click so the row behind it doesn't also fire.
const btn = (id, icon, fn) => div().id(id).flex_none().size(22).flex().items_center().justify_center().rounded(6)
  .text_color(theme().muted).cursor_pointer().hover((s) => s.bg(theme().hover).text_color(theme().foreground))
  .child(svg(`mods/workspace-chrome/${icon}.svg`).size(13))
  .on_click((_e, cx) => { cx.stop_propagation(); fn(); });
const paneTitle = (p) => clean(p.title) || p.program?.name || "Terminal";
const folderBadge = (path, stale) => div().max_w(85).flex_none().truncate().text_size(10).text_color(theme().dim)
  .when(stale, el => el.opacity(0.65)).tooltip(`工作目录：${path}`).child(path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || path);
/** @param {import("herdr").PaneInfo} p @param {string} id */
const splitButton = (p, id) => div().id(`split-${id}`).size(22).flex_none().flex().items_center().justify_center().rounded(6)
  .text_color(theme().muted).cursor_pointer().hover(s => s.bg(theme().hover).text_color(theme().foreground))
  .tooltip("分屏：选择左右 / 上下及 Agent").child(svg("mods/pane/split-right.svg").size(13))
  .on_click((_e, cx) => {
    cx.stop_propagation();
    openOverlay({ mod: "agent-columns-new-menu", kind: "popup", width: 320, height: 336, props: { pane: p.pane, direction: "right", chooseDirection: true } });
  });


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
    this.dragFocus = {};
    this.syncDragFocus(cx);
    cx.spawn(async () => { for (;;) { if (await nextCommand() === "toggle-block") toggleBlock("spaces"); } });
    /** @type {Record<string,import('./project-bindings.js').Binding>} */
    this.bindings = {};
    this.projectOwner = `${Date.now()}-${Math.random()}`;
    setShared("workspace.project-owner", this.projectOwner);
    this.bindingFile = `${appHome()}/project-bindings.json`;
    this.bindingText = null;
    /** @type {Record<string,{checked:number,message:string}>} */
    this.bindingFailures = {};
    /** @type {Record<string,number>} */
    this.metadataChecked = {};
    this.refreshProjects(cx);
    /** @type {Record<string, number>} */
    this.workingSince = {};
    this.sweepPhase = 0;
    this.publishOffices();
    cx.timer.every(1000, cx => { this.syncDragFocus(cx); this.refreshProjects(cx); this.publishOffices(); if (this.hasWorking) cx.notify(); });
    cx.timer.every(60000, cx => { if (!this.hasWorking) cx.notify(); });
    cx.timer.every(2300, cx => {
      if (!this.hasWorking) return;
      this.sweepPhase = 0;
      cx.notify();
      cx.timer.after(50, cx => {
        this.sweepPhase = 1;
        cx.notify();
        cx.timer.after(1600, cx => { this.sweepPhase = 2; cx.notify(); });
      });
    });
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
    const labelText = JSON.stringify(labels);
    if (labelText !== this.tabLabelSnapshot) {
      this.tabLabelSnapshot = labelText;
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
              if (!project.git || Date.now() - (this.metadataChecked[project.projectKey] ?? 0) <= 5000) continue;
              this.metadataChecked[project.projectKey] = Date.now();
              try {
                const current = await resolveProject(project.root, binding.machine, exec);
                if (current.projectKey !== project.projectKey) throw new Error("项目根目录已改变，请显式打开新项目");
                for (const value of Object.values(this.bindings)) {
                  if (value.projectKey === project.projectKey) value.worktrees = current.worktrees;
                  for (const folder of value.folders ?? []) if (folder.projectKey === project.projectKey) folder.worktrees = current.worktrees;
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
        setShared("workspace.project-status", { ready: false, error: String(error) });
      } finally { this.projectBusy = false; }
      if (shared("workspace.project-owner") === this.projectOwner && this.bindingSnapshot !== this.renderedBindingSnapshot) { this.renderedBindingSnapshot = this.bindingSnapshot; cx.notify(); }
    });
  }
  render() {
    const t = theme();
    const folded = /** @type {Record<string, boolean>} */ (shared("agent-columns.spaces-folded") ?? {});
    /** @param {string} id */
    const toggleFold = id => {
      const current = /** @type {Record<string, boolean>} */ (shared("agent-columns.spaces-folded") ?? {});
      setShared("agent-columns.spaces-folded", { ...current, [id]: !current[id] });
    };
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
    const now = Date.now();
    const sweepWidth = Math.max(0, (this.width ?? 320) - 16);
    this.hasWorking = false;
    for (const p of all) {
      if (states.get(p.pane) === "working") {
        this.workingSince[p.pane] ??= coreState(p.terminal)?.since ?? now;
        this.hasWorking = true;
      } else delete this.workingSince[p.pane];
    }
    return v_flex().id("spaces-root").size_full().bg(t.chrome).px(8).pb(8).overflow_y_scrollbar()
      .on_size_change((size, cx) => { if (this.width !== size.width) { this.width = size.width; cx.notify(); } })
      .on_hover((hovered, cx) => { if (!hovered && this.pressedSpace) { this.pressedSpace = null; this.overSpace = null; this.draggingSpace = false; cx.notify(); } })
      .on_mouse_up("left", (_event, cx) => { if (this.pressedSpace) { this.pressedSpace = null; this.overSpace = null; this.draggingSpace = false; cx.notify(); } })
      .child(h_flex().id("spaces-header").h(30).flex_none().px(8).items_center().text_size(11.5).text_color(t.dim).cursor_pointer()
        .tooltip(blockCollapsed("spaces") ? "展开 Spaces" : "折叠 Spaces").hover(s => s.bg(t.hover))
        .on_click((_event, cx) => { cx.stop_propagation(); toggleBlock("spaces"); })
        .child(div().id("spaces-title").flex_1().h_full().flex().items_center().child("Spaces")
          .on_click((_event, cx) => { cx.stop_propagation(); toggleBlock("spaces"); }))
        .child(btn("new-space", "plus", () => openOverlay({ mod: "space-folders", kind: "dialog", width: 560, height: 500, props: { machine: spaces().find(space => space.active)?.machine } }))))
      .children((blockCollapsed("spaces") ? [] : groupPaths(spaces(), all, bindings, raw)).map((group, i) =>
        v_flex().id(`space-card-${group.id}`).relative().w_full().mb(12).rounded(7)
          .bg(group.id === hoveredOffice ? t.hover : group.id === activeOffice || group.active ? t.selected : t.raised)
          .border(1).border_color(group.id === activeOffice || group.active ? t.accent : t.border)
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
          .child(div().absolute().left(0).top(7).bottom(7).w(group.id === activeOffice || group.active ? 3 : 2).rounded(2).bg(spaceColor(group.space, i)))
          .children([
        h_flex().id(`folder-${group.id}`).relative().items_center().gap(7).px(8).py(5).rounded(6)
          .bg(t.chrome + "00")
          .when(Boolean(folded[group.id]) && group.entries.some(entry => entry.members.some(pane => states.get(pane.pane) === "working")), el => el.child(workingSweep(`sweep-space-${group.id}`, this.sweepPhase, sweepWidth, spaceColor(group.space, i))))
          .on_hover((hovered, cx) => { this.hoveredSpace = hovered ? group.id : (this.hoveredSpace === group.id ? null : this.hoveredSpace); cx.notify(); })
          .on_click(() => activateSpace(group))
          .hover(s => s.bg(t.hover)).cursor_pointer()
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
          .child(div().id(`folder-title-${group.id}`).flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground)
            .tooltip(sessionTabs(group.space, all).length ? (folded[group.id] ? "展开 Space" : "折叠 Space") : "打开 Space 首页")
            .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
            .on_click((_event, cx) => { cx.stop_propagation(); activateSpace(group); })
            .child(group.machine ? `${group.name} · ${group.machine}` : group.name))
          .when(Boolean(group.binding.folders), el => el.child(div().id(`manage-folders-${group.id}`).text_size(10).text_color(t.dim).cursor_pointer().tooltip("管理 Space 文件夹")
            .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
            .on_click((_event, cx) => { cx.stop_propagation(); openOverlay({ mod: "space-folders", kind: "dialog", width: 560, height: 500, props: { edit: true, space: group.space.id } }); })
            .child(`${group.binding.folders.length} 目录`)))
          .child(div().id(`drag-space-${group.id}`).size(14).flex_none().flex().items_center().justify_center().text_size(16).text_color(t.muted)
            .opacity(this.hoveredSpace === group.id || this.focusedDrag === group.id || this.pressedSpace === group.id ? 1 : 0)
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
            .on_click((_event, cx) => cx.stop_propagation()).child("⋮⋮"))
          .child(btn(`folder-tab-${group.id}`, "plus", () => openOverlay({ mod: "space-home", kind: "dialog", width: 860, height: 680, props: { space: group.space.id, launcher: true } }))),
        ...(folded[group.id] ? [] : group.entries).flatMap(({ space: sp, tab: tb, members: mine }, entryIndex) => {
          const splitTarget = mine.find(p => p.focused && p.terminal) ?? mine.find(p => p.terminal);
          const trees = [...new Map(mine.filter(p => p.terminal && p.gitTree).map(p => [p.gitTree.path, p.gitTree])).values()];
          const parentPane = mine.length > 1 ? mine.find(p => p.terminal && mine.some(child => raw.get(child.terminal)?.parent === p.terminal) && mine.every(child => child === p || raw.get(child.terminal)?.parent === p.terminal)) : null;
          const rowPane = parentPane ?? (mine.length === 1 ? mine[0] : null);
          const childPanes = parentPane ? mine.filter(p => p !== parentPane) : mine;
          const name = parentPane ? paneTitle(parentPane) : labels[tb.id]?.name ?? tabTitle(tb, all);
          const status = labels[tb.id]?.status ?? [tb.status, ...mine.map(p => states.get(p.pane))].sort((a, b) => (rank[b] ?? 0) - (rank[a] ?? 0))[0];
          const expanded = mine.length > 1 && !folded[tb.id];
          const unreadDone = expanded ? parentPane && states.get(parentPane.pane) === "done" : status === "done";
          const working = (expanded ? (parentPane ? [parentPane] : []) : mine).filter(p => states.get(p.pane) === "working");
          const reported = working.map(p => raw.get(p.terminal)?.status_ms).filter(ms => ms > 0);
          const nativeStart = (expanded ? null : tb.working_since) ?? (reported.length ? Math.min(...reported) : null);
          const since = nativeStart ?? Math.min(...working.map(p => this.workingSince[p.pane]));
          const elapsed = working.length ? `${nativeStart ? "" : "~"}${duration(now - since)}` : "";
          const updated = Math.max(tb.changed_at ?? 0, ...mine.map(p => raw.get(p.terminal)?.status_ms ?? coreState(p.terminal)?.since ?? 0));
          const stale = staleSession(updated, now);
          return [v_flex().relative().w_full().rounded(6).bg(t.chrome + "00").children([
            h_flex().id(`tb-${group.id}-${tb.id}`).relative().items_center().gap(7).pl(32).pr(8).py(4).min_h(32).rounded(6)
              .bg(unreadDone ? t.done + "18" : sp.active && tb.active ? (mine.length <= 1 ? t.selected : folded[tb.id] ? t.accent + "20" : parentPane?.focused ? t.selected : t.chrome + "00") : t.chrome + "00")
              .hover((s) => s.bg(unreadDone ? t.done + "26" : t.hover)).cursor_pointer()
              .when(status === "working" && (mine.length <= 1 || folded[tb.id]), el => el.child(workingSweep(`sweep-tab-${tb.id}`, this.sweepPhase, sweepWidth, spaceColor(group.space, i))))
              .on_hover((hovered, cx) => { this.hoveredTab = hovered ? tb.id : (this.hoveredTab === tb.id ? null : this.hoveredTab); cx.notify(); })
              .tooltip(unreadDone ? `${name} · 已完成，待查看` : name)
              .on_click(() => { run("space.select", { id: sp.id }); run("tab.select", { id: tb.id }); if (parentPane) run("pane.focus", { pane: parentPane.pane }); })
              .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); menu("tab", { id: tb.id, space: sp.id }); })
              .child(div().absolute().left(16).top(0).bottom(entryIndex === group.entries.length - 1 ? 16 : 0).w(1).bg(t.dim))
              .child(div().absolute().left(16).top(15).w(15).h(1).bg(t.dim))
              .when(Boolean(rowPane), el => el.child(sessionIcon(rowPane, expanded ? states.get(rowPane.pane) : status, `tab-${tb.id}`)))
              .when(!rowPane, el => el.child(div().size(18).flex_none().relative()
                .child(svg("mods/workspace-chrome/layers.svg").size(15).text_color(t.muted))
                .when(!expanded && ["working", "done"].includes(status), icon => icon.child(statusDot(status, `tab-${tb.id}`)))))
              .child(v_flex().id(`tab-title-${group.id}-${tb.id}`).flex_1().min_w(0).gap(2)
                .when(mine.length > 1 && !parentPane, element => element
                  .tooltip(folded[tb.id] ? "点击标题展开分屏会话" : "点击标题折叠分屏会话")
                  .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
                  .on_click((_event, cx) => { cx.stop_propagation(); toggleFold(tb.id); }))
                .child(div().id(`tab-label-${group.id}-${tb.id}`).truncate().text_size(12).text_color(stale ? t.dim : sp.active && tb.active ? t.foreground : t.muted)
                  .when(mine.length > 1 && !parentPane, element => element.on_click((_event, cx) => { cx.stop_propagation(); toggleFold(tb.id); }))
                  .child(name)))
              .when(Boolean(rowPane?.workspaceFolder) && rowPane.workspaceFolder !== rowPane.gitTree?.path, el => el.child(folderBadge(rowPane.workspaceFolder, stale)))
              .when(trees.length === 1 && Boolean(trees[0].branch) && mine.every(p => p.terminal && p.gitTree?.path === trees[0].path) && (mine.length === 1 || folded[tb.id]), el => el.child(h_flex().max_w(100).items_center().gap(3).text_size(10).text_color(stale ? t.dim : t.muted).tooltip(trees[0].path)
                .child(svg("mods/workspace-chrome/git-branch.svg").size(11).flex_none()).child(div().truncate().child(trees[0].branch))))
              .when(mine.length > 1, el => el.child(div().px(5).py(2).rounded(4).bg(t.raised).text_size(10).text_color(stale ? t.dim : t.muted).tooltip(`${mine.length} 个分屏`).child(String(mine.length))))
              .when(mine.length > 1, el => el.child(div().id(`tab-fold-${tb.id}`).size(16).flex_none().flex().items_center().justify_center().text_color(t.muted).cursor_pointer()
                .tooltip(folded[tb.id] ? "展开分屏" : "折叠分屏")
                .on_click((_event, cx) => { cx.stop_propagation(); toggleFold(tb.id); })
                .child(svg(`mods/workspace-chrome/chevron-${folded[tb.id] ? "right" : "down"}.svg`).size(12))))
              .when(unreadDone, el => el.child(div().flex_none().text_size(10).text_color(t.foreground).child("✓ 待查看")))
              .when((expanded && parentPane ? states.get(parentPane.pane) : status) !== "working", el => el.child(updateTime(updated, now, t)))
              .when(Boolean(elapsed), el => el.child(div().flex_none().text_size(10).text_color(t.working)
                .tooltip(nativeStart ? "本轮 agent 已工作时长" : "缺少原生开始时间，从本次观察到 Working 起计时")
                .child(elapsed)))
              .when(Boolean(splitTarget) && this.hoveredTab === tb.id, el => el.child(splitButton(splitTarget, `${group.id}-${tb.id}`)))
              .when(Boolean(rowPane) && this.hoveredTab === tb.id, el => el.child(btn(`pane-close-${rowPane.pane}`, "x", () => run("pane.close", { pane: rowPane.pane })))),
            ...(mine.length > 1 && !folded[tb.id] ? [v_flex().id(`pane-tree-${group.id}-${tb.id}`).w_full().flex_none().gap(0).children(childPanes.map((p, index) =>
              h_flex().id(`pane-${p.pane}`).relative().w_full().h(28).flex_none().items_center().gap(7).pl(34).pr(8).rounded(6)
                .bg(p.focused ? t.selected : states.get(p.pane) === "done" ? t.done + "18" : t.chrome + "00")
                .hover((s) => s.bg(p.focused ? t.selected : states.get(p.pane) === "done" ? t.done + "26" : t.hover)).cursor_pointer()
                .when(states.get(p.pane) === "working", el => el.child(workingSweep(`sweep-pane-${p.pane}`, this.sweepPhase, sweepWidth, spaceColor(group.space, i))))
                .on_hover((hovered, cx) => { this.hoveredPane = hovered ? p.pane : (this.hoveredPane === p.pane ? null : this.hoveredPane); cx.notify(); })
                .tooltip(states.get(p.pane) === "done" ? `${paneTitle(p)} · 已完成，待查看` : paneTitle(p))
                .on_click(() => {
                  run("space.select", { id: sp.id });
                  run("tab.select", { id: tb.id });
                  run("pane.focus", { pane: p.pane });
                })
                .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); menu("pane", { pane: p.pane, terminal: p.terminal }); })
                .when(entryIndex < group.entries.length - 1, el => el.child(div().absolute().left(16).top(0).bottom(0).w(1).bg(t.dim)))
                .child(div().w(12).h_full().flex_none().relative()
                  .child(div().absolute().left(5).top(0).bottom(index === childPanes.length - 1 ? 14 : 0).w(1).bg(t.dim))
                  .child(div().absolute().left(5).top(14).w(7).h(1).bg(t.dim)))
                .child(sessionIcon(p, states.get(p.pane), p.pane)
                  .tooltip(raw.get(p.terminal)?.parent ? `子 Agent · 父级：${raw.get(raw.get(p.terminal).parent)?.title || raw.get(p.terminal).parent} (${raw.get(p.terminal).parent})` : paneTitle(p)))
                .child(div().flex_1().min_w(0).truncate().text_size(11.5)
                  .text_color(staleSession(raw.get(p.terminal)?.status_ms ?? coreState(p.terminal)?.since, now) ? t.dim : p.focused ? t.foreground : t.muted).child(paneTitle(p)))
                .when(Boolean(p.workspaceFolder) && p.workspaceFolder !== p.gitTree?.path, el => el.child(folderBadge(p.workspaceFolder, staleSession(raw.get(p.terminal)?.status_ms ?? coreState(p.terminal)?.since, now))))
                .when(Boolean(p.gitTree?.branch), el => el.child(h_flex().max_w(100).items_center().gap(3).text_size(10).text_color(staleSession(raw.get(p.terminal)?.status_ms ?? coreState(p.terminal)?.since, now) ? t.dim : t.muted).tooltip(p.gitTree.path)
                  .child(svg("mods/workspace-chrome/git-branch.svg").size(11).flex_none()).child(div().truncate().child(p.gitTree.branch))))
                .when(states.get(p.pane) === "done", el => el.child(div().flex_none().text_size(10).text_color(t.foreground).child("✓ 待查看")))
                .when(states.get(p.pane) !== "working", el => el.child(updateTime(raw.get(p.terminal)?.status_ms ?? coreState(p.terminal)?.since, now, t)))
                .when(states.get(p.pane) === "working", el => {
                  const start = raw.get(p.terminal)?.status_ms ?? coreState(p.terminal)?.since;
                  return el.child(div().flex_none().text_size(10).text_color(t.working)
                    .tooltip(start ? "本轮 agent 已工作时长" : "从本次观察到 Working 起计时")
                    .child(`${start ? "" : "~"}${duration(now - (start ?? this.workingSince[p.pane]))}`));
                })
                .when(this.hoveredPane === p.pane && Boolean(p.terminal), el => el.child(splitButton(p, p.pane)))
                .when(this.hoveredPane === p.pane, el => el.child(btn(`pane-close-${p.pane}`, "x", () => run("pane.close", { pane: p.pane })))))) ] : []),
          ])];
        }),
      ])));
  }
}
