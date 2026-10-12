---
name: env-ngo-grant-letter
description: >-
  Load when the user needs a short funding-request letter or grant project
  summary (申请信 / 项目摘要 / 意向书) for an environmental nonprofit reaching out to a
  funder. Do not load for full project proposals (立项书) or closure reports of
  finished projects.
---

# 资助信技能（项目文书链 · 资助）

把项目核心信息浓缩成一封简短、有说服力的资助申请信 / 项目摘要 / 意向书。适合初次接洽资助方、或资助方先要一页纸摘要的场景。

## When To Use

- 用户要写**资助申请信、项目意向书、一页纸项目摘要**，对象是资助方 / 捐赠方。
- 需要的是简短、能打动人的版本，而不是完整立项书。
- 触发关键词：资助申请、申请信、意向书、项目摘要、求助信、给基金会的信。

不要用于：完整项目立项书（用 `env-ngo-proposal-draft`）、结项报告（用 `env-ngo-closure-report`）。

## Workflow

1. 抽取项目最核心的「问题 → 方案 → 影响 → 需求金额」四要素。
2. 按 `assets/grant_letter_template.md` 组织成一封一页纸内的信。
3. 语气真诚、具体、可信，避免悲情绑架与空泛口号。
4. 金额、配套、时间等关键数字若缺失，列入信末「待补信息」。

## Required Inputs

- 项目一句话定位、要解决的问题。
- 期望的资助金额或资源（若有）。
- 机构与资助方是否有过接触、对方关注的议题（若知道）。

## Output Contract

输出 Markdown，结构如下：

1. **称呼与开场**（建立相关性，1 段）
2. **问题与机会**（为什么现在值得投，1–2 段）
3. **我们的方案与影响**（做什么、谁受益、可衡量影响，1–2 段）
4. **具体请求**（金额 / 资源 / 下一步，1 段）
5. **结尾与联系方式**
6. **待补信息**（缺失的关键数字 / 材料）

全文控制在一页纸（约 400–700 字）。

## Gotchas

- 不要编造影响数字或受益规模；没有就写定性描述并列入「待补信息」。
- 不使用「最后的希望」「再不帮就……」等悲情绑架式表达。
- 资助金额未定时，不要随意写一个数字，留待用户确认。
- 涉及受益人 / 捐赠人个人信息一律脱敏。
- 与完整立项书区分：这封信是「勾起兴趣」，不是塞满所有细节。

## Files To Read

- `assets/grant_letter_template.md`：资助信结构模板（必读）。
