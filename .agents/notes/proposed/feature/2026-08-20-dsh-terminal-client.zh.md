# Agent Note：先建设 dsh 第一方终端客户端，再建设 Tauri 桌面壳

Status: proposed

[English](2026-08-20-dsh-terminal-client.md) | 中文

## 问题

`dsh` 已经有第一方 headless、Web、VS Code、ACP 和 JSON-RPC 产品面，但裸命令还不能打开交互式终端客户端。用户必须显式选择实现 profile，或者离开终端使用浏览器与编辑器产品面。

仓库之前删除了旧 TUI，因为它没有命名部署、没有持续维护的包边界、没有具体交互 provider，也没有组装后的转录与生命周期验收。恢复那些源码还会同时恢复已经移除的终端渲染器依赖和旧集成假设，不能建立当前的产品面。

接下来的产品顺序是先终端、后桌面。终端产品面必须仍然是普通 CLI，在 Cordis 同一进程中运行，保留 shell 滚动历史，通过不依赖 shell shim 或额外文件描述符协议的方式支持 Windows，并真正提供审批与用户提问能力，不能让 Agent 因为没有回答器而 fail-closed。之后的桌面应用使用 Tauri 而不是 Electron，但桌面需求不能扭曲终端设计。

## 提案

新增第一方 `tui` profile，由 `@deepseek-ai/dsh-base` 和新的 `@deepseek-ai/dsh-tui-app` bundle 组成。该 bundle 挂载 `@deepseek-ai/dsh-tui`，这是一个仅 Node 使用的交互插件，通过现有进程内 Cordis 服务创建或恢复一个顶层 Agent。

TUI 使用 Ink 7 作为终端渲染器，并把 React 19.2 或更高版本作为 Ink 的包内渲染依赖。Ink 7 要求 Node 22 与 React 19.2，前者符合仓库的 Node 最低版本，后者要求 TUI 包与浏览器 Client aggregate 的 React 依赖保持隔离。TUI 不组合 `dsh-client-app`、Host RPC、HTTP 服务、WebSocket 或浏览器运行时。

TUI 的权威应用状态是一个不依赖框架的 TypeScript store。纯 reducer 和 selector 消费自有 action 与 Session event；Cordis adapter 产生这些 action；Ink 通过狭窄的 React adapter 订阅。React 组件不会在 store 之外单独持有 Session、审批、问题、命令或草稿真相。

TUI 验收标准通过之后，可以通过单独的 Agent Note 与实施计划，在现有 React client 与 Node Harness companion 外增加 Tauri 2 桌面壳。该桌面壳可以复用 Web 和 VS Code 已经建立的交互 Host API 与 carrier 工作，但不会复用 Ink 组件，也不会把 TUI state store 变成跨产品面的协议。

## 产品命令约定

`dsh` 在当前工作目录中创建新会话并启动交互式 TUI。

`dsh "task"` 启动交互式 TUI，创建新会话，并在应用就绪后自动提交合并后的定位参数任务。

`dsh --resume` 进入 TUI 会话选择器。`dsh --resume <id>` 恢复指定持久化会话。第一版中，resume 选项和初始任务互斥。

`dsh tui` 是同一个 TUI profile 的显式别名。`dsh exec "task"` 是现有 headless profile 面向自动化的别名。`dsh web`、`dsh plugin` 与 `dsh --profile <name>` 保留。若任务本身等于保留子命令，则通过 `--` 传入，例如 `dsh -- web`。

裸 `dsh` 与 `dsh tui` 要求 stdin 和 stdout 都是交互式 TTY。非 TTY 调用以 usage error 退出并明确提示 `dsh exec`；它不会静默改变输出格式，也不会在管道上启动交互渲染器。

launcher 继续只拥有 profile 选择、patch、dump 与别名。`tui-app` startup 插件拥有 `--resume`、可选任务位置参数、应用帮助与校验，沿用现有 `cmdlineArgs` provider 模式。

只有完全由 `dsh -h` 或 `dsh --help` 组成的调用才打印 launcher help。一旦存在任务或应用 token，help token 就属于所选应用，即使它位于位置任务之前。Launcher version flag 继续由 launcher 拥有，config dump 拒绝应用参数。

## 包与组合边界

新增 `packages/ui/tui` 作为 Node 终端呈现组，并在包层级中记录新的 `ui/` group。该包拥有终端输入、终端安全渲染、state store、单 Agent controller，以及审批与用户问题 adapter。它只依赖 Service Definition 与呈现类型，不依赖具体 LLM、持久化、shell、文件系统或沙箱 provider。

