---
name: env-ngo-calendar-campaign
description: >-
  Load when the user provides an awareness-day or campaign node (name + date) plus
  science/education source materials and needs a campaign pack: short article,
  social captions, and T-7/T-3/T-1 reminder checklist for an environmental
  nonprofit. Do not load for ordinary activity recaps or general FAQ answers.
---

# 公益节点宣发包技能（传播运营模块 · M3）

针对「世界某某日 / 机构节点」生成**短图文 + 朋友圈短句 + 倒计时提醒清单**。科普事实必须有素材出处。

## When To Use

- 用户给出节点名称、日期，并提供科普素材或历史好稿。
- 触发关键词：节点宣发、节点物料、公益节点、倒计时提醒、节点是××日期××。

不要用于：活动结束后的复盘推文（用 `env-ngo-activity-recap`）；日常社群知识答疑（用 `env-ngo-community-faq`）；户外活动招募包（用 `env-ngo-recruit-pack`）。

## Workflow

1. 确认节点名称、日期、发布渠道假设。
2. 读取素材，只提取有依据的科普事实。
3. 按 `assets/campaign_pack_template.md` 输出三部分。
4. 生成 T-7 / T-3 / T-1 提醒，每条必须是可执行任务。
5. 无法确认来源的数据标 `[请核对来源]`；文末加发布前准确性核对提示。

## Required Inputs

- 节点名称 + 日期。
- 科普素材（文件夹说明、粘贴文本或要点列表）。
- 可选：历史好稿 1–2 篇（语气参照）。

## Output Contract

单文件 Markdown，含：

1. **短图文**（标题 + 正文 300–500 字，突出 1 个记忆点）
2. **朋友圈短句 ×3**（含话题标签）
3. **T-7 / T-3 / T-1 提醒清单**（任务具体可执行）
4. **来源与待核对**

## Gotchas

- **不自编科普数据**；无出处不写进正文。
- 提醒清单禁止「准备好」「注意宣传」等模糊项。
- 与活动复盘路由分离：节点是日历驱动，复盘是活动后驱动。
- 涉及合作品牌/赞助信息时留 `[待补充]`，不猜测。

## Files To Read

- `assets/campaign_pack_template.md`：宣发包模板（必读）。
- `assets/example_input_node_brief.md`：节点说明样例。
