---
name: env-ngo-activity-recap
description: >-
  Load when the user provides activity photos, attendance logs, or brief
  event notes and needs a structured recap post (for WeChat, newsletter,
  or internal report) for an environmental nonprofit. Do not load for
  closure reports, case extraction, or FAQ generation.
---

# 活动复盘技能（传播运营模块 · M3）

把活动现场的照片说明、签到记录、简要笔记转成一篇结构清晰、可直接发公众号或内部通讯的活动复盘帖。这是第 4 课「多智能体协作」中可作为传播写作员调用的样板技能，学员可 Fork 后改成自己机构的版本。

## When To Use

- 用户提供了一次活动的现场记录（照片说明、签到表、活动笔记、志愿者反馈等）。
- 用户想要的是一篇**活动复盘/活动回顾帖**，用于公众号推送、机构月报或社群分享。
- 触发关键词：活动复盘、活动回顾、写推文、活动总结帖、公众号稿。

不要用于：写结项报告（用 `env-ngo-closure-report`）、萃取标准案例入库（用 `env-ngo-case-extract`）、回答社群常见问题（用 `env-ngo-community-faq`）。

## Workflow

1. 读取用户提供的活动原始材料，提取「活动是什么 → 怎么做的 → 有什么反馈/成果」。
2. 对照 `assets/recap_template.md` 的结构组织内容。
3. 写出适合社交媒体阅读习惯的文风：开头有钩子、段落短、有人物细节、结尾有呼吁。
4. 所有个人信息在输出前脱敏。
5. 若照片说明中提及人脸，提醒用户发布前确认肖像授权。

## Required Inputs

- 活动名称、时间、地点。
- 原始材料：活动笔记、照片说明、签到数据、志愿者/参与者反馈（至少一种）。
- 可选：目标发布渠道（公众号/社群/内部月报），以便调整语气。

## Output Contract

输出 Markdown，包含以下结构：

1. **标题**（≤15 字，有画面感或悬念感）
2. **导语**（1–2 句钩子，让读者想看下去）
3. **活动过程**（3–5 个短段落，按时间线或亮点组织，穿插参与者引述）
4. **数据亮点**（用列表或短句呈现关键数字，仅用有出处的数据）
5. **参与者声音**（1–2 条脱敏后的原话或近似引述）
6. **下一步/呼吁**（预告下次活动或招募、关注引导）

语言：活泼但不浮夸，适合公众号阅读节奏。篇幅 400–800 字。

## Gotchas

- 不要编造参与者引述；没有原话就不写「参与者声音」板块，改为观察描述。
- 数据只用用户提供的数字，**不估算不编造**。
- 个人信息必须脱敏（姓名→代号，删除联系方式）。
- 涉及照片中人脸的描述，提醒 `[发布前请确认肖像授权]`。
- 避免「圆满成功」「取得丰硕成果」等套话，用具体细节替代。
- 若用户指定渠道为「内部月报」，语气可更客观简练；默认按公众号风格。

## Files To Read

- `assets/recap_template.md`：复盘帖结构模板（必读）。
