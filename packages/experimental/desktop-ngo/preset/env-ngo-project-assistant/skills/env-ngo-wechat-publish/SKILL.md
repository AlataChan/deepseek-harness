---
name: env-ngo-wechat-publish
description: >-
  Load when the user provides a completed WeChat article draft (from env-ngo-wechat-humanize)
  and needs a final compliance and desensitization review before publishing. This is the
  final skill in the WeChat publishing pipeline. Do not load for report writing, case
  extraction, or FAQ generation.
---

# 公众号草稿发布技能（传播运营模块 · M3 · Pipeline Step 4）

读取上游完整初稿，执行脱敏检查、合规标记和发布就绪检查，输出一份可以进入公众号后台排版的发布就绪草稿。

## When To Use

- 上游完整初稿已就绪（来自 `env-ngo-wechat-humanize`）。
- 用户需要对文章进行最后的脱敏和合规检查。
- 触发关键词：发布前检查、准备发布、脱敏检查、合规检查、最终版。

不要用于：写文章（用 `env-ngo-wechat-humanize`）、搜集素材、结项报告。

## Workflow

1. **读取完整初稿**：接收上游输出的公众号文章初稿。
2. **执行脱敏扫描**：检查草稿中是否包含——
   - 真实姓名（应替换为代号或删除）
   - 手机号、身份证号（应删除）
   - 精确家庭地址（应模糊到区县级）
   - 未授权的受益人照片描述（标注提醒获取授权）
3. **合规检查**：
   - 数据引用是否标注来源？
   - 涉及政策/法规的表述是否标注了信息时效？
   - 是否有机构未公开的财务数据？
   - 对外承诺（如"我们保证……"）是否需要法务审核？
4. **配图提醒**：汇总所有 `[配图建议]` 标注，生成配图清单。
5. **输出发布就绪草稿**：附脱敏变更清单和合规注释。

## Required Inputs

- 完整初稿（来自 `env-ngo-wechat-humanize` 的输出）。
- 可选：机构的发布审校标准（如"发布前需 XX 审核"）。

## Output Contract

输出 Markdown，结构如下：

1. **发布就绪正文**（脱敏、合规检查后的最终版正文）
2. **脱敏变更清单**（如有变更，列出「原文 → 修改后」对应表）
3. **合规检查清单**（逐项标注 ✅ 已检查 / ⚠️ 需人工确认）
4. **配图清单**（汇总所有 [配图建议]，生成方便转发给设计师/摄影师的清单）
5. **发布前人工必查项**（如涉及对外承诺、财务数据、受益人故事的段落）

## Gotchas

- 脱敏是安全的底线——宁可多脱一处，也不少留一处。
- 合规检查不是替代机构的审核流程——标注 [需 XX 部门审核] 提醒人工介入。
- 配图涉及人脸/受益人的，必须标注 [请确认肖像授权]。
- 对外承诺类表述（"我们保证""承诺做到"）统一标注 [建议法务审核]。
- 数据引用标注了来源也不等于完全准确——提醒用户逐项核实。
- 不要删除文章中的信息性内容——脱敏是隐藏身份，不是删减内容。

## Files To Read

- `../env-ngo-story-desensitize/assets/desensitize_rules.md`：脱敏规则对照表（如有需要，读取参考）。