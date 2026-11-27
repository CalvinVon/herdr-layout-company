import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, spaces, panes, terminals, run, hc, theme, settings, props, closeOverlay, shared } from "herdr";

const COLORS = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const pickable = rows => rows.filter(row => row.kind !== "head");

export default class WorkspacePicker extends View {
  init(_props, cx) {
    this.filter = "";
    this.at = 0;
    this.scroll = 0;
    this.machines = [];
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "搜索 hc ID、标签、会话或 Space…" });
    this.input.on("change", (_event, next) => {
      this.filter = this.input.value();
      this.at = 0;
      this.scroll = 0;
      next.notify();
    });
    this.input.on("submit", () => this.go(pickable(this.rows())[this.at]));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    cx.spawn(async next => {
      try {
        const result = await hc(["machine", "ls", "--json"]);
        if (result.code === 0) this.machines = (JSON.parse(result.stdout).machines ?? []).filter(machine => machine.state === "connected" && !machine.temporary).map(machine => machine.name);
      } catch {}
      next.notify();
    });
  }

  rows() {
    const terms = this.filter.toLowerCase().trim().split(/\s+/).filter(Boolean).map(term => term.replace(/^#/, ""));
    const matches = fields => terms.every(term => fields.join(" ").toLowerCase().includes(term));
    const live = terminals().filter(terminal => terminal.state === "live");
    const records = new Map(live.map(terminal => [terminal.address, terminal]));
    const allPanes = panes();
    const paneled = new Set(allPanes.map(pane => pane.terminal));
    const allAgents = agents();
    const tabLabels = shared("workspace.tab-labels") ?? {};
    const output = [];
    for (const space of spaces()) {
      const rows = [];
      const spaceFields = [space.name, space.folder ?? "", space.machine ?? ""];
      if (matches(spaceFields)) rows.push({ kind: "home", w: space });
      for (const tab of space.tabs) {
        const members = allPanes.filter(pane => pane.tab === tab.id);
        const candidates = [];
        const seen = new Set();
        const add = (terminal, pane) => {
          if (!terminal || seen.has(terminal.address)) return;
          seen.add(terminal.address);
          const agent = allAgents.find(agent => agent.address === terminal.address);
          const labels = terminal.labels ?? {};
          const title = agent?.title || pane?.title || terminal.title || terminal.report?.msg || tabLabels[tab.id]?.name || tab.name;
          const program = agent?.program ?? pane?.program ?? terminal.program;
          const fields = [...spaceFields, tab.name, tabLabels[tab.id]?.name ?? "", terminal.address, title,
            terminal.name ?? "", terminal.report?.msg ?? "", program?.name ?? "", ...Object.keys(labels), ...Object.values(labels)];
          if (matches(fields)) candidates.push({
            kind: "ctx", w: space, ctx: tab, terminal: terminal.address, pane: pane?.pane,
            title, role: labels.role ?? "", program: program?.name ?? "", status: agent?.status ?? pane?.status ?? terminal.status,
          });
          for (const child of live.filter(child => child.parent === terminal.address && !paneled.has(child.address))) add(child);
        };
        for (const pane of members) if (pane.terminal) add(records.get(pane.terminal) ?? { address: pane.terminal }, pane);
        if (!members.some(pane => pane.terminal) && !(rows.some(row => row.kind === "home") && /^space\s*(?:首页|home)$/i.test(tab.name))
          && matches([...spaceFields, tab.name, tabLabels[tab.id]?.name ?? "", ...members.map(pane => pane.title)])) {
          candidates.push({ kind: "ctx", w: space, ctx: tab, title: tabLabels[tab.id]?.name || tab.name, status: tab.status });
        }
        rows.push(...candidates);
      }
      if (rows.length) output.push({ kind: "head", w: space }, ...rows);
    }
    if (!terms.length) output.push({ kind: "new" }, { kind: "new-space" }, ...this.machines.map(machine => ({ kind: "new-space", machine })));
    return output;
  }

  close() {
    closeOverlay(props().overlay);
  }

  go(row) {
    if (!row) return;
    this.close();
    if (row.kind === "home") run("space.select", { id: row.w.id });
    else if (row.kind === "new") run("tab.new");
    else if (row.kind === "new-space") run("space.new", { machine: row.machine ?? "" });
    else if (row.pane) run("pane.focus", { pane: row.pane });
    else if (row.terminal) run("agent.focus", { terminal: row.terminal });
    else run("tab.select", { id: row.ctx.id });
  }

  render() {
    const t = theme();
    const rows = this.rows();
    const choices = pickable(rows);
    this.at = Math.max(0, Math.min(this.at, choices.length - 1));
    const selected = choices[this.at];
    const rowHeight = row => row.kind === "head" ? 28 : row.kind === "home" ? 24 : 28;
    const tops = [];
    let total = 0;
    for (const row of rows) { tops.push(total); total += rowHeight(row); }
    const height = Math.min(360, this.listHeight ?? 360);
    const maxScroll = Math.max(0, total - height);
    this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
    const selectedIndex = rows.indexOf(selected);
    if (selectedIndex >= 0) {
      if (tops[selectedIndex] < this.scroll) this.scroll = tops[selectedIndex];
      if (tops[selectedIndex] + rowHeight(selected) > this.scroll + height) this.scroll = tops[selectedIndex] + rowHeight(selected) - height;
    }
    const colors = shared("space.colors") ?? {};
    const showRoles = choices.some(row => row.role);
    const showPrograms = choices.some(row => row.program);
    const keycap = text => div().flex_none().h(18).min_w(18).px(4).rounded(4).border_1().border_color(t.border)
      .bg(t.background).flex().items_center().justify_center().text_size(10).text_color(t.muted).child(text);
    const rowView = row => {
      if (row.kind === "head") {
        const color = colors[row.w.id];
        const count = choices.filter(choice => choice.kind === "ctx" && choice.w.id === row.w.id).length;
        return h_flex().h(28).px(9).gap(7).items_center().rounded(4).bg(t.chrome).text_size(11).text_color(t.foreground)
          .child(div().size(16).flex_none().rounded(4).bg(COLORS[color] ?? color ?? t.accent).flex().items_center().justify_center()
            .text_size(9).font_semibold().text_color("#ffffff").child([...row.w.name][0] ?? "?"))
          .child(div().min_w(0).truncate().font_semibold().child(row.w.name))
          .when(count > 0, el => el.child(div().flex_none().text_size(10).text_color(t.dim).child(`· ${count}`)));
      }
      const title = row.kind === "home" ? "Space 首页" : row.kind === "new" ? "新建会话" : row.kind === "new-space" ? `新建 Space${row.machine ? ` · ${row.machine}` : ""}` : row.title;
      const active = row === selected;
      const nested = row.kind === "ctx" || row.kind === "home";
      return h_flex().id(`search-${row.terminal ?? row.ctx?.id ?? `${row.kind}-${row.w?.id ?? row.machine ?? ""}`}`).h(rowHeight(row)).pl(nested ? 28 : 9).pr(9).gap(7).items_center().rounded(4).relative()
        .cursor_pointer().when(active, el => el.bg(t.selected)).when(!active, el => el.hover(style => style.bg(t.hover)))
        .on_click(() => this.go(row))
        .accessibility_label([row.terminal, title, row.role, row.program].filter(Boolean).join(" · "))
        .when(active, el => el.child(div().absolute().left(0).top(7).bottom(7).w(2).rounded(1).bg(t.accent)))
        .when(nested, el => el.child(div().absolute().left(17).top(0).bottom(0).w(1).bg(t.border)))
        .child(div().w(14).flex_none().flex().items_center().justify_center()
          .when(row.kind === "ctx", el => el.child(div().size(6).rounded_full().bg(t[row.status] ?? t.dim)))
          .when(row.kind !== "ctx", el => el.child(svg(`mods/workspace-chrome/${row.kind === "home" ? "folder" : "plus"}.svg`).size(12).text_color(t.muted))))
        .child(div().flex_1().min_w(0).truncate().text_size(row.kind === "home" ? 11 : 12).text_color(row.kind === "home" ? t.muted : t.foreground).child(title))
        .child(div().w(46).flex_none().truncate().text_size(10).text_color(t.accent).tooltip(row.terminal ?? "").child(row.terminal ?? ""))
        .when(showRoles, el => el.child(div().w(76).flex_none()
          .when(Boolean(row.role), slot => slot.child(div().max_w(76).truncate().px(4).py(1).rounded(3).bg(t.raised).text_size(9.5).text_color(t.muted).child(row.role)))))
        .when(showPrograms, el => el.child(div().w(84).flex_none().truncate().text_size(10).text_color(t.dim).child(row.program ?? "")))
        .child(div().w(10).flex_none().text_size(10).text_color(t.muted).child(active ? "↵" : ""));
    };
    return v_flex().id("workspace-picker").track_focus(this.handle).w_full().min_h(0).p(10).gap(6).bg(t.popover).text_size(12)
      .on_key_down((event, cx) => {
        if (event.key === "escape") return this.close();
        if (!choices.length) return;
        if (event.key === "down") this.at = (this.at + 1) % choices.length;
        else if (event.key === "up") this.at = (this.at + choices.length - 1) % choices.length;
        else if (event.key === "d" && event.modifiers.control && selected?.ctx) {
          this.close();
          run("tab.close", { id: selected.ctx.id });
        } else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().px(4).items_center().justify_between()
        .child(div().font_semibold().text_size(12).text_color(t.foreground).child("快速跳转"))
        .child(keycap("Esc")))
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(6).border_1().border_color(t.input).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(13).text_color(t.foreground)))
      .when(!choices.length, el => el.child(v_flex().py(26).gap(6).items_center()
        .child(div().text_size(12).text_color(t.muted).child("没有找到匹配项"))
        .child(div().text_size(11).text_color(t.dim).child("试试 hc ID、标签、会话名称或 Space"))))
      .child(div().id("workspace-search-results").h(Math.min(360, total)).min_h(0).relative().overflow_hidden()
        .on_size_change((size, cx) => {
          const next = size.height / (settings().zoom ?? 1);
          if (next !== this.listHeight) { this.listHeight = next; cx.notify(); }
        })
        .on_scroll_wheel((event, cx) => {
          this.scroll = Math.max(0, Math.min(this.scroll - event.delta.y, maxScroll));
          while (this.at < choices.length - 1 && tops[rows.indexOf(choices[this.at])] < this.scroll) this.at++;
          while (this.at > 0 && tops[rows.indexOf(choices[this.at])] + rowHeight(choices[this.at]) > this.scroll + height) this.at--;
          cx.notify();
        })
        .children(rows.flatMap((row, index) => tops[index] + rowHeight(row) <= this.scroll || tops[index] >= this.scroll + height ? [] : [
          div().absolute().left(0).right(0).top(tops[index] - this.scroll).h(rowHeight(row)).child(rowView(row)),
        ])))
      .child(h_flex().flex_none().border_t(1).border_color(t.border).pt(6).px(4).gap(5).items_center().text_size(10).text_color(t.dim)
        .child(keycap("↑")).child(keycap("↓")).child(div().mr(10).child("选择"))
        .child(keycap("↵")).child(div().child("打开"))
        .child(div().flex_1())
        .child(div().child(this.filter.trim() ? `${choices.length} 个匹配项` : "支持 hc ID · 标签 · Space")));
  }
}
