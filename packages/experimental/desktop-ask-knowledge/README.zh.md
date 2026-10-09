---
description: "octopus_DSH 问知识 overlay：Tauri app-data 下的文档库、Python sidecar 流水线，以及 conversation.hero.askKnowledge 的 Client 占位。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-ask-knowledge

[English](README.md) | 中文

## 概述

`desktop-ask-knowledge` 是文档库的私有桌面 overlay：提供 `ctx.askKnowledge`，为入库、propose 与抽取运行随包的 octopus-kb sidecar，并占用 `conversation.hero.askKnowledge`。活库位于 Tauri `app_data_dir`；`catalog.json` 是唯一户口本，工作区 symlink 可选，绝不是索引。桌面 profile 种子会安装本包；官方 `dsh-desktop-app` 与默认 `standard` 助理不点名它。

## 目录

- [配置](#config)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="config"></a>
## Config

```yaml
- id: desktop-ask-knowledge
  name: '@deepseek-ai/dsh-experimental-desktop-ask-knowledge'
  config:
    knowledgeHome: ''
    sidecarRuntimePath: ''
```

空的 `knowledgeHome` 使用 `OCTOPUS_APP_DATA`。空的 `sidecarRuntimePath` 使用 `OCTOPUS_SIDECAR_HOME`。`cordis.patch.yml` 插入这一行 Host。Client 半边在 Host fiber 就绪后从 `dsh.client` 发现。

<a id="model-experience"></a>
## 模型体验

### 挂库后的检索提示

#### 模型看见什么

已有 `askKnowledgeBinding` 时，Provider 注册 `ask-knowledge:retrieve` system-prompt 段。文件字节和 API Key 不进会话日志。

##### 检索段

```markdown
这个会话已经挂上知识库。用户问文档、政策或材料里的内容时，必须先调用 ask_knowledge_retrieve。
检索时使用 ask_knowledge_retrieve 的 terms 数组，填写 1 到 6 个专名，不要整句。
每个专名去掉首尾空白后不超过 16 个字，且不得含 ?？。！! 或换行。
ask_knowledge_retrieve 的返回里已有命中页的正文。先根据这些正文回答。
不要用工作区文件、bash 或问数据工具代替知识库检索。只有检索结果为空时，才能说库里没有这份材料。
仅当需要打开检索结果里某一条 wiki 词条页时，再调用 ask_knowledge_lookup，term 用该页标题或路径。
不要用 write、edit 或 bash 修改知识库目录或 .octopus-kb/。
```

#### Token 影响

会话保持挂库时，每轮请求成本固定。未挂库的会话不带这一段。

#### KV Cache 影响

挂库后前缀稳定。attach 或 detach 可能从第一处变化的 prompt token 起让复用失效。

### 检索与查阅工具

#### 模型看见什么

存在 `ctx.tools` 时，overlay 注册 `ask_knowledge_retrieve` 和 `ask_knowledge_lookup`。实验工具不进官方 tool catalog。执行器接受 `terms[]` 或一个 `term`，并拒绝整句。retrieve 的 render 带上每页正文，模型不必再为同一页空转 lookup。

#### Token 影响

工具保持注册时 schema 成本固定。结果随数据变化，并受 `maxResultItems` / `maxResultChars` / `maxResultTokens` 限制。

#### KV Cache 影响

工具集不变时前缀稳定。HMR dispose 会摘掉两个 schema，可能从第一处变化的 schema token 起让复用失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **扫描件 PDF 抽不出字** — 文字 PDF 走 markitdown[pdf]；纯图页不做 OCR
- **不接受 .xls** — Excel 须是 `.xlsx`。表格更适合走问数据
- **不接受老 .doc** — Word 须是 `.docx`。Host 只读 `word/document.xml`；其它 zip 段里的页眉、页脚、批注不会抽出
- **没有收件箱审核台，也没有 ingest-url**
- **不改官方 desktop-app 组合** — 本 overlay 是 profile pin

<a id="dev-note"></a>
### 开发备注

`catalog.json` 是唯一户口本；`DEEPSEEK_API_KEY` 只注入 sidecar 子进程这一次；缺少 `OCTOPUS_APP_DATA` 或 `OCTOPUS_SIDECAR_HOME` 只能让问知识方法失败，不能让 companion 聊天失败。浏览器侧上传队列以窗口为界，Host 对每个库串行入库，所以关窗会丢掉排队文件；`builtins.yaml` 有意删掉 `confidence.tier_gate_defer`，让中等置信度提案直接入库，而不是停进没人审核的收件箱。
