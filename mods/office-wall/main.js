import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { props, theme, appHome, readTextFile, writeTextFile, run, closeOverlay, setShared, exec, window } from "herdr";
import { updatePins, parsePins, validMatrix } from "./store.js";
import { qrcode } from "./qr-encoder.js";

const validUrl = url => /^https?:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/i.test(url);
const message = error => String(error?.message || error);

qrcode.stringToBytes = text => {
  const encoded = encodeURIComponent(text), bytes = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === "%") { bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(encoded.charCodeAt(i));
  }
  return bytes;
};

function generatedQR(url) {
  for (let version = 1; version <= 40; version++) {
    try {
      const qr = qrcode(version, "L");
      qr.addData(url); qr.make();
      const count = qr.getModuleCount();
      return Array.from({ length: count }, (_, y) => Array.from({ length: count }, (_, x) => qr.isDark(y, x)));
    } catch (error) {
      if (!String(error).includes("code length overflow")) throw error;
    }
  }
  throw new Error("链接过长，无法生成二维码");
}

function qrView(matrix) {
  const unit = Math.max(2, Math.floor(220 / (matrix.length + 8)));
  return v_flex().flex_none().p(unit * 4).bg("#ffffff").children(matrix.map(row =>
    h_flex().flex_none().children(row.map(dark => div().size(unit).flex_none().bg(dark ? "#000000" : "#ffffff")))));
}

export default class OfficeWall extends View {
  init(_props, cx) {
    const target = props() ?? {};
    this.roomKey = target.roomKey;
    this.roomName = target.roomName || "项目";
    this.fileIds = Array.isArray(target.fileIds) ? new Set(target.fileIds) : null;
    this.serviceFile = target.serviceFile;
    this.services = Array.isArray(target.services) ? target.services : (target.services?.[this.roomKey] ?? []);
    this.pins = [];
    this.file = `${appHome()}/office-wall-pins.json`;
    this.snapshot = null;
    this.loaded = false;
    this.busy = false;
    this.error = "";
    this.serviceError = "";
    this.editing = null;
    this.hidden = {};
    this.name = InputState.new({ placeholder: "链接名称" });
    this.url = InputState.new({ placeholder: "https://…" });
    this.content = InputState.new({ placeholder: "内容或本地文件绝对路径" });
    this.editKind = "url";
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.load(cx);
    if (this.serviceFile) { this.refreshServices(cx); cx.timer.every(2000, cx => this.refreshServices(cx)); }
  }

