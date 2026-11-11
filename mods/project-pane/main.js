// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "project-pane" } } } }
// Shows the program's icon, session title and agent name, folder and status;
// buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, terminals, props, run, openOverlay, theme, home } from "herdr";

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class Pane extends View {
  init() { this.hovered = false; }

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

  render(cx) {
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
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
