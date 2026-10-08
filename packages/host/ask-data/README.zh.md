---
description: "AskData capability seam：ctx.askData 后面的列表、表格导入与会话绑定，由官方 session remotes 消费。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-ask-data

[English](README.md) | 中文

## 概述

`ask-data` 是 web GUI 宿主问数列表、导入与会话绑定的 capability seam：抽象 `AskData` 服务（`ctx.askData`）是 Service Definition，Provider 拥有 overlay 账本与 data-agent 连接簿，官方 session remotes 是 Consumer。`importSpreadsheet` / `importSample` 只写 sqlite 与清单行，不开会话；`bind({ sourceId, sessionId })` 在目标 Session 已存在之后运行，返回同进程 lease，其 `rollback()` 恢复调用前快照。服务缺失时失败为 `session/ask-data-unavailable`。

## 目录

- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="model-experience"></a>
## 模型体验

None, as this Service Definition owns only the capability vocabulary.

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **不自动生成空库** — bind 要求已经导入或已保存的数据源。
- **没有第二本连接账** — data-agent 0.1.3 拥有 profile 与会话绑定。

<a id="dev-note"></a>
### 开发备注

导入只写 SQLite 与清单行——不套 preset、不开会话、不带 `connectionRef`——所以 bind 仍是唯一改动会话状态的步骤，`AskDataBindLease.rollback()` 必须恢复调用前快照。`AskDataErrorCode` 是线上 `details.code` 携带的封闭失败联合，新增成员必须同步补 overlay 文案；`/client` 出口保持纯类型。
