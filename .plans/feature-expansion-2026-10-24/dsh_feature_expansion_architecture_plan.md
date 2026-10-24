# DSH 扩展能力工程实施方案：IM、租户隔离与远程 Worker

状态：修订 v4，已吸收第三轮评审；用户授权在当前工作树由 agy 实施、Codex 审查。消息来源必须先完成 Phase 0 决策 fixtures，再进入 Phase 1。文中未完成的 Linux、平台与两主机验收仍为待运行，不随编码授权自动通过。

源码核查基线：2026-10-24，方案首次提交的父版本（提交标题：fix(ci): allow Windows installer qualification to finish）。权威版本为本文件；见 [任务状态](task_plan.md)、[评审处置](review-round2-response.md) 、[第三轮处置](review-round3-response.md) 和独立的 [TUI 方案](dsh_tui_implementation_plan.md)。

## 1. 范围与交付顺序

先交付一个预先绑定操作者、一个独立 OS 身份运行时的飞书企业自建应用文本私聊 MVP，再扩展多租户。单操作者版仍隔离接入进程和工具执行进程，不以两个租户全部能力完成作为首个 IM 价值的前置条件。

新能力由插件、bundle 和显式 dsh profile 组合；不改 Agent Loop，不新增应用 bin，不修改官方 desktop、desktop-app、desktop-companion 或 DMG/EXE 默认组合。首版不含群聊、附件、语音、个人微信自动化、审批卡片或任意 Worker 注册。

远程 Worker 先验证现有 subagent-acp 与 SSH provider 的组合。没有两种复用方案均不满足需求的证据，不创建远程 subagent 新包。微信资格与部署条件单独评估，不承诺免公网或零账号风险。

## 2. 已核实能力与限制

| 能力 | 源码事实 | 方案约束 |
| --- | --- | --- |
| Agent/Session | core/agent 有 create/resume、AgentHandle；Session 有持久日志及单 writer 锁 | Phase 0 编译验证提交、取消、flush、订阅，不使用虚构 turn API |
| ACP | stdio 自动化协议；authenticate 不执行认证；普通 prompt 写 source.kind=user | 不当认证服务或携带 IM delivery 来源的准入接口 |
| Host Web 服务 | host-webserver 使用 TCP，无租户间本机用户认证 | 不作为租户控制通道；loopback 不等于 OS 用户隔离 |
| subagent-acp | 通过 ctx.subprocess.spawn 启动；cwd 在协调端本地校验 | 先组合 subprocess-ssh，验证远程路径与本地 spawn 路径 |
| SSH | ssh/subprocess-ssh 已有严格 host key、禁用 agent forwarding、helper lease 和进程清理 | 复用连接与进程所有权，不重写连接框架 |
| 业务数据 | storage-domain + storage-sqlite；domain 是进程内写序列，无跨记录事务 | 明确单 writer，不宣称与 Session 日志原子提交 |
| Webhook | Web Host 每次 delivery 新建根 Session，无去重、队列、重放或完成结果 | IM 多轮和持久 delivery 不适配该语义；保留 webhook 行为 |

## 3. 组件、运行平面与租户通道

首版新增 `packages/experimental/im-feishu/` 和 `packages/experimental/im-service-bundle/`。前者提供 ingress 与 tenant-runtime 两个独立插件入口，由两个 profile 进程分别加载；后者提供显式安装的组合层。使用 `@deepseek-ai/dsh-experimental-*` 源包名及 fork 发布重映射。不使用 gateway-*，不与现有 api-gateway 混淆；第二个真实渠道出现前不提取渠道中立公共服务。

ingress 在 Node Host 平面运行，持有飞书连接、绑定、inbox/outbox 和路由，不加载执行工具。tenant-runtime 在租户 OS 身份下持有 Agent、Session、凭据和工具。两者不要求 Web Host 或浏览器，不导入 session-controller 私有实现；可以显式依赖其公共 prompt ID 类型和对应消息来源声明，不能复制私有协议或挪用浏览器的已有请求 ID。

workspace 来自管理员配置的绝对路径，runtime 验证存在、归属、允许根和符号链接。外部消息、卡片和模型不能指定 cwd。已绑定聊天映射到 runtime 内的 Session，控制层不直接打开租户日志。dsh-webhook 的一次 delivery 一个新 Session、无队列或完成回执，与持久多轮聊天语义不同，因此不复用该 ingress，也不修改它来迁就 IM。

### 3.1 选定通道：受权限保护的 Unix socket

