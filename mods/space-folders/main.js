import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { props, spaces, shared, setShared, closeOverlay, theme, pickFolder, exec, window } from "herdr";

const nameOf = path => path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || path;
const pickerScript = `const app = Application.currentApplication();
app.includeStandardAdditions = true;
try { JSON.stringify(app.chooseFolder({withPrompt: "选择 Space 的文件夹（可多选）", multipleSelectionsAllowed: true}).map(path => path.toString())); }
catch (error) { if (error.errorNumber === -128 || String(error).includes("-128")) JSON.stringify([]); else throw error; }`;

export default class SpaceFolders extends View {
  init(_props, cx) {
    const target = props() ?? {};
    this.space = target.edit ? spaces().find(space => space.id === target.space) : null;
    this.machine = this.space?.machine ?? target.draft?.machine ?? target.machine ?? null;
    const binding = shared("workspace.project-bindings")?.[this.space?.id];
    this.folders = this.space ? (binding?.folders?.map(folder => folder.path) ?? [binding?.initialFolder ?? binding?.root ?? this.space.folder]).filter(Boolean) : [...(target.draft?.folders ?? [])];
    this.name = InputState.new({ placeholder: "例如：产品迭代、前后端联调" });
    this.name.set_value(target.draft?.name ?? "");
    this.path = InputState.new({ placeholder: this.machine ? "远程机器上的绝对路径" : "输入文件夹的绝对路径" });
    this.path.on("submit", (_event, cx) => this.addPath(cx));
    this.error = "";
    this.busy = false;
    this.handle = cx.focus_handle();
    if (this.space) this.handle.focus(); else this.name.focus();
  }

  add(paths, cx) {
    this.folders = [...new Set([...this.folders, ...paths.map(path => path.trim()).filter(Boolean)])];
    this.error = "";
    cx.notify();
  }

  addPath(cx) {
    if (this.busy || this.pending) return;
    this.add([this.path.value()], cx);
    this.path.set_value("");
  }

  pick(cx) {
    if (this.busy || this.pending) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async cx => {
      try {
        if (window()?.platform === "macos") {
          const result = await exec("osascript", ["-l", "JavaScript", "-e", pickerScript]);
          if (result.code !== 0) throw new Error(result.stderr || "无法打开文件夹选择器");
          const paths = JSON.parse(result.stdout.trim() || "[]");
          if (!Array.isArray(paths) || paths.some(path => typeof path !== "string")) throw new Error("文件夹选择结果无效");
          this.add(paths, cx);
        } else {
          const path = await pickFolder({ prompt: "添加到 Space" });
          if (path) this.add([path], cx);
        }
      } catch (error) { this.error = String(error); }
      this.busy = false;
      cx.notify();
    });
  }

  save(cx) {
    if (this.busy || this.pending) return;
    if (this.path.value().trim()) this.addPath(cx);
    if (!this.folders.length) { this.error = "请至少添加一个文件夹。"; cx.notify(); return; }
    if (this.space && !spaces().some(space => space.id === this.space.id)) { this.error = "这个 Space 已关闭。"; cx.notify(); return; }
    if (shared("workspace.project-status")?.ready !== true) { this.error = "文件夹服务尚未就绪，请稍后重试。"; cx.notify(); return; }
    this.pending = `space-folders-${Date.now()}-${Math.random()}`;
    const request = { id: this.pending, action: this.space ? "update-folders" : "create-space", space: this.space?.id,
      name: this.name.value().trim(), homeOnly: !this.space, machine: this.machine, folders: [...this.folders] };
    setShared("workspace.project-requests", [...(shared("workspace.project-requests") ?? []), request]);
    cx.notify();
  }

  render() {
    const t = theme(), p = props();
    const result = shared("workspace.project-result");
    if (this.pending && result?.id === this.pending) {
      this.pending = null;
      if (result.ok) { closeOverlay(p.overlay); return div(); }
      this.error = result.error;
    }
    const locked = this.busy || Boolean(this.pending);
    const button = (id, text, primary, action, enabled = true) => div().id(id).h(32).px(12).flex_none().flex().items_center().justify_center().rounded(7)
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5)
      .opacity(enabled ? 1 : 0.45).when(enabled, el => el.cursor_pointer().hover(s => s.opacity(0.85)))
      .on_click((_event, cx) => { if (enabled) action(cx); }).child(text);
    const input = state => Input.new(state).h(34).px(9).rounded(7).border_1().border_color(t.input).bg(t.background).text_color(t.foreground).text_size(12.5);
    return v_flex().id("space-folders").track_focus(this.handle).w_full().h(500).p(20).gap(12).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().gap(10)
        .child(div().flex_1().text_size(17).font_semibold().child(this.space ? "管理 Space 文件夹" : "添加 Space"))
        .child(div().text_size(11).text_color(t.dim).child("Esc 取消")))
      .child(div().text_size(12).text_color(t.muted).child(this.space ? `${this.space.name} · 移除文件夹不会影响已运行的 Agent` : "将相关文件夹放进一个 Space，创建 Agent 时再选择工作目录。"))
      .when(!this.space, el => el.child(v_flex().gap(5)
        .child(div().text_size(11).text_color(t.muted).child("Space 名称（选填）"))
        .child(input(this.name))))
      .child(h_flex().items_center().gap(8)
        .child(div().flex_1().text_size(12).font_medium().child(`文件夹 · ${this.folders.length}`))
        .when(Boolean(this.machine), el => el.child(div().text_size(11).text_color(t.dim).child(this.machine)))
        .when(!this.machine, el => el.child(button("pick-folders", this.busy ? "正在选择…" : "+ 选择文件夹…", false, cx => this.pick(cx), !locked))))
      .child(v_flex().id("space-folder-list").flex_1().min_h(0).gap(5).overflow_y_scrollbar()
        .when(this.folders.length === 0, el => el.child(div().py(24).px(12).text_size(12).text_color(t.dim).child("尚未添加文件夹，可一次选择多个。")))
        .children(this.folders.map((folder, index) => h_flex().id(`space-folder-${index}`).flex_none().min_h(48).px(10).py(7).gap(9).items_center().rounded(8).bg(t.raised)
          .child(svg("mods/files/folder.svg").size(17).flex_none().text_color(t.muted))
          .child(v_flex().flex_1().min_w(0).gap(3).tooltip(folder)
            .child(div().truncate().text_size(12.5).font_medium().child(nameOf(folder)))
            .child(div().truncate().text_size(10.5).text_color(t.muted).child(folder)))
          .when(index === 0, el => el.child(div().text_size(10).text_color(t.dim).child("默认")))
          .child(button(`remove-folder-${index}`, "移除", false, cx => { this.folders.splice(index, 1); this.error = ""; cx.notify(); }, !locked)))))
      .child(h_flex().gap(7).items_center()
        .child(input(this.path).flex_1().min_w(0))
        .child(button("add-folder-path", "添加", false, cx => this.addPath(cx), !locked)))
      .when(Boolean(this.error), el => el.child(div().text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(11).text_color(t.dim).child(this.pending ? "正在验证并保存文件夹…" : "Agent 使用已有目录；需要隔离时可选 worktree。"))
        .child(button("cancel-folders", "取消", false, () => closeOverlay(p.overlay), !this.pending))
        .child(button("save-folders", this.space ? "保存" : "创建 Space", true, cx => this.save(cx), !locked)));
  }
}
