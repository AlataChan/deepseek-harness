---
kind: upgrade-guide
description: Ask Knowledge uploads now require explicit whole-document budget approval before model extraction.
---

# Ask Knowledge extraction approval

English | [中文](guide.zh.md)

## Change

Uploading a knowledge-library document now retains the original and indexes the complete converted text before requesting model extraction. Upload completion no longer starts paid wiki extraction automatically. Existing raw and handwritten wiki pages remain searchable; legacy imports cannot restore original bytes that earlier versions discarded.

The library document list shows the retained source, conversion limitations, extraction status, and whole-document allowance. Retry prepares a new estimate. Interrupted requests with uncertain billing are not repeated automatically. Session-only attachments retain their existing inline preview limit and do not become retained library documents.

## Migration

1. Install the updated desktop application and open the existing knowledge library. Keep its directory intact; startup registers legacy raw pages without rewriting handwritten wiki content.
2. Expand the library in settings and inspect each document's conversion status and estimated allowance. Re-upload any document whose original is unavailable if retaining its original bytes is required.
3. Choose the budget approval action only when ready to start model extraction. The route remains owned by the library's `.octopus-kb/config.toml`; no application-wide model setting is changed.
4. Confirm that an unapproved upload is searchable without a provider request, then approve one document and verify its extracted wiki entries and recorded usage. After restarting the application, completed chunks must remain completed. Use Retry to request a fresh estimate rather than assuming an interrupted request was free or unexecuted.
