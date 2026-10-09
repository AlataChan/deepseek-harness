---
name: env-ngo-field-ledger
description: >-
  Load when the user provides daily field logs (CSV spreadsheets), photo captions,
  or a consolidated ledger folder for a reporting period and needs a structured
  weekly or monthly project report draft for an environmental nonprofit. Do not
  load for closure reports from narrative-only notes, grant proposals, or social
  media copy without ledger data.
---

# 现场数据台账技能（案例沉淀模块 · M2）

把**已归集到统一文件夹**的日报 CSV、照片说明，汇总成结构固定的周报/月报草稿。配合「先收拢、再处理」：人工（或助手辅助）把分散台账放进 `01_原始台账/`，本 Skill 负责**对数、填模板、标缺失**。

## When To Use

- 用户已将多站点、多日的 CSV / 照片说明集中到**一个项目台账文件夹**（见 `assets/folder_structure.md`）。
- 用户要的是**周报 / 月报 / 阶段执行报告**（数据驱动、固定模板），不是结项长报告或公众号推文。
- 触发关键词：台账、周报、月报、站点数据汇总、原始台账核对、周期报告。

不要用于：只有叙事性流水账、无表格数据（用 `env-ngo-closure-report`）；写活动复盘帖（用 `env-ngo-activity-recap`）；从项目书生成 OKR 清单（用 `env-ngo-okr-checklist`）。

## Workflow

### Phase A · 资料归集（Skill 之前）

1. 按 `assets/folder_structure.md` 创建 `<项目名称>_台账/` 目录树。
2. 将各站点、各日期的 CSV 与照片说明复制到 `01_原始台账/<站点>/`，统一文件名。
3. 在 DeepSeek Harness 中把该文件夹设为工作区，确认路径可读。

### Phase B · 台账汇总（本 Skill）

1. 读取用户指定的**报告周期**（如 2026-06-01 至 2026-06-07）和台账文件夹路径。
2. 扫描 `01_原始台账/` 下该周期内所有 CSV，按站点、活动类型、指标名**求和或计数**（仅基于文件中的行，不估算）。
3. 读取同周期 `照片说明.txt`，匹配到对应站点/日期的活动条目。
4. 对照 `assets/weekly_report_template.md` 输出草稿；缺日报的站点/日期写入「数据核对说明」和「缺失项清单」。
5. 将草稿建议保存到 `02_周期汇总/`（由用户或助手写入工作区）。

## Required Inputs

- 报告周期（起止日期）。
- 台账文件夹路径（或用户粘贴该周期内的 CSV 内容与照片说明）。
- 可选：站点列表、机构周报/月报历史范例（对齐语气与章节）。

## Output Contract

输出 Markdown，结构必须与 `assets/weekly_report_template.md` 一致，包含：

1. **本周/本期工作概述**
2. **分站点数据汇总表**（每表含：活动类型、指标、合计、数据来源路径）
3. **主要活动与现场记录**（引用照片说明，已脱敏）
4. **数据核对说明**（齐全性、合计一致性、照片对应情况）
5. **下周计划 / 待跟进**
6. **缺失项清单**

语言：中文；篇幅 600–1200 字（周报）；月报可至 1500 字。

## Gotchas

- **不跨文件夹找文件**：若用户未归集，先提示完成 Phase A，不要猜测其他路径上的数据。
- **数字只来自 CSV 行**：禁止估算、插值、编造；无法求和时写「待核对」。
- **站点/日期缺失必须显式列出**：如「站点乙 2026-06-01 无日报」。
- **照片说明中的人名**脱敏为代号；提醒 `[发布前请确认肖像授权]`。
- **不同指标单位不可相加**（如「袋」与「公斤」分开展示）。
- **与结项报告分工**：本 Skill 输出周期简报；完整结项走 `env-ngo-closure-report`，可引用本 Skill 已核对的数据表。

## Files To Read

- `assets/folder_structure.md`：工作区文件夹结构与归集步骤（必读）。
- `assets/weekly_report_template.md`：输出结构模板（必读）。
- `assets/example_input_daily_logs.md`：脱敏测试样例。
