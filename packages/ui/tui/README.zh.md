# `@deepseek-ai/dsh-tui`

[English](README.md) | 中文

`dsh-tui` 是仅限 Node 的行内终端客户端。它在 Host Cordis 配置树内运行，渲染持久会话事件与实时 agent（智能体）交互，不添加 RPC、HTTP、WebSocket 或浏览器层。

## 运行时职责

本包持有一个根 agent 的终端展示与输入生命周期。产品状态独立于 Ink，因此 reducer、transcript（文本记录）投影与交互所有权无需 renderer 即可测试。

## 配置

- `terminalColumnsFallback`：stdout 未提供可用列数时采用的正整数宽度；默认值为 `80`。
- `resumeTranscriptRows`：恢复到 scrollback 的已完成行数，须为正整数；默认值为 `200`。
- `sessionSelectorLimit`：恢复选择器提供的最大会话数，须为正整数；默认值为 `50`。
- `toolOutputDisplayBudget`：单个已渲染工具输出的正整数字节预算；默认值为 `32768`。

## 模型体验

无。本展示包不注册提示词、工具 schema 或提供方请求内容。

#### KV Cache 影响

无；渲染与终端输入不会添加或替换模型请求内容。

## 已知限制与延期工作

- **仅限 Node 终端**：浏览器、Electron 与 Tauri 应用壳层不属于本包。
- **聚焦键盘交互**：鼠标输入、图片附件与备用屏幕模式暂缓实现。
- **需要交互式流**：stdin 与 stdout 必须都是 TTY；自动化场景使用 `dsh exec`。
