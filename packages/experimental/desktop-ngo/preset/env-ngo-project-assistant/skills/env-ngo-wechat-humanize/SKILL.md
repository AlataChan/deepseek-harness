---
name: env-ngo-wechat-humanize
description: >-
  Load when the user provides a structured article outline (from env-ngo-wechat-template)
  and needs it converted into conversational, public-friendly prose that reads like
  a real person wrote it — not like a government document. This is the third skill
  in the WeChat publishing pipeline. Do not load for report writing, case extraction,
  or FAQ generation.
---

# "说人话"修辞技能（传播运营模块 · M3 · Pipeline Step 3）

读取上游结构化提纲，把提纲转成一篇口语化、有温度、读者愿意读完的公众号文章初稿。"说人话" = 去掉套话、加上钩子、保持机构声音。

## When To Use

- 上游结构化提纲已就绪（来自 `env-ngo-wechat-template`）。
- 用户需要把"框架式提纲"转成"读者愿意读的完整文章"。
- 触发关键词：写正文、展开提纲、说人话、润色、写得生动一点、不要太官方。

不要用于：搜集素材（用 `env-ngo-wechat-research`）、写提纲（用 `env-ngo-wechat-template`）、结项报告。

## Workflow

1. **读取提纲和语气基准**：接收上游的结构化提纲 + 语气基准摘要。
2. **逐段展开**：把提纲中的每个小标题展开为完整段落。
3. **逐段检查"人话指数"**：
   - ✅ 有具体的人、时间、地点、数据
   - ✅ 开头有钩子（问题/故事/数据冲击）
   - ✅ 段落短（手机屏 3-4 行以内）
   - ❌ 没有"圆满成功""显著成效"等套话
   - ❌ 没有超过 30 字的长句
4. **加注图片位置**：在适合配图的位置标注 [配图建议：xxx]。
5. **输出完整初稿**。

## Required Inputs

- 结构化提纲（来自 `env-ngo-wechat-template` 的输出）。
- 语气基准摘要（来自上游输出）。
- 素材卡片（来自 `env-ngo-wechat-research` 的输出，用于核对事实）。

## Output Contract

输出 Markdown，结构如下：

1. **文章标题**（≤20 字，由提纲的一句话提炼）
2. **正文初稿**（完整段落，含 [配图建议] 标注）
3. **"人话检查清单"**（开头钩子? 段落长度? 套话清除? 长句拆分?）
4. **需要人工润色的地方**（如某段缺乏具体细节、某句需要加入机构声音）

字数：800-1500 字（适合公众号阅读习惯）。

## Gotchas

- "说人话" ≠ 网络流行语堆砌——保持机构的专业底线。
- 如果提纲中标注了 [需人工补充]，对应位置保留 [待补] 标记，不要编造。
- 配图建议只写描述，不要假设图已存在——用 [配图建议：xxx] 格式。
- 开头 3 秒决定读者是否继续读——第一段必须有钩子。
- 引用受益人/志愿者的话时，只能使用素材卡片中有出处的引述。
- 数据必须来自素材卡片，不能为了"生动"而编造数字。

## Files To Read

- 无（修辞规则内嵌于 Gotchas 和 Workflow，不需要外部模板）。