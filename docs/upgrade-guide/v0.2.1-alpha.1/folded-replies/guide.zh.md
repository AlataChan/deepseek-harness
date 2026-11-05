---
kind: upgrade-guide
description: 聊天轮次收起后默认保留全部助手回复，中间回复在工作步骤收起时仍可阅读。
---

# 聊天轮次收起后的回复

[English](guide.md) | 中文

## 变更

聊天轮次收起后默认保留全部助手回复，中间回复在工作步骤收起时仍可阅读。Host 设置 `ui-chat.foldedReplies` 和 `ui-chat.collapseTiming` 分别控制回复显示与收起时机。

## 迁移

1. 如需仅显示最终回答，在 Host 配置设置中将 `ui-chat.foldedReplies` 设为 `final`。
2. 设置 `ui-chat.collapseTiming: next-input` 可延迟到下一条输入时收起，也可保留 `completion`。
3. 检查工作步骤设置；打开设置不会写入缺失值。
