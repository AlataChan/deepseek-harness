---
kind: upgrade-guide
description: "关闭可选运行时上下文后，必需的执行目录上下文仍对模型可见。"
---

# 执行目录升级

[English](guide.md) | 中文

## 变更

includeRuntimeContext: false 和 suppressRuntimeContext() 关闭可选运行时信息，但保留必需的目录文本。PromptContext 新增 required 与 interpolate；interpolate: false 原样保留路径。请求准入在路由准备后重新计算已注册的运行时上下文提供方，但保留已接受的章节、工具和变量。模型请求仍可由已记录的会话事件重建。

## 迁移

1. 可保留关闭可选上下文的设置；该设置不再隐藏执行目录。
2. 自定义运行时上下文仅对关闭可选信息后仍必需的运行事实设置 required: true；原样路径设置 interpolate: false。
3. 验证 pre-step 或 prepareCall 中切换的目录出现在首次实际请求及其日志运行时上下文消息中。准入时不要重新运行提示词章节或工具提供方。
