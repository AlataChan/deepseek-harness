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

Empty `knowledgeHome` uses `OCTOPUS_APP_DATA`. Empty `sidecarRuntimePath` uses `OCTOPUS_SIDECAR_HOME`. `cordis.patch.yml` inserts this one Host row. The Client mounts the generated document Remote contribution before registering its UI. The per-library `.octopus-kb/config.toml` owns the extraction route; approval binds its profile, model, endpoint, actual serialized requests, source hash, and complete character coverage. Route or request changes require a new estimate and approval. Missing or ambiguous responses pause processing and never trigger automatic paid retries.

`ctx.askKnowledgeDocuments` is an interface-typed Host service provided by this overlay's `DocumentsServiceImpl`. It owns library-scoped original storage, integrity verification and document records. Document processing uses `DocumentJobId`; job identifiers are persisted as strings.

## Model Experience

### Bound retrieve prompt

#### What the model sees

When `askKnowledgeBinding` is set, the Provider registers the `ask-knowledge:retrieve` system-prompt section. File bytes and API keys never enter the session log.

##### Retrieve section

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

#### Token effect

Fixed per-request cost while the session stays bound. Unbound sessions omit the section.

#### KV Cache effect

Prefix-stable for a bound session. Attach or detach may invalidate reuse from the first changed prompt token.

### Retrieve and lookup tools

#### What the model sees

The overlay registers `ask_knowledge_retrieve`, `ask_knowledge_read`, and `ask_knowledge_lookup` when `ctx.tools` is present. Search and complete passage reading return private library/query/generation-bound continuation cursors. Their normal tool results retain model-visible text and cursor metadata in the Session log. Experimental tools are omitted from the official tool catalog. The executor accepts `terms[]` or one `term` and rejects sentences. Retrieve render includes each hit body so the model can answer without a second lookup.

#### Token effect

Schema cost is fixed while the tools stay registered. Results are data-dependent and bounded by `maxResultItems` / `maxResultChars` / `maxResultTokens`.

#### KV Cache effect

Prefix-stable while the tool set is unchanged. HMR dispose removes all three schemas and may invalidate reuse from the first changed schema token.

## Known Limitations and Deferred Work

- Image-only PDF pages need OCR. Mixed text/image pages remain partial because embedded image text completeness is unverified; cloud OCR is not called.
- DOCX uses the isolated native converter where network confinement is supported. The built-in fallback reports partial extraction and its omitted parts. Legacy `.doc` / `.xls` are unsupported; tables generally belong in ask-data.
- Native converter networking is denied by the OS on macOS; unavailable confinement fails closed. Windows native conversion remains deferred until an equivalent network policy is available. Managed subprocess ownership on macOS uses process groups and cannot contain arbitrary escaped descendants.
- Session-only document previews retain their existing 32,000-character cap. This overlay does not add a 24-hour session-document retention policy.
- Settings show real retention, conversion, search and chunk progress. Approve starts the displayed plan; Cancel stops owned work but preserves originals and committed history; Retry creates a fresh estimate without inference. Ambiguous paid outcomes require investigation rather than automatic repetition.

### Dev Note

`catalog.json` owns library identity. Private streamed originals are fsynced, published without replacement, and registered through recoverable intents; registration repair precedes startup job recovery. A shared short file lock serializes startup fencing, cancellation and wiki/audit publication, while inference runs outside that lock. Only explicit extraction calls receive the configured credential. Callers await managed process shutdown, and converter results use private bounded files. Library removal deletes its retained sources and processing records. Native Windows installed-flow verification remains a separate release requirement.
