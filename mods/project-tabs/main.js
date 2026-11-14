import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, terminals, hc, appHome, readTextFile, writeTextFile, run, openOverlay, theme, window, shared, layout, settings } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init() {
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    this.editors = {};
    this.editorPending = {};
    this.editorErrors = {};
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  syncEditor(space, panel, body, cx) {
    const layoutName = shared("layout");
    if (!["office", "agent-columns"].includes(layoutName) || !space || this.pending) return;
    const root = layout(), slot = find(root, "editor");
    if (!slot) return;
    const records = terminals();
    let address = this.editors[space.id];
    const known = records.find(t => t.address === address);
    if (known && known.state !== "live") {
      delete this.editors[space.id];
      this.editorErrors[space.id] = "TTT exited. Close and reopen Editor to start it again.";
      address = null;
    }
    if (!address && !this.editorErrors[space.id]) {
      const existing = records.find(t => t.state === "live" && t.labels?.["office.editor.space"] === space.id);
      if (existing) address = this.editors[space.id] = existing.address;
    }
    const visible = !panel?.hidden && body?.active === "editor";
    const content = address ? { terminal: address } : { mod: "office-editor", props: { message: this.editorErrors[space.id] || "Opening TTT…" } };
    if ((slot.content?.terminal !== content.terminal || slot.content?.mod !== content.mod || slot.content?.props?.message !== content.props?.message) && !this.editorLayoutPending && !this.editorLayoutError) {
      this.editorLayoutPending = true;
      cx.spawn(async cx => {
        let notify = false;
        try {
          const path = `${appHome()}/layouts/${layoutName}.json`;
          const original = await readTextFile(path);
          const current = spaces().find(s => s.active);
          if (shared("layout") !== layoutName || current?.id !== space.id) { notify = true; return; }
          if (original === null) throw new Error(`${layoutName}.json is missing`);
          const tree = JSON.parse(original), editor = find(tree, "editor");
          if (!editor) throw new Error(`Editor slot is missing from ${layoutName}.json`);
          if (JSON.stringify(editor.content) === JSON.stringify(content)) return;
          editor.content = content;
          const updated = JSON.stringify(tree, null, 2) + "\n";
          await writeTextFile(path, updated, original);
          notify = true;
        } catch (error) {
          this.editorLayoutError = String(error.message || error);
          notify = true;
        } finally {
          this.editorLayoutPending = false;
          if (notify) cx.notify();
        }
      });
    }
    if (!visible || address || this.editorPending[space.id] || this.editorErrors[space.id]) return;
    this.editorPending[space.id] = true;
    cx.spawn(async cx => {
      try {
        const args = ["run", "--bg", "--json", "--no-parent", "--outlive-parent", "--label", `office.editor.space=${space.id}`];
        if (space.machine) args.push("--on", space.machine);
        if (space.folder) args.push("--cwd", space.folder);
        args.push("--", space.machine ? "ttt" : "/usr/local/bin/ttt");
        const result = await hc(args);
        if (result.code !== 0) throw new Error(result.stderr || result.stdout || "Unable to start TTT");
        const terminal = JSON.parse(result.stdout).address;
        if (!terminal) throw new Error("TTT did not return a terminal address");
        this.editors[space.id] = terminal;
      } catch (error) {
        this.editorErrors[space.id] = `Unable to open TTT: ${error.message || error}. Close and reopen Editor to retry.`;
      } finally {
        delete this.editorPending[space.id];
        cx.notify();
      }
    });
  }

  render(cx) {
    const t = theme();
    const space = spaces().find(p => p.active);
    const all = panes();
    const shown = (space?.tabs ?? []).filter(tab => {
      const members = all.filter(pane => pane.tab === tab.id);
      return !members.length || members.some(pane => pane.mod !== "space-home");
    });
    const raw = new Map(terminals().map(terminal => [terminal.address, terminal]));
    const labels = shared("workspace.tab-labels") ?? {};
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const mine = all.filter(p => p.tab === c.id);
      const lead = mine.find(p => p.terminal && mine.some(child => raw.get(child.terminal)?.parent === p.terminal));
      const worker = !lead && mine.find(p => raw.get(p.terminal)?.parent);
      const name = labels[c.id]?.name ?? c.name;
      const status = labels[c.id]?.status ?? c.status;
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .tooltip(name)
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "project-menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(lead), el => el.child(svg("mods/agent-columns-spaces/agent-chat-lead.svg").size(15).flex_none().text_color(t.accent)))
        .when(Boolean(worker), el => el.child(svg("mods/agent-columns-spaces/agent-chat-worker.svg").size(15).flex_none().text_color(t.muted)))
        .when(!lead && !worker && mine.length > 1, el => el.child(svg("mods/workspace-chrome/layers.svg").size(13).flex_none().text_color(t.muted)))
        .when(!lead && !worker && mine.length <= 1, el => el.child(div().size(7).rounded_full().flex_none().bg(t[status] ?? t.dim)))
        .child(div().max_w(280).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(mine.length > 1, el => el.child(div().px(5).py(2).rounded(4).bg(t.raised).text_size(10).text_color(t.muted).tooltip(`${mine.length} 个分屏`).child(String(mine.length))))
        .when(status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(mine.length > 1 && (status === "blocked" || status === "done"), el => el.child(div().size(6).rounded(3).bg(t[status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const visiblePanels = shared("workspace.panels") ?? ["files", "changes"];
    const enabled = ["office", "agent-columns"].includes(shared("layout")) ? [...visiblePanels, "editor"] : visiblePanels;
    this.syncPanel(space, panel, body, enabled);
    this.syncEditor(space, panel, body, cx);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).tooltip(id === "editor" && this.editorLayoutError ? this.editorLayoutError : label).on_mouse_down("left", stop)
        .on_click(() => {
          if (id === "editor") this.editorLayoutError = null;
          if (on) run("layout.hide", { id: "panel" });
          else { if (id === "editor" && space) delete this.editorErrors[space.id]; run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label);
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay(space
        ? { mod: "space-home", kind: "dialog", width: 860, height: 680, props: { space: space.id, launcher: true } }
        : { mod: "space-folders", kind: "dialog", width: 560, height: 500 })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(["office", "agent-columns"].includes(shared("layout")), el => el.child(panelButton("editor", this.editorLayoutError ? "Editor !" : "Editor", "mods/files/file.svg")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/project-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/project-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/project-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
