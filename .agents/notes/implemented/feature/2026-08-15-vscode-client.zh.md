# Agent Note: VS Code 客户端界面

Status: implemented

[English](2026-08-15-vscode-client.md) | 中文

## 问题

DeepSeek Harness 已有完整的交互式 Web 客户端，但编辑器用户必须离开当前工作上下文才能使用它。VS Code 客户端应复用现有的会话、agent（智能体）、审批、提问、工具和 Client Plugin（客户端插件）行为，同时增加由编辑器负责的上下文捕获与文件导航。另建一套对话 UI，或让产品经 Agent Client Protocol（ACP，智能体客户端协议）路由，都会重复产品行为，并让自动化协议承担其并不拥有的职责。

本次变更之前，Web 组装把传输无关的客户端行为与 HTTP、WebSocket、静态文件及浏览器功能合在一起。在 VS Code 内复用该组合包会启动不必要的浏览器服务器，也会让编辑器界面继承仅适用于 Web 的假设。客户端模块注册表同样把插件发现和启动图构建与 Web 路由合在一起。本实现拆开这些职责，使另一个交互界面能够清晰消费它们。

编辑器扩展还引入了两条信任边界。VS Code Webview 消息属于不可信值；扩展必须在 POSIX 和 Windows 上启动已安装的 Harness runtime（运行时），且不得执行包管理器 shell shim（垫片）。即使每条物理 IPC 消息都保持严格上限，大型附件请求也必须继续可用。多个 VS Code 窗口不得并发打开同一个不支持多进程的 Harness home。

## 决策

### 组合与共享客户端行为

交互式组装使用三个组合包。`@deepseek-ai/dsh-client-app` 负责 ApiProxy、持久化与工作区支持、客户端模块注册表、Client runtime、共享 `ui-*` 名册，以及按会话划分的 agent preset（智能体预设）组装。它不负责物理连接提供方。`@deepseek-ai/dsh-web-app` 是轻量 Web 界面，只包含 HTTP、WebSocket、静态前端、浏览器导出、自适应 Web 目录选择、Web 启动和 Web 客户端模块适配器。`@deepseek-ai/dsh-vscode-app` 包含 Node IPC、远程安全的目录选择、VS Code 上下文 UI 和 VS Code 启动行为。

随发行版交付的组装是 `web = base + client-app + web-app`、`vscode = base + client-app + vscode-app` 和 `headless = base + headless`。profile 等价性测试保持 Web profile 的已启用配置项顺序和解析后配置不变。

`@deepseek-ai/dsh-client-modules` 与传输无关。其 Node 侧增量发现 `dsh.client` 包、解析元数据与 bundle（包）路径、计算 bundle 哈希、构建 `ClientBootGraph`，并发布图与重建变更。模块依赖约束图顺序，无关联平局及对应 bundle 记录则按 Loader entry 顺序排列；异步 fiber 激活不会改变表层握手。`@deepseek-ai/dsh-host-client-modules-web` 适配器负责 `/plugins` 服务与 HTML manifest（元数据清单）注入。`ClientBootEntry` 和 `ClientBootGraph` 取代原来的 Web 专用名称，且不保留兼容别名。

### 进程与已安装运行时

VS Code 扩展作为 workspace extension（工作区扩展）运行，并为所选工作区文件夹持有一个保留型 Webview 和一个 companion（伴随进程）。它在工作区扩展宿主中解析真实 Node 可执行文件和兼容的已安装 `@deepseek-ai/dsh` 包。`harnessClient.nodePath` 与 `harnessClient.runtimePath` 是显式覆盖项。`PATH` 上的 `dsh` 候选项，包括 npm 或 pnpm 的 `.cmd` 与 `.ps1` 文件，只作为发现线索。

解析器规范化已识别的链接与包管理器 shim，校验包名，读取声明的 `dsh.companions.vscode` 模块，并拒绝未知 shim 格式。它使用 `child_process.fork`、解析后的 Node 可执行文件、`shell: false`、分离参数和内置 IPC 通道启动该 JavaScript 入口。它绝不执行 `dsh`、`.cmd` 或 `.ps1` shim，也不使用带编号的子进程文件描述符。版本化握手针对 Node、runtime、companion 入口或载体版本缺失及不兼容给出可操作错误。Windows 属于版本一支持平台，并设自动化本地扩展集成任务。

版本一要求安装 runtime，不把 Node、原生模块或 Harness 打进扩展。SSH Remote 与 Dev Container 是人工发布检查项；Web 扩展宿主不受支持。一个选定工作区根目录足够。切换根目录时会重启 companion；若轮次正在运行，则先取得确认。

