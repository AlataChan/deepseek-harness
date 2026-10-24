# DSH 交互式终端 TUI 实施方案

状态：修订 v3，待复核，尚未锁定。权威版本为本文件；见 [任务状态](task_plan.md) 与 [评审处置](review-round2-response.md)。T0 尚未执行，不表示 TUI 已实现或可启动。

基线：2026-10-24，commit 本次方案提交的父版本（fix(ci): allow Windows installer qualification to finish）。本方案与 IM、多租户及远程 Worker 独立交付，不依赖它们。

目标：为 SSH/本地终端用户提供单用户、多轮、可恢复、具备明确审批与问题交互的 dsh 前端。现有 CLI 仍负责 profile 启动与插件管理；不创建绕过 dsh 的应用 bin。

## 1. 现状与旧方案处理

当前 app-boot 没有已预留可用的 tui profile。`dsh --profile tui` 是本方案完成后拟提供的入口，不是现在可用的命令。现有 `TUI_PLAN.md` 记录了 2026-08 的外部客户端试验，含当时的 events.mux、history 等接口；旧记录保持原样，不能将其视为当前 API 验证结果或已批准的实现。

当前 ACP 面向自动化，刻意不提供完整 DSH 交互展示；TypeScript SDK 的 server-to-client request 回答流程也未实现。因此第一版不依赖 ACP/SDK 承担用户提问与审批，不恢复旧协议，不从 private lib 或历史产物导入运行时。

已存在且可复用的能力包括 `ctx.agents.create/resume` 与 AgentHandle、session-persistence/session-query、user-approval、user-questions、模型目录及选择机制。具体方法与 payload 在任务 T0 中按当前 source 编译确认；不能把旧方案里的命令直接复制进新实现。

## 2. 产品范围

第一版支持：创建/恢复一个活动会话，多轮文本输入，提交前编辑，流式答案，工具执行状态与有界输出，取消任务，问题选择和审批确认，模型/推理力度选择，会话列表，以及正常/异常退出后恢复终端。

第一版不支持：多租户服务器、远程 Web Host 客户端、ACP 桥接、多人共享审批、终端内图片/浏览器、任意自定义 slash 执行、团队拓扑图、内嵌 shell、语音、剪贴板自动读取、附件上传、导出/分叉/压缩命令或完整 Markdown 编辑器。后续需求单独增加，不将未实现命令显示成可用。

界面默认中文并支持英文，所有 UI 文案由 typed locale dictionary 管理；用户消息、路径、工具内容与模型名称保持原文。用户必须能看清当前会话、工作区、模型和运行/待确认状态。

## 3. 选定架构

采用同进程 Cordis TUI 插件及专用 bundle/profile，不启动 Web 服务，不监听端口，不挂载 Web 客户端或修改 Tauri。该选择替代旧方案 B→A 的双传输交付，减少必须维护的接口；如之后确有连接既存 Host 的用户需求，另立远程终端客户端计划。

| 拟议路径 | 职责 |
| --- | --- |
| `packages/experimental/tui/` | plugin entry、只针对自身 Agent 的交互 provider、输入、呈现和生命周期 |
| `packages/experimental/tui/src/session.ts` | 通过现有 Agent/Session 公共能力创建、恢复、提交、取消；持有自己创建的 AgentHandle |
| `packages/experimental/tui/src/interaction.ts` | approval/request 与 user-questions 的具体终端回答者 |
| `packages/experimental/tui/src/input.ts` | TTY raw mode、bracketed paste、多行缓冲与按键路由 |
| `packages/experimental/tui/src/render.ts` | 有界终端视图、ANSI 控制字符过滤、增量更新 |
| `packages/experimental/tui/src/locales.ts` | 类型化中英文 UI 文案 |
| `packages/experimental/tui-bundle/` | T0 显式安装的实验 bundle，base + 实验 TUI，禁用不需要的 headless/Web 回答者 |
| `packages/tui/tui/` 与 `packages/bundle/tui/` | T2–T4 完成功能、T5 验收并复核限制后，T6 才晋升；新增职责分组按 packages 规则登记 |
| `packages/boot/app-boot/src/profile.ts` | 稳定包晋升后注册 tui profile 模板，T0 仅使用隔离的显式 profile |
| `apps/cli/package.json` | 只声明晋升后的稳定 tui bundle 依赖；不依赖 experimental，不增加 package bin |
| `packages/boot/app-boot/src/index.ts`、`apps/cli/src/profile-boot.ts` | 核实并按需补充终端同步复原与既有致命错误处理的连接；不改变 Agent Loop |

