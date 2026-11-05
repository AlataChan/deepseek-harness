---
kind: upgrade-guide
description: "agent-instructions 的 maxBytes 配置现在分别限制每条指令链，而不再限制两条链合并后的消息。"
---

# 独立的指令链字节预算

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-agent-instructions` 分别将 `maxBytes` 应用于用户全局指令和项目指令。此前两条链共享一份消息预算。现在，同时包含两条链的基线消息或动态批次最多可占用 `maxBytes` 的两倍。一条链不能借用另一条链未使用的额度。非正数或非有限数值仍会禁用指令加载。

## 迁移

1. 在 `cordis.yml` 或配置预设补丁中找到 `@deepseek-ai/dsh-agent-instructions` 配置行。如果可以接受更大的合并上限，保留原有 `maxBytes`。当两条链都存在时，`dsh-base` 的 `65536` 配置现在最多允许 `131072` 字节。
2. 如果需要保守地维持原有合并字节上限，将 `maxBytes` 设为原值的一半并向下取整。例如，将 `65536` 改为 `32768`。这可能让任意一条链更早被截断；此前共享额度的分配方式不再提供。
3. 在同时存在用户全局和项目指令文件的环境中新建会话。检查日志中的指令消息，确认其 UTF-8 字节数符合所选的合并上限。发现和截断行为参见[包参考](../../../../packages/context/agent-instructions/README.zh.md)。