### 有界载体

companion 通过版本化 VS Code 载体暴露现有 ApiProxy 消息与流式行为。`ClientRequest` 和 `ClientResponse` 仍通过 `toFetchHandler(ctx.apiProxy)`，因此 ApiProxy 继续作为校验与路由权威。mux 与 Host 打开载荷使用 ApiProxy 所有的 schema。服务端流帧仅可下行。包装层只增加生命周期与多路复用，不重新定义 Harness 业务方法。

companion、扩展宿主和 Webview 共享一个浏览器安全的协议包。每个 Node IPC 与 `webview.postMessage` 值都以 `unknown` 开始，并在路由前解析。物理 wire record（线路记录）序列化后上限为 256 KiB。大于单条记录的逻辑帧只做一次 UTF-8 编码，再作为有序 base64 分片发送，并携带精确字节数和 SHA-256 摘要。每个方向同时最多传输一条分片消息；交错、溢出、超时、顺序错误、长度错误或摘要错误都会关闭 bridge（桥接器）。

控制、流打开及编辑器消息的逻辑上限为 1 MiB。RPC 与流帧默认采用现有 160 MiB 请求体上限，并复用聚合图片容量不变量。发送方在接纳下一条记录前施加背压，待处理 RPC 与编辑器请求数量也分别受限。这样既能保持控制记录小巧，也不会拒绝合法附件请求。

### Webview 与编辑器集成

现有 Client Cordis 树在 Webview 内运行。`AppWebEntry` 接收自定义 bundle loader（包加载器）：扩展校验 companion 公布的标识与哈希后，把 bundle 复制到按图修订号划分的缓存，再通过 `webview.asWebviewUri` 只暴露该缓存与固定扩展媒体资源。Webview 会安装共享模块 registration facade，并在构造 `AppWebEntry` 前从该缓存执行模块系统与 runtime 行；其 `configureContext` seam 会在任何图 entry 激活前提供窄粒度 carrier 与 IDE port。只有 bootstrap（引导程序）调用一次 `acquireVsCodeApi()`，并把所得对象保存在这些端口之后，不对外暴露。

Client 图配置以 JSON 形式进入 Webview，不能携带 Loader JavaScript 表达式。VS Code Vite 构建会把 vendored Loader 求值器替换为显式拒绝实现，VSIX 验证器则拒绝每个 Webview JavaScript 产物中的 Function 构造器与直接 `eval`。这样既保持无 `eval` 的内容安全策略，也不会削弱普通 Loader 激活行为。

从 Webview 到扩展的消息是一个白名单 union（联合类型），只含载体记录以及有类型约束的编辑器请求、响应和事件。具名 `IdeMethodMap` 负责每个编辑器载荷与结果的 schema。Webview 不能发送任意 VS Code 命令。扩展只拦截 `host.openPath` 和 `host.describe` 中的 VS Code 可用性字段；其他 Host 请求原样传给 companion。文件打开限制在所选工作区内，范围外路径一律拒绝。

编辑器上下文使用现有 `@` reference（引用）流水线。`IConversation.appendReference` 提供一个窄化插入方法，不暴露草稿修订号或 compare-and-swap（比较并交换）细节。VS Code Client Plugin 经显式操作捕获不可变的当前选区、文件或诊断快照，把它显示成可移除的引用 chip（标签），并在提交时把精确的有界快照序列化进普通 `session.prompt` 文本。捕获必须由用户可见操作触发；扩展不会静默读取或附加整个仓库。快照缺失或序列化失败会阻止提交。

### 生命周期、信任与持久化

活动栏视图使用 `retainContextWhenHidden: true`。隐藏视图时保留 Client 树、草稿和引用 chip，也不停止 companion。版本一不会跨窗口重载、扩展宿主重启或视图销毁持久化未发送状态；持久会话从 Harness 日志重新连接。

工作区取得信任前，扩展既不启动 runtime，也不捕获编辑器上下文。runtime 路径属于受限设置。Webview 使用严格的 content security policy（内容安全策略），不允许内联脚本或 `eval`，并采用最小本地资源根目录。runtime 日志会遮盖环境值与提示词内容。扩展统一持有的生命周期负责释放监听器、待处理请求、流泵、watcher（监视器）、缓存和子进程。

启动前，companion 为解析后的 `DSH_HOME` 获取独占 lease（租约）。活跃或无法确定的属主会让启动以 `home-busy` 保守失败；确认死亡的属主会先归档，再重试一次。属主 token（令牌）可防止一个进程删除另一个进程的 lease。该 lease 覆盖整个 home，因为当前 JSON 与会话存储不支持多个写进程。共享该 home 的独立 Web 或 CLI runtime 仍不受支持。

### 本地化与分发

VS Code manifest 文案使用 `package.nls.json` 提供英文，使用 `package.nls.zh-cn.json` 提供中文。扩展 runtime 字符串使用 VS Code 本地化 API。Client Plugin 文案沿用仓库的中文源字典与 key 完整的英文字典。扩展通过握手和 Webview 启动传递规范化后的 VS Code 语言，使 Client locale（语言区域）在插件挂载前完成选择，除非持久用户偏好有意覆盖它。

仓库包仍名为 `@deepseek-ai/dsh-vscode`，但发布打包会生成独立的暂存 Marketplace manifest 与 VSIX。暂存产物不得包含 source map（源映射）、测试、工作区 manifest、凭据、Harness runtime 或无关包。Marketplace 产物使用扩展名 `harness-client`、显示名称 **Harness Client for VS Code**、中性的终端对话图标和 pre-release（预发布）渠道。publisher id（发布者标识）在获得授权的属主注册中性身份前保持为 `__PUBLISHER_ID__`；占位符未消除时，发布验证失败。这样不会冒用贡献者并不拥有的身份。

## 曾考虑的替代方案

### 先做终端 UI

终端 UI 可以改善纯 shell 使用体验，却无法复用编辑器选区、诊断、URI 处理、Remote Development 放置位置或 VS Code 文件导航。现有 Client Plugin UI 也更适合直接映射到 Webview，而不是映射到第二套终端 renderer（渲染器）。

### 使用 ACP 作为编辑器协议

ACP 仅用于自动化，不负责完整交互式 Host API、Client Plugin 图或呈现行为。复用 ApiProxy 与会话事件可保留唯一权威的产品协议。

### 在扩展内启动 localhost Web 服务器

启动 `dsh web` 会引入端口选择、源与认证策略以及浏览器专属依赖，却没有产品收益。直接 Node IPC 能让 companion 仅对扩展宿主可见，并可在远程工作区宿主内工作。

### 继承 Web 组装后禁用配置项

负向组装会让 VS Code 继续耦合到浏览器职责，也会使未来 Web 配置项泄漏进编辑器 profile。独立界面组合包使每项依赖均为显式声明。

### 使用单一的大型 IPC 帧上限

控制流量大小的上限会拒绝附件，而允许附件大小的物理记录又会削弱内存约束。对有界逻辑帧分片可同时保持两项不变量。

### 通用编辑器命令隧道

传递任意 VS Code 命令标识会向插件代码授予开放式权限通道。封闭且由 schema 所有的编辑器方法映射让扩展界面可审阅。

## 验证

- profile 等价性测试会比较组装拆分前后 Web profile 的配置项顺序和解析后配置。
- resolver（解析器）、进程、载体、runtime generation（运行时代际）竞态、Webview、编辑器上下文、路径打开、信任、lease、本地化和资源释放测试覆盖各自负责的生命周期与安全规则。
- 无密钥的 `vscode-agent` 组装快照会针对同一份图快照分别从源码和构建产物启动 companion、对包含编辑器上下文的图片提示词进行分片、通过 ApiProxy 产生流式输出、持久化精确文本，并拒绝第二个 home 属主。
- 本地 Electron 集成会启动暂存扩展、捕获编辑器状态、打开 workspace 内位置、重新连接 runtime，并释放 companion lease。
- VS Code workflow 为 Linux、macOS 与 Windows 定义原生本地扩展任务；SSH Remote 与 Dev Container 仍是人工发布检查项。
- 打包测试与 VSIX 验证器会强制执行产物允许清单、本地化完整性、外部 companion 声明、128 像素 PNG 图标、pre-release 元数据、已解析的 publisher 身份和无 `eval` 的 Webview 脚本。

## 后果

已安装 runtime 与扩展可能发生版本漂移，因此载体与 runtime 兼容性必须在客户端图启动前失败。保留 Webview 会在隐藏期间占用内存，但能避免丢失未发送工作；后续可用草稿序列化替换该取舍，而无需改动载体。bundle 缓存与分片消息组装器处理不可信元数据，因此必须对标识、哈希、目标位置、顺序和资源释放进行精确测试。远程文件系统与 Windows shim 不同于本地 POSIX 开发环境，因此平台集成证据属于发布就绪条件，而不是事后补充。
