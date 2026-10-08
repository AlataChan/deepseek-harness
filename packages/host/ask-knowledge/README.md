---
description: "The AskKnowledge capability seam: the abstract ctx.askKnowledge Service Definition, its wire vocabulary, and the type-only client projection outlet."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-ask-knowledge

English | [中文](README.zh.md)

## Summary

`ask-knowledge` is the capability seam for the web GUI host's knowledge-library catalog, ingest, session-only extract, attach, and retrieve: the abstract `AskKnowledge` service (`ctx.askKnowledge`) is the Service Definition, providers own the catalog and sidecar, and official session remotes consume it. `beginIngest` / `finishIngest` is the upload path; `beginExtract` / `finishExtract` converts one file for this session without writing catalog; `attach` returns a same-process lease. A missing service fails as `session/ask-knowledge-unavailable`.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Model Experience

None, as this Service Definition owns only the capability vocabulary and term schema.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No inbox review desk** — deferred ingest is reported as failure, not a queue UI.
- **Scanned PDF is empty** — Providers that convert PDF use text extraction, not OCR.

### Dev Note

The seam owns the vocabulary, not the copy: neutral error codes plus `ASK_KNOWLEDGE_TERMS_SCHEMA` are exported here, and overlay packages map the Chinese sentences. `ask-knowledge/bound`/`unbound` merge into `SessionEventMap` here (no `@mode`), the `askKnowledgeBinding` projection is registered by the provider, and the `/client` outlet must stay type-only so a browser aggregate never loads the Host service.
