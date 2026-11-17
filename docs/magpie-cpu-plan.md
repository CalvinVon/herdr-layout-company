# Magpie 面板 macOS 高 CPU：源码分析与优化方案

取材日期：2026-11-17。范围：生产 Magpie 源码、资源、Herdr 本地接口契约，以及指定备份。只读调查；本报告是唯一写入的文件。未修改生产或备份实现，未重启、重载应用，未采样、切换布局或运行性能实验，未派生 agent。

## 1. 结论与证据边界

**整窗重绘不等于所有 mod 每帧重新执行 JavaScript `render()`。** 当前 gpui-kit 明确缓存 View 的描述，失效时才重新执行脚本；原生动画可以在不调用脚本的情况下持续绘制。应分别优化“每次失效的 JS 重建成本”和“每个绘制帧的原生布局/绘制成本”。不能把 `usageChartData()`、排序、SVG 解码都算成每帧必做。

**最有依据的成本放大机制**：Magpie 在活动路由存在时，每 160ms 更新 retained `RouteDots` 的 props；圆点的 left/top 又各执行 160ms 原生 transition。这可形成近乎连续的动画绘制需求，整窗绘制会让其他可见区域共同承担成本。圆点子 View 已隔离 JS 重建；再拆一次圆点并不能消除整窗 paint。这个机制只解释满足守卫条件的活动路由场景，不能解释所有空闲 CPU。

**usage 热点尚未被证明**：`usage` 是“用量概览”，`usage-trend` 才是柱状走势，顶部“用量”又是另一个完整页面。概览为 31–41 个逻辑元素；30 点且完整对照的走势约 123 个，其中 30 个挂 tooltip。历史额度每个窗口另可有 24 根柱子。需明确上次隐藏的是哪个对象。未确认成功重载的 108%→50% 不能作为某函数消耗 58 个百分点的归因。

**明确可改的源码问题**：隐藏 graph/decisions/requests 后，父 render 仍先构建这些树；quota 分组和历史查找重复；数据签名遗漏影响 UI 的字段。优先消除这类无信息损失的工作，再优化柱形图原生元素数量，最后评估改变动画观感。

此范围没有 Herdr Rust 实现或实时计数器，不能给出 JS、布局、paint、GPU 提交各自的实测占比，也不能宣称已经定位 macOS 专属缺陷。

### 1.1 用户提供的运行观测（本次未复测）

| 条件 | CPU 观测 | 能支持的结论 / 限制 |
|---|---:|---|
| M3 Pro，3456×2234 Retina，ProMotion 120Hz，zoom 0.9，Magpie 可见 | 100–110% | 是本次分析的工作负载背景；实际窗口像素面积、绘制帧率未记录 |
| 同窗隐藏 Magpie | 约 70% | Magpie 的可见树或绘制触发源有贡献；不能拆分二者 |
| 隐藏 Office / 侧栏 | 各约减少 10 个百分点 | 支持多个可见 UI 共同产生开销；不能跨实验简单相加 |
| 全部自绘面板隐藏、空标签页 | 25% | Magpie 不是全部原因；空白场景仍有基础开销 |
| 最小化 | 17% | 支持可见绘制存在额外成本；仍有非可见工作 |
| herdr-core | 1–3% | CPU 主体在窗口进程一侧 |
| 某次隐藏 usage | 108%→50% | 重载未确认，归因不成立，保留为待验证线索 |
| Windows 同布局 | 4.1%，404MB | CPU 分母、核数、DPI、刷新率、版本和数据未对齐，不能直接计算平台倍率 |

macOS 活动监视器的进程 CPU 通常按单个逻辑核 100% 计；Windows 任务管理器常按整机总容量归一化。需先确认统计工具和逻辑核数。120Hz 是屏幕能力，不是已观测到 Herdr 正以 120fps 绘制；Retina 像素量和缩放是潜在放大因素，不是源码已经证明的原因。`TerminalView::ingest → Vt::write` 采样证明那次采样存在终端输入处理，不能代表全部时间；空标签页仍高说明它不足以单独解释现象。

### 1.2 取材一致性

生产与备份 `main.js` 经只读 `diff -q`、SHA-256 核对，字节一致；两个 `usage-comparison.js` 经 `diff -q` 一致。以下证据针对取材时磁盘快照，**不证明正在运行的 mod 成功加载了该快照**。

| 文件 | SHA-256 |
|---|---|
| 生产及备份 `main.js` | `81baa78449afd084987d16405e30757d2b7d4ab2cf1ce1c4ce8bc370ce39abb0` |
| 生产 `usage-comparison.js` | `def85ecc3890d62dd298cf843c53fa2635fb409e464bc648f218a1ca449a1348` |
| `AGENTS.md` | `429d3c9d5bfe4670ac3c7ec3b1fb8a2dd4b26b82666709ce164a17733fdd66d4` |
| `gpui-kit.d.ts` | `6e516b9cc8b272a9d697e35487783d950a2f6be95f1574d011a1fd78c97dc19a` |
| `herdr.d.ts` | `5dd5388abe811467d94edf9e3427730614d581348087758f28afc26565affbe3` |

## 2. Herdr 重绘语义：原文与判断

### E01：整窗 redraw 与脚本 render 是两层

[AGENTS.md:893](/Users/didi/.config/herdr-app/AGENTS.md:893)，L893–902 原文：

