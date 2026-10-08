# Agent Note: 会话驱动的多媒体制作与作品查看

Status: implemented

[English](2026-09-20-conversation-media-creation.md) | 中文

## Problem

小绿鲸用户需要把会话中的文案和活动照片制作成短视频或个人音色配音，并查看、保存和找回结果。完整剪辑器会引入项目管理、时间线和多轨编辑负担；仅提供 API 表单又无法复用会话里的创作意图。

## Decision

以现有会话作为制作入口，以侧边栏「作品」按钮作为结果入口。默认助理保持 `standard`。专门的创作 skill（技能）组织制作方法。双端 overlay `@deepseek-ai/dsh-experimental-desktop-media` 提供 MiniMax H3、TTS、声音克隆、任务查询和本地合成。官方 `apps/desktop`、`desktop-app` 和 `desktop-companion` 的产品逻辑不改。

第一版随包装运 overlay，不嵌入 FFmpeg。一键 DMG 在用户需要视频功能时，请其安装 FFmpeg 并运行 `scripts/install-media-runtime.sh`。官方 `session-controller` Remote 对 `ctx.get('desktopMedia')` 做鸭子类型，官方包不导入 overlay。`listMediaWorks`、`listMediaVoices`、`mediaRuntimeStatus`、`openMediaWork`、`revealMediaWork`、`copyMediaWorkPath`、`importMediaBytes` 和 `saveMediaWorkAs` 不激活 Agent。没有 overlay 的 Host 回答 `session/media-unavailable`。

### Scope

支持单段视频或少量片段顺序拼接，加一条旁白；支持单独生成配音。作品自动保存在本地，提供「打开文件」「在文件夹中显示」、另存为及返回来源会话。使用系统默认播放器。复杂剪辑交给外部工具。

不提供项目编辑器、多轨时间线、可视化工作流、精确口型同步、自动发布、背景音乐编辑和字幕排版。片段数、时长、并发、文件大小、重试次数，以及付费调用次数与预计支出上限，均为经过校验的插件配置。每次付费调用前 Host 检查两类预算。价格未知时，未经用户确认明确估算不得自动提交付费调用。

### User path

已打开会话中的快捷入口加载制作方法，不切换默认助理、不立即提交付费生成。空白 Hero 没有媒体快捷入口。Host 将明确确认绑定到请求版本、样片产物、已选参考或端点帧的 SHA-256，以及后续付费范围。工具传入 `approved: true` 不能授权支出。输入变化须重新确认。

### Creation skill and H3

创作 skill 经 `scripts/desktop-bundled-skills.json` 随包装运。每次生成只承担一个主要镜头。第一版模式为文生视频、图生视频（`imageIds`）和互斥的 `first_last` 端点。技能描述方法，Host 校验参数和范围。

### Interface and works

`conversation.input.left` 放置中文快捷入口。`tool.call.toolview` 显示结果卡。`sidebar.footer.action` 和 `shell.overlay` 承载作品列表。空态为「还没有作品，在会话中选择‘做视频’或‘做配音’开始」。第一版作品行显示类型图标。仅在原生目录流占位存在时显示另存为；否则提供复制路径。卡片和作品共用持久产物标识。

### Voice cloning and composition

克隆须有明确同意声明，并在上传前持久记录说话人、录音摘要、请求标识和时间。voice id 使用 `dshVoice` 前缀。配音默认替换原音。合成要求用户已安装且暴露 `h264_videotoolbox` 和原生 `aac` 的 FFmpeg。应用不检查该用户自有构建是否符合 LGPL 随包装运规则。

### Module and persistence

overlay 登记 `media` JobKind、仅日志的 `media/*` 会话事件，以及一个媒体投影。目录是 `$DSH_HOME/media/catalog` 下的原子 JSON，而不是 `ctx.storage.domain`。第一版导入准入按扩展名、大小和字节；ffprobe 流检查仍在[媒体导入准入提案](../../proposed/architecture/2026-09-20-media-import-admission.zh.md)。恢复监听 `agent/created`，确认活 owner 和任务控制器后，对每个 `providerTaskId` 最多启动一个任务。显式 `job_kill` 追加 `media/stop`。付费确认必须有 `userQuestions`，该缝不在时失败关闭。

Host 插件注入 `tools`、`jobs`、`sessionProjections`、`systemPrompt` 和 `sessions`，以便这些登记等待对应缝。凭据和 `userQuestions` 仍通过 `ctx.get` 作为可选缝。

### Local opening and distribution

「打开文件」和「在文件夹中显示」只响应用户点击。skill 只报告已请求系统打开。[媒体运行时分发](../process/2026-09-20-media-runtime-distribution.zh.md)负责用户安装解析。`verify-desktop-bundle` 检查 session-controller Remote 面上的 `listMediaWorks`，以及种子 overlay 中的中文 Client 文案。

## Stage 1 evidence

2026-09-20 在 macOS arm64、分支 `feature/conversation-media-creation-stage1` 实测。已授权付费 MiniMax 调用对 `https://api.minimax.cn` 执行，使用 `MINIMAX_API_KEY` 和 `MINIMAX_E2E_ALLOW_PAID=1`。`packages/experimental/desktop-media/tests/provider.e2e.ts` 以 `retry: 0` 通过两次。克隆使用合成的 `speech-2.8-hd` 样音。

