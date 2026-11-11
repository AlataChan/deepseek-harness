# Gamma 云端原生插件实施计划

> **实施要求：** 所有者批准后使用 `superpowers:executing-plans`；每项任务按失败控制、最小实现、验证和独立提交的顺序执行。

[English](2026-10-18-gamma-cloud-plugin.md) | 中文

**状态：** 待审查提案。仅编写文档；本文件不授权实施、开通权限、部署、构建安装程序或发布。

**目标：** 为 DSH 增加可选的原生 Gamma 模块，让人工授权的用户浏览云端报告，并使用自己配置的模型解读选定的报告内容。

**架构：** 一个双端 experimental 插件负责原生界面和仅在 Host 运行的 Gamma 客户端。每次报告读取由 Gamma 当前的服务端授权决定；本地开关仅控制 DSH 是否参与。复用 DSH 授权、凭据记录、类型化 Remote、slot、工具和会话快照设施，不修改 Tauri 外壳或 agent loop。

**技术栈：** TypeScript、Cordis、React、Typert、现有授权与凭据服务、Node HTTP/crypto、Vitest、浏览器测试及现有 Tauri 打包检查。不包含 Python 策略引擎、行情密钥、支付 SDK 或内嵌密码表单。

## 概述

用户通过系统浏览器绑定已有 Gamma 账号。运营者在系统外收款，再通过 Gamma 后台开通或续期。DSH 展示真实账号、模块权限和报告时效；选定的 DSH 模型通过有界只读工具解读报告。DSH 不确认收款，也不根据本地设置推断权限。

## 目录

