import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const spaceList = [
  { id: "dev", name: "D2C 协作台研发部", active: true, tabs: [{ id: "team", name: "Codex", active: true, status: "working" }] },
  { id: "tools", name: "Herdr 定制研发部", tabs: [{ id: "shell", name: "zsh" }] },
  { id: "empty", name: "空项目", tabs: [] },
];
const terminalList = [
  { address: "t9m", state: "live", title: "恢复会话目标", labels: { role: "项目经理" } },
  { address: "t15b", state: "live", title: "演示入口浏览", labels: { role: "测试工程师", task: "验收" }, parent: "t9m" },
  { address: "server/t15b", state: "live", title: "远程检查", labels: { role: "技术负责人" }, parent: "t9m" },
  { address: "t-old", state: "exited", title: "旧测试", parent: "t9m" },
  { address: "t-shell", state: "live", title: "查看日志", labels: { role: "运维" } },
];
const paneList = [
  { pane: "lead", terminal: "t9m", tab: "team", title: "恢复会话目标", program: { name: "OMP" } },
  { pane: "test", terminal: "t15b", tab: "team", title: "演示入口浏览", program: { name: "OMP" } },
  { pane: "logs", terminal: "t-shell", tab: "shell", title: "查看日志", program: { name: "zsh" } },
];
const agentList = paneList.slice(0, 2).map(pane => ({ ...pane, address: pane.terminal, space: "dev", status: "working" }));
const commands = [];
const element = new Proxy({}, { get: () => () => element });
const native = {
  "gpui-kit": { View: class {}, div: () => element, svg: () => element },
  "gpui-base": { h_flex: () => element, v_flex: () => element, InputState: {}, Input: {} },
  herdr: {
    spaces: () => spaceList, terminals: () => terminalList, panes: () => paneList, agents: () => agentList,
    shared: key => key === "workspace.tab-labels" ? { team: { name: "协作开发" } } : {},
    setShared() {}, run: (name, args) => commands.push({ name, args }), hc() {},
    settings: () => ({ zoom: 1 }), theme: () => ({}), props: () => ({ overlay: "search" }),
    closeOverlay() {}, openOverlay() {},
  },
};
const context = vm.createContext({});
const source = process.env.PICKER_SOURCE ?? new URL("./main.js", import.meta.url);
const module = new vm.SourceTextModule(await readFile(source, "utf8"), { context });
await module.link(name => new vm.SyntheticModule(Object.keys(native[name]), function () {
  for (const [key, value] of Object.entries(native[name])) this.setExport(key, value);
}, { context }));
await module.evaluate();
const picker = new module.namespace.default();
picker.showEarlier = true;
picker.machines = [];
const search = query => { picker.filter = query; return picker.rows(); };
assert.ok(search("t15b").some(row => row.terminal === "t15b"), "hc ID must find the specific split, not just a program name");
assert.ok(search("测试").some(row => row.terminal === "t15b"), "sidebar role labels must be searchable");
assert.ok(search("#验收").some(row => row.terminal === "t15b"), "label values must support tag searches");
assert.ok(search("测试 t15b").some(row => row.terminal === "t15b"), "multiple terms must match the same session");
assert.ok(!search("运维 t15b").some(row => row.terminal), "terms from different sessions must not be combined");
assert.ok(search("HERDR").some(row => row.w?.id === "tools"), "Space search must be case insensitive");
assert.ok(search("空项目").some(row => row.kind === "home" && row.w.id === "empty"), "empty Spaces must remain navigable");
assert.ok(search("server/t15b").some(row => row.terminal === "server/t15b"), "unpaneled descendants must be searchable by full address");
assert.ok(search("运维").some(row => row.terminal === "t-shell"), "non-agent terminal labels must also be searchable");
assert.ok(!search("t-old").some(row => row.terminal), "exited descendants must not appear");
picker.go(search("测试").find(row => row.terminal === "t15b"));
assert.equal(commands.at(-1).name, "pane.focus");
assert.equal(commands.at(-1).args.pane, "test", "selecting a split must focus that split");
picker.go(search("server/t15b").find(row => row.terminal === "server/t15b"));
assert.equal(commands.at(-1).name, "agent.focus");
assert.equal(commands.at(-1).args.terminal, "server/t15b");
picker.go(search("空项目").find(row => row.kind === "home"));
assert.equal(commands.at(-1).name, "space.select");
assert.equal(commands.at(-1).args.id, "empty");
assert.equal(search("").filter(row => row.terminal === "t15b").length, 1, "a paneled child must not be duplicated as a descendant");
spaceList[2].tabs.push({ id: "mod-tab", name: "技术文档" });
paneList.push({ pane: "mod", tab: "mod-tab", terminal: null, title: "技术文档" });
picker.go(search("技术文档").find(row => row.ctx?.id === "mod-tab"));
assert.equal(commands.at(-1).name, "tab.select", "mod-only tabs must remain searchable");
picker.machines = ["build-server"];
picker.go(search("").find(row => row.machine === "build-server"));
assert.equal(commands.at(-1).name, "space.new");
assert.equal(commands.at(-1).args.machine, "build-server", "remote Space creation must remain available");
console.log("Workspace search: hc IDs, roles/tags, Spaces, descendants and split navigation passed.");
