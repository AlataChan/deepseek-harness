# Agent Note: 桌面壳：一个设置入口，octopus_DSH 身份

Status: implemented

[English](2026-08-31-desktop-chrome-unify.md) | 中文

## Problem

打包后的桌面同时出现两个设置（英文 `Settings` 和侧栏「设置」），侧栏是带 dirty 哈希的「DSH 本地构建」，首页是官方口号加「预览版」。问数 chip 和旁边的工作区、模式控件不是同一套几何。

## Decision

桌面设置按钮留在 DOM 里但隐藏。侧栏「设置」通用页的「工作文件夹」一行点击 `[data-testid="desktop-settings-open"]`。桌面面板和 Client 尚未挂上时的首页文案用中文。`--dsh-desktop-chrome-right` 为 `0px`，因为那个按钮不可见。overlay 占用 `sidebar.brand.name`（`octopus_DSH`）和 `conversation.hero.headline`（「先选工作文件夹，再提问」），并藏掉官方预览徽标。问数 chip 与工作区、模式控件同一套几何。强调色仍用官方蓝。

不把 Node / 运行时并进 Client 设置，不改模型选择器，不在首页加功能卡。默认助理仍是官方 `standard`。

## Alternatives considered

**覆盖 `conversation` 文案命名空间。** 否决：`locale.register` 拒绝同一 locale 的第二本词典。

**改 ui-conversation 里的官方 `hero.headline`。** 否决：非桌面 Client 也读这句。

**删掉 `attachSettingsButton`。** 否决：隐藏按钮是 Client 行在同一文档里能点到的唯一入口，不必再加壳层 API。

更早的笔记因缺少桥接否决过把桌面 Settings 放进 Client 面板；隐藏按钮点击就是这座桥。见[对比度与标](../bug-fix/2026-08-31-desktop-chrome-contrast-brand.zh.md)。

## Consequences

覆盖见 `apps/desktop/tests/settings.spec.ts`、`apps/desktop/tests/bootstrap.spec.ts`、`packages/client/ui-conversation/tests/skeleton.client.spec.tsx`、`packages/experimental/desktop-ask-data/tests/apply.client.spec.ts`、`packages/experimental/desktop-ask-data/tests/octopus-mark.client.spec.tsx`。