> **Animate natively, never with a timer.** Every redraw of a mod redraws
> the whole window, so `cx.timer.every(90, () => cx.notify())` for a
> spinner costs real battery. Use `.frames(["⠋", "⠙", …], 90)` (shows
> each string in turn as the element's text), `svg(arc).spin(900)` (turns
> an icon once every 900 ms: a ring spinner, e.g.
> `mods/workspace-chrome/spinner.svg`), or `.loop("opacity", { from:
> 0.4, to: 1, period: 1200 })` (also width, height, left, top), and
> `.transition(...)` for changes: they run without your script and stop
> when not shown. Timers are for data (a clock, a fetch), and only as often
> as what they show changes.

[gpui-kit.d.ts:536](/Users/didi/.config/herdr-app/gpui-kit.d.ts:536)，L536–539 原文：

> `init` runs once when the view is created. `render` returns one element,
> retained entity or string, and runs when the view is invalidated — by
> `cx.notify()`, a reload, or a theme change — not on every frame. Never
> store an element on the instance: it belongs to the render that built it.

判断：普通绘制帧不能推出所有 mod 的 JS render 都执行。整窗原生处理是否逐一重算所有布局、是否缓存具体图元，接口没有承诺；应将原生 layout/prepaint/paint/提交合称待测绘制侧成本，不宣称每个节点每帧都重新光栅化。

### E02：notify 与 retained 子 View

[gpui-kit.d.ts:289](/Users/didi/.config/herdr-app/gpui-kit.d.ts:289)，L289–294：

> Requests a re-render of the current view, or of one retained `Entity`.
> Pass a target after changing shared state that retained child reads. It
> invalidates that child's script description without invoking its
> `update(props)`; use `entity.set_props(props)` when the child must receive
> and process new props.

[gpui-kit.d.ts:368](/Users/didi/.config/herdr-app/gpui-kit.d.ts:368)，L368–370：

> The entity is a child wherever a child is taken: `.child(entity)`, or
> returned from `render`. Updating its props runs the child's optional
> `update(props)` and rebuilds only that child.

`cx.new` 只允许 init/事件/任务内创建，render 内禁止（L372–375）。Entity 可保留，普通 Element 不可跨 render 缓存（L588–594）；字符串也是元素（L608–617）。缓存优化只能保存普通派生数据、不可变 Path 或 retained Entity，不能把 `this.chart = this.usageChart(t)` 当缓存重复挂载。

### E03：哪些事件会扩大 JS 重建范围

[AGENTS.md:868](/Users/didi/.config/herdr-app/AGENTS.md:868)，L868–871：

> `main.js` default-exports a class extending `View`. `init(props, cx)` runs
> once; `render(cx)` describes the UI and runs again after `cx.notify()` and
> whenever Herdr's live data changes (spaces, agents, terminals, focus,
> theme, shared state). Don't poll those.

[AGENTS.md:992](/Users/didi/.config/herdr-app/AGENTS.md:992)，L992–994：

> This copy: `props()`, `shared(key)` / `setShared(key, value)` (every mod
> sees it; setting re-renders all), `nextCommand()` (key commands for this
> mod: `cx.spawn(async (cx) => { for (;;) { const c = await nextCommand(); …; cx.notify(); } })`).

[herdr.d.ts:389](/Users/didi/.config/herdr-app/herdr.d.ts:389)，L389–393：

> Reads a value every mod can see (persisted).
> `export function shared(key: string): unknown;`
> Sets a shared value; every mod re-renders so it can react.
> `export function setShared(key: string, value: unknown): null;`

准确说法是 **`setShared` 写入使所有 mod 重渲染**；仅 `shared()` 读取不会触发它。Magpie 当前既不导入也不调用这两个 API。其他 mod 是否高频写共享状态未在本范围检查，不能把全局失效归咎于 Magpie。实时数据失效可能高频，但终端每个字节或每次 ingest 是否都广播给全部 mod，也不能从这些声明推定。

### E04：原生动画、tooltip 与生命周期

| 契约 | 精确含义 |
|---|---|
| [gpui-kit.d.ts:1199](/Users/didi/.config/herdr-app/gpui-kit.d.ts:1199)，L1199–1202 | transition/spring 的后续目标变化完全由 native GPUI 动画；没有给 transition 声明固定 fps |
| [gpui-kit.d.ts:1204](/Users/didi/.config/herdr-app/gpui-kit.d.ts:1204)，L1204–1218 | frames 按指定间隔切换文字，render 不为它运行、仅绘制时运行；loop/spin 原生约 30fps、仅绘制时运行；慢周期不等于低绘制帧率 |
| [gpui-kit.d.ts:21998](/Users/didi/.config/herdr-app/gpui-kit.d.ts:21998)，L21998–22014 | 可动属性仅 opacity/width/height/left/top；loop 有 from/to/period/easing，没有曲线路径、分段关键帧或相位参数 |
| [gpui-kit.d.ts:925](/Users/didi/.config/herdr-app/gpui-kit.d.ts:925)，L925–947 | tooltip 是静态字符串，停留半秒后显示；显示期间 tooltip layer 每个绘制帧重建内容，不是调用业务脚本生成 tooltip；没有承诺 tooltip 自己持续请求帧 |
| [AGENTS.md:787](/Users/didi/.config/herdr-app/AGENTS.md:787)，L787–800 | mod 文件保存触发各副本 reload；失败保留旧版。隐藏副本不销毁，timer 继续；切换 layout 的生命周期不同 |

## 3. 当前实际调用路径与工作量

### E05：调用频率，而非“所有工作每帧发生”

