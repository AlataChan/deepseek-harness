# VibeVoice-ASR 本地转写插件 · 方案（待审批）

Mode: feature proposal
Created: 2026-10-09
Architect: Cla（起草，供主人审批）
Status: **提案（待审批）**；审批通过后进入 P0 spike，未批准前不写产品代码。

**审批记录（2026-10-09，主人）**

- D1 **通过**（条件：不改上游）——新包 + fork 自有播种行 + intake 登记。
- D2 **通过**（条件：无兼容问题）——已核实官方配置页对 provider 全量数据驱动渲染；残余兼容风险仅为上游改版该页的展示，属显示级、不阻断功能。
- D3 **采纳建议**——先 P0 spike（go/no-go），再进 P1。
- D4 **通过**（不做 TTS）——v1 边界按 §3；另见 **附录 A**（媒体创作入口恢复，新增问题）。
- D5 **通过**——回退=只做 SenseVoice 长录音入口 + 技能，摘掉 VibeVoice 包即回退。

依据（2026-10-09 实测核对）：VibeVoice / VibeASR.cpp 上游仓库与基准报告；本仓 `speech-to-text` 能力层、`speech-to-text-sensevoice`、`client-ui-voice-input` 源码。

---

## 0. 一句话

新增一个**只注册、不改上游**的本地转写 provider（VibeVoice-ASR-BitNet，CPU、1.58GB 模型、首次使用按需下载），配置直接复用官方「语音输入」页；配套一个"长录音转写"工具与公益「录音转纪要」技能。**上游的 SenseVoice、默认值、任何 speech 相关文件一个字不动。**

**配置入口结论（主人问的核心问题）**：不需要新开任何入口——官方「语音输入」页的「识别服务」下拉与准备卡是**按 provider 注册数据全量渲染**的，我们的 provider 注册后自动出现在同一页，选中即显示它自己的下载/预估/准备界面。我们插件自身在"插件"列表只是一行普通条目，不需要自建页面。

---

## 1. 目标与非目标

**目标**

1. 让公益项目助手直接消费"录音"（访谈、活动、会议），产出文字稿与纪要；全程本地，未脱敏录音不出机器（对齐课程数据分级：L3/L4 不上云、"先转写，再脱敏"）。
2. 以最小差异面接入：只新增 fork 自有包，不修改上游任何 speech / 客户端文件。

**非目标（v1 不做）**

- TTS / 语音播报（上游已撤下 VibeVoice-TTS-1.5B 代码；Realtime-0.5B 不在本期范围）。
- 云端转写、声纹库、多模型自动路由。
- 修改上游默认 provider、修改 seam 接口、给 seam 加热词字段。

---

## 2. 现状（已核实的机制）

| 层 | 事实 |
|---|---|
| 能力层 | `@deepseek-ai/dsh-experimental-speech-to-text`：provider 注册表；`SpeechProvider` 接口 = `info` + `preparation` + `transcribe`；支持 `location: 'host-local'` |
| 已有 provider | `speech-to-text-sensevoice`：sherpa-onnx 子进程；模型/运行时按需下载、sha256 固定、下载源多选；`inject: ['speechToText', 'subprocess']` |
| 配置页 | 客户端 `client-ui-voice-input` 在 `plugins.bundle.config`（key = `@deepseek-ai/dsh-experimental-voice-input-bundle`）注册 `VoicePreparation`；该组件把 **catalog.providers 全量**渲染为「识别服务」下拉 + 每 provider 一张准备卡（硬盘/内存/首次准备估算、下载源、下载并准备）。**纯数据驱动** |
| 深链 | `pluginNavigation.openBundle('@deepseek-ai/dsh-experimental-voice-input-bundle')`（语音输入按钮"打开设置"已在用） |
| 发货路径 | `voice-input-bundle` 随桌面默认面板发货；fork 侧插件走 `scripts/desktop-profile-plugins.json` 播种（desktop-media 先例），打包门禁要求插件为 `dsh.bundle` + `dsh.client` 双面 |

---

## 3. 方案

### 3.1 包与位置

- 新包：`packages/experimental/desktop-speech-vibevoice/`；npm 名 `@deepseek-ai/dsh-experimental-desktop-speech-vibevoice`（fork overlay；上游不存在此包 → 新增文件零冲突）。
- 双面结构：
  - **Host 面**：provider 注册 + 运行时资产管理 + 长录音工具；
  - **客户端面**：空 `apply`（仅为满足播种门禁的双面要求），**不新增任何 UI**。
