---
name: env-ngo-okr-checklist
description: >-
  Load when the user pastes a project proposal or charter and needs a structured
  OKR / milestone checklist table (objectives, key results, owner role, due date,
  status) for an environmental nonprofit. Do not load for financial
  reconciliation, weekly field reports, or narrative case studies.
---

# 项目书 → OKR 清单技能（项目文书链 · 结构化清单）

把项目书里的目标与节点，抽成一张**可进飞书/表格的 OKR 清单**。不做财务核算，不算「仪表盘产品」，只输出固定列表。

## When To Use

- 用户粘贴项目书/立项书，要求生成 **OKR / 目标-关键结果 / 里程碑清单**。
- 触发关键词：生成 OKR、项目书转 OKR、目标清单、里程碑表、进度清单初稿。

不要用于：结项报告（用 `env-ngo-closure-report`）；台账周报（用 `env-ngo-field-ledger`）；散乱事务待办（用 `env-ngo-todo-board`）；财务对账。

## Workflow

1. 通读项目书，只提取**文中明确出现的目标（O）与可量化关键结果（KR）/里程碑**。
2. 截止时间优先取文中节点；无则标 `[请补充]`，不猜测。
3. 负责人：文中有姓名则提取后提示「请确认是否脱敏为角色」；无则留空。
4. 状态列预设：待启动 / 进行中 / 延期 / 完成。
5. 对照 `assets/okr_table_template.md` 输出；模糊指标不硬造数字。

## Required Inputs

- 项目书或立项书全文（或关键章节）。
- 可选：历史 OKR 表样本（对齐列名）。

## Output Contract

输出 Markdown 表格，列固定为：

| 目标(O) | 关键结果(KR)/里程碑 | 来源段落 | 负责人（角色/代号） | 截止 | 状态 | 备注 |

另附：

1. **覆盖说明**（哪些目标已入表）
2. **未纳入项**（文中有但不可量化/信息不足）
3. **请补充清单**

## Gotchas

- **不生成项目书里没有的指标**。
- **财务只列科目或预算条目，不核算、不预测结余**。
- 人名建议改为角色代号后再对外分享。
- 多目标交叉时拆行，不合并成含糊一行。
- 与待办清单分工：OKR 来自项目书结构；日常琐事走 `env-ngo-todo-board`。

## Files To Read

- `assets/okr_table_template.md`：表格与附注模板（必读）。
- `assets/example_input_proposal_excerpt.md`：项目书摘录样例（脱敏）。
