---
kind: upgrade-guide
description: "Blank-session Hero no longer renders contributions to conversation.hero.brand.mark."
---

# Blank-session branding

English | [中文](guide.zh.md)

## Change

The blank-session Hero no longer renders `conversation.hero.brand.mark` or its default whale icon. Plugins that register that slot remain loadable, but their Hero mark is not displayed. The sidebar mark and `conversation.hero.headline` remain available.

## Migration

1. Remove registrations targeting `conversation.hero.brand.mark` from your client plugin.
2. For a persistent brand mark, register `sidebar.brand.mark` with the owner props declared by that slot; do not reuse Hero owner props implicitly. Use `conversation.hero.headline` only for headline content.
3. Open a blank session and confirm the intended mark appears in the sidebar and the headline has no leading logo. The bundled Ask Data branding already follows this arrangement.
