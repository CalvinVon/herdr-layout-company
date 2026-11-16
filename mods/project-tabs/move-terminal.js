// Herdr park/keep are asynchronous and cannot be made atomic.
export async function moveTerminal(api, request) {
  const { terminal, pane, tab, space, machine, name, destination, direction } = request;
  const selected = () => api.spaces().find(item => item.active);
  const sameSpace = () => selected()?.id === space && (selected()?.machine ?? null) === machine;
  const ready = () => api.machines().some(item => (item.name ?? null) === machine && item.layout === "ready");
  const live = address => api.terminals().some(item => item.address === address && item.state === "live");
  const source = () => api.panes().some(item => item.pane === pane && item.tab === tab && item.terminal === terminal);
  const targetPane = () => selected()?.tabs.some(item => item.id === destination) && api.panes().find(item => item.tab === destination && item.terminal && live(item.terminal));
  const detached = "终端可能已停放，请切回原 Space 检查标签页，必要时从 Agent 列表恢复。";
  if (!sameSpace() || !ready() || !live(terminal) || !source() || !selected().tabs.some(item => item.id === tab) || api.panes().filter(item => item.tab === tab).length < 2 || (destination && (destination === tab || !["right", "down"].includes(direction) || !targetPane()))) {
    throw new Error("源会话、Space、机器或目标标签页已变化，未移动终端。");
  }
  api.run("terminal.park", { terminal });
  for (let i = 0; i < 50 && source(); i++) await api.sleep(100);
  if (source()) throw new Error("等待停放超时；操作可能延迟完成。请先检查会话，再从 Agent 列表恢复终端。");
  if (!sameSpace() || !ready() || !live(terminal) || api.panes().some(item => item.terminal === terminal) || !selected().tabs.some(item => item.id === tab)) {
    throw new Error(`停放后 Space 或会话状态已变化。${detached}`);
  }
  const afterPark = (command, args) => { try { api.run(command, args); } catch (error) { throw new Error(`${String(error.message || error)}。${detached}`); } };
  const previousTabs = new Set(selected().tabs.map(item => item.id));
  if (destination) {
    let target = targetPane();
    if (!target) throw new Error(`目标标签页不可用。${detached}`);
    afterPark("tab.select", { id: destination });
    afterPark("pane.focus", { pane: target.pane });
    for (let i = 0; i < 50; i++) {
      const focus = api.focused();
      if (focus?.space === space && focus.tab === destination && focus.pane === target.pane) break;
      if (!sameSpace() || !ready() || !targetPane() || !live(terminal) || api.panes().some(item => item.terminal === terminal)) throw new Error(`选择目标时状态已变化。${detached}`);
      await api.sleep(100);
    }
    const focus = api.focused();
    target = targetPane();
    if (!sameSpace() || !ready() || !live(terminal) || !selected().tabs.some(item => item.id === tab) || api.panes().some(item => item.terminal === terminal) || !target || focus?.space !== space || focus.tab !== destination || focus.pane !== target.pane) throw new Error(`无法确认源标签页或目标分屏。${detached}`);
    afterPark("terminal.keep", { terminal, place: direction });
  } else {
    afterPark("terminal.keep", { terminal, place: "tab" });
  }
  const result = () => api.panes().find(item => item.terminal === terminal && selected()?.tabs.some(t => t.id === item.tab) && (destination ? item.tab === destination : item.tab !== tab && !previousTabs.has(item.tab)));
  for (let i = 0; i < 50 && sameSpace() && !result(); i++) await api.sleep(100);
  const moved = sameSpace() && result();
  if (!moved) throw new Error(`等待目标分屏超时或 Space 已变化；操作可能延迟完成。${detached}`);
  if (!destination) {
    try { api.run("tab.rename", { id: moved.tab, name }); } catch (error) { throw new Error(`终端已移至新标签页，但无法命名：${String(error.message || error)}。`); }
    for (let i = 0; i < 50 && sameSpace() && !selected().tabs.some(item => item.id === moved.tab && item.named && item.name === name); i++) await api.sleep(100);
    if (!sameSpace() || !selected().tabs.some(item => item.id === moved.tab && item.named && item.name === name)) throw new Error("终端已移至新标签页，但无法确认标签页名称；请检查并手动命名。");
  }
}
