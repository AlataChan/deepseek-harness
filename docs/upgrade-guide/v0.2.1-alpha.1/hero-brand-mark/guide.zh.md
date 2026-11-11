---
kind: upgrade-guide
description: "空白会话 Hero 不再渲染 conversation.hero.brand.mark 的插件内容。"
---

# 空白会话品牌标识

[English](guide.md) | 中文

## 变更

空白会话 Hero 不再渲染 `conversation.hero.brand.mark` 或默认鲸鱼图标。注册该插槽的插件仍可加载，但其 Hero 标识不会显示。侧边栏标识和 `conversation.hero.headline` 仍然可用。

## 迁移

1. 从客户端插件中移除针对 `conversation.hero.brand.mark` 的注册。
2. 如需持续显示品牌标识，使用 `sidebar.brand.mark`，并遵循该插槽声明的 owner 属性；不要隐式复用 Hero 的 owner 属性。`conversation.hero.headline` 仅用于标题内容。
3. 打开空白会话，确认标识显示在侧边栏，标题前没有图标。内置问数品牌标识已采用此布局。