采用 Linux 文件系统 AF_UNIX stream，每租户固定 `/run/dsh-im/<opaque-tenant-id>/rpc.sock`。管理员预建 root 所有、0750、组为专用 ingress 组的父目录；socket 为 `root:<ingress-group>`、0660。组中只有 ingress 服务身份，租户 UID 和其他本机用户不在该组。root 与 ingress 是可信控制主体；不声称防御两者被攻陷。

systemd system socket unit 设置 Accept=yes、MaxConnections=1、SocketUser=root、`SocketGroup=<ingress-group>`、SocketMode=0660；每租户对应固定 User/Group 的 service template。service 使用 StandardInput=socket、StandardOutput=socket、StandardError=journal，通过固定的 dsh profile 启动。连接成为 runtime 的 stdin/stdout，不假定普通 system service 自动给 ingress 一条 pipe。具体 units 与支持的 systemd 版本由 Phase 0 Linux PoC 验证。/run 重启后清空，交付 root 管理的 tmpfiles.d 配置，每次开机创建 /run/dsh-im 及各 tenant 父目录并设 root:<ingress-group> 0750；不能以 socket unit 的 DirectoryMode 代替属组配置。tmpfiles 配置和 unit 安装依赖顺序必须在冷启动测试中验证。

内核目录/socket 权限承担本机客户端认证。ingress 只连接管理员注册表路径，先核验所有权、权限和无符号链接；runtime 握手返回协议版本、固定 tenant ID 和 workspace 标识，不匹配即拒绝。禁止 abstract socket、共享 TCP 端口或失败后退回 ingress 自身执行。runtime 拿到已接受的描述符，无须访问 socket 目录。

首版明确选择连接绑定生命周期：Accept=yes 每个连接启动一个 runtime；ingress 部署、崩溃或重启会取消所有受影响租户的在途 turn，不能承诺后台任务跨 ingress 重启继续。产品返回已中断或状态未知，并在旧实例完成有界排空/退出后重连和对账；MaxConnections=1 期间重连被拒绝属预期，采用有界退避，不启动第二 writer。发布说明须展示此限制并测试长工具运行时重启 ingress、残留清理及不重放副作用。需要跨 ingress 重启继续执行时，另评审 Accept=no/listening-fd runtime 与重连协议，不在此版暗中切换。

每次路由仍核对外部绑定，OS 身份认证不替代平台用户授权。正文中的 tenant ID、socket 路径、Session ID 不能覆盖服务端绑定。runtime 再核对 Session/交互 ID 属于本租户和对应会话映射。

### 3.2 私有 IM 协议与 ACP 取舍

选择同包内部的版本化 NDJSON 协议，schema、客户端和服务端同属 im-feishu。拟议操作为 initialize、openConversation、submitDelivery、getDelivery、cancelDelivery、setModel，以及 Phase 3 的 getInteraction/answerInteraction；回复与更新携带请求及 delivery 标识。这些是待实现私有操作，不是当前 DSH API；Agent 行为仍调用现有公共能力。

评估过 ACP over Unix socket：权限可保护 ACP，但当前 acp 的 stream override 是运行时测试接口，标准 prompt 固定记录 user 来源，且没有 IM delivery 对账查询。普通 ACP prompt 无 IM delivery 对账操作，也不能假定任意 source 扩展可读。因此 IM 仍使用最小私有适配器提供 durable delivery/status，消息保持 human user 语义并按第 5 节保存请求关联；不因这些需求修改标准 ACP，远程自动化继续使用它。Phase 0 若发现已有公共入口满足这些要求，应凭可执行证据删除重复实现。

协议配置限制帧大小、挂起请求、更新缓存和握手/操作/取消期限；stdout 仅协议数据，诊断去 stderr。不提供任意 RPC 转发、插件安装、环境/凭据下发、文件读取、MCP 启动或任意 cwd。确切 Agent/Session/交互参数由 Phase 0 编译映射确认。

断开后 runtime 停止准入，取消并有界排空自己持有的 Agent，flush 后退出；systemd KillMode=control-group 和有限 TimeoutStopSec 处理残留。重连先确认旧实例退出，不能绕过 MaxConnections 或 Session writer 锁；未知 delivery 进入对账，不自动重提。

## 4. 身份、授权与 OS 隔离

### 4.1 外部身份

