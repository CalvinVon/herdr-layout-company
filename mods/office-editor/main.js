import { View, div } from "gpui-kit";
import { props, theme } from "herdr";

export default class OfficeEditor extends View {
  render() {
    return div().size_full().p(16).text_size(12).text_color(theme().muted)
      .child(props()?.message || "Opening TTT…");
  }
}