- 播种：`scripts/desktop-profile-plugins.json` 加一行（fork 自有文件）。

### 3.2 Provider 注册（Host）

- `inject: ['speechToText', 'subprocess']`。
- 注册项：id `vibevoice-asr-bitnet`；显示名 `VibeVoice-ASR-BitNet (CPU)`；`location: 'host-local'`；语言 `auto / zh / en / …`（按模型支持裁剪展示）。
- 准备（preparation）：
  - 运行时：**预编译 `asr_infer` 二进制**（darwin-arm64，随包携带，约几 MB，adhoc 签名）；
  - 模型：VAE 0.65GB + LM 0.92GB GGUF（首次下载，sha256 固定，HF 官方源 + 国内镜像）；
  - `setupEstimate`：磁盘约 2GB、内存约 2GB、首次准备 5–30 分钟。
- 子进程：照 SenseVoice 的 loopback HTTP 模式（token 鉴权、串行推理、闲置释放内存）。
- **默认值不动**：`defaultProvider` 保持上游现状（SenseVoice）。

### 3.3 配置入口（本方案重点回答）

**打开路径不变**：插件 → 语音输入 → 「识别服务」下拉自动多出 `VibeVoice-ASR-BitNet (CPU)`；选中后页面下方自动出现*它自己的*准备卡（估算 / 下载源 / 下载并准备）。原因：官方 `VoicePreparation` 对 `catalog.providers` 做全量渲染，我们只是多注册了一个 provider。

- 我们的插件在"插件"列表里是独立一行（可开关），**自身没有配置页**——配置全部寄生在官方语音输入页，不需要用户知道我们插件的存在。
- 引导增强（可选）：将来「录音转纪要」相关入口在检测到模型未准备时，给中文提示并**一键深链**到该页（复用 `openBundle`）。
- 明确不采用（备选否决）：自建 `plugins.bundle.config` 页或独立 `settings.section`——与官方页重复、两份真相源、扩大差异面。

### 3.4 长录音入口（工具）

- 新增 Host 侧 model-visible 工具（暂名 `speech_transcribe`）：输入=工作区内音频文件路径（+ 可选 provider / 语言 / 热词）；Host 直接读文件 → 必要时解码 → 调用 speech seam → 产出文字稿文件（写到音频同目录，如 `<name>.transcript.md`；带说话人与时间戳）→ 返回**有界摘要 + 文件路径**（大文本走溢写与分块读取，避免灌爆上下文）。
- 走工具而不是新 UI 的理由：录音本来就躺在工作区；"对话指挥"是既定交互；v1 零新增 UI。
- v1 限制：单文件 ≤ 60 分钟（模型单次上限），更长录音分段调用（P2 评估）。

### 3.5 技能（公益预设，fork 自有包）

- 新增 `env-ngo-audio-minutes`（录音转纪要）：触发=用户给出录音或提出"把录音转成纪要"；流程=调用 `speech_transcribe` → 按议题分段 → 生成纪要（决议 / 待办 / 引用）→ 按 `env-ngo-story-desensitize` 规则脱敏 → 输出。
- 交叉引用：`env-ngo-case-extract`、`env-ngo-story-desensitize` 的 When To Use 各补一句"输入为录音时先行转写"。

### 3.6 音频格式与解码

- WAV 直通；**m4a / mp3 依赖 FFmpeg 解码**（检测到则自动转 16k 单声道 WAV；未检测到给中文引导，文案模式复用媒体预检）。
- 课程 Demo 录音即 m4a，此路径 P0 必须验证。
- 备选（P2 评估）：内置轻量解码（wasm）；v1 不引入。

### 3.7 分发与体积

- DMG 增量：二进制几 MB（纳入 build-dmg 的 adhoc 签名清单：node / kb-runtime / 本二进制）。
- **模型不进包**：1.58GB 首次下载，走既有"下载并准备"UI（HF + 国内镜像、断点与校验照 SenseVoice 资产模式）。
- 许可与合规：VibeASR.cpp 仓库 MIT；`microsoft/VibeVoice-ASR-BitNet` 模型卡许可需逐条核对后落记录；随包附 LICENSE / SOURCE.txt（对齐 kb-runtime 现有门禁规则）。

---

## 4. 上游冲突与登记（"零冲突面"的边界）

