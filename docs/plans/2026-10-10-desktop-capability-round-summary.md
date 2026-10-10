# octopus_DSH 桌面能力阶段总结（2026-10-09 → 2026-10-10）

Mode: phase summary

Created: 2026-10-10

Architect: Cla（起草；本阶段执行记录）

Status: 已完成并通过真机验收；DMG 已构建、内容已复核

配套文档：方案与实测见 [VibeVoice-ASR 转写插件方案](./2026-10-09-vibevoice-asr-provider.md)；上游治理见 [选择性升级计划](./2026-10-06-upstream-selective-upgrade.md)。

---

## 0. 阶段概览

本阶段把桌面端三条能力线一次打通并全部落到可安装的 DMG：**「专业能力」统一入口**、**长录音转写能力**、**「录音转文字」一键入口**；同时用实测数据替一个"看起来很美好"的新引擎做出了止损决定（VibeVoice NO-GO，按预案回退）。

三个提交（按顺序）：

| 提交主题 | 提交号 | 内容 |
|---|---|---|
| `feat(desktop): 专业能力菜单与数据/知识/创作入口整轮落地` | `0a4b79cc6e` | 菜单、改名、知识库两级选择、media 修复 |
| `feat(desktop): VibeVoice P0 结论与长录音转写入口（SenseVoice 回退）` | `31d99e954e` | P0 实测、转写工具、纪要技能、部署上限 |
| `feat(desktop): 专业能力新增「录音转文字」入口（选文件即转写）` | `c7d74d1a88` | 一键入口、暂存链路、真机实测 |

## 1. 交付一：「专业能力」菜单

- Hero 行的「专业能力」下拉统一承载五个条目：**问数据 / 问知识 / 做视频 / 做配音 / 克隆声音**；条目由各包通过 fork 自有槽位贡献，官方 UI 零改动。
- 「问数」完成全量改名「问数据」（界面、提示词、sidecar 文案、模板文件名、文档与测试）。
- 问知识：真正的两级选择（库 → 文档）、「挂载所选文档 / 挂载整个库」、输入区绑定条；Host/API 侧补 `listLibraryDocuments` 远程链。
- 关键缺陷修复：媒体包整包 web boot 激活失败的根因是 `mediaCredentialsOf` 读取 `ctx.remote.credentials`——每个 Remote 命名空间是独立 cordis 服务，属性代理对未声明的名字直接抛错（`cannot get property "remote.credentials" without inject`）。改为按仓库规范走全局读 `ctx.get('remote.credentials')`，并移除全部临时自检脚手架。

## 2. 决策点：VibeVoice-ASR P0 → NO-GO

上游 `microsoft/VibeASR.cpp`（MIT）+ `microsoft/VibeVoice-ASR-BitNet`（1.58GB，MIT）在 Apple M2 / 24GB 上实测：

| 项目 | 实测 |
|---|---|
| 构建 | 官方默认配置可编译；官方宣称的加速选项 `BITNET_ARM_TL1` 是死选项（LUT 源码未接入构建） |
| 稳速（20s 片段、4 线程、`--warmup`） | RTF 0.37；8 线程反而更差（1.04） |
| 内存 | 20 秒音频 6.3GB；3 分钟 9.5GB；9.5 分钟峰值 10–16GB |
| 长音频 | **569 秒单次推理 4/4 崩溃**（VAE 编码阶段），单次可用上限约 3–9.5 分钟 |
| 说话人 / 时间戳 | 未出现；`--prompt-format json` 仍是纯文本（BitNet 1.5B 不遵守 7B 的结构化指令） |
| 中文质量 / 许可 | 质量可接受；代码与模型均 MIT |

结论：60 分钟单次、带说话人与时间戳、小内存的三项承诺在目标机型上均不成立。按方案 D3（先 P0 go/no-go）与 D5/§8（预授权回退）执行：**VibeVoice provider 不实现**，全部证据落方案附录 B，模型、二进制与逐次日志保留在 spike 工作目录，条件成熟可复评（见 §7）。

## 3. 交付二：长录音转写能力（SenseVoice 路线）

