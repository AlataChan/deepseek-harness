# @deepseek-ai/dsh-experimental-desktop-ask-knowledge

English | [中文](README.zh.md)

Private octopus_DSH overlay: the Provider for [`ctx.askKnowledge`](../../host/ask-knowledge/README.md) plus the Client occupant of `conversation.hero.askKnowledge`. Official `dsh-desktop-app` and the default `standard` assistant do not name this package. The desktop profile seed copies the built tree (`source: "workspace"` in [scripts/desktop-profile-plugins.json](../../../scripts/desktop-profile-plugins.json)).

Vaults live under Tauri `app_data_dir` (`OCTOPUS_APP_DATA` / `knowledgeHome`). `catalog.json` is the only directory of record. The workspace folder may hold an optional symlink; it is not an index. Propose reads `DEEPSEEK_API_KEY` from `ctx.credentials.resolve` and injects it only into that sidecar child. The sidecar executable is resolved from `sidecarRuntimePath` then `OCTOPUS_SIDECAR_HOME`. Retrieve uses `terms[]` from the official SD schema. Full tool results are bounded. Upload uses `beginIngest` / `appendIngestChunk` / `finishIngest`. `finishIngest` runs convert, LLM propose, and apply; the desktop carrier waits 180s for that one method. Session-only extract uses `beginExtract` / `appendExtractChunk` / `finishExtract`; `finishExtract` runs sidecar `convert-file` only, waits 90s, and does not write catalog. The picker hangs an existing row on the name, adds a document into that same library, or deletes the row from the catalog. Hanging from a data-agent Session that already has an ask-data bind creates a new standard Session in the same workspace; data-agent denies retrieve tools. Propose fills missing `role` / `layer` / wiki `summary` on `create_page` before apply, and copies tags onto aliases. Apply fills the same fields, and retrieve/lookup re-apply a rejection whose only fail was page-meta so the wiki digest lands. Retrieve folds query, title, and body with NFKC, and `ask_knowledge_retrieve` renders page bodies to the model. Lookup resolves a title, alias, tag, or retrieve hit when the exact wiki name differs from the typed term. Create shows the upload panel; the choose-file control is a transparent file input over the visible button so Tauri WebView can open the native picker. That input omits HTML accept and listens on the element so WebKit delivers the File. Catalog writes wait for a file or Skip. The composer plus menu opens that upload panel. A successful first ingest renames an untitled row to the file stem; adding to a named library does not rename. Failed `finishIngest` shows `error`, mapping known sidecar English to Chinese. Propose clips a long raw file and asks for a short `create_page` body. The composer stays visible. The composer plus menu opens the same picker through `conversation.input.attachKnowledge`, and holds a session-only document as a composer chip through `conversation.input.attachSessionDocument`. Session-only Word is unzipped on the Host from `word/document.xml`; PDF and HTML still use sidecar `convert-file`. Knowledge ingest accepts `.docx` the same way: Host unzip, then sidecar `ingest-file` on the markdown. The Client factory does not import `fflate`.

Missing `OCTOPUS_APP_DATA` or `OCTOPUS_SIDECAR_HOME` fails only ask-knowledge methods. Companion chat still starts. octopus-kb is vendored under `python/` with its MIT `LICENSE` and `SOURCE.txt`. Frozen propose/apply resolve `prompts/` and `schemas/` from `OCTOPUS_KB_ROOT`, then the source tree, then the onedir parent.

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
不要用工作区文件、bash 或问数工具代替知识库检索。只有检索结果为空时，才能说库里没有这份材料。
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
