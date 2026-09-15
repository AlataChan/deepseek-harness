---
description: "供 Provider 作者与 Consumer 导入、绑定、读取、分析及渲染商务数据的商务能力定义。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-commerce

[English](README.md) | 中文

## 概述

`dsh-host-commerce` 定义 `ctx.commerce` 能力，用于商务数据源发现与导入、一次性 Session 绑定、Provider-neutral 读取与分析，以及平台导出渲染。它拥有持久化 `commerce/bound` 事件及其 `commerceBinding` 投影。该包是发布组中的 Service Definition；Provider 与 Consumer 位于独立包中。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

Provider 作者继承 `Commerce`，实现数据源导入、有界读取、只读分析与 CSV 渲染，再把该 Provider 挂载到 Cordis 组合中。未知数据源标识必须以 `CommerceError('source-missing', ...)` 失败。Provider 配置负责解析平台标识，并拥有存储与查询强制规则。

Consumer 注入 `commerce`，调用其 Provider-neutral 方法，并把闭合的 `CommerceErrorCode` 词汇映射到自身工具、Remote 或 UI 协议。Consumer 通过调用 `ctx.commerce.bind(agent, sourceId)` 绑定已有 `Agent`，不得直接追加 `commerce/bound`。Client 聚合导入 `@deepseek-ai/dsh-host-commerce/client`，以取得投影声明而不加载 Host 服务。

-----

<a id="understand-the-implementation"></a>
## 了解实现

`Commerce.bind` 检查实时 `commerceBinding` 投影，通过 Provider 验证数据源，在提交点再次检查投影，然后恰好追加一个 `commerce/bound` 事件。第二次检查防止同一进程中的两个并发调用提交两次绑定。验证失败或中止时不会追加事件。

`platforms` 列出 Provider 在导入与导出时接受的平台映射 ID。读取方法使用带品牌的数据源、商品与变更标识。`runAnalysisQuery` 仍由 Provider 强制为只读；`renderExport` 仅返回 CSV 文本，把审批、路径策略与文件创建留给拥有写入操作的 Consumer。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Service Definition、带品牌标识、Provider-neutral 操作与错误 |
| [`src/types.ts`](src/types.ts) | 身份、取值与改动类别类型，持久化事件，以及 Host／Client 投影声明 |
| [`src/session.ts`](src/session.ts) | 可重放的 `commerceBinding` 投影定义 |
| [`src/client.ts`](src/client.ts) | 仅类型的 Client 入口 |
| — | 不发布运行时 invariant companion，因为该无状态 Service Definition 不存在可能分歧的独立观测状态。 |

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

-----

<a id="model-experience"></a>
## 模型体验

无，因为此 Service Definition 只拥有能力类型和仅写入日志的 Session 绑定事件。

#### KV 缓存影响

无；此包既不组装也不发送模型请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **每个 Session 只能绑定一次** — `Commerce.bind` 以 `already-bound` 拒绝重新绑定；此包不定义解绑或替换事件。
- **不含实现或呈现** — 此包不存储数据源数据、不强制 SQL、不公开工具或 Remote、不渲染 UI、不审批导出，也不写文件；已安装的 Provider 与 Consumer 拥有这些行为。