- **不修改**：`speech-to-text`、`api-speech-to-text`、`speech-to-text-sensevoice`、`client-ui-voice-input`、`app-boot profile`、任何默认值。
- **只新增**：新包（新目录）+ `scripts/desktop-profile-plugins.json` 一行（fork 自有）+ `scripts/upstream-intake-registry.ts` 登记（新增包；播种行）。
- 上游 hop 时，验证器只需核对这两条登记；`git diff` 不出现任何上游 speech / 客户端文件。

---

## 5. 风险与未决点

| # | 项 | 说明 | 处置 |
|---|---|---|---|
| R1 | macOS 二进制 | 需本机 clang 编译、预编译分发；签名与 DMG adhoc 流程对齐 | P0 验证 |
| R2 | 模型许可 | HF 模型卡许可未逐条核对 | P0 核对并落记录 |
| R3 | 长音频耗时/内存 | 60 分钟单次推理在目标机型（M 系 / 8GB 级）实测 | P0 出实测表 |
| R4 | m4a / mp3 解码 | 未装 FFmpeg 的用户路径 | 3.6 方案 + 中文引导 |
| R5 | 上游 seam 漂移 | `SpeechProvider` 接口未来可能调整 | 独立包，漂移只改我们一侧；intake 登记盯防 |
| R6 | 模型删除入口 | 官方准备卡暂无"删除" | v1 文档给手动路径；v2 视上游 |
| R7 | 热词透传 | 模型支持热词，seam 无此字段 | v1 走工具参数透传；不做 seam 扩展 |

---

## 6. 验收标准（可检验）

1. 未装模型：官方页出现 VibeVoice 选项与正确估算 / 下载源；"下载并准备"可完成并进入 ready。
2. 装好后：`speech_transcribe` 能把课程真实录音（≥30 分钟）转出带说话人 + 时间戳的文字稿文件；抽样 20 句人评准确率可接受。
3. 技能：对录音说"转成纪要"→ 产出结构化纪要（含待办）且已脱敏。
4. 回归：未装 VibeVoice 的机器上，语音输入与 SenseVoice 行为与现状一致；默认 provider 未变。
5. 打包：DMG 体积增量 < 10MB；`verify-desktop-bundle` 新增检查（插件存在、二进制可执行、模型不入包）；intake gate 通过。
6. 冲突面：`git diff` 不含任何上游 speech / 客户端文件。

---

## 7. 里程碑

| 阶段 | 内容 | 预估 |
|---|---|---|
| P0 spike | 本机编译 `asr_infer` + 下模型 + 真实录音实测（中文质量 / 说话人 / 时间戳 / RTF / 内存 / 许可）→ **go/no-go** | 0.5–1 天 |
| P1 provider 包 | 照 SenseVoice 结构：config / 资产与校验 / 子进程 / 准备状态；单测 | 2–3 天 |
| P2 工具与技能 | `speech_transcribe` + 落盘 + `env-ngo-audio-minutes` + 交叉引用 | 1–2 天 |
| P3 打包与验证 | 剪入 DMG、验收清单、intake 登记、文档更新 | 0.5–1 天 |

---

## 8. 回退与替代

- **go/no-go 不过** → 只做"SenseVoice 长录音入口 + 技能"（P2 的工具改调现有 provider）；VibeVoice 包停用即回退（摘掉播种一行），无残留。
- **替代路线**（备查）：sherpa-onnx 同引擎的说话人分离模型（不新增引擎，但要自建分离流水线）——复杂度介于两者之间，暂不优选。

---

## 附：关键数据（来源：VibeASR.cpp README，2026-10-09 读取）

- 模型体积：VibeVoice-ASR-7B (FP16) 4.62GB → **BitNet 1.58GB**（VAE 0.65 + LM 0.92；LM 换成 Qwen2.5-1.5B）。
- Apple M4 实测 RTF：1T 0.63 / 2T 0.35 / 4T 0.21 / 8T 0.20（实时）。
- 中文对比：Fleurs-zh 8.35（SenseVoice 5.56）、AISHELL4 27.45（SenseVoice 22.52）——中文短句 SenseVoice 更强；
- 英文会议：AMI-ihm 21.36（SenseVoice 30.81）——VibeVoice 的增量在**长音频 + 说话人 + 时间戳 + 热词**，不是中文正文识别。

---

## 附录 A：媒体创作入口恢复（「做视频 / 做配音 / 克隆声音」按钮不可见）

**现象（主人报告）**：新构建的版本里，三个创作按钮看不见了。