[main.js:94](/Users/didi/.config/herdr-app/mods/magpie-live/main.js:94)，L94–127；[RouteDots.render:28](/Users/didi/.config/herdr-app/mods/magpie-live/main.js:28)，L28–43：

- `init` 创建一个 `motionView = cx.new(RouteDots, ...)`。
- 160ms timer（理论最多 6.25 次/秒）仅在 routing 页、graph 未隐藏、有待显示或待清空路径、顶层 `magpie-panel` 可见且窗口 active 时 `set_props`。它重建圆点子 View，不要求重建 Magpie 父树。
- 子 View 每次执行 `paths.map`，计算分段进度、三次插值坐标，构建一个根和每路由一个圆点，挂两条 160ms transition。绘制帧中间插值交给原生。
- `visible()` 只查顶层 `layout().children` 的 `magpie-panel`；不是通用祖先可见性/滚动视口判断。graph 滚出可视区域但区块未隐藏时，timer 仍可能更新 props。原生动画“仅绘制时运行”与此 JS timer 守卫是不同机制。
- 数据每 5000ms 刷新；另一个 1000ms timer 只检查隐藏后恢复的延迟刷新。它们不是每秒/每五秒必然 `notify`：主刷新做 signature 判定，recent 子任务也比较数据再通知。
- 父 render 还因 live data、交互、hover、尺寸变化失效。区块 `on_hover`（L659）修改 hoveredSection 后通知父树；拖拽和 on_size_change 有差异守卫，不是无条件每帧通知。
- `nextCommand` 循环末尾 notify；某些 setter 已 notify，可能重复请求，是否被 host 合并未知，不能据此数成两个实际帧。
- 此源码没有 `.loop/.spin/.frames` 调用。`usageChart/usageOverview/quotaCards` 都没有自带动画。活动为空时不存在持续圆点动画源，不能拿该 timer 解释空闲的全部 CPU。

### E06：每次父 render 的派生计算

| 路径 | 重复工作、上界与真实触发时机 |
|---|---|
| `usageChart` L426–465 → `usageChartData` L43–53 | 每次 chart builder 执行创建 Date，计算当前小时、slice/map；最多 30 个点；再 flatMap 求最大值、some 查对照/未计价、查指标名、逐点格式化 tooltip 和柱高。为 O(N)，N≤30；没有 PathBuilder |
| `usageOverview` L407–424 | Token 求和、缓存命中率、数字/币种格式化；四个 metric。只读取 `this.comparison` |
| `refresh` L224–248 → `usageComparison` L17–36 | comparison 在数据刷新时算，不在 render 中重算。baseline/覆盖起点按 base+range 缓存 60 秒。范围日期/比例运算为固定工作；不能列为每帧成本 |
| routing `render` L485–556 | active 映射复制、构建 Set、recent 去重并截到24、agents/find、来源/provider 去重、路径坐标 indexOf、会话颜色登记。active 没有24条上限，图和实时路由都随 active 增长 |
| routing `line` L528–531 | 每个不同 source/provider 建一个 `PathBuilder.stroke` 三次 Bézier，再 `window.paint_path`；路径数 S+P，不是每条请求三条。每次父 render 重新建，不是圆点每 tick 都重建 |
| routing L573–626 | 查会话统计；active 两次 filter，把当前会话排前；构建 activeRows 和最多24条 requests；每行日期与字符串格式化、展开尝试列表 |
| `providerQuotas` L343–396 | provider 去重/顺序合并；每个 provider filter 全部 quotas；每个额度 entry find 历史，再 find 额度线；`[...points].reverse().find(...)` 复制并倒序扫描历史，解析 reset/start、计算 pace。有 O(provider数×quota数)、O(entry数×历史行数) 和历史点扫描 |
| `quotaCards` L304–340 | 每个 quota 查历史、每个窗口查线并 slice(-24)，最多24根历史柱；格式化 reset/readAt；本页历史柱没有 tooltip |
| routing L646–720 | 六个区块的顺序合并、filter/includes/find、固定/未固定分组；拖动时 splice 改顺序。**没有 `.sort()`**；所谓“排序成本”实际是数组过滤/重排，通常小于大列表构建 |

[usage-comparison.js](/Users/didi/.config/herdr-app/mods/magpie-live/usage-comparison.js:43) 对 today 只显示已到的小时含当前小时；非 today 截最近30点。可比较条件同时要求 chart period 与主 usage period 相同且 comparison 存在，不能把所有30点都默认算作双柱。

### E07：隐藏并不等于不构建

`graph`（L557）、`activeRows`（L584）、`rows`（L602）在 `sections` 定义和 `visible` 过滤前已构建。`section.view` 的闭包只延后挂载这几个已有对象；隐藏它们仍做 JS 计算和 builder 调用，最终不挂载的树不能计作可见 paint 节点。相反，`providerQuotas/usageOverview/usageChart` 是在对应 `section.view()` 内调用，隐藏其区块会跳过 builder。顶部 usage 页面走 L726–749，完全不走 routing 分支。

### 3.1 元素数量：可复算的区块统计

计数口径：B 为显式 builder 元素（div/h_flex/v_flex/svg/image/paint_path 各算1），T 为 `.child(字符串)` 产生的文本元素；逻辑总数为 B+T。按照 E02 字符串也是元素。链式样式不增加 B；Entity 句柄不另加1，其 `render` 返回的树单独计入。未计 host 内部 tooltip/scrollbar/无障碍实现节点，也不将 Path 内的线段算成 UI 元素。**这是源码逻辑树计数，不是实测 draw call 数。** 缺实时数据，使用参数式而不是虚构现场总数。

