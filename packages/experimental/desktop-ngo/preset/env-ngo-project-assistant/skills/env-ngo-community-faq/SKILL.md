---
name: env-ngo-community-faq
description: >-
  Load when the user provides community chat logs, recurring questions
  from volunteers or beneficiaries, or wants to build a FAQ document for
  an environmental nonprofit's community channels. Do not load for
  closure reports, case extraction, or activity recaps.
---

# 社群 FAQ 技能（传播运营模块 · M3）

从社群聊天记录、志愿者/受益人反复提出的问题中，整理出一份结构化 FAQ 文档，供社群管理员快速回复或作为公众号「常见问题」板块。这是第 4 课「多智能体协作」中可作为社群答疑员调用的样板技能，常接在知识库检索之后。

## When To Use

- 用户提供了社群聊天截图/文字记录、志愿者常问问题列表、或受益人咨询记录。
- 用户想要的是一份**结构化的 FAQ / 常见问题解答**，用于社群置顶、公众号菜单或内部客服手册。
- 触发关键词：FAQ、常见问题、社群问答、自动回复、快捷回复、问题整理。

不要用于：写活动复盘帖（用 `env-ngo-activity-recap`）、写结项报告（用 `env-ngo-closure-report`）、萃取案例（用 `env-ngo-case-extract`）。

## Workflow

1. 读取用户提供的聊天记录/问题列表，识别高频问题并归类。
2. 对照 `assets/faq_template.md` 的结构，按类目组织问答。
3. 答案**必须**基于机构知识库或用户提供的官方信息，不编造政策、时间、联系方式。
4. 个人信息在输出前脱敏。
5. 对于无法确定答案的问题，标注「需机构确认」。

## Required Inputs

- 问题来源：社群聊天记录、志愿者常问问题列表、受益人咨询记录（至少一种）。
- 可选：机构官方信息（活动日程、报名方式、联系渠道）用于核实答案准确性。

## Output Contract

输出 Markdown，结构如下：

1. **文档标题**（如「XX 项目社群常见问题」）
2. **快速索引**（问题编号 + 一句话概括，方便跳转）
3. **分类问答**（按类目分组，每个 Q&A 格式统一）：
   - 类目标题（如「活动报名」「志愿者管理」「环保知识」）
   - Q：<问题>
   - A：<回答>（≤150 字，口语化但准确）
4. **待确认问题**（有人问过但机构尚未给出官方答案的问题）

每条回答 50–150 字，口语化、直接。总条目建议 8–20 条。

## Gotchas

- 答案必须基于用户提供的信息或知识库内容，**不编造活动时间、报名链接、联系方式**。
- 无法确认的答案统一标注 `[需机构确认]`，不要猜测。
- 聊天记录中的个人信息（群昵称、手机号、微信号）必须脱敏。
- 合并近似问题（如「怎么报名」和「在哪报名」），避免重复。
- 涉及政策法规的回答，标注信息时效（如「截至 2026 年 X 月」）。
- 避免官方套话，用社群成员能听懂的语言回答。

## Files To Read

- `assets/faq_template.md`：FAQ 输出结构模板（必读）。
