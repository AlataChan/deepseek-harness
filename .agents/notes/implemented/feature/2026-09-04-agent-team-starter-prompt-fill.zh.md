# Agent Note: Team 面板启动话术填入按钮

Status: implemented

[English](2026-09-04-agent-team-starter-prompt-fill.md) | 中文

## Problem

用户只能靠自己想自然语言提示来启动 Agent Team。面板里的示例行只读、不会进入输入框，首次使用仍需额外解释。

## Decision

在 `@deepseek-ai/dsh-experimental-client-ui-agent-team` 增加三条 locale 拥有的启动模板。每个面板按钮调用会话标准 `inputActions.setDraft(text)` 并关闭面板。不自动发送；创建权仍归 Lead 工具。

## Alternatives considered

- **加第三个输入区模式 chip。** 此前已否决：Team 是会话能力不是模式。
- **面板按钮直接调 `spawn_teammate`。** 否决：创建权仍归 Lead。
- **注册 `/team` 斜杠指令。** 延期：填入按钮先覆盖可发现性，表面积更小。

## Consequences

- 中文优先文案仍由 locale 拥有；英文 key 保持齐全。
- 无当前会话（`inputActions` 缺失）时填入按钮保持禁用。
