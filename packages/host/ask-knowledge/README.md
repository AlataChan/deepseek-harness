# @deepseek-ai/dsh-host-ask-knowledge

English | [中文](README.zh.md)

The web GUI host's knowledge-library catalog, ingest, session-only extract, attach, and retrieve is a capability seam. The abstract `AskKnowledge` service (`ctx.askKnowledge`) is its Service Definition. Providers implement the catalog, vault, and sidecar. The Consumer is official session remotes: it only calls these methods and maps `AskKnowledgeError` onto the wire. An absent service fails as `session/ask-knowledge-unavailable`.

Client aggregates import `@deepseek-ai/dsh-host-ask-knowledge/client` for the `askKnowledgeBinding` projection merge; that outlet re-exports `./types` and does not load the Host `AskKnowledge` service.

`listLibraries` reads `catalog.json` only and does not run recover. `createLibrary` writes an empty vault and a catalog row. `beginIngest` / `appendIngestChunk` / `finishIngest` are the upload path; a single Remote record must not carry the file. A failed `finishIngest` may include `error`. `beginExtract` / `appendExtractChunk` / `finishExtract` convert one file to text for this session and do not write catalog; `finishExtract` returns at most `ASK_KNOWLEDGE_EXTRACT_MAX_CHARS` code points. `attach({ libraryId, sessionId })` runs after the target Session exists and returns a same-process `AskKnowledgeAttachLease`. `ask-knowledge/bound` and `ask-knowledge/unbound` are merged into `SessionEventMap` here (no `@mode`); the `askKnowledgeBinding` projection is registered by the Provider.

Term schema, error codes, and neutral error data are exported from this package (`ASK_KNOWLEDGE_TERMS_SCHEMA`, `ask-knowledge/terms-invalid`, `ask-knowledge/no-hit`). Overlay packages map Chinese copy only.

The octopus_DSH desktop entry is the experimental Provider plus Client occupant (`@deepseek-ai/dsh-experimental-desktop-ask-knowledge`). Official web compositions omit that package, so `conversation.hero.askKnowledge` stays empty.

## Model Experience

None, as this Service Definition owns only the capability vocabulary and term schema.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No inbox review desk** — deferred ingest is reported as failure, not a queue UI.
- **Scanned PDF is empty** — Providers that convert PDF use text extraction, not OCR.
