---
name: env-ngo-audio-minutes
description: >-
  Load when the user provides a meeting, interview, or activity recording
  (m4a / mp3 / wav) and wants it turned into structured minutes with issue
  notes, decisions, action items, and quoted remarks for an environmental
  nonprofit. Do not load for narrative-only notes without audio, case
  extraction, or social-media copy.
---

# 录音转纪要技能（项目文书链 · 纪要）

把会议、访谈或活动录音转成结构化纪要：先调用 `speech_transcribe` 得到文字稿，再按议题整理决议、待办与关键引用，输出前按既有规则脱敏。这是长录音入口的配套技能，常接在「录音 → 脱敏 → 案例/传播」链条的最前面。

## When To Use

- 用户给出一个录音文件，或提出「把这段录音转成纪要」「整理一下这份会议录音」。
- 用户要的是**结构化纪要**（决议 / 待办 / 引用），而不是原样文字稿、标准案例、结项报告或公众号推文。
- 触发关键词：录音转纪要、会议纪要、访谈纪要、整理录音、录音转文字整理。

不要用于：写结项报告（用 `env-ngo-closure-report`）、萃取标准案例（用 `env-ngo-case-extract`）、只做脱敏改写（用 `env-ngo-story-desensitize`）。

## Workflow

1. 调用 `speech_transcribe`，`audioPath` 指向用户给出的录音（工作区相对路径或绝对路径）；按需传 `language`，不要传未注册的 `providerId`。
2. 若工具返回中文准备引导（识别服务尚未就绪），把引导转达给用户并等模型准备完成后重试；不要自行改用其他转写方式，也不要把音频发到本机之外。
3. 读取工具返回的 `transcriptPath` 指向的文字稿全文。
4. 按议题（讨论主题或时间段）分段，对照 `assets/minutes_template.md` 输出纪要。
5. 输出前按 `env-ngo-story-desensitize` 的脱敏对照表处理个人信息。
6. 在纪要末尾注明文字稿文件路径，便于用户回查原文。

## Required Inputs

- 录音文件路径（工作区可读）。
- 可选：会议名称/时间/参会方（用于纪要表头）、议题清单、机构既有纪要范本。

## Output Contract

输出 Markdown，必须包含以下部分：

1. **会议信息**（名称、时间、参会方；未知写「待补」）
2. **议题纪要**（按议题分节：讨论要点 + 结论）
3. **决议**（本次明确形成的决定，逐条；没有则写「本次未形成明确决议」）
4. **待办**（事项、负责人、期限；缺失写「待补」）
5. **关键引用**（1–3 条脱敏后的原话，注明发言人代号）
6. **文字稿文件**（`speech_transcribe` 返回的 `transcriptPath`）

语言：中文；篇幅 500–1200 字，长会可按议题继续分节。

## Gotchas

- 识别文字稿可能有错别字、漏句或断句错误：**只根据文字稿整理**，不猜测、不补全未识别的内容；存疑处在纪要中标注 `[文字稿存疑，请核对]`。
- 本地识别模型不输出说话人标签：引用只写「发言人 A/B」并提醒用户核对，不要凭猜测把话归给具体的人。
- 讨论中的提议不等于决议；只有明确形成的决定才写进「决议」。
- 待办缺负责人或期限时写「待补」，不要替会议指派任务。
- 人名、联系方式、金额、地址按脱敏规则处理（姓名→代号，删除手机号/证件号，金额→量级，地址到区县）；涉未成年人或敏感救助信息从严。
- 录音原文件本身可能包含未脱敏内容，提醒用户对外分享前只发纪要、不发录音。

## Files To Read

- `assets/minutes_template.md`：纪要输出结构模板（必读）。
- `env-ngo-story-desensitize` 技能中的 `assets/desensitize_rules.md`：脱敏对照表（按其规则执行）。
