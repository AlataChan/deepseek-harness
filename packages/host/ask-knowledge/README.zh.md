---
description: "AskKnowledge capability seam：抽象的 ctx.askKnowledge Service Definition、线上词汇，以及纯类型的 Client 投影出口。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-ask-knowledge

[English](README.md) | 中文

## 概述

`ask-knowledge` 是 web GUI 宿主知识库目录、入库、仅本会话抽取、挂接与检索的 capability seam：抽象 `AskKnowledge` 服务（`ctx.askKnowledge`）是 Service Definition，Provider 拥有 catalog 与 sidecar，官方 session remotes 是 Consumer。`beginIngest` / `finishIngest` 是上传路径；`beginExtract` / `finishExtract` 把一份文件转成文字给本会话看，不写户口本；`attach` 返回同进程 lease。服务缺失时失败为 `session/ask-knowledge-unavailable`。

## 目录

- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="model-experience"></a>
## 模型体验

None, as this Service Definition owns only the capability vocabulary and term schema.

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **没有收件箱审核台** — defer 的入库按失败报告，不是队列界面。
- **扫描件 PDF 抽不出字** — 转换 PDF 的 Provider 只抽文字，不做 OCR。

<a id="dev-note"></a>
### 开发备注

seam 拥有词汇而不是文案：中性错误码与 `ASK_KNOWLEDGE_TERMS_SCHEMA` 从这里导出，中文句子由 overlay 映射。`ask-knowledge/bound`/`unbound` 在此合并进 `SessionEventMap`（无 `@mode`），`askKnowledgeBinding` 投影由 Provider 注册；`/client` 出口必须保持纯类型，浏览器聚合不得加载 Host 服务。
