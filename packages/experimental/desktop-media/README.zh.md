---
description: "octopus_DSH 会话媒体 overlay：MiniMax 工具、media 任务生产者、会话事件与 $DSH_HOME 目录存储，FFmpeg 运行时由用户自行安装。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-media

[English](README.md) | 中文

## 概述

`desktop-media` 是会话驱动的私有桌面媒体 overlay：Host 半面注册 MiniMax 工具、`media` 任务生产者、会话事件/投影以及 `$DSH_HOME/media` 下的目录，Client 半面占用 composer 与 tool-view 孔位。DMG 不随包媒体运行时；只有用户自装的 FFmpeg 或必需编码器缺失时，合成才会失败。

私有 octopus_DSH overlay，用于会话驱动的多媒体制作。Host 半注册 MiniMax 工具、`media` 任务生产者、会话事件／投影、`$DSH_HOME/media` 目录，以及系统打开／定位。Client 半占用 `conversation.input.left`、`tool.call.toolview`、`sidebar.footer.action`、`shell.overlay` 和 `settings.models.footer`（MiniMax 密钥，不是对话提供方）。官方 `dsh-desktop-app` 与 `PROFILE_TEMPLATES.desktop` 不点名本包；桌面 profile 种子会装上它。

不发布 `./invariant` companion。目录和会话事件是所属记录；没有可以与这些写入分叉的独立观察关系。

## 目录

- [配置](#config)
- [阶段 1 发现](#stage-1-findings)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="config"></a>
## Config

```yaml
- id: desktop-media
  name: '@deepseek-ai/dsh-experimental-desktop-media'
  config:
    mediaRuntimePath: ''
    maxPaidCallsPerSession: 8
    maxEstimatedSpendYuan: 40
    maxClipCount: 4
    maxClipDurationSeconds: 15
    maxFileBytes: 20971520
    pollIntervalMs: 4000
    pollTimeoutMs: 600000
    videoModel: MiniMax-H3-Max
    ttsModel: speech-2.8-hd
    defaultDurationSeconds: 5
    defaultResolution: 768P
    defaultRatio: '16:9'
```

空的 `mediaRuntimePath` 回落到 `OCTOPUS_MEDIA_HOME`，再回落到 `$DSH_HOME/media/user-runtime-home`。缺少运行时不会让 companion 启动失败；二进制或必需编码器缺失时，`composeAudiovisual` 才会失败。受管文件解析到 `$DSH_HOME/media`，不使用当前工作目录或 `OCTOPUS_APP_DATA`。

需要视频功能的用户安装 FFmpeg 并运行 `scripts/install-media-runtime.sh`。合成检查 `h264_videotoolbox` 和原生 `aac`。不对用户自有二进制套用 LGPL 随包装运规则。

<a id="stage-1-findings"></a>
## 阶段 1 发现

- 本机 Homebrew FFmpeg 8.1.2 带 `--enable-gpl` 和 `--enable-libx264`。若嵌入，`inspectFfmpegVersionOutput` 判定不可随包装运。第一版在用户运行安装脚本后把它当作用户自有运行时。
- FFmpeg 8 在 concat 产出未使用的音轨垫时会失败。替换旁白使用 `concat=…:v=1:a=0` 并映射 `[narr]`；混音和无旁白仍使用 `a=1`。
- 无声 1 秒 640×360 片段加 0.4 秒 AAC 旁白，经 `h264_videotoolbox` 和原生 `aac` 合成 1.000 秒、10880 字节的 H.264/AAC MP4。
- `openNativePath` 没有工作区围栏，可以打开 `$DSH_HOME/media` 下的文件。媒体产物不得复用 `session.openWorkspacePath`。
- 恢复所需的活 owner 来自恢复后的 `SessionController.resolveAgent`。恢复监听 `agent/created`，并在 `ctx.jobs.start` 前确认已附加 job controller。
- 经授权的 `provider.e2e.ts`（`retry: 0`）已对 `https://api.minimax.cn` 通过：`speech-2.8-hd`／`male-qn-qingse`、MiniMax-H3-Max 5 秒 768P 16:9 文生视频，以及用合成样本克隆后的首次正式 TTS。

<a id="model-experience"></a>
## Model Experience

Indirectly, through registered media tools and a creation system-prompt section that return request identifiers rather than bytes.

#### KV Cache effect

加载 overlay 后，工具 schema 和创作 skill 段落进入系统提示。

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **不随包 FFmpeg** — DMG 不嵌入 media-runtime；用户运行安装脚本。
- **没有应用内播放** — 打开／定位只请求系统桌面。
- **另存为** — 仅在原生目录流占位存在时提供；拒绝覆盖已有目标；否则提供复制路径。
- **付费确认** — 必须有 `userQuestions`；缺失则失败关闭。
- **图生视频** — 已导入的 `png`／`jpg`／`webp` 静帧通过 `imageIds` 交给 MiniMax；`imageMode: first_last` 需要正好两张端点帧，且不得与参考图混用。
- **目录** — `$DSH_HOME/media/catalog` 下的原子 JSON，不是 `ctx.storage.domain`。

<a id="dev-note"></a>
## 开发备注

付费调用缺少 `userQuestions` 时必须失败关闭；没有媒体运行时也不能让 companion 启动失败——失败的是 `composeAudiovisual`。目录是 `$DSH_HOME/media/catalog` 下的原子 JSON，会话事件就是所属记录，因此本包不发布 `./invariant` 伴生；`openNativePath` 有意不设工作区围栏，媒体产物不要改走 `session.openWorkspacePath`。