| 区块/状态 | B | T | 说明 |
|---|---:|---:|---|
| routing 页公共外壳 | 17 | 8 | 含顶部标题/tabs、统计行、普通滚动容器、底栏；固定区域另+2B，错误/恢复控件另计 |
| 每个总览区块标题及外框 | 7 | 4 | 六区块全开合计42B+24T；hover 关闭按钮另+2B；拖拽落点线另+1B；区块正文不在此行 |
| `usageOverview` 无比较文案 | 19 | 12 | 合计31，四个 metric，各4B+3T，外层/两行3B |
| 同上，7/30天但无可比数据 | 23 | 16 | 合计39，四项均加“暂无可比较数据” |
| 同上，有 comparison | 24 | 17 | 合计41，四项对比及底部 note |
| `usageChart` 非空 | `20+2H+2N+K+X` | `10+H+X` | N≤30；K为有前期值的点数；H=K>0时1，否则0；X为“最近30时段”与未计价说明数量0–2 |
| 同上，30点无对照、X=0 | 80 | 10 | 合计90；其中 bars容器及各组61B |
| 同上，30点全有对照、X=0 | 112 | 11 | 合计123；其中 bars容器及各组91B |
| 同上，等待/空数据 | 12 | 7 | 两行选择控件仍在，加一条状态文字；不画图例/柱/端点 |
| graph 正文（含居中 wrapper、RouteDots树） | `5+4S+5P+A` | `S+P` | S/P分别是不同source/provider数，A是挂载的圆点数；静态线S+P、图标S+P+1 |
| graph 无活动路由 | 7 | 1 | 上式S=P=A=0，再加空状态容器和文本 |
| decisions 正文 | `1+Σ(9+c+g+2f)+6z` | `Σ(4+c+g+f)+4z` | 每条active：c当前会话标记、g路由组、f首条当前会话统计，各0/1；z无当前活动请求时的fallback卡片0/1 |
| requests 正文 | `1+Σ(9+c+2m+e)` | `Σ(5+c+m+d)` | 最多24条；c当前标记、m有metrics；展开时e=1+d，d为组名/尝试/无详情提示的文字条数，否则e=d=0；空列表另+1B+1T |
| `providerQuotas` 非空外层 | 3 | 0 | 两列容器+外层；每provider加4B+1T，再加箭头/编辑控件 |
| provider 每条正常额度 entry | `4+w+2b` | `2+w` | w有window，b有可绘制remaining进度条，各0/1；典型window为7B+3T；编辑态为4B+2T |
| 顶部 usage 页公共外壳 | 32 | 18 | 含三组heading、周期/打码/已用按钮、滚动与底栏；不含概览、走势、quotaCards；错误态另计 |
| `quotaCards` 每个quota基础 | 5 | 3 | 卡片、标题行、name/plan、更新时刻；账号/余额/错误/无窗口/重置卡每条额外+1B+1T |
| 每个quota window基础 | 6 | 2 | 名称/数值行与双层进度条；reset、holdsWhy每条+1B+1T |
| 每window历史柱（点数L>1） | `2+L` | 1 | L≤24；“最近24次”文字+柱行+每点一柱；满24时26B+1T |

provider 箭头每个+1B+1T，编辑provider显隐控件每个+1B+1T。恢复隐藏区块的行是2B+1T，每个恢复按钮另+1B+1T。上表不包含临时展开 tooltip 的 host 自有树。纯 repaint 沿用描述，不把这些 B 全数理解为新 JS 分配；父 render 失效时才重建对应 builder。

### 3.2 tooltip 注册数量

静态源码共有 **14 个 `.tooltip(...)` 调用点**，循环展开后的数量如下；“挂载目标”不是“同时显示14个或N个tooltip”。

| 来源 | 每次对应builder的 tooltip 调用数 | 位置 |
|---|---:|---|
| 图表 | N，最多30 | L458，每个时段组一个，前后期共享说明 |
| graph | S+P | L561、566，来源/provider节点 |
| active decisions | 2A | L592、595，标题和实际模型 |
| provider quotas 正常态 | a+E+W | L370、371、387、389；a为已显示provider箭头数，E为entry数，W为有window的entry数 |
| provider quotas 编辑态 | a+2E | label+显隐按钮，pace不显示；L390 |
| 总览区块 chrome | 2V+h | V可见区块数，每区块拖动/固定各1；h为当前hover的可见区块，0或1；L684、691、695 |
| 恢复控件 | D | D为已隐藏的有效区块数；L715 |
| usageOverview / quotaCards / requests | 0 | 无tooltip调用 |

routing 全部显示时，合计 `N+(S+P)+2A+(a+E+W)+2V+h`（正常额度态）；隐藏后只对挂载的区块计原生活跃目标，但 E07 的预构建图/实时行仍执行各自 `.tooltip` builder 调用。顶层 usage 页只有图表的 N 个tooltip。Tooltip 字符串在重建时格式化，鼠标未悬停时并没有每个目标都画一张浮层。

### 3.3 图标与资源

E08：[main.js:362](/Users/didi/.config/herdr-app/mods/magpie-live/main.js:362)，L362–365；[main.js:533](/Users/didi/.config/herdr-app/mods/magpie-live/main.js:533)，L533–541；[gpui-kit.d.ts:20277](/Users/didi/.config/herdr-app/gpui-kit.d.ts:20277)，L20277–20294。

