---
kind: upgrade-guide
description: Local submission registration stays private until Host acceptance.
---

# Composer admission and local echoes

English | [中文](guide.zh.md)

## Change

Local submission registration stays private until Host acceptance. Composer consumers keep the document read-only during the sending phase and clear it only after acceptance. Integrations that paint an echo immediately in beginSubmission must wait for the accepted prompt result.

On phones and tablets, choosing a workspace leaves the newly enabled composer unfocused, including when workspace adoption enables it after the modal closes. Modal closure does not automatically refocus a text entry that was noneditable when the modal opened; already editable controls and ordinary buttons retain return focus. Refused submissions retain the draft and editor focus; accepted submissions clear the draft and move focus to the composer card.

## Migration

1. Handle the `sending` phase in custom composer controls.
2. Keep the complete draft and attachment ids until `prompt()` returns acceptance; on refusal, permit editing the same document.
3. Read accepted echoes from `snapshot.pendingSubmissions`. Confirm a refused first message leaves the Session blank.