绑定键包括 provider、组织、应用/机器人、外部用户；会话键另含聊天类型、chatId、话题/线程。平台连接认证及应用归属验证先于绑定查找，不按显示名、首次发言或单个 user_id 自动授权。首版通过管理员本地配置绑定，不增加通用管理 API/JWT 服务。

每次准入和持续输出检查绑定有效性，撤销即禁止新请求并终止关联流。普通操作者不能安装插件、读取共享凭据或访问其他会话；Key 不经 ingress 或 IM 返回。

### 4.2 运行时控制与隔离

管理员一次性创建账户、目录、只读运行时、固定 socket/service units 和注册表。ingress 始终非 root，通过 socket 激活 runtime，无须常规 sudo start，不在 Node 内 setuid。停止/维护由部署管理员处理；将来需要自服务 unit 操作时再增加只接受已登记 ID 的 root-owned helper，不预先授予通用 sudo/systemd-run。

systemd-run --user 不能跨 OS 用户切换，本版不采用。runtime 明确 User/Group、DSH_HOME、HOME、workspace、环境白名单和资源限额，不继承桌面 .env/凭据。profiles、sessions、credentials、attachments、settings、skills 和安装状态按 UID 隔离；代码可只读共享。

进程启动不等于 ready，UID/GID、路径和协议握手通过才开放路由。错误配置/权限/Key 失败关闭，不降级共享 Host。隔离覆盖读写、子进程、进程信息、日志和全部租户控制端点；禁止组合未经认证的 host-webserver 或其他控制监听器。UID 不隔离网络或提供配额，部署另验证沙箱、出站策略、资源上限与敏感文件权限。

Linux 必测：合法 ingress 完成 prompt/result；无关 UID 及 tenant B 的 UID 连接 tenant A socket 均在任何协议请求前得到 EACCES；tenant 无法修改 socket、父目录、注册表或 unit；错误权限使 ingress 拒绝；无租户 TCP 控制口；第二并发连接不能启动第二 writer。单租户 MVP 也要异 UID 拒绝测试，两租户业务矩阵在 Phase 3 完成。macOS 检查不能替代 Linux 证据。

## 5. IM delivery、存储与交互

渠道验证先核对官方 SDK、应用类型、权限、ACK/重试、事件分发、限流和回复更新能力。飞书企业自建应用长连接先交付；钉钉机器人 Stream 为第二渠道候选。企业微信智能机器人、微信客服、企业微信应用互通分别验证资格、事件入口、可信 IP/公网要求和回复窗口，不能混为个人微信自动化；Wechaty/个人账号协议不进入本轮承诺。

### 5.1 持久数据与消息来源

绑定和 delivery 使用 storage-domain 经 storage-sqlite 保存。ingress 独占管理数据库，runtime 独占租户 receipt 数据库；systemd 单实例及独占运行锁禁止多个进程写同一 domain。domain 的进程内序列不是跨进程锁。单条 delivery 记录包含 inbox 状态、Session 关联和 outbox 回复状态，需要一起改变的字段一次更新；不假设跨表或与 JSONL 日志存在事务。

各 domain 显式版本化，使用单调递增的 IM_SCHEMA_VERSION，升级前备份、验证和明确迁移；版本不匹配失败关闭，不重建空库。storage-sqlite 的物理 STORAGE_SQLITE_SCHEMA_VERSION 仅在物理结构改变时递增。限制队列、记录保留、去重窗口和重试预算；domain 启动加载记录，不能承诺无限历史。过期事件拒绝而非当新消息执行，去重保留期覆盖平台重试期。

撤回固定新增 MessageSourceMap.im 的决定。绑定操作者主动键入的消息具有 human authority，优先保持 source.kind: 'user'；Webhook/程序事件的非 user 语义不能机械用于人类 IM 输入。自动通知、机器人消息和未经绑定输入不获得这种权限，首版直接拒绝。

Phase 0 建立 decision-source.md 和三个真实 released/current-format fixture，先读回再比较行为；结果进入 Codex 审查，尚未通过不得向 Phase 1 持久写入新来源。对每个方案记录字段读取、v3→v4 转换、最新 writer/read、旧日志兼容及全部 human-turn 消费点，不以 TypeScript 编译代替读盘证据。

