# Agent Note: Desktop ask-data contrast, Settings gutter, leaf-whale mark

Status: implemented

[English](2026-08-31-desktop-chrome-contrast-brand.md) | 中文

## Problem

暗色 Client 里，问数页的导语、避坑和预览用了不存在的 `--dsw-alias-text-secondary`，文字继承浅色 `body` 近黑色，看不清。Tauri 的 Settings 固定在窗口右上角，压住会话顶栏的 Session 操作。侧栏和空白首页仍是官方鱼标。

## Decision

问数文案改用 `--dsw-alias-label-primary` / `--dsw-alias-label-secondary`。桌面设置按钮隐藏时 `--dsh-desktop-chrome-right` 为 `0px`，会话顶栏回到默认 28px。overlay 占用 `sidebar.brand.mark` 和 `conversation.hero.brand.mark`，画奶油底绿叶鲸（与 Dock 标同一套图）；单槽后注册会盖过官方鱼标。一个设置入口和产品身份见[桌面壳归一](../feature/2026-08-31-desktop-chrome-unify.zh.md)。

## Alternatives considered

**把 Settings 改到侧栏页脚。** 否决：桌面 Settings（工作区 / Node）不是 Client 的「设置」，壳层不能直接注册进 Client 槽。

**改 `FishLogo` 本身。** 否决：那是 overlay 之外仍在用的官方鲸线。

## Consequences

覆盖见 `tests/data-source-page.client.spec.tsx`、`tests/apply.client.spec.ts`、`tests/octopus-mark.client.spec.tsx`。会话顶栏槽位只在桌面壳写入该变量时生效。
