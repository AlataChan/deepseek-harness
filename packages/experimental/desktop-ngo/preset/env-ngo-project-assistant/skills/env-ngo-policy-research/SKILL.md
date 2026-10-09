---
name: env-ngo-policy-research
description: >-
  Load when the user needs a structured policy or industry research synthesis for
  an environmental nonprofit — e.g. consolidate strategy papers, regulations, and
  project literature into a review with background/methods/findings/recommendations.
  Do not load for short weekly monitoring briefs, grant proposals, or WeChat copy.
---

# 政策 / 行业研究综述技能（案例沉淀模块 · M2）

把散落的战略文件、政策原文、项目文献，整理成一份**结构稳定、可交外部顾问审阅**的研究综述初稿。相对「行业简报」更长、更深，强调方法与出处。

## When To Use

- 用户要替代或辅助「行业研究岗」产出：**政策梳理**或**行业研究报告初稿**。
- 手上有一批 PDF/纪要/文献摘录，需要按固定章节合成。
- 触发关键词：政策综述、政策梳理、行业研究报告、文献综述、秘书长研报、研究综述初稿。

不要用于：800 字内监测简报（用 `env-ngo-industry-brief`）；项目立项书（用 `env-ngo-proposal-draft`）；结项报告（用 `env-ngo-closure-report`）。

## Workflow

1. 读取用户提供的资料清单与报告目标（议题、读者、字数上限）。
2. 对照 `assets/research_outline.md` 规划章节；缺资料的章节先标 `[待补充]`。
3. 抽取「法规/政策要点 → 现状证据 → 争议与空白 → 可操作建议」。
4. 每个核心发现至少对应**一条可点名的资料出处**；不确定处标 `[待核实]`。
5. 输出初稿 + 资料使用清单；不替用户做未授权的联网猜测。

## Required Inputs

- 研究议题与目标读者（内部决策 / 外部顾问 / 资助方）。
- 资料包：政策原文摘录、战略文件、项目文献、会议纪要等（至少 3 份或等量粘贴文本）。
- 可选：字数目标、历史优秀综述样本（对齐语气与章节习惯）。

## Output Contract

输出 Markdown，结构必须与 `assets/research_outline.md` 一致：

1. **研究背景与问题**
2. **资料范围与方法说明**
3. **政策与制度梳理**
4. **关键发现**（分条，带出处）
5. **讨论与空白**
6. **建议**（可执行、可验证）
7. **资料清单与待核实项**

语言：中文；默认 3000–6000 字量级（用户另有约定从其约定）。

## Gotchas

- **不编造法条编号、不捏造引用页码**；未见全文只写「据标题/摘要」。
- 政策解读仅限用户提供文本覆盖范围；超出范围写「未纳入本次资料包」。
- 人名、机构名对外稿需脱敏时用泛称。
- 建议必须可操作，禁止空泛「加强统筹」。
- 与监测简报分工：本技能产出研究稿，不产出每周四类速览表。

## Files To Read

- `assets/research_outline.md`：综述结构模板（必读）。
- `assets/example_input_packet.md`：脱敏资料包示意。
