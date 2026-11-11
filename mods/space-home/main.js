import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, spaces, panes, shared, setShared, theme, openOverlay, closeOverlay, knownAgents, window, notify } from "herdr";

/** @type {{ id: string, name: string, detail: string, hint: string, icon: string, command?: string }[]} */
const TOOLS = [
  { id: "terminal", name: "Terminal", detail: "打开终端", hint: "shell", icon: "icons/shell.svg" },
  { id: "agent", name: "Agent", detail: "选择 Agent", hint: "选择助理", icon: "mods/space-home/agent.svg" },
  { id: "ttt", name: "TTT", detail: "在终端运行", hint: "ttt", icon: "mods/space-home/grid.svg", command: "ttt" },
  { id: "lazygit", name: "lazygit", detail: "在终端运行", hint: "lazygit", icon: "mods/workspace-chrome/branch.svg", command: "lazygit" }
];

export default class SpaceHome extends View {
  init(_props, cx) {
    this.folder = props()?.folder;
    this.showAgents = Boolean(props()?.agents);
    const machine = spaces().find(space => space.id === props()?.space)?.machine;
    this.agents = shared("new-menu.agents")?.[machine ?? ""] ?? [];
    cx.spawn(async cx => {
      try {
        this.agents = await knownAgents({ on: machine });
        setShared("new-menu.agents", { ...shared("new-menu.agents"), [machine ?? ""]: this.agents });
      } catch { this.agentError = true; }
      cx.notify();
    });
  }
  launch(tool, folder, cx) {
    if (this.pending) return;
    const target = props() ?? {};
    const space = spaces().find(space => space.id === target.space);
    if (!space) { notify({ title: "无法创建会话", body: "目标 Space 已关闭，请重新选择。", level: "warning" }); return; }
    if (!folder) { notify({ title: "请选择工作目录", body: "请先为 Space 添加文件夹。", level: "warning" }); return; }
    if (tool.id === "agent" && !tool.run) { this.showAgents = !this.showAgents; cx.notify(); return; }
    if (target.pane && !panes().some(pane => pane.pane === target.pane && pane.terminal && space.tabs.some(tab => tab.id === pane.tab))) {
      notify({ title: "无法创建分屏", body: "目标会话已关闭，请重新选择。", level: "warning" }); return;
    }
    const status = shared("workspace.project-status");
    if (status?.ready !== true) { notify({ title: "文件夹尚未就绪", body: status?.error || "请稍后重试。", level: "warning" }); return; }
    const command = tool.run ?? (tool.command ? [tool.command] : undefined);
    const argv = command ? window()?.platform === "macos" && !space.machine
      ? ["/bin/zsh", "-lic", '"$@"; exec /bin/zsh -l', "herdr-agent", ...command] : command : undefined;
    this.pending = `space-launch-${Date.now()}-${Math.random()}`;
    this.error = "";
    setShared("workspace.project-requests", [...(shared("workspace.project-requests") ?? []), {
      id: this.pending, action: target.pane ? "split" : "new-tab", space: space.id, pane: target.pane, direction: target.direction,
      folder, argv, name: command ? tool.name : undefined, agentKey: tool.agentKey
    }]);
    cx.notify();
  }
  render() {
    const t = theme(), target = props() ?? {};
    const result = shared("workspace.project-result");
    if (this.pending && result?.id === this.pending) {
      this.pending = null;
      if (result.ok && target.overlay) { closeOverlay(target.overlay); return div(); }
      if (!result.ok) this.error = result.error;
    }
    const space = spaces().find(space => space.id === target.space);
    const binding = shared("workspace.project-bindings")?.[space?.id];
    const directories = binding?.folders ?? (binding ? [{ ...binding, path: binding.initialFolder ?? binding.root }] : []);
    const folders = [...new Map(directories.flatMap(item => [item, ...(item.worktrees ?? []).filter(tree => tree.path !== item.path).map(tree => ({ ...tree, worktree: true }))]).map(item => [item.path, item])).values()];
    const folder = folders.find(item => item.path === this.folder)?.path ?? folders[0]?.path;
    const installed = (this.agents ?? []).filter(agent => agent.installed);
    const recentKey = shared("workspace.recent-agents")?.[space?.machine ?? ""];
    const recent = installed.find(agent => agent.key === recentKey);
    const tools = TOOLS.map(tool => tool.id === "agent" && recent ? { ...tool, name: recent.name, detail: "最近使用的 Agent", hint: "直接启动", run: recent.run, agentKey: recent.key } : tool);
    const sessions = panes().filter(pane => pane.terminal && space?.tabs.some(tab => tab.id === pane.tab));
    const padding = (this.width ?? 900) < 600 ? 20 : 28;
    const contentWidth = Math.max(0, Math.min((this.width ?? 900) - padding * 2, 780));
    const columns = contentWidth >= 640 ? 4 : contentWidth >= 320 ? 2 : 1;
    const cardWidth = (contentWidth - (columns - 1) * 12) / columns;
    const colors = [t.ansi4, t.ansi5, t.ansi3, t.ansi2];
    const manage = () => openOverlay({ mod: "space-folders", kind: "dialog", width: 560, height: 500, props: { edit: true, space: space?.id } });
    return v_flex().id("space-home").size_full().min_w(0).min_h(0).overflow_y_scrollbar()
      .p(padding).gap(28).items_center().bg(t.background).text_color(t.foreground)
      .on_size_change((size, cx) => { if (this.width !== size.width) { this.width = size.width; cx.notify(); } })
      .child(h_flex().w_full().max_w(900).flex_none().items_center().gap(12)
        .child(div().size(38).rounded(10).bg(t.selected).flex().items_center().justify_center()
          .child(svg("mods/files/folder.svg").size(20).text_color(t.accent)))
        .child(v_flex().flex_1().min_w(0).gap(4)
          .child(div().truncate().text_size(20).font_semibold().child(target.launcher ? target.pane ? "新建分屏" : "新建会话" : space?.name ?? "Space"))
          .child(div().text_size(11).text_color(t.muted).child(target.launcher ? `${space?.name ?? "Space"}${target.pane ? target.direction === "down" ? " · 上下分屏" : " · 左右分屏" : ""}` : `${directories.length} 个文件夹 · ${sessions.length ? `${sessions.length} 个会话` : "暂无会话"}`)))
        .when(!target.launcher, el => el.child(div().id("space-home-folders").px(10).py(8).rounded(6).text_size(12).text_color(t.muted)
          .cursor_pointer().hover(el => el.bg(t.hover).text_color(t.foreground)).on_click(manage).child("管理文件夹")))
        .when(Boolean(target.overlay), el => el.child(div().id("space-launch-close").px(10).py(8).rounded(6).text_size(12).text_color(t.muted)
          .cursor_pointer().hover(el => el.bg(t.hover)).on_click(() => closeOverlay(target.overlay)).child("取消"))))
      .child(v_flex().w_full().max_w(780).min_w(0).flex_none().gap(24)
        .when(!target.launcher, el => el.child(v_flex().gap(9).items_center()
          .child(div().text_size(24).font_semibold().child(sessions.length ? "继续你的工作" : "开始一个新会话"))
          .child(div().text_size(13).text_color(t.muted).child("选择工作目录，再打开需要的工具。"))))
        .child(v_flex().id("space-home-directory-list").max_h(target.launcher ? 230 : 340).overflow_y_scrollbar().gap(10)
          .child(h_flex().items_center().justify_between()
            .child(div().text_size(12).font_semibold().child("工作目录"))
            .child(div().text_size(11).text_color(t.muted).child("点击选择")))
          .children(folders.map((item, index) => {
            const selected = item.path === folder;
            const name = item.worktree ? `worktree · ${item.branch || item.name}` : item.path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || item.path;
            return h_flex().id(`space-home-folder-${index}`).w_full().min_w(0).min_h(66).flex_none().px(16).py(12).gap(13)
              .border(1).border_color(selected ? t.accent : t.border).rounded(8).bg(selected ? t.selected : t.background)
              .items_center().cursor_pointer().tooltip(item.path).hover(el => el.bg(t.hover))
              .on_click((_event, cx) => { this.folder = item.path; cx.notify(); })
              .child(div().size(34).flex_none().rounded(7).bg(selected ? t.background : t.raised).flex().items_center().justify_center()
                .child(svg("mods/files/folder.svg").size(18).text_color(selected ? t.accent : t.muted)))
              .child(v_flex().flex_1().min_w(0).gap(5)
                .child(div().truncate().text_size(13).font_semibold().child(name))
                .child(div().truncate().text_size(11).text_color(t.muted).child(item.path)))
              .child(div().flex_none().text_size(11).text_color(selected ? t.accent : t.dim).child(selected ? "✓ 已选中" : "选择目录"));
          }))
          .when(folders.length === 0, el => el.child(div().py(20).text_size(12).text_color(t.muted).child("还没有工作目录，先通过「管理文件夹」添加。"))))
        .child(h_flex().justify_between().items_center()
          .child(div().text_size(12).font_semibold().child("快速启动"))
          .child(div().id("space-home-agents").text_size(11).text_color(t.accent).cursor_pointer().child(this.showAgents ? "收起 Agent" : "选择其他 Agent…")
            .on_click((_e, cx) => { this.showAgents = !this.showAgents; cx.notify(); })))
        .child(h_flex().w_full().flex_wrap().gap(12).children(tools.map((tool, index) =>
          v_flex().id(`space-home-tool-${tool.id}`).w(cardWidth).min_w(0).h(148).flex_none().p(16).gap(10)
            .border(1).border_color(t.border).rounded(9).bg(t.background).cursor_pointer()
            .opacity(this.pending ? 0.55 : 1).hover(el => el.bg(t.raised).border_color(colors[index])).on_click((_e, cx) => this.launch(tool, folder, cx))
            .child(div().size(32).flex_none().rounded(8).bg(t.raised).flex().items_center().justify_center()
              .child(svg(tool.icon).size(20).text_color(colors[index])))
            .child(v_flex().gap(4)
              .child(div().text_size(13).font_semibold().child(tool.name))
              .child(div().text_size(11).text_color(t.muted).child(tool.detail)))
            .child(h_flex().flex_1().items_end().justify_between().text_size(10).text_color(t.dim)
              .child(div().child(tool.hint)).child(div().text_color(colors[index]).child("↗"))))))
        .when(Boolean(this.showAgents), el => el.child(v_flex().gap(10)
          .child(h_flex().items_center().gap(8)
            .child(div().text_size(12).font_semibold().child("全部 Agent"))
            .child(div().text_size(10.5).text_color(t.dim).child("使用上方所选目录")))
          .child(h_flex().w_full().flex_wrap().gap(10).children([...installed].sort((a, b) => Number(b.key === recentKey) - Number(a.key === recentKey)).map(agent =>
            h_flex().id(`space-home-agent-${agent.key}`).w(contentWidth >= 480 ? (contentWidth - 10) / 2 : contentWidth).h(68).flex_none().px(12).gap(11).items_center()
              .rounded(8).border(1).border_color(agent.key === recentKey ? t.accent : t.border).bg(t.background).opacity(this.pending ? 0.55 : 1)
              .cursor_pointer().tooltip(agent.name).hover(el => el.bg(t.raised).border_color(t.accent)).on_click((_e, cx) => this.launch({ ...agent, agentKey: agent.key }, folder, cx))
              .child(div().size(32).flex_none().rounded(8).bg(t.raised).flex().items_center().justify_center()
                .child(agent.icon ? agent.tint ? svg(agent.icon).size(20).text_color(t.foreground) : image(agent.icon).size(20) : svg("mods/space-home/agent.svg").size(20).text_color(t.ansi5)))
              .child(v_flex().flex_1().min_w(0).gap(5)
                .child(div().truncate().text_size(12.5).font_medium().child(agent.name))
                .child(div().truncate().text_size(10.5).text_color(agent.key === recentKey ? t.accent : t.muted).child(agent.key === recentKey ? "最近使用" : agent.run.join(" "))))
              .child(div().flex_none().text_size(14).text_color(t.accent).child("↗"))))
          )
          .when(installed.length === 0, el => el.child(div().text_size(12).text_color(t.muted).child(this.agentError ? "无法读取 Agent，请关闭后重试。" : "正在检查已安装的 Agent…")))))
        .when(Boolean(this.pending), el => el.child(div().text_size(11).text_color(t.muted).child("正在启动…")))
        .when(Boolean(this.error), el => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
        .when(!target.launcher, el => el.child(div().text_size(11).text_color(t.dim).child("关闭所有会话后，Space 和目录仍会留在这里。"))));
  }
}