- [职责与依赖](#ownership-and-dependencies)
- [用户流程与保护措施](#user-flow-and-safeguards)
- [DSH 实施任务](#dsh-implementation-tasks)
- [验证与交付](#verification-and-delivery)
- [开发备注](#dev-note)

<a id="ownership-and-dependencies"></a>
## 职责与依赖

Gamma 服务端计划位于 `/Users/apple/Documents/2.1_AI_Journey/Cursor_projects/gamma_shock/docs/plans/2026-10-18-dsh-gamma-cloud-server.md`。该计划拥有 `gamma-desktop-v1` 的定义：端点和字段、令牌生命周期、授权时间区间、签名续读凭据、固定错误、服务开关优先级，以及共同验收 A1–A12。除绝对路径外，两份计划的源码路径均相对于各自仓库。两份计划一起审查；实施前把经审查的合成规范夹具及摘要复制到 DSH，不另造一套 API。

| Gamma Shock 需要升级 | DSH 需要升级 |
|---|---|
| 外部浏览器授权码 + PKCE、刷新/撤销、当前账号检查 | Host 授权适配器和临时回环回调；复用 `ctx.authorization` |
| 区分会员区间与会话/令牌到期时间 | 准确展示账号、模块、会员日期和服务状态 |
| 带审计的管理员桌面服务开关 | 可选的本地启用开关；权限仍以服务端为准 |
| 受保护的版本化报告列表、正文和续读 | 校验请求及响应的 Host API 客户端、原生阅读器、有界模型工具 |
| 验证现有人工开通、续期、撤权流程；不接支付 | 联系运营者和刷新权限的流程；无虚假结算或支付成功界面 |

真实 DSH 协议实现依赖 Gamma G0 夹具；Gamma G1–G4 实施期间，DSH 可以先做脚手架与假服务测试。端到端验收需要 Gamma 预发布环境、隔离 PostgreSQL/私有报告存储，以及真实 HTTP/浏览器授权。mock 测试或通用 iframe 均不能证明接入验收通过。

记录所有者选定的提交后，从已验收的 `codex/upstream-release-integration-20261018` 分支谱系建立干净 worktree 开始实施。保留主工作区未提交的修改。模块放在 `packages/experimental/desktop-gamma`；不把 Gamma 账号加入普通 DSH 首次配置，也不恢复已排除的上游 DeepSeek 账号或遥测功能。不新增包启动器：应用仍通过受支持的 `dsh` profile 启动。

<a id="user-flow-and-safeguards"></a>
## 用户流程与保护措施

1. 用户打开可选的 Gamma 设置区并明确启用。默认 `enabled=false`；没有 Gamma 或 Gamma 账号时，普通 DSH 仍然可用。
2. “绑定 Gamma 账号”启动有截止时间的 Host 授权流程，并在系统浏览器打开 Gamma。网站登录和明确同意均在 Gamma 完成。DSH 不接收网站密码或 Cookie。
3. 已绑定但未付费授权的用户看到“未开通”和运营者联系方式。运营者在系统外确认收款，再通过 Gamma 后台开通现有产品或模块时段；不创建第二份 DSH 许可。
4. “刷新权限”获取当前状态。已授权用户打开原生报告面板，选择允许访问的模块/报告，再明确点击“询问这份报告”。打开面板或刷新状态本身不触发模型调用。
5. 到期、撤权或暂停服务会阻止之后新的云端读取。网络失败显示“暂时无法核验”，不能显示为未付费。旧的成功状态不能授权读取数据。
6. 关闭 Gamma 会取消待处理工作并停止轮询；凭据保留到用户明确解除绑定。解除绑定会清除本地凭据和临时视图，网络可用时撤销远端令牌家族，并如实报告远端撤销失败。

界面状态包括：未启用、未绑定、授权中、已绑定未开通、未来生效、有效、已到期、已撤权、服务暂停、离线/无法核验，以及需要升级。令牌到期属于凭据问题；会员到期只能来自服务端授权区间。多个已授权模块的期限不同时，逐模块展示，不能虚构统一的会员到期日。桌面文案由 locale 管理，提供面向用户的中文及英文词典。

报告解读使用用户自己配置的 DSH 模型及该模型的正常计费。用户明确使用前，应说明选定报告文字将发送给该模型。Gamma 仅收到授权、状态和报告请求，不接收对话或任意用户问题。报告的发布、交易、读取时间及陈旧/缺失状态保持可见；最新发布内容不能宣称为实时行情。

撤销未来云端访问权限，不能抹除会话日志、导出、剪贴板或模型服务商已收到的内容。v1 不持久缓存报告。切换账号、解除绑定、关闭模块或确认权限拒绝时清除临时视图；保留原有历史，并明确区分先前交付的信息与新近核验的来源读取。

<a id="dsh-implementation-tasks"></a>
## DSH 实施任务

### D0 — 固定交接内容并创建双端包

**文件：** 创建 `packages/experimental/desktop-gamma/{package.json,cordis.patch.yml,tsconfig.json,tsconfig.host.json,tsconfig.client.json,tsdown.config.ts,README.md,README.zh.md}`、`src/{index,types,config}.ts`、`src/client/index.ts` 及 `tests/fixtures/desktop-v1/`；仅在需要时修改工作区/编译器注册。

1. 记录已验收的 DSH/Gamma 提交、未提交路径清单、协议夹具版本/摘要及包消费者职责。检查现有 Ask Knowledge 的双端/类型化 Remote 模式，不导入其实现。
2. 先写会失败的真实 Loader 测试：默认关闭、Client/Host 声明都可解析、缺少必需服务时明确失败。关闭时不得发云端请求、弹出账号对话框或暴露工具。
3. 声明 Host 对凭据、授权、工具、子进程/网络所有权及现有 Remote 注册机制的依赖。通过校验过的 Config 配置 `baseUrl`、请求截止时间、登录截止时间、状态刷新间隔、响应字节和工具输出限制。关闭且未配置时必须保持静默可加载，不要求云端 origin，也不尝试登录。启用时才要求运营者选定的 HTTPS origin；显式的合成回环配置仅用于测试。
4. 实现由 effect 管理的挂载/销毁生命周期，以及不依赖 Cordis 的 Client 类型。根配置仅作 solution，Host/Client 使用独立叶配置。补充 README 双语文档，说明费用、隐私、权限限制和失败恢复。提交脚手架。**退出条件：** 包可加载，无需修改产品外壳/循环代码或强迫配置 Gamma。

### D1 — 实现浏览器授权与持久凭据所有权

**文件：** 创建 `src/{authorization,callback,credential-store}.ts`、`tests/{authorization,callback,credential-store}.spec.ts` 及 `tests/loader-composition.spec.ts`；使用现有 `packages/credentials/authorization` 注册插件流程，通过 `ctx.credentials` 存储经校验的 `GrantRecord`。

1. 先加入失败控制：回环绑定失败、错误回调路径/state、未经请求的回调、重复/过期授权码、取消、插件销毁、账号替换、凭据存储不可写。仅绑定 `127.0.0.1:0`，使用 `/gamma/callback`，state 与 PKCE verifier 留在 Host 内存，并在所有结束路径关闭监听器。
2. 在所有者专属凭据键下注册一个授权流程，例如 `credentialKey('desktop-gamma', 'primary')`。在所有者校验的 grant payload 中存储 subject、origin、设备令牌家族 ID、凭据版本、令牌值和令牌到期时间。共享凭据存储是有本地文件权限保护的文件，不能假定是操作系统钥匙串；不得宣称其具备实际未提供的硬件保护或加密。
3. 复用授权通知/提示。无论 DSH 的报告链接/侧栏偏好如何，登录操作必须打开真正的外部系统浏览器。在安装后的 macOS/Windows 验证；如果通用界面会打开内嵌视图，则使用现有 Host 启动器或插件自有、严格校验的子进程启动。v1 不增加自定义 URI scheme，也不修改 Tauri Rust 逻辑。
4. 通过 `modifyRecord` 串行刷新，保留无关凭据。grant 绑定配置的 origin；切换 origin 必须解除/重新绑定，绝不把令牌转发给新服务。携带凭据的请求禁止 HTTP 重定向；不向报告链接发送凭据。兑换/轮换响应结果不确定时重新绑定，不进入重放循环。
5. 增加代次隔离：已取消、关闭或销毁的登录，不能在迟到成功后写入 grant；解除绑定后，旧的刷新请求不能恢复凭据。本地保存新 grant 失败时尽可能撤销其远端令牌家族。提交。**退出条件：** 秘密不得进入 Client Remote、日志、通知、工具输出、快照或支持导出。

### D2 — 实现只读 Host API 与类型化 Remote

**文件：** 创建 `src/{api-client,status,reports,remotes}.ts`、`tests/{api-client,status,reports,remotes}.spec.ts`；接好新包生成的 `./remote` 导出及 Client 的 `remote.desktopGamma` 注入。

1. 使用经审查夹具和真实请求驱动假的 HTTPS/HTTP 回环服务。拒绝畸形 JSON、错误 API 版本/scope/报告 ID、过大或空响应、重定向、其他 origin 的 URL、无效日期，以及不一致的续读/偏移字段。夹具中不包含真实凭据或代理设置。
2. 定义仅返回非敏感状态、开始/取消授权、启用/关闭、刷新权限、列出报告、读取报告页和解除绑定的 Remote。Remote 不接受任意 URL/header，不把客户端提供的账号 ID 视作授权依据，也不接受本地“paid=true”覆盖。凭据内部信息和授权码兑换留在 Host。仅允许认证过的本地桌面连接调用；v1 不暴露远程 Host 凭据管理服务。
3. 每次列表、正文或续读均重新请求服务端；缓存状态不能授权读取。原样使用协议 cursor，检查响应修订和偏移一致性。扣除序列化封装开销后，按当前 UI/工具预算计算服务端 `max_bytes`/`max_chars`；完整输出必须适配预算且不切断 Unicode。禁止本地裁掉一页内容，却转发会跳过未返回尾部的 cursor；连元数据都容不下时明确拒绝。
4. 关闭、解除绑定或销毁时取消请求、清除临时数据，并按账号/origin 代次隔离迟到结果。账号 A 发起的请求不能写入账号 B 的面板或工具结果。桌面解除绑定不撤销无关的 Gamma 网站会话。
5. 将认证、权限、服务、故障和版本错误映射为不同的类型化结果。仅对安全的读取请求按有界退避和 `Retry-After` 重试；不重试令牌/批准操作，不自动调用模型。提交。**退出条件：** 伪造 Client 消息或修改本地设置不能绕过 Host 执行规则。

### D3 — 增加原生设置与报告面板

**文件：** 创建 `src/client/{mount,locales,remotes,store}.ts`、`src/client/{GammaSettings,GammaPanel,GammaReport}.tsx`、`src/client/Gamma.module.css` 及 `tests/{gamma-settings,gamma-panel,gamma-report}.client.spec.tsx`；在 `apps/web/tests/gamma-cloud.e2e.ts` 增加浏览器场景，使用假 Gamma 服务及显式的测试专用启用补丁。

1. 先写会失败的组装 Client 测试，确认 `remote.desktopGamma` 在使用前声明/注入，授权可以取消，Gamma 未启用/未付费/离线时普通 DSH 正常工作。包含真实运行时挂载，捕获其他 overlay 曾出现的 Remote 未注入故障。
2. 通过现有 slot 和 UI 原语增加一个可选设置入口、一个报告面板入口。展示绑定状态、运营者联系方式、逐模块到期时间、最近核验/服务端时间、服务暂停、手动刷新和明确解除绑定。不增加结算、支付成功徽标、算法调参或自动交易控制。
3. 使用现有安全 Markdown 路径渲染已授权报告。禁止任意 HTML、脚本、iframe 执行、自动加载远程跟踪图片，以及从报告文字自动执行工具指令。列表不得泄露未授权 scope 或报告摘要。
4. “询问这份报告”只绑定非秘密的报告/scope/修订引用，并通过现有会话入口提交一次明确的用户操作。模型可见文字必须可由会话日志还原。现有用户/工具事件足够时复用；仅当新的模型输入无法还原时，才增加文档完备并经过确认的新事件。
5. 仅在模块启用且面板/设置可见时轮询状态（建议 30 秒），关闭/销毁时停止，不持久缓存报告。测试双击、重叠刷新、获取中切换账号、未来授权和过期、空列表、长表格、键盘导航及中英文布局。提交。**退出条件：** 日期与服务端授权一致，无空白成功面板，每个不可用操作都有恢复说明。

### D4 — 增加有界报告工具与会话快照验收

**文件：** 创建 `src/{tools,prompt}.ts`、`tests/tools.spec.ts`、`tests/fixtures/tool-output/`；按现有 YAML 场景发现机制增加 `snapshots/session/gamma-cloud/{snapshot.yml,cordis.snapshot.yml,session.v4.jsonl,system-prompt.expected.md,tool-schemas.expected.json}`；仅为必要的假服务启动扩展现有 harness。

1. 仅注册 `gamma_reports_list` 和 `gamma_report_read`；不提供任意抓取、执行、扫描、回测、管理、发布或交易工具。通过现有工具所有权限定注册，关闭/销毁时释放。模型工具不得发起登录、开通权限、启用模块或确认收款。
2. 实施前定义输出与呈现：报告标题/模块/时间/修订和准确返回偏移；固定拒绝码；明确完整性/续读；不含令牌、Blob 路径、管理字段或跨账号数据。使用现有工具结果路径标记外部数据；报告文字不能指挥特权操作。
3. 为已交付 profile 编写无需密钥的场景：未付费拒绝 → 人工开通夹具 → 授权读取 → 中段/末段续读 → 到期/撤权拒绝。使用本地假模型和 Gamma 服务；隔离 HOME/DSH_HOME/服务商凭据，夹具尝试真实服务商或原生 Codex 时立即失败。不能依赖 Cordis 不会替换的插件名称覆盖来实现测试隔离。
4. 加入独立控制：伪造本地启用、有效但未授权的令牌、跨账号/cursor 读取、旧报告修订、中文/astral 尾部事实、恶意报告指令、畸形响应，以及两页之间权限变化。来源区间必须定位到指定服务端投影修订的文本。
5. 工具实现与记录一起提交。**退出条件：** 验收不需要付费调用；工具结果如实区分历史内容与新授权数据、最新发布报告与实时价格。

### D5 — 联合预发布与桌面安装产物验证

**文件：** 仅为必要的运行时依赖闭包修改 `scripts/desktop-profile-plugins.json`、`apps/cli/package.json`、`pnpm-lock.yaml`；创建 `scripts/verify-gamma-installed-flows.mjs`；扩展 `scripts/verify-desktop-bundle.sh` 和原生 Windows 验证工作流；通过生成器更新配置/工具/插件目录和 README/i18n 记录。

1. 固定双端包版本，确保所有工作区 Host 依赖均可在收集后的安装运行时解析。入口保持默认关闭；Gamma 离线或未配置不能阻止 companion 就绪。不捆绑 Gamma Python 引擎、行情数据集、报告归档或服务器秘密。
2. 使用合成账号和管理员人工授权开展真实 HTTP 预发布验证：未付费绑定、开通、续期、区间空档、到期、撤权、服务关闭/重开、账号禁用、令牌轮换、全端登出、存储故障和账号切换。Gamma 政策变化不需要重新打包。保留账号/操作的准确关联，不记录令牌或个人/支付细节。
3. 源码检查通过且所有者授权打包后，才构建内部候选产物。对实际只读挂载的 DMG 和临时原生 Windows 安装验证：Gamma 关闭/不可达时仍就绪、外部浏览器/回环回调、当前授权、报告尾部读取、重启、取消和解除绑定。浏览器 mock 或 Wine 不能代替原生 Windows 证据。
4. 确认原有问知识、问数据和助手流程仍可用，companion 的确切发布身份与候选产物一致。使用现有发布元数据/签名检查；未经相应所有者指令，不替换现有安装程序、不覆盖安装用户应用、不推送、不启用生产或公开发布。
5. **退出条件：** 分别报告源码验收、联合服务端接入、macOS 安装后验收、Windows 安装后验收及公共签名。外部基础设施缺失保持未验证，不能阻止可进行的源码/mock 工作，也不能被虚构为通过。

<a id="verification-and-delivery"></a>
## 验证与交付

以下是计划中的实施命令，不是本次文档已经执行的检查。先运行新的负向控制，再运行所属套件；没有新的失败假设时，不重复已通过的广泛套件。Gamma 命令由服务端计划负责。

```bash
pnpm exec vitest run packages/experimental/desktop-gamma/tests --maxWorkers=1
pnpm exec tsc -p packages/experimental/desktop-gamma/tsconfig.host.json --noEmit
pnpm exec tsc -p packages/experimental/desktop-gamma/tsconfig.client.json --noEmit
pnpm run test:snapshot -t gamma-cloud
pnpm run test:web:built apps/web/tests/gamma-cloud.e2e.ts
pnpm run verify-client-ui-i18n
pnpm run verify-export-jsdoc
pnpm run verify-no-unknown-casts
pnpm run verify-upstream-intake
pnpm run test:docs
git diff --check
```

现有脚本分别通过 `vitest.snapshot.config.ts` 和 `vitest.web.config.ts` 启动 Vitest。把新浏览器测试加入 Host 编译器，并从 Web Client 编译器排除。会话快照命令只回放会话场景；浏览器记录使用浏览器测试通道。生成器输入改变时刷新相应目录并检查其时效。另行授权推送前遵循 `dsh-pre-push-checks`；仅记录实际执行的命令和退出码。

审查与交付顺序：批准 Gamma 服务端计划、本 DSH 计划及夹具版本 → 服务端 G0–G4 / DSH D0–D4 → 真实联合预发布 → 服务端 G5 / DSH D5 → 所有者决定打包和上线。默认关闭的服务开关是回滚入口；关闭/卸载插件会保留会话、之前收到的报告副本和现有 DSH 功能。计划阶段不进行生产授权、真实收款、真实模型调用、部署或安装包发布。

验收证据必须标明源码提交、规范夹具摘要、准确命令/退出码、原生操作系统、模型/网络隔离、实际安装产物摘要、运营操作、观察到的错误及未执行检查。即使单元测试通过，Required 级授权/取消/数据泄漏问题仍阻止接入验收。共同 A1–A12 仍由 Gamma 计划拥有。

<a id="dev-note"></a>
## 开发备注

本计划假设现有 Gamma 会员权限同时适用于桌面，v1 只消费已发布报告。建议的时间/大小默认值，以及具体 OAuth 组件需在 Gamma G0 审查。生产 Gamma origin/支持联系方式、预发布凭据、测试数据库/存储，以及签名/原生 Windows 基础设施，必须通过现有运营渠道提供；本次计划不虚构这些信息，也不读取真实秘密文件。
