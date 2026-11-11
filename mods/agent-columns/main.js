import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, window, terminals, agents as reportedAgents, spaces, panes, focused, props, run, setAgentOrder, layout, shared, setShared, openOverlay, exec, home, nextCommand } from "herdr";
import { blockCollapsed, toggleBlock } from "./sidebar-collapse.js";

const titleWorking = (title) => /^[◐◓◑◒✳✻✽✶✷✸✹✺]/u.test((title ?? "").trim());
const duration = (ms) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(seconds / 60), s = String(seconds % 60).padStart(2, "0");
  return m < 60 ? `${m}:${s}` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${s}`;
};

const coreState = (address) => {
  const entry = shared("agent-columns.core-status")?.[address];
  return entry && Date.now() - entry.checked < 6500 ? entry : null;
};

// 未发送 OSC 状态的 agent 也要出现在看板；只在标题明确显示忙碌时推断 Working。
function agents(allTerminals = terminals(), allSpaces = spaces()) {
  const list = [...reportedAgents()];
  const seen = new Set(list.map(a => a.address));
  const raw = new Map(allTerminals.map(t => [t.address, t]));
  for (const p of panes()) {
    if (!p.terminal || seen.has(p.terminal)) continue;
    const terminal = raw.get(p.terminal);
    const command = terminal?.foreground?.argv?.[0]?.split(/[\\/]/).pop();
    if (!p.program?.agent && !["claude", "codex", "pi", "omp"].includes(command)) continue;
    const sp = allSpaces.find(s => s.tabs.some(t => t.id === p.tab));
    const tab = sp?.tabs.find(t => t.id === p.tab);
    const status = p.status ?? terminal?.status ?? coreState(p.terminal)?.status;
    list.push({
      address: p.terminal, pane: p.pane, space: sp?.id, space_name: sp?.name ?? "",
      tab: p.tab, tab_index: tab?.index ?? 0, tab_name: tab?.name ?? "",
      status: status === "error" ? "blocked" : status ?? (titleWorking(terminal?.title ?? p.title) ? "working" : "unknown"),
      inferred: !p.status && !terminal?.status, app: p.app, program: p.program, title: p.title,
      seq: terminal?.status_ms ?? terminal?.created_ms ?? 0, focused: p.focused, pinned: false,
    });
    seen.add(p.terminal);
  }
  return list;
}

const C = {
  get ink() { return theme().foreground; }, get muted() { return theme().muted; },
  get line() { return theme().border; }, get bg() { return theme().canvas; },
  get white() { return theme().surface; }, get violet() { return theme().accent; },
};
const STATES = [
  { key: "blocked", label: "Needs you", get color() { return theme().blocked; } },
  { key: "working", label: "Working", get color() { return theme().working; } },
  { key: "done", label: "Done", get color() { return theme().done; } },
  { key: "idle", label: "Idle", get color() { return theme().idle; } },
  { key: "unknown", label: "Unreported", get color() { return theme().dim; } },
  { key: "error", label: "Failed", color: "#ef4444" },
  { key: "archived", label: "Archived", get color() { return theme().dim; } },
].map((s) => Object.defineProperty(s, "wash", { get() { return s.color + "26"; } }));
// Herdr reports a failed agent as "blocked"; hc knows the real "error" state.
// Archived = its tab is settled (tab.settle): put away, still running. Herdr brings it back by itself
// when the agent needs you.
const archived = (a, tabs) => tabs.get(a.tab)?.settled === true;
const showArchived = () => shared("agent-columns.archived") === true;
const eff = (a, tabs, raw) => archived(a, tabs) ? "archived" : (raw.get(a.address)?.status === "error" || raw.get(a.address)?.report?.state === "error" ? "error" : a.status);
const inCol = (a, s, tabs, raw) => { const status = eff(a, tabs, raw); return status === s.key || status === s.also; };
// View modes live in the layout itself: which of the two bands is hidden.
const node = (n, id) => (n?.id === id ? n : (n?.children ?? []).map((c) => node(c, id)).find(Boolean));
const projectFor = (a, terminalsByAddress, groups) => {
  if (!Array.isArray(groups)) return null;
  const ancestry = new Set();
  let address = a.address;
  while (address && !ancestry.has(address)) {
    ancestry.add(address);
    address = terminalsByAddress.get(address)?.parent;
  }
  const group = groups.find(g => g.id === a.space)
    ?? groups.find(g => g.members?.some(m => m.pane === a.pane || ancestry.has(m.terminal)))
    ?? groups.find(g => g.members?.some(m => m.tab === a.tab));
  if (!group) return null;
  const member = group.members?.find(m => ancestry.has(m.terminal))
    ?? group.members?.find(m => m.pane === a.pane)
    ?? group.members?.find(m => m.tab === a.tab);
  return { group, worktree: member?.worktree };
};
const projectLabel = (project) => project ? [project.group.name, project.worktree?.name || project.worktree?.branch].filter(Boolean).join(" · ") : "Project unavailable";
const projectTooltip = (project) => project ? [project.group.name, project.group.folder, project.group.machine || "Local", project.worktree?.path, project.group.duplicateOf ? `Duplicate of ${project.group.duplicateOf}` : null].filter(Boolean).join(" · ") : "Project binding unavailable";
const matches = (a, q, raw, groups) => {
  if (!q) return true;
  const project = projectFor(a, raw, groups);
  return [a.tab_name, a.title, a.address, a.program?.name, projectLabel(project), project?.group.folder, project?.group.machine, project?.worktree?.path, project?.worktree?.branch].some((v) => v?.toLowerCase().includes(q));
};
const dot = (color, size = 7) => div().size(size).rounded(size).bg(color).flex_none();
const icon = (program, size = 18) => program?.icon
  ? (program.tint ? svg(program.icon).text_color(C.ink) : image(program.icon)).size(size).flex_none()
  : div().size(size).rounded(4).bg(C.violet);
const agentTitle = (a) => a.title && (/^\d+$/.test(a.tab_name) || a.tab_name === a.program?.name)
  ? a.title : a.tab_name || a.title || "Agent";

const newRegion = (pane, direction) => openOverlay({
  mod: "agent-columns-new-menu", kind: "popup", width: 250, height: 512,
  props: { pane, direction },
});
const control = (id, text, label, action) => div().id(id).size(26).flex_none().rounded(4)
  .flex().items_center().justify_center().text_size(13).text_color(C.muted).cursor_pointer()
  .tooltip(label).hover(s => s.bg(theme().hover).text_color(C.ink)).child(text)
  .on_click((_e, cx) => { cx.stop_propagation(); action(); });

export default class Board extends View {
  init(_p, cx) {
    if (!props()?.role) cx.spawn(async () => { for (;;) { if (await nextCommand() === "toggle-block") toggleBlock("agents"); } });
    this.observed = {};
    // Every copy makes one (only the header shows it): InputState can't be created while rendering.
    this.search = InputState.new({ placeholder: "Search agents…" });
    this.search.on("change", (_e, cx) => { setShared("agent-columns.filter", this.search.value()); cx.notify(); });
    cx.timer.every(1000, (cx) => {
      if (!props()?.role) {
        const allTerminals = terminals(), allSpaces = spaces();
        const raw = new Map(allTerminals.map(t => [t.address, t]));
        const tabs = new Map(allSpaces.flatMap(s => s.tabs.map(t => [t.id, t])));
        if (agents(allTerminals, allSpaces).some(a => eff(a, tabs, raw) === "working")) cx.notify();
      }
    });
    if (!props()?.role) {
      this.refreshUnreported(cx);
      cx.timer.every(2000, cx => this.refreshUnreported(cx));
    }
  }
  refreshUnreported(cx) {
    if (this.polling) return;
    const recovered = new Set(agents().filter(a => a.inferred).map(a => a.pane));
    const missing = panes().filter(p => p.terminal && recovered.has(p.pane));
    if (!missing.length) return;
    this.polling = true;
    cx.spawn(async cx => {
      const snapshot = {};
      try {
        await Promise.all(missing.map(async p => {
          try {
            const result = await exec(`${home()}/.local/bin/herdr-core`, ["get", p.terminal]);
            if (result.code !== 0) return;
            const terminal = JSON.parse(result.stdout);
            const status = terminal.status ?? (titleWorking(terminal.title) ? "working" : "unknown");
            const previous = coreState(p.terminal);
            snapshot[p.terminal] = {
              status, checked: Date.now(),
              since: status === "working" ? (terminal.status_ms ?? (previous?.status === "working" ? previous.since : Date.now())) : null,
            };
          } catch {}
        }));
        setShared("agent-columns.core-status", snapshot);
      } finally { this.polling = false; }
    });
  }
  card(a, state, list, raw, tabs, groups) {
    const status = eff(a, tabs, raw);
    const old = this.observed[a.address];
    if (!old || old.status !== status) this.observed[a.address] = { status, at: Date.now() };
    const me = raw.get(a.address);
    const parent = me?.parent && list.find((x) => x.address === me.parent);
    const parentTerminal = me?.parent && raw.get(me.parent);
    const parentName = parent?.title || parentTerminal?.title || me?.parent;
    const tab = tabs.get(a.tab);
    const project = projectFor(a, raw, groups);
    const since = tab?.working_since ?? me?.status_ms ?? coreState(a.address)?.since ?? this.observed[a.address].at;
    const approximate = !tab?.working_since && !me?.status_ms;
    const unreadDone = status === "done";
    const active = status === "working" && focused()?.terminal === a.address;
    const elapsed = status === "working"
      ? `${approximate ? "~" : ""}${duration(Date.now() - since)}` : unreadDone ? "已完成 · 待查看" : state.label;
    return h_flex().id(`agent-${a.address}`).w_full().h(60).flex_none().rounded(7).overflow_hidden()
      .bg(active ? theme().selected : unreadDone ? theme().done + "18" : C.white).border(1).border_color(active ? theme().accent : unreadDone ? theme().done : C.line).cursor_pointer().hover(s => s.border_color(active ? theme().accent : state.color))
      .on_click(() => run("agent.focus", { terminal: a.address }))
      .child(div().w(3).h_full().bg(state.color).flex_none())
      .child(v_flex().flex_1().min_w(0).px(10).py(7).gap(4)
        .child(h_flex().items_center().gap(6)
          .child(icon(a.program, 14).tooltip(`${a.program?.name ?? "Agent"} · ${a.address}${me?.parent ? ` · sub-agent of ${parent?.tab_name ?? me.parent}` : ""}`))
          .when(Boolean(me), el => el.child(div().size(20).flex_none().flex().items_center().justify_center()
            .tooltip(me.parent ? `子 Agent · 父级：${parentName} (${me.parent})` : `主 Agent · ${a.address}`)
            .child(svg(`mods/agent-columns-spaces/agent-chat-${me.parent ? "worker" : "lead"}.svg`).size(14).text_color(me.parent ? C.muted : C.violet))))
          .child(div().flex_1().min_w(0).text_size(12).font_semibold().text_color(C.ink).truncate().tooltip(agentTitle(a)).child(agentTitle(a)))
          .when(active, el => el.child(div().flex_none().text_size(10).text_color(C.violet).tooltip("当前激活窗口").child("当前")))
          .child(archived(a, tabs)
            ? div().id(`restore-${a.address}`).flex_none().px(5).rounded(4).text_size(10).text_color(C.muted).cursor_pointer()
                .hover((s) => s.bg(theme().hover).text_color(C.ink)).child("Restore")
                .on_click((_e, cx) => { cx.stop_propagation(); run("tab.unsettle", { id: a.tab }); })
            : div().id(`archive-${a.address}`).flex_none().size(20).flex().items_center().justify_center().rounded(4).text_color(C.muted).cursor_pointer()
                .hover((s) => s.bg(theme().hover).text_color(C.ink)).child(svg("mods/workspace-chrome/archive.svg").size(13))
                .on_click((_e, cx) => { cx.stop_propagation(); run("terminal.park", { terminal: a.address }); run("tab.settle", { id: a.tab }); })))
        .child(h_flex().items_center().justify_between().text_size(10).text_color(C.muted)
          .child(div().min_w(0).truncate().tooltip(me?.parent ? `父 Agent：${parentName} (${me.parent}) · ${projectTooltip(project)}` : projectTooltip(project)).child(me?.parent ? `↳ ${parentName} · ${projectLabel(project)}` : projectLabel(project))).child(div().flex_none()
            .tooltip(status === "working" ? (approximate ? "缺少原生开始时间，从本次观察到 Working 起计时" : "本轮 agent 已工作时长") : (a.inferred ? "未上报原生状态" : state.label))
            .child(elapsed))));
  }
  render() {
    const role = props()?.role;
    const allTerminals = terminals(), allSpaces = spaces();
    const raw = new Map(allTerminals.map(t => [t.address, t]));
    const tabs = new Map(allSpaces.flatMap(s => s.tabs.map(t => [t.id, t])));
    const groups = shared("workspace.office-groups");
    const q = (shared("agent-columns.filter") ?? "").trim().toLowerCase();
    const allAgents = agents(allTerminals, allSpaces);
    const list = allAgents.filter(a => matches(a, q, raw, groups));
    const active = allSpaces.find(s => s.active);
    if (role === "header") return h_flex().size_full().bg(C.white).pr(26).gap(10).items_center()
      .pl(node(layout(), "sidebar")?.hidden && window()?.platform === "macos" ? 84 : 26)
      .child(div().id("sidebar-hide").size(27).flex_none().flex().items_center().justify_center().rounded(6)
        .text_color(C.muted).cursor_pointer().hover(s => s.bg(theme().hover).text_color(C.ink))
        .on_click(() => run("layout.toggle", { id: "sidebar" })).child(svg("mods/workspace-chrome/panel-left.svg").size(15)))
      .child(div().text_size(13).font_semibold().text_color(C.ink).child("Live workspace"))
      .child(div().min_w(0).truncate().text_size(12).text_color(C.muted).child((shared("workspace.office-groups") ?? []).find(g => g.id === active?.id)?.name ?? ""))
      .child(div().flex_1()).child(dot(theme().done, 6))
      .child(div().text_size(10).text_color(C.muted).child("Live updates"))
      .child(h_flex().id("toggle-git-panel").h(27).px(8).gap(5).flex_none().items_center().rounded(6).cursor_pointer()
        .bg(node(layout(), "panel")?.hidden ? theme().chrome : theme().selected).text_color(C.ink).text_size(12)
        .tooltip("显示 / 隐藏 Git 变更面板").hover(s => s.bg(theme().hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => run("layout.toggle", { id: "panel" }))
        .child(svg("mods/changes/changes.svg").size(14)).child("Git"));
    if (role === "pane") {
      const p = panes().find(p => p.pane === props().pane);
      const agent = p && allAgents.find(a => a.pane === p.pane);
      const title = (p?.title || "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
      const agentName = p?.program?.agent && p.program.name;
      const name = title && agentName && title !== agentName ? `${title} (${agentName})` : title || agentName || p?.program?.name || "Terminal";
      const paneStatus = agent ? eff(agent, tabs, raw) : p?.status;
      return h_flex().size_full().px(13).items_center().gap(7).bg(theme().raised).border_b(1).border_color(C.line)
        .child(div().size(18).flex_none().relative().child(icon(p?.program, 14))
          .when(paneStatus === "working" || paneStatus === "done", el => el.child(div().id(`pane-status-${p.pane}`).absolute().right(0).top(11).size(6).rounded(3)
            .bg(paneStatus === "working" ? theme().working : theme().done).when(paneStatus === "working", dot => dot.loop("top", { from: 9, to: 13, period: 1000 })))))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(C.ink)
          .tooltip(name).child(name))
        .when(paneStatus !== "working" && paneStatus !== "done", el => el.child(dot(STATES.find(s => s.key === paneStatus)?.color ?? C.muted, 6)))
        .when(Boolean(p), el => el
          .child(control(`new-${p.pane}`, "+", "新建终端或 agent，可选择分屏方向", () => newRegion(p.pane, "right")))
          .when(panes().filter(other => other.tab === p.tab).length > 1, el => el
            .child(control(`zoom-${p.pane}`, p.zoomed ? "↙" : "↗", p.zoomed ? "还原终端布局" : "放大此终端", () => run("pane.zoom", { pane: p.pane }))))
          .child(control(`close-${p.pane}`, "×", "关闭此终端", () => run("pane.close", { pane: p.pane }))));
    }
    const archive = STATES.find((s) => s.key === "archived");
    const shown = STATES.filter((s) => s === archive ? showArchived() : !["error", "unknown"].includes(s.key) || list.some((a) => inCol(a, s, tabs, raw)));
    const changed = new Map([...tabs].map(([id, tab]) => [id, tab.changed_at ?? 0]));
    /** @param {{tab: string, address: string}} a */
    const latest = a => Math.max(changed.get(a.tab) ?? 0, raw.get(a.address)?.status_ms ?? raw.get(a.address)?.created_ms ?? 0);
    const columns = new Map(shown.map(state => {
      const cards = list.filter(a => inCol(a, state, tabs, raw));
      if (state.key === "idle") cards.sort((a, b) => latest(b) - latest(a));
      return [state.key, cards];
    }));
    setAgentOrder(shown.flatMap(state => columns.get(state.key).map(a => a.address)));
    const archivedCount = list.filter(a => archived(a, tabs)).length;
    // The archive toggle lives in the header of the board's last column.
    const toggle = () => h_flex().id("toggle-archived").h(22).px(7).gap(5).items_center().rounded(5).cursor_pointer()
      .bg(showArchived() ? theme().selected : C.bg).text_size(10).text_color(showArchived() ? C.violet : C.muted)
      .hover((s) => s.bg(theme().hover)).child(svg("mods/workspace-chrome/archive.svg").size(12))
      .child(showArchived() ? "Hide archived" : `Archived (${archivedCount})`)
      .on_click((_e, cx) => { cx.stop_propagation(); setShared("agent-columns.archived", !showArchived()); });
    return v_flex().size_full().min_w(0).bg(theme().chrome).px(10).pb(10).gap(8)
      .child(h_flex().id("agents-header").h(30).flex_none().items_center().gap(6).cursor_pointer()
        .tooltip(blockCollapsed("agents") ? "展开 Agents" : "折叠 Agents").hover(s => s.bg(theme().hover))
        .on_click((_event, cx) => { cx.stop_propagation(); toggleBlock("agents"); })
        .child(div().id("agents-title").flex_1().h_full().flex().items_center().text_size(12).font_semibold().text_color(C.ink).child("Agents")
          .on_click((_event, cx) => { cx.stop_propagation(); toggleBlock("agents"); }))
        .when(!blockCollapsed("agents"), el => el.child(toggle())))
      .when(!blockCollapsed("agents"), el => el.child(h_flex().h(29).flex_none().px(8).gap(6).items_center().rounded(6).bg(C.white).border(1).border_color(C.line)
        .child(svg("mods/workspace-chrome/search.svg").size(12).text_color(C.muted).flex_none())
        .child(Input.new(this.search).flex_1().min_w(0).h_full().text_size(11.5).text_color(C.ink))
        .when(Boolean(shared("agent-columns.filter")), el => el.child(control("clear-search", "×", "清除搜索", () => {
          this.search.set_value(""); setShared("agent-columns.filter", "");
        })))))
      .when(!blockCollapsed("agents"), el => el.child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(12).children(shown.map(state => {
        const cards = columns.get(state.key);
        const folded = /** @type {Record<string, boolean>} */ (shared("agent-columns.sections-folded") ?? {});
        const toggleSection = () => {
          const current = /** @type {Record<string, boolean>} */ (shared("agent-columns.sections-folded") ?? {});
          setShared("agent-columns.sections-folded", { ...current, [state.key]: !current[state.key] });
        };
        return v_flex().w_full().min_w(0).flex_none().gap(6)
          .child(h_flex().id(`section-${state.key}`).h(25).flex_none().items_center().gap(7).px(2).rounded(5).cursor_pointer()
            .tooltip(folded[state.key] ? "点击标题展开分组" : "点击标题折叠分组").hover(style => style.bg(theme().hover))
            .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
            .on_click((_event, cx) => { cx.stop_propagation(); toggleSection(); })
            .child(dot(state.color, 7))
            .child(div().id(`section-title-${state.key}`).flex_1().h_full().flex().items_center().text_size(12).font_semibold().text_color(C.ink).child(state.label)
              .on_click((_event, cx) => { cx.stop_propagation(); toggleSection(); }))
            .child(div().px(6).py(2).rounded(4).bg(state.wash).text_size(10).text_color(state.color).child(String(cards.length))))
          .when(!folded[state.key], el => el.child(v_flex().w_full().min_w(0).gap(6).children(cards.map(a => this.card(a, state, allAgents, raw, tabs, groups)))));
      }))));

  }
}
