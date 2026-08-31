# Agent Note: Desktop ask-data contrast, Settings gutter, leaf-whale mark

Status: implemented

English | [中文](2026-08-31-desktop-chrome-contrast-brand.zh.md)

## Problem

On a dark desktop Client the 问数 lead, pitfalls, and preview copy used `--dsw-alias-text-secondary`, which is not a theme token, so the text inherited the light-theme body color and disappeared. The Tauri Settings control is `position: fixed` at the window's top-right and sat on the conversation Session header actions. The sidebar and blank hero still showed the official fish.

## Decision

Ask-data copy uses `--dsw-alias-label-primary` / `--dsw-alias-label-secondary`. `--dsh-desktop-chrome-right` is `0px` while the desktop opener is hidden; the conversation header then keeps its default 28px pad. The overlay occupies `sidebar.brand.mark` and `conversation.hero.brand.mark` with the cream-plate leaf-whale (same art as the dock icon) so a later single-slot registration shadows the official fish. One Settings entry and product identity live in [desktop chrome unify](../feature/2026-08-31-desktop-chrome-unify.md).

## Alternatives considered

**Restyle Settings into the sidebar footer.** Rejected: desktop Settings (workspace / Node) is not the Client 设置 panel, and the shell cannot register into Client slots without a window bridge.

**Change `FishLogo` itself.** Rejected: that path is the official whale used outside this overlay.

## Consequences

Coverage is `tests/data-source-page.client.spec.tsx`, `tests/apply.client.spec.ts`, and `tests/octopus-mark.client.spec.tsx`. The conversation gutter is a no-op unless the desktop shell sets the variable.