`svg(path)` 是继承文字颜色的矢量mask；`image(path)` 保留全彩，也支持SVG。不能把 `image("*.svg")` 当成已经离线栅格化，也不能声称两个API每帧都重新解析文件；资源缓存/光栅化策略未在类型中说明。

| 本地资源 | 字节 / 结构 | routing icon helper | provider quotas |
|---|---|---|---|
| codex-color.svg | 1769，2 path、1 gradient | image，12px | image，14px |
| omp.svg | 240，1 path | svg | image |
| magpie.svg | 4956，1长path | svg；hub另固定svg 17px | image |
| deepseek-color.svg | 2164，1 path | image | image |
| grok.svg | 756，1 path | svg | svg |
| kimi.svg | 786，2 path | svg | svg |
| opencode.svg | 235，1 path | svg | svg |
| workbuddy-color.svg | 4119，4 path、2 rect、1 circle、2 gradient、1 GaussianBlur、2 clipPath | image | image |
| zcode.png | 8170，128×128 | image | image |

资源结构由只读 XML/PNG 头解析统计。两个 helper 对 omp/magpie 的选择不同，统一API可能改变颜色，不能当作无视觉变化的机械优化。graph有S+P+1个图标，decisions每active一个；provider quotas每显示provider一个。总览hover额外使用 `mods/workspace-chrome-personal/x.svg`；未知program来自 `agents().program.icon`，按tint选择，否则回退 `icons/program.svg`。这些外部资源未展开检查。用量概览、用量走势、顶部 usage 页的 quotaCards 本身均没有SVG/image；若热点被严格定位到该页，图标方案优先级很低。

## 4. 五个可实施方案（收益/风险排序）

顺序优先保留信息量和观感。预期收益均为源码依据，不是承诺 CPU 降幅。每个方案单独 A/B，通过后才组合；所有改动点都是后续实施位置，本次未改。

| 顺序 | 方案 | 主要收益层 | 风险 / 可见影响 |
|---|---|---|---|
| 1 | 隐藏区块延迟构建，缓存派生数据和路径 | JS重建 | 低–中；不改变信息或视觉，须正确失效 |
| 2 | 将图表/历史小柱批量画为少量原生Path | 原生元素、布局/paint | 中；保留数据和逐点tooltip；圆角、间距和缩放需对齐 |
| 3 | 按数据域失效，必要时增加两个retained子View | JS重建和无效通知 | 中；不改变信息，避免过度拆分和遗漏刷新 |
| 4 | 改变路由动效，停止持续坐标transition | 绘制频率+圆点JS | 收益可能高但仅活动场景；明确改变观感 |
| 5 | 条件性离线栅格化复杂全彩图标 | 图像处理/绘制 | 收益未证实、优先级低；缩放清晰度和主题风险 |

### 方案1：先跳过不挂载的工作，再缓存纯数据

**改动点**：`mods/magpie-live/main.js` 的 `render`（L485–626、627–720）、`providerQuotas`（L343–396）、`usageChart`（L426–465）、`refresh`；`usage-comparison.js` 的 `usageChartData` 保持算法语义。备份工作文件为 `/Users/didi/Documents/calvin/herdr-layout-backup/mods/magpie-live/main.js` 及同目录辅助模块；生产对应路径仅在未来正式发布时替换。

实施顺序：

1. 把 graph、activeRows、rows 的实际builder移入各自 `section.view` 调用路径；共享统计只计算当前已显示区块需要的部分。graph隐藏时清空/停用motion路径，恢复时从最新active重建，不能重放陈旧圆点。
2. `usageChartData`、max、flags、已格式化tooltip按 chart数据版本、baseline版本、可比较状态、metric、period/granularity、当前小时桶缓存；宽度和theme影响的几何/颜色另行失效。today跨小时必须失效，不能仅依赖对象引用。
3. quota/history刷新时建立provider分组及 `(provider,user)` 历史索引。最新匹配起点用倒序索引扫描代替 `[...points].reverse()`，保持“最新匹配”语义；配速仍按明确时间粒度（至少现有5秒刷新）更新。
4. graph几何按宽度、source/provider有序列表缓存不可变Path；paint元素每次render新建，色彩仍取当期theme。不为最多30点引入通用缓存框架。

**收益依据**：隐藏3个区块可令其builder调用从每次父render都发生降至0；重复数据派生从每次父失效降至相关数据/小时桶变化。Path构建可从每次父render的S+P次降至拓扑/宽度改变时S+P次。纯paint帧本来不执行这些函数，不能保证空闲CPU下降。

**可见影响与风险**：信息和视觉目标完全不变；风险是 stale tooltip、跨小时漏点、pace不随时间变、theme/resize不更新。不要缓存Element。现有baseline 60秒缓存无需再加第二层网络缓存。

**量化A/B**：按第5节协议，分别全开和隐藏graph/decisions/requests，保持相同数据和父失效事件。离线开发副本记录每个builder调用数、累计构建耗时、Path build次数；B隐藏时3者应为0，非变化数据派生次数应与刷新版本/时间桶变化一致。CPU中位数/高分位同时记录；若只有JS构建耗时下降而CPU不变，按此结果报告，不外推paint收益。校验恢复区块、跨小时、主题、窗口宽度、provider排序/显隐和pace数值一致。

### 方案2：批量绘制静态柱形，保留逐点信息

