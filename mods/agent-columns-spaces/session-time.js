export function sessionTime(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
  const date = new Date(timestamp), today = new Date(now);
  const day = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(today) - day(date)) / 86400000);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (days === 0) return `今天 ${time}`;
  if (days === 1) return `昨天 ${time}`;
  if (days > 1 && days < 7) {
    const weekday = "日一二三四五六"[date.getDay()];
    return `${days > (today.getDay() + 6) % 7 ? "上周" : "周"}${weekday} ${time}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export const staleSession = (timestamp, now = Date.now()) => Number.isFinite(timestamp) && timestamp > 0 && now - timestamp > 2 * 86400000;

export function projectActive(space, panes, states, raw, coreState, now) {
  return space.tabs.some(tab => {
    const members = panes.filter(pane => pane.tab === tab.id);
    const recent = timestamp => Number.isFinite(timestamp) && timestamp > 0 && now - timestamp <= 86400000;
    if (members.some(pane => {
      const status = states.get(pane.pane);
      return status === "working" || (["done", "idle"].includes(status) && recent(raw.get(pane.terminal)?.status_ms || coreState(pane.terminal)?.since || tab.changed_at));
    })) return true;
    return !members.some(pane => states.get(pane.pane)) && (tab.status === "working" || (recent(tab.changed_at) && (["done", "idle"].includes(tab.status) || members.some(pane => pane.program?.agent || pane.app))));
  });
}

export function toggleProjects(spaces, folded) {
  const collapse = spaces.some(space => !folded[space.id]);
  return { ...folded, ...Object.fromEntries(spaces.map(space => [space.id, collapse])) };
}
