---
description: "octopus_DSH 长录音转写 overlay：一个 speech_transcribe Host 工具，通过 speech-to-text 能力层解码本地录音并写出 Markdown 文字稿。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-speech-transcribe

[English](README.md) | 中文

## 概述

`desktop-speech-transcribe` 是 octopus_DSH 的长录音转写 overlay：Host 面注册一个模型可见的 `speech_transcribe` 工具，读取会话工作区中的录音，解码为 16 kHz 单声道 PCM WAV（macOS `afconvert`，缺失时回退 FFmpeg），通过 `ctx.speechToText` 识别，并把 `<name>.transcript.md` 写到音频同目录。客户端面向「专业能力」hero 菜单贡献「录音转文字」一行，把选中的录音经 Host 放进工作区。桌面 profile 播种安装本包。不捆绑任何模型、媒体或运行时资产。

## 目录

- [使用此包](#use-this-package)
- [配置](#config)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

工具接收工作区相对路径或绝对路径 `audioPath`，可选 `language` 与 `providerId`。相对路径按调用会话的工作目录解析；目录和超过 2 GiB 的文件被拒绝；凡不是 speech 能力层直接转发的规范 16 kHz 单声道 PCM16 WAV，一律先解码。文字稿与音频同目录：`访谈.m4a` 生成 `访谈.transcript.md`。

即使可选的语音输入 bundle 未启用，本 overlay 也可启动。每次工具调用读取当前语音注册表；注册表缺失时，在读取或解码音频前返回中文设置引导。转写前读取所选 provider 的准备状态。provider 处于 `unprepared`、`failed` 或 `cancelled` 时不触发下载，结果返回中文引导，指向 插件 → 语音输入 → 下载并准备；准备进行中则返回「正在准备中」的等待提示。本工具从不自行准备模型，也不代替用户向 Agent 提交消息。

桌面 profile 通过 `scripts/desktop-profile-plugins.json` 播种安装本包；官方 `dsh-desktop-app` 与 `PROFILE_TEMPLATES.desktop` 不引用它。公益项目助手预设加载配套技能 `env-ngo-audio-minutes`，把文字稿整理成纪要。

「专业能力」hero 菜单新增一行「录音转文字」：点开后打开本地文件选择器，读取所选录音，经 `session/importTranscriptAudio` Remote 放进 `<workspaceRoot>/recordings`。成功后输入框草稿变为「把 `<工作区相对路径>` 转成文字稿」并自动提交，由 `speech_transcribe` 从这份工作区文件开始转写。失败会在该行内联提示；本行从不覆盖已存在的录音文件。

<a id="config"></a>
## 配置

```yaml
- id: desktop-speech-transcribe
  name: '@deepseek-ai/dsh-experimental-desktop-speech-transcribe'
  config:
    maxAudioMinutes: 120
    maxUploadMiB: 64
```

`maxAudioMinutes` 限定录音时长；超过上限的录音在识别开始前以中文诊断失败。上限在读取数据前由 WAV 头部算出，重新封装过的 WAV 同样受此限制。

`maxUploadMiB` 是单次选入录音的暂存上限，但实际生效的是 `min(64 MiB, maxUploadMiB)`：`importTranscriptAudio` Remote 单次负载最多解码 64 MiB，因此在线上限常量改变前，把 `maxUploadMiB` 调到 64 以上不会生效。客户端行按同一实际默认值预检，Host 对超限上传以中文消息拒绝。

<a id="model-experience"></a>
## 模型体验

### `speech_transcribe` 工具

#### 模型看到什么

overlay 加载期间，每个请求都会带上这一个已注册工具的名称、描述以及 `audioPath`/`language`/`providerId` 参数。成功调用在一个有界结果里返回 `transcriptPath`、`characters`、文字稿前 1200 字；推导出的文件名已被占用时，额外返回 `note` 指明实际使用的带后缀文件。被阻断的调用则返回中文准备引导。

#### Token 影响

工具定义每个请求消耗一次输入 token。结果只携带有界预览和文件路径，长文字稿留在磁盘上，只有用户要求读文件时才进入请求。

#### KV Cache 影响

工具定义与客户端行除结果文本本身外不带来逐轮变化，缓存的公共前缀保持稳定，而各次调用的文字稿内容变化。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **provider 单次请求上限** —— 能力层每次调用转发一段录音。随包发货的语音输入 composition 已为长录音调高 SenseVoice worker 上限（`maxAudioBytes` 512 MiB ≈ 4.5 小时的 16 kHz 单声道 PCM、`inferenceTimeoutMs` 2 小时、`maxResponseBytes` 4 MiB），90 分钟录音可以容纳；超过 composition 上限的录音会被 provider 拒绝。
- **解码依赖** —— 规范 WAV 直接通过；m4a、mp3 等其他容器需要 macOS `afconvert`，或 PATH、`/opt/homebrew/bin/ffmpeg`、`/usr/local/bin/ffmpeg` 中的 FFmpeg。两者都没有时，工具以中文引导失败，并指出文件名与缺失的工具。
- **只有文字** —— SenseVoice 返回纯文本：没有说话人标签，也没有时间戳。单次接受的录音由 provider 做 VAD 分段，但文字稿是一个 `## 全文` 整块。
- **同名后缀** —— 文字稿路径由音频名推导；若同名文件已存在，工具改写 `<stem>.transcript.2.md`（依次递增），并在 `note` 中返回实际文件名，不覆盖原文字稿。
- **没有进度界面** —— 暂存期间该行自身禁用，失败以内联提示显示；没有进度条，转写本身也只通过工具结果汇报。
- **暂存文件会保留** —— 该行把选中的录音写进 `<workspaceRoot>/recordings`；转写完成后文件仍留在工作区。
- **分块转写（暂缓）** —— 超过 provider 单次请求上限的录音，等待多次调用的分块路径。
- **说话人与时间戳（暂缓）** —— 能力层能上报说话人与时间戳后，输出再补上。
- **一键准备（暂缓）** —— 引导结果再加「前往安装」深链，直达语音输入插件页。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者视角 — 点击展开</summary>

暂存用 `wx` 写入 `<workspaceRoot>/recordings`，因此暂存的录音在用户删除前一直是用户的文件。实际上传上限是 `min(64 MiB wire 常量, maxUploadMiB)`——把 `maxUploadMiB` 调到 64 MiB 以上，只有先改 wire 常量才生效。

</details>
