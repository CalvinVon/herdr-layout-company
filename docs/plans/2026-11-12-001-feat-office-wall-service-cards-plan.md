---
title: Herdr 项目办公室服务信息墙
type: feat
status: draft
date: 2026-11-12
---

# Herdr 项目办公室服务信息墙

## Summary

在现有 `agent-office` 项目房间墙面增加服务信息入口：自动发现本机服务终端中的地址及原始二维码，展示进程状态；固定的服务信息和手动添加的链接在本机按房间持久保存。此文是实施方案，功能尚未实现。

## Requirements

- R1：既有和新启动的本机服务侧边终端能自动发现；同时支持未带新标签的已有终端。按现有办公室项目分组，不将其他项目或远程机器的内容混入当前房间。
- R2：展示服务输出的 URL 和二维码，支持打开、复制、扫码。**原始二维码的载荷可能不同于旁边的 URL**：能恢复原始二维码时必须保持扫码内容一致，不能用猜测的 URL 冒充原码；手动链接可根据链接生成二维码。
- R3：服务输出变化后更新；可信的服务退出证据产生“已停止”；证据不足、连接中断、重新连接或进程身份不明确时显示“状态未知”，不能把终端仍存活当成服务仍运行。
- R4：固定服务信息及手动添加的链接可重启后保留，提供编辑、取消固定和移除；未固定的已停止卡片在当前应用会话内保留到用户移除。每台机器单独保存，不跨设备同步。
- R5：房间墙面可看到信息入口与状态，点击后可在足够大的原生面板查看和扫码；房间切换、卡片过多、窗口变窄时不遮挡现有装饰及桌椅。
- R6：不改变用户终端输入、尺寸、服务进程或启动命令；不保存整段终端输出。不得仅凭历史日志或扫描到的任意 URL 判定当前服务正在运行。

## Scope Boundaries

- 不实现跨设备同步、远程服务采集、图片附件、便签和项目构建状态。
- 不执行主动 HTTP 请求来推断服务状态；进程存在也不等同于服务健康。网络 URL 可被手机访问受设备、网络、防火墙及服务绑定地址影响；`localhost` 不作为手机可访问地址承诺。
- 不改变用户原有的服务启动流程，不把新标签或专用启动器作为现有服务自动发现的唯一前置条件。

## Key Technical Decisions

1. **入口和归属**：复用 `workspace.office-groups` 的本机 room 与 pane/terminal 关联。常规项目沿用既有 machine + projectKey；多目录 space 沿用现有 `space:<id>` 身份，不从当前工作目录重猜。扫描候选限定到本机非 agent 终端；结合当前前台进程及服务输出判断，不能把普通终端内任意网页链接直接作为服务。已有标签只作为加分证据，非必需。
2. **获取与恢复**：启动时和重连时从 `hc read --json --lines` 获取有限屏幕与历史，检查 `complete`；持续阶段优先用 `hc attach --observe` 只读增量输出，观察端不得输入或改变尺寸。`herdr.exec` 最长 30 秒且没有流式回调，故需要验证可控的本机观察进程及退出清理；不要假设 mod 内直接订阅输出。历史和流需去重、设内存上限；断流、窗口关闭或滚屏缺口均标记未知并重读，不能宣称完整无损。
3. **实例与状态**：卡片区分房间、终端地址及一次服务进程实例；终端消失/进程明确退出可标记停止。交互 shell 中的前台程序变化、同 PID `exec`、终端恢复为 shell、程序后台化等，不能仅靠 PID 或 `terminal.state` 断言；无法确认时标记未知。新实例需新的进程和输出证据，历史旧 URL 不得自动证明新实例存活；相同地址可建议关联旧固定卡但不覆盖用户内容。
4. **二维码**：URL 生成的码与终端输出原码为两种来源。原码优先保留其矩阵或经可靠解码后的原始载荷；对颜色反转、块字符/ANSI 和空白边界保真。原码不能可靠恢复时明确显示无法提取并提供打开原终端，不得替换成可能不同的链接码；实现前必须用真实 DRN 启动输出及载荷不同于相邻 URL 的样例验证。仅有终端图片协议而无文本矩阵的情况须经实际能力验证，不能假称已支持。
5. **本机持久化**：仅保存房间标识、卡片必要信息、用户固定/编辑状态和最后已知状态；不保存原始日志。采用 `appHome()` 下独立版本化文件，参照 `project-bindings.json` 的校验、原子写与冲突处理，不改内建 `terminal.pin`。读取/写入失败保留现有内容并在 UI 显示失败，禁止静默覆盖。

## Probe Results

