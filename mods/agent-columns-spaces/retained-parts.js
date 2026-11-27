import { View, div } from "gpui-kit";

// Render records intent; only the owning sidebar's task creates or invalidates views.
export class RetainedParts {
  constructor() {
    this.entries = new Map();
    this.sweepPhase = 0;
    const entries = this.entries;
    this.Part = class extends View {
      init({ key }) { this.key = key; this.mountToken = entries.get(key).mountToken; }
      render() { const entry = entries.get(this.key); return entry.build(entry, this.mountToken); }
    };
  }
  begin(signature) {
    this.signature = signature;
    this.used = new Set();
  }
  element(key, kind, build, style, signature = this.signature) {
    this.used.add(key);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { kind, build, signature, phase: this.sweepPhase };
      this.entries.set(key, entry);
    }
    entry.build = build;
    entry.signature = signature;
    if (entry.handle && (entry.kind === "sweep" || entry.ready === entry.signature)) return style ? style(entry.handle.cached()) : entry.handle;
    return style ? style(div()).child(build(entry)) : build(entry);
  }
  sync(cx) {
    let remount = false;
    for (const [key, entry] of this.entries) {
      if (!this.used.has(key)) {
        entry.handle?.release();
        this.entries.delete(key);
        continue;
      }
      if (!entry.handle) {
        entry.mountToken = {};
        entry.handle = cx.new(this.Part, { key });
        entry.ready = entry.signature;
        remount = true;
      } else if (entry.ready !== entry.signature) {
        entry.ready = entry.signature;
        cx.notify(entry.handle);
        if (entry.kind !== "sweep") remount = true;
      }
    }
    if (remount) cx.notify();
  }
  setSweepPhase(phase, cx) {
    // New entities must first lay out at their creation phase before transitioning.
    this.sync(cx);
    this.sweepPhase = phase;
    for (const [key, entry] of this.entries) if (entry.kind === "sweep" && this.used.has(key)) {
      entry.pendingPhase = phase;
      if (entry.mounted) {
        entry.phase = phase;
        cx.notify(entry.handle);
      }
    }
  }
  mounted(key, mountToken, cx) {
    const entry = this.entries.get(key);
    if (!entry?.handle || !mountToken || entry.mountToken !== mountToken || entry.mounted) return;
    entry.mounted = true;
    if (entry.pendingPhase !== undefined && entry.phase !== entry.pendingPhase) {
      entry.phase = entry.pendingPhase;
      cx.notify(entry.handle);
    }
  }
  hover(key, hovered, cx) {
    const entry = this.entries.get(key);
    if (!entry || Boolean(entry.hovered) === hovered) return;
    entry.hovered = hovered;
    if (!entry.handle) this.sync(cx);
    cx.notify(entry.handle);
  }
  notify(kind, cx) {
    for (const [key, entry] of this.entries) if (entry.kind === kind && entry.handle && this.used.has(key)) cx.notify(entry.handle);
  }
}
