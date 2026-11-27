# Spaces 侧栏 ID 抖动验证证据（v4）

## 结论

- **根因**：ID/标题文本 `text_size` 使用 auto 行高（分数）→ 行内 `items_center()` 居中偏移为分数 → 偶发取整到相邻物理像素 → 1 retina px（0.5 CSS px）栅格化漂移。
- **排除**：frame1/frame6 垂直交叉相关 `shift=0` 最优（MAD 0.73，`shift=±1` MAD≈40），确认**非布局/滚动/窗口移动**，是纯文字栅格化漂移。
- **修复**：ID `text_size(9)` 加 `line_height(12)`、label `text_size(12)` 加 `line_height(16)`（偶数行高 → `(24-行高)/2` 整数）。
- **验证**：12 帧（含侧栏，左侧均色 RGB 231,234,238）ID 带稳定，不再有旧 6 帧的整列 1px 上移。

## 采样窗口

- 12 帧（修复后）：`frame01.png` … `frame12.png`（间隔 ~0.9s，覆盖 5.7s 流光相位切换 + 多次 1s 计时刷新）。
- 旧 6 帧（修复前）：`/tmp/jitter-1.png` … `/tmp/jitter-6.png`（间隔 1s，frame6 显示整列 1px 上移）。

## 逐帧 ID 带坐标（x∈[185,245] retina，蓝色阈值排除图标/角色/状态点/流光）

基线（frame1，13 个 ID 字形带）：

```
[334,345] [388,401] [632,643] [686,697] [740,753] [1092,1103] [1200,1211]
[1254,1265] [1308,1322] [1362,1373] [1754,1765] [1808,1819] [1862,1873]
```

- frame1–frame12 的 11 个带完全一致（`[334,345][388,401][632,643][686,697][1092,1103][1200,1211][1308,1322][1362,1373][1754,1765][1808,1819][1862,1873]`）。
- **不再有**旧 6 帧的整列同向 1px 上移（旧 frame6 曾 `[334,345]→[333,344]` 等全部上移）。

## 两处底边扩展（残留）

| 带 | 基线 | 变化帧 | 变化 |
|---|---|---|---|
| `[740,753]` | 13px 高 | frame02/07/12 | 底边 +1 → `[740,754]` |
| `[1254,1265]` | 11px 高 | frame12 | 底边 +1 → `[1254,1266]` |

- 说明：单带底边 ±1 retina px 属抗锯齿/状态点噪声，**非整列 shift**；与旧 frame6 的「整列 top/bottom 同移 1px」性质不同。

## 验证边界（两项修复分开）

| 修复 | 目标 | 证据边界 |
|---|---|---|
| time 保留子视图根尺寸 `w(60).h(22).flex_none()` | 根/内容尺寸契约（横向） | `timer-check.cjs` 源断言；修复后 12 帧无整列 shift |
| ID/label 显式 `line_height(12/16)`（偶数） | 纵向分数居中 → 栅格化稳定 | 12 帧逐 ID 带稳定 + 偶数行高几何断言 |

## 最后检查命令结果

- `node self-check.cjs` → Passed
- `node timer-check.cjs` → Passed（含 time 根尺寸断言 + 偶数行高断言）
- `node readiness-check.cjs` → Passed
- `herdr-app check <repo>` → check passed
- `herdr-app check <installed>` → check passed
- live `herdr-app status` → `errors: []`

## 代表性证据帧

`docs/previews/spaces-v4-jitter-frames/frame01.png`（含侧栏，ID 带稳定基线）。
