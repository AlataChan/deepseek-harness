# `@deepseek-ai/dsh-tui`

[English](README.md) | 中文

`dsh-tui` 是仅限 Node 的行内终端客户端。它在 Host Cordis 配置树内运行，渲染持久会话事件与实时 agent（智能体）交互，不添加 RPC、HTTP、WebSocket 或浏览器层。

## 运行时职责

本包持有一个根 agent 的终端展示与输入生命周期。产品状态独立于 Ink，因此 reducer、transcript（文本记录）投影与交互所有权无需 renderer 即可测试。

权威 Session 投影保留在 Ink 的有界重绘区域，使快速成批到达的事件不会绕过新追加的持久行。客户端本地完成的行通过一个稳定的 `Static` 列表输出；React 通过 `useSyncExternalStore` 订阅，且不镜像应用状态。

持久事件和实时事件统一经过一个纯投影。来自模型、工具、命令和日志的每个显示字段都会在渲染前转换为终端安全文本；工具参数与结果元数据则保留结构化值，供专用卡片使用。

人类可读的 transcript 仅在持久来源为用户时渲染 `user/message` 内容。注入的指令、catalog、策略快照和其他面向模型的上下文仍保留在 Session 日志与模型请求中，但不会在终端内显示为 `You`。

工具卡片解析活跃 agent 可见的 definition，并且只调用其纯 `presentCall` 与 `presentResult` 方法。generic、terminal、diff、read、search 与 Web 结果意图具有紧凑终端视图；缺失、拒绝和未知意图使用安全的结构化回退，且不执行内容或读取文件。

controller 注册一个仅处理精确 agent 的审批 answerer 以及唯一的用户问题 provider。审批授权必须由显式 allow-once 操作触发；中止和 dispose 只会取消而不会授权。问题批次显示所有选项和审阅详情，并且只有共享 Service Definition validator 接受全部必答内容后才会原子结算。

运行时控制器等待 Loader 完全稳定后，持有一个新建或恢复的根 agent。恢复发现只读取有界的最新会话列表，并通过一次批量调用解析所有可见标题。

## 输入与命令

Enter 提交 composer，Ctrl+J 插入换行。Ctrl+R 打开有界恢复选择器，Escape 关闭当前 overlay 或拒绝当前交互，审批提示接受 `y` 或 `n`。问题批次要求按显示顺序为每个问题输入一个以分号分隔的答案；多选问题使用逗号分隔多个 label。

`/help`、`/resume` 与 `/exit` 由终端客户端处理。其他斜杠命令通过当前 agent 的有效作用域 `ctx.commands` 注册表解析，并写入正常的持久生命周期事件。未知斜杠行会保留在 composer 中，只有再次提交完全相同的行才会发送给模型；命令错误同样保留草稿。

Agent 工作活跃时，Ctrl+C 先请求取消；取消尚在收敛时再次按 Ctrl+C 才请求关闭。空闲时，Ctrl+C 先清除非空草稿，再从空 composer 退出。关闭过程依次拒绝新输入、无授权地取消待处理交互、排空并 flush Agent、恢复终端、释放持有的 effect，最后才请求 launcher 退出。由 launcher 触发的 fiber dispose 执行相同清理，但不会再次发送退出请求。

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
- **聚焦键盘交互**：鼠标输入、图片附件与备用屏幕模式暂缓实现；多问题文本输入使用上述分号/逗号语法，而非交互式选项光标。
- **Markdown 子集**：支持标题、段落、列表、围栏代码、行内代码与可见链接；原始 HTML 按文本显示，且不输出终端超链接。
- **需要交互式流**：stdin 与 stdout 必须都是 TTY；自动化场景使用 `dsh exec`。
