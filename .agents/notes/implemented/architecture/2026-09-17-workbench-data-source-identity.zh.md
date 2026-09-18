# Agent Note: 工作台数据源身份使用字母头像、类型徽章和可选文档数

Status: implemented

[English](2026-09-17-workbench-data-source-identity.md) | 中文

## Problem

知识库选择器、设置名单、hero chip 和问数名单只显示纯文本名称。批次行用文字字形。 [设计审计](../../../../docs/plans/2026-09-17-workbench-frontend-design-audit.zh.md) 里升级 3 的示意看起来像仪表盘，不是会话壳，所以按图新做首页会替换掉已有的三个入口，而不是给它们做身份。

## Decision

身份落在会话 chip、知识库选择器、问数名单和设置名单上。每行有字母头像（显示名的第一个字素；色相 0–2 取 `--dsw-alias-state-business/success/warn` 的 primary 与 tertiary）、名称，以及类型徽章：文档库、示例、表格或已保存。知识库行还可以显示已入库的 `raw/*.md` 篇数，文案是 `{count} 篇`。

`AskKnowledgeLibrary.documentCount` 和 `SessionAskKnowledgeLibrary.documentCount` 是可选字段。实验 catalog 通过数 `raw/*.md` 填入（vault 失踪或没有 `raw/` 时为 0）。该字段走现有 list remotes，不重新生成 typert。批次状态保留字典文案，并使用 `IconQueueOutline14`、`IconLoadingOutline16`、`IconCheckOutline16` 和 `IconCloseOutline16`。挂库按钮和 chip 把 `aria-label` 设成显示名，这样可访问名称仍是库名或源名。

三个入口保留（hero chip、加号菜单、设置）。官方加号菜单文案不改。图标来自 `ui-primitives`；第二套图标库和扩充官方图标集都不在范围内。仪表盘示意不是首页。

## Testing

聚焦的 jsdom spec 覆盖选择器徽章和 `{count} 篇`、设置页「文档库」、问数「示例 / 表格 / 已保存」、chip 的 `aria-label`，以及 catalog 在写入 `raw/*.md` 前后计数 0 再 1。`verify-client-css-tokens` 覆盖新增头像色相。`verify-client-ui-i18n` 覆盖新文案键。覆盖率包含 `SourceIdentity`、`library-initial`、`source-initial` 和 catalog 的 `documentCount`。

## Alternatives considered

**按示意新做仪表盘首页。** 拒绝：身份应落在已经存在的 chip、选择器、名单和设置上。新仪表盘会替换会话壳。

**把三个入口收成两个。** 拒绝：设置名单是管理，选择器是往会话挂库，加号菜单是官方添加路径。统一姿态不必删掉一个入口。

**把 `documentCount` 写进 `catalog.json`。** 拒绝：篇数从 vault 派生。存进户口本会和 `raw/` 漂移，并扩大磁盘上的 catalog schema。

**扩充官方图标集或再加一套图标库。** 拒绝：桌面包对体积敏感，而排队、加载、完成、失败、文件夹和数据图标已在 `ui-primitives` 里。

## Consequences

- list remotes 可以带 `documentCount`，不必重新生成 typert。
- catalog 列表现在会读 `raw/`。
- 挂库和 chip 测试按显示名查询可访问名称。
- 头像色相是已声明的主题 token；新的幻影 `var(--dsw-…)` 名仍会让 `verify-client-css-tokens` 失败。
