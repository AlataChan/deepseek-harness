# Agent Note: Desktop chrome: one Settings entry, octopus_DSH identity

Status: implemented

English | [中文](2026-08-31-desktop-chrome-unify.zh.md)

## Problem

The packaged desktop showed two settings controls (English `Settings` vs sidebar 设置), a developer local-build title with a dirty git pill, and the official slogan plus 预览版. The 问数 chip used a different button geometry than the workspace and preset chips beside it.

## Decision

The floating desktop opener stays in the DOM and is hidden. Client 设置 General owns a 工作文件夹 row that clicks `[data-testid="desktop-settings-open"]`. The desktop panel and pre-Client home copy are Chinese. `--dsh-desktop-chrome-right` is `0px` because that opener is not visible. The overlay occupies `sidebar.brand.name` (`octopus_DSH`) and `conversation.hero.headline` (「先选工作文件夹，再提问」) and hides the official preview badge. The 问数 chip matches the workspace/preset chip geometry. Accent colors stay official blue.

This does not merge Node/runtime into Client settings, change the model selector, or add home feature cards. Official `standard` remains the default assistant.

## Alternatives considered

**Override `conversation` locale keys.** Rejected: `locale.register` refuses a second dictionary for the same locale.

**Change official `hero.headline` copy in ui-conversation.** Rejected: that string is shared with non-desktop Clients.

**Remove `attachSettingsButton`.** Rejected: the hidden control is the only same-document opener the Client row can click without a new shell API.

An earlier note rejected putting desktop Settings in the Client panel for lack of a bridge; the hidden-button click is that bridge. See [contrast and mark](../bug-fix/2026-08-31-desktop-chrome-contrast-brand.md).

## Consequences

Coverage is `apps/desktop/tests/settings.spec.ts`, `apps/desktop/tests/bootstrap.spec.ts`, `packages/client/ui-conversation/tests/skeleton.client.spec.tsx`, `packages/experimental/desktop-ask-data/tests/apply.client.spec.ts`, and `packages/experimental/desktop-ask-data/tests/octopus-mark.client.spec.tsx`.
