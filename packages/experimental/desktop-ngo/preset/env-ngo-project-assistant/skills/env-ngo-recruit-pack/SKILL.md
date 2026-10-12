---
name: env-ngo-recruit-pack
description: >-
  Load when the user provides an upcoming outdoor/education activity basics
  (name, date, place, difficulty highlights) and needs a recruit pack: WeChat
  long post, Moments captions, and a short group notice for an environmental
  nonprofit. Do not load for post-event recaps or awareness-day campaign packs.
---

# 活动招募包技能（传播运营模块 · M3）

在活动开始前，一次性产出**公众号招募长文 + 朋友圈短句 + 社群通知**。动态信息（报名方式/费用/人数上限）一律留空标注。

## When To Use

- 用户要为即将举办的户外教育、志愿活动等生成**招募物料**。
- 触发关键词：生成招募、招募包、报名推文、活动招募文案。

不要用于：活动后复盘（用 `env-ngo-activity-recap`）；公益节点日历宣发（用 `env-ngo-calendar-campaign`）；领队检查清单（可另建 SOP，不在本技能范围）。

## Workflow

1. 读取活动基本信息与可选历史好稿。
2. 按 `assets/recruit_pack_template.md` 输出三部分。
3. 开头避免「随着」「在这个」等套话；写出画面感与号召。
4. 报名方式、费用、人数上限等动态字段统一 `[待补充]`。
5. 不编造往期人数、媒体曝光等数据。

## Required Inputs

- 活动名称、日期、地点/线路、难度或特色亮点。
- 可选：历史好推文、安全提示要点。

## Output Contract

单文件 Markdown：

1. **公众号招募文**（标题 + 正文 600–800 字）
2. **朋友圈短句 ×3**（含话题标签）
3. **社群通知**（≤50 字量级，含关键信息；动态字段可 `[待补充]`）
4. **待补充字段清单**

## Gotchas

- 动态字段全部标 `[待补充]`，禁止虚构链接或价格。
- 不承诺「包教会」「绝对安全」等无限责任表述。
- 肖像/未成年人相关提醒可放在文末注意事项。
- 与复盘技能触发词分离：招募用「生成招募」，复盘用「写复盘」。

## Files To Read

- `assets/recruit_pack_template.md`：招募包模板（必读）。
- `assets/example_input_activity_brief.md`：活动简介样例。
