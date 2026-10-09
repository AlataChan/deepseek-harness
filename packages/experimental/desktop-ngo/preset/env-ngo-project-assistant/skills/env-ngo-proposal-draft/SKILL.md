---
name: env-ngo-proposal-draft
description: >-
  Load when the user wants a project proposal / 立项书 first draft for an
  environmental nonprofit, based on an organization profile, past work, and a
  funder's guidelines or scoring rubric. Do not load for closure reports of
  finished projects or short funding-request letters.
---

# 项目书技能（项目文书链 · 提案）

把「机构简介 + 过往案例 + 资助方指南」组装成一份项目立项书初稿。项目提案是机构最高频、最耗时的文书之一，本技能提供一个可 Fork 的起步模板。

## When To Use

- 用户要写**项目立项书 / 项目申请书初稿**，准备投给某个资助方或上级。
- 用户能提供机构简介、相关过往案例、目标议题，最好还有资助方的申报指南。
- 触发关键词：项目书、立项书、项目申请书、项目方案、申报。

不要用于：已结束项目的结项报告（用 `env-ngo-closure-report`）、简短资助申请信（用 `env-ngo-grant-letter`）。

## Workflow

1. 读取资助方指南 / 评分标准（若有），抽取必填栏目与评审偏好。
2. 用机构简介与过往案例，匹配本项目的合法性与执行力证据。
3. 按 `assets/proposal_template.md` 章节生成初稿。
4. 资助方要求但材料缺失的栏目（预算、时间表、指标），列入「缺失项清单」。

## Required Inputs

- 机构简介、过往相关项目（1–3 个）。
- 拟做项目的议题、目标人群、初步思路。
- 可选但强烈推荐：资助方申报指南 / 评分标准。

## Output Contract

输出 Markdown，按以下章节，顺序固定：

1. **项目摘要**（≤150 字）
2. **背景与需求**（问题 + 证据）
3. **目标与成果指标**（可衡量）
4. **实施方案**（活动 + 时间表）
5. **预算概要**（仅在有数据时填，否则列缺失项）
6. **机构能力与过往案例**
7. **缺失项清单**

语言与用户输入一致；初稿篇幅 1000–1800 字。

## Gotchas

- 没有资助方指南时，**不要伪造**评审标准或必填栏目；提示用户上传或先用通用结构。
- 成果指标必须可衡量，不要写「提升公众意识」这类无法验收的空话。
- 预算、配套资金等数字若用户未给，列入「缺失项清单」，不要替机构编预算。
- 过往案例只引用真实发生、可佐证的项目，不夸大成效与规模。
- 涉及合作方、受益人的敏感信息先脱敏再写入。

## Files To Read

- `assets/proposal_template.md`：项目书章节模板（必读）。