渲染层不直接访问 Context。工具呈现复用 core/tools 的 ToolCallView/ToolResultView（src/presentation.ts）及已有纯 presenter，参考 ACP 的事件投影；TUI 只负责终端映射，不另建工具名分支或第二套工具视图协议。恢复时从日志/已记录视图重建，不重新执行工具；原始参数不能直接倾倒到终端。若公共能力缺失，在 T0 提交最小接口选择及所有受影响消费者，不从 session-controller 私有实现导入代码。

渲染采用 Node TTY 接口加小型视图层；显示列宽优先使用维护中的轻量库（候选 string-width），字素分割使用当前支持 Node 的 Intl.Segmenter 并实测。ansi-escapes 可管理可信控制序列，但它既不是宽度算法，也不是不可信输出过滤器。按实际需要显式声明直接依赖，不借用 lockfile 的传递依赖。版本须核对 Node engines、ESM、许可证与打包体积后锁定；完整布局确有需要才评估 Ink。

禁止以 string.length、UTF-16 索引或码点个数代替终端列宽，删除/移动以字素簇为单位；字符过滤、字素分割、列宽测量与光标定位分别验证。300 行仅作为重新评估自研范围的提醒，不作为正确性阈值；即使少于 300 行，只要维护中的库能删除自研 Unicode/布局逻辑就优先复用。

T0 必须验证中英混排、全角标点、组合重音、Emoji 肤色修饰、ZWJ 家庭、国旗和跨行粘贴，检查编辑后光标、行尾折行、退格、resize 与窄窗口。复用仓库已有 node-pty 和 @xterm/headless 测试模式，把真实 profile 子进程的 PTY 输出输入终端模拟器，自动断言屏幕单元格、光标行列及备用屏状态；原生 PTY 单独验证 raw/echo 与信号。直接声明测试依赖，不将 headless emulator 放入产品依赖。真人终端抽查只补充字体/ambiguous-width 差异，不能替代自动门禁；明确支持范围。

## 4. 会话、输入与输出规则

- 同时只拥有一个活动 Agent；切换会话先完成取消/排空与 flush，再释放旧 AgentHandle。不得销毁其他前端创建或共享的 Agent，冲突明确报错；不实现隐式并发写同一个持久日志。
- 当前任务运行时允许编辑下一条草稿，第一版在当前任务结束后才提交；不自动把草稿解释成 steer，也不在重连/恢复时重发上一条已准入消息。
- Enter 提交，Alt+Enter 插入换行；提供可见的多行/粘贴说明并验证终端差异。不支持该组合的终端提供显式多行输入模式，不能误把粘贴多行当成多个请求。
- Bracketed paste 内容整体进入编辑缓冲，包括看起来像 slash 命令的文字，须用户再次提交。为缓冲、输出、滚动历史和重绘频率提供部署可配的有效上限。
- raw mode 收到 Ctrl+C 字节时，空闲清空草稿，运行时取消任务，再次按下进入显式退出；这是输入行为，不是 OS SIGINT。/quit、Ctrl+D/正常 EOF 的正常退出目标为 0；外部 SIGINT 固定 130，SIGTERM 固定 0，按第 6 节由 launcher 处理。取消后待 Agent 静止才显示完成。
- 会话列表、/new、/resume、/model、/help、/quit 是第一版明确命令；/model 从实际 provider/model catalog 读取，保留真实 route 与 reasoning effort。普通内容不可作为 shell 命令执行。
- 流式内容仅呈现当前 schema 允许的数据；默认不显示原始隐藏推理。持久日志为恢复来源，易失流只用于当前进度；相同内容不能同时从流与最终消息重复追加。
- 工具标题和结果按真实状态呈现，截断必须提示，完成/失败/取消有区别。模型或工具返回的 ESC、OSC、终端控制序列均过滤；禁止通过 OSC52 改剪贴板、改变窗口标题或注入光标控制。
- 浏览历史使用有界分页，不一次载入全部日志；终端缩到较小尺寸时保留输入和待回答入口，输出可退化为纯文本滚动。非 TTY 输入/输出在启用 raw mode 前明确拒绝，并指向现有 headless 模式；不静默启动不安全的无交互执行。

