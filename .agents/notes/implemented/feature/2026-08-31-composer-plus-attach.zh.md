# Agent Note: Composer plus attaches images

Status: implemented

[English](2026-08-31-composer-plus-attach.md) | 中文

## Problem

工作台加号打开的是斜杠指令菜单。用户习惯加号表示添加附件、`/` 表示指令。粘贴和拖放已经能加图片，栏上没有文件对话框入口。

## Decision

加号打开短菜单。「添加图片」走与粘贴、拖放同一条 `intakeImages` 路径；`accept` 跟随投影的 `imageLimits.mediaTypes`，没有该投影时为 PNG/JPEG/WebP/GIF。「看这份文档（仅本会话）」在浏览器里读本地 Markdown / TXT 并放在 composer 芯片上；PDF / HTML / Word 在 overlay 已 `onReady` 时设置 `conversation.input.attachSessionDocument.file`，否则 toast 这些类型需要桌面运行时。「引用工作区文件（@）」在光标处切换 `@` 引用菜单。「添加到知识库（制度 / Word / PDF）」在桌面 overlay 已 `onReady` 时递增 `conversation.input.attachKnowledge.openRequest`，否则 toast 知识库路径。`/` 按钮保留原指令菜单启动器；在草稿中键入 `/` 仍打开该菜单。会话附件仍只接受图片。仅本会话正文随下一条 prompt 走 `{ type: 'text' }`（[会话抽取](2026-09-01-session-document.zh.md)）。

## Alternatives considered

**只改 tooltip 或占位符。** 否决：仅图片的选择器选不了 PDF，用户看不到补救提示。加号菜单在点击添加的瞬间写出四条路径。

**只改加号、不放 `/` 按钮。** 否决：compact、export 等指令会失去唯一的指针入口。

**加号弹出「添加图片 / 指令」菜单。** 否决：多一层菜单，仍不符合加号即添加的习惯。

**选择器接受任意文件。** 否决：第一版 admission 只收栅格图。通用选择器会对每个 PDF 弹失败提示。仅本会话文档走自己那一行；入库仍走知识库那一行。

**桌面 overlay 隐藏或替换官方加号。** 否决：控件在共享 `InputBar` 上；否则 web 与桌面会分叉。

## Consequences

锁定会话时加号禁用。无法接入图片时禁用「添加图片」行；缺少 `toggleReferenceMenu` 时禁用「引用工作区文件」。斜杠按钮仍只在会话锁定或缺少 `toggleCommandMenu` 时禁用。覆盖为 `packages/client/ui-conversation/tests/input-bar.client.spec.tsx`、`packages/client/ui-conversation/tests/input-matrix.client.spec.tsx`、`packages/client/ui-conversation/tests/session-document.client.spec.ts`、`packages/experimental/desktop-ask-knowledge/tests/attach-knowledge-bridge.client.spec.tsx` 与 `packages/experimental/desktop-ask-knowledge/tests/attach-session-document-bridge.client.spec.tsx`。
