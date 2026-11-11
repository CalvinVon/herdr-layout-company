import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { closeOverlay, props, run, setShared, shared, theme } from "herdr";

const statusColors = { working: "#3d8be0", blocked: "#e05252", done: "#58b368", idle: "#89909c" };
const fallback = { wall: "#e5cda7", floor: "#b7885e", trim: "#795438", accent: "#557d70", text: "#30251e", banner: "#f7e9c9", deskTop: "#a97043", deskEdge: "#70462d" };

function rect(x, y, w, h, color) {
  return div().absolute().left(x).top(y).w(w).h(h).bg(color);
}


function visit(project) {
  setShared("agent-office.requested-project", { id: project.id, token: Date.now() });
  if (props().overlay) closeOverlay(props().overlay);
  const target = project.target;
  if (target?.space) run("space.select", { id: target.space });
  if (target?.tab) run("tab.select", { id: target.tab });
  if (target?.pane) run("pane.focus", { pane: target.pane });
}


export function officeMiniMap(projects, H) {
  const t = theme();
  const rowH = Math.max(44, Math.min(62, Math.floor((H - 62) / Math.max(1, projects.length))));
  return div().id("office-mini-map").size_full().min_h(0).flex().flex_col().p(8).bg(t.chrome).text_color(t.foreground)
    .child(h_flex().h(24).flex_none().items_center().justify_between().text_size(11)
      .child("办公室总览").child(div().text_color(t.muted).child(`${projects.length} 间`)))
    .child(div().flex_1().min_h(0).overflow_y_scrollbar()
      .child(div().h(8).mx(8).bg("#51483f"))
      .children(projects.map((project, index) => {
        const p = project.theme ?? fallback;
        const agents = project.agents ?? [];
        return h_flex().id(`office-mini-room-${index}`).h(rowH).w_full().border_2().border_color(project.active ? "#f7db83" : "#51483f").cursor_pointer()
          .tooltip(`${project.machine ? project.machine + ":" : ""}${project.folder ?? project.name}\n${agents.length} agents${project.duplicateOf ? " · 重复容器，保留原会话" : ""} · 点击进入`)
          .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
          .on_hover(hovered => { if (hovered) setShared("agent-office.hovered-project", project.id); else if (shared("agent-office.hovered-project") === project.id) setShared("agent-office.hovered-project", null); })
          .on_click(() => visit(project))
          .child(div().flex_1().h_full().relative().overflow_hidden().bg(p.wall)
            .child(rect(0, rowH - 13, 240, 13, p.floor))
            .child(rect(0, 0, 3, rowH, project.active ? "#f7db83" : p.trim))
            .child(h_flex().absolute().left(7).right(4).top(3).h(17).px(4).gap(3).items_center().bg(project.active ? "#f7db83" : p.banner).text_color(project.active ? "#30251e" : p.text).text_size(10)
              .child(div().flex_1().min_w(0).truncate().child(project.name + (project.machine ? " · " + project.machine : "")))
              .when(project.active, el => el.child(div().flex_none().px(3).rounded(2).bg("#51483f").text_color("#fff1b8").text_size(8).child("当前"))))
            .children(agents.slice(0, 5).flatMap((agent, i) => {
              const x = 10 + i * 29;
              const color = statusColors[agent.status] ?? statusColors.idle;
              return [rect(x, rowH - 14, 23, 3, p.deskTop), rect(x + 2, rowH - 11, 2, 8, p.deskEdge), rect(x + 19, rowH - 11, 2, 8, p.deskEdge),
                rect(x + 8, rowH - 26, 13, 10, "#34343c"), rect(x + 10, rowH - 24, 9, 6, color), rect(x + 13, rowH - 16, 3, 2, p.trim)];
            }))
            .when(agents.length === 0, el => el.child(div().absolute().left(10).bottom(8).text_size(10).text_color(p.trim).child("空闲办公室")))
            .when(agents.length > 5, el => el.child(div().absolute().right(4).bottom(8).text_size(10).text_color(p.text).bg(p.banner).child(`+${agents.length - 5}`)))
            .child(rect(0, rowH - 3, 240, 3, p.trim)))
          .child(div().w(22).h_full().flex_none().relative().bg(project.active ? "#8d744a" : "#716459")
            .children([rect(3, 5, 16, rowH - 11, project.active ? "#f7db83" : "#51483f"), rect(5, 7, 12, rowH - 15, project.active ? "#d9bf86" : "#a99b83"), rect(10, 7, 2, rowH - 15, "#716459"), rect(0, rowH - 3, 22, 3, p.trim)]));
      }))
      .child(div().h(5).bg("#51483f")));
}

export default class OfficeBuilding extends View {
  init() {
    this.height = 250;
  }

  render() {
    const value = shared("agent-office.projects");
    return officeMiniMap(Array.isArray(value) ? value : [], this.height)
      .on_size_change((size, cx) => { if (size.height !== this.height) { this.height = size.height; cx.notify(); } });
  }
}
