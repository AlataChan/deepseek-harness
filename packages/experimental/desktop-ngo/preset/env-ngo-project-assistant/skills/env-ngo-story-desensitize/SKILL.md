---
name: env-ngo-story-desensitize
description: >-
  Load when the user provides a raw service story, beneficiary narrative,
  or interview transcript that contains personal information and needs a
  desensitized version safe for public use (reports, social media, case
  databases). Do not load for closure reports, case extraction, or FAQ
  generation.
---

# 服务故事脱敏技能（案例库模块 · M2）

把含真实个人信息的服务故事/受益人叙事转成可公开发布的脱敏版本，同时保留故事感染力。这是第 4 课「多智能体协作」中可作为脱敏审核员调用的样板技能，常接在案例萃取之后。

## When To Use

- 用户提供了一段含受益人/志愿者/捐赠人真实信息的服务故事、访谈记录或案例文本。
- 用户需要一个**脱敏后可公开使用**的版本（用于报告、公众号、案例库、对外汇报等）。
- 触发关键词：脱敏、去隐私、匿名化、公开版、发布前处理、故事改写。
- 输入是**录音**时：先按 `env-ngo-audio-minutes` 转写成文字稿，再执行脱敏。

不要用于：写结项报告（用 `env-ngo-closure-report`）、从散记中萃取案例结构（用 `env-ngo-case-extract`）、写 FAQ（用 `env-ngo-community-faq`）。

## Workflow

1. 读取用户提供的原始故事/叙事文本。
2. **扫描并标记**所有个人可识别信息（PII）：真实姓名、手机号、身份证号、详细地址、照片描述中的面部、金额精确数、机构全称。
3. 对照 `assets/desensitize_rules.md` 执行逐项替换。
4. 输出脱敏版本 + 脱敏变更清单（让用户知道改了什么）。
5. 保持故事的情感脉络和叙事节奏，不要因脱敏让故事变成干巴巴的报表。

## Required Inputs

- 原始服务故事或访谈文字稿（含真实信息）。
- 可选：用户指定的公开用途（公众号/报告/案例库），以便调整脱敏粒度。

## Output Contract

输出两部分：

### 第一部分：脱敏后故事

保持原文结构和叙事风格，所有 PII 按规则替换。篇幅与原文大致相当。

### 第二部分：脱敏变更清单

| 原始内容 | 替换为 | 脱敏规则 |
|----------|--------|----------|
| <真实姓名> | <代号 A/B/C> | 姓名→代号 |
| <手机号> | [已删除] | 联系方式→删除 |
| <精确金额> | <量级范围> | 金额→量级 |

## Gotchas

- 姓名→字母代号（A/B/C），同一人全文用同一代号。
- 手机号、身份证号、银行卡号→**直接删除**，不做部分遮盖。
- 精确金额→量级范围（如「43,872 元」→「约 4 万元」）。
- 详细地址→模糊到区县级（如「XX 市 XX 区某社区」）。
- 机构全称→`<机构简称>` 或约定代号，除非用户明确同意公开。
- **不要改变事实**：脱敏是隐藏身份，不是修改故事情节。
- 若无法判断某信息是否需脱敏，标注提醒用户确认，不要自行决定保留。

## Files To Read

- `assets/desensitize_rules.md`：脱敏规则对照表（必读）。
