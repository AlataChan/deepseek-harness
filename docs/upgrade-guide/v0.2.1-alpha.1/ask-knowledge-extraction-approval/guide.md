---
kind: upgrade-guide
description: Ask Knowledge uploads now require explicit whole-document budget approval before model extraction.
---

# Ask Knowledge extraction approval

English | [中文](guide.zh.md)

## Change

Uploading a knowledge-library document now retains the original and indexes the complete converted text before requesting model extraction. Upload completion no longer starts paid wiki extraction automatically. Existing raw and handwritten wiki pages remain searchable; legacy imports cannot restore original bytes that earlier versions discarded.

The library document list shows the retained source, conversion limitations, extraction status, and whole-document allowance. Retry prepares a new estimate. Interrupted requests with uncertain billing are not repeated automatically. Official session attachments now use authorized conversion and bounded reads beyond 32,000 characters; their originals stay in the official attachment store and do not become library documents. Conversion uses `maxIngestBytes` admission (20 MiB by default) and can be refused without deleting the original. Tool renderers expose cursors and diagnostics; source reads require an earlier logged wiki result in the same turn. Old conversion caches are rebuilt automatically.

`extractionContextChars` now counts the entire serialized wiki-context bundle, including page paths and JSON framing, rather than page text alone. Existing values remain valid but may include less body text. New plans calculate a conservative full-request allowance; no paid work starts automatically. Raise the setting only when a larger context allowance is intended and approve the resulting estimate.

Log operations now accept only `wiki/LOG.md`; old proposals that append logs to content pages are rejected. New plans use 6,000-character excerpts and a 4,096-token initial output reserve by default, with a deadline per chunk. Explicit configuration still overrides these defaults. The card labels the conservative approval ceiling separately from actual reported usage and flags chunks without a knowledge page. Invalid saved replies require Retry and a new approval; publication I/O recovery can still Resume without inference. Previously polluted wiki pages require an owner-authorized repair; upgrading does not silently rewrite them.

## Migration

1. Install the updated desktop application and open the existing knowledge library. Keep its directory intact; opening the document list registers legacy raw pages without rewriting handwritten wiki content.
2. Expand the library in settings and inspect each document's conversion status and estimated allowance. Re-upload any document whose original is unavailable if retaining its original bytes is required.
3. Choose the budget approval action only when ready to start model extraction. The route remains owned by the library's `.octopus-kb/config.toml`; no application-wide model setting is changed.
4. Confirm that an unapproved upload is searchable without a provider request, then approve one document and verify its extracted wiki entries and recorded usage. After restarting the application, completed chunks must remain completed. Use the separate paid-replay confirmation for uncertain outcomes only after reviewing its quota warning; ordinary Resume cannot repeat those calls. Use Retry for a fresh estimate on failed unambiguous work.
