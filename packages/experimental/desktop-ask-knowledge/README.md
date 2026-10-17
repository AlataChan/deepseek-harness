---
description: "octopus_DSH ask-knowledge overlay: document libraries under the Tauri app-data directory, a Python sidecar pipeline, and the conversation.hero.askKnowledge Client seat."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-ask-knowledge

English | [中文](README.zh.md)

## Summary

`desktop-ask-knowledge` provides desktop document libraries under the app-data directory. Uploads retain immutable originals, publish distinct normalized text for each import, and index full raw pages and handwritten wiki entries. Conversion and search do not call a model. Wiki enrichment requires explicit approval of a durable full-document request manifest and its conservative token allowance. The desktop profile seeds this overlay without changing official application packages. Document manifests, checkpoints, and conversion diagnostics are read and written as UTF-8 independently of the Host locale.

## Table of Contents

- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

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

Empty `knowledgeHome` uses `OCTOPUS_APP_DATA`. Empty `sidecarRuntimePath` uses `OCTOPUS_SIDECAR_HOME`. `cordis.patch.yml` inserts this one Host row. The Client mounts the generated document Remote contribution before registering its UI. Optional document methods resolve through the namespaced Cordis service lookup. Settings distinguish loading or failed document requests from a successfully empty library and retain loaded documents after refresh failures. The per-library `.octopus-kb/config.toml` owns the extraction route; approval binds its profile, model, endpoint, source ranges, prompt version and spending ceiling. Wiki context is resolved when each chunk executes; a route, prompt version or higher ceiling requires a new estimate and approval. Missing or ambiguous responses pause processing and never trigger automatic paid retries.

`ctx.askKnowledgeDocuments` is an interface-typed Host service provided by this overlay's `DocumentsServiceImpl`. It owns library-scoped original storage, integrity verification and document records. Document processing uses `DocumentJobId`; job identifiers are persisted as strings.

Configured HTTP(S) proxy URLs, including their authentication, are forwarded only through the child environment; unrelated ambient credentials remain scrubbed. User bypass entries are preserved and merged with loopback bypasses.

`extractionContextChars` bounds the complete serialized wiki-context bundle, including page paths and JSON framing. Runtime selection trims page text to fit; planning reserves four UTF-8 bytes per serialized character and includes the outer request envelope. Conflict destinations are reserved across all operations in a proposal so distinct claims cannot overwrite each other. Index links recover from the saved proposal intent; publication stages and flushes a complete replacement, checks for observed concurrent edits, and atomically replaces the index.

Generated page categories outside the PageMeta enums are normalized to `note` before strict validation, including saved proposals resumed after rejection. This repair retains the original response, attempt identity and reported usage without repeating inference for that range. Other publication failures report the rejecting rule and leave extraction paused.

## Model Experience

### Bound retrieve prompt

#### What the model sees

When `askKnowledgeBinding` is set, the Provider registers the `ask-knowledge:retrieve` system-prompt section. File bytes and API keys never enter the session log.

##### Retrieve section

```markdown
这个会话已经挂上知识库。用户问文档、政策或材料里的内容时，必须先调用 ask_knowledge_retrieve 进行检索。
检索时使用 ask_knowledge_retrieve 的 terms 数组，填写 1 到 6 个专名，不要整句。每个专名去掉首尾空白后不超过 16 个字，且不得含 ?？。！! 或换行。
检索默认优先查询 Wiki 词条、别名、主题索引与正文。返回的 Wiki 内容为未核实摘要（unverified-wiki-summary）。
【原文核实规则】凡回答中包含数字、日期、义务要求、例外条款或直接引述作为已确认事实的，必须在同一轮中通过 ask_knowledge_read 或 mode="source" 读取原文片段并核实出处。仅凭 Wiki 引用不能断定事实已核实；未读原文时必须明确注明该结论来自未核实的 Wiki 摘要，不得冒充确认事实。
需要核验引用、排查矛盾或 Wiki 未命中时，可使用同一轮获得的 wikiAttemptId 进行原文兜底（ask_knowledge_retrieve 的 mode="source" 或 ask_knowledge_read）。上一轮的凭据无效，换轮后必须重新发起 Wiki 尝试。
关键词未命中或受限检索只表示这些专名未检索到，绝不能据此断言整库没有相关材料或材料不存在。
仅当需要打开检索结果里已有命中页的正文或 wiki 词条页时，调用 ask_knowledge_lookup，可携带 cursor 继续翻页。
返回 cursor 表示还有未读内容；用相同 terms 继续检索或翻页。不要用工作区文件、bash 或问数据工具代替知识库检索。
不要用 write、edit 或 bash 修改知识库目录或 .octopus-kb/。
```