- 工具 `speech_transcribe`（模型可见）：工作区相对/绝对路径；WAV 直通，m4a/mp3 等经 macOS 自带 `afconvert` 解码（ffmpeg 兜底，缺失给中文引导，**无 FFmpeg 也可用**）；未准备模型时给中文引导（不自动下载）；产出 `<名>.transcript.md`（时长/用时/服务/日期 + 全文）、同名加序号不覆盖、返回有界预览；临时目录必清、错误脱敏。
- 布置上限：SenseVoice 的 `maxAudioBytes` 512MiB、`inferenceTimeoutMs` 2h、`maxResponseBytes` 4MiB（仅部署配置，上游默认与默认 provider 未动）。
- 技能 `env-ngo-audio-minutes`（录音转纪要）：转写 → 议题分段 → 决议/待办/引用 → 脱敏 → 回填文字稿路径；`env-ngo-case-extract`、`env-ngo-story-desensitize` 各加"输入为录音时先转写"的交叉引用。
- 预设刷新改为**增补式**：老装机自动拿到新技能，且不覆盖用户改过的文件。

真机实测（安装态 harness + 真实对话）：90 秒 m4a → 12.4 秒出稿；**9 分 29 秒课程录音（超旧上限 4 倍）→ 82.8 秒出稿**（RTF≈0.15）。

## 4. 交付三：「录音转文字」一键入口

- 「专业能力」菜单新增一行：选本地录音（m4a/mp3/wav/aac，≤64MiB）→ 经 Host 暂存到会话工作区 `recordings/`（重名加序号、`wx` 不覆盖、扩展名白名单、符号链接防御）→ 自动发送「把 `<路径>` 转成文字稿」→ 工具出稿。
- 真机实测：菜单出现新行 → 选文件 → 暂存文件与源 **sha256 一致** → 自动提交 → **11 秒**出稿并附文件卡片。
- 质量门：独立审查两轮（7.25 → 修复 8 项 → 8.0 通过）；新增主机/客户端用例后，转写包与 session-controller 共 **1103 项测试全绿**，新增文件保持 100% 覆盖。

## 5. 工程质量与门禁

- `test:docs` 恢复 21/21 全绿（补齐两个 README 的规范要求；把会触发引用门禁的 `FORK_DEBT_AUDIT.md` 移出仓库到 `~/Documents/`）。
- 目录生成物（client/cordis/工具目录）、`verify-upstream-intake`、`verify-client-ui-i18n`、`verify-translation-pairing`、`verify-no-unknown-casts` 全绿；`verify-export-jsdoc` 仅剩 3 处上游 `connection-process` 的历史缺口（未登记的路径不改）。
- 新增/改动的 fork 面全部在已登记路径内；上游 speech 相关文件与默认值一字未动。

## 6. 已知边界

- 转写输出：**暂无说话人标签与时间戳**（当前引擎纯文本）；超长文件（>120 分钟）需抬上限或后续加分块参数。
- 入口上传上限 64MiB（`maxUploadMiB` 可配，但受 wire 常量封顶）；更大的录音可放进工作区后直接在对话里让它转写。
- macOS 上无需 FFmpeg；其他平台解码回退到 ffmpeg。
- 三个提交尚未推送远端（fork + Gitee 镜像）。

## 7. 下一步（待定项）

1. **时间戳**：成本 0.5–1 天（VAD 段边界已具备，只需保留并输出）；**分块参数**：顺手（超长文件多次调用）；**说话人分离**：独立项 3–5 天（pyannote 分割 + 声纹嵌入 + 聚类对齐，2–4 人访谈/会议可用，长会议需调参）。待排期。
2. **与 octopus_studio 的边界**：建议各自演进、共享"公益能力包"（技能与提示词、数据源适配、本地音视频流水线、脱敏规则），或进一步定位为「Studio 服务端 + DSH 本地端」互补。待定方向。
3. **VibeVoice 复评条件**：上游修复长音频内存、更强硬件（M4 Max/32GB+）、或明确授权修改引擎做分块。工具侧已 provider 无关，接入零改动。
4. **推送**：确认后推 fork 与 Gitee 镜像。

## 8. 参考

- 方案与 P0 实测：[2026-10-09-vibevoice-asr-provider.md](./2026-10-09-vibevoice-asr-provider.md)（附录 B 为实测结论与回退落地验证）。
- 完整 spike 证据（逐次命令、sha256、日志）：`/private/var/folders/h2/bxwgfbt15zg3gz5hf37bhf2w0000gn/T/opencode/vibevoice-spike/REPORT.md`。
- 交付产物：`dist/octopus_DSH.dmg`；真机测试录音与文字稿样例：`~/cloudbase/recordings/`。
