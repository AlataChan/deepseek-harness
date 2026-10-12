---
description: "octopus_DSH ask-knowledge overlay: document libraries under the Tauri app-data directory, a Python sidecar pipeline, and the conversation.hero.askKnowledge Client seat."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-ask-knowledge

English | [中文](README.zh.md)

## Summary

`desktop-ask-knowledge` is the private desktop overlay for document libraries: it provides `ctx.askKnowledge`, runs the vendored octopus-kb sidecar for ingest, propose, and extract, and occupies `conversation.hero.askKnowledge`. Vaults live under Tauri `app_data_dir`; `catalog.json` is the only directory of record, and the workspace symlink is optional and never an index. The desktop profile seed installs it; official `dsh-desktop-app` and the default `standard` assistant do not name it.

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
```

Empty `knowledgeHome` uses `OCTOPUS_APP_DATA`. Empty `sidecarRuntimePath` uses `OCTOPUS_SIDECAR_HOME`. `cordis.patch.yml` inserts this one Host row. The Client half is discovered from `dsh.client` after the Host fiber is live.

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
不要用工作区文件、bash 或问数据工具代替知识库检索。只有检索结果为空时，才能说库里没有这份材料。
仅当需要打开检索结果里某一条 wiki 词条页时，再调用 ask_knowledge_lookup，term 用该页标题或路径。
不要用 write、edit 或 bash 修改知识库目录或 .octopus-kb/。
```

#### Token effect

Fixed per-request cost while the session stays bound. Unbound sessions omit the section.

#### KV Cache effect

Prefix-stable for a bound session. Attach or detach may invalidate reuse from the first changed prompt token.

### Retrieve and lookup tools

#### What the model sees

The overlay registers `ask_knowledge_retrieve` and `ask_knowledge_lookup` when `ctx.tools` is present. Experimental tools are omitted from the official tool catalog. The executor accepts `terms[]` or one `term` and rejects sentences. Retrieve render includes each hit body so the model can answer without a second lookup.

#### Token effect

Schema cost is fixed while the tools stay registered. Results are data-dependent and bounded by `maxResultItems` / `maxResultChars` / `maxResultTokens`.

#### KV Cache effect

Prefix-stable while the tool set is unchanged. HMR dispose removes both schemas and may invalidate reuse from the first changed schema token.

## Known Limitations and Deferred Work

- **Scanned PDF is empty** — text PDFs go through markitdown[pdf]; image-only pages do not OCR
- **No .xls** — Excel must be `.xlsx`. Spreadsheets fit ask-data better than this library
- **No legacy .doc** — Word must be `.docx`. Host reads `word/document.xml` only; headers, footers, and comments in other zip parts are omitted
- **No inbox review desk or ingest-url**
- **No official desktop-app composition change** — this overlay is a profile pin

### Dev Note

`catalog.json` is the only directory of record, and the sidecar child receives `DEEPSEEK_API_KEY` for that one process only; missing `OCTOPUS_APP_DATA` or `OCTOPUS_SIDECAR_HOME` must fail only ask-knowledge methods, never companion chat. The browser-side upload queue is per-window and the Host serializes ingest per library, so a closed window drops queued files; `builtins.yaml` intentionally drops `confidence.tier_gate_defer` so a medium-confidence proposal applies instead of parking in an inbox no surface reviews.