| 方案 | Phase 0 fixture 与语义检查 | 选择 |
| --- | --- | --- |
| (a) kind=im，自带 delivery 字段 | 证明 v0 默认分支接受非空未知 kind、v3→v4 保持直接 kind；列出 human-turn 行为损失 | 拒绝用于绑定人类输入；可读不等于语义正确，也不自动需要格式升级 |
| (b) kind=user，新增 delivery 字段 | 检查当前格式完整读取链是否因仅允许 rpcId/clientTimeZone 拒绝；断言真实拒绝或接受，不能预设 | 暂不采用；如果选择必须先完成持久类型评审与必要格式工作 |
| (c) kind=user，现有 rpcId 关联 | 使用新生成的 branded SessionRequestId，而非把平台 event ID 塞入 rpcId；验证公开 owner 语义、碰撞隔离和所有下游消费者 | 本次选定推进方向；以 fixtures 和 owner 审查通过为放行条件 |

选项 (c) 中 ingress 是已认证 prompt client，为新 delivery 生成随机 UUID 的 SessionRequestId，并在首次持久 inbox 写入时保存 delivery 复合键→requestId 映射；重试始终复用同一 ID。平台 provider/app/tenant/chat/senderBinding/eventId 保留在业务 domain，不加到 Session source。runtime 校验同一 delivery/request/session 绑定后写入 kind=user、rpcId=requestId；只有明确配置并验证的 clientTimeZone 才附带，不伪造用户时区。非人类消息不能复用此路径。

rpcId 现由 session-controller 的 user-rpc 声明拥有，用于 prompt 去重、附件 retirement 和浏览器乐观提交结算。Phase 0 必须确认或明确记录其允许已认证 IM prompt client 使用的 namespace 规则、更新公共 owner 文档，并测试 IM ID 不会结算/撤销其他客户端提交或附件。不能复用浏览器已发出的 ID、仅作字符串强转掩盖 owner 不匹配，或用原始平台 ID 冒充 SessionRequestId。若 owner 约束不能满足，暂停 Phase 1，回到 (b) 的显式格式设计，不静默选择 (a)。

human-turn 行为清单至少涵盖 session-title、tool-skill 显式调用、tool-goal authority、time-context、repeat-tool 重置、jobs wake 重置、session list 的 lastPromptAt，以及 session-reference、turn outline 与 Client 用户消息呈现。Phase 0 搜索全部 source.kind=user 判断并形成消费点清单，代表性行为用实际插件/投影 fixtures 验证；不能把固定“约 18 处”当作永久清单。

按 [持久类型变更流程](../../docs/cookbook/reviewing-persistence-type-changes.md) 检查实际类型变更、生成所需 acknowledgement，更新 TypeScript/Python SDK 相关预期输出与 keyless replay。仅复用既有 source 字段不预设格式 bump；未知非空 kind 的可读性本身也不需要 bump。冻结的历史代际不得修改；只在选定设计确实需要不兼容结构时新增相邻版本及备份保护。

### 5.2 准入、对账与出站

1. 事件完成认证、归属、大小/类型和绑定检查后持久写 inbox，再按平台规则 ACK；ACK 不等模型完成。Phase 0 核对 SDK 实际 ACK 时机，不能保证持久接收即阻塞 MVP。
2. 每会话 FIFO 串行。runtime 准入前持久写 receipt，再由公共 Agent 接口提交保留 kind=user 并按已通过决策写 rpcId 的消息；不隐式 steer，不让 ingress 直接改租户日志。
3. 重连时 ingress 调 getDelivery，runtime 在独占会话所有权下以 receipt 保存的 requestId 查询 Session 日志的 user/message.source.rpcId，并核对 Session 及 domain 内的 delivery 复合键映射。已有消息就不再准入，继续对账完成/失败/中断；流只表示进度，日志提供持久执行证据。
4. receipt 正在准入而日志无消息，仍可能处于排队/崩溃窗口。标 unknown，先确认旧 writer/Agent 静止；不能以查不到日志直接重试。无法排除执行时需人工处理，不承诺 SQLite/Session 间 exactly-once。故障测试覆盖 receipt、followup、日志提交和结果入 outbox 的前后。
5. outbox 持久保存 messageId、版本、重试和最终投递状态。回复合并/缓冲有界，区分 Agent 完成与用户收到；平台无幂等发送且响应丢失时标未知，不无限重发。原地更新能力由真实平台证据确认。
6. Phase 2 不含 card.action.trigger 授权或自然语言同意。无可信回答者时 user-approval/user-questions 明确拒绝、取消或 unavailable，受保护操作副作用为零；是否继续 turn 遵循工具失败语义。
7. 不外发隐藏推理、Key、完整原始工具输入/输出或跨会话数据。连接、消费者和订阅由 Cordis effect 持有；停止先断准入、有界排空，确认进程退出后清理临时资源。

