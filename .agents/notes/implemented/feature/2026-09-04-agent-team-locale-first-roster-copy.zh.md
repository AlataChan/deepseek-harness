# Agent Note: 以 locale 优先写清 Agent Team 名单文案

Status: implemented

[English](2026-09-04-agent-team-locale-first-roster-copy.md) | 中文

## Problem

桌面用户打开 Agent Team 面板后，仍要把英文产品词（`Agent Team`、`teammate`、`spawn_teammate`、`subagent`）映射到两种不同行为：一次性子代理与常驻队友。面板本是监控台，但文案没有讲清差异，普通用户还要多一步解释才能用自然语言指挥对话。

## Decision

组建团队仍由对话里 Lead 调工具完成。只改 `@deepseek-ai/dsh-experimental-client-ui-agent-team` 的 locale 与面板 chrome：

- 顶栏触发文案用中文「团队协作」，副标保留 `Agent Team`。
- 成员行标注「主助理」/「常驻队友」（英文：Lead / Teammate）。
- 尚无队友时展示常驻队友与临时子任务（子代理）的对比说明。
- 始终展示用法说明与一条自然语言示例；用户文案不出现工具名。

## Alternatives considered

- **在输入区加第三个模式 chip。** 否决：Team 是会话能力不是模式；与标准模式 / 问数 / 知识库混排更易混淆。
- **在面板加按钮直接调 `spawn_teammate`。** 否决：创建权仍归 Lead；UI 捷径会绕过模型回路并重复 Host 准入规则。
- **顺手改 `ui-workspace` 全局子代理状态文案。** 延期：属更广产品文案；本次只动 Team overlay 包。

## Consequences

- 用户在 Team 面板看到中文优先指引，Host tools 与 Remote API 不变。
- 英文 locale 对同一教学内容保持 key 齐全。
- 不改官方 `desktop-app` 产品逻辑，只动实验性 Client UI overlay。