**改动点**：`main.js::usageChart` L453–461、`quotaCards` L328–332；利用已有 `PathBuilder.fill/add_polygon/curve_to` 与 `window.paint_path`，无需新依赖。契约见 [gpui-kit.d.ts:20370](/Users/didi/.config/herdr-app/gpui-kit.d.ts:20370)、[gpui-kit.d.ts:20468](/Users/didi/.config/herdr-app/gpui-kit.d.ts:20468)。

用量图保留N个透明命中组及原tooltip，在同一relative图层以1个本期Path、最多1个前期Path绘制柱子；保留零值、最小2px柱高、max比例、1px gap、原对照透明度、图例/端点/未计价文案及accessibility_label。批量Path的多个闭合子路径对应各柱。初次布局后按实测图表宽度构建几何，后续仅宽度或数据变化时更新；不在render内notify。quota历史柱没有逐点tooltip，可由一条Path覆盖整组24柱。

**收益依据**：30点双柱的bars子树从91B（容器1+组30+柱60）变为33B（容器1+命中组30+Path2），少58个逻辑builder元素；单柱61B→32B。这不等于少58个GPU draw call，因为原本可能已批处理。每个24柱历史行可由行容器+24柱替换为承载容器+1Path，净少23个元素，保留标题。若需要额外宽度测量wrapper，需相应扣回节点收益。

**可见影响与风险**：目标不改变观感；必须保留1px圆角（可用曲线闭合路径），若先用矩形代替应明确作为“圆角改变”的版本，不可称像素一致。命中区必须与每组柱对齐，前期透明度应通过颜色/绘制策略保持，不让透明覆盖层吞掉无障碍信息。此方案减少树/布局工作，但可能增加Path三角化；必须实测才能裁决。

**量化A/B**：以7天、30天、小时模式以及单/双系列分别测试；总览 `usage-trend` 与顶部 usage 页分别跑。30点双系列要求B树计数91→33，tooltip目标仍30，逐点数值全量一致。固定鼠标在图外测CPU，再单独悬停同一点测CPU；记录 native layout/paint时间和帧数（有相应开发指标时），保持同帧率比较单位帧成本。按0.9 zoom、原Retina环境检查截图，尤其0值、小值、尾柱、长tooltip、未计价、resize、滚动、主题。若单位帧耗时不降则不保留改写。

### 方案3：修正数据失效，再按需隔离 usage/额度子树

**改动点**：`main.js::refresh` L176–200、245–269；`init` L97附近；`render/usageOverview/usageChart/providerQuotas/quotaCards`。不修改 `usageComparison` 的数学逻辑。

当前主signature为 `JSON.stringify([usage, quotas, active, routes, recent, error])`，遗漏 `chartUsage/chartError/comparison/history/groupNames/focusSession/readAt`。例如主周期“今天”、图表“按天”时，只有7天图数据修正且其他signature项相同，不保证触发更新；错误恢复、history新起点也可能等待无关失效才显示。**优化不能靠进一步漏通知压低CPU。**

先按可见输出建立数据域版本/签名，确保上述变化到达对应消费者；readAt只更新它实际显示的区域，不能简单把每次变化的时间戳塞入根signature导致固定5秒整树重建。recent子任务在routing显示请求时才需要影响相关内容；顶部 usage 页无需因近期请求变化重建用量树。异步结果仍保持现有period/granularity防串写检查。

若A/B计数确认父树因active/live focus等高频失效，再用 `cx.new` 在init创建 **UsageBlock、QuotaBlock两个** retained子View（可以定义在同一main.js）；只有相关数据/控件/主题/宽度变化才 `set_props`。事件或刷新任务负责更新props，不在render内更新子状态；保留稳定Entity身份。共享theme变化如何传播给子View须按实际host验证。不要一开始把六个小区块全部组件化。

**收益依据**：根受路由变化失效时，可避免重新执行usage点计算、quota历史扫描及对应builder；每个retained更新只重建子视图有E02契约支持。每5秒数据刷新仍可能需要整窗绘制，子View隔离不构成paint隔离。

**可见影响与风险**：信息不减少，并修复潜在刷新滞后。最大风险是漏依赖、父子状态不同步、period切换加载态错误；签名完整后notify可能反而增加，这是正确性成本，不应掩盖。

**量化A/B**：固定usage/quota，只改变active路由/焦点；记录父、UsageBlock、QuotaBlock render次数，B的后两者应仅在自身依赖或theme变化时增长，不能随每个route事件增长。再单独改变chartUsage、chartError、comparison、history、groupNames，要求相关可见输出在一次成功刷新后更新（基准轮询5秒加请求完成时间）。比较CPU和JS耗时，不承诺减少原生帧。未来运行既有 `usage-comparison-check.mjs`，另覆盖“主usage未变、chart/history变”和小时跨界的消费场景；本次只读了现有检查，未运行。

### 方案4：降低动效驱动的持续绘制（改变观感）

**改动点**：`main.js::init` L99–104、`RouteDots.render` L28–43、routing graph/motion状态 L542–572。保留当前active标记、source/provider关系、实际模型、请求计数及明细。

收益优先的版本：删除循环移动圆点及其160ms timer，保留静态连线、provider状态点和实时路由列表，数据变化才重画。**可见变化：不再有“流动传输”的动画，但业务数据不减少。** 若用户必须保留动态提示，采用原生 `.loop("opacity",...)` 脉冲作为次选；它消除6.25Hz JS坐标重建，但仍约30fps绘制，不能保证和静态版相同的节能收益。

不能把当前曲线运动直接替换为 `.loop("left")/.loop("top")` 并声称等价：当前有三段曲线、请求间350ms相位、当前位置/非当前dimmed状态；LoopPolicy没有路径、分段或相位参数。也不要只把timer从160改500而保留500ms全程transition——那仍可能连续画帧。