#### Token effect

Fixed per-request cost while the session stays bound. Unbound sessions omit the section.

#### KV Cache effect

Prefix-stable for a bound session. Attach or detach may invalidate reuse from the first changed prompt token.

### Retrieve and lookup tools

#### What the model sees

The overlay registers `ask_knowledge_retrieve`, `ask_knowledge_read`, `ask_knowledge_lookup`, `ask_knowledge_session_document` and its `ask_knowledge_attachment_read` alias when `ctx.tools` is present. Response allowances include the complete text content wrapper, external-data fence and safety escaping. Rendered JSON includes passage IDs, continuation cursors, conversion diagnostics and evidence labels. Library source operations require a successful earlier wiki tool result logged in the same session, library and turn; an unavailable wiki must be logged before the separate source call. Receipt validation accepts authoritative JSON inside the standard external-data safety fence while retaining session, turn, library and originating-call checks. Wiki reads remain unverified summaries. Source results identify the indexed source revision and the returned passage offsets. Lookup paginates before returning text and never clips a delivered range a second time. Experimental tools are omitted from the official tool catalog; `terms[]` and `term` accept names rather than sentences.

#### Token effect

Schema cost is fixed while the tools stay registered. Results are data-dependent and bounded by `maxResultItems` / `maxResultChars` / `maxResultTokens`.

#### KV Cache effect

Prefix-stable while the tool set is unchanged. HMR dispose removes all five schemas and may invalidate reuse from the first changed schema token.

## Known Limitations and Deferred Work

- Image-only PDF pages need OCR. Mixed text/image pages remain partial because embedded image text completeness is unverified; cloud OCR is not called.
- DOCX uses the isolated native converter where network confinement is supported. The built-in fallback reports partial extraction and its omitted parts. Legacy `.doc` / `.xls` are unsupported; tables generally belong in ask-data.
- Native converter networking is denied by the OS on macOS; unavailable confinement fails closed. Windows native conversion remains deferred until an equivalent network policy is available. Managed subprocess ownership on macOS uses process groups and cannot contain arbitrary escaped descendants.
- Session document tools authorize official FileBlocks in model-visible session history, including inherited history. The official attachment store retains the original; this overlay streams verified bytes into private staging and refuses conversion above `maxIngestBytes` (20 MiB by default). Converted documents are read through bounded cursors beyond 32,000 characters. Search and read cursors are operation-bound; after a process restart, start a new read to obtain a fresh cursor. A versioned, integrity-checked cache is rebuilt when conversion policy changes; cache eviction never deletes originals. No separate 24-hour retention policy is added.
- Settings show real retention, conversion, search and chunk progress. Approve starts the displayed plan; Cancel stops owned work but preserves originals and committed history; Retry creates a fresh estimate without inference. Uncertain paid outcomes show a separate confirmation explaining that another model call can consume quota; ordinary Resume never replays them automatically.

### Dev Note

`catalog.json` owns library identity. Private streamed originals are fsynced, published without replacement, and registered through recoverable intents; registration repair precedes startup job recovery. A shared short file lock serializes startup fencing, cancellation and wiki/audit publication, while inference runs outside that lock. Only explicit extraction calls receive the configured credential. Callers await managed process shutdown, and converter results use private bounded files. Library removal deletes its retained sources and processing records. Native Windows installed-flow verification remains a separate release requirement.

Registered conversion output is excluded from automatic source indexing until its durable processing plan is published; cancelled conversions can leave retained raw files, but these are not searchable. Source evidence offsets are Unicode codepoint ranges in the complete SHA-256-named source revision. Tables remain contiguous rather than repeating synthetic headers. Attachment tools share one implementation; `ask_knowledge_attachment_read` is a compatibility alias. Conversion caches include the native converter version and built-in converter generation, and use `_v2.json` filenames. The default `maxResultTokens` allowance conservatively counts one serialized UTF-8 byte as one token (up to 6,000 bytes, including metadata); long documents require cursor round-trips rather than losing their tails.
