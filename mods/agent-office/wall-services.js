export function extractService(text) {
  const lines = text.split(/\r?\n/);
  const urls = new Map();
  for (const line of lines) {
    if (/\bapp running at\s*:/i.test(line)) urls.clear();
    if (!/(?:local|network|app-index|listening|ready|running at|localhost|127\.0\.0\.1)/i.test(line)) continue;
    const label = line.match(/\b(local|network|app-index)\s*:/i)?.[1]?.toLowerCase();
    for (const match of line.matchAll(/https?:\/\/[^\s<>"'\x1b]+/g)) {
      const url = match[0].replace(/[),.;]+$/, '');
      urls.set(label ?? url, url);
    }
  }
  return urls.size ? { urls: [...new Set(urls.values())] } : null;
}


export function extractTerminalQR(text) {
  const candidates = text.split(/\r?\n/).map(line => {
    const row = [];
    for (const match of line.matchAll(/\x1b\[(40|47|48;5;0|48;5;7)m( +)/g)) {
      for (let i = 0; i < Math.floor(match[2].length / 2); i++) row.push(match[1] === '40' || match[1] === '48;5;0');
    }
    return row;
  });
  for (let start = 0; start < candidates.length; start++) {
    const width = candidates[start].length;
    if (width < 21) continue;
    const rows = [];
    for (let i = start; i < candidates.length && candidates[i].length === width; i++) rows.push(candidates[i]);
    while (rows.length && rows[0].every(cell => !cell)) rows.shift();
    while (rows.length && rows[rows.length - 1].every(cell => !cell)) rows.pop();
    if (!rows.length) continue;
    let left = 0, right = width;
    while (left < right && rows.every(row => !row[left])) left++;
    while (right > left && rows.every(row => !row[right - 1])) right--;
    const matrix = rows.map(row => row.slice(left, right));
    const size = matrix.length;
    if (size < 21 || size > 177 || (size - 21) % 4 || matrix.some(row => row.length !== size)) continue;
    const finder = (y, x) => Array.from({ length: 7 }, (_, dy) => Array.from({ length: 7 }, (_, dx) => {
      const edge = dy === 0 || dy === 6 || dx === 0 || dx === 6;
      const centre = dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4;
      return matrix[y + dy][x + dx] === (edge || centre);
    }).every(Boolean)).every(Boolean);
    if (finder(0, 0) && finder(0, size - 7) && finder(size - 7, 0)) return matrix;
  }
  const lines = text.split(/\r?\n/).map(line => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r/g, ""));
  for (let start = 0; start < lines.length; start++) {
    if (!/^[ ▀▄█]+$/.test(lines[start]) || !/[▀▄█]/.test(lines[start]) || lines[start].length < 21) continue;
    const width = lines[start].length, expanded = [];
    for (let i = start; i < lines.length && lines[i].length === width && /^[ ▀▄█]+$/.test(lines[i]); i++) {
      expanded.push([...lines[i]].map(ch => ch === " " || ch === "▄"));
      expanded.push([...lines[i]].map(ch => ch === " " || ch === "▀"));
    }
    const finder = (y, x) => {
      if (y + 7 > expanded.length || x + 7 > width) return false;
      for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
        const dark = dy === 0 || dy === 6 || dx === 0 || dx === 6 || (dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4);
        if (expanded[y + dy][x + dx] !== dark) return false;
      }
      return true;
    };
    for (let y = 0; y + 21 <= expanded.length; y++) for (let x = 0; x + 21 <= width; x++) {
      if (!finder(y, x)) continue;
      for (let size = 21; size <= 177 && y + size <= expanded.length && x + size <= width; size += 4) {
        if (finder(y, x + size - 7) && finder(y + size - 7, x)) return expanded.slice(y, y + size).map(row => row.slice(x, x + size));
      }
    }
  }
  return null;
}

export function reconcileService(previous, observation) {
  if (!previous) return observation;
  if (observation.stopped) return { ...previous, status: 'stopped' };
  if (!observation.complete || !observation.signature || observation.signature !== previous.signature) {
    return { ...previous, status: 'unknown' };
  }
  return { ...previous, ...observation, status: 'running' };
}

export function serviceForeground(terminal) {
  const foreground = terminal?.foreground;
  if (!foreground || /^(?:zsh|bash|sh|fish|nu)$/i.test(foreground.name ?? '')) return null;
  const command = (foreground.argv ?? []).join(' ');
  if (!/(?:serve|server|dev|start|listen|run|\.jar\b)/i.test(command)) return null;
  const name = command.match(/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?[\w:.-]+/)?.[0] ?? foreground.name ?? '服务';
  return { signature: JSON.stringify([foreground.pid, foreground.name, foreground.argv]), name };
}

export function activeSessionGoal(groups, agents, focus) {
  if (!focus) return null;
  const target = focus.shown || focus.terminal || focus.agent;
  let agent = agents.find(item => item.address === target || (focus.pane && item.pane === focus.pane));
  if (!agent && focus.tab) {
    const matches = agents.filter(item => item.tab === focus.tab);
    if (matches.length === 1) agent = matches[0];
  }
  if (!agent || !agent.address || !String(agent.title ?? '').trim()) return null;
  const room = groups.find(group => !group.machine && group.projectKey && group.members?.some(member => member.terminal === agent.address || member.pane === agent.pane));
  if (!room) return null;
  const title = String(agent.title).replace(/^\s*π\s*[\u2800-\u28ff>•…]?\s*/u, '').trim();
  if (!title) return null;
  return { roomKey: room.projectKey, card: { id: `goal:${agent.address}`, kind: 'goal', name: '当前会话目标', text: title, source: '会话标题', pane: agent.pane } };
}
export function orderWallCards(cards) {
  return [...cards].sort((a, b) => (a.kind === 'goal' ? 0 : 1) - (b.kind === 'goal' ? 0 : 1));
}
export function todoAnchor(tasks) {
  const next = tasks.findIndex(task => task.status !== 'done');
  if (next < 0) return Math.max(0, tasks.length - 1);
  for (let index = next - 1; index >= 0; index--) if (tasks[index].status === 'done') return index;
  return next;
}


export function parseWallPins(text) {
  const data = text === null ? { version: 1, rooms: {} } : JSON.parse(text);
  if (data?.version !== 1 || !data.rooms || typeof data.rooms !== 'object' || Array.isArray(data.rooms)) throw new Error('固定链接格式无效');
  for (const cards of Object.values(data.rooms)) {
    if (!Array.isArray(cards) || cards.some(card => !card || typeof card.id !== 'string' || !card.id || typeof card.name !== 'string' || typeof card.url !== 'string' || (card.qr !== undefined && (!Array.isArray(card.qr) || card.qr.length < 21 || card.qr.length > 177 || card.qr.some(row => !Array.isArray(row) || row.length !== card.qr.length || row.some(value => typeof value !== 'boolean')))) || (card.kind === 'note' && (card.url !== '' || typeof card.text !== 'string' || !card.text.trim())) || (card.kind === 'file' && (card.url !== '' || typeof card.path !== 'string' || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(card.path)))) || new Set(cards.map(card => card.id)).size !== cards.length) throw new Error('固定链接内容无效');
  }
  return data.rooms;
}