### 5.3 Phase 3 审批卡片

核对官方 SDK 的 card.action.trigger 支持：WS 走认证连接分发，HTTP 按该传输验签和防重放。服务端持久绑定 action ID、授权者、tenant、应用、Session、请求、选项和期限；原子单次消费，重复、过期、撤销、跨用户/租户、已取消请求均拒绝。

approval request 只有工具名、reason 和可选 callId，没有 arguments。runtime 用 (Agent.session.id, callId) 查询普通 tool/call 的 callId，或 tool/ptc-dispatch-start 的 subCallId，核对 name 和同一 Session/当前未决请求后从 arguments 生成有界脱敏摘要；ingress 经认证 IPC 获取摘要，不从卡片 payload 或其他租户文件补参数。callId 缺失、日志不存在、工具不匹配或请求失效时标参数不可用并禁止批准，仍允许拒绝。回答前重查有效性；持久点击决定不等于工具已执行，崩溃后不可重放批准给新请求。Phase 0 通过真实 PTC 执行确认 dispatch-start 已先于 approval/request 记录；若尚不可读则等待有界发布或返回 unavailable，不能虚构参数。Phase 3 必测 run_code 内嵌敏感工具的允许、拒绝、取消、subCallId 错配及摘要脱敏，断言实际副作用。

## 6. 远程 Worker：先验证组合复用

只支持预登记 Linux Worker、固定账号/profile/workspace 和明确 host key。SSH 不代替工具沙箱；模型不能提供额外 argv、env、凭据或 cwd。

| 路径 | 必做 PoC | 决策 |
| --- | --- | --- |
| A：subagent-acp + ssh + subprocess-ssh | cordis:group 中 isolate: { subprocess: true, ssh: true }；保留父级 subagents 注册；组内 ACP spawn 远程，组外 shell 仍本地 | 首选；复用 helper lease、流和远程清理 |
| B：subagent-acp 的 command=ssh | 显式 SSH argv；authorized_keys 的 restrict 和固定 forced command 只启动受限 dsh ACP profile；本地 subprocess-local | A 的部署条件不满足时评估；需远端 supervisor/lease |
| 新 remote provider 包 | A/B 失败的最小复现、现有 owner 小修不能解决的原因、独立职责和实际消费者 | 缺少以上证据不得建包 |

组合参考 [github-review profile](../../apps/cli/config/examples/github-review/cordis.yml)，草案不等于运行证据。subagent-acp 在本地 stat/access 校验 cwd，且该值还用于 ACP session；PoC 覆盖远端路径本地不存在、远端 DSH_HOME/env 和能力限制。若需分离 spawn cwd/ACP cwd，优先最小修改 subagent-acp 配置与消费者，不新写连接层或创建假本地目录掩盖限制。

A 保留已有 ServerAliveInterval=10、ServerAliveCountMax=3、BatchMode、StrictHostKeyChecking、ForwardAgent=no，以及 helper lease 和请求/流超时，不无依据换成 15 秒。B 也以 10/3 为初始受限部署策略，明确 ConnectTimeout、初始化/执行/取消期限。新增可调期限经 schema 配置；断链立即释放本地等待，远端结果未知，禁止自动重连重放。

A 的控制连接与 stream 使用受控 SSH Unix socket forwarding，不能机械套 B 的 restrict 或全局 DisableForwarding=yes。A 的账号只获 provider 所需权限，验证无任意 TCP 转发/凭据泄漏。B 的 forced command 不解释调用者字符串，拒绝交互 shell、PTY、用户 rc、agent/X11/端口转发；profile 配置/脚本不可由调用者写入。

两种部署都要求 sshd 对 Worker 启用有限、非零 ClientAliveInterval/ClientAliveCountMax，初始部署值 10/3，并核对有效配置。客户端检测解决协调器等待，服务端检测与远端进程所有权处理残留；A 验证 helper lease 到期或控制断开杀掉所持进程，B 必须有远端监督/lease 与 cgroup 清理进程树，不能假定 sshd 断会话会杀全部后代。

10×3 是近似传输检测时间，不是任务 SLA。分别测试黑洞网络、协调器死亡、SSH 正常但 ACP 停滞、取消期间断链和工具派生进程，记录本地释放、远端 lease 到期与进程树消失。无远端证据时保持清理未确认，不能声称副作用已停止。ACP 未支持的 persona/toolFilter/depthLimit 等能力继续声明不支持。

