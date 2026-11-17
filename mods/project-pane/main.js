// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "project-pane" } } } }
// Shows the program's icon, session title and agent name, folder and status;
// buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { panes, terminals, spaces, props, run, openOverlay, closeOverlay, theme, home, shared, setShared, notify } from "herdr";

function icon(p, size, color) {
  if (p?.key === "omp") return svg("mods/magpie-live/omp.svg").size(size).flex_none().text_color(color);
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class Pane extends View {
  init(_props, cx) { this.hovered = false; this.direction = "right"; if (props()?.moveMenu) { this.handle = cx.focus_handle(); this.handle.focus(); } }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (command === "pane.split") openOverlay({ mod: "agent-columns-new-menu", kind: "popup", width: 320, height: 304, props: args });
        else run(command, args);
      })
      .child(svg(`mods/project-pane/${icon}.svg`).size(14));
  }

  moveToTab(pane, terminal, tab, name, destination, direction, cx) {
    const pending = shared("project-tabs.move-terminal");
    if (pending && Date.now() - pending.createdAt < 30000) { notify({ title: "正在移动", body: "请等待上一次移动完成。", level: "warning" }); return; }
    if (pending) notify({ title: "上次移动未完成", body: `请检查 ${pending.terminal} 的标签页或 Agent 列表。`, level: "warning" });
    const space = spaces().find(item => item.active && item.tabs.some(t => t.id === tab));
    if (!space || space.id !== props()?.space || (space.machine ?? null) !== props()?.machine) { notify({ title: "无法移动", body: "原 Space 已变化，请重试。", level: "warning" }); return; }
    const request = { id: `${Date.now()}-${Math.random()}`, createdAt: Date.now(), pane, terminal, tab, space: space.id, machine: space.machine ?? null, name, destination, direction };
    setShared("project-tabs.move-terminal", request);
    run("project-tabs.move-terminal");
    const overlay = props()?.overlay;
    cx.spawn(async cx => {
      await cx.sleep(2000);
      if (shared("project-tabs.move-terminal")?.id === request.id && !shared("project-tabs.move-terminal")?.claimed) {
        setShared("project-tabs.move-terminal", null);
        notify({ title: "无法移动", body: "标签栏未响应；终端没有被移动。请切换到支持的布局后重试。", level: "error" });
      }
      closeOverlay(overlay);
    });
  }

  renderMoveMenu() {
    const target = props(), t = theme();
    const space = spaces().find(item => item.active && item.id === target.space && (item.machine ?? null) === target.machine);
    const all = panes(), live = new Set(terminals().filter(item => item.state === "live").map(item => item.address));
    const choices = (space?.tabs ?? []).filter(tab => tab.id !== target.tab && all.some(p => p.tab === tab.id && p.terminal && live.has(p.terminal)));
    const labels = shared("workspace.tab-labels") ?? {};
    const row = (id, label, action) => div().id(id).h(32).flex_none().px(10).rounded(6).flex().items_center().cursor_pointer()
      .hover(el => el.bg(t.selected)).tooltip(label).on_click(action).child(div().min_w(0).truncate().child(label));
    const move = (destination, cx) => this.moveToTab(target.pane, target.terminal, target.tab, target.name, destination, this.direction, cx);
    return v_flex().id("move-menu").track_focus(this.handle).size_full().p(8).gap(4).bg(t.popover).text_color(t.foreground).text_size(12.5)
      .child(h_flex().gap(5).children([["right", "左右分屏"], ["down", "上下分屏"]].map(([direction, label]) => div().id(`move-${direction}`).flex_1().h(28).rounded(5).flex().items_center().justify_center().cursor_pointer()
        .bg(this.direction === direction ? t.selected : t.popover).text_color(this.direction === direction ? t.accent : t.muted).child(label).on_click((_e, cx) => { this.direction = direction; cx.notify(); }))))
      .child(v_flex().id("move-destinations").h(Math.min(192, (choices.length + 1) * 32)).flex_none().overflow_y_scrollbar()
        .child(row("move-new-tab", "＋  新标签页", (_e, cx) => move(null, cx)))
        .children(choices.map(tab => row(`move-tab-${tab.id}`, (tab.named ? tab.name : labels[tab.id]?.name ?? tab.name) || "未命名标签页", (_e, cx) => move(tab.id, cx)))));
  }


  render(cx) {
    if (props()?.moveMenu) return this.renderMoveMenu();
    const t = theme();
    const p = this.me();
    if (!p || p.mod === "space-home") return div();
    const title = (p.title || "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
    const agentName = p.program?.agent && p.program.name;
    const name = title && agentName && title !== agentName ? `${title} (${agentName})` : title || agentName || p.program?.name || "shell";
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const all = terminals();
    const terminal = all.find(item => item.address === p.terminal);
    const parent = terminal?.parent && all.find(item => item.address === terminal.parent);
    const command = terminal?.foreground?.argv?.[0]?.split(/[\\/]/).pop();
    const isAgent = p.program?.agent || p.status || ["claude", "codex", "pi", "omp"].includes(command);
    const pane = p.pane;
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic) || st === "working" || st === "done", el => el.child(div().size(18).flex_none().relative().when(Boolean(pic), icon => icon.child(pic))
        .when(st === "working" || st === "done", icon => icon.child(div().id(`pane-status-${pane}`).absolute().right(0).top(11).size(6).rounded(3)
          .bg(st === "working" ? t.working : t.done).when(st === "working", dot => dot.loop("top", { from: 9, to: 13, period: 1000 }))))))
      .when(Boolean(terminal && isAgent), el => el.child(div().size(20).flex_none().flex().items_center().justify_center()
        .tooltip(terminal.parent ? `子 Agent · 父级：${parent?.title || terminal.parent} (${terminal.parent})` : `主 Agent · ${terminal.address}`)
        .child(svg(`mods/agent-columns-spaces/agent-chat-${terminal.parent ? "worker" : "lead"}.svg`).size(14).text_color(terminal.parent ? t.muted : t.accent))))
      .child(div().flex_none().truncate().max_w(360).font_medium().text_color(t.foreground).tooltip(name).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .when(Boolean(terminal && isAgent && panes().filter(item => item.tab === p.tab).length > 1), el => el.child(div().id(`ph-tab-${pane}`).p(3).rounded(4).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip("移动 Agent")
          .on_click((_e, cx) => { cx.stop_propagation(); const space = spaces().find(item => item.active && item.tabs.some(tab => tab.id === p.tab)); if (!space) { notify({ title: "无法移动", body: "原 Space 已变化，请重试。", level: "warning" }); return; } const tabName = title || agentName || p.program?.name || "Agent"; openOverlay({ mod: "project-pane", kind: "popup", width: 320, height: 360, props: { moveMenu: true, pane, terminal: terminal.address, tab: p.tab, name: tabName, space: space.id, machine: space.machine ?? null } }); }).child(svg("mods/project-pane/move-tab.svg").size(14))))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
