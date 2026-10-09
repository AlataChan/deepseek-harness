---
name: env-ngo-archive-classify
description: >-
  Load when the user provides a messy project folder or file list and needs a
  five-category archive plan (方案/反馈/影像/总结/传播) with rename suggestions and
  an index document for an environmental nonprofit. Do not load for writing
  reports, WeChat posts, or weekly ledger summaries.
---

# 项目资料五分类归档技能（案例沉淀模块 · M2）

把「一个项目散落一堆文件」变成**五分类目录 + 重命名建议 + 可检索索引**。先治乱，再谈生成年终总结或传播稿。

## When To Use

- 用户给了项目文件夹路径、文件名列表，或粘贴了「文件名 + 一句话内容说明」。
- 目标是**分类归档与索引**，不是直接写报告或推文。
- 触发关键词：整理项目、五分类、项目库归档、资料分类、生成索引目录。

不要用于：写结项/年终总结正文（用 `env-ngo-closure-report`）；写复盘推文（用 `env-ngo-activity-recap`）；台账周报（用 `env-ngo-field-ledger`）。

## Workflow

1. 读取文件名与用户提供的内容摘要；无法判断内容时列入「待分类」并写原因。
2. 按五类规则归类（见 Output Contract）。
3. 给出重命名建议：`[项目名]_[分类]_[日期]_[原标题核心信息]`。
4. 输出目录树建议 + 索引表（分类、建议路径、一句话摘要）。
5. **不实际删除或覆盖文件**；只输出可执行的整理方案，由用户或助手在工作区执行移动。

## Required Inputs

- 项目名称。
- 文件清单（文件名；最好附一句话内容说明或前几行摘要）。
- 可选：机构既有分类习惯、日期默认规则。

## Output Contract

输出 Markdown，结构必须与 `assets/archive_index_template.md` 一致：

1. **归档说明**（项目名、文件总数、待分类数）
2. **建议目录树**（五类 + 待分类）
3. **逐文件归类表**（原名 → 分类 → 建议新名 → 摘要）
4. **待分类与冲突说明**
5. **下一步**（可交给年终总结 / 知识库入库）

五类定义：

| 分类 | 典型内容 |
|------|----------|
| 方案类 | 计划书、活动方案、预算表、申报材料 |
| 反馈类 | 问卷、资方/参与者反馈、评估报告 |
| 影像类 | 照片、视频、截图、海报 |
| 总结类 | 活动总结、结项报告、复盘记录 |
| 传播类 | 公众号链接、新闻稿、朋友圈文案 |

## Gotchas

- **优先内容、其次文件名**判断分类；一文多类时选最核心类，并在备注说明。
- 无法判断的必须进「待分类」，禁止猜进某一类。
- 不改写文件正文；不发明文件中不存在的日期。
- 影像类若含可识别人脸，索引摘要中提醒 `[肖像授权待确认]`。
- 本技能不生成年终总结正文，只为后续技能准备干净输入。

## Files To Read

- `assets/archive_index_template.md`：索引输出模板（必读）。
- `assets/example_input_filelist.md`：脱敏文件列表样例。
