---
name: env-ngo-news-digest
description: >-
  Load when the user provides a short list of recent environment / solid-waste /
  eco-policy links or titles and needs per-item digests with cautious action
  hints for an environmental nonprofit. Do not load for full policy research
  papers, industry four-category briefs, or creative popular-science essays.
---

# 环保资讯摘要技能（传播运营 / 知识监测 · M3）

对用户**已经筛选好的** 3–10 条链接或标题，生成逐条短摘要 + 一句可操作关注建议。不代替读全文，不做过度政策解读。

## When To Use

- 用户输入「摘要资讯」并附上链接/标题列表。
- 触发关键词：摘要资讯、资讯摘要、固废资讯、每周热点摘要。

不要用于：深度政策综述（用 `env-ngo-policy-research`）；四类行业监测简报（用 `env-ngo-industry-brief`）；创作科普长文（走内容生产线或写作技能）。

## Workflow

1. 逐条读取用户给出的标题/摘要/可访问摘录。
2. 每条输出 2–3 句核心信息；**仅基于已提供文本**，不猜测全文未出现的条款。
3. 加 1 句「行动建议」（机构可如何响应或继续关注），须具体。
4. 无法确认全文时标记「（待阅读原文确认）」。
5. 文末统一提醒：发布前请阅读原文确认。

## Required Inputs

- 3–10 条链接或标题（可附短摘要）。
- 可选：关注标签（如生活垃圾 / 电子废弃物 / 农业固废）。

## Output Contract

输出 Markdown，结构与 `assets/digest_template.md` 一致：

对每条：

- 编号 + 标题
- 核心摘要（2–3 句）
- 行动建议（1 句）
- 来源 + 是否待阅读原文

文末：总提示「以上摘要基于标题/摘要，发布前请阅读原文确认」。

## Gotchas

- **不编造政策内容**；标题党表述要降调为「据标题称」。
- 行动建议禁止空洞「值得关注」。
- 与行业简报分工：本技能是「用户已选条目的摘录」；简报是「按四类结构化监测」。
- 不生成完整科普推文正文。

## Files To Read

- `assets/digest_template.md`：摘要输出模板（必读）。
- `assets/example_input_title_list.md`：标题列表样例。
