---
name: env-ngo-todo-board
description: >-
  Load when the user dumps messy tasks, chat notes, or near-term commitments and
  needs a sorted Markdown todo table (item, source, due, owner, status, next
  action) for an environmental nonprofit. Do not load for project-book OKR
  extraction, knowledge-base Q&A, or writing long reports.
---

# 待办清单表技能（案例沉淀模块 · M2 · 事务结构化）

把口语化、散乱的「近期要做的事」整理成固定六列表。这是课程里说的「待办仪表盘」——**不是 BI 大屏**，是一张可维护的清单。

## When To Use

- 用户说「整理待办」「本周事项」「近期待办清单」，并给出散乱事项或消息摘录。
- 触发关键词：整理待办、待办清单、近期待办、本周事项、工作待办表。

不要用于：从项目书生成 OKR（用 `env-ngo-okr-checklist`）；写项目书/结项（文书技能）；知识库检索问答（第 2 课知识库能力 / FAQ 技能）。

## Workflow

1. 从输入中切分事项。
2. 补齐六元组：事项名称、来源、截止、负责人代号、状态、下一步动作。
3. 截止无法确认 → 写「未知」并在备注标 `[需补充]`，**禁止猜日期**。
4. 按截止从近到远排序；无截止的放在表末。
5. 「下一步」必须具体（起草×× / 联系×× / 核对××），禁止「推进」「跟进一下」。

## Required Inputs

- 散乱事项描述（口语、名单、会议笔记均可）。
- 可选：已有任务表、微信消息文字版。

## Output Contract

输出 Markdown，结构与 `assets/todo_table_template.md` 一致：

| 事项 | 来源 | 截止 | 负责人 | 状态 | 下一步 |

并附：

1. **需补充项**（缺截止/负责人/下一步）
2. **已排除项**（不是待办：如纯信息周知）

## Gotchas

- 截止时间必须有依据；否则「未知」+ `[需补充]`。
- 负责人对外输出用角色代号。
- 不要把 OKR 年度目标拆进日常待办，除非用户明确要求。
- 状态默认：未开始 / 进行中 / 阻塞 / 完成。
- 本技能不发送提醒；提醒由 Agent 平台定时能力配置。

## Files To Read

- `assets/todo_table_template.md`：六列表模板（必读）。
- `assets/example_input_messy_tasks.md`：散乱事项样例。
