# Agent Note: octopus_DSH window brand is 小绿鲸

Status: implemented

English | [中文](2026-09-18-desktop-window-brand-xiaolvjing.zh.md)

## Problem

The sidebar 18px wordmark still printed the engineering id `octopus_DSH`. That string fights the leaf-whale mark and is not a name ordinary users can say. The window brand, the dock product id, and the official fish must stay on separate seats.

## Decision

`@deepseek-ai/dsh-experimental-desktop-ask-data` occupies `sidebar.brand.name` with locale-owned `brandName`. Both `zh` and `en` dictionaries use `小绿鲸`. Official `apps/desktop` `productName`, `home.ts`, and `FishLogo` stay `octopus_DSH` / official fish. External copy may say 公益小绿鲸; the window does not. 绿章鱼 is not a product name unless the dock mark becomes an octopus.

## Alternatives considered

**元公益小绿鲸 or 公益小绿鲸 in the sidebar.** Rejected: the 18px seat cannot carry a four-to-five-character qualifier without wrapping or shrinking.

**绿章鱼, to match the octopus engineering name.** Rejected: the dock and sidebar marks are a leaf-whale, not an octopus. The engineering id stays octopus / octopus_DSH.

**Change official `apps/desktop` productName.** Rejected: course and overlay work must not change official desktop product packages. The window wordmark is an overlay slot.

## Consequences

A seeded octopus_DSH window shows 小绿鲸 next to the leaf-whale plate. Removing the ask-data bundle name restores the official fish wordmark. DMG and profile seed must include the rebuilt `lib/client.js`.

## Testing

`packages/experimental/desktop-ask-data/tests/octopus-mark.client.spec.tsx` renders `OctopusBrandName` with the `zh` dictionary and requires the text 小绿鲸.
