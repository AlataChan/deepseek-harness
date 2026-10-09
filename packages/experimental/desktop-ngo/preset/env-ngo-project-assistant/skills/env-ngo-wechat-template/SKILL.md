---
name: env-ngo-wechat-template
description: >-
  Load when the user provides research materials (from env-ngo-wechat-research) and
  needs to create a structured WeChat article outline that matches the organization's
  historical style. This is the second skill in the WeChat publishing pipeline.
  Do not load for report writing, case extraction, or FAQ generation.
---

# 公众号模板复刻技能（传播运营模块 · M3 · Pipeline Step 2）

读取上游素材卡片 + 机构历史推文，提取语气基准和结构模板，输出一份符合机构风格的结构化文章提纲。

## When To Use

- 上游素材卡片已就绪（来自 `env-ngo-wechat-research` 或人工整理）。
- 用户需要把素材按「机构风格」组织成文章结构。
- 触发关键词：写提纲、排结构、按我们机构的风格来、参考之前那篇。

不要用于：直接写全文（用 `env-ngo-wechat-humanize`）、搜集素材（用 `env-ngo-wechat-research`）、结项报告。

## Workflow

1. **读取素材卡片**：接收上游输出的结构化素材。
2. **读取机构历史推文**：从知识库中检索 3-5 篇机构已发布的公众号文章。
3. **提取语气基准**：从历史推文中识别——
   - 开头怎么写（提问式？故事式？数据式？）
   - 段落节奏（短段落 vs 长段落、插图的频率）
   - 结尾模式（呼吁行动？预告下次？数据总结？）
4. **匹配模板**：选择最合适的历史推文作为结构模板。
5. **输出结构化提纲**：标注每部分用的素材和语气要点。

## Required Inputs

- 素材卡片（来自 `env-ngo-wechat-research` 的输出，或人工整理的素材集）。
- 机构历史推文（至少 3 篇，从知识库获取）。
- 可选：用户指定的模板偏好（如「用上次湿地保护那篇的风格」）。

## Output Contract

输出 Markdown，结构如下：

1. **选题一句话**（≤20 字，最终文章的标题方向）
2. **选定的参考模板**（引用哪篇历史推文，简述其结构特点）
3. **语气基准摘要**（开头方式 / 段落节奏 / 结尾模式，各一句话）
4. **文章提纲**（4-6 个小标题 + 每段标注用到的素材和语气提示）
5. **需要人工确认的点**（如数据是否过时、引述是否已获授权）

语言：提纲用短语，不用完整句子。

## Gotchas

- 不要抄历史推文的原句——提取风格和结构，不是复制内容。
- 机构没有的历史推文风格（如「幽默吐槽风」）不要强行匹配。
- 如果素材卡片里标注了「素材缺口」，提纲中对应位置标注 [需人工补充]。
- 语气基准以近 6 个月的推文为准，更早的推文可能风格已变化。
- 不要替用户决定「这篇应该是什么风格」——给出基准，让用户选。

## Files To Read

- 无（模板和语气基准从机构知识库的历史推文中提取，不需要固定模板文件）。