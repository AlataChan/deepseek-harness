---
name: env-ngo-wechat-research
description: >-
  Load when the user wants to research or gather materials for a WeChat article,
  including topic background, data, related news, and similar articles. This is the
  first skill in the WeChat publishing pipeline. Do not load for report writing,
  case extraction, or FAQ generation.
---

# 公众号资料搜集技能（传播运营模块 · M3 · Pipeline Step 1）

根据用户指定的选题，从 web 搜索和知识库中搜集相关素材，输出一份结构化的素材卡片，供下游模板复刻技能使用。

## When To Use

- 用户提出了一个公众号选题（如"写一篇关于湿地保护的推文"），需要先搜集素材。
- 用户提供了选题关键词或选题方向。
- 触发关键词：搜集素材、找资料、搜索一下、这个选题有什么素材、帮我查查。

不要用于：直接写文章（用 `env-ngo-wechat-template`）、结项报告、案例萃取、FAQ 生成。

## Workflow

1. **解析选题**：从用户输入中提取核心关键词（议题、领域、目标读者）。
2. **知识库检索**：先在机构的项目档案、历史推文、案例库中搜索相关素材。
3. **Web 搜索**：如果需要外部数据（政策背景、行业新闻、同类案例），执行 web 搜索补充。
4. **素材整理**：按「背景数据 / 机构故事 / 外部参考」三类组织素材。
5. **输出素材卡片**：以结构化 Markdown 输出，供Pipeline下游使用。

## Required Inputs

- 选题关键词或选题方向（必填）。
- 可选：目标读者人群、文章风格偏好、是否需要外部数据。

## Output Contract

输出 Markdown，结构如下：

1. **选题摘要**（1-2 句，提炼核心角度）
2. **背景数据**（来自知识库或 web 搜索的政策、统计、行业背景，标注来源）
3. **机构故事素材**（来自知识库的项目案例、受益人引述、活动记录，标注来源文档）
4. **外部参考**（同类机构/议题的参考文章标题和亮点，标注搜索时间）
5. **素材缺口**（当前缺什么：缺数据/缺故事/缺图片描述，供下游提示人工补充）

语言：客观记录，不添加主观评价。篇幅不限制但每项标注来源。

## Gotchas

- 知识库中没有的素材不要编造——如实标注「未找到」。
- Web 搜索到的信息标注搜索时间和来源 URL，区分「权威来源」和「普通来源」。
- 机构内部敏感信息（未公开的项目数据、财务数字）不出现在素材卡片中。
- 不要替用户判断素材好坏——记录即可，取舍由下游 skill 和人工决定。
- 如果选题过于宽泛（如"环保"），应请求用户缩小范围后再搜索。

## Files To Read

- 无（此 skill 主要使用 web 搜索和知识库检索，不需要额外模板文件）。