## 7. 实施阶段

| 阶段 | 交付 | 退出条件 |
| --- | --- | --- |
| Phase 0：接口/部署 PoC | 公共接口映射、source 三选项 fixture/decision、PTC 顺序、mock 事件、IPC schema、Linux socket/tmpfiles/异 UID、SSH A/B 可行性记录 | 真实 profile + keyless mock 完成 Agent 流程；选定 source 同时可读且保留 human 行为；Codex 复核后才进入 Phase 1；区分静态与运行证据 |
| Phase 1：单 runtime | 实验 ingress/runtime/bundle、单 UID 服务、storage domains | 已绑定路由、异 UID 拒绝、无 TCP 控制口、停止/重连/锁/unknown 对账通过 |
| Phase 2：飞书文本 MVP | 单操作者私聊、多轮、inbox/outbox；不含卡片批准 | mock 与获授权的真实测试应用通过；重复事件不二次准入；无回答者时敏感工具副作用为零 |
| Phase 3：多租户/交互 | 两 UID 资源矩阵、配额/撤销、审批/问题卡片 | 跨租户 Session/文件/Key/流拒绝；重复/过期/无参数审批不执行；目标应用验证通过 |
| Phase 4：第二渠道/微信 | 首个真实第二渠道消费者，再判断是否提取共享服务；微信资格与部署报告 | 不提前建立通用 gateway seam；可以得出暂不实现某渠道的结论 |
| Phase 5：远程自动化 | A 或 B 组合配置；仅证据要求时修现有 provider | 两主机任务、错误 host key、失联、lease、取消和远端残留的可重复证据 |

Phase 0 先做本地/隔离 fixture 与官方资料核对；Linux、多主机和平台实测分别标待运行，SSH 可行性不阻塞独立的 IM MVP。本文不授权读取真实组织消息、使用真实凭据或发送真实用户消息。实验包只能显式安装，release bundle/apps 不依赖 experimental；能力完整、限制和测试证据复核后整体晋升，再登记正式 profile/闭包。

## 8. 验收、迁移与回滚

单元覆盖身份键、schema、路径、去重/过期、outbox、限额和授权；组合测试经真实 Loader/profile 与 mock 模型记录调用和工具副作用计数。各持久化窗口注入崩溃，验证 unknown/已完成状态，不只测试显示文字。

选定的来源/关联设计须证明 human 行为与当前格式读盘，按实际类型变更完成 acknowledgement、旧日志兼容、keyless replay 和两个 SDK 预期输出；domain 升级含备份、版本拒绝与迁移测试。遵守单调 SCHEMA_VERSION，不覆写冻结格式，不把业务 SQLite 当 Session 存储。

Linux gate 覆盖真实异 UID、socket activation、错误权限、控制端口扫描和进程清理；SSH gate 用受控主机/失联控制；平台 gate 限定测试应用、身份和预算。报告区分 local verified、target verified、not run，不能用静态配置或 macOS 单机结果替代多租户验收。

实现时运行 owner tests、typecheck、lint、hygiene、文档和 fork intake gates，更新 README/JSDoc 与必要 upgrade guide；CI 承担完整平台矩阵。是否已运行以本轮 implementation-report.md 的命令和产物为准，不能从计划状态推断通过。

回滚先停止 ingress 准入、撤销绑定/Worker 授权，再确认执行停止；保留 Session、业务数据和备份，不删除 DSH_HOME 或降低格式版本。服务端独立交付，未来桌面入口另需 overlay、pin、闭包和安装包验收。

## 9. 来源

本地依据：[ACP](../../packages/acp/acp/README.md)、[subagent-acp](../../packages/subagent/subagent-acp/src/index.ts)、[SSH](../../packages/ssh/ssh/README.md)、[subprocess-ssh](../../packages/ssh/subprocess-ssh/README.md)、[webhook](../../packages/webhook/webhook/README.md)、[storage-domain](../../packages/storage/storage-domain/README.md)、[storage-sqlite](../../packages/storage/storage-sqlite/README.md)、[approval](../../packages/interaction/user-approval/README.md)、[experimental policy](../../packages/experimental/AGENTS.md)。

机制依据：[systemd.socket](https://www.freedesktop.org/software/systemd/man/latest/systemd.socket.html)、[systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)、[OpenSSH 服务端存活检测](https://man.openbsd.org/sshd_config#ClientAliveInterval)。这些资料支持设计，不是本项目已完成部署实测的证据。
