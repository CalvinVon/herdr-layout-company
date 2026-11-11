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