新增 `packages/bundle/tui-app` 作为 profile patch carrier 与启动参数 provider。它的 patch 在 `dsh-base` 上应用 TUI 专属 persona 与工具呈现值；在 TUI remount 行为得到证明之前关闭共享 HMR；在已配置工具模式需要时挂载 worker-thread code runtime；并挂载 startup provider 与 TUI 插件。

在已发布 profile template 中增加 `tui: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-tui-app']`。把精确的 base-only `tui` tuple 视为 installation-owned，使 TUI 发布前初始化的 profile 规范化为当前 template；任何带用户新增 bundle 的 tuple 都保持不变。CLI 安装包依赖这两个新包，确保已安装 profile 的解析不依赖仅 workspace 可用的路径别名。

每个新包都提供 `./invariant` companion。TUI invariant 只检查包自有的运行关系，例如一个已挂载 TUI controller 至多拥有一个根 Agent 和一个活跃交互 provider；它不会断言固定组件输出，也不会重复断言 injection 已经保证存在的服务。

## 进程内运行时

controller 在创建或恢复 Agent 前等待 Loader 完成 settlement。新建流程读取 `ctx.agentDefaultModel.currentSelection()`，以当前工作目录创建随机 branded Session id，并在 Agent setup 中通过 `installModelSelection()` 安装模型选择。恢复流程对选中的持久化 id 调用 `ctx.agents.resume()`，并通过已有的已记录选择机制恢复模型，然后才接收输入。

会话选择器通过 `ctx.sessionQuery.listSessions()` 取得按新到旧排序的身份，并通过一次有界 `readTitleSnapshots()` 批量解析标题。选择器上限是插件配置，而不是写死的呈现参数。单个标题读取失败时，该行仍可用 id 与 workspace 显示；语料列表读取失败则属于启动错误。

controller 为自己的准确 Agent 订阅 scoped `session/event`，并把已提交事件折叠到 state store。它通过 `agent.followup(createUserMessage(...))` 发送用户文本，通过 `agent.cancel({ kind: 'user' })` 中断活跃工作，在所有权切换时等待 `agent.whenIdle()`，并在正常退出前通过 `ctx.sessions.flush()` 完成持久化。

斜杠命令优先通过 `ctx.commands.execute()` 解析。TUI 本地命令仅限 `/help`、`/resume`、`/exit` 等呈现与导航操作，不复制领域命令。未知斜杠输入只有在用户确认后才作为普通用户消息发送，避免命令拼写错误静默进入模型。

## 不依赖框架的状态核心

state store 包含活跃 Session 身份、不可变转录行、一个实时 assistant 草稿、composer 文本、状态、一个 overlay 判别联合、待处理审批或问题的所有权，以及终端尺寸。State action 命名外部事实，例如已提交 Session event、输入按键、resize、交互请求、交互结算与运行时 dispose。

Reducer、event projection、显示消毒、截断与 selector 都是纯同步模块。它们不导入 Cordis、React、Ink、process 全局、timer 或 wall clock。调用方显式提供时间与终端尺寸。封闭的本地联合以 `assertNever` 结束；merge-extensible Session event 联合使用带说明的 default：除非事件是必须通用回退的 surface event，否则不产生专用行。

store 暴露 `getSnapshot()`、`subscribe()` 与 `dispatch()`。Ink 使用 `useSyncExternalStore`；组件不会通过 `useState` 镜像权威状态。组件瞬时状态仅限不会跨组件卸载保留的 focus 机制，并且不能影响待处理决策或草稿。

## 转录与渲染

UI 以转录为中心，默认不进入终端 alternate screen。已完成转录行通过 Ink `Static` 组件渲染，成为普通 shell scrollback。只有当前流式 assistant 行、状态行、composer 与活跃 overlay 留在 Ink 重绘区域。

恢复会话时，controller 为正确性折叠完整持久化日志，但只把配置指定的最近转录行窗口写入终端 scrollback。若存在更早行，则打印明确的历史省略标记。该上限、选择器上限和工具输出显示预算都是经过校验的 TUI 配置字段；协议规则与终端安全规则保持固定 invariant。

文本渲染接收 Markdown 内容，但第一版采用确定性的终端子集：段落、列表、标题、围栏代码、行内代码，以及以可见标签加 URL 方式显示的链接。不支持的 Markdown 降级为可读文本。渲染绝不执行 OSC hyperlink 或模型提供的 ANSI。

