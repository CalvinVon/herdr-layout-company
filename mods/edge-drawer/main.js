import { View, div } from "gpui-kit";
import { layout, props, settings, openOverlay, closeOverlay, shared, setShared } from "herdr";

/** @param {any} tree @param {string} id @returns {any} */
const find = (tree, id) => tree?.id === id ? tree : (tree?.children ?? []).map((/** @type {any} */ child) => find(child, id)).find(Boolean);

const CLOSE_DELAY = 240;
const POINTER_INTERVAL = 80;
const TRIGGER_WIDTH = 16;

export default class EdgeDrawer extends View {
  init(_props, cx) {
    this.overlayKey = `edge-drawer.${shared("layout")}.${(props() ?? {}).target}`;
    this.overlay = shared(this.overlayKey) ?? null;
    this.close();
    this.targetHidden = Boolean(find(layout(), (props() ?? {}).target)?.hidden);
    cx.timer.every(POINTER_INTERVAL, next => {
      if (this.overlay || !globalThis.window.is_window_active()) return;
      if (!this.targetHidden) return;
      const viewport = globalThis.window.viewport_size();
      const pointer = globalThis.window.mouse_position();
      const width = TRIGGER_WIDTH * (settings().zoom ?? 1);
      const left = (props() ?? {}).id === "edge-right" ? viewport.width - width : 0;
      if (pointer.x >= left && pointer.x <= left + width && pointer.y >= 0 && pointer.y <= viewport.height) this.open(next);
    });
  }

  width(target) {
    const wanted = (props() ?? {}).width ?? 320;
    const current = target.size?.px ?? 0;
    const width = target.id === "magpie-panel" ? current || wanted : Math.max(current, wanted);
    return Math.min(target.max ?? width, width);
  }

  close() {
    if (this.overlay) closeOverlay(this.overlay);
    if (shared(this.overlayKey) === this.overlay) setShared(this.overlayKey, null);
    this.overlay = null;
  }

  open(cx) {
    if (!globalThis.window.is_window_active()) return;
    const p = props() ?? {};
    const target = find(layout(), p.target);
    if (!target?.hidden || this.overlay) return;
    const viewport = globalThis.window.viewport_size();
    const zoom = settings().zoom ?? 1;
    const width = Math.min(this.width(target), viewport.width / zoom);
    const right = p.id === "edge-right";
    const left = right ? viewport.width - width * zoom : 0;
    const id = openOverlay({
      kind: "window",
      key: this.overlayKey,
      frame: "none",
      width,
      height: viewport.height / zoom,
      at: { x: left, y: 0 },
      layout: { ...target, hidden: false, size: { weight: 1 } },
    });
    this.overlay = id;
    setShared(this.overlayKey, id);
    cx.spawn(async cx => {
      let departed = null;
      while (this.overlay === id) {
        await cx.sleep(POINTER_INTERVAL);
        if (this.overlay !== id) return;
        const size = globalThis.window.viewport_size();
        if (!find(layout(), p.target)?.hidden || !globalThis.window.is_window_active()
          || size.width !== viewport.width || size.height !== viewport.height || (settings().zoom ?? 1) !== zoom) {
          this.close();
          return;
        }
        const pointer = globalThis.window.mouse_position();
        const inside = pointer.x >= left && pointer.x <= left + width * zoom && pointer.y >= 0 && pointer.y <= viewport.height;
        if (inside) departed = null;
        else {
          departed ??= Date.now();
          if (Date.now() - departed >= CLOSE_DELAY) this.close();
        }
      }
    });
  }

  render() {
    this.targetHidden = Boolean(find(layout(), (props() ?? {}).target)?.hidden);
    return div().id(`edge-drawer-${(props() ?? {}).id ?? "edge"}`).size_full()
      .on_hover((hovered, cx) => { if (hovered) this.open(cx); });
  }
}
