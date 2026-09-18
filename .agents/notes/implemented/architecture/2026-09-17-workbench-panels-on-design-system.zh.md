# Agent Note: 工作台面板接入客户端设计系统

Status: implemented

[English](2026-09-17-workbench-panels-on-design-system.md) | 中文

## Problem

octopus_DSH 工作台面板（知识库选择器和问数 gate）引用了 `ui-theme` 从未声明的 `--dsw-alias-*` 名。真正画到屏幕上的是 CSS 回退 —— `#c00`、`#b42318`、`#4d8dff`，或者什么都没有 —— 所以暗色是错的，选择器卡片也没有背景。选择器还在 composer 栈里行内渲染时声明 `role="dialog"`，没有 `Escape`，没有加载或空态，两个界面一打开就是大段说明。

## Decision

工作台 CSS 只使用 `packages/client/ui-theme/src/styles/` 里声明的 token。颜色、elevation、字阶、骨架和危险态 hover 的 alias 替换幻影名和字面回退。`scripts/verify-client-css-tokens.ts` 拒绝任何主题未声明的新 `var(--dsw-…)` 引用。修复范围之外、已经存在的未声明用法留在棘轮 allowlist 上：每一行 `file::token` 都必须还能找到，删掉幻影时必须同时删掉那一行。

知识库选择器改用现有的 `ui-primitives` `Modal`（`aria-modal`、遮罩、`Escape`、`--dsw-alias-bg-layer-2`、`--dsw-elevation-prominent`）。一行摘要加规则披露替换始终可见的五段 lead。`listLibraries` 有加载骨架和空目录说明。批次行保留状态文案并加上字形，失败不只靠颜色。问数 gate 保持全页布局，使用同一套 token 和焦点规则，并把 `pageLead` 与避坑列表收进 `rulesToggle`。

焦点陷阱和焦点归还不在这次改动里。它们应加到 `Modal` 上一次，而不是加到选择器上。

统一数据源身份（字母头像、类型徽章、可选文档数）见[后续决策](2026-09-17-workbench-data-source-identity.zh.md)。

[选择器关闭与拒件修复](../bug-fix/2026-09-16-desktop-knowledge-picker-dismiss-and-reject-heal.zh.md) 里的关闭与 heal 行为仍在：hero chip 仍是开关，加号菜单那座桥仍是幂等打开。

## Alternatives considered

**选择器保持行内，只换 token。** 拒绝：行内区域挂 dialog 角色是可访问性缺陷，在那里加 `aria-modal` 会把焦点困在 composer 里。`Modal` 已经拥有 token 替换本来要手写的 overlay 外观。

**对树上每一个未声明的 `--dsw-*` 直接让 CI 失败。** 这次拒绝：官方客户端和其他 overlay 里还有十七对既有用法。棘轮 allowlist 能先把门禁落地，而不把范围扩到那些包。

**按猜出来的名字在 `ui-theme` 里补 token。** 拒绝：`--dsw-alias-bg-elevated` 和 `--dsw-alias-label-danger` 没有主题含义。映射到 `bg-layer-2` 和 `state-error-primary` 只保留一套词汇。

## Consequences

- 工作台新增的、不在 `ui-theme` 里的 `var(--dsw-…)` 会在 hygiene 和静态 CI 的 `verify-client-css-tokens` 上失败。
- 选择器测试查询 `document.body`，因为 `Modal` 挂到那里。
- `@deepseek-ai/dsh-client-ui-primitives` 成为 `desktop-ask-knowledge` 的 peer，与 `desktop-ask-data` 对齐。
- 选择器和问数的首屏文案是一行摘要；更长的规则仍在字典里，放在披露后面。
