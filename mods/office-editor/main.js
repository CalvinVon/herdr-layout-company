import { View, div } from "gpui-kit";
import { props, theme } from "herdr";

export default class OfficeEditor extends View {
  render() {
    return div().size_full().p(16).text_size(12).text_color(theme().muted)
      .when(Boolean(props()?.overlay), el => el.on_mouse_down("left", (_event, cx) => cx.stop_propagation()))
      .child(props()?.message || "Opening TTT…");
  }
}
