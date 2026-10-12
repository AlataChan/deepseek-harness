---
name: env-ngo-industry-brief
description: >-
  Load when the user needs a short industry monitoring brief for an environmental
  nonprofit — e.g. weekly/monthly digests of policy, meetings, peer projects, or
  research under given keywords and a date range. Do not load for full policy
  research papers, project proposals, closure reports, or social-media copy.
---

# 行业监测简报技能（案例沉淀模块 · M2）

把「按关键词扫一圈近期动态」固化成**可分享的短简报**：分类清晰、条目可溯源、篇幅可控。适合多区域/多办公室共用同一份监测输出。

## When To Use

- 用户给出**日期范围 + 关键词清单**，要一份行业动态简报（周报/月报量级）。
- 用户要的是**监测摘要**，不是深度政策综述、项目书或结项报告。
- 触发关键词：行业简报、行业动态、本周监测、监测简报、政策动态速览、对标项目扫描。

不要用于：长篇政策研究综述（用 `env-ngo-policy-research`）；写项目立项书（用 `env-ngo-proposal-draft`）；资讯标题列表摘要但不做分类简报（用 `env-ngo-news-digest`）。

## Workflow

1. 确认日期范围、领域关键词、关注类别（默认四类：政策发布 / 行业会议 / 重要项目 / 学术进展）。
2. 仅基于用户提供的链接、粘贴文本或已授权检索结果归纳；**无法核实的不写进正文**。
3. 对照 `assets/brief_template.md` 填充分类条目。
4. 每条写清：标题、约 80 字摘要、来源（文件名或 URL）、日期（若有）。
5. 全篇控制在约 800 字；超出则合并次要条目或移入「可选阅读」。

## Required Inputs

- 日期范围（起止）。
- 关键词清单（≥2 个）。
- 信息来源：用户粘贴的新闻/政策摘录、链接列表，或检索结果文本。
- 可选：机构关注的子领域标签、历史简报样本（对齐语气）。

## Output Contract

输出 Markdown，结构必须与 `assets/brief_template.md` 一致：

1. **简报抬头**（周期、关键词、撰写说明）
2. **政策发布**
3. **行业会议 / 活动**
4. **重要项目 / 对标实践**
5. **学术 / 研究报告进展**（可无则写「本期无」）
6. **缺失项 / 待核实清单**

语言：中文；每条摘要约 80 字；全篇建议 ≤800 字。

## Gotchas

- **政策文件名称原文引用**，不自行改写简称易混版本号。
- 无来源的条目**不得写入正文**，列入「待核实」。
- 不以简报名义做因果归因或「行业必将如何」式判断。
- 涉及机构/人名时脱敏为泛称（如「某省级项目」「某协会」）。
- 不要把模板示例数据当成真实监测结果。
- 多区域共用时：只输出事实摘要，区域差异化建议留给人工。

## Files To Read

- `assets/brief_template.md`：简报输出结构（必读）。
- `assets/example_input_clips.md`：脱敏资讯摘录取样。
