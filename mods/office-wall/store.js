export function updatePins(items, action) {
  if (action.type === "remove") return items.filter(item => item.id !== action.id);
  if (action.type !== "save") throw new Error("未知的固定操作");
  const index = items.findIndex(item => item.id === action.card.id);
  if (index < 0) return [...items, action.card];
  return items.map((item, i) => i === index ? action.card : item);
}

export function validMatrix(qr) {
  return Array.isArray(qr) && qr.length >= 21 && qr.length <= 177 && qr.every(row => Array.isArray(row) && row.length === qr.length && row.every(value => typeof value === "boolean"));
}

export function parsePins(text) {
  if (text === null) return { version: 1, rooms: {} };
  const data = JSON.parse(text);
  if (!data || data.version !== 1 || !data.rooms || typeof data.rooms !== "object" || Array.isArray(data.rooms)) throw new Error("固定链接文件格式无效");
  for (const items of Object.values(data.rooms)) {
    if (!Array.isArray(items) || items.some(card => !card || typeof card.id !== "string" || !card.id || typeof card.name !== "string" || typeof card.url !== "string" || (card.qr !== undefined && !validMatrix(card.qr)) || (card.kind === "note" && (card.url !== "" || typeof card.text !== "string" || !card.text.trim())) || (card.kind === "file" && (card.url !== "" || typeof card.path !== "string" || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(card.path)))) || new Set(items.map(card => card.id)).size !== items.length) throw new Error("固定链接文件内容无效");
  }
  return data;
}