## 5. 人工问题与审批

TUI 是具体回答者，不只是把问题文字打印出来。使用 `user-approval` 的 Agent-scoped waterfall 及 `user-questions` 当前公开交互接口；对于不归自己 Agent 的请求必须委托，不抢答其他会话。

待确认视图显示所属会话、工具名、reason、允许选项和取消入口。approval request 没有工具 arguments，只有可选 callId；适配器用 (Agent.session.id, callId) 查询已记录 tool/call，核对工具名并生成有界、脱敏参数摘要。不能从请求上虚构 arguments，不能从其他会话或最新一次同名调用补全。缺 callId、日志尚不可读、工具不匹配时明确显示参数不可用，禁止批准并允许拒绝；取消/过期仍按原能力结算。审批默认不因 Enter 批准，首版仅单次授权。

回答前再次核对请求 ID、Agent、有效状态与选项；重复输入、过期、切换会话、工具已取消均不能让旧请求执行。提问和审批占用单个可见交互焦点，普通输入不误发成批准；多个请求排队并显示等待状态。

无 TTY、终端断开、插件卸载或异常退出时，未决交互按现有能力规则明确取消/拒绝或 unavailable，并解除工具等待。结果由原能力记录审计事件，不把一次批准提升成下次授权。

## 6. 生命周期与恢复

TUI 通过 Cordis effect 持有输入/输出、SIGWINCH、定时器和交互回答者；不注册自己的 SIGINT/SIGTERM/SIGHUP 或致命异常监听。raw mode 的可读初始状态和本插件切换过的模式须记录并恢复；不可声称保存未知的光标/alternate screen 状态。终端独占，只撤销自己开启的模式。

正常退出：停止准入 → 结束未决交互 → 取消自身 Agent → 有界等待静止/持久化 → 释放 AgentHandle/订阅 → 恢复终端 → 由 launcher 返回状态。信号/致命路径先同步尽力复原，再进入已有有界清理，避免卡住的 disposer 损坏终端。清理错误单独报告，不改变既有 SIGTERM=0 规则，不由插件直接 exit。

| 输入或事件 | 唯一 owner | 拟定行为 |
| --- | --- | --- |
| raw Ctrl+C 字节、/quit、Ctrl+D、EOF | TUI 输入层，经应用关闭入口 | 编辑/取消与正常退出；不新增进程信号监听 |
| OS SIGINT | apps/cli/src/profile-boot.ts | 保持现有 interrupt(130)，调用同步复原后有界 dispose |
| OS SIGTERM | 同一 launcher | 保持现有 interrupt(0)，不能因工具未完成改成失败码 |
| POSIX SIGHUP | 同一 launcher，待添加 | 选择 interrupt(129) 并复原/清理；当前无此处理，不能宣称已支持 |
| SIGWINCH | TUI effect | 仅更新尺寸与重绘 |
| uncaughtException/unhandledRejection | 现有 installFailLoud | 第 6.1 节复原前置，随后有界非零退出 |