**已核实（2026-10-09）**：

- 按钮代码与文案**仍在构建产物中**：`profile-plugins/desktop-media/lib/client.js` 含 `做视频`、`conversation.input.left`；打包门禁通过。
- 注册位置：`conversation.input.left`（"输入框工具行左侧的紧凑控件"，list、session 作用域）。
- 当前上游 `InputBar` 只在 `input !== undefined && sessionId !== undefined` 时渲染该槽位 → **新会话 / "先选工作文件夹"（hero）状态下该槽位不渲染**；主人提供的截图均为该状态。

**先用 1 分钟验证（决定性质）**：打开一个已有会话（如"配音创作技能流程指引"），看输入框左侧是否出现三个按钮。

- 出现 → 性质=**入口可见性问题**（只在会话内可见、hero 不可见），按下方入口方案处理。
- 仍不出现 → 性质=**渲染回归**，按 bug 流程排查（`slots.inject` 触发、entry inject、客户端加载顺序），排查时以 `conversation.input.dock` 的 1.5s 可见性做对照。

**入口方案（供选择，均不修改上游文件）**：

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **1（推荐）创作条** | 用上游已声明的 list 槽 `conversation.input.dock`（"输入框上方整宽条目"，语义就是给插件加的）挂一条「创作」条：做视频 / 做配音 / 克隆声音（未来可含"转写录音"） | 上游 list 槽、任意包可注册、**hero 状态也可见**、一键触达、零上游冲突；与 GoalBar / Todo / 问知识 dock 同一家族 | 占一行纵向空间；需与问知识 dock 的展示顺序协调 |
| 2 hero chip | 在 hero 行（与 问数/问知识/专项助手 同排）加「创作」chip + 菜单 | 一级入口、离用户最近 | hero 槽位是上游固定 single 键且大部分已占用，需要占用一个语义不符的键或自建聚合层，成本/风险高 |
| 3 作品面板按钮 | 在"作品"面板头部加"新建视频 / 新建配音" | 面板原本就是媒体主页；空态文案已在引用这两个按钮 | 面板是二级面；空态文案需同步改 |

**根因（2026-10-09 07:5x 定位）**：`conversation` 服务在 ui-conversation 里**先于**槽声明出现（`ConversationController` 在 apply 尾部挂载，而声明 `conversation.input.dock` 的 composer bar 要等 `main` 槽出现后才注册）。此前的注册路径只等"服务就绪"就注册，注册时槽还不存在 → 框架静默丢弃（`slots.inject` 的延迟失败会永久注销；service-only 等待则在回调里抛"槽未声明"）。这就是"按钮消失"与"dock 不显示"两个症状的共同原因。

**修复（2026-10-09 07:55 构建）**：注册改为**双重等待**——外层等 `conversation`+`sessions` 服务、内层用 `slots.inject('conversation.input.dock', ...)` 等槽声明本身；并加了一条**临时自检标签**（"媒体入口自检（临时）"，order 5）用于下一次装机判定：两者都出现=已修复（下个构建移除自检标签）；只出现自检=组件渲染问题；都不出现=注册仍未生效。新增时序回归测试（声明晚于 apply 到达时条目仍须注册）。默认 provider 与上游文件均未改动。

**建议（已实施，2026-10-09 07:13 构建）**：采用**方案 1**——三个创作按钮（做视频 / 做配音 / 克隆声音）迁到 `conversation.input.dock` 的「创作条」（与"问知识"条同一浮条家族；该面在主人机器上已被"问知识"条证明可见，含"先选工作文件夹"的新会话页）。旧 `conversation.input.left` 注册已移除。打包门禁新增：媒体客户端必须包含 `conversation.input.dock`。

**后续（2026-10-09 08:54 构建，已取代上面的创作条）**：按主人要求，把「问数据 / 问知识 / 做视频 / 做配音 / 克隆声音」合并为 hero 行的「专业能力」下拉菜单（复用被腾出的 `conversation.hero.askData` 槽位；条目由各包通过 fork 自有槽位 `conversation.hero.capabilities.item` 贡献，零上游改动）。创作条与自检/崩溃探针已全部移除；「问数」完成全量改名「问数据」（UI 文案、提示词、sidecar 报错文案、模板文件名、两包文档与测试）。

**与本方案的关系**：附录 A 是主人本轮提出的独立问题；创作入口已按「专业能力」菜单方案落地，本 provider 方案无耦合。