任何模型、工具、标题、命令和错误字符串在进入 Ink 前都必须通过唯一的 `displayText` 函数。该函数保留允许的换行与 tab 布局，把 C0/C1 控制符与转义序列替换为可见安全文本，消除双向文本控制，并根据调用方的字节或列预算截断且不切断 Unicode grapheme。

工具行通过 `ctx.tools.get(toolName, agent)` 解析准确可见的定义，再使用持久化参数、content、错误状态和 presentation metadata 调用其纯 `presentCall` 与 `presentResult` 投影。renderer 对 `card` 判别：`terminal`、`diff`、`read`、`search` 与 `web` 使用紧凑终端呈现；`generic` 和未来未知 result card 使用安全通用回退。TUI 不会执行工具内容，也不会为了丰富卡片而读取 workspace 文件。

## 输入与交互

Enter 提交非空 composer。Ctrl+J 插入换行。Escape 关闭活跃的非阻塞 overlay。Ctrl+C 在 turn 活跃时取消；idle 且草稿非空时清空草稿；idle 且草稿为空时请求正常退出。Ctrl+R 只在没有 turn 或人工决策活跃时打开 resume 选择器。

编辑器行为是对文本、光标、无选择移动、插入、删除与历史 action 的纯 reducer。第一版支持 Unicode 文本、多行草稿、左右/Home/End 移动、Backspace/Delete 与粘贴。图片附件、鼠标输入与全屏编辑器延期。

TUI 注册一个 scoped `approval/request` waterfall answerer。它只认领其准确根 Agent 的请求，显示工具名、call 关联与 reason，并解析为 `allowed-once`、`rejected` 或 `cancelled`。其他 Agent 的请求调用 `next()`。关闭 UI 或取消所属 turn 时，会在不授权的前提下结算可见请求。

TUI 注册唯一的 `ctx.userQuestions` provider。它显示每个问题、选项、自由输入许可与评审 detail，在本地校验完整答案，并且仅在所有必答项完成后解析。abort 会移除面板并使用服务的取消语义拒绝。待处理审批与问题存放在 store，因此 Ink remount 不会丢失它们。

## 生命周期与平台行为

TUI 通过可注入 process adapter 接收 stdin、stdout、stderr、环境事实、终端尺寸与正常退出请求。生产环境使用真实 Node stream；测试使用确定性的 TTY stream，不增加仅测试环境变量开关。进程级 SIGINT 与 SIGTERM 继续由共享 profile launcher 拥有；raw mode 中的 Ctrl+C 是由 TUI 拥有的输入字节。

只有在已挂载 controller 活跃期间，Ink 才拥有 raw-mode 切换。setup 失败、正常退出、stdin 关闭，以及 launcher 在 SIGINT 或 SIGTERM 后拥有的 root disposal 都汇入一个幂等 cleanup 路径：停止接收输入，结算或取消活跃交互，取消并 drain Agent，flush Session，卸载 Ink并恢复终端状态。用户发起的正常退出在 cleanup 后请求 `ctx.appExit`；owner disposal 执行相同 cleanup，但不递归请求另一次退出。

实现不使用 shell shim、额外 stdio 文件描述符、仅 Unix 可用的 signal 假设或文件系统锁。Windows 与 macOS、Linux 一样运行同一个 Node 入口和 libuv stdio stream。平台专属 shell 工具仍由 base profile 选择。

两个 TUI 进程可以打开同一个 workspace，因为 workspace identity 不是 session identity。除非对同一个精确会话执行 resume 并与活跃进程冲突，否则它们各自使用独立新 Session；现有 persistence 与 Agent registration 的冲突行为保持权威。TUI 不新增 workspace 范围的进程锁。

## 测试与发布顺序

纯 state、editor、sanitizer、transcript projection、tool-card projection 与键盘策略使用表驱动单元测试。运行时测试使用真实 Cordis Service Definition，仅对 provider 行为使用狭窄 fake，并验证创建、恢复、命令分派、取消、审批、问题、flush 与 teardown 顺序。

Loader composition 测试启动真实 `base + tui-app` patch list，证明 startup service、TUI row、交互 provider、Agent 生命周期与 invariant companion。CLI parser 测试覆盖别名、保留位置参数逃逸、应用参数转发、config dump 与非 TTY 提示。Windows CI lane 不通过 `.cmd` 或 shell 调用，直接运行 parser 与可注入终端集成测试。

