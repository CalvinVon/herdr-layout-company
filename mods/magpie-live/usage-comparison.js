const tokens = (row) => (row.input || 0) + (row.output || 0) + (row.cache_read || 0) + (row.cache_write || 0);
const cacheRate = (row) => {
  const prompt = (row.input || 0) + (row.cache_read || 0) + (row.cache_write || 0);
  return prompt ? 100 * (row.cache_read || 0) / prompt : null;
};

export function comparisonRange(usage) {
  const days = { '7d': 7, '30d': 30 }[usage?.period];
  if (!days || !/^\d{4}-\d{2}-\d{2}/.test(usage.since || '')) return null;
  const date = new Date(`${usage.since.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  const end = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() - days + 1);
  return `${date.toISOString().slice(0, 10)}..${end}`;
}

export function usageComparison(usage, baseline, coverageSince) {
  const range = comparisonRange(usage);
  if (!range || !baseline || baseline.period !== range || !coverageSince || Date.parse(coverageSince) > Date.parse(baseline.since)) return null;
  const current = usage, previous = baseline;
  const name = `前${usage.period === '7d' ? '7' : '30'}天`;
  const delta = (value, prior) => {
    if (!prior) return `${name}基准为0`;
    const change = Math.round((value - prior) / prior * 1000) / 10 || 0;
    return `较${name} ${change >= 0 ? '+' : ''}${change}%`;
  };
  const currentCache = cacheRate(current), previousCache = cacheRate(previous);
  const points = currentCache === null || previousCache === null ? '缓存命中率暂无对比' : Math.round((currentCache - previousCache) * 10) / 10 || 0;
  return {
    calls: delta(current.calls || 0, previous.calls || 0),
    tokens: delta(tokens(current), tokens(previous)),
    cost: current.unpriced || previous.unpriced ? '费用部分未计价' : delta(current.cost || 0, previous.cost || 0),
    cache: typeof points === 'number' ? `较${name} ${points >= 0 ? '+' : ''}${points} 个百分点` : points,
    note: '当前周期含今天未结束部分',
  };
}

export function usageChartData(usage, baseline, comparable, metric, now = new Date()) {
  const series = usage?.series ?? [];
  const completed = usage?.period === 'today' ? Math.max(0, Math.min(24, Math.floor((now.getTime() - Date.parse(usage.since)) / 3600000))) : series.length;
  const visible = usage?.period === 'today' ? series.slice(0, completed + 1) : series;
  const offset = Math.max(0, visible.length - 30);
  const value = (point) => metric === 'tokens' ? tokens(point) : Number(point[metric]) || 0;
  return visible.slice(offset).map((point, index) => {
    const previous = comparable && usage.period !== 'today' ? baseline?.series?.[index + offset] : null;
    return { label: point.label, current: value(point), previous: previous ? value(previous) : null, previousLabel: previous?.label, unpriced: metric === 'cost' && Boolean(point.unpriced || previous?.unpriced) };
  });
}
