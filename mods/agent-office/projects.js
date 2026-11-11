/** @param {any[]} groups @param {any[]} agents @param {(project:any)=>any} themeFor @param {Record<string, any>} targets */
export function projectRooms(groups, agents, themeFor, targets) {
  const byPane = new Map(agents.map(agent => [agent.pane, agent]));
  return groups.map(group => {
    const members = /** @type {any[]} */ (group.members ?? []);
    const employees = members.map(member => {
      const agent = byPane.get(member.pane);
      return agent ? { ...agent, space_name: group.name, worktree: member.worktree } : null;
    }).filter(Boolean);
    const remembered = targets[group.id];
    const target = members.find(member => member.pane === remembered?.pane) ?? members.find(member => byPane.get(member.pane)?.focused) ?? members[0] ?? group.target;
    return { id: group.id, projectKey: group.projectKey, duplicateOf: group.duplicateOf, name: group.name, folder: group.folder, machine: group.machine, members, agents: employees, target, theme: themeFor(group), active: false };
  });
}

export class ProjectSelection {
  constructor() {
    this.selected = "";
    this.lastFocus = "";
    this.lastRequest = 0;
    this.lastSpace = "";
    /** @type {Record<string, any>} */
    this.targets = {};
  }
  /** @param {any[]} rooms @param {any} focus @param {any} request */
  choose(rooms, focus, request) {
    if (focus?.space && focus.space !== this.lastSpace) {
      const changed = rooms.find(room => room.target?.space === focus.space || room.members.some((/** @type {any} */ member) => member.space === focus.space));
      if (changed) this.selected = changed.id;
      this.lastSpace = focus.space;
    }
    const room = rooms.find(room => room.members.some((/** @type {any} */ member) => member.pane === focus?.pane));
    if (room) {
      const member = room.members.find((/** @type {any} */ member) => member.pane === focus.pane);
      this.targets[room.id] = member;
      room.target = member;
      const key = `${room.id}:${focus.pane}`;
      if (key !== this.lastFocus) { this.selected = room.id; this.lastFocus = key; }
    }
    if (request?.token !== undefined && request.token !== this.lastRequest) {
      if (rooms.some(room => room.id === request.id)) this.selected = request.id;
      this.lastRequest = request.token;
    }
    const selected = rooms.find(room => room.id === this.selected) ?? rooms.find(room => room.members.some((/** @type {any} */ member) => member.space === focus?.space) || room.target?.space === focus?.space) ?? rooms[0];
    if (selected) { this.selected = selected.id; selected.active = true; }
    return selected;
  }
}

/** @returns {Record<string, any>} */
export function roomState() {
  return {
    desk: {}, at: {}, seen: {}, idleSince: {}, blockedSince: {}, finishes: [], party: null,
    leaving: {}, kids: {}, grads: {}, away: [], hovered: null, started: false,
    cat: { goal: "sit", desk: null, since: Date.now() }, tabOrder: [], doorUntil: 0,
  };
}
export const ROOM_STATE_KEYS = Object.keys(roomState());
