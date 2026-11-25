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
      else target.props[key] = key === "on_mouse_down" ? args[1] : args[0];
      return view;
    };
  } });
  return view;
}

let target = {};
const values = new Map();
const environment = {
  View: class {}, div: element, svg: element, v_flex: element, h_flex: element,
  Editor: { new: element }, TextView: { new: () => element() },
  spaces: () => [{ id: "s1", active: true, folder: "/repo" }],
  focused: () => ({ pane: "p1", terminal: "t1" }), panes: () => [{ pane: "p1", cwd: "/repo" }],
  props: () => target, theme: () => ({}), shared: key => values.get(key), setShared: (key, value) => values.set(key, value), closeOverlay() {},
  readTextFile: async () => "# 技术方案\n正文内容", settings: () => ({}), EditorState: { new: () => ({ release() {} }) },
  TextViewState: { markdown: () => ({ on() {}, release() {} }) },
};
const source = fs.readFileSync(process.env.FILES_SOURCE || path.join(__dirname, "main.js"), "utf8")
  .replace(/^import .*;\n/gm, "").replace("export default class Files", "class Files");
const Files = new Function(...Object.keys(environment), `${source}\nreturn Files;`)(...Object.values(environment));
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

for (const mode of source.includes("this.publication") ? ["inline", "floating", "publication"] : ["inline", "floating"]) {
  const floating = mode === "floating";
  target = { floating };
  const viewer = new Files();
  Object.assign(viewer, {
    context: { key: JSON.stringify({ cwd: "/repo", on: null, space: "s1" }) },
    root: "/repo", file: "plan.md", code: {}, document: {}, preview: true, markdown: "# 技术方案\n正文内容",
    publication: mode === "publication" ? { path: "/repo/plan.md", on: null } : null,
  });
  const rendered = viewer.render({});
  const chain = findPath(rendered, "files-markdown-text");
  assert.ok(chain, "Markdown preview must retain its native text view");
  assert.ok(Object.hasOwn(chain.at(-1).props, "selectable"), "Preview text must enable native selection");
  let stopped = false;
  for (const node of [...chain].reverse()) node.props.on_mouse_down?.({}, { stop_propagation() { stopped = true; } });
  assert.equal(stopped, false, `Markdown press must reach ShellRoot's native selection layer (${mode})`);
}
console.log("Markdown previews preserve presses for the native selection layer.");

async function checkModeTransfer() {
  const context = { key: JSON.stringify({ cwd: "/repo", on: null, space: "s1" }) };
  for (const mode of ["inline", "floating"]) {
    for (const file of ["plan.md", null]) {
      values.clear();
      target = { floating: mode === "floating" };
      values.set("project-tabs.panel-mode", mode);
      values.set("files-markdown.restore", { mode, context: context.key, file, preview: false });
      const viewer = Object.assign(new Files(), { context, root: "/repo", file: "old.md", code: { release() {} }, document: { release() {} }, markdown: "旧文档", preview: true, entries: new Map(), folders: new Set(), marks: {} });
      const tasks = [];
      viewer.render({ notify() {}, spawn(fn) { tasks.push(fn({ notify() {} })); } });
      await Promise.all(tasks);
      assert.equal(viewer.file, file, `${mode}: switching must restore the selected file or directory view`);
      assert.equal(viewer.preview, false, `${mode}: switching must preserve preview/source mode`);
      assert.equal(values.get("files-markdown.restore"), null, "Transfer must be consumed once");
      if (file) assert.equal(viewer.markdown, "# 技术方案\n正文内容");
    }
  }
  console.log("Files mode transfers preserve the document, directory view and preview/source choice.");
}
checkModeTransfer().catch(error => { console.error(error); process.exitCode = 1; });