  load(cx) {
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(this.file), data = parsePins(text);
        this.snapshot = text; this.pins = data.rooms[this.roomKey] ?? []; this.loaded = true; this.error = "";
      } catch (error) { this.error = `读取固定链接失败：${message(error)}`; }
      cx.notify();
    });
  }

  refreshServices(cx) {
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(this.serviceFile);
        if (text === null) throw new Error("服务快照不存在");
        const data = JSON.parse(text);
        if (!data || typeof data !== "object" || Array.isArray(data) || (data[this.roomKey] !== undefined && !Array.isArray(data[this.roomKey]))) throw new Error("服务快照格式无效");
        const fresh = typeof data._updatedAt === "number" && Date.now() - data._updatedAt < 20000;
        this.services = (data[this.roomKey] ?? []).map(card => fresh ? card : { ...card, status: "unknown" });
        this.serviceError = fresh ? "" : "服务快照未更新，状态未知。";
        if (data._removeError?.roomKey === this.roomKey && typeof data._removeError.id === "string") {
          delete this.hidden[data._removeError.id];
          this.serviceError = "移除失败，请重试；原内容未删除。";
        }
        for (const id of Object.keys(this.hidden)) if (!this.services.some(card => card?.id === id)) delete this.hidden[id];
      } catch (error) { this.services = this.services.map(card => ({ ...card, status: "unknown" })); this.serviceError = `服务更新失败：${message(error)}`; }
      this.refreshing = false; cx.notify();
    });
  }

  change(action, cx, done) {
    if (this.busy || !this.loaded) return;
    this.busy = true; this.error = ""; cx.notify();
    cx.spawn(async cx => {
      try {
        let expected = this.snapshot;
        const before = parsePins(expected);
        const original = (before.rooms[this.roomKey] ?? []).find(card => card.id === (action.card?.id ?? action.id));
        for (let attempt = 0; attempt < 4; attempt++) {
          const data = parsePins(expected), items = data.rooms[this.roomKey] ?? [];
          const current = items.find(card => card.id === (action.card?.id ?? action.id));
          if (attempt && JSON.stringify(current) !== JSON.stringify(original)) throw new Error("此卡片已在其他窗口修改，请重新读取后再试");
          data.rooms[this.roomKey] = updatePins(items, action);
          const next = JSON.stringify(data, null, 2) + "\n";
          try {
            await writeTextFile(this.file, next, expected);
            this.snapshot = next; this.pins = data.rooms[this.roomKey];
            if (done) done();
            break;
          } catch (error) {
            const currentText = await readTextFile(this.file);
            if (currentText === expected || attempt === 3) throw error;
            parsePins(currentText); expected = currentText;
          }
        }
      } catch (error) { this.error = `保存固定链接失败：${message(error)}`; }
      this.busy = false; cx.notify();
    });
  }

  edit(card, cx, kind = "url") {
    this.editing = card?.id ?? `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.editKind = card?.kind === "note" || card?.kind === "file" ? card.kind : kind;
    this.editSource = card?.source;
    this.name.set_value(card?.name ?? ""); this.url.set_value(card?.url ?? "");
    this.content.set_value(this.editKind === "file" ? (card?.path ?? "") : (card?.text ?? ""));
    this.error = ""; this.name.focus(); cx.notify();
  }

  saveEdit(cx) {
    const name = this.name.value().trim(), url = this.url.value().trim(), content = this.content.value().trim();
    if (!name || (this.editKind === "url" && !validUrl(url)) || (this.editKind === "note" && !content) || (this.editKind === "file" && !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(content))) {
      this.error = "请填写名称和有效的链接、便签内容或本地文件绝对路径。"; cx.notify(); return;
    }
    let card = { id: this.editing, name, url: "" };
    if (this.editKind === "url") {
      try { card = { ...card, url, qr: generatedQR(url), qrKind: "generated" }; } catch (error) { this.error = message(error); cx.notify(); return; }
    } else {
      card = { ...card, kind: this.editKind, ...(this.editKind === "note" ? { text: content } : { path: content }), ...(this.editSource ? { source: this.editSource } : {}) };
    }
    this.change({ type: "save", card }, cx, () => { this.editing = null; });
  }

  openFile(path, cx) {
    if (typeof path !== "string" || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path)) { this.error = "文件路径必须是绝对路径。"; cx.notify(); return; }
    const platform = window()?.platform, command = platform === "windows" ? "rundll32" : platform === "macos" ? "open" : "xdg-open";
    const args = platform === "windows" ? ["url.dll,FileProtocolHandler", path] : [path];
    cx.spawn(async cx => {
      try { const result = await exec(command, args); if (result.code !== 0) throw new Error(result.stderr || `退出码 ${result.code}`); }
      catch (error) { this.error = `打开文件失败：${message(error)}`; }
      cx.notify();
    });
  }

  render() {
    const t = theme(), p = props() ?? {}, locked = this.busy || !this.loaded;
    const button = (id, text, action, enabled = true, primary = false) => div().id(id).h(30).px(10).flex_none().flex().items_center().justify_center().rounded(6)
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground).text_size(12).opacity(enabled ? 1 : 0.45)
      .when(enabled, el => el.cursor_pointer().hover(s => s.opacity(0.8))).on_click((_e, cx) => { if (enabled) action(cx); }).child(text);
    const input = state => Input.new(state).h(34).px(9).rounded(7).border_1().border_color(t.input).bg(t.background).text_color(t.foreground).text_size(12.5);
    const services = (Array.isArray(this.services) ? this.services : []).filter(card => card && typeof card.id === "string" && !this.hidden[card.id]);
    const pinIds = new Set(this.pins.map(card => card.id));
    const rows = [];
    if (typeof p.detailId === "string") {
      const goal = services.find(card => card.id === p.detailId && card.kind === "goal");
      return v_flex().id("office-wall").track_focus(this.handle).size_full().p(20).gap(12).bg(t.popover).text_color(t.foreground)
        .child(h_flex().items_center().justify_between().child(div().text_size(17).font_semibold().child("目标详情"))
          .child(button("wall-close", "关闭", () => closeOverlay(p.overlay))))
        .child(v_flex().id("office-wall-goal-detail").flex_1().min_h(0).overflow_y_scrollbar().gap(10)
          .child(div().whitespace_normal().child(goal?.text || goal?.name || "暂无目标")));
    }
    for (const card of services) rows.push({ ...card, observed: true, pinned: pinIds.has(card.id) });
    for (const card of this.pins) if (!services.some(service => service.id === card.id)) rows.push({ ...card, pinned: true, observed: false });
    const visibleRows = this.fileIds ? rows.filter(card => card.kind === "file" && this.fileIds.has(card.id)) : rows;
    const cards = visibleRows.map((card, index) => {
      const saved = this.pins.find(item => item.id === card.id);
      const typed = card.kind === "note" || card.kind === "file" || card.kind === "goal";
      const urls = card.observed ? (Array.isArray(card.urls) ? card.urls.filter(url => typeof url === "string") : []) : [card.url].filter(Boolean);
      const matrix = validMatrix(card.qr) ? card.qr : saved?.qr;
      let qr = validMatrix(matrix) ? matrix : null, qrError = "";
      if (!card.observed && !qr && saved?.url && saved.id.startsWith("manual-")) {
        try { qr = generatedQR(saved.url); } catch (error) { qrError = message(error); }
      }
      const status = typed ? ({ note: "便签", file: "文件", goal: "目标" }[card.kind] + (card.published ? " · 已发布" : card.pinned ? " · 已固定" : "")) : card.observed ? ({ running: "运行中", live: "运行中", stopped: "已停止", unknown: "状态未知" }[card.status] ?? "状态未知") : "固定链接 · 状态未知";
      return v_flex().id(`wall-card-${index}`).flex_none().p(12).gap(9).rounded(8).bg(t.surface)
        .child(h_flex().items_center().gap(8).child(div().flex_1().min_w(0).truncate().text_size(14).font_semibold().child(card.name || "服务"))
          .child(div().text_size(11).text_color(t.muted).child(status)))
        .child(h_flex().gap(14).items_start()
          .when(Boolean(qr), el => el.child(v_flex().gap(4).items_center().child(qrView(qr)).child(div().text_size(10).text_color(t.muted).child((validMatrix(card.qr) ? card.qrKind : saved?.qrKind) === "generated" ? "由链接生成" : (validMatrix(card.qr) ? card.qrKind : saved?.qrKind) === "terminal" ? "终端原码" : card.observed || !card.id.startsWith("manual-") ? "终端原码" : "由链接生成"))))
          .child(v_flex().flex_1().min_w(0).gap(7)
            .when(Boolean(card.text), el => el.child(div().text_size(12).text_color(t.foreground).child(card.text)))
            .when(Boolean(card.source), el => el.child(div().text_size(11).text_color(t.muted).child(`来源：${card.source}`)))
            .when(Boolean(card.kind === "file" && card.path), el => el.child(v_flex().gap(4).child(div().text_size(11.5).child(card.path)).child(button(`file-open-${index}`, "打开文件", cx => this.openFile(card.path, cx)))))
            .when(!typed && !qr, el => el.child(div().text_size(11).text_color(t.muted).child(qrError || (card.observed || !card.id.startsWith("manual-") ? "未提取到终端原码，可定位终端查看。" : "无二维码"))))
            .children(urls.map((url, i) => v_flex().gap(4).child(div().text_size(11.5).text_color(t.foreground).child(url))
              .child(h_flex().gap(6).child(button(`open-${index}-${i}`, "打开", cx => cx.open_url(url), validUrl(url)))
                .child(button(`copy-${index}-${i}`, "复制", cx => { cx.write_to_clipboard(url); })))))))
        .child(h_flex().gap(6).items_center()
          .when(Boolean(card.observed && card.pane), el => el.child(button(`focus-${index}`, "定位终端", () => { closeOverlay(p.overlay); run("pane.focus", { pane: card.pane }); })))
          .when(Boolean(card.observed && !card.pinned), el => el.child(button(`pin-${index}`, "固定", cx => {
            let pin;
            if (typed) {
              const kind = card.kind === "goal" ? "note" : card.kind;
              if (kind === "note" && (typeof card.text !== "string" || !card.text.trim()) || kind === "file" && (typeof card.path !== "string" || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(card.path))) { this.error = "卡片内容或文件路径无效。"; cx.notify(); return; }
              pin = { id: card.id, name: card.name || "卡片", url: "", kind, ...(kind === "note" ? { text: card.text } : { path: card.path }), ...(card.source ? { source: card.source } : {}) };
            } else {
              const url = (card.qrKind === "generated" && validUrl(card.qrUrl) ? card.qrUrl : urls.find(validUrl)) || "";
              if (!url && !qr) { this.error = "没有可固定的链接或二维码。"; cx.notify(); return; }
              pin = { id: card.id, name: card.name || "服务", url, ...(qr ? { qr, qrKind: card.qrKind || "terminal" } : {}) };
            }
            this.change({ type: "save", card: pin }, cx);
          }, !locked)))
          .when(Boolean(card.pinned), el => el.child(button(`unpin-${index}`, card.observed ? "取消固定" : "删除", cx => this.change({ type: "remove", id: card.id }, cx), !locked)))
          .when(Boolean(card.pinned && saved && (saved.url || saved.kind === "note" || saved.kind === "file")), el => el.child(button(`edit-${index}`, "编辑", cx => this.edit(saved, cx), !locked)))
          .when(Boolean(card.observed && (!card.pinned || card.published || card.kind === "goal")), el => el.child(button(`hide-${index}`, "移除", cx => {
            const hide = () => { this.hidden[card.id] = true; setShared("office-wall.remove-request", { token: `${Date.now()}-${Math.random()}`, roomKey: this.roomKey, id: card.id }); cx.notify(); };
            if (card.pinned) this.change({ type: "remove", id: card.id }, cx, hide); else hide();
          }, !locked))));
    });
    return v_flex().id("office-wall").track_focus(this.handle).size_full().p(20).gap(12).bg(t.popover).text_color(t.foreground)
      .child(h_flex().gap(10).items_center().child(v_flex().flex_1().gap(3)
        .child(div().text_size(17).font_semibold().child(this.fileIds ? "工位文档" : "服务信息墙"))
        .child(div().text_size(11).text_color(t.muted).child(`${this.roomName} · ${visibleRows.length} 项`)))
        .when(!this.fileIds, el => el.child(button("wall-add", "+ 添加链接", cx => this.edit(null, cx), !locked, true))
          .child(button("wall-add-note", "+ 添加便签", cx => this.edit(null, cx, "note"), !locked))
          .child(button("wall-add-file", "+ 添加文件", cx => this.edit(null, cx, "file"), !locked)))
        .child(button("wall-close", "关闭", () => closeOverlay(p.overlay))))
      .when(Boolean(this.editing), el => el.child(v_flex().gap(7).p(10).rounded(8).bg(t.surface)
        .child(div().text_size(12).font_semibold().child(this.editKind === "note" ? "编辑便签" : this.editKind === "file" ? "编辑文件" : "编辑链接"))
        .child(input(this.name)).child(input(this.editKind === "url" ? this.url : this.content))
        .child(h_flex().gap(7).child(button("wall-save", "保存", cx => this.saveEdit(cx), !locked, true))
          .child(button("wall-cancel", "取消", cx => { this.editing = null; this.error = ""; cx.notify(); }, !this.busy)))))
      .when(Boolean(this.error), el => el.child(h_flex().gap(8).items_center().child(div().flex_1().text_size(11.5).text_color(t.blocked).child(this.error))
        .child(button("wall-reload", "重新读取", cx => this.load(cx), !this.busy))))
      .when(Boolean(this.serviceError), el => el.child(div().text_size(11).text_color(t.blocked).child(this.serviceError)))
      .child(v_flex().id("wall-list").flex_1().min_h(0).overflow_y_scrollbar().gap(10).children(cards)
        .when(visibleRows.length === 0, el => el.child(div().py(30).text_size(12).text_color(t.dim).child(this.loaded ? this.fileIds ? "暂无工位文档。" : "暂无服务或固定链接。" : "正在读取固定链接…"))));
  }
}
