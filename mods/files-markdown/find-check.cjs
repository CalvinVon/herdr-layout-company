const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function element() {
  const data = { props: {}, nodes: [] };
  const view = new Proxy(data, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === "child") target.nodes.push(args[0]);
      else if (key === "children") target.nodes.push(...args[0]);
      else if (key === "when") { if (args[0]) args[1](view); }
      else target.props[key] = args[0];
      return view;
    };
  } });
  return view;
}
const findPath = (node, id, parents = []) => {
  if (!node || typeof node !== "object") return null;
  const chain = [...parents, node];
  if (node.props.id === id) return chain;
  for (const child of node.nodes) {
    const found = findPath(child, id, chain);
    if (found) return found;
  }
  return null;
};
const textOf = node => typeof node === "string" ? node : (node?.nodes || []).map(textOf).join(" ");

let value = "", focused = 0, deliver;
const state = {
  value: () => value, focus: () => { focused++; }, release() {},
  on(event, handler) { state[event] = handler; return true; },
};
const calls = [];
function nativeDocument() {
  const document = {
    result: { count: 0, index: -1, pending: false },
    search(query, index = 0) { calls.push({ document, query, index }); return { ...document.result, query }; },
    on(event, handler) { document[`${event}Event`] = handler; }, release() { document.released = true; },
  };
  return document;
}
const environment = {
  View: class {}, div: element, svg: element, v_flex: element, h_flex: element,
  Editor: { new: element }, TextView: { new: () => element() }, TextViewState: { markdown: nativeDocument },
  Input: { new: () => element() }, InputState: { new: () => state },
  spaces: () => [{ id: "s1", active: true, folder: "/repo" }],
  focused: () => ({ pane: "p1", terminal: "t1" }), panes: () => [{ pane: "p1", cwd: "/repo" }],
  props: () => ({}), theme: () => ({ accent: "#4488ff", background: "#111", border: "#333", foreground: "#eee", muted: "#888", dim: "#666", hover: "#222", blocked: "#c4511a" }),
  shared: () => null, setShared() {}, closeOverlay() {}, notify() {}, settings: () => ({}),
  nextCommand: () => new Promise(resolve => { deliver = resolve; }),
  readTextFile: async () => "# **alpha**\n[alpha](https://example.com/alpha)",
  watchFolder() {}, exec: async () => ({ code: 1, stdout: "", stderr: "" }),
  EditorState: { new: nativeDocument },
};
const sourceFile = process.env.FILES_SOURCE || path.join(__dirname, "main.js");
const source = fs.readFileSync(sourceFile, "utf8")
  .replace(/^import .*;\n/gm, "").replace("export default class Files", "class Files");
const Files = new Function(...Object.keys(environment), `${source}\nreturn Files;`)(...Object.values(environment));

(async () => {
  const view = new Files();
  const tasks = [], cx = { notify() {}, spawn: task => { tasks.push(task); }, timer: { every() {} } };
  view.init({}, cx);
  tasks[0](cx);
  view.context = { key: JSON.stringify({ cwd: "/repo", on: null, space: "s1" }) };
  view.root = "/repo"; view.entries = new Map(); view.folders = new Set(); view.marks = {};
  deliver("find"); await Promise.resolve();
  assert.equal(view.find, null, "search needs an open file");
  view.file = "code.ts"; view.text = "alpha"; view.code = nativeDocument();
  deliver("find"); await Promise.resolve();
  assert.equal(focused, 1, "the dispatched command focuses the input");
  deliver("find"); await Promise.resolve();
  assert.equal(focused, 2, "repeating the shortcut refocuses the existing search field");

  value = "alpha"; view.code.result = { count: 3, index: 0, pending: false };
  state.change({}, cx);
  assert.deepEqual(calls.at(-1), { document: view.code, query: "alpha", index: 0 });
  view.code.result.index = 1;
  state.submit({}, cx);
  assert.equal(calls.at(-1).index, 1, "Enter asks native search to reveal the next occurrence");
  view.code.result.index = 0;
  state.submit({ shift: true }, cx);
  assert.equal(calls.at(-1).index, 0, "Shift+Enter requests the previous occurrence");
  view.code.result.index = 2;
  view.stepFind(-1);
  assert.equal(calls.at(-1).index, -1, "native search owns wraparound without a duplicate JS matcher");
  let rendered = view.render(cx);
  assert.ok(textOf(findPath(rendered, "files-find").at(-1)).includes("3 / 3"));

  value = "missing"; view.code.result = { count: 0, index: -1, pending: false };
  state.change({}, cx);
  assert.ok(textOf(findPath(view.render(cx), "files-find").at(-1)).includes("无匹配"));

  view.show("plan.md", cx);
  await tasks.at(-1)(cx);
  const markdown = view.document, code = view.code;
  value = "alpha"; markdown.result = { count: 0, index: -1, pending: true };
  view.openFind(cx);
  assert.equal(calls.at(-1).document, markdown, "preview searches the rendered document");
  assert.ok(textOf(findPath(view.render(cx), "files-find").at(-1)).includes("正在定位"));
  const completed = { query: "alpha", count: 2, index: 0, pending: false };
  markdown.searchEvent(completed, cx);
  assert.equal(view.find.count, 2, "preview count comes from rendered text, excluding a link destination");
  value = "different";
  markdown.searchEvent({ ...completed, count: 99 }, cx);
  assert.equal(view.find.count, 2, "a late response for another query cannot replace the active result");
  value = "alpha"; code.result = { count: 3, index: 0, pending: false };
  findPath(view.render(cx), "files-markdown-toggle").at(-1).props.on_click({}, cx);
  assert.equal(calls.at(-1).document, code, "source mode delegates to the code editor");
  markdown.searchEvent({ ...completed, count: 99 }, cx);
  assert.equal(view.find.count, 3, "hidden preview events cannot overwrite source results");
  findPath(view.render(cx), "files-find-close").at(-1).props.on_click({}, cx);
  assert.equal(view.find, null);
  assert.deepEqual(calls.slice(-2).map(call => [call.document, call.query]), [[code, ""], [markdown, ""]], "closing clears both native highlight sessions");
  markdown.searchEvent(completed, cx);
  assert.equal(view.find, null, "late parsing cannot reopen a closed search");
  view.show(null);
  assert.equal(markdown.released, true, "leaving a file releases the retained document");
  assert.equal(code.released, true);
  console.log("Files find passed: dispatched shortcut, native navigation, rendered-text counts, async/stale results, mode switches, highlight cleanup and release.");
})().catch(error => { console.error(error); process.exitCode = 1; });
