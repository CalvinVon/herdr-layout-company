import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, shared, setShared, closeOverlay, theme } from "herdr";

export default class PanelWindow extends View {
  close() {
    if (props()?.overlay && shared("project-tabs.floating-overlay") === props().overlay) {
      setShared("project-tabs.floating-overlay", null);
      setShared("project-tabs.floating-panel", null);
    }
  }

  render() {
    const t = theme(), p = props() ?? {};
    const button = (id, label, action, active = false) => div().id(id).px(8).h(24).flex().items_center().rounded(5)
      .text_size(11).bg(active ? t.selected : t.chrome).text_color(active ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(action).child(label);
    return h_flex().size_full().px(10).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(div().flex_1().text_size(12).text_color(t.muted).child(p.panel === "files" ? "Files" : p.panel === "editor" ? "Editor" : "Changes"))
      .when(p.panel === "changes", el => el
        .child(button("history", "History", () => setShared("project-tabs.floating-panel", { ...shared("project-tabs.floating-panel"), history: true }), p.history))
        .child(button("changes", "Changes", () => setShared("project-tabs.floating-panel", { ...shared("project-tabs.floating-panel"), history: false }), !p.history)))
      .child(button("close", "×", () => { setShared("project-tabs.floating-panel", null); closeOverlay(p.overlay); }));
  }
}