SIGHUP 修改影响所有经 profile-boot 启动的应用，T0 必须覆盖 headless、ACP 与 Web profile 的清理/退出回归，确认 ACP stdout 无诊断污染；POSIX 专项，Windows 不伪造 SIGHUP 支持。新增同步 restore 注册接口由 launcher 持有并在 app boot 时提供，TUI 在改终端模式前通过 effect 注册；普通 profile 无回调时保持原流程。复原接口须在实现前以最小 owner 变更复核，不能靠监听器顺序竞争。

渲染异常、EPIPE 和卸载进入幂等清理，输出关闭后不反复写同一输出。SIGKILL/native abort 不能保证复原，记录恢复操作与平台限制。

### 6.1 致命异常与正常退出分开处理

现有 app-boot 的 installFailLoud 已拥有 uncaughtException 和 unhandledRejection 处理：先输出诊断，再等待 release，最多 2000ms，最后 exit(1)；profile-boot 已通过 release 释放应用 fiber。这不是“已经满足复原先于错误输出”。T0 必须验证真实 launcher 的顺序和卡住的 disposer，不能仅新增另一组 process.on 或假定插件 dispose 一定及时运行。

TUI 提供同步、幂等且异常自包含的 restoreTerminalNow；在获得 raw mode 前注册，在正常释放后卸载。致命路径先禁止输入/呈现，再立即尝试恢复原 raw 状态、撤销自己开启的 bracketed paste、显示光标、退出自己进入的 alternate screen，然后由既有进程 owner 记录诊断并非零退出；例如显示光标与退出备用屏序列为 \x1b[?25h、\x1b[?1049l。每个恢复步骤独立尝试，TTY 丢失或一个写入失败不能阻止其他步骤；不向非 TTY 管道写终端序列。

若现有 boot owner 不能在诊断前调用该同步恢复，T0 给出最小的可选 pre-report 回调连接，由终端 owner 注册并由 launcher 调用；保持非 TUI 的默认诊断、ACP stdout 纯净与非零退出规则。该范围允许修改启动/清理代码和对应测试，仍不修改 Agent Loop；不能用全局监听器顺序竞争或双重 exit 规避接口缺口。

uncaughtException 后不恢复业务运行；恢复终端不能等待模型、日志 flush、网络或完整 fiber teardown。随后仍可在既有有界 release 内做尽力清理，但不承诺崩溃时完成所有持久化。同步 exit 兜底只做幂等终端复原，不启动异步任务；SIGKILL、native abort 和已经消失的 TTY 仍无法保证复原。

启动前验证 TTY、workspace、模型可用性与凭据状态；错误时不进入 alternate screen。复用现有 profile 与 credentials provider，日志不包含密钥。恢复已保存会话时遵循已有格式/备份迁移与单 writer 规则，不自建另一个 transcript 文件格式。

## 7. 实施任务

### T0：验证组合与交互接口

检查 `packages/core/agent`、`packages/interaction/user-approval`、`packages/interaction/user-questions`、`packages/session-query/session-query`、`packages/bundle/headless` 与 app-boot 当前 public source；输出确切的创建、恢复、prompt、cancel、模型选择、订阅、问题回答和 flush 调用清单。

在隔离 DSH_HOME 和 keyless mock 模型下，真实 Loader/profile 驱动最小终端 PoC：启动、输入、流、一次问题、一次拒绝审批、取消、退出恢复。断言拒绝后工具副作用计数为零。若该链路无法通过，停在此阶段修订接口方案，不先搭完整 UI。T0 同时交付字符列宽观测记录与致命异常 PTY 子进程测试：真正抛出的未捕获异常、真正未处理的 Promise rejection、卡住/抛错的 release、关闭的 stdout、初始化中途失败；断言复原先于诊断、恢复 raw/echo、可见光标/退出备用屏、非零退出、恢复失败不吞掉原始故障和监听器不累积。只调用 fake handler 不构成完整验收。

### T1：实验包与显式启动入口

保留 packages/experimental/tui 与 tui-bundle，完善 package、README、Config 和显式安装的隔离 profile；不登记内置 tui profile，不让 apps/cli 或稳定 bundle 依赖实验包，不进入默认发布安装闭包。确认仅由 dsh profile 启动，不挂 Web/desktop/headless runner，不监听端口。实验发布不等于晋升。

### T2：输入、呈现与终端恢复

创建 input/render/locales，测试多行粘贴、CJK/emoji/组合字符、resize、控制序列注入、长输出和失败清理；node-pty 验证真实字节/信号/raw mode，@xterm/headless 自动验证屏幕/光标。使用共享 ToolCallView/ToolResultView 覆盖 generic、terminal、diff 等呈现；fake renderer 只做补充。

### T3：会话与模型

创建 session adapter 与命令路由，覆盖创建/恢复、过滤、回放、模型/力度、取消和切换。恢复不重复、断开不重发、模型 UI 与实际 route 一致。writer 冲突直接测 session-persistence-jsonl 的 session.lock/flock：两个独立 fixture 进程使用同一隔离 DSH_HOME/Session，第二个 writer 被拒绝、首个继续运行，释放后第二个可恢复；Windows 按现有 mutex 机制验证。不得对真实桌面用户目录抢锁或杀桌面进程。

### T4：人工交互

创建 interaction provider；覆盖允许/拒绝、缺回答者、重复/过期、取消/切换、EOF/卸载，以及 callId 缺失、错误会话、工具不匹配、日志不可用和脱敏摘要。每个失败分支检查工具副作用为零，不能只断言显示拒绝。

### T5：实验组合完整验收

所有测试仍归 packages/experimental/tui，包括拟议 tests/assembled-profile.spec.ts、terminal-lifecycle.spec.ts、interaction.spec.ts、writer-conflict.spec.ts 及 owner-local terminal expected outputs；模型可见变化增加合规 keyless session replay。构建实验 tarball，在无 checkout src 的临时 DSH_HOME 中显式安装实验 bundle 到测试 profile，完成多轮与交互；此时不宣称内置 dsh --profile tui 已发布。

### T6：复核后晋升与正式安装验收

T2–T4 功能完整、T5 通过后，按 packages/experimental/AGENTS.md 复核 public API、限制、测试证据、稳定 owner、payload 和 dependents。仅此时原子迁移至 packages/tui/tui 与 packages/bundle/tui，更新包名、所有导入、测试路径、README、配置、分组/发布登记；然后添加 app-boot 的 tui 模板与 apps/cli 稳定 bundle 依赖。不得先把不完整能力放入正式闭包。

晋升后测试路径同步改为 packages/tui/tui/tests/...；重新验证稳定包 artifact 与 profile 组合、hygiene/entrypoint/intake gates，在临时 npm 安装中通过正式 dsh --profile tui 完成多轮、恢复和交互。T5/T6 分别记录实验与正式安装证据，不沿用路径已改变的旧报告。

每个任务先写有意义的失败案例，再实现、运行 owner tests 和单独提交；文件与测试名称是拟议内容，实施时按照当前同类包配置落地。README/JSDoc 同步更新，外部 breaking change 按 upgrade guide 规则处理。

## 8. 硬性验收矩阵

| 场景 | 必须观察到的结果 |
| --- | --- |
| 首次启动、退出、再次进入 | 真实 profile 组合成功；终端状态恢复；无残留监听/进程 |
| 多轮与持久恢复 | 单次准入、文本顺序正确、恢复无重复；工具结果可重建 |
| 问题与审批 | 具体选择进入原能力；拒绝/过期/断开时敏感工具不执行 |
| raw Ctrl+C、正常 EOF、外部 SIGINT/SIGTERM/SIGHUP | 字节编辑与 OS 信号分开；正常退出 0、SIGINT 130、SIGTERM 0、POSIX SIGHUP 129；单一 launcher 清理，未决请求解除 |
| uncaughtException、unhandledRejection、release 卡住/失败 | 同步尽力复原先于诊断；有界非零退出、不恢复业务、不重复监听；关闭 TTY 时失败被包含 |
| 中文/英文/组合字符/ZWJ/旗帜、80/40 列、resize | 字素编辑正确；终端模拟器中的光标列/折行符合预期；确认入口可见；记录 ambiguous-width 策略 |
| 长文本/恶意终端序列 | 内存与缓冲有界；无 OSC52 或逃逸控制效果 |
| 非 TTY、缺 Key、错误 cwd、跨进程 writer 冲突 | 第二 writer 被实际锁拒绝且首个继续工作；释放后可恢复；无错误批准或终端损坏 |
| 模型/力度切换 | UI 选择与下一次实际调用完全一致 |
| macOS/Linux PTY | mock 场景与真实 terminal lifecycle 通过；无真实 API Key 依赖 |
| Windows ConPTY | 相同任务交互与恢复测试通过后才宣称 Windows 支持；首版可明确仅发布 macOS/Linux |
| T5 实验安装 / T6 正式安装 | 显式实验 profile 与晋升后内置 tui 分别从 artifact 验证，无 checkout 依赖；T6 前默认闭包不含 TUI |

上述检查均为未来条件，本次未运行。实现时执行 focused Vitest、typecheck、lint、hygiene、verify-upstream-intake、文档及 entrypoint gates；CI 承担平台矩阵。复用 node-pty 和 @xterm/headless，缺失的 profile/ConPTY harness 纳入 T0/T5，不另造模拟终端或以字符串快照替代证据。

## 9. 交付与回滚

TUI 单独发布为可选 CLI 能力，不进入 DMG/EXE 默认插件清单。后续若需要桌面调用，另立产品场景，不把终端依赖塞入默认桌面闭包。

移除 tui profile/bundle 可回滚 UI；保留使用现有 provider 写入的会话与凭据，不删除 DSH_HOME。不得回退 Session 格式来实现回滚。最终交付记录目标 OS、Node 版本、安装包来源、PTY 证据与未支持终端，不能概括为所有终端均可用。

参考：现有 `TUI_PLAN.md` 仅作历史背景；当前机制以 `docs/architecture.md`、`docs/defensive-patterns.md`、`packages/core/agent/README.md`、`packages/interaction/user-approval/README.md`、`packages/interaction/user-questions/README.md`、`packages/sdk/client/README.md`、`packages/acp/acp/README.md` 和 `packages/boot/app-boot/src/profile.ts` 为准。

## 10. 本轮约束核查来源

- [Node 致命异常处理](https://nodejs.org/api/process.html#warning-using-uncaughtexception-correctly)：异常后同步清理并退出，不能恢复正常业务。
- [string-width](https://github.com/sindresorhus/string-width)、[ansi-escapes](https://github.com/sindresorhus/ansi-escapes)：分别用于列宽估算与可信终端控制；仍需验证字素和真实终端行为。
- 本地 packages/boot/app-boot/src/index.ts 的 installFailLoud 与 apps/cli/src/profile-boot.ts 的 release wiring：当前顺序是先诊断后异步清理；T0 的复原前置要求属于待实现/验证项。
- 本地 packages/experimental/AGENTS.md：T0–T5 保留实验包；T6 才复核晋升并进入正式产品闭包。
- [共享工具视图](../../packages/core/tools/src/presentation.ts)、[launcher](../../apps/cli/src/profile-boot.ts)、[approval 数据](../../packages/interaction/user-approval/README.md)、[Session writer lease](../../packages/session/session-persistence-jsonl/src/lease.ts)。
- [terminal-bash 测试依赖](../../packages/terminal/terminal-bash/package.json)、[subprocess-local 测试基础](../../packages/subprocess/subprocess-local/package.json)：复用现有 @xterm/headless 与 node-pty。
