---
name: env-ngo-closure-report
description: >-
  Load when the user provides project execution "流水账", activity logs, or raw
  field notes and needs a structured closure report (背景/活动/产出/成效/反思/缺失项)
  for an environmental nonprofit. Do not load for grant proposal first drafts,
  funding application letters, or WeChat / social-media copy only.
---

# 结项报告技能（项目文书链 · 报告）

把「项目执行流水账」转成一份结构稳定、可直接交给资助方的结项报告。这是第 1 课课堂演示用的样板技能，学员可直接 Fork 后改成自己机构的版本。

## When To Use

- 用户提供了项目执行记录、活动清单、签到/产出数据、现场说明等「流水账」。
- 用户要的是**正式结项报告 / 项目总结报告**，而不是项目申请书或公众号推文。
- 触发关键词：结项、结项报告、项目总结、执行流水账、向资助方汇报。

不要用于：写项目立项书初稿（用 `env-ngo-proposal-draft`）、写资助申请信（用 `env-ngo-grant-letter`）、只写传播稿。

## Workflow

1. 读取用户提供的流水账 / 活动记录，抽取「活动 → 产出 → 成效」三类信息。
2. 对照 `assets/closure_report_template.md` 的章节结构逐项填充。
3. 只使用用户输入或机构知识库中**确有出处**的数字与事实。
4. 任何报告必需但用户未提供的信息，统一汇总进末尾「缺失项清单」，不要编造。
5. 输出完成后，可运行 `scripts/check_sections.mjs` 校验六个章节是否齐全。

## Required Inputs

- 项目名称、执行周期、资助方（若有）。
- 活动流水：时间、地点、内容、参与规模、产出物。
- 可选：成效数据、受益反馈、机构既有结项报告范例（用于对齐风格）。

## Output Contract

输出 Markdown，必须且仅包含以下六个章节，顺序固定：

1. **项目背景**（≤200 字）
2. **主要活动**（按时间或主题列表）
3. **产出与数据**（只使用用户输入或知识库中的数字）
4. **成效与反馈**
5. **反思与后续建议**
6. **缺失项清单**：报告必需、但用户未提供的信息

语言与用户输入一致（默认中文）；篇幅 800–1500 字。

## Gotchas

- 用户未提供的数字（参与人数、预算、成效指标）**一律不估算、不编造**，列入「缺失项清单」。
- 涉及受益人、志愿者、捐赠人的个人信息，输出前必须脱敏（姓名→A/B，删除手机/证件号）。
- 执行方声称但无材料支撑的成效，标注为「项目方表述」而非「已核实」。
- 流水账里的金额与产出若相互矛盾，标注冲突并请用户确认，不要静默选一个数。
- 不要把本技能模板里的示例数据当成真实项目数据写进报告。
- 避免「圆满成功」「取得重大突破」一类无信息量的套话。

## Files To Read

- `assets/closure_report_template.md`：输出章节模板（必读）。
- `assets/format_伙伴计划结项结构.md`：正式七大块与技能六章节的映射（格式参照，脱敏）。
- `assets/example_input_流水账.md`：虚构脱敏流水账，格式参照机构成长支持类结项模板，演示「流水账 → 报告」。

## Scripts To Run

- `scripts/check_sections.mjs`：校验生成的报告是否含齐六个章节。

```bash
node scripts/check_sections.mjs path/to/generated_report.md
```
