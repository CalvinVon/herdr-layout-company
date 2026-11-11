/** @param {import('herdr').SpaceInfo} space @param {import('herdr').PaneInfo[]} panes */
export function homeTab(space, panes) {
  return space.tabs.find(tab => {
    const members = panes.filter(pane => pane.tab === tab.id);
    return members.length > 0 && members.every(pane => pane.mod === "space-home");
  });
}

/** @param {import('herdr').SpaceInfo} space @param {import('herdr').PaneInfo[]} panes */
export function sessionTabs(space, panes) {
  const home = homeTab(space, panes);
  return space.tabs.filter(tab => tab.id !== home?.id);
}

/** @param {import('herdr').SpaceInfo} space @param {Pick<import('../agent-columns-spaces/project-bindings.js').LaunchApi, 'spaces'|'panes'|'run'|'sleep'>} api */
export async function retainSpace(space, api) {
  const existing = homeTab(space, api.panes());
  if (existing) return existing;
  const previousSpace = api.spaces().find(item => item.active);
  const previousTab = previousSpace?.tabs.find(tab => tab.active);
  const previousPane = api.panes().find(pane => pane.focused);
  const targetTab = space.tabs.find(tab => tab.active);
  api.run("tab.new", { space: space.id, name: "Space 首页", mod: "space-home", props: { space: space.id } });
  let created;
  for (let attempt = 0; attempt < 50; attempt++) {
    const current = api.spaces().find(item => item.id === space.id);
    if (!current) return;
    created = homeTab(current, api.panes());
    if (created) break;
    await api.sleep(100);
  }
  if (!created) throw new Error("尚未确认 Space 首页，请稍后重试；已有终端保持运行。");
  const selected = api.spaces().find(item => item.active);
  const selectedTab = selected?.tabs.find(tab => tab.active);
  if (selectedTab?.id === created.id || (selected?.id === previousSpace?.id && selectedTab?.id === previousTab?.id)) {
    if (targetTab && api.spaces().some(item => item.tabs.some(tab => tab.id === targetTab.id))) api.run("tab.select", { id: targetTab.id });
    if (previousSpace && api.spaces().some(item => item.id === previousSpace.id)) api.run("space.select", { id: previousSpace.id });
    if (previousTab && api.spaces().some(item => item.tabs.some(tab => tab.id === previousTab.id))) api.run("tab.select", { id: previousTab.id });
    if (previousPane && api.panes().some(pane => pane.pane === previousPane.pane)) api.run("pane.focus", { pane: previousPane.pane });
  }
  return created;
}
