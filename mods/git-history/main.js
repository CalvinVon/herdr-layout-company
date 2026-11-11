import { View, div, PathBuilder } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, theme, props, layout, run, nextCommand } from "herdr";
import { parseLog, graphRows } from "./graph.js";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const FORMAT = "%H%x00%P%x00%h%x00%an%x00%ad%x00%s%x00%D%x1e";
function location() {
  const space = spaces().find(space => space.active), focus = focused();
  const pane = focus?.pane ? panes().find(pane => pane.pane === focus.pane) : null;
  const on = focus?.pane === null ? (focus.terminal?.includes("/") ? focus.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || focus?.cwd || space?.folder || "", on };
}
const contextKey = () => JSON.stringify(location());
/** @param {any} tree @param {string} id @returns {any} */
const find = (tree, id) => tree?.id === id ? tree : (tree?.children ?? []).map((/** @type {any} */ child) => find(child, id)).find(Boolean);
/** @param {any} t */
const palette = t => [t.ansi4, t.ansi2, t.ansi5, t.ansi3, t.ansi6, t.ansi1];

export default class GitHistory extends View {
  /** @param {any} _props @param {import("gpui-kit").Context} cx */
  init(_props, cx) {
    if (props()?.role === "tabs") return;
    /** @type {import("./graph.js").GraphRow[]} */
    this.commits = [];
    /** @type {string[]} */
    this.detail = [];
    /** @type {Map<string, {path: import("gpui-kit").Path, color: number}[]>} */
    this.geometry = new Map();
    /** @type {string} */
    this.context = ""; this.root = ""; this.branch = ""; this.error = "";
    this.selected = ""; this.detailError = ""; this.detailWidth = 360;
    this.limit = 120; this.request = 0; this.detailRequest = 0;
    this.loading = false; this.detailLoading = false; this.hasMore = false;
    this.refresh(cx);
    cx.timer.every(15000, cx => { if (!this.loading) this.refresh(cx); });
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "refresh") this.refresh(cx);
        else if (command === "next" || command === "previous") {
          const index = this.commits.findIndex(commit => commit.hash === this.selected);
          const next = this.commits[index + (command === "next" ? 1 : -1)];
          if (next) this.pick(next.hash, cx);
        }
      }
    });
  }

  /** @param {import("gpui-kit").Context} cx */
  refresh(cx) {
    const place = location(), context = JSON.stringify(place);
    if (context !== this.context) {
      this.context = context; this.commits = []; this.detail = []; this.selected = "";
      this.root = ""; this.branch = ""; this.limit = 120; this.error = ""; this.detailError = "";
      this.detailRequest++; this.detailLoading = false;
    }
    const request = ++this.request;
    if (!place.cwd) { this.loading = false; return; }
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const top = await exec("git", [...READ, "rev-parse", "--show-toplevel"], place);
        if (top.code !== 0) throw new Error("当前目录不是 Git 仓库");
        const root = top.stdout.trim();
        const [log, branch] = await Promise.all([
          exec("git", [...READ, "log", "--all", "--topo-order", "--date=short", `--max-count=${this.limit}`, `--format=${FORMAT}`], { cwd: root, on: place.on }),
          exec("git", [...READ, "branch", "--show-current"], { cwd: root, on: place.on }),
        ]);
        if (log.code !== 0) throw new Error(log.stderr.trim() || "无法读取提交历史");
        if (request !== this.request || contextKey() !== context) return;
        this.root = root; this.branch = branch.stdout.trim() || "Detached HEAD";
        this.commits = graphRows(parseLog(log.stdout)); this.hasMore = this.commits.length === this.limit;
        this.geometry.clear();
        for (const row of this.commits) {
          const paths = row.edges.map(edge => {
            const x = edge.from * 16 + 12, end = edge.to * 16 + 12;
            const builder = PathBuilder.stroke(2).move_to(x, edge.middle ? 16 : 0).line_to(x, 16);
            builder.cubic_bezier_to(end, 32, x, 24, end, 24);
            return { path: builder.build(), color: edge.color };
          });
          if (row.incoming) paths.push({ path: PathBuilder.stroke(2).move_to(row.slot * 16 + 12, 0).line_to(row.slot * 16 + 12, 16).build(), color: row.color });
          this.geometry.set(row.hash, paths);
        }
        this.error = "";
        if (!this.commits.some(commit => commit.hash === this.selected)) {
          this.selected = ""; this.detail = [];
          const head = this.commits.find(commit => /(^|, )HEAD(?: ->|,|$)/.test(commit.refs)) ?? this.commits[0];
          if (head) this.pick(head.hash, cx);
        }
      } catch (error) {
        if (request === this.request && contextKey() === context) this.error = String(error).replace(/^Error: /, "");
      } finally {
        if (request === this.request) { this.loading = false; cx.notify(); }
      }
    });
  }

  /** @param {string} hash @param {import("gpui-kit").Context} cx */
  pick(hash, cx) {
    if (!this.commits.some(commit => commit.hash === hash)) return;
    this.selected = hash; this.detail = []; this.detailError = ""; this.detailLoading = true;
    const request = ++this.detailRequest, context = this.context, root = this.root, on = location().on;
    cx.spawn(async cx => {
      try {
        const result = await exec("git", [...READ, "show", "--format=fuller", "--date=short", "--stat", "--patch", "--first-parent", "--no-ext-diff", "--no-textconv", "--no-color", hash, "--"], { cwd: root, on });
        if (result.code !== 0) throw new Error(result.stderr.trim() || "无法读取提交详情");
        if (request !== this.detailRequest || contextKey() !== context) return;
        const lines = result.stdout.replace(/\n$/, "").split("\n");
        this.detail = lines.slice(0, 1500).map(line => line.slice(0, 4000));
        if (lines.length > 1500) this.detail.push("… 仅预览前 1,500 行 diff");
        this.detailWidth = Math.max(360, ...this.detail.map(line => line.length * 7 + 24));
      } catch (error) {
        if (request === this.detailRequest && contextKey() === context) this.detailError = String(error);
      } finally {
        if (request === this.detailRequest) { this.detailLoading = false; cx.notify(); }
      }
    });
    cx.notify();
  }

  /** @param {string} id @param {string} label @param {(cx: import("gpui-kit").Context) => void} action @param {boolean} [active] */
  button(id, label, action, active = false) {
    const t = /** @type {any} */ (theme());
    return div().id(id).h(26).px(8).flex_none().flex().items_center().rounded(5).cursor_pointer().text_size(11)
      .bg(active ? t.selected : t.chrome).text_color(active ? t.foreground : t.muted).hover(style => style.bg(t.hover))
      .on_click((_event, cx) => { cx.stop_propagation(); action(cx); }).child(label);
  }

  /** @param {import("./graph.js").GraphRow} row @param {any} t */
  row(row, t) {
    const colors = palette(t);
    return h_flex().w_full().h(32).items_center().gap(8).px(6).bg(this.selected === row.hash ? t.selected : t.surface).text_color(t.foreground).cursor_pointer()
      .child(div().w(row.width).h(32).relative().flex_none()
        .children((this.geometry.get(row.hash) ?? []).map(item => window.paint_path(item.path, colors[item.color % colors.length]).absolute().left(0).top(0).w(row.width).h(32)))
        .child(div().absolute().left(row.slot * 16 + 8).top(12).size(8).rounded(8).bg(colors[row.color % colors.length])))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(h_flex().items_center().gap(5)
          .when(Boolean(row.refs), element => element.child(div().max_w(180).truncate().px(4).rounded(3).bg(t.selected).text_color(t.accent).text_size(10).child(row.refs)))
          .child(div().flex_1().min_w(0).truncate().text_size(12).child(row.subject)))
        .child(div().truncate().text_size(10).text_color(t.muted).child(`${row.short} · ${row.author} · ${row.date}`)));
  }

  /** @param {import("gpui-kit").Context} cx */
  render(cx) {
    const t = /** @type {any} */ (theme());
    if (props()?.role === "tabs") {
      const active = find(layout(), "git-body")?.active;
      return h_flex().size_full().px(8).items_center().gap(4).bg(t.chrome).border_b(1).border_color(t.border)
        .child(div().text_size(12).font_semibold().px(5).text_color(t.foreground).child("Git"))
        .child(this.button("git-tab-history", "History", () => run("layout.select", { stack: "git-body", child: "git-history" }), active === "git-history"))
        .child(this.button("git-tab-changes", "Changes", () => run("layout.select", { stack: "git-body", child: "git-changes" }), active === "git-changes"))
        .child(div().flex_1())
        .child(this.button("git-close", "×", () => run("layout.hide", { id: "panel" })));
    }
    if (contextKey() !== this.context) this.refresh(cx);
    const selected = this.commits.find(commit => commit.hash === this.selected);
    return v_flex().size_full().min_h(0).bg(t.surface).text_color(t.foreground)
      .child(h_flex().h(36).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.accent).child(`⑂ ${this.branch || "Git history"}`))
        .child(div().text_size(10).text_color(t.muted).child(`${this.commits.length} commits`))
        .child(this.button("git-refresh", this.loading ? "…" : "↻", cx => { if (!this.loading) this.refresh(cx); })))
      .when(Boolean(this.error), element => element.child(div().px(10).py(8).text_size(12).text_color(t.ansi1).child(this.error)))
      .child(v_flex().id("git-history-list").flex_1().min_h(80).overflow_y_scrollbar().children(this.commits.map(row =>
        this.row(row, t).id(`commit-${row.hash}`).tooltip(`${row.subject}\n${row.hash}\n${row.refs}`).on_click((_event, cx) => this.pick(row.hash, cx))))
        .when(!this.commits.length && !this.error, element => element.child(div().p(12).text_size(12).text_color(t.muted).child(this.loading ? "正在读取提交历史…" : "暂无提交"))))
      .when(this.hasMore, element => element.child(this.button("git-more", "加载更早的提交", cx => { if (!this.loading) { this.limit += 120; this.refresh(cx); } })))
      .child(v_flex().flex_1().min_h(100).border_t(1).border_color(t.border)
        .child(div().h(32).flex_none().px(10).flex().items_center().text_size(11).text_color(t.muted).truncate().child(selected ? `${selected.short} · ${selected.subject}` : "选择提交查看详情"))
        .when(this.detailLoading || Boolean(this.detailError), element => element.child(div().p(10).text_size(11).text_color(t.muted).child(this.detailLoading ? "正在读取提交 diff…" : this.detailError)))
        .child(div().id("git-detail-x").flex_1().min_h(0).overflow_x_scrollbar()
          .child(div().w_full().min_w(this.detailWidth).h_full()
            .child(v_virtual_list("git-detail", this.detail.length, 20, index => String(index), range => this.detail.slice(range.start, range.end).map(line =>
              div().h(20).w_full().px(10).font_family("JetBrains Mono").text_size(11)
                .bg(line.startsWith("+") ? t.ansi2 + "18" : line.startsWith("-") ? t.ansi1 + "18" : t.surface)
                .text_color(line.startsWith("@@") ? t.accent : line.startsWith("+") ? t.ansi2 : line.startsWith("-") ? t.ansi1 : t.foreground).child(line || " "))).size_full()))));
  }
}
