# Herdr Layout Company

Herdr App 的 `office` 和 `agent-columns` 布局快照，包含布局、预览图、主题和所需 mod。`agent-columns` 与 `office` 共用侧栏、顶部标签栏、Files、Editor 和 Magpie 窗格，省略办公室场景。

布局包含 Magpie 窗格，可通过顶部 Magpie 图标显示或隐藏。窗格连接本机 Magpie 网关，展示路由、额度和用量；总览随浅色或深色主题调整样式，区块可拖动手柄排序、固定或隐藏，已隐藏区块可从顶部恢复；额度卡片可排序、隐藏，设置保存在本地。

路由图按 Agent 类型和供应商汇总全部活动请求；实时路由区块将当前会话置顶并高亮，展示模型、路由组、原因、耗时和会话用量统计。路由组名称来自 Magpie 配置，未找到时显示组 ID。无法识别当前会话或没有活动请求时显示相应状态。

## 交给 Agent 安装

复制下面的提示词：

```text
请从 https://github.com/CalvinVon/herdr-layout-company 安装 office 布局到我的 Herdr App：先检查我的 Herdr 版本和配置目录，备份将被覆盖的同名布局、主题及 mod，再安装仓库中的对应文件，保留我的会话和项目数据；检查 mod 是否能够加载，切换到 office 布局并验证运行状态，最后告诉我如何恢复备份及任何兼容性问题。
```
