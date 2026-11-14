import { View, div, svg, image, PathBuilder } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { home, readTextFile, theme, nextCommand, exec, focused, terminals, agents, layout } from "herdr";

const BASE = "http://127.0.0.1:3425";
const PERIODS = [["today", "今天"], ["7d", "7天"], ["30d", "30天"], ["all", "全部"]];
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
  init(_props, cx) {
    this.page = ["routing", "usage"].includes(localStorage.getItem("magpie-live.page")) ? localStorage.getItem("magpie-live.page") : "routing";
    this.period = PERIODS.some(([id]) => id === localStorage.getItem("magpie-live.period"))
      ? localStorage.getItem("magpie-live.period") : "today";
    this.maskAccounts = localStorage.getItem("magpie-live.mask") !== "false";
    this.showRemaining = localStorage.getItem("magpie-live.remaining") !== "false";
    try { this.providerOrder = JSON.parse(localStorage.getItem("magpie-live.provider-order") || "[]"); } catch { this.providerOrder = []; }
    if (!Array.isArray(this.providerOrder)) this.providerOrder = [];
    try { this.hiddenQuotas = JSON.parse(localStorage.getItem("magpie-live.hidden-quotas") || "[]"); } catch { this.hiddenQuotas = []; }
    if (!Array.isArray(this.hiddenQuotas)) this.hiddenQuotas = [];
    this.editQuotas = false;
    try { this.overviewOrder = JSON.parse(localStorage.getItem("magpie-live.overview-order") || "[]"); } catch { this.overviewOrder = []; }
    if (!Array.isArray(this.overviewOrder)) this.overviewOrder = [];
    try { this.hiddenSections = JSON.parse(localStorage.getItem("magpie-live.hidden-sections") || "[]"); } catch { this.hiddenSections = []; }
    if (!Array.isArray(this.hiddenSections)) this.hiddenSections = [];
    try { this.pinnedSections = JSON.parse(localStorage.getItem("magpie-live.pinned-sections") || "[]"); } catch { this.pinnedSections = []; }
    if (!Array.isArray(this.pinnedSections)) this.pinnedSections = [];
    try { this.hiddenProviders = JSON.parse(localStorage.getItem("magpie-live.hidden-providers") || "[]"); } catch { this.hiddenProviders = []; }
    if (!Array.isArray(this.hiddenProviders)) this.hiddenProviders = [];
    this.base = BASE;
    this.usage = null;
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
    this.sessionColors = new Map();
    this.error = "";
    this.readAt = null;
    this.reading = false;
    this.motionStart = Date.now();
    this.motionPaths = [];
    this.motionHasPaths = false;
    this.motionView = cx.new(RouteDots, { paths: [], start: this.motionStart });
    cx.timer.every(160, () => {
      if (this.page !== "routing" || this.hiddenSections.includes("graph") || (!this.motionPaths.length && !this.motionHasPaths)) return;
      const panel = layout()?.children?.find((node) => node.id === "magpie-panel");
      if (panel && !panel.hidden) {
        this.motionView.set_props({ paths: this.motionPaths, start: this.motionStart, now: Date.now(), width: this.motionWidth, height: this.motionHeight });
        this.motionHasPaths = this.motionPaths.length > 0;
      }
    });
    cx.timer.every(5000, (next) => {
      const panel = layout()?.children?.find((node) => node.id === "magpie-panel");
      if (!panel?.hidden) this.refresh(next);
    });
    if (!layout()?.children?.find((node) => node.id === "magpie-panel")?.hidden) this.refresh(cx);
    cx.spawn(async (next) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "routing" || command === "usage") this.setPage(command, next);
        else if (PERIODS.some(([id]) => id === command)) this.setPeriod(command, next);
        else if (command === "refresh") { this.historyAt = 0; this.refresh(next); }
        else if (command === "mask") { this.maskAccounts = !this.maskAccounts; localStorage.setItem("magpie-live.mask", String(this.maskAccounts)); }
        else if (command === "remaining") { this.showRemaining = !this.showRemaining; localStorage.setItem("magpie-live.remaining", String(this.showRemaining)); }
        next.notify();
      }
    });
  }

  refresh(cx) {
    if (this.reading) return;
    this.reading = true;
    const period = this.period;
    cx.spawn(async (next) => {
      try {
        if (!this.configDir) {
          const env = await exec("/usr/bin/printenv", ["XDG_CONFIG_HOME"]);
          this.configDir = `${env.stdout.trim() || `${home()}/.config`}/magpie`;
        }
        const configDir = this.configDir;
        const settingsText = await readTextFile(`${configDir}/settings.json`);
        const providersText = await readTextFile(`${configDir}/providers.json`);
        const groups = providersText ? (JSON.parse(providersText).groups ?? []) : [];
        this.groupNames = Object.fromEntries(groups.map((group) => [group.id, group.name || group.id]));
        const port = Number(settingsText ? (JSON.parse(settingsText).port ?? 3425) : 3425);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Magpie 网关端口无效");
        this.base = `http://127.0.0.1:${port}`;
        const focus = focused();
        const focusTerminal = focus?.shown || focus?.terminal || focus?.agent;
        const terminal = terminals().find((item) => item.address === focusTerminal);
        const pid = terminal?.foreground?.pid;
        this.focusTerminal = focusTerminal;
        this.focusSession = null;
        if (pid && !String(focusTerminal).includes("/")) {
          try {
            const files = await exec("/usr/sbin/lsof", ["-Fn", "-p", String(pid)]);
            const lines = files.stdout.split("\n");
            const ids = (pattern) => [...new Set(lines.flatMap((line) => { const match = line.match(pattern); return match ? [match[1]] : []; }))];
            const sessions = ids(/\/sessions\/.*?([0-9a-f-]{36})\.jsonl$/i);
            const owners = ids(/\/session-owners\/([0-9a-f-]{36})\.lock$/i);
            if (sessions.length === 1) this.focusSession = sessions[0];
            else if (!sessions.length && owners.length === 1) this.focusSession = owners[0];
          } catch { /* The terminal may not expose a session file. */ }
        }
        if (!this.recentReading) {
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
              if (changed) update.notify();
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
        const [usageRes, quotaRes, activeRes, history] = await Promise.all([
          fetch(periodPath(this.base, period)),
          fetch(`${this.base}/v1/magpie/quotas`),
          fetch(`${this.base}/v1/magpie/concurrency`),
          readHistory(),
        ]);
        for (const response of [usageRes, quotaRes, activeRes]) {
          if (!response.ok) throw new Error(`Magpie HTTP ${response.status}`);
        }
        const [usage, quota, active] = await Promise.all([
          usageRes.json(), quotaRes.json(), activeRes.json(),
        ]);
        const sessions = [...new Set((active.active ?? []).map((request) => request.session).filter(Boolean))];
        const routeEntries = await Promise.all(sessions.map(async (session) => {
          try {
            const response = await fetch(`${this.base}/v1/magpie/route?session=${encodeURIComponent(session)}`);
            if (!response.ok) return [session, null];
            return [session, (await response.json()).route ?? null];
          } catch { return [session, null]; }
        }));
        this.routes = Object.fromEntries(routeEntries.filter(([, route]) => route));
        if (period === this.period) this.usage = usage;
        this.quotas = quota.data ?? [];
        this.active = active.active ?? [];
        if (!this.active.length) this.motionView.set_props({ paths: [], start: this.motionStart });
        this.history = history?.data ?? this.history;
        this.error = "";
        this.readAt = Date.now();
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Magpie 暂不可用";
      } finally {
        this.reading = false;
        next.notify();
        if (period !== this.period) this.refresh(next);
      }
    });
  }

  setPage(page, cx) {
    this.page = page;
    localStorage.setItem("magpie-live.page", page);
    cx.notify();
  }

  setPeriod(period, cx) {
    if (period === this.period) return;
    this.period = period;
    localStorage.setItem("magpie-live.period", period);
    this.usage = null;
    this.refresh(cx);
    cx.notify();
  }



  quotaCards(t) {
    return (this.quotas ?? []).map((quota, i) => {
      const windows = quota.windows ?? [];
      const history = this.history?.find((row) => row.provider === quota.provider && row.user === quota.user);
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
          const points = history?.lines?.find((line) => line.name === window.name)?.points?.slice(-24) ?? [];
          const barWidth = Math.max(0, this.width - 36);
          return v_flex().id(`quota-window-${i}-${wi}`).gap(4)
            .child(h_flex().justify_between()
              .child(text(window.name || "额度", t.muted, 10))
              .child(text(shown === null ? "数据不足" : `${this.showRemaining ? "剩余" : "已用"} ${shown.toFixed(1)}%`, t.muted, 10)))
            .child(div().w_full().h(4).relative().rounded(2).bg(t.border)
              .child(div().absolute().left(0).top(0).bottom(0).w(barWidth * (shown ?? 0) / 100).rounded(2).bg(remaining !== null && remaining < 10 ? t.blocked : t.accent)))
            .when(points.length > 1, row => row.child(text("最近 24 次额度读数", t.dim, 9)).child(h_flex().h(22).gap(1).items_end().children(points.map((point, pi) => {
              const left = percent(point.left);
              const value = left === null ? 0 : this.showRemaining ? left : 100 - left;
              return div().id(`quota-trend-${i}-${wi}-${pi}`).flex_1().h(20 * value / 100).rounded(1).bg(t.accent);
            }))))
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
    const quotas = this.quotas ?? [];
    const names = [...new Set(quotas.map((quota) => quota.provider))];
    const order = [...this.providerOrder.filter((name) => names.includes(name)), ...names.filter((name) => !this.providerOrder.includes(name))];
    if (!order.length) return text("暂无额度数据", t.dim, 10);
    const keyFor = (quota, window) => JSON.stringify([quota.provider, quota.user || "", window?.name ?? null]);
    const groups = order.map((provider, i) => {
      const entries = quotas.filter((quota) => quota.provider === provider).flatMap((quota) =>
        (quota.windows?.length ? quota.windows : [null]).map((window) => ({ quota, window, key: keyFor(quota, window) })))
        .filter(({ key }) => this.editQuotas || !this.hiddenQuotas.includes(key));
      if (this.hiddenProviders.includes(provider) && !this.editQuotas) return null;
      if (!entries.length) return null;
      const move = (direction, cx) => {
        const next = [...order];
        [next[i], next[i + direction]] = [next[i + direction], next[i]];
        this.providerOrder = next;
        localStorage.setItem("magpie-live.provider-order", JSON.stringify(next));
        cx.notify();
      };
      const file = ICONS[provider];
      const icon = file ? (["grok", "kimi", "opencode-zen-free"].includes(provider)
        ? svg(`mods/magpie-live/${file}`).size(14).text_color(t.muted)
        : image(`mods/magpie-live/${file}`).size(14)) : svg("icons/program.svg").size(14).text_color(t.muted);
      return v_flex().w_full().min_w(0).gap(3).p(6).rounded(6).bg(t.raised).border(1).border_color(t.border)
        .child(h_flex().gap(5).items_center().child(icon)
          .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.foreground).child(entries[0].quota.name || provider))
          .when(this.editQuotas, row => row.child(div().id(`provider-visibility-${i}`).cursor_pointer().text_size(9).text_color(t.accent).on_click((_e, cx) => { this.hiddenProviders = this.hiddenProviders.includes(provider) ? this.hiddenProviders.filter((name) => name !== provider) : [...this.hiddenProviders, provider]; localStorage.setItem("magpie-live.hidden-providers", JSON.stringify(this.hiddenProviders)); cx.notify(); }).child(this.hiddenProviders.includes(provider) ? "显示" : "隐藏")))
          .when(i > 0, row => row.child(div().id(`quota-up-${i}`).cursor_pointer().text_color(t.dim).opacity(0.6).tooltip("前移").on_click((_e, cx) => move(-1, cx)).child("‹")))
          .when(i < order.length - 1, row => row.child(div().id(`quota-down-${i}`).cursor_pointer().text_color(t.dim).opacity(0.6).tooltip("后移").on_click((_e, cx) => move(1, cx)).child("›"))))
        .children(entries.map(({ quota, window, key }, index) => {
          const hidden = this.hiddenQuotas.includes(key);
          const used = percent(window?.used);
          const remaining = percent(window?.remaining) ?? (used === null ? null : 100 - used);
          const history = this.history.find((row) => row.provider === provider && row.user === quota.user);
          const reset = Date.parse(window?.resetsAt);
          const points = history?.lines?.find((line) => line.name === window?.name)?.points ?? [];
          const point = [...points].reverse().find((p) => Math.abs(Date.parse(p.resetsAt) - reset) < 120000 && p.start);
          const start = Date.parse(point?.start), now = Date.now();
          const pace = remaining !== null && start <= now && now < reset && reset > start ? Math.round(remaining - 100 * (reset - now) / (reset - start)) : null;
          const account = quota.user ? (this.maskAccounts ? shortAccount(quota.user) : quota.user) : "";
          const label = [account, window?.name || (quota.balance != null ? "余额" : "额度")].filter(Boolean).join(" · ");
          const value = window ? (remaining === null ? "—" : `${remaining.toFixed(0)}%`) : quota.balance != null ? String(quota.balance) : "—";
          return h_flex().items_center().gap(3)
            .child(div().flex_1().min_w(0).truncate().tooltip(label).text_size(9).text_color(t.dim).opacity(hidden ? 0.5 : 1).child(label))
            .when(!this.editQuotas, row => row.child(text(value, t.foreground, 11).font_semibold())
              .when(Boolean(window), detail => detail.child(text(pace === null ? "—" : `${pace > 0 ? "+" : ""}${pace}%`, pace !== null && pace < 0 ? t.blocked : t.muted, 9).tooltip("配速"))))
            .when(this.editQuotas, row => row.child(div().id(`quota-visibility-${i}-${index}`).flex_none().cursor_pointer().px(4).py(2).rounded(4).bg(t.surface).text_size(10).text_color(t.accent).tooltip(hidden ? "显示此额度" : "隐藏此额度")
              .on_click((_e, cx) => { this.hiddenQuotas = hidden ? this.hiddenQuotas.filter((item) => item !== key) : [...this.hiddenQuotas, key]; localStorage.setItem("magpie-live.hidden-quotas", JSON.stringify(this.hiddenQuotas)); cx.notify(); }).child(hidden ? "显示" : "隐藏")));
        }));
    }).filter(Boolean);
    return groups.length ? h_flex().w_full().gap(6).items_start().children([0, 1].map((column) => v_flex().flex_1().min_w(0).gap(6).children(groups.filter((_group, index) => index % 2 === column)))) : text("额度已全部隐藏，点击管理恢复", t.dim, 10);
  }

  metric(t, label, value, detail) {
    return v_flex().flex_1().min_w(0).gap(3).p(8).rounded(6).bg(t.surface)
      .child(text(label, t.muted, 10))
      .child(text(value, t.foreground, 16).font_semibold())
      .child(text(detail, t.dim, 9));
  }

  usageOverview(t) {
    const usage = this.usage;
    const input = usage?.input ?? 0, output = usage?.output ?? 0;
    const cacheRead = usage?.cache_read ?? 0, cacheWrite = usage?.cache_write ?? 0;
    const prompt = input + cacheRead + cacheWrite;
    return v_flex().gap(6).children([
      h_flex().gap(6).children([
        this.metric(t, "Token", usage ? countTokens(prompt + output) : "—", usage ? `输入 ${countTokens(input)} · 输出 ${countTokens(output)} · 缓存 ${countTokens(cacheRead + cacheWrite)}` : "等待数据"),
        this.metric(t, "请求", usage?.calls?.toLocaleString() ?? "—", usage ? `${usage.errors ?? 0} 次失败 · ${usage.retried ?? 0} 次改道` : "等待数据"),
      ]),
      h_flex().gap(6).children([
        this.metric(t, "费用", usage?.cost == null ? "—" : `≈$${Number(usage.cost).toFixed(2)}`, usage?.unpriced ? "部分未计价" : "生效价格"),
        this.metric(t, "缓存命中率", usage && prompt ? `${Math.round(cacheRead * 100 / prompt)}%` : "—", "占提示词"),
      ]),
    ]);
  }

  render(cx) {
    const t = theme();
    const usage = this.usage;
    const tab = (id, label) => div().id(`magpie-tab-${id}`).px(9).py(6).rounded(6)
      .bg(this.page === id ? t.selected : t.surface)
      .text_color(this.page === id ? t.foreground : t.muted).text_size(11)
      .on_click((_e, next) => this.setPage(id, next)).child(label);
    const heading = (label, value) => h_flex().justify_between().items_center()
      .child(text(label, t.foreground, 12).font_semibold()).child(text(value, t.dim, 10));
    const header = h_flex().justify_between().items_center().px(10).py(8).border_b(1).border_color(t.border)
      .child(h_flex().gap(5).items_center().child(div().size(7).rounded_full().bg(this.error ? t.blocked : this.readAt ? t.done : t.dim))
        .child(text("Magpie", t.foreground, 13).font_semibold())
        .child(text(this.base.replace("http://127.0.0.1:", "127.0.0.1:"), t.dim, 9)))
      .child(h_flex().gap(4).children([tab("routing", "总览"), tab("usage", "用量")]));

    if (this.page === "routing") {
      const active = this.active.map((request) => ({ ...request, route_id: request.route, t: request.started, req: request.model, live: true }));
      const activeIds = new Set(active.map((request) => String(request.route_id)));
      const requests = [...active, ...this.recent.filter((request) => !activeIds.has(String(request.route_id)))].slice(0, 24);
      const focus = focused();
      const focusTerminal = focus?.shown || focus?.terminal || focus?.agent;
      const focusedAgent = agents().find((agent) => agent.address === focusTerminal);
      const focusedType = focusedAgent?.app || focusedAgent?.program?.key;
      const currentSession = focusTerminal === this.focusTerminal ? this.focusSession : null;
      const current = (request) => Boolean(currentSession && request.session === currentSession);
      const currentActive = active.some(current);
      const status = (request) => request.live ? "正在回答" : request.status >= 400 ? `失败 ${request.status}` : request.status ? `${request.status}` : "状态未知";
      const provider = (request) => request.provider || request.providerName || "未知来源";
      const sessionKey = (request) => request.session || `request-${request.route_id ?? request.id}`;
      const sourceKey = (request) => request.agent || "Agent";
      const actualModel = (request) => {
        const route = request.live ? this.routes[request.session] : null;
        const attempt = route && String(route.id) === String(request.route_id) ? route.tries?.[route.tries.length - 1] : null;
        return request.served || attempt?.model || (!request.live ? request.model : null) || "等待模型";
      };
      const sourceNames = [...new Set(active.map(sourceKey))];
      const providerNames = [...new Set(active.map(provider))];
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
      const flows = active;
      const nodeHeight = 24;
      const totalHeight = (names) => names.length * nodeHeight + Math.max(0, names.length - 1) * 8;
      const stageHeight = Math.max(86, totalHeight(sourceNames) + 16, totalHeight(providerNames) + 16);
      const nodeY = (names, index) => (stageHeight - totalHeight(names)) / 2 + index * (nodeHeight + 8) + nodeHeight / 2;
      const hubY = stageHeight / 2;
      const hubHeight = 24;
      const line = (x1, y1, x2, y2, color) => {
        const dx = x2 - x1;
        const path = PathBuilder.stroke(1).move_to(x1, y1).cubic_bezier_to(x2, y2, x1 + dx * 0.45, y1, x2 - dx * 0.35, y2).build();
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
      this.motionWidth = stageWidth;
      this.motionHeight = stageHeight;
      this.motionPaths = flows.map((request, i) => ({
        id: `flow-${request.route_id ?? i}-${i}`,
        fromX: edge,
        fromY: nodeY(sourceNames, sourceNames.indexOf(sourceKey(request))),
        middle,
        midLeftY: hubY,
        midRightY: hubY,
        toX: stageWidth - edge,
        toY: nodeY(providerNames, providerNames.indexOf(provider(request))),
        color: sessionColor(request),
        current: current(request),
        dimmed: currentActive && !current(request),
      }));
      const graph = div().relative().w(stageWidth).h(stageHeight).bg(t.surface)
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
      const currentRoutes = active.filter(current);
      const activeRows = [...currentRoutes, ...active.filter((request) => !current(request))].map((request, i) => {
        const latest = this.routes[request.session];
        const route = latest && String(latest.id) === String(request.route_id) ? latest : null;
        const reason = route?.rule?.when?.length ? route.rule.when.join(" · ") : route ? "网关未提供命中原因" : "等待路由决策";
        const title = current(request) && focusedAgent?.title ? focusedAgent.title : `${request.agent || "Agent"} · ${request.session ? request.session.slice(-6) : "会话未知"}`;
        return v_flex().id(`route-decision-${i}`).gap(3).p(6).rounded(5).bg(current(request) ? t.selected : t.surface)
          .when(current(request), row => row.border(1).border_color(t.border))
          .child(h_flex().gap(5).items_center().child(div().size(6).rounded_full().bg(sessionColor(request))).child(icon(request.agent || "Agent"))
            .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.foreground).font_semibold().tooltip(title).child(title))
            .when(current(request), row => row.child(text("当前会话", t.accent, 9).font_semibold())))
          .child(h_flex().gap(4).items_center()
            .child(div().min_w(0).truncate().text_size(11).text_color(t.accent).font_semibold().tooltip(actualModel(request)).child(actualModel(request)))
            .when(Boolean(route?.group), row => row.child(text(`（${this.groupNames[route.group] || route.group}）`, t.muted, 10))))
          .child(text(`原因 · ${reason}`, t.muted, 10))
          .child(text(`回答中 · ${((request.ms || 0) / 1000).toFixed(1)} 秒`, t.working, 9));
      });
      const sessionId = currentSession || active[0]?.session || requests[0]?.session;
      const session = (usage?.sessions ?? []).find((item) => item.id === sessionId);
      const promptTokens = session ? (session.input || 0) + (session.cache_read || 0) + (session.cache_write || 0) : 0;
      const sessionMetrics = session ? [
        `${session.calls} 次请求`,
        `${countTokens(promptTokens + (session.output || 0))} token`,
        promptTokens ? `缓存 ${Math.round((session.cache_read || 0) * 100 / promptTokens)}%` : null,
        session.decode_ms > 0 ? `${Math.round((session.decode_out || 0) * 1000 / session.decode_ms)} token/秒` : null,
        session.unpriced ? `已计价 ≈$${Number(session.cost || 0).toFixed(3)} · 部分未计价` : session.cost != null ? `≈$${Number(session.cost).toFixed(3)}` : null,
      ].filter(Boolean).join(" · ") : "该时间段暂无统计";
      const rows = requests.map((request, i) => {
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
        { id: "graph", name: "全部活动路由", extra: () => text(`${active.length} 个处理中`, t.dim, 10), view: () => div().flex().justify_center().child(graph) },
        { id: "quotas", name: "来源额度", extra: () => div().id("quota-manage").cursor_pointer().text_size(10).text_color(t.accent).on_click((_e, next) => { this.editQuotas = !this.editQuotas; next.notify(); }).child(this.editQuotas ? "完成" : "隐藏 / 显示"),
          view: () => div().id("provider-quota-list").w_full().child(this.providerQuotas(t)) },
        { id: "usage", name: "用量概览", extra: () => text(PERIODS.find(([id]) => id === this.period)?.[1] || "本期", t.dim, 10), view: () => this.usageOverview(t) },
        { id: "decisions", name: "实时路由", extra: () => text(`${active.length} 个处理中`, t.dim, 10), view: () => v_flex().gap(6)
          .when(!currentSession, body => body.child(text("无法识别当前会话", t.dim, 10)))
          .when(Boolean(currentSession) && !currentRoutes.length, body => body.child(text("当前会话暂无进行中的请求", t.dim, 10)))
          .children(activeRows) },
        { id: "session", name: currentSession ? "当前会话" : "最近会话", extra: () => text(PERIODS.find(([id]) => id === this.period)?.[1] || "本期", t.dim, 10),
          view: () => v_flex().gap(4).p(8).rounded(6).bg(t.raised).child(text(sessionId ? `${session?.agent || focusedType || "Agent"} · ${sessionId.slice(-8)}` : "尚无会话", t.foreground, 10)).child(text(sessionMetrics, t.muted, 10)) },
        { id: "requests", name: `最近请求 · ${requests.length}`, extra: () => div().id("route-mask").text_size(10).text_color(t.muted).cursor_pointer()
          .on_click((_e, next) => { this.maskAccounts = !this.maskAccounts; localStorage.setItem("magpie-live.mask", String(this.maskAccounts)); next.notify(); }).child(this.maskAccounts ? "账号已隐藏" : "隐藏账号"),
          view: () => v_flex().gap(6).children(rows).when(!requests.length, body => body.child(text("等待请求", t.dim, 11))) },
      ];
      const ids = sections.map((section) => section.id);
      const order = [...new Set(this.overviewOrder.filter((id) => ids.includes(id))), ...ids.filter((id) => !this.overviewOrder.includes(id))];
      const sectionView = (id) => {
        const section = sections.find((item) => item.id === id);
        const fixed = this.pinnedSections.includes(id);
        return v_flex().id(`overview-section-${id}`).relative().p(6).border_b(1).border_color(t.border).bg(t.surface)
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
              localStorage.setItem("magpie-live.overview-order", JSON.stringify(updated));
              this.pinnedSections = fixed ? [...new Set([...this.pinnedSections, from])] : this.pinnedSections.filter((item) => item !== from);
              localStorage.setItem("magpie-live.pinned-sections", JSON.stringify(this.pinnedSections));
              next.stop_propagation();
            }
            next.notify();
          })
          .child(h_flex().items_center().gap(4).pb(4)
            .child(div().id(`overview-drag-${id}`).size(18).flex_none().flex().items_center().justify_center().cursor_grab().text_color(t.dim).tooltip("拖动排序").role("button").accessibility_label(`拖动${section.name}排序`)
              .when(this.draggingSection && this.pressedSection === id, handle => handle.cursor_grabbing())
              .on_mouse_down("left", (event, next) => { next.stop_propagation(); this.pressedSection = id; this.sectionPressPosition = event.position; this.overSection = null; this.draggingSection = false; })
              .on_click((_event, next) => next.stop_propagation()).child("⋮⋮"))
            .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.foreground).font_semibold().child(section.name))
            .when(Boolean(section.extra), row => row.child(section.extra()))
            .child(h_flex().gap(2).items_center()
              .when(this.hoveredSection === id, row => row.child(div().id(`overview-hide-${id}`).size(18).flex().items_center().justify_center().rounded(4).cursor_pointer().text_color(t.dim).hover(style => style.bg(t.hover).text_color(t.foreground)).tooltip("隐藏区块")
                .on_mouse_down("left", (_event, next) => next.stop_propagation())
                .on_click((_event, next) => { next.stop_propagation(); this.hiddenSections = [...this.hiddenSections, id]; localStorage.setItem("magpie-live.hidden-sections", JSON.stringify(this.hiddenSections)); next.notify(); })
                .child(svg("mods/workspace-chrome-personal/x.svg").size(12))))
              .when(this.hoveredSection === id || fixed, row => row.child(div().id(`overview-pin-${id}`).size(18).flex().items_center().justify_center().rounded(4).cursor_pointer().text_color(fixed ? t.accent : t.dim).hover(style => style.bg(t.hover).text_color(t.foreground)).tooltip(fixed ? "取消固定" : "固定到顶部")
                .on_mouse_down("left", (_event, next) => next.stop_propagation())
                .on_click((_event, next) => { next.stop_propagation(); this.pinnedSections = fixed ? this.pinnedSections.filter((item) => item !== id) : [...this.pinnedSections, id]; localStorage.setItem("magpie-live.pinned-sections", JSON.stringify(this.pinnedSections)); next.notify(); })
                .child(svg("mods/workspace-chrome-personal/pin.svg").size(12))))))
          .child(section.view());
      };
      const visible = order.filter((id) => !this.hiddenSections.includes(id));
      const pinned = visible.filter((id) => this.pinnedSections.includes(id));
      return v_flex().id("magpie-live-root").size_full().min_h(0).bg(t.surface)
        .on_hover((hovered, next) => { if (!hovered && this.pressedSection) { this.pressedSection = null; this.overSection = null; this.draggingSection = false; next.notify(); } })
        .on_mouse_up("left", (_event, next) => { if (this.pressedSection) { this.pressedSection = null; this.overSection = null; this.draggingSection = false; next.notify(); } })
        .on_size_change((size, next) => { if (this.width !== size.width || this.height !== size.height) { this.width = size.width; this.height = size.height; next.notify(); } })
        .child(header)
        .child(h_flex().justify_between().items_center().px(10).py(7)
          .child(text(`${PERIODS.find(([id]) => id === this.period)?.[1] || "本期"} ${usage?.calls?.toLocaleString() ?? "—"} 次调用`, t.muted, 10))
          .child(text(`${this.active.length} 个处理中`, this.active.length ? t.working : t.dim, 10)))
        .when(Boolean(this.error), body => body.child(card(t).child(text(`连接异常 · ${this.error}`, t.blocked))))
        .when(Boolean(this.recentError), body => body.child(text(`请求记录暂不可用 · ${this.recentError}`, t.blocked, 10)))
        .when(this.hiddenSections.some((id) => ids.includes(id)), body => body.child(h_flex().px(10).pb(4).gap(5).items_center().flex_wrap()
          .child(text("已隐藏：", t.dim, 10))
          .children(order.filter((id) => this.hiddenSections.includes(id)).map((id) => div().id(`overview-restore-${id}`).cursor_pointer().text_size(10).text_color(t.accent).tooltip("恢复区块")
            .on_click((_e, next) => { this.hiddenSections = this.hiddenSections.filter((item) => item !== id); localStorage.setItem("magpie-live.hidden-sections", JSON.stringify(this.hiddenSections)); next.notify(); }).child(`+ ${sections.find((item) => item.id === id).name}`)))))
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
      .on_click((_e, next) => { this.maskAccounts = !this.maskAccounts; localStorage.setItem("magpie-live.mask", String(this.maskAccounts)); next.notify(); })
      .child(this.maskAccounts ? "账户打码" : "显示账户");
    const quotaViewButton = div().id("magpie-quota-view").px(7).py(5).rounded(5).bg(t.surface).text_color(t.muted).text_size(10)
      .on_click((_e, next) => { this.showRemaining = !this.showRemaining; localStorage.setItem("magpie-live.remaining", String(this.showRemaining)); next.notify(); })
      .child(this.showRemaining ? "剩余" : "已用");
    const trend = (usage?.series ?? []).slice(-20).map((point, i, points) => {
      const max = Math.max(1, ...points.map((p) => Number(p.calls) || 0));
      const height = (Number(point.calls) || 0) > 0 ? Math.max(3, Math.round((Number(point.calls) || 0) / max * 34)) : 0;
      return div().id(`usage-bar-${i}`).flex_1().h(height).rounded(2).bg(t.accent).tooltip(`${point.label}: ${point.calls} 请求`);
    });
    return v_flex().id("magpie-live-root").size_full().min_h(0).bg(t.surface)
      .on_size_change((size, next) => { if (this.width !== size.width) { this.width = size.width; next.notify(); } })
      .child(header)
      .child(h_flex().justify_between().items_center().flex_wrap().gap(5).px(8).py(7).child(periods).child(h_flex().gap(3).child(quotaViewButton).child(maskButton)))
      .child(div().flex_1().min_h(0).overflow_y_scrollbar().child(v_flex().gap(9).p(8)
        .when(Boolean(this.error), body => body.child(card(t).child(text(`数据暂不可用 · 保留上次成功数据。${this.error}`, t.blocked, 10))))
        .child(heading("用量概览", `${usage?.since ? new Date(usage.since).toLocaleDateString() : ""}`))
        .child(this.usageOverview(t))
        .child(card(t).child(heading("请求走势", "本周期")).child(h_flex().h(42).gap(2).items_end().children(trend)))
        .child(heading("额度", `${this.quotas?.length ?? 0} 个来源`))
        .children(this.quotaCards(t))))
      .child(h_flex().justify_between().px(10).py(7).border_t(1).border_color(t.border)
        .child(text("本机只读 · 不修改路由配置", t.dim, 9))
        .child(text(this.readAt ? `上次成功读取 · ${new Date(this.readAt).toLocaleTimeString()}` : "等待首次读取", t.dim, 9)));
  }
}
