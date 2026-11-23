import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

let options, tree, pointer, now, zoom, windowActive;
const opened = [], closed = [], commands = [], sleeps = [];
const timers = [];
const sharedStorage = new Map();
const handlers = {};
let pointerReads = 0;
const element = new Proxy({}, {
  get: (_target, name) => (...args) => {
    if (name.startsWith("on_")) handlers[name] = args[0];
    return element;
  },
});
const context = vm.createContext({
  Date: class extends Date { static now() { return now; } },
  window: {
    viewport_size: () => { pointerReads++; return { width: 1200, height: 800 }; },
    mouse_position: () => { pointerReads++; return pointer; },
    is_window_active: () => windowActive,
  },
});
const dependencies = {
  "gpui-kit": { View: class {}, div: () => element },
  herdr: {
    props: () => options,
    layout: () => tree,
    settings: () => ({ zoom }),
    shared: key => key === "layout" ? "agent-columns" : sharedStorage.get(key),
    setShared: (key, value) => sharedStorage.set(key, value),
    run: (name, args) => commands.push({ name, args }),
    openOverlay: spec => { opened.push(spec); return `overlay-${opened.length}`; },
    closeOverlay: id => closed.push(id),
  },
};
const main = new vm.SourceTextModule(await readFile(new URL("./main.js", import.meta.url), "utf8"), { context });
await main.link(name => {
  const exports = dependencies[name];
  return new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context });
});
await main.evaluate();
const Drawer = main.namespace.default;
const tasks = [];
const cx = {
  spawn: body => { tasks.push(body(cx)); },
  sleep: duration => new Promise(resolve => sleeps.push(() => { now += duration; resolve(); })),
  timer: { every: (_duration, body) => timers.push(body) },
  notify() {},
};
const tick = async () => {
  assert.ok(sleeps.length, "The drawer should be watching for pointer departure");
  sleeps.shift()();
  await new Promise(setImmediate);
};
const reset = (target = "sidebar") => {
  options = { id: target === "sidebar" ? "edge-left" : "edge-right", target, width: target === "sidebar" ? 440 : 320 };
  tree = { id: "root", type: "row", children: [
    { id: "sidebar", type: "column", hidden: true, size: { px: 351 }, max: 480, children: [{ id: "spaces", type: "block", content: { mod: "agent-columns-spaces" } }] },
    { id: "work", type: "block", content: { tab: "active" } },
    { id: "magpie-panel", type: "block", hidden: true, size: { px: 320 }, content: { mod: "magpie-live" } },
  ] };
  pointer = { x: target === "sidebar" ? 0 : 1199, y: 100 };
  now = 0;
  zoom = 1;
  windowActive = true;
  opened.length = closed.length = commands.length = tasks.length = sleeps.length = 0;
  timers.length = 0;
  sharedStorage.clear();
  const drawer = new Drawer();
  drawer.init({}, cx);
  return drawer;
};

let drawer = reset();
const before = JSON.stringify(tree);
drawer.render();
handlers.on_hover(true, cx);
assert.equal(commands.length, 0, "Hovering must not show or resize docked layout nodes");
assert.equal(opened.length, 1, "Hovering should open an overlay");
assert.equal(JSON.stringify(tree), before, "The central layout and hidden sidebar must stay unchanged");
assert.equal(opened[0].kind, "window");
assert.equal(opened[0].frame, "none");
assert.equal(opened[0].width, 440);
assert.equal(opened[0].at.x, 0);
assert.equal(opened[0].layout.hidden, false);
assert.equal(opened[0].layout.children[0].content.mod, "agent-columns-spaces");
handlers.on_hover(true, cx);
assert.equal(opened.length, 1, "Repeated hovering must reuse the open drawer");
pointer.x = 200;
await tick();
assert.equal(closed.length, 0, "The drawer must stay open while its content is hovered");
pointer.x = 600;
await tick();
pointer.x = 200;
await tick();
assert.equal(closed.length, 0, "Returning during the close delay must keep the drawer open");
pointer.x = 600;
for (let tickIndex = 0; tickIndex < 5 && !closed.length; tickIndex++) await tick();
assert.deepEqual(closed, ["overlay-1"]);
await Promise.all(tasks);

drawer = reset("magpie-panel");
drawer.open(cx);
assert.equal(opened[0].at.x, 880);
assert.equal(opened[0].width, 320);
tree.children[2].hidden = false;
await tick();
assert.equal(closed.length, 1, "Pinning the panel should dismiss its temporary overlay");
await Promise.all(tasks);

drawer = reset();
tree.children[0].hidden = false;
drawer.render();
const readsWhileVisible = pointerReads;
timers[0](cx);
assert.equal(pointerReads, readsWhileVisible, 'visible docked panels must skip edge pointer polling');
drawer.open(cx);
assert.equal(opened.length, 0, "A visible sidebar must not get a duplicate drawer");

for (const width of [280, 420]) {
  drawer = reset("magpie-panel");
  tree.children[2].size.px = width;
  drawer.open(cx);
  assert.equal(opened[0].width, width, "The Magpie drawer must retain the docked panel's width");
  drawer.close();
  await tick();
  await Promise.all(tasks);
}

drawer = reset();
zoom = 2;
drawer.open(cx);
assert.ok(opened[0].width * zoom <= 1200);
assert.equal(opened[0].height * zoom, 800);
drawer.close();
await tick();
await Promise.all(tasks);
assert.equal(commands.length, 0);
drawer = reset();
drawer.open(cx);
const reloaded = new Drawer();
reloaded.init({}, cx);
assert.deepEqual(closed, ["overlay-1"], "Reloading the edge mod must close the old overlay after its listener is cancelled");
drawer.close();
await tick();
await Promise.all(tasks);

for (const target of ["sidebar", "magpie-panel"]) {
  for (const scale of [1, 2]) {
    drawer = reset(target);
    zoom = scale;
    const before = JSON.stringify(tree);
    const trigger = timers[0];
    pointer.x = target === "sidebar" ? 16 * scale + 1 : 1200 - 16 * scale - 1;
    trigger(cx);
    assert.equal(opened.length, 0, "The drawer must stay closed outside the expanded edge zone");
    pointer.x = target === "sidebar" ? 16 * scale : 1200 - 16 * scale;
    pointer.y = -1;
    trigger(cx);
    assert.equal(opened.length, 0, "The trigger must stay within the window height");
    pointer.y = 799;
    windowActive = false;
    trigger(cx);
    assert.equal(opened.length, 0, "Inactive windows must not open a drawer");
    windowActive = true;
    trigger(cx);
    assert.equal(opened.length, 1, "Both edges must trigger across the full 16px zone at the current zoom");
    trigger(cx);
    assert.equal(opened.length, 1, "Polling must reuse an already open drawer");
    assert.equal(JSON.stringify(tree), before, "Expanding the trigger zone must not resize the central layout");
    assert.equal(commands.length, 0);
    drawer.close();
    await tick();
    await Promise.all(tasks);
  }
}
console.log("Edge drawer: expanded edge triggers, overlay geometry, unchanged layout, hover retention, delayed close, pinning and zoom passed.");
