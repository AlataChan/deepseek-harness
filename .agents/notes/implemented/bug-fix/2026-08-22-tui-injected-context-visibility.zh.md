# Agent Note: TUI transcript 区分用户提示与注入上下文

Status: implemented

[English](2026-08-22-tui-injected-context-visibility.md) | 中文

## 问题

持久 `user/message` 事件同时承载直接的人类提示与面向模型的上下文，因此它的模型协议角色无法标识人类作者。把每条追加来源事件都渲染为 `You`，会把 workspace 指令、运行时策略快照和 skill catalog 归到用户名下。大型指令文件随后会占据绝大部分终端内容，即使模型请求与 Session 日志本身正确。

## 决策

仅当 `message.source.kind === 'user'` 时，TUI 才把一条 `user/message` 投影到人类可读的 transcript 中。直接提示与用户来源的 steering 在实时交付和回放中仍然可见。其他来源都继续持久化并对模型可见，但不产生终端行。

这项来源分类细化了[人类可读 transcript 投影决策](2026-07-29-human-transcript-append-origin.zh.md)。追加来源仍用于区分人类历史与仅供模型使用的替换副本；消息来源则独立区分该历史中的人类输入与注入上下文。

该规则使用可合并扩展的来源判别字段，而不依赖生产者名称。因此，新安装的上下文生产者默认保持隐藏，除非它明确生成用户来源的消息；TUI 也无需依赖每个上下文包。

## 曾考虑的替代方案

**把每条 `user/message` 都渲染为 `You`。** 不采用，因为消息角色描述的是模型协议，而非人类作者；合成上下文使用 user 角色，是为了让提供方在请求中赋予它预期权重。

**在 `System` 标签下渲染非用户来源。** 不采用，因为更换标签仍会让面向模型的信封与 catalog 填满终端。TUI 没有能够让这些正文保持折叠的 disclosure 控件。

**隐藏一份固定的已知生产者列表。** 不采用，因为 `MessageSourceMap` 可以合并扩展。生产者列表会让每种新上下文来源持续暴露，直到终端认识它的名称。

## 后果

终端用户可以看到自己的提示、assistant 输出、reasoning、工具、命令、重试与终端状态，而注入上下文不会再被归到用户名下。恢复回放与实时交付使用同一个纯投影，因此会省略相同的消息。

模型请求、持久 Session 数据、遥测与其他客户端均不改变。Web 客户端可以继续通过折叠的 disclosure UI 展示注入上下文。终端不再直接检查注入上下文；Session 日志与具备上下文 disclosure 的客户端仍可用于检查。