本机 Homebrew FFmpeg 8.1.2 位于 `/opt/homebrew/bin/ffmpeg`（SHA-256 `2ce81b92499c1b6b96eb060c69723114bd0da13f1bfbd9da26dee24d099e644a`），带 `--enable-gpl --enable-libx264`。`inspectFfmpegLicense` 将其标为不可随包装运。`composeAudiovisual` 把 1 秒无声片段与 0.4 秒 AAC 旁白合成 10880 字节的 H.264 + AAC MP4。`openMediaFile` 和 `revealMediaFile` 接受该路径。成功表示已请求系统打开。

国内按量列表价来自 2026-09-20 的 [MiniMax 按量计费](https://platform.minimax.cn/docs/guides/pricing-paygo)，用于估算这次实测（不是账单）：MiniMax-H3-Max 768P 文生视频 5 秒约 ¥2.50；系统 `speech-2.8-hd` 29 个计费字符约 ¥0.01；新音色首次正式 TTS 约 ¥9.90 克隆费加 ¥0.01。立即再次查询 H3 任务成功。

## Stage 2-4 shipped facts

目录仍是 `$DSH_HOME/media/catalog` 下的 JSON。图生视频通过 `imageIds` 和互斥的 `imageMode` 复用已导入静帧。生产环境在测试未注入 flush 时使用 `sessions.flush`。另存为拒绝已有目标（`save-as-exists`）。`runVideo` 在付费 HTTP 调用前重新哈希已导入静帧。无密钥 headless 快照 `snapshots/session/conversation-media-creation/` 加载 skill、保持媒体工具已登记，并钉死「已请求系统打开文件」以及确认后再付费。Client 结果卡由包装测覆盖。官方 TypeScript 和 Python SDK 默认配置的预期输出不改，因为那些配置不挂载 overlay；`media/*` 已在 `KNOWN_SESSION_EVENT_TYPES`。

## Alternatives considered

**完整视频工作台。** 项目管理、分镜编辑器和多轨时间线超出会话内轻量制作目标。

**三个独立 API 表单。** 接口可调用，但用户仍要自己组织上下文和制作顺序。

**独立视频助手。** 增加助理切换与结果归属问题；专门 skill 可以在 `standard` 会话中工作。

**直接打包 oil-motion。** 其网页运行时和个人凭据入口不在范围内。

**应用内播放器。** 第一版不承担 Range 传输、媒体令牌和 WebView 播放，改用系统程序。

**第一版使用 `ctx.storage.domain` 目录。** 拒绝，以免 overlay 依赖官方 storage-domain 接线。

## Consequences

用户可在 `standard` 会话中制作短视频和配音，无需第二个助理或剪辑器。视频合成仍取决于用户自装的 FFmpeg。用户需要离开工作台查看或试听。提供方保留期和定价会变化；中断的付费提交可能无法核实。官方桌面产品逻辑不引入媒体导入。

## Testing

Host 的 `bundle` 脚本是 `tsc -b tsconfig.json && tsdown`。只跑包装内 `tsdown` 会重打包过期的 `lib/types`，可能随包装运 `inject = { optional: […] }`；Cordis 会等待名为 `optional` 的服务，桌面 companion 永远不会就绪。

```bash
pnpm exec vitest run packages/experimental/desktop-media/tests/
pnpm exec vitest run --config vitest.snapshot.config.ts snapshots/session/headless.snapshot.ts --testNamePattern=conversation-media-creation
```

`verify-desktop-bundle` 会 grep 种子 Host 的 `lib/index.js`，要求 `tools`/`sessions` 的 inject 数组，并拒绝对象形式的 `inject.optional`。companion 生命周期冒烟会在握手前安装每一个已钉死的 overlay。种子会丢掉 `workspace:` 对等包，因此对该 Host 文件做裸 `import()` 不能当作加载检查。模型页页脚卡片通过 credentials remotes 写入 `MINIMAX_API_KEY`，不是对话提供方行。会话快捷方式「克隆声音」本身就是文件控件。选中 mp3、m4a 或 wav 后，同意页挂在 `document.body`。挂在输入框或 `shell.overlay` 里的对话框不会出现。会话加号仍只收图片和文档。

付费 MiniMax 仍为 `MINIMAX_E2E_ALLOW_PAID=1 pnpm exec vitest run --config vitest.e2e.config.ts packages/experimental/desktop-media/tests/provider.e2e.ts`，且 `retry: 0`。缺密钥跳过不算通过。

## Related

本决定不取代 jobs、附件、凭据、存储和目录选择器。[task-surface](../../proposed/feature/2026-08-04-task-surface.zh.md) 将后台执行与持久 UI 放在客户端插件工作流。[存储根](../../proposed/architecture/2026-07-28-storage-root-and-derived-medium-recovery.zh.md)和[取消](../../proposed/architecture/2026-07-19-required-cancellation-through-tool-capability-seams.zh.md)仍为 proposed。图片复用[图片附件](2026-08-26-generic-file-upload.zh.md)。会话状态遵循[投影归属](../architecture/2026-08-25-session-observations-and-projection-owned-client-state.zh.md)。另存为使用[目录选择器](../../archived/architecture/2026-07-28-directory-picker-capability-seam.md)的 native 提供方。

## Sources

国内参考：[H3 创建任务](https://platform.minimax.cn/docs/api-reference/video-generation-v2-create)、[查询任务](https://platform.minimax.cn/docs/api-reference/video-generation-v2-query)、[声音克隆](https://platform.minimax.cn/docs/api-reference/voice-cloning-clone)、[同步 TTS](https://platform.minimax.cn/docs/api-reference/speech-t2a-http)。阶段 1 钉死 H3-Max 文生视频 5 秒／768P／16:9 和 `speech-2.8-hd`。
