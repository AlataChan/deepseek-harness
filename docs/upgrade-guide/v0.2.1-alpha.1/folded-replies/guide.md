---
kind: upgrade-guide
description: Folded Chat turns keep every Assistant reply visible by default.
---

# Replies in folded Chat turns

English | [中文](guide.zh.md)

## Change

Folded Chat turns keep every Assistant reply visible by default. Earlier intermediate replies remain readable while process rows fold. The `ui-chat.foldedReplies` and `ui-chat.collapseTiming` Host settings control reply visibility and folding time independently.

## Migration

1. To retain final-answer-only display, set `ui-chat.foldedReplies` to `final` in your Host profile settings.
2. Choose `ui-chat.collapseTiming: next-input` to defer folding until a new input, or keep `completion`.
3. Verify the Work details settings; opening Settings does not write missing values.
