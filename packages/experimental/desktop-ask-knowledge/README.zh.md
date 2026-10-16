---
description: "octopus_DSH 问知识 overlay：Tauri app-data 下的文档库、Python sidecar 流水线，以及 conversation.hero.askKnowledge 的 Client 占位。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-ask-knowledge

[English](README.md) | 中文

## 概述

`desktop-ask-knowledge` 在应用数据目录提供文档知识库。上传时保留不可覆盖的原件，为每次导入生成独立文本，并对完整原始文本和手写 wiki 条目建立索引。转换和检索不会调用模型；知识整理须先展示并批准完整文档的持久化请求清单和保守 token 预算。桌面 profile 安装本 overlay，不修改官方应用包。

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
    extractionChunkChars: 1500
    extractionContextChars: 2000
    extractionOutputTokens: 2048
    extractionTimeoutMs: 1800000
```

空的 `knowledgeHome` 使用 `OCTOPUS_APP_DATA`。空的 `sidecarRuntimePath` 使用 `OCTOPUS_SIDECAR_HOME`。`cordis.patch.yml` 插入这一行 Host。Client 在注册界面前挂载生成的文档 Remote。每个库的 `.octopus-kb/config.toml` 统一配置整理模型；批准绑定该 profile、模型、端点、实际序列化请求、源文件哈希和完整字符覆盖。路由或请求变化后须重新估算和批准。缺失或结果不明的响应会暂停处理，不会自动重复付费推理。

`ctx.askKnowledgeDocuments` 是由本 overlay 的 `DocumentsServiceImpl` 提供、以接口声明的 Host 服务，负责按文档库管理原件存储、完整性校验和文档记录。 文档处理使用独立的 `DocumentJobId`，任务标识符以字符串持久化。

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
返回 cursor 表示还有未读内容；用相同 terms 和 documentFilter 继续检索。需要完整段落时，调用 ask_knowledge_read 并继续读取其 cursor。
不要用工作区文件、bash 或问数据工具代替知识库检索。检索无结果也只表示这些专名未命中；有截断警告或 cursor 时不能断言整库没有材料。
仅当需要打开检索结果里某一条 wiki 词条页时，再调用 ask_knowledge_lookup，term 用该页标题或路径。
不要用 write、edit 或 bash 修改知识库目录或 .octopus-kb/。
```

#### Token 影响

会话保持挂库时，每轮请求成本固定。未挂库的会话不带这一段。

#### KV Cache 影响

挂库后前缀稳定。attach 或 detach 可能从第一处变化的 prompt token 起让复用失效。

### 检索与查阅工具

#### 模型看见什么

存在 `ctx.tools` 时，overlay 注册 `ask_knowledge_retrieve`、`ask_knowledge_read` 和 `ask_knowledge_lookup`。检索及完整段落读取返回私密签名的续读游标，绑定知识库、查询和索引世代；正常工具结果将模型可见文本与游标元数据保存在会话日志中。实验工具不进官方 tool catalog。执行器接受 `terms[]` 或一个 `term`，并拒绝整句。retrieve 的 render 带上每页正文，模型不必再为同一页空转 lookup。

#### Token 影响

工具保持注册时 schema 成本固定。结果随数据变化，并受 `maxResultItems` / `maxResultChars` / `maxResultTokens` 限制。

#### KV Cache 影响

工具集不变时前缀稳定。HMR dispose 会摘掉三个 schema，可能从第一处变化的 schema token 起让复用失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 纯图片 PDF 页需要 OCR；文字与图片混合页无法确认图片内文字是否完整，因此保留“部分文本”状态，不调用云端 OCR。
- 系统能够限制网络时，DOCX 使用隔离的原生转换器；内置回退报告“部分提取”和遗漏部件。旧版 `.doc`、`.xls` 不受支持，表格一般更适合问数据。
- macOS 通过操作系统禁止原生转换器联网；无法建立限制时拒绝启动。Windows 原生转换等待等效网络策略。macOS 的进程组托管无法约束任意主动逃离进程组的后代。
- 仅本会话文档预览保持 32,000 字符上限；本 overlay 不引入保留 24 小时的策略。
- 设置页展示真实保留、转换、检索和分段进度。“批准”执行显示的计划；“取消”停止所属工作并保留原件与已提交历史；“重试”只生成新的待批准估算。付费结果不明时须先排查，不会自动重发。

<a id="dev-note"></a>
### 开发备注

`catalog.json` 管理知识库身份。原件以私有流式文件写入并 fsync，不覆盖已发布对象，通过可重放意图完成登记；启动时先修复登记，再恢复任务。共享短文件锁将启动世代、取消和 wiki／审计发布串行化，模型推理在锁外运行。只有明确的整理调用获得配置的凭据；调用方等待托管进程退出，转换结果使用私有且有上限的文件。删除知识库会删除该库保留的原件和处理记录。Windows 原生安装态验收仍是独立的发行条件。