**收益依据**：静态版可消除Magpie自身该动画的持续帧需求和每秒最多6.25次圆点子View重建，可能连带降低整窗绘制成本；若Office/光标/其他mod仍驱动持续帧，收益会被限制。无active的场景预期收益接近0，不能把可见100–110%到隐藏70%的差额全部当作动画可回收量。

**量化A/B**：分无active和固定数量active两组，且graph在视口内；当前动画A、静态B分别记录帧率、圆点render/s、CPU中位数/高分位。B圆点render/s应为0，active数据/路由列表值不变。再分别保留和隐藏其他动画区块，区分“取消Magpie唯一帧源”与“窗口本来就在重画”。测试失焦、graph滚出、隐藏、切usage页，确认不再有该timer回调；这是未来验证，不在本次操作生产窗口。

### 方案5：仅在测得图片栅格化热点时处理全彩图标

**改动点**：`main.js::ICONS` L9、routing `icon` L533–541、`providerQuotas` L362–365；对应资产首先是 `workbuddy-color.svg`，其次实际采样确认昂贵的全彩SVG。全部在开发副本处理。

离线生成足够Retina分辨率、透明背景的PNG（例如覆盖12/14逻辑px所需物理像素，并验证缩放）；替换具体的 `image` 路径，保留原全彩。单色svg、hub主题着色保留。不要为这一项引入运行时转换、base64内联或每帧重建SVG字符串。

**收益依据**：Workbuddy含blur/gradient/clip，离线烘焙能消除首次或尺寸/缓存失效时的SVG滤镜处理；但host若已有稳定图片缓存，稳态收益可能很小。当前源码没有证据说明图标每帧解码，因此此方案只在后续原生采样确认对应热点时实施，不是主修复。

**可见影响与风险**：目标原色不变；超出预备分辨率放大会变糊，主题tint语义必须保留。不能统一把omp/magpie两处用法互换，否则可能改变颜色。

**量化A/B**：同provider列表、同数量、同12/14/17px显示尺寸和相同缩放，区分首显与稳定60秒；比较资源解码/栅格化次数、CPU、内存及截图清晰度。没有稳态收益就不扩大资产替换范围。顶部usage页无图标，不能拿该页CPU改善作为此方案证据。

## 5. 后续统一A/B协议（本次未执行）

1. **隔离与版本**：在后续获准实施时使用开发副本/独立测试窗口；不直接编辑生产mod。A保留本报告哈希版本，B每次只启用一个方案。记录host版本、文件哈希与成功加载的build标识；`herdr-app check`只证明初始描述合法，不能证明运行窗口已载入。需观察B特有的测试build标识、检查status无reload错误，再开始采样。检查命令可能运行mod init，本次没有调用。
2. **固定条件**：同macOS机器、接电/电源模式、屏幕设置、窗口物理面积、zoom 0.9、主题、鼠标位置和滚动位置，关闭悬停tooltip作为基础组。路由/usage数据保持同一回放快照或匹配规模；真实数据不断变化时不能把时间差当优化收益。记录active数、S/P、quota窗口数、历史点数、chart N/K、可见/固定区块。
3. **明确对象**：分别记录 `overview-section-usage`、`overview-section-usage-trend`、顶部usage页。先在正确加载版本上复核单独隐藏实验；UI隐藏与改代码禁用是不同操作，前者还可能保留E07预构建开销。
4. **采样窗口**：每阶段稳定30秒后记录60秒；A-B-B-A重复两轮。空闲无请求和固定active分别测试；鼠标悬停另起一组。用同一工具同一CPU分母，报告中位数、p95和绝对百分点差，不只单个瞬时数字。差异小于同版本重复波动不认定胜出。
5. **拆开频率和单次成本**：开发副本以内存计数累计父render/s、RouteDots render/s、各builder调用数、Path build次数；不要每次render打印日志，日志本身产生终端输入和失效。原生帧率/单位帧layout与paint若有host指标则记录；没有就明确缺失，不能用JS render/s代替fps。CPU下降要注明来自少画帧、少JS工作还是两者兼有。
6. **功能验收**：四周期、小时/天、三指标、空数据/0值/未计价/无baseline、当天小时跨界、API错误恢复、history变化、账号打码、额度显隐/排序、区块拖动/固定/恢复、请求展开、当前会话识别、主题/尺寸变化均应保持。全量数据与tooltip文字一致；方案4单列动效变化；方案5检查Retina清晰度。
7. **收敛**：优先保留1的确定性删工；2仅在单位帧或总CPU改善且UI正确后保留；3以真实父失效频率决定是否引入retained子View；4由动画取舍决定；5须有资源热点证据。不要将各方案独立CPU降幅直接相加。

## 6. 不建议的做法与未覆盖部分

- 不通过长期隐藏usage、删除tooltip/前周期/历史数据来“优化”，这会减少信息量。Tooltip不是无障碍label的替代品，合并绘制也要保留辅助语义。
- 不首先使用虚拟列表改写六个区块或24条请求。`gpui-kit.d.ts` L20303–20330说明非等高list每个可见item每帧进入脚本；L20351–20361说明uniform_list也每帧调用可见范围renderer，且要求等高。它可能引入本来没有的每帧JS，并增加拖动、固定、展开交互改造成本。
- 不为最多30点优化比较数学公式；当前 `usageComparison` 根本不在render热路径。不要将“没有sort”误写为“每帧排序很多”。
- 不把所有svg改为image、不把native loop当作零paint成本、不把60Hz系统设置当代码修复。降低刷新率可作为独立后续诊断变量，但实际帧率和平台CPU分母必须先对齐。
- 未读取其他mod或Herdr Rust源代码，未检查GPU/资源缓存、Office动效、全局shared写入、窗口底层帧调度、终端摄取频率；这些可能解释剩余70%或空白25%，本报告不把它们归因给Magpie。

