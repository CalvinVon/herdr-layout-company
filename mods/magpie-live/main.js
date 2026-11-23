import { View, div, svg, image, PathBuilder } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { home, appHome, readTextFile, theme, nextCommand, exec, focused, terminals, agents, layout, props, shared, setShared } from "herdr";
import { comparisonRange, usageComparison, usageChartData, usageChartPeriod } from "./usage-comparison.js";

const BASE = "http://127.0.0.1:3425";
const PREFERENCES = "magpie-live.preferences";
const preferences = {
  getItem(key) {
    const values = shared(PREFERENCES) ?? {};
    if (Object.hasOwn(values, key)) return values[key];
    const value = localStorage.getItem(key);
    if (!props()?.overlay) setShared(PREFERENCES, { ...values, [key]: value });
    return value;
  },
  setItem(key, value) {
    localStorage.setItem(key, value);
    setShared(PREFERENCES, { ...(shared(PREFERENCES) ?? {}), [key]: value });
  },
  snapshot: () => JSON.stringify(shared(PREFERENCES) ?? {}),
};
const PERIODS = [["today", "今天"], ["7d", "7天"], ["30d", "30天"], ["all", "全部"]];
const CHART_METRICS = [["calls", "请求"], ["tokens", "Token"], ["cost", "费用"]];
const ICONS = { codex: "codex-color.svg", omp: "omp.svg", magpie: "magpie.svg", deepseek: "deepseek-color.svg", grok: "grok.svg", kimi: "kimi.svg", zcode: "zcode.png", "workbuddy-ai": "workbuddy-color.svg", "opencode-zen-free": "opencode.svg" };
const card = (t) => v_flex().gap(7).p(10).rounded(8).bg(t.raised).border(1).border_color(t.border);
const text = (value, color, size = 12) => div().text_size(size).text_color(color).child(String(value ?? ""));
const shortAccount = (value) => {
  if (!value) return "账号";
  const at = value.indexOf("@");
  return at < 0 ? `${value.slice(0, 2)}•••` : `${value.slice(0, 2)}•••${value.slice(at)}`;
};
const percent = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
};
const periodPath = (base, period) => `${base}/v1/magpie/usage?period=${period}`;
const countTokens = (value) => value >= 1000000 ? `${(value / 1000000).toFixed(1)}M` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);

async function terminalSession(terminal) {
  const pid = terminal?.foreground?.pid;
  if (!pid || terminal.address.includes("/")) return null;
  try {
    const result = await exec("node", [`${appHome()}/mods/magpie-live/terminal-session.cjs`, String(pid), terminal.foreground?.cwd || "", terminal.report?.msg || ""]);
    const id = result.stdout.trim();
    if (/^[0-9a-f-]{36}$/i.test(id)) return id;
    if (terminal.report?.app === "pi" && terminal.report.msg && terminal.foreground?.cwd) {
      const match = await exec("node", [`${appHome()}/mods/magpie-live/pi-session.cjs`, terminal.foreground.cwd, terminal.report.msg]);
      const id = match.stdout.trim();
      if (/^[0-9a-f-]{36}$/i.test(id)) return id;
    }
  } catch { /* The terminal may not expose a session file. */ }
  return null;
}
const quotaPace = ({ remaining, start, reset }, now = Date.now()) => remaining !== null && start <= now && now < reset && reset > start ? Math.round(remaining - 100 * (reset - now) / (reset - start)) : null;
const appendBar = (path, x, y, width, height) => {
  if (width <= 0 || height <= 0) return false;
  const r = Math.min(1, width / 2, height / 2), c = r * 0.5522847498;
  const right = x + width, bottom = y + height;
  path.move_to(x + r, y).line_to(right - r, y)
    .cubic_bezier_to(right, y + r, right - r + c, y, right, y + r - c)
    .line_to(right, bottom - r).cubic_bezier_to(right - r, bottom, right, bottom - r + c, right - r + c, bottom)
    .line_to(x + r, bottom).cubic_bezier_to(x, bottom - r, x + r - c, bottom, x, bottom - r + c)
    .line_to(x, y + r).cubic_bezier_to(x + r, y, x, y + r - c, x + r - c, y).close();
  return true;
};

class ReadStatus extends View {
  init(props) { this.update(props); }
  update(props) { this.readAt = props.readAt; }
  render() {
    return text(this.readAt ? `上次成功读取 · ${new Date(this.readAt).toLocaleTimeString()}` : "等待首次读取", theme().dim, 9);
  }
}

class RouteDots extends View {
  init(props) { this.update(props); }
  update(props) { this.state = props; }
  render() {
    const { paths = [], start = 0, now = 0, width = 0, height = 0 } = this.state || {};
    return div().id("route-dot-layer").absolute().left(0).top(0).w(width).h(height).children(paths.map((path, i) => {
      const cycle = ((now - start + i * 350) % 4800) / 2400;
      const progress = cycle <= 1 ? cycle : 2 - cycle;
      const first = progress < 0.45, last = progress > 0.55;
      const part = first ? progress / 0.45 : last ? (progress - 0.55) / 0.45 : (progress - 0.45) / 0.1;
      const x1 = first ? path.fromX : path.middle, x2 = last ? path.toX : path.middle;
      const y1 = first ? path.fromY : path.midLeftY, y2 = last ? path.toY : first ? path.midLeftY : path.midRightY;
      const inverse = 1 - part;
      const x = x1 + (x2 - x1) * (3 * inverse * inverse * part * 0.45 + 3 * inverse * part * part * 0.65 + part * part * part);
      const y = y1 + (y2 - y1) * part * part * (3 - 2 * part);
      const size = path.current ? 9 : 7;
      return div().id(path.id).absolute().left(x - size / 2).top(y - size / 2).size(size).rounded_full().bg(path.color).opacity(path.dimmed ? 0.35 : 1)
        .transition("left", { duration: 160, easing: "linear" }).transition("top", { duration: 160, easing: "linear" });
    }));
  }
}

export default class MagpieLive extends View {
  readPreferences() {
    this.page = ["routing", "usage"].includes(preferences.getItem("magpie-live.page")) ? preferences.getItem("magpie-live.page") : "routing";
    this.period = PERIODS.some(([id]) => id === preferences.getItem("magpie-live.period"))
      ? preferences.getItem("magpie-live.period") : "today";
    this.chartMetric = CHART_METRICS.some(([id]) => id === preferences.getItem("magpie-live.chart-metric")) ? preferences.getItem("magpie-live.chart-metric") : "calls";
    this.chartGranularity = ["hour", "day"].includes(preferences.getItem("magpie-live.chart-granularity")) ? preferences.getItem("magpie-live.chart-granularity") : this.period === "today" ? "hour" : "day";
    this.maskAccounts = preferences.getItem("magpie-live.mask") !== "false";
    this.showRemaining = preferences.getItem("magpie-live.remaining") !== "false";
    try { this.providerOrder = JSON.parse(preferences.getItem("magpie-live.provider-order") || "[]"); } catch { this.providerOrder = []; }
    if (!Array.isArray(this.providerOrder)) this.providerOrder = [];
    try { this.hiddenQuotas = JSON.parse(preferences.getItem("magpie-live.hidden-quotas") || "[]"); } catch { this.hiddenQuotas = []; }
    if (!Array.isArray(this.hiddenQuotas)) this.hiddenQuotas = [];
    try { this.overviewOrder = JSON.parse(preferences.getItem("magpie-live.overview-order") || "[]"); } catch { this.overviewOrder = []; }
    if (!Array.isArray(this.overviewOrder)) this.overviewOrder = [];
    try { this.hiddenSections = JSON.parse(preferences.getItem("magpie-live.hidden-sections") || "[]"); } catch { this.hiddenSections = []; }
    if (!Array.isArray(this.hiddenSections)) this.hiddenSections = [];
    try { this.pinnedSections = JSON.parse(preferences.getItem("magpie-live.pinned-sections") || "[]"); } catch { this.pinnedSections = []; }
    if (!Array.isArray(this.pinnedSections)) this.pinnedSections = [];
    try { this.hiddenProviders = JSON.parse(preferences.getItem("magpie-live.hidden-providers") || "[]"); } catch { this.hiddenProviders = []; }
    if (!Array.isArray(this.hiddenProviders)) this.hiddenProviders = [];
    this.preferenceSnapshot = preferences.snapshot();
  }

