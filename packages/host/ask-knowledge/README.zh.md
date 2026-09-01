# @deepseek-ai/dsh-host-ask-knowledge

[English](README.md) | 中文

Web GUI Host 的知识库目录、入库、仅本会话抽取、挂接与检索是一条 capability seam。抽象服务 `AskKnowledge`（`ctx.askKnowledge`）是其 Service Definition。Provider 实现 catalog、vault 与 sidecar。Consumer 是官方 session remotes：只调用这些方法，并把 `AskKnowledgeError` 映射到线上。服务缺失时失败为 `session/ask-knowledge-unavailable`。

Client 聚合通过 `@deepseek-ai/dsh-host-ask-knowledge/client` 取得 `askKnowledgeBinding` 投影合并；该出口转述 `./types`，不加载 Host `AskKnowledge` 服务。

`listLibraries` 只读 `catalog.json`，不跑 recover。`createLibrary` 写空 vault 与目录行。`beginIngest` / `appendIngestChunk` / `finishIngest` 是上传路径；单条 Remote 不得携带整文件。失败的 `finishIngest` 可以带 `error`。`beginExtract` / `appendExtractChunk` / `finishExtract` 把一份文件转成文字给本会话看，不写户口本；`finishExtract` 最多返回 `ASK_KNOWLEDGE_EXTRACT_MAX_CHARS` 个码点。`attach({ libraryId, sessionId })` 在目标 Session 已存在之后运行，返回同进程 `AskKnowledgeAttachLease`。`ask-knowledge/bound` 与 `ask-knowledge/unbound` 在此合并进 `SessionEventMap`（无 `@mode`）；`askKnowledgeBinding` 投影由 Provider 注册。

抽词 schema、错误码和中性错误数据由本包导出（`ASK_KNOWLEDGE_TERMS_SCHEMA`、`ask-knowledge/terms-invalid`、`ask-knowledge/no-hit`）。overlay 只映射中文文案。

octopus_DSH 桌面入口是实验 Provider 加 Client 占位（`@deepseek-ai/dsh-experimental-desktop-ask-knowledge`）。官方 Web 组合省略该包，因此 `conversation.hero.askKnowledge` 保持空。

## 模型体验

None, as this Service Definition owns only the capability vocabulary and term schema.

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延后工作

- **没有收件箱审核台** — defer 的入库按失败报告，不是队列界面。
- **扫描件 PDF 抽不出字** — 转换 PDF 的 Provider 只抽文字，不做 OCR。