本次验证：读取完整main.js与usage-comparison.js、相关契约及现有usage检查源码；对比生产/备份、计算哈希；静态统计元素公式/14处tooltip/0处sort；解析本地SVG结构及PNG尺寸；LSP查询返回本项目未配置语言服务。没有运行测试或性能实验，因此方案收益仍须按第5节验证。

## 7. 实施记录：备份仓库候选（2026-11-17）

用户在分析完成后授权“开始执行”。本节记录后续实施，前文保留为原始分析快照及未执行的性能验证协议。生产 `~/.config/herdr-app` 未部署修改；应用未重启/重载，未运行 CPU 实验，未派生 agent，未提交或推送。

### 实施结果

| 方案 | 当前状态 | 具体实现 |
|---|---|---|
| 1：惰性构建与派生缓存 | 已实现 | `render` 将 graph、activeRows、rows 改为按可见区块调用的builder；隐藏图不扫描来源/provider；会话指标文本按需生成。`usageChart` 缓存点、最大值、柱高和tooltip，包含baseline、metric、可比状态与小时桶依赖；`quotaData` 建provider/user/window索引，倒序查最新有效起点并缓存历史趋势；静态路由Path按几何复用 |
| 2：柱形批量绘制 | 已实现，尚未通过实际视觉/CPU A/B | `chartBars` 以最多两条原生Path绘制用量柱，保留每时段一个tooltip命中组；额度历史以一条Path绘制。`appendBar` 保留1px圆角的三次曲线近似；零值不绘制、小正数保持2px下限，前周期保持0.45透明度。宽度使用on_size_change实测，几何缓存独立于theme颜色 |
| 3：失效正确性与隔离 | 数据失效已修复；未触发两大子View的条件性改造 | `notifyData` 纳入chart/error/comparison/baseline/history/group/focus与时间桶；按页排除无关路由数据，pace整数变化也触发更新。新增很小的 `ReadStatus` retained View，成功读取时间独立更新，避免为时钟重建整棵用量树。没有新增 UsageBlock/QuotaBlock，因为尚无高频父失效A/B证据 |
| 4：动效 | 已采用静态版 | 删除RouteDots、160ms timer、连续left/top transition与motion状态；保留静态连线、活动计数、provider状态点、当前会话高亮和请求明细。**观感变化：不再显示流动圆点** |
| 5：图标 | 条件未满足，不实施 | 无图片栅格化热点采样证据，保留原SVG/PNG和tint语义，避免无收益的资源替换 |

此次实现没有修改 `usage-comparison.js` 数学规则或图标。代码位置：[main.js](../mods/magpie-live/main.js)；回归与描述检查：[render-check.mjs](../mods/magpie-live/render-check.mjs)；原有数据检查：[usage-comparison-check.mjs](../mods/magpie-live/usage-comparison-check.mjs)。

### 已观察到的验证结果

- V2回归采用真实 `MagpieLive.refresh`，替换外部I/O和native宿主边界：主usage不变、chart响应改变时，原实现断言失败 `a chart-only response change must invalidate the visible panel`；修正失效依赖后同一断言通过（RED→GREEN）。
- 完整 `render-check.mjs` 通过：相同响应不通知routing；chart错误/恢复；route/recent-only变化不重建usage页；读取时刻子View更新；30点双系列共33个柱区描述元素、30个tooltip；零值/最小柱高/最大值；resize后的右边界；主题颜色；未计价；无对照；小时跨界；最新reset起点与随时间变化的pace；同尺寸history更新不丢失柱图；已用/剩余切换；隐藏路由不构建、恢复后可见；无动画级timer与transition。
- `node mods/magpie-live/usage-comparison-check.mjs`：`usage comparison checks passed`。
- `herdr-app check /Users/didi/Documents/calvin/herdr-layout-backup/mods/magpie-live`：`check passed`。这是离线原生检查，不是生产窗口重载。它只覆盖初始描述与eager元素，不覆盖后续真实布局、Path光栅化或tooltip悬停。
- Node的VM Modules输出实验性API提示，检查进程正常退出；没有吞掉异常或禁用断言。

### 验证边界与交接

测试执行真实业务类及comparison模块，GPUI/native绘制与外部请求在Node检查中由边界替身记录；因此33元素、30tooltip是描述级证据，不能充当GPU draw call、实际视觉一致性或CPU改善证据。原生check也没有证明数据加载后的Path缓存生命周期、缩放圆角或命中区在真实窗口中的最终效果。实际视觉属于 `visual-rendering` 未覆盖项，CPU收益属于 `performance-at-scale` 未覆盖项；继续保留第5节A/B验收条件，当前候选不声明已经完成生产验收。

只为读取时间新增一个retained子View，其余复杂拆分遵循报告中的证据条件。没有生成额外HTML说明；本节作为范围内的“目标→实现→证据→未决项”交接。ce-work观测begin返回 `host-project-binding-mismatch` / `capture: unavailable`，按技能要求停止后续观测调用；该缺口不改变本节已记录的实际工具结果。
