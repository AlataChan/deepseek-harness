# Agent Note: Ask-data list paints 「开始提问」 once per source

Status: implemented

[English](2026-08-30-desktop-ask-data-duplicate-start.md) | 中文

## Problem

示例带上 `lastUsedAt` 之后，问数页会在「最近使用」和「全部数据源」各画同一行，每行一颗「开始提问」。再打开这份源的预览，还会多出第三颗同样的按钮。

## Decision

`DataSourcePage` 拆名单：最近使用是按 `lastUsedAt` 降序、去掉当前预览 id；全部数据源是剩余项，同样去掉该 id，空了就不画。开始按钮改在点选或导入之后由页上统一画出；见 [唯一开始按钮](2026-08-31-desktop-ask-data-single-start.zh.md)。

## Alternatives considered

**全部数据源继续画完整 Host 名单。** 否决：只用过一份示例就会出现两颗相同的开始按钮，正是截图里的问题。

**第二行只藏按钮、保留行。** 否决：重复的是整行，不只是按钮。

## Consequences

名单里全是最近用过的源时只画一段。尚未用过的导入仍出现在全部数据源。Client 覆盖在 `tests/data-source-page.client.spec.tsx`。
