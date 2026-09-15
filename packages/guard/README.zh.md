---
description: "智能体循环 guard 插件的包映射，覆盖重复调用、调用截止时间以及选定外部工具结果的结构化围栏。"
kind: "package-group"
---

# guard/：智能体循环 guard 家族

[English](README.md) | 中文

## 概述

`guard/` 组提供围绕工具执行的专用策略。`repeat-tool-reminder` 会提醒重复相同调用的模型，`timeout-policy` 强制执行已声明的调用截止时间，`fence-policy` 则将选定第三方结果文本标记为外部数据，同时中和结构化提示注入形式。三个包均随 `dsh` base bundle 交付，围栏策略也仍可用于显式组合。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

每个包负责一项策略，并记录其组合要求。

| 包 | 提供什么 |
|---|---|
| [`fence-policy/`](fence-policy/README.zh.md) | 在选定外部工具结果文本进入模型前对其进行转义和围栏 |
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.zh.md) | 在模型重复相同工具调用时提醒它，使其改变方法或结束任务 |
| [`timeout-policy/`](timeout-policy/README.zh.md) | 为声明了限时的工具调用设置超时，让模型得到清晰错误而不是无限等待 |

-----

<a id="related-documentation"></a>
## 相关文档

先从工具子系统参考了解工具调用流水线，再看生成配置与截止时间策略背后的超时库决策。

- [工具子系统参考](../../docs/subsystems/tools.zh.md)——两个 guard 都依赖的工具调用流水线与决策。
- [生成配置目录](../../docs/config-catalog.zh.md#deepseek-aidsh-repeat-tool-reminder)——重复调用提醒的每个受支持字段。
- [超时截止时间库 Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.zh.md)——`timeout-policy` 所执行的时序／终止拆分。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
