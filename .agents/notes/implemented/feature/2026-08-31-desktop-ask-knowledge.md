# Agent Note: Desktop ask-knowledge overlay

Status: implemented

English | [中文](2026-08-31-desktop-ask-knowledge.zh.md)

## Problem

octopus_DSH already ships 问数. The enterprise set also needs 问知识: a durable, thickening library the user can hang on a standard session, leave, and find again after changing the workspace folder. octopus-kb already owns ingest, propose, two-phase apply, and substring retrieve. That pipeline is not present in the desktop product, and a skill-only or TypeScript rewrite would lose the audit chain or freeze the official desktop composition.

## Decision

Official Service Definition `@deepseek-ai/dsh-host-ask-knowledge` (`ctx.askKnowledge`) plus private overlay `@deepseek-ai/dsh-experimental-desktop-ask-knowledge`. Vaults live under Tauri `app_data_dir` (`OCTOPUS_APP_DATA`). `catalog.json` is the only directory of record. octopus-kb runs through a Python sidecar. The default assistant stays `standard`. The chip opens a picker and does not occupy `conversation.askData.gate`. Official `desktop-app` / `desktop-companion` product logic is unchanged except Tauri spawn injecting `OCTOPUS_APP_DATA` and `OCTOPUS_SIDECAR_HOME`.

Propose reads `DEEPSEEK_API_KEY` from `ctx.credentials.resolve` and injects it only into that sidecar child. Retrieve accepts `terms[]`, not a raw sentence. Full tool payloads are bounded. Ingest uses `beginIngest` / `appendIngestChunk` / `finishIngest` because the desktop carrier cap is 256KiB. Session-only extract uses `beginExtract` / `appendExtractChunk` / `finishExtract` and sidecar `convert-file`; it does not write catalog ([session extract](2026-09-01-session-document.md)). `removeLibrary` holds catalog, then per-session mutexes, then the library lock; cold sessions are unbound through `sessionPersistence.append` after a live re-check. `attach` releases catalog before recover and touches `lastUsedAt` only after session and library locks are released.

The sidecar runtime is a relocatable PyInstaller tree at `Contents/Resources/resources/kb-runtime/`. `build-dmg.sh` embeds it before codesign and verifies after assemble. octopus-kb is pinned at `d4852698caedbb37f4c370bc339da22a38db1367` with its MIT `LICENSE` and a `SOURCE.txt`.

## Alternatives considered

**Skill-only CLI.** Rejected: progress, defer, recover, and first-run Python setup are not controllable for ordinary users.

**TypeScript rewrite of propose / validate / audit.** Rejected for v1: the two-phase audit and YAML rules are the library. Rewriting them is a second product.

**Ask-data-style preset lock and composer gate.** Rejected: a knowledge library is a cross-session asset. Hanging it must not hide the composer or replace `standard`.

**Vault in the workspace folder.** Rejected: changing workspace would hide or duplicate libraries. The workspace holds an optional symlink only.

## Consequences

A new standard session shows a 知识库 chip; picking an existing library hangs `libraryId` without changing preset. Hanging from a data-agent Session that already has an ask-data bind creates a new standard Session with the same cwd; data-agent `tools.restrict` denies `ask_knowledge_retrieve`. An unbound data-agent Session is switched back to `standard` before attach. Propose fills missing `role` / `layer` / wiki `summary` on each `create_page` so apply is not rejected for page-meta. The bound retrieve prompt tells the model to call retrieve before answering from the library, and the section is empty on a data-agent Session. Each catalog row also has 添加文档, which ingests into that library and does not create a new one, and 删除, which calls `removeLibrary` and drops the row from the list. Creating a library opens the native file dialog in the same click and does not write the catalog until a file is accepted or Skip. Accepted files are `.md`, `.txt`, `.html`, `.pdf`, `.csv`, `.json`, and `.xlsx`. `.xls` is rejected. CSV decodes with charset-normalizer, utf-8-sig, then gb18030. `.xlsx` converts with openpyxl, not pandas. PDF uses `markitdown[pdf]` text extraction; the freeze collects magika models so that converter can run. An empty conversion fails as a scanned page. The picker lead tells the user spreadsheets fit ask-data. The catalog default name is Untitled knowledge library; a successful ingest renames an untitled row to the file stem and leaves a named library unchanged. Failed `finishIngest` returns `error`; the Host maps `LLM returned non-JSON output` to Chinese, and the picker shows that text. Propose clips raw to 12 000 characters, asks for a `create_page` body of at most 800 characters, unwraps fenced JSON, and retries when `finish_reason` is `length`. Frozen propose/apply open `proposal.json` and `builtins.yaml` through `OCTOPUS_KB_ROOT` (then the source tree, then the onedir parent); `self-test` loads both via the package, not only `sidecar.py`'s resource root. Skip hangs an empty library, or hangs the target row when adding to an existing library. The composer stays visible. After creating library A in workspace W1, a new session in W2 lists A first by `lastUsedAt`. Propose succeeds when the key exists only in `.credentials.yaml`. `retrieve` rejects whole sentences at the executor; raw-only hits are success. Retrieve folds query, title, and body with NFKC so PDF compatibility characters match typed CJK. `ask_knowledge_retrieve` renders page bodies to the model; a count-only render made the model call lookup. Propose is the digest: it writes standard-Chinese wiki pages. Apply fills missing page-meta; retrieve/lookup re-apply a `schema.page_meta_invalid` rejection so that digest lands. Lookup resolves title, alias, tag, or a retrieve hit when the typed term is not the exact wiki name. `build-dmg.sh` embeds `kb-runtime/`, verifies the assembled `.app`, and refuses a DMG when sidecar self-test or portability checks fail. The bundled companion reads `KNOWN_SESSION_EVENT_TYPES` from embedded `dsh-session`; `verify-desktop-bundle.sh` refuses a harness cache that omits `ask-knowledge/bound`.

The desktop ships a relocatable Python runtime rather than a build-machine venv. Chinese whole-sentence retrieve is empty in octopus-kb, so the executor rejects it. Sidecar resource paths prefer `OCTOPUS_KB_ROOT`. Session mutex and library lock stay catalog → session → library so `removeLibrary` cannot invert an in-flight retrieve. `session/finishAskKnowledgeIngest` waits 180s; `session/finishAskKnowledgeExtract` waits 90s. Convert of a 4-page PDF is about 2s, and the 30s default drops the client while Host propose/apply still runs.