真实可运行 TUI example 下的三个聚焦 keyless 组装快照，使用确定性 TTY stream 与相互独立的 LLM replay fixture 驱动已挂载 Ink 应用。Transcript scenario 覆盖初始任务提交、流式 assistant 文本与 terminal 工具卡；interaction scenario 覆盖审批、用户问题、命令与 balanced persistence；lifecycle scenario 覆盖取消、干净退出与终端恢复。每个 fixture 都可在 macOS 与 Linux 回放；Windows lane 运行等价断言，但不拥有 golden ANSI 转录。

第一版 gate 是交互式终端产品，而不是桌面壳。通过后，桌面设计从 Tauri 2、现有 React client 和 Node companion 开始；签名、updater channel、安装包身份、sidecar 打包、WebView 兼容性与不依赖 marketplace 的分发都需要自己的决策记录与验收套件。

## 考虑过的替代方案

### 恢复已删除的 TUI

拒绝。它会恢复已经移除的渲染器与删除前集成模型，而当前仓库已经提供更强的 Session、命令、呈现、审批和问题 seam，应当直接消费这些能力。

### 通过 HTTP 与 WebSocket 的外部 TUI

不作为第一方产品。外部原型已经验证交互需求，但它依赖内部 Host API，需要第二个进程与端口，并重复实现进程内客户端不需要的重连行为。

### 全屏 alternate-screen TUI

不作为默认。它会隐藏普通滚动历史，使终端输出更难组合。未来可选全屏模式需要独立的导航与生命周期验收。

### 在终端之前建设浏览器壳或 Tauri

延期。现有 Web 和 VS Code 产品面已经覆盖图形使用。终端以更少的打包与身份工作补齐缺失的 `dsh` 命令体验，也能为之后的桌面 companion 再提供一套经过验证的交互生命周期。

### Electron 桌面

拒绝。它会重复打包 Tauri 系统 WebView 已经提供的 Chromium 能力，也不符合轻量分发目标。

## 验收标准

- `dsh`、`dsh "task"`、`dsh --resume`、`dsh --resume <id>`、`dsh tui` 与 `dsh exec "task"` 实现产品命令约定，现有 profile、Web、plugin 与 config dump 路径行为不变。
- 已发布 `tui` profile 精确等于 `dsh-base + dsh-tui-app`；它不打开网络监听器，也不组合 Host RPC 或浏览器 Client runtime。
- 一个不依赖框架的 store 拥有草稿、转录状态、overlay、审批与问题；Ink 只是 renderer subscriber。
- 已完成行进入普通 scrollback，活跃输出原地更新，恢复历史以明确省略标记有界显示，所有不可信显示文本都满足终端安全要求。
- 新建与恢复会话都能完成多轮对话、运行并呈现工具、执行已注册斜杠命令、取消工作、回答审批、回答用户问题、flush，并且退出后不残留 raw mode。
- 单元、Loader composition、CLI integration、聚焦 keyless 组装转录快照与 Windows 可注入终端测试在仓库支持的 Node 版本上通过；每个新源码文件继续满足逐文件覆盖率 gate。
- Root agent instruction、package README、group index、CLI help、用户文档、module graph、依赖 lockfile、invariant 与本 Agent Note 保持同步。
- TUI 实施 stack 不落入 Tauri 或桌面打包代码；桌面工作只能从单独批准的计划开始。

## 风险

Ink 7 要求 React 19.2，而浏览器 Client package 当前使用 React 18。让 TUI 留在 Host aggregate，并只在 TUI 包中声明 React，可以避免共享 renderer graph，但 workspace 依赖去重和类型解析仍必须显式测试。

Ink `Static` 在近期 7.x 版本中修复过 identity change 与 remount 问题。实现必须锁定经过验证的 7.x 版本，在一个 controller 内保持已完成行 key 单调，并测试 remount 与 shutdown，不能依赖 renderer 内部行为。

即使终端输出有界，恢复长日志时 Agent resume 仍需加载完整日志。显示上限只控制终端洪泛，不控制 persistence 内存或 resume 延迟。

不同终端的按键编码存在差异。只有 input adapter 能保留 line-feed 与 carriage-return 区别时，Ctrl+J 才能与 Enter 区分；在真实 Ink input event 的键盘集成测试通过之前，不能把该快捷键视为稳定约定。

对 merge-extensible Session event 的通用处理可能隐藏一个新 model-visible event，前提是其所属 package 忘记提供呈现。当新事件会实质影响终端用户时，快照与 package 文档必须把专用 TUI 呈现作为功能设计的一部分。

后续 Tauri 壳会增加代码签名、updater trust、WebView 差异与 Node sidecar 打包风险。延期能让这些风险不进入终端发布，但不会消除它们。