  syncPreferences() {
    if (this.preferenceSnapshot === preferences.snapshot()) return false;
    const period = this.period, granularity = this.chartGranularity, page = this.page;
    this.readPreferences();
    if (period !== this.period || granularity !== this.chartGranularity) {
      this.usage = null;
      this.chartUsage = null;
      this.comparison = null;
      this.refreshDeferred = true;
    }
    if (page !== this.page) this.refreshDeferred = true;
    return true;
  }

  init(_props, cx) {
    this.readPreferences();
    this.chartUsage = null;
    this.chartError = "";
    this.editQuotas = false;
    this.base = BASE;
    this.usage = null;
    this.comparison = null;
    this.comparisonCache = null;
    this.quotas = null;
    this.history = [];
    this.historyAt = 0;
    this.width = 500;
    this.height = 600;
    this.pinnedHeight = 0;
    this.active = [];
    this.routes = {};
    this.recent = [];
    this.groupNames = {};
    this.recentReading = false;
    this.recentError = "";
    this.selectedRoute = null;
    this.focusTerminal = null;
    this.focusSession = null;
    this.sessionTerminals = {};
    this.ownerLookups = new Map();
    this.sessionColors = new Map();
    this.error = "";
    this.readAt = null;
    this.reading = false;
    this.readStatus = cx.new(ReadStatus, { readAt: null });
    this.routePaths = new Map();
    this.barWidths = new Map();
    this.barPaths = new Map();
    this.motionStart = Date.now();
    this.motionPaths = [];
    this.motionHasPaths = false;
    this.motionView = cx.new(RouteDots, { paths: [], start: this.motionStart });
    const visible = () => { const panel = layout()?.children?.find((node) => node.id === "magpie-panel"); return Boolean(props()?.overlay) || (Boolean(panel) && !panel.hidden); };
    cx.timer.every(160, () => {
      if (this.page !== "routing" || this.hiddenSections.includes("graph") || (!this.motionPaths.length && !this.motionHasPaths)) return;
      if (!visible() || !globalThis.window.is_window_active()) return;
      this.motionView.set_props({ paths: this.motionPaths, start: this.motionStart, now: Date.now(), width: this.motionWidth, height: this.motionHeight });
      this.motionHasPaths = this.motionPaths.length > 0;
    });
    cx.timer.every(5000, (next) => {
      if (visible() && globalThis.window.is_window_active()) this.refresh(next);
      else this.refreshDeferred = true;
    });
    cx.timer.every(1000, (next) => {
      if (this.syncPreferences()) next.notify();
      if (this.refreshDeferred && visible() && globalThis.window.is_window_active()) {
        this.refreshDeferred = false;
        this.refresh(next);
      }
    });
    if (visible()) this.refresh(cx);
    cx.spawn(async (next) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "routing" || command === "usage") this.setPage(command, next);
        else if (PERIODS.some(([id]) => id === command)) this.setPeriod(command, next);
        else if (command === "chart-hour" || command === "chart-day") this.setChartGranularity(command === "chart-hour" ? "hour" : "day", next);
        else if (command === "refresh") { this.historyAt = 0; this.refresh(next); }
        else if (command === "mask") { this.maskAccounts = !this.maskAccounts; preferences.setItem("magpie-live.mask", String(this.maskAccounts)); }
        else if (command === "remaining") { this.showRemaining = !this.showRemaining; preferences.setItem("magpie-live.remaining", String(this.showRemaining)); }
        next.notify();
      }
    });
  }

  notifyData(cx) {
    const signature = JSON.stringify([
      this.page, this.base, this.error, Boolean(this.readAt), this.usage, this.quotas, this.history,
      this.chartUsage, this.chartError, this.comparison, this.comparisonCache?.baseline,
      this.chartUsage?.period === "today" ? Math.floor((Date.now() - Date.parse(this.chartUsage.since)) / 3600000) : null,
      this.page === "routing" && !this.editQuotas && !this.hiddenSections.includes("quotas")
        ? [...this.quotaData().byProvider.entries()].filter(([provider]) => !this.hiddenProviders.includes(provider))
          .flatMap(([, entries]) => entries.filter((entry) => entry.window && !this.hiddenQuotas.includes(entry.key)).map((entry) => quotaPace(entry))) : null,
      this.page === "routing" ? [this.active, this.routes, this.recent, this.recentError, this.groupNames, this.focusTerminal, this.focusSession, this.sessionTerminals] : null,
    ]);
    if (signature !== this.dataSignature) {
      this.dataSignature = signature;
      cx.notify();
    }
  }

  async sessionFor(terminal) {
    const pid = terminal?.foreground?.pid;
    if (!pid || terminal.address.includes("/")) return null;
    const key = JSON.stringify([terminal.created_ms, terminal.pid, pid, terminal.foreground.cwd, terminal.report?.app, terminal.report?.msg]);
    const cached = this.ownerLookups.get(terminal.address);
    if (cached?.key === key && Date.now() - cached.at < 15000) return cached.id;
    const id = await terminalSession(terminal);
    if (id) this.ownerLookups.set(terminal.address, { key, id, at: Date.now() });
    else this.ownerLookups.delete(terminal.address);
    return id;
  }

  refresh(cx) {
    if (this.reading) return;
    this.reading = true;
    const period = this.period, granularity = this.chartGranularity, page = this.page;
    const routing = page === "routing";
    const chartPeriod = usageChartPeriod(period, granularity);
    cx.spawn(async (next) => {
      try {
        if (!this.configDir) {
          const env = await exec("/usr/bin/printenv", ["XDG_CONFIG_HOME"]);
          this.configDir = `${env.stdout.trim() || `${home()}/.config`}/magpie`;
        }
        const configDir = this.configDir;
        const settingsText = await readTextFile(`${configDir}/settings.json`);
        const providersText = await readTextFile(`${configDir}/providers.json`);
        if (settingsText !== this.settingsText || providersText !== this.providersText) {
          this.settingsText = settingsText;
          this.providersText = providersText;
          const groups = providersText ? (JSON.parse(providersText).groups ?? []) : [];
          this.groupNames = Object.fromEntries(groups.map((group) => [group.id, group.name || group.id]));
        }
        const port = Number(settingsText ? (JSON.parse(settingsText).port ?? 3425) : 3425);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Magpie 网关端口无效");
        this.base = `http://127.0.0.1:${port}`;
        const focus = routing ? focused() : null;
        const focusTerminal = focus?.shown || focus?.terminal || focus?.agent;
        const terminal = routing ? terminals().find((item) => item.address === focusTerminal) : null;
        this.focusSession = null;
        this.focusTerminal = focusTerminal;
        this.focusSession = await this.sessionFor(terminal);
        if (routing && !this.recentReading) {
          this.recentReading = true;
          next.spawn(async (update) => {
            let changed = false;
            try {
              let response = await fetch(`${this.base}/v1/magpie/usage/requests?period=today&limit=24`);
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              let rows = (await response.json()).rows ?? [];
              if (rows.length < 24) {
                response = await fetch(`${this.base}/v1/magpie/usage/requests?period=all&limit=24`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                rows = (await response.json()).rows ?? [];
              }
              changed = JSON.stringify(rows) !== JSON.stringify(this.recent) || Boolean(this.recentError);
              this.recent = rows;
              this.recentError = "";
            } catch (error) {
              const message = error instanceof Error ? error.message : "请求记录暂不可用";
              changed = message !== this.recentError;
              this.recentError = message;
            } finally {
              this.recentReading = false;
              if (changed && this.page === "routing") this.notifyData(update);
            }
          });
        }
        const readHistory = async () => {
          if (Date.now() - this.historyAt < 60000) return null;
          this.historyAt = Date.now();
          try {
            const response = await fetch(`${this.base}/v1/magpie/quotas/history?days=30`);
            return response.ok ? response.json() : null;
          } catch { return null; }
        };
        const [usageRes, quotaRes, activeRes, history, chartRes] = await Promise.all([
          fetch(periodPath(this.base, period)),
          fetch(`${this.base}/v1/magpie/quotas`),
          routing ? fetch(`${this.base}/v1/magpie/concurrency`) : null,
          readHistory(),
          chartPeriod === period ? null : fetch(periodPath(this.base, chartPeriod)).catch(() => null),
        ]);
        for (const response of [usageRes, quotaRes, activeRes].filter(Boolean)) {
          if (!response.ok) throw new Error(`Magpie HTTP ${response.status}`);
        }
        const [usage, quota, active] = await Promise.all([
          usageRes.json(), quotaRes.json(), activeRes ? activeRes.json() : { active: [] },
        ]);
        const chartUsage = chartPeriod === period ? usage : chartRes?.ok ? await chartRes.json().catch(() => null) : null;
        const range = comparisonRange(usage);
        if (range && period === this.period) {
          const key = `${this.base}|${range}`;
          if (!this.comparisonCache || this.comparisonCache.key !== key || Date.now() - this.comparisonCache.at >= 60000) {
            try {
              const [previous, coverage] = await Promise.all([fetch(periodPath(this.base, range)), fetch(periodPath(this.base, "all"))]);
              if (!previous.ok || !coverage.ok) throw new Error("用量对比数据不可用");
              const [baseline, all] = await Promise.all([previous.json(), coverage.json()]);
              this.comparisonCache = { key, at: Date.now(), baseline, since: all.since };
            } catch { this.comparisonCache = null; }
          }
        }
        const sessions = [...new Set((active.active ?? []).map((request) => request.session).filter(Boolean))];
        const liveAgents = new Set((routing ? agents() : []).filter(agent => agent.status === "working").map(agent => agent.address));
        const owners = await Promise.all((sessions.length ? terminals() : []).filter(item => liveAgents.has(item.address) && item.foreground?.pid && !item.address.includes("/")).map(async item => {
          const id = item.address === focusTerminal ? this.focusSession : await this.sessionFor(item);
          return [id, item.address];
        }));
        const retained = new Set([focusTerminal, ...owners.map(([, address]) => address)]);
        this.ownerLookups = new Map([...this.ownerLookups].filter(([address]) => retained.has(address)));
        this.sessionTerminals = {};
        for (const [id, address] of owners) if (id && sessions.includes(id)) (this.sessionTerminals[id] ??= []).push(address);
        if (this.focusSession && focusTerminal && sessions.includes(this.focusSession)) {
          const addresses = this.sessionTerminals[this.focusSession] ??= [];
          if (!addresses.includes(focusTerminal)) addresses.push(focusTerminal);
        }
        const routeEntries = await Promise.all(sessions.map(async (session) => {
          try {
            const response = await fetch(`${this.base}/v1/magpie/route?session=${encodeURIComponent(session)}`);
            if (!response.ok) return [session, null];
            return [session, (await response.json()).route ?? null];
          } catch { return [session, null]; }
        }));
        if (page === this.page) this.routes = Object.fromEntries(routeEntries.filter(([, route]) => route));
        if (period === this.period) {
          this.usage = usage;
          this.comparison = range && this.comparisonCache?.key === `${this.base}|${range}`
            ? usageComparison(usage, this.comparisonCache.baseline, this.comparisonCache.since) : null;
        }
        if (period === this.period && granularity === this.chartGranularity) {
          this.chartUsage = chartUsage?.period === chartPeriod ? chartUsage : null;
          this.chartError = this.chartUsage ? "" : "走势数据暂不可用";
        }
        this.quotas = quota.data ?? [];
        if (page === this.page) this.active = active.active ?? [];
        if (!this.active.length) this.motionView.set_props({ paths: [], start: this.motionStart });
        this.history = history?.data ?? this.history;
        this.error = "";
        this.readAt = Date.now();
        if (this.page === "usage") this.readStatus.set_props({ readAt: this.readAt });
      } catch (error) {
        if (page === this.page) this.error = error instanceof Error ? error.message : "Magpie 暂不可用";
      } finally {
        this.reading = false;
        this.notifyData(next);
        if (period !== this.period || granularity !== this.chartGranularity || page !== this.page) this.refresh(next);
      }
    });
  }

  setPage(page, cx) {
    if (page === this.page) return;
    this.page = page;
    preferences.setItem("magpie-live.page", page);
    if (page === "usage") this.readStatus.set_props({ readAt: this.readAt });
    this.refresh(cx);
    cx.notify();
  }

  setPeriod(period, cx) {
    if (period === this.period) return;
    this.period = period;
    preferences.setItem("magpie-live.period", period);
    this.usage = null;
    this.chartUsage = null;
    this.chartError = "";
    this.comparison = null;
    this.refresh(cx);
    cx.notify();
  }

  setChartGranularity(granularity, cx) {
    if (this.chartGranularity === granularity) return;
    this.chartGranularity = granularity;
    this.chartUsage = null;
    this.chartError = "";
    preferences.setItem("magpie-live.chart-granularity", granularity);
    this.refresh(cx);
    cx.notify();
  }



  quotaData() {
    if (this.quotaDerived?.quotas === this.quotas && this.quotaDerived?.history === this.history) return this.quotaDerived;
    const histories = new Map(), byProvider = new Map(), byQuota = new Map();
    for (const row of this.history) {
      if (!histories.has(row.provider)) histories.set(row.provider, new Map());
      const users = histories.get(row.provider);
      if (users.has(row.user)) continue;
      const lines = new Map();
      for (const line of row.lines ?? []) if (!lines.has(line.name)) lines.set(line.name, line.points ?? []);
      users.set(row.user, lines);
    }
    for (const quota of this.quotas ?? []) {
      const lines = histories.get(quota.provider)?.get(quota.user);
      const entries = (quota.windows?.length ? quota.windows : [null]).map((window) => {
        const used = percent(window?.used), remaining = percent(window?.remaining) ?? (used === null ? null : 100 - used);
        const reset = Date.parse(window?.resetsAt), points = lines?.get(window?.name) ?? [];
        let start = NaN;
        for (let i = points.length - 1; i >= 0; i--) {
          if (Math.abs(Date.parse(points[i].resetsAt) - reset) < 120000 && points[i].start) { start = Date.parse(points[i].start); break; }
        }
        return { quota, window, key: JSON.stringify([quota.provider, quota.user || "", window?.name ?? null]), remaining, reset, start, points };
      });
      if (!byProvider.has(quota.provider)) byProvider.set(quota.provider, []);
      byProvider.get(quota.provider).push(...entries);
      byQuota.set(quota, entries);
    }
    this.quotaDerived = { quotas: this.quotas, history: this.history, byProvider, byQuota };
    const chartIds = new Set(["usage-chart-bars"]);
    (this.quotas ?? []).forEach((quota, i) => (quota.windows ?? []).forEach((_window, wi) => chartIds.add(`quota-trend-${i}-${wi}`)));
    for (const key of this.barPaths.keys()) if (!chartIds.has(key)) this.barPaths.delete(key);
    for (const key of this.barWidths.keys()) if (!chartIds.has(key)) this.barWidths.delete(key);
    return this.quotaDerived;
  }

  chartBars(id, bars, height, t) {
    const width = this.barWidths.get(id) ?? 0;
    let geometry = this.barPaths.get(id);
    if (!geometry || geometry.bars !== bars || geometry.width !== width || geometry.height !== height) {
      const current = PathBuilder.fill(), previous = PathBuilder.fill();
      let currentCount = 0, previousCount = 0;
      const groupWidth = bars.length ? Math.max(0, (width - (bars.length - 1)) / bars.length) : 0;
      bars.forEach((bar, i) => {
        const paired = bar.previousHeight !== null;
        const barWidth = paired ? Math.max(0, (groupWidth - 1) / 2) : groupWidth;
        const x = i * (groupWidth + 1);
        if (paired) previousCount += Number(appendBar(previous, x, height - bar.previousHeight, barWidth, bar.previousHeight));
        currentCount += Number(appendBar(current, x + (paired ? barWidth + 1 : 0), height - bar.currentHeight, barWidth, bar.currentHeight));
      });
      geometry = { bars, width, height, current: currentCount ? current.build() : null, previous: previousCount ? previous.build() : null };
      this.barPaths.set(id, geometry);
    }
    return h_flex().id(id).relative().w_full().h(height).gap(1).items_end()
      .on_size_change((size, cx) => { if (this.barWidths.get(id) !== size.width) { this.barWidths.set(id, size.width); cx.notify(); } })
      .when(Boolean(geometry.previous), row => row.child(globalThis.window.paint_path(geometry.previous, t.muted).absolute().left(0).top(0).w(width).h(height).opacity(0.45)))
      .when(Boolean(geometry.current), row => row.child(globalThis.window.paint_path(geometry.current, t.accent).absolute().left(0).top(0).w(width).h(height)))
      .children(bars.filter((bar) => bar.description !== undefined).map((bar) => div().flex_1().min_w(0).h_full().tooltip(bar.description)));
  }

  quotaCards(t) {
    const data = this.quotaData();
    return (this.quotas ?? []).map((quota, i) => {
      const windows = quota.windows ?? [];
      return card(t).id(`quota-${i}`)
        .child(h_flex().justify_between().items_center()
          .child(text(quota.name || quota.provider, t.foreground, 12))
          .child(text(quota.plan || quota.kind || "额度", t.dim, 10)))
        .when(Boolean(quota.user), row => row.child(text(this.maskAccounts ? shortAccount(quota.user) : quota.user, t.muted, 10)))
        .when(quota.balance !== undefined && quota.balance !== null, row => row.child(text(`余额 ${quota.balance}`, t.foreground, 17).font_semibold()))
        .children(windows.map((window, wi) => {
          const reportedRemaining = percent(window.remaining), reportedUsed = percent(window.used);
          const remaining = reportedRemaining ?? (reportedUsed === null ? null : 100 - reportedUsed);
          const used = reportedUsed ?? (remaining === null ? null : 100 - remaining);
          const shown = this.showRemaining ? remaining : used;
          const reset = window.resetsAt ? new Date(window.resetsAt).toLocaleString() : "";
          const entry = data.byQuota.get(quota)[wi];
          if (!entry.trend || entry.trendRemaining !== this.showRemaining) {
            entry.trendRemaining = this.showRemaining;
            entry.trend = entry.points.slice(-24).map((point) => {
              const left = percent(point.left), value = left === null ? 0 : this.showRemaining ? left : 100 - left;
              return { currentHeight: 20 * value / 100, previousHeight: null };
            });
          }
          const points = entry.trend;
          const barWidth = Math.max(0, this.width - 36);
          return v_flex().id(`quota-window-${i}-${wi}`).gap(4)
            .child(h_flex().justify_between()
              .child(text(window.name || "额度", t.muted, 10))
              .child(text(shown === null ? "数据不足" : `${this.showRemaining ? "剩余" : "已用"} ${shown.toFixed(1)}%`, t.muted, 10)))
            .child(div().w_full().h(4).relative().rounded(2).bg(t.border)
              .child(div().absolute().left(0).top(0).bottom(0).w(barWidth * (shown ?? 0) / 100).rounded(2).bg(remaining !== null && remaining < 10 ? t.blocked : t.accent)))
            .when(points.length > 1, row => row.child(text("最近 24 次额度读数", t.dim, 9)).child(this.chartBars(`quota-trend-${i}-${wi}`, points, 22, t)))
            .when(Boolean(reset), row => row.child(text(`重置于 ${reset}`, t.dim, 9)))
            .when(Boolean(window.holdsWhy), row => row.child(text(window.holdsWhy, t.blocked, 9)));
        }))
        .when(Boolean(quota.error), row => row.child(text(quota.error, t.blocked, 10)))
        .when(!windows.length && quota.balance == null && !quota.error, row => row.child(text("暂无额度窗口", t.dim, 10)))
        .when(Boolean(quota.resets?.count), row => row.child(text(`${quota.resets.count} 张重置卡`, t.muted, 10)))
        .child(text(`更新于 ${quota.readAt ? new Date(quota.readAt).toLocaleTimeString() : "来源未记录时间"}`, t.dim, 9));
    });
  }

  providerQuotas(t) {
    const { byProvider } = this.quotaData();
    const names = [...byProvider.keys()];
    const order = [...this.providerOrder.filter((name) => names.includes(name)), ...names.filter((name) => !this.providerOrder.includes(name))];
    if (!order.length) return text("暂无额度数据", t.dim, 10);
    const groups = order.map((provider, i) => {
      if (this.hiddenProviders.includes(provider) && !this.editQuotas) return null;
      const entries = byProvider.get(provider).filter(({ key }) => this.editQuotas || !this.hiddenQuotas.includes(key));
      if (!entries.length) return null;
      const move = (direction, cx) => {
        const next = [...order];
        [next[i], next[i + direction]] = [next[i + direction], next[i]];
        this.providerOrder = next;
        preferences.setItem("magpie-live.provider-order", JSON.stringify(next));
        cx.notify();
      };
      const file = ICONS[provider];
      const icon = file ? (["grok", "kimi", "opencode-zen-free"].includes(provider)
        ? svg(`mods/magpie-live/${file}`).size(14).text_color(t.muted)
        : image(`mods/magpie-live/${file}`).size(14)) : svg("icons/program.svg").size(14).text_color(t.muted);
      return v_flex().w_full().min_w(0).gap(4).p(8).rounded(8).bg(t.raised)
        .child(h_flex().gap(5).items_center().child(icon)
          .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.foreground).child(entries[0].quota.name || provider))
          .when(this.editQuotas, row => row.child(div().id(`provider-visibility-${i}`).cursor_pointer().text_size(9).text_color(t.accent).on_click((_e, cx) => { this.hiddenProviders = this.hiddenProviders.includes(provider) ? this.hiddenProviders.filter((name) => name !== provider) : [...this.hiddenProviders, provider]; preferences.setItem("magpie-live.hidden-providers", JSON.stringify(this.hiddenProviders)); cx.notify(); }).child(this.hiddenProviders.includes(provider) ? "显示" : "隐藏")))
          .when(i > 0, row => row.child(div().id(`quota-up-${i}`).cursor_pointer().text_color(t.dim).opacity(0.6).tooltip("前移").on_click((_e, cx) => move(-1, cx)).child("‹")))
          .when(i < order.length - 1, row => row.child(div().id(`quota-down-${i}`).cursor_pointer().text_color(t.dim).opacity(0.6).tooltip("后移").on_click((_e, cx) => move(1, cx)).child("›"))))
        .children(entries.map((entry, index) => {
          const { quota, window, key, remaining } = entry;
          const hidden = this.hiddenQuotas.includes(key);
          const pace = quotaPace(entry);
          const account = quota.user ? (this.maskAccounts ? shortAccount(quota.user) : quota.user) : "";
          const label = [account, window?.name || (quota.balance != null ? "余额" : "额度")].filter(Boolean).join(" · ");
          const value = window ? (remaining === null ? "—" : `${remaining.toFixed(0)}%`) : quota.balance != null ? String(quota.balance) : "—";
          return v_flex().gap(3)
            .child(h_flex().items_center().gap(3)
              .child(div().flex_1().min_w(0).truncate().tooltip(label).text_size(9).text_color(t.dim).opacity(hidden ? 0.5 : 1).child(label))
              .when(!this.editQuotas, row => row.child(text(value, t.foreground, 11).font_semibold())
                .when(Boolean(window), detail => detail.child(text(pace === null ? "—" : `${pace > 0 ? "+" : ""}${pace}%`, pace !== null && pace < 0 ? t.blocked : t.muted, 9).tooltip("配速"))))
              .when(this.editQuotas, row => row.child(div().id(`quota-visibility-${i}-${index}`).flex_none().cursor_pointer().px(4).py(2).rounded(4).bg(t.surface).text_size(10).text_color(t.accent).tooltip(hidden ? "显示此额度" : "隐藏此额度")
                .on_click((_e, cx) => { this.hiddenQuotas = hidden ? this.hiddenQuotas.filter((item) => item !== key) : [...this.hiddenQuotas, key]; preferences.setItem("magpie-live.hidden-quotas", JSON.stringify(this.hiddenQuotas)); cx.notify(); }).child(hidden ? "显示" : "隐藏"))))
            .when(!this.editQuotas && Boolean(window) && remaining !== null, row => row.child(div().w_full().h(3).rounded(2).overflow_hidden().bg(t.border)
              .child(div().w(`${remaining}%`).h_full().rounded(2).bg(remaining < 10 ? t.blocked : t.accent))));
        }));
    }).filter(Boolean);
    return groups.length ? h_flex().w_full().gap(6).items_start().children([0, 1].map((column) => v_flex().flex_1().min_w(0).gap(6).children(groups.filter((_group, index) => index % 2 === column)))) : text("额度已全部隐藏，点击管理恢复", t.dim, 10);
  }

  metric(t, label, value, detail, comparison) {
    return v_flex().flex_1().min_w(0).gap(4).p(8)
      .child(text(label, t.muted, 10))
      .child(text(value, t.foreground, 16).font_semibold())
      .child(text(detail, t.dim, 9))
      .when(Boolean(comparison), row => row.child(text(comparison, t.accent, 9)));
  }

  usageOverview(t) {
    const usage = this.usage;
    const input = usage?.input ?? 0, output = usage?.output ?? 0;
    const cacheRead = usage?.cache_read ?? 0, cacheWrite = usage?.cache_write ?? 0;
    const prompt = input + cacheRead + cacheWrite;
    const comparison = this.comparison;
    const unavailable = usage && ["7d", "30d"].includes(usage.period) && !comparison ? "暂无可比较数据" : null;
    return v_flex().gap(6).children([
      h_flex().gap(6).children([
        this.metric(t, "Token", usage ? countTokens(prompt + output) : "—", usage ? `输入 ${countTokens(input)} · 输出 ${countTokens(output)} · 缓存 ${countTokens(cacheRead + cacheWrite)}` : "等待数据", comparison?.tokens || unavailable),
        this.metric(t, "请求", usage?.calls?.toLocaleString() ?? "—", usage ? `${usage.errors ?? 0} 次失败 · ${usage.retried ?? 0} 次改道` : "等待数据", comparison?.calls || unavailable),
      ]),
      h_flex().gap(6).children([
        this.metric(t, "费用", usage?.cost == null ? "—" : `≈$${Number(usage.cost).toFixed(2)}`, usage?.unpriced ? "部分未计价" : "生效价格", comparison?.cost || unavailable),
        this.metric(t, "缓存命中率", usage && prompt ? `${Math.round(cacheRead * 100 / prompt)}%` : "—", "占提示词", comparison?.cache || unavailable),
      ]),
    ]).when(Boolean(comparison), view => view.child(text(comparison.note, t.dim, 9)));
  }

  usageChart(t) {
    const usage = this.chartUsage, metric = this.chartMetric;
    const chartPeriod = usageChartPeriod(this.period, this.chartGranularity);
    const rangeLabel = chartPeriod === "today" ? "今天" : chartPeriod === "7d" ? "近 7 天" : "近 30 天";
    const comparable = usage?.period === this.usage?.period && Boolean(this.comparison);
    const baseline = this.comparisonCache?.baseline, now = new Date();
    const hour = usage?.period === "today" ? Math.max(0, Math.min(24, Math.floor((now.getTime() - Date.parse(usage.since)) / 3600000))) : null;
    let data = this.chartDerived;
    if (!data || data.usage !== usage || data.baseline !== baseline || data.comparable !== comparable || data.metric !== metric || data.hour !== hour) {
      const points = usageChartData(usage, baseline, comparable, metric, now);
      const max = Math.max(0, ...points.flatMap((point) => [point.current, point.previous ?? 0]));
      const format = (value) => metric === "cost" ? `≈$${value.toFixed(value > 0 && value < 1 ? 3 : 2)}` : countTokens(value);
      const height = (value) => value > 0 && max > 0 ? Math.max(2, Math.round(value / max * 52)) : 0;
      const bars = points.map((point, i) => ({
        currentHeight: height(point.current), previousHeight: point.previous === null ? null : height(point.previous),
        description: `${point.label || `时段 ${i + 1}`} · 本期 ${format(point.current)}${point.previous !== null ? ` · 对照 ${point.previousLabel || ""} ${format(point.previous)}` : ""}${point.unpriced ? " · 部分费用未计价" : ""}`,
      }));
      data = this.chartDerived = { usage, baseline, comparable, metric, hour, points, bars, maxLabel: format(max), hasPrevious: points.some((point) => point.previous !== null), partialCost: metric === "cost" && points.some((point) => point.unpriced) };
    }
    const { points, bars, maxLabel, hasPrevious, partialCost } = data;
    const label = CHART_METRICS.find(([id]) => id === metric)?.[1] || "请求";
    return v_flex().id("usage-chart").gap(6).p(8).rounded(8).bg(t.raised)
      .child(h_flex().items_center().justify_between().gap(4)
        .child(text(rangeLabel, t.muted, 9))
        .child(h_flex().gap(2).children([["hour", "按小时"], ["day", "按天"]].map(([id, title]) => div().id(`usage-granularity-${id}`).px(6).py(4).rounded(5).cursor_pointer().role("button").accessibility_label(`切换${title}走势`)
          .bg(this.chartGranularity === id ? t.selected : t.raised).text_color(this.chartGranularity === id ? t.foreground : t.muted).text_size(9)
          .on_click((_e, next) => this.setChartGranularity(id, next)).child(title)))))
      .child(h_flex().items_center().justify_end().gap(4)
        .child(h_flex().gap(2).children(CHART_METRICS.map(([id, title]) => div().id(`usage-chart-${id}`).px(6).py(4).rounded(5).cursor_pointer().role("button").accessibility_label(`切换${title}走势`)
          .bg(metric === id ? t.selected : t.raised).text_color(metric === id ? t.foreground : t.muted).text_size(9)
          .on_click((_e, next) => { this.chartMetric = id; preferences.setItem("magpie-live.chart-metric", id); next.notify(); }).child(title)))))
      .when(!usage, view => view.child(text(this.chartError || "等待用量数据", this.chartError ? t.blocked : t.dim, 10)))
      .when(Boolean(usage) && !points.length, view => view.child(text("当前周期暂无走势数据", t.dim, 10)))
      .when(points.length > 0, view => view
        .child(h_flex().items_center().gap(5).child(div().size(5).rounded(1).bg(t.accent)).child(text("本期", t.muted, 9))
          .when(hasPrevious, row => row.child(div().size(5).rounded(1).bg(t.muted).opacity(0.45)).child(text("前周期", t.muted, 9)))
          .child(div().flex_1()).child(text(`最高 ${maxLabel}`, t.dim, 9)))
        .child(this.chartBars("usage-chart-bars", bars, 55, t).h(56).border_b(1).border_color(t.border)
          .role("image").accessibility_label(`${label}走势，${points.length}个时段，最高${maxLabel}${hasPrevious ? "，包含前周期对照" : ""}`))
        .child(h_flex().justify_between().child(text(points[0].label || "开始", t.dim, 9)).child(text(points[points.length - 1].label || "当前", t.dim, 9)))
        .when(Boolean(usage.series?.length > 30), body => body.child(text("展示最近 30 个时段", t.dim, 9)))
        .when(partialCost, body => body.child(text("部分费用未计价，图中仅含已计价金额", t.dim, 9))));
  }

  render(cx) {
    this.syncPreferences();
    const t = theme();
    const surface = t.surface.replace(/^#/, "");
    const light = surface.length >= 6 && (parseInt(surface.slice(0, 2), 16) * 299 + parseInt(surface.slice(2, 4), 16) * 587 + parseInt(surface.slice(4, 6), 16) * 114) / 1000 > 160;
    const usage = this.usage;
    const tab = (id, label) => div().id(`magpie-tab-${id}`).px(10).py(6).rounded(6)
      .bg(this.page === id ? t.selected : t.surface)
      .text_color(this.page === id ? t.foreground : t.muted).text_size(11)
      .on_click((_e, next) => this.setPage(id, next)).child(label);
    const heading = (label, value) => h_flex().justify_between().items_center()
      .child(text(label, t.foreground, 12).font_semibold()).child(text(value, t.dim, 10));
    const header = h_flex().justify_between().items_center().px(12).py(10).border_b(1).border_color(t.border)
      .child(h_flex().gap(5).items_center().child(div().size(7).rounded_full().bg(this.error ? t.blocked : this.readAt ? t.done : t.dim))
        .child(text("Magpie", t.foreground, 13).font_semibold())
        .child(text(this.base.replace("http://127.0.0.1:", "127.0.0.1:"), t.dim, 9)))
      .child(h_flex().gap(3).p(3).rounded(8).bg(t.raised).children([tab("routing", "总览"), tab("usage", "用量")]));

    if (this.page === "routing") {
      const active = this.active.map((request) => ({ ...request, route_id: request.route, t: request.started, req: request.model, live: true }));
      const activeIds = new Set(active.map((request) => String(request.route_id)));
      const requests = [...active, ...this.recent.filter((request) => !activeIds.has(String(request.route_id)))].slice(0, 24);
      const focus = focused();
      const focusTerminal = focus?.shown || focus?.terminal || focus?.agent;
      const focusedAgent = agents().find((agent) => agent.address === focusTerminal);
      const focusedTitle = terminals().find((terminal) => terminal.address === focusTerminal)?.report?.msg || focusedAgent?.title?.replace(/^π\s*[\u2800-\u28ff]?\s*/, "");
      const focusedType = focusedAgent?.app || focusedAgent?.program?.key;
      const currentSession = focusTerminal === this.focusTerminal ? this.focusSession : null;
      const current = (request) => Boolean(currentSession && request.session === currentSession);
      const status = (request) => request.live ? "正在回答" : request.status >= 400 ? `失败 ${request.status}` : request.status ? `${request.status}` : "状态未知";
      const provider = (request) => request.provider || request.providerName || "未知来源";
      const sessionKey = (request) => request.session || `request-${request.route_id ?? request.id}`;
      const sourceKey = (request) => request.agent || "Agent";
      const actualModel = (request) => {
        const route = request.live ? this.routes[request.session] : null;
        const attempt = route && String(route.id) === String(request.route_id) ? route.tries?.[route.tries.length - 1] : null;
        return request.served || attempt?.model || (!request.live ? request.model : null) || (request.phase === "upstream" ? "模型信息不可用" : "等待模型");
      };
      const sourceNames = this.hiddenSections.includes("graph") ? [] : [...new Set(active.map(sourceKey))];
      const providerNames = this.hiddenSections.includes("graph") ? [] : [...new Set(active.map(provider))];
      const stageWidth = Math.max(200, Math.min(260, this.width - 20));
      const edge = 90;
      const middle = stageWidth / 2;
      const sessionColor = (request) => {
        const key = sessionKey(request);
        if (!this.sessionColors.has(key)) {
          const hue = this.sessionColors.size * 137.508 % 360;
          const rgb = [5, 3, 1].map((n) => {
            const k = (n + hue / 60) % 6;
            return Math.round(204 - 138 * Math.max(0, Math.min(k, 4 - k, 1))).toString(16).padStart(2, "0");
          }).join("");
          this.sessionColors.set(key, `#${rgb}`);
        }
        return this.sessionColors.get(key);
      };
      const nodeHeight = 24;
      const totalHeight = (names) => names.length * nodeHeight + Math.max(0, names.length - 1) * 8;
      const stageHeight = Math.max(86, totalHeight(sourceNames) + 16, totalHeight(providerNames) + 16);
      const nodeY = (names, index) => (stageHeight - totalHeight(names)) / 2 + index * (nodeHeight + 8) + nodeHeight / 2;
      const hubY = stageHeight / 2;
      const hubHeight = 24;
      const geometryKey = `${stageWidth}|${stageHeight}|${sourceNames.length}|${providerNames.length}`;
      if (geometryKey !== this.routeGeometryKey) { this.routeGeometryKey = geometryKey; this.routePaths.clear(); }
      const line = (x1, y1, x2, y2, color) => {
        const key = `${x1}|${y1}|${x2}|${y2}`;
        let path = this.routePaths.get(key);
        if (!path) {
          const dx = x2 - x1;
          path = PathBuilder.stroke(1).move_to(x1, y1).cubic_bezier_to(x2, y2, x1 + dx * 0.45, y1, x2 - dx * 0.35, y2).build();
          this.routePaths.set(key, path);
        }
        return window.paint_path(path, color).absolute().left(0).top(0).w(stageWidth).h(stageHeight);
      };
      const icon = (name) => {
        const file = ICONS[name];
        if (file) return ["omp", "magpie", "grok", "kimi", "opencode-zen-free"].includes(name)
          ? svg(`mods/magpie-live/${file}`).size(12).flex_none().text_color(t.muted)
          : image(`mods/magpie-live/${file}`).size(12).flex_none();
        const program = agents().find((agent) => agent.app === name || agent.program?.key === name)?.program;
        return program?.icon ? (program.tint ? svg(program.icon).text_color(t.muted) : image(program.icon)).size(12).flex_none()
          : svg("icons/program.svg").size(12).flex_none().text_color(t.dim);
      };
      const graph = () => {
        const currentActive = active.some(current);
        this.motionWidth = stageWidth;
        this.motionHeight = stageHeight;
        this.motionPaths = active.map((request, i) => ({
          id: `flow-${request.route_id ?? i}-${i}`,
          fromX: edge, fromY: nodeY(sourceNames, sourceNames.indexOf(sourceKey(request))),
          middle, midLeftY: hubY, midRightY: hubY,
          toX: stageWidth - edge, toY: nodeY(providerNames, providerNames.indexOf(provider(request))),
          color: sessionColor(request), current: current(request), dimmed: currentActive && !current(request),
        }));
        return div().relative().w(stageWidth).h(stageHeight).bg(t.surface)
        .children(sourceNames.map((name, i) => line(edge, nodeY(sourceNames, i), middle, hubY, t.muted)))
        .children(providerNames.map((name, i) => line(middle, hubY, stageWidth - edge, nodeY(providerNames, i), t.muted)))
        .child(this.motionView)
        .children(sourceNames.map((name, i) => h_flex().absolute().left(14).top(nodeY(sourceNames, i) - nodeHeight / 2).w(76).h(nodeHeight).px(5).gap(3).items_center().rounded(4).bg(t.raised).tooltip(name)
          .child(icon(name)).child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.foreground).child(name))))
        .children(providerNames.map((name, i) => {
          const request = active.find((item) => provider(item) === name);
          const title = request.providerName || name;
          return h_flex().absolute().right(14).top(nodeY(providerNames, i) - nodeHeight / 2).w(76).h(nodeHeight).px(5).gap(3).items_center().rounded(4).bg(t.raised).tooltip(title)
            .child(icon(name)).child(div().size(5).rounded_full().flex_none().bg(t.working))
            .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.foreground).child(title));
        }))
        .when(!active.length, view => view.child(div().absolute().left(0).right(0).top(12).flex().justify_center().child(text("当前没有活动路由", t.dim, 10))))
        .child(div().absolute().left(middle - hubHeight / 2).top(hubY - hubHeight / 2).w(hubHeight).h(hubHeight).rounded_full().bg(t.surface).flex().items_center().justify_center()
          .child(svg("mods/magpie-live/magpie.svg").size(17).text_color(t.muted)));
      };
      const sessionId = currentSession || active[0]?.session || requests[0]?.session;
      const session = (usage?.sessions ?? []).find((item) => item.id === sessionId);
      const promptTokens = session ? (session.input || 0) + (session.cache_read || 0) + (session.cache_write || 0) : 0;
      const sessionMetrics = () => session ? [
        `${session.calls} 次请求`,
        `${countTokens(promptTokens + (session.output || 0))} token`,
        promptTokens ? `缓存 ${Math.round((session.cache_read || 0) * 100 / promptTokens)}%` : null,
        session.decode_ms > 0 ? `${Math.round((session.decode_out || 0) * 1000 / session.decode_ms)} token/秒` : null,
        session.unpriced ? `已计价 ≈$${Number(session.cost || 0).toFixed(3)} · 部分未计价` : session.cost != null ? `≈$${Number(session.cost).toFixed(3)}` : null,
      ].filter(Boolean).join(" · ") : "该时间段暂无统计";
      const currentRoutes = active.filter(current);
      const activeRows = () => {
        const groups = new Map();
        for (const request of [...currentRoutes, ...active.filter((item) => !current(item))]) {
          const key = request.session || request;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(request);
        }
        return [...groups.values()].map((group, i) => {
          const request = group[0];
          const title = current(request) && focusedTitle ? focusedTitle : `${request.agent || "Agent"} · ${request.session ? request.session.slice(-6) : "会话未知"}`;
          return v_flex().id(`route-decision-${i}`).gap(4).p(10).rounded(8).bg(current(request) ? t.selected : light ? t.raised : t.surface)
            .when(current(request), row => row.border(1).border_color(t.border))
            .child(h_flex().gap(5).items_center().child(div().size(6).rounded_full().bg(sessionColor(request))).child(icon(request.agent || "Agent"))
              .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(current(request) && focusedTitle ? t.muted : t.foreground).tooltip(title).when(!current(request) || !focusedTitle, label => label.font_semibold()).child(current(request) && focusedTitle ? `${request.agent || "Agent"} · ${request.session.slice(-6)}` : title))
              .when(Boolean(this.sessionTerminals[request.session]?.length), row => row.child(text(this.sessionTerminals[request.session].join(" · "), t.working, 9)))
              .when(group.length > 1, row => row.child(text(`${group.length} 个请求`, t.dim, 9)))
              .when(current(request), row => row.child(text("当前会话", t.accent, 9))))
            .when(Boolean(current(request) && focusedTitle), row => row.child(div().w_full().min_w(0).truncate().text_size(11).text_color(t.foreground).font_semibold().tooltip(title).child(title)))
            .children(group.map((item, index) => {
              const latest = this.routes[item.session];
              const route = latest && String(latest.id) === String(item.route_id) ? latest : null;
              const reason = route?.rule?.when?.length ? route.rule.when.join(" · ") : route ? "网关未提供命中原因" : item.phase === "upstream" ? "该请求路由详情不可用" : "等待路由决策";
              return v_flex().id(`route-decision-request-${i}-${index}`).gap(4)
                .when(index > 0, row => row.pt(4).border_t(1).border_color(t.border))
                .child(h_flex().gap(4).items_center().child(div().min_w(0).truncate().text_size(11).text_color(t.accent).font_semibold().tooltip(actualModel(item)).child(actualModel(item)))
                  .when(Boolean(route?.group), row => row.child(text(`（${this.groupNames[route.group] || route.group}）`, t.muted, 10))))
                .child(text(`原因 · ${reason}`, t.muted, 10))
                .child(text(`回答中 · ${((item.ms || 0) / 1000).toFixed(1)} 秒`, t.working, 9));
            }))
            .when(current(request) && i === 0, row => row.child(div().pt(4).border_t(1).border_color(t.border)
              .child(text(`${PERIODS.find(([id]) => id === this.period)?.[1] || "本期"} · ${sessionId.slice(-8)} · ${sessionMetrics()}`, t.muted, 10))));
        });
      };
      const rows = () => requests.map((request, i) => {
        const expanded = this.selectedRoute != null && String(this.selectedRoute) === String(request.route_id);
        const latest = this.routes[request.session];
        // shortcut: the public route API exposes only each session's latest route; match IDs before showing attempts.
        const route = latest && String(latest.id) === String(request.route_id) ? latest : null;
        const account = request.providerAccount ? ` · ${this.maskAccounts ? shortAccount(request.providerAccount) : request.providerAccount}` : "";
        const totalTokens = (request.in || 0) + (request.out || 0) + (request.cache_read || 0) + (request.cache_write || 0);
        const metrics = [totalTokens > 0 && `${countTokens(totalTokens)} token`, request.ms != null && `${(request.ms / 1000).toFixed(1)} 秒`, request.cost != null && request.priced && `≈$${Number(request.cost).toFixed(3)}`].filter(Boolean).join(" · ");
        return v_flex().id(`route-request-${i}`).gap(4).px(9).py(8).rounded(6).bg(expanded || current(request) ? t.selected : t.surface).cursor_pointer()
          .on_click((_e, next) => { this.selectedRoute = expanded ? null : request.route_id; next.notify(); })
          .child(h_flex().items_center().gap(5)
            .child(text(request.agent || "Agent", t.foreground, 11).font_semibold())
            .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.muted).child(request.req || request.model || "模型未知"))
            .when(current(request), row => row.child(text("当前", t.accent, 9)))
            .child(text(request.t ? new Date(request.t).toLocaleTimeString() : "", t.dim, 9)))
          .child(h_flex().items_center().gap(5)
            .child(text("→", t.dim, 11))
            .child(div().size(5).rounded_full().bg(request.live ? t.working : request.status >= 400 ? t.blocked : t.done))
            .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.muted).child(`${provider(request)}${account} · ${request.live ? status(request) : request.served || request.model || status(request)}`)))
          .when(Boolean(metrics), row => row.child(h_flex().justify_end().child(text(metrics, t.dim, 9))))
          .when(expanded, row => row.child(v_flex().gap(4).pt(5).border_t(1).border_color(t.border)
            .when(Boolean(route?.group), detail => detail.child(text(`路由组 · ${this.groupNames[route.group] || route.group}`, t.muted, 10)))
            .children((route?.tries ?? []).map((attempt, n) => text(`尝试 ${n + 1} · ${attempt.model || "未知模型"} · ${attempt.done ? attempt.status || "已结束" : "进行中"}${attempt.ms != null ? ` · ${(attempt.ms / 1000).toFixed(1)} 秒` : ""}`, attempt.status >= 400 ? t.blocked : t.muted, 10)))
            .when(!route, detail => detail.child(text("此历史请求的详细尝试不可用", t.dim, 9)))));
      });
      const sections = [
        { id: "graph", name: "全部活动路由", extra: () => text(`${active.length} 个处理中`, t.dim, 10), view: () => div().flex().justify_center().child(graph()) },
        { id: "quotas", name: "来源额度", extra: () => div().id("quota-manage").cursor_pointer().text_size(10).text_color(t.accent).on_click((_e, next) => { this.editQuotas = !this.editQuotas; next.notify(); }).child(this.editQuotas ? "完成" : "隐藏 / 显示"),
          view: () => div().id("provider-quota-list").w_full().child(this.providerQuotas(t)) },
        { id: "usage", name: "用量概览", extra: () => text(PERIODS.find(([id]) => id === this.period)?.[1] || "本期", t.dim, 10), view: () => this.usageOverview(t) },
        { id: "usage-trend", name: "用量走势", extra: () => text(this.chartGranularity === "hour" ? "按小时" : "按天", t.dim, 10), view: () => this.usageChart(t) },
        { id: "decisions", name: "实时路由", extra: () => text(`${active.length} 个处理中`, t.dim, 10), view: () => v_flex().gap(6)
          .when(!currentRoutes.length && (currentSession || !active.length), body => body.child(v_flex().gap(5).p(10).rounded(8).bg(currentSession ? t.selected : light ? t.raised : t.surface)
            .when(Boolean(currentSession), card => card.border(1).border_color(t.border))
            .child(h_flex().items_center().gap(6)
              .child(icon(session?.agent || focusedType || "Agent"))
              .child(div().flex_1().min_w(0).truncate().text_size(9).text_color(t.muted).child(sessionId ? `${session?.agent || focusedType || "Agent"} · ${sessionId.slice(-8)}` : "尚无会话"))
              .when(Boolean(currentSession && focusTerminal), row => row.child(text(focusTerminal, t.working, 9)))
              .child(text(currentSession ? "当前会话" : "最近会话", currentSession ? t.accent : t.dim, 9)))
            .when(Boolean(currentSession && focusedTitle), card => card.child(div().w_full().min_w(0).truncate().text_size(11).text_color(t.foreground).font_semibold().tooltip(focusedTitle).child(focusedTitle)))
            .child(text(currentSession ? "当前会话暂无进行中的请求" : "无法识别当前会话", t.dim, 10))
            .child(text(`${PERIODS.find(([id]) => id === this.period)?.[1] || "本期"} · ${sessionMetrics()}`, t.muted, 10))))
          .children(activeRows()) },
        { id: "requests", name: `最近请求 · ${requests.length}`, extra: () => div().id("route-mask").text_size(10).text_color(t.muted).cursor_pointer()
          .on_click((_e, next) => { this.maskAccounts = !this.maskAccounts; preferences.setItem("magpie-live.mask", String(this.maskAccounts)); next.notify(); }).child(this.maskAccounts ? "账号已隐藏" : "隐藏账号"),
          view: () => v_flex().gap(6).children(rows()).when(!requests.length, body => body.child(text("等待请求", t.dim, 11))) },
      ];
      const ids = sections.map((section) => section.id);
      const order = [...new Set(this.overviewOrder.filter((id) => ids.includes(id))), ...ids.filter((id) => !this.overviewOrder.includes(id))];
      if (!this.overviewOrder.includes("usage-trend")) {
        order.splice(order.indexOf("usage-trend"), 1);
        order.splice(order.indexOf("usage") + 1, 0, "usage-trend");
      }
      const sectionView = (id) => {
        const section = sections.find((item) => item.id === id);
        const fixed = this.pinnedSections.includes(id);
        return v_flex().id(`overview-section-${id}`).relative().p(10).bg(t.surface)
          .when(light, card => card.rounded(10))
          .when(!light, card => card.border_b(1).border_color(t.border))
          .when(this.draggingSection, card => card.cursor_grabbing())
          .on_hover((hovered, next) => { const current = hovered ? id : this.hoveredSection === id ? null : this.hoveredSection; if (current !== this.hoveredSection) { this.hoveredSection = current; next.notify(); } })
          .when(this.draggingSection && this.pressedSection === id, card => card.opacity(0.5))
          .when(this.draggingSection && this.overSection === id && this.pressedSection !== id, card => card.child(div().absolute().left(4).right(4).when(this.dropSectionAfter, line => line.bottom(0)).when(!this.dropSectionAfter, line => line.top(0)).h(2).bg(t.accent)))
          .on_mouse_move((event, next) => {
            if (!this.pressedSection) return;
            const dragging = this.draggingSection || Math.hypot(event.position.x - this.sectionPressPosition.x, event.position.y - this.sectionPressPosition.y) >= 5;
            const over = dragging ? id : null, after = event.local_position.y >= event.bounds.height / 2;
            if (dragging !== this.draggingSection || over !== this.overSection || after !== this.dropSectionAfter) { this.draggingSection = dragging; this.overSection = over; this.dropSectionAfter = after; next.notify(); }
          })
          .on_mouse_up("left", (_event, next) => {
            if (!this.pressedSection) return;
            const from = this.pressedSection, over = this.overSection, after = this.dropSectionAfter, dragging = this.draggingSection;
            this.pressedSection = null; this.overSection = null; this.draggingSection = false;
            if (dragging && over === id && from !== id) {
              const updated = order.filter((item) => item !== from), index = updated.indexOf(id);
              updated.splice(index + (after ? 1 : 0), 0, from);
              this.overviewOrder = updated;
              preferences.setItem("magpie-live.overview-order", JSON.stringify(updated));
              this.pinnedSections = fixed ? [...new Set([...this.pinnedSections, from])] : this.pinnedSections.filter((item) => item !== from);
              preferences.setItem("magpie-live.pinned-sections", JSON.stringify(this.pinnedSections));
              next.stop_propagation();
            }
            next.notify();
          })
          .child(h_flex().items_center().gap(4).pb(8)
            .child(div().id(`overview-drag-${id}`).size(18).flex_none().flex().items_center().justify_center().cursor_grab().text_color(t.dim).tooltip("拖动排序").role("button").accessibility_label(`拖动${section.name}排序`)
              .when(this.draggingSection && this.pressedSection === id, handle => handle.cursor_grabbing())
              .on_mouse_down("left", (event, next) => { next.stop_propagation(); this.pressedSection = id; this.sectionPressPosition = event.position; this.overSection = null; this.draggingSection = false; })
              .on_click((_event, next) => next.stop_propagation()).child("⋮⋮"))
            .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.foreground).font_semibold().child(section.name))
            .when(Boolean(section.extra), row => row.child(section.extra()))
            .child(h_flex().gap(2).items_center()
              .when(this.hoveredSection === id, row => row.child(div().id(`overview-hide-${id}`).size(18).flex().items_center().justify_center().rounded(4).cursor_pointer().text_color(t.dim).hover(style => style.bg(t.hover).text_color(t.foreground)).tooltip("隐藏区块")
                .on_mouse_down("left", (_event, next) => next.stop_propagation())
                .on_click((_event, next) => { next.stop_propagation(); this.hiddenSections = [...this.hiddenSections, id]; preferences.setItem("magpie-live.hidden-sections", JSON.stringify(this.hiddenSections)); next.notify(); })
                .child(svg("mods/workspace-chrome-personal/x.svg").size(12))))
              .child(div().id(`overview-pin-${id}`).px(4).py(3).rounded(4).cursor_pointer().text_size(9).text_color(fixed ? t.accent : t.dim).hover(style => style.bg(t.hover).text_color(t.foreground)).tooltip(fixed ? "取消固定" : "固定到顶部")
                .on_mouse_down("left", (_event, next) => next.stop_propagation())
                .on_click((_e, next) => { next.stop_propagation(); this.pinnedSections = fixed ? this.pinnedSections.filter((item) => item !== id) : [...this.pinnedSections, id]; preferences.setItem("magpie-live.pinned-sections", JSON.stringify(this.pinnedSections)); next.notify(); })
                .child(fixed ? "已固定" : "固定"))))
          .child(section.view());
      };
      const visible = order.filter((id) => !this.hiddenSections.includes(id));
      const pinned = visible.filter((id) => this.pinnedSections.includes(id));
      return v_flex().id("magpie-live-root").size_full().min_h(0).bg(light ? t.raised : t.surface)
        .on_hover((hovered, next) => { if (!hovered && this.pressedSection) { this.pressedSection = null; this.overSection = null; this.draggingSection = false; next.notify(); } })
        .on_mouse_up("left", (_event, next) => { if (this.pressedSection) { this.pressedSection = null; this.overSection = null; this.draggingSection = false; next.notify(); } })
        .on_size_change((size, next) => { if (this.width !== size.width || this.height !== size.height) { this.width = size.width; this.height = size.height; next.notify(); } })
        .child(header)
        .child(h_flex().justify_between().items_center().px(12).py(10)
          .child(text(`${PERIODS.find(([id]) => id === this.period)?.[1] || "本期"} ${usage?.calls?.toLocaleString() ?? "—"} 次调用`, t.muted, 10))
          .child(text(`${this.active.length} 个处理中`, this.active.length ? t.working : t.dim, 10)))
        .when(Boolean(this.error), body => body.child(card(t).child(text(`连接异常 · ${this.error}`, t.blocked))))
        .when(Boolean(this.recentError), body => body.child(text(`请求记录暂不可用 · ${this.recentError}`, t.blocked, 10)))
        .when(this.hiddenSections.some((id) => ids.includes(id)), body => body.child(h_flex().px(10).pb(4).gap(5).items_center().flex_wrap()
          .child(text("已隐藏：", t.dim, 10))
          .children(order.filter((id) => this.hiddenSections.includes(id)).map((id) => div().id(`overview-restore-${id}`).cursor_pointer().text_size(10).text_color(t.accent).tooltip("恢复区块")
            .on_click((_e, next) => { this.hiddenSections = this.hiddenSections.filter((item) => item !== id); preferences.setItem("magpie-live.hidden-sections", JSON.stringify(this.hiddenSections)); next.notify(); }).child(`+ ${sections.find((item) => item.id === id).name}`)))))
        .when(pinned.length > 0, body => body.child(div().id("overview-pinned").flex_none().h(Math.min(this.pinnedHeight || Math.max(80, this.height * 0.4), Math.max(80, this.height * 0.4))).overflow_y_scrollbar().px(8)
          .child(v_flex().id("overview-pinned-content").flex_none().gap(8).on_size_change((size, next) => { if (this.pinnedHeight !== size.height) { this.pinnedHeight = size.height; next.notify(); } }).children(pinned.map(sectionView)))))
        .child(div().flex_1().min_h(0).overflow_y_scrollbar().child(v_flex().gap(8).p(8)
          .children(visible.filter((id) => !this.pinnedSections.includes(id)).map(sectionView))))
        .child(h_flex().justify_between().px(10).py(7).border_t(1).border_color(t.border)
          .child(text("数据只读 · 每 5 秒刷新", t.dim, 9))
          .child(text(currentSession ? requests.some(current) ? "当前请求已标识" : "当前会话暂无近期请求" : "当前 Agent 未关联", t.dim, 9)));
    }

    const periods = h_flex().gap(3).children(PERIODS.map(([id, label]) => div().id(`magpie-period-${id}`).px(7).py(5).rounded(5)
      .bg(this.period === id ? t.selected : t.surface).text_color(this.period === id ? t.foreground : t.muted)
      .text_size(10).on_click((_e, next) => this.setPeriod(id, next)).child(label)));
    const maskButton = div().id("magpie-mask-accounts").px(7).py(5).rounded(5).bg(t.surface).text_color(t.muted).text_size(10)
      .on_click((_e, next) => { this.maskAccounts = !this.maskAccounts; preferences.setItem("magpie-live.mask", String(this.maskAccounts)); next.notify(); })
      .child(this.maskAccounts ? "账户打码" : "显示账户");
    const quotaViewButton = div().id("magpie-quota-view").px(7).py(5).rounded(5).bg(t.surface).text_color(t.muted).text_size(10)
      .on_click((_e, next) => { this.showRemaining = !this.showRemaining; preferences.setItem("magpie-live.remaining", String(this.showRemaining)); next.notify(); })
      .child(this.showRemaining ? "剩余" : "已用");
    return v_flex().id("magpie-live-root").size_full().min_h(0).bg(t.surface)
      .on_size_change((size, next) => { if (this.width !== size.width) { this.width = size.width; next.notify(); } })
      .child(header)
      .child(h_flex().justify_between().items_center().flex_wrap().gap(5).px(8).py(7).child(periods).child(h_flex().gap(3).child(quotaViewButton).child(maskButton)))
      .child(div().flex_1().min_h(0).overflow_y_scrollbar().child(v_flex().gap(9).p(8)
        .when(Boolean(this.error), body => body.child(card(t).child(text(`数据暂不可用 · 保留上次成功数据。${this.error}`, t.blocked, 10))))
        .child(heading("用量概览", `${usage?.since ? new Date(usage.since).toLocaleDateString() : ""}`))
        .child(this.usageOverview(t))
        .child(heading("用量走势", this.chartGranularity === "hour" ? "按小时" : "按天"))
        .child(this.usageChart(t))
        .child(heading("额度", `${this.quotas?.length ?? 0} 个来源`))
        .children(this.quotaCards(t))))
      .child(h_flex().justify_between().px(10).py(7).border_t(1).border_color(t.border)
        .child(text("本机只读 · 不修改路由配置", t.dim, 9))
        .child(this.readStatus));
  }
}
