import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, spaces, panes, knownAgents, openOverlay, closeOverlay, props, window, shared, setShared, notify } from "herdr";

export default class NewMenu extends View {
  init(_props, cx) {
    const target = props() ?? {};
    this.pane = target.pane;
    this.direction = target.direction ?? "right";
    const pane = panes().find(p => p.pane === this.pane);
    this.space = this.pane ? spaces().find(s => s.tabs.some(t => t.id === pane?.tab))
      : spaces().find(s => target.space ? s.id === target.space : s.active);
    this.redirect = !this.pane;
    if (this.redirect && target.overlay) {
      if (target.newSpace || !this.space) { closeOverlay(target.overlay); openOverlay({ mod: "space-folders", kind: "dialog", width: 560, height: 500, props: { machine: this.space?.machine } }); }
      else this.launcher();
      return;
    }
    const binding = shared("workspace.project-bindings")?.[this.space?.id];
    const folders = binding?.folders ?? (binding ? [{ ...binding, path: binding.initialFolder ?? binding.root }] : []);
    const options = folders.flatMap(folder => [folder.path, ...(folder.worktrees ?? []).map(tree => tree.path)]);
    const membership = (shared("workspace.office-groups") ?? []).flatMap(group => group.members ?? []).find(member => member.pane === this.pane);
    const previous = [target.folder, pane?.cwd, binding?.terminalFolders?.[pane?.terminal], membership?.worktree?.path].find(path => options.includes(path));
    this.folder = previous ?? folders[0]?.path;
    this.agents = shared("new-menu.agents")?.[this.space?.machine ?? ""] ?? [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async cx => {
      try {
        this.agents = await knownAgents({ on: this.space?.machine });
        setShared("new-menu.agents", { ...shared("new-menu.agents"), [this.space?.machine ?? ""]: this.agents });
      } catch { this.failed = true; }
      cx.notify();
    });
  }
  launcher(agents = false) {
    closeOverlay(props()?.overlay);
    openOverlay({ mod: "space-home", kind: "dialog", width: 860, height: 680,
      props: { launcher: true, space: this.space?.id, pane: this.pane, direction: this.direction, folder: this.folder, agents } });
  }
  create(agent) {
    const status = shared("workspace.project-status");
    if (status?.ready !== true) { notify({ title: "文件夹尚未就绪", body: status?.error || "请稍后重试。", level: "warning" }); return; }
    if (!this.space || !panes().some(p => p.pane === this.pane && p.terminal && this.space.tabs.some(tab => tab.id === p.tab))) {
      notify({ title: "无法创建分屏", body: "目标会话已关闭，请重新选择。", level: "warning" }); return;
    }
    if (!this.folder) { notify({ title: "请选择工作目录", body: "请从完整启动页选择 Space 中的目录。", level: "warning" }); return; }
    const argv = agent && window()?.platform === "macos" && !this.space.machine
      ? ["/bin/zsh", "-lic", '"$@"; exec /bin/zsh -l', "herdr-agent", ...agent.run] : agent?.run;
    setShared("workspace.project-requests", [...(shared("workspace.project-requests") ?? []), {
      action: "split", space: this.space.id, pane: this.pane, direction: this.direction, folder: this.folder, argv, name: agent?.name, agentKey: agent?.key
    }]);
    closeOverlay(props()?.overlay);
  }
  row(id, icon, name, action, hint = "") {
    const t = theme();
    return h_flex().id(id).h(32).px(10).gap(10).rounded(6).items_center().flex_none().cursor_pointer()
      .hover(el => el.bg(t.selected)).on_click(action).child(svg(icon).size(15).text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().child(name)).child(div().flex_none().text_size(10).text_color(t.dim).child(hint));
  }
  render() {
    if (this.redirect) return div();
    const t = theme();
    const recentKey = shared("workspace.recent-agents")?.[this.space?.machine ?? ""];
    const recent = this.agents.find(agent => agent.installed && agent.key === recentKey);
    const section = text => div().px(10).pt(7).pb(3).text_size(10.5).text_color(t.dim).child(text);
    return v_flex().id("new-menu").track_focus(this.handle).w_full().p(8).gap(1).bg(t.popover).text_color(t.foreground).text_size(12.5)
      .on_key_down(e => { if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return; if (e.key === "1" && recent) this.create(recent); })
      .when(Boolean(props()?.chooseDirection), el => el.child(h_flex().h(30).flex_none().gap(5).items_center()
        .children([["right", "左右分屏"], ["down", "上下分屏"]].map(([direction, label]) => div().id(`direction-${direction}`).flex_1().h(28).rounded(5)
          .flex().items_center().justify_center().text_size(12).text_color(this.direction === direction ? t.accent : t.muted)
          .bg(this.direction === direction ? t.selected : t.popover).cursor_pointer().child(label)
          .on_click((_e, cx) => { this.direction = direction; cx.notify(); })))))
      .child(h_flex().px(10).pt(6).pb(5).gap(8).items_center()
        .child(div().flex_1().text_size(11).font_semibold().child(this.direction === "down" ? "上下分屏" : "左右分屏")))
      .child(v_flex().id("split-directory").px(10).py(8).gap(4).rounded(6).bg(t.raised).tooltip(this.folder ?? "请选择目录")
        .child(div().text_size(11.5).font_medium().truncate().child(this.folder?.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "请选择工作目录"))
        .child(div().text_size(10.5).text_color(t.muted).truncate().child(this.folder ?? "完整启动页中选择")))
      .child(section("快速启动"))
      .child(this.row("terminal", "icons/shell.svg", "Terminal", () => this.create()))
      .when(Boolean(recent), el => el.child(this.row("recent-agent", "mods/space-home/agent.svg", recent?.name, () => this.create(recent), "最近 · 1")))
      .child(div().h(1).mx(8).mt(6).bg(t.border))
      .child(section("更多选择"))
      .child(this.row("other-agents", "mods/space-home/agent.svg", "选择其他 Agent…", () => this.launcher(true)))
      .child(this.row("launcher", "mods/space-home/grid.svg", "完整启动页…", () => this.launcher(), "目录 / 工具"));
  }
}