- 实际本机终端 `t8j` 的前台程序为 `npm run serve:web`；`hc read --json --lines 200` 返回文本，其中存在 Local 和 Network 类型的地址。没有统一的服务标签，不能以新标签作为唯一发现依据。
- 使用当前项目已安装的 `qrcode-terminal` 在临时终端输出二维码和 URL：`hc read` 可读到 URL、14 行块字符，返回 `complete: true`、`how: history`。这只证明该一种文本二维码格式，不证明原截图的二维码可被准确提取。
- 临时服务运行时 `state=live`、地址可读取；进程退出并使用 `--rm` 时终端消失。另一个交互 shell 探针中服务退出后终端仍为 `live`，前台显示从 `zsh` 变为 `sleep`，PID 仍相同；PID/terminal live 均不足以单独确认服务状态。
- 对临时终端执行 `hc attach --observe`，成功收到随后输出的标记且自然结束；`hc schema` 描述 observe 为不输入、不调整尺寸。长生命周期宿主接入、恢复后连续性和溢出行为尚未验证。
- 对原截图分别尝试 Core Image 和 Vision 解码，包括反色裁剪；未识别到二维码，故其真实载荷与旁边链接是否相同仍未知。不能用此结果证明终端原码不可恢复。

## UX Design

墙面空闲处放与房间主题一致的紧凑信息牌，显示服务/固定链接数量及运行、停止或未知状态；点击打开原生详情面板。面板按服务和固定链接分组，服务卡展示名称、状态、Local/Network 地址及其来源，优先放可实际扫码的完整二维码；提供复制、打开、定位终端、固定/取消固定、移除。手动链接可增改删。二维码至少在详情面板达到手机可扫码尺寸，墙上缩略不能代替扫码验收。沿用现有房间横向布局、墙面几何及主题，避免将信息绘制在桌椅或其他装饰之上。

## Implementation Units

### U1. 本机服务观察与身份

**Goal:** 将当前项目房间里可识别的服务终端、输出和可置信状态形成只包含必要信息的本机快照。

**Requirements:** R1、R3、R6。

**Dependencies:** 无。

**Files:** 修改 `mods/agent-office/main.js`；按同目录 `projects.js` 约定新增服务观察模块；必要时新增本机只读观察助手；测试沿用 `mods/agent-office/self-check.cjs` 及相邻 self-check 约定。运行时目标是 `~/.config/herdr-app/mods/agent-office/` 的个人 mod，完成后同步回此备份仓库；先核对实际文件以保留用户修改。

**Approach:** 从现有项目分组取本机非 agent 终端；先观察现存无标签服务，再订阅新终端。建立受控只读观察生命周期、增量与历史交叠去重、最大缓冲区及重连快照；丢失/不完整时状态未知。关联当前前台命令、终端及项目；新旧实例分开，保护项目切换的异步回包。`hc attach --observe` 在当前探针可用，但需先确认 helper 在 GPUI 宿主退出、热重载和异常时可关闭，且不会修改终端尺寸；若不能满足，不得宣称可靠增量采集，先反馈方案缺口。

**Test scenarios:**
- TC1 [happy] 既有未标记的本机 npm 服务和新启动服务输出地址后，各自出现在对应房间且只出现一次。
- TC2 [edge] shell 还在但服务进程结束、PID 复用/前台 exec 改变时，不继续展示为确定运行；有明确退出证据才显示停止。
- TC3 [edge] 快速切房间、断流、历史 `complete=false`、高频输出或恢复为 shell 时，不跨房间写入，不以旧历史标记新实例运行；可见未知或缺口。
- TC4 [integration] 普通 agent 文本中的网页链接、远程 pane、没有服务证据的 shell 不被当成服务；观察前后终端尺寸和输入不变。

**Verification:** 运行 `node mods/agent-office/self-check.cjs`，并在真实 Herdr 用现有 `serve:web` 和一个临时服务验证发现、状态、房间隔离、只读观察及 helper 清理。原生桌面不属于浏览器/iPhone 路线；以 `herdr-app check`、原生窗口和 `herdr-app shot` 验证，不将浏览器验证冒充原生验收。

### U2. 二维码和墙面详情

**Goal:** 在办公室墙面展示服务信息牌和可操作详情，保留原始二维码的真实扫码语义。

**Requirements:** R2、R5。

**Dependencies:** U1。

**Files:** 修改 `mods/agent-office/main.js`、`mods/agent-office/decor.js`、`mods/agent-office/themes.js`；按既有个人 mod 和 GPUI 约定新增详情/二维码所需模块；扩展 `mods/agent-office/self-check.cjs`。

