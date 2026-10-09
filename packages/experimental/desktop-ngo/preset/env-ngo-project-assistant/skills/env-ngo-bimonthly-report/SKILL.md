---
name: env-ngo-bimonthly-report
description: >-
  Load when the user provides period materials and one or more past sample
  bimonthly reports and needs a style-aligned bimonthly report draft for an
  environmental nonprofit. Do not load for weekly field-ledger summaries,
  full closure reports, or short WeChat recaps.
---

# 双月报初稿技能（项目文书链 · 报告变体）

把「历史优秀双月报样本 + 本期素材」合成一份**结构对齐、语气对齐、数据有出处**的双月报初稿，并标明信息充足/不足章节。

## When To Use

- 用户要生成**双月报 / 双月简报 / 资助方固定周期汇报**初稿。
- 手头有 ≥1 份历史样本（用于学结构与语气）+ 本期活动/传播/执行素材。
- 触发关键词：生成双月报、双月简报、学习风格后写双月报、双月汇报初稿。

不要用于：多站点 Excel 台账周报（用 `env-ngo-field-ledger`）；正式结项长报告（用 `env-ngo-closure-report`）；活动复盘推文（用 `env-ngo-activity-recap`）。

## Workflow

1. 读取历史样本，提取：章节结构、标题层级、表格习惯、语言风格（平实/数据驱动/故事化）。
2. 读取本期素材，按样本章节归类。
3. 对照 `assets/bimonthly_template.md`（可被样本结构覆盖）生成初稿。
4. 每条数据标注出处；样本有、本期无的章节写 `[待补充]`，不硬编。
5. 文末给出「信息充足章节 / 需人工补材料章节」清单。

## Required Inputs

- 报告周期（如 2026 年 5–6 月）。
- 历史优秀样本（≥1 份，推荐 ≥2）。
- 本期素材：活动记录、传播数据、执行文件摘要等。
- 可选：资助方格式硬性要求。

## Output Contract

输出 Markdown，优先对齐用户样本结构；若无样本则使用 `assets/bimonthly_template.md`：

1. **本期概览**
2. **重点工作进展**
3. **数据与亮点**（表格，带来源）
4. **问题与风险**
5. **下期计划**
6. **素材覆盖度与待补充**

语言：中文；措辞尽量贴近样本，避免空泛套话。

## Gotchas

- **先学样本、再生成**；禁止忽略样本自创完全不同结构（除非用户要求改版）。
- 数字只来自本期素材或知识库；缺数标 `[待补充]`。
- 不把历史样本中的旧数据当作本期成果。
- 涉及人员信息脱敏；传播数据若无原始后台截图支撑，标「项目方提供」。
- 与结项报告分工：双月报服务固定短周期，结项服务完整项目周期。

## Files To Read

- `assets/bimonthly_template.md`：无样本时的默认结构（必读）。
- `assets/example_input_period_notes.md`：本期素材脱敏样例。
