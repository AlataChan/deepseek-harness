# Agent Note: octopus_DSH window brand is 小绿鲸

Status: implemented

[English](2026-09-18-desktop-window-brand-xiaolvjing.md) | 中文

## Problem

侧栏 18px 品牌字仍打印工程名 `octopus_DSH`。这串字和绿叶鲸鱼标打架，普通用户也念不出来。窗内品牌、dock 产品 id、官方鱼标必须分座。

## Decision

`@deepseek-ai/dsh-experimental-desktop-ask-data` 占用 `sidebar.brand.name`，文案走 locale 的 `brandName`。`zh` 和 `en` 词典都写「小绿鲸」。官方 `apps/desktop` 的 `productName`、`home.ts`、`FishLogo` 仍是 `octopus_DSH` / 官方鱼。对外可写「公益小绿鲸」，窗内不写。除非 dock 标改成章鱼，否则不用「绿章鱼」。

## Alternatives considered

**侧栏写「元公益小绿鲸」或「公益小绿鲸」。** 否决：18px 座位扛不住四到五个字的前缀，会折行或缩小。

**写「绿章鱼」以贴合 octopus 工程名。** 否决：dock 与侧栏标是绿叶鲸鱼，不是章鱼。工程 id 仍是 octopus / octopus_DSH。

**改官方 `apps/desktop` productName。** 否决：课期包和 overlay 不得改官方桌面产品包。窗内品牌字是 overlay 槽。

## Consequences

已种子的 octopus_DSH 窗口在绿叶鲸鱼标旁显示「小绿鲸」。从 bundles 去掉 ask-data 包名后，官方鱼标字会回来。DMG 与 profile 种子必须带上重建后的 `lib/client.js`。

## Testing

`packages/experimental/desktop-ask-data/tests/octopus-mark.client.spec.tsx` 用 `zh` 词典渲染 `OctopusBrandName`，并要求文本为「小绿鲸」。