**Approach:** 优先占用截图中的墙面空闲区域；更新固定物宽度与墙面布局，空间不足时显示入口和数量而不是裁剪二维码。详情区区分“终端原码”和“由此链接生成”，保留码的黑白极性、静区与方形模块；如需要 QR 编码库，选可离线打包且许可明确的实现，不能依赖其他项目的 `node_modules`。先对真实 DRN 输出和独立样本验证矩阵/载荷提取；无法恢复时标为无法提取并定位原终端，而不是生成错误的替源码。仅 HTTP(S) 地址提供系统打开；保留原始 URL，包括必要查询参数。提供复制、定位原终端和固定入口。

**Test scenarios:**
- TC5 [happy] 服务输出 URL 与同一载荷的 QR，详情可复制、打开并用手机扫码，结果一致；Local/Network 均保留，优先提供网络地址给手机但不保证可达。
- TC6 [edge] 原码载荷与旁边 URL 不同，扫描结果仍是原码载荷；反色、块字符/ANSI、较窄终端和屏幕换行不产生错误码，无法恢复时显示明确状态。
- TC7 [integration] 主题、空房间、多桌、窄窗口与大量卡片下入口可见、无装饰重叠；切换房间后内容隔离。

**Verification:** 执行 `node mods/agent-office/self-check.cjs` 与 `herdr-app check ~/.config/herdr-app/mods/agent-office`；在原生窗口用 `herdr-app shot` 查看布局，并实际用手机扫描 DRN 原码及手动链接码，比较扫码载荷；手机设备不可用时明确保留该项未验收。

### U3. 固定卡片和持久化

**Goal:** 固定服务输出、管理手动链接并在本机按项目房间安全恢复。

**Requirements:** R2、R3、R4、R5。

**Dependencies:** U1、U2。

**Files:** 修改 `mods/agent-office/main.js`，在同目录新增本地卡片存储模块，参照 `mods/agent-columns-spaces/project-bindings.js` 与该 mod 的 `main.js` 版本校验/原子写法；扩展 `mods/agent-office/self-check.cjs` 和 `README.md`。

**Approach:** 固定时复制必要的 URL 或二维码数据及来源到本机存储；服务终止不删除固定内容，状态以当前证据重新计算。手动链接支持增改删及二维码生成。存储按 machine+projectKey 隔离；多目录空间使用现有 space key。读取失败不得初始化覆盖旧数据；原子写冲突先读取并按卡片 ID 合并，无法安全合并则报错并保留原文件。

**Test scenarios:**
- TC8 [happy] 固定服务 URL/原码并添加手动链接，重启 Herdr 后对应本机房间恢复；另一项目不可见，退出的服务不误报运行。
- TC9 [error] 损坏、不可写及并发更新时原有文件不被覆盖或丢失，用户可见失败；恢复后可正常编辑删除。
- TC10 [edge] 取消固定、删除及新旧服务实例重绑不会误删其他卡片；不写入完整终端输出。

**Verification:** 定向运行存储与办公室自检，重启 Herdr 后在原生窗口检查两项目隔离、数据恢复及错误反馈；核对实际安装目录与备份同步。

## System-Wide Impact

涉及 `agent-columns-spaces` 既有房间分组、`agent-office` 几何和原生视图、本机终端观察进程以及本机存储；不改变现有 project binding 的发布契约。回归覆盖项目切换、worktree、多个 pane、终端退出/恢复、空房间、用户既有装饰和终端交互。静态调用图影响分析未运行。

## Risks & Dependencies

- **发现准确性与输出完整性：** 未标记终端、后台子进程、被滚走的输出和观察断流均可能造成漏检或错误归属；U1 先验证实际启动链并使用未知状态，不满足自动发现要求时应反馈，不将该问题隐藏成已完成。
- **原码保真：** 截图码未成功解码；必须用实际 DRN 启动输出验证编码格式和原始载荷，不以相邻 URL 替换。终端图片协议的可获取性待实测。
- **本机隐私：** 地址和二维码可能包含凭据；原始输出只在内存短暂处理，不写日志或跨机同步，持久化仅在用户固定后发生；名称过滤无法保证发现所有秘密。
- **运行时验证：** 仅有 macOS 本机 Herdr 证据；其他系统、远程机器及真实手机扫码尚未验证。

## Sources & References

- 上游：本次会话中用户确认“自动展示＋可固定”“常用链接／二维码”“当前机器的项目办公室”。
- `mods/agent-office/main.js`、`mods/agent-office/decor.js`、`mods/agent-office/themes.js`、`mods/agent-office/projects.js`：房间、墙面和项目选择。
- `mods/agent-columns-spaces/main.js`、`mods/agent-columns-spaces/path-groups.js`、`mods/agent-columns-spaces/project-bindings.js`：房间成员、projectKey 和持久化约定。
- 本机 Herdr 的 `herdr.d.ts`、`gpui-kit.d.ts` 与 `hc schema`：`hc read`、只读 `terminal.attach`、生命周期事件、文件写入及原生元素能力。
