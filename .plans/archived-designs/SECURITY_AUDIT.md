# DeepSeek Harness 安全整改计划

> 状态：待实施
> 复核基线：`47f943859bef60e4160492346772ded9b24f765a`（2026-08-15）
> 审查方法：第一方源码、配置、测试和现行 Agent Notes 的静态复核；未读取真实凭据，未对宿主或外部系统执行利用测试
> 审查范围：`packages/`、`native/`、`apps/`、`examples/` 和根配置；`vendor/` 由 [vendoring policy](vendor/README.md) 管理，不在本次逐文件审查范围内

本计划把原安全审查转换为可分批交付的整改工作。目标是在首个正式版本前建立统一的读权限、网络出口、API 认证和可执行内容信任规则，并为每条安全不变量增加可重复的负向测试。

## 结论

| 编号 | 严重度 | 默认暴露 | 结论 | 处理优先级 |
|---|---|---:|---|---:|
| SEC-01 | 严重 | 是 | 模型进程可读取工作区外文件，`tool-fs-search` 也可直接搜索任意路径；默认沙箱不限制网络出口，因而可形成凭据读取与外传链 | P0 |
| SEC-02 | 高 | 是，Web 模式 | 环回 API 只有 Host、Origin 和 Fetch Metadata 检查，没有调用方认证；本地不受信任进程仍可调用 RPC | P0 |
| SEC-03 | 高 | 否，fetch 默认关闭 | HTTP fetch provider 没有阻止私网、环回、链路本地和 DNS rebinding 类型的 SSRF | P1 |
| SEC-04 | 高 | 否，Cordis 预设或高级示例 | host-only 动态包激活不请求批准，`ctx.get()` 可读取未声明服务；`node:vm` 本身不是安全隔离 | P1 |
| SEC-05 | 中 | 是 | 项目 skill 默认可被模型发现和加载，项目内容能够把指令直接带入模型上下文，来源信息没有完整进入目录、正文和批准界面 | P1 |
| SEC-06 | 中 | 条件触发 | PTY 已阻止存活期间切换沙箱模式，但普通后台进程没有共享的策略租约，旧进程可能继续使用启动时权限 | P2 |

P0 是正式发布阻断项。P1 在对应能力保持默认关闭时可以独立交付，但不得在整改完成前扩大默认暴露面。P2 必须在增加新的读权限或网络权限状态前完成设计，在正式发布前完成实现。

## 复核后的事实修正

- 文件读取问题不只存在于 `tool-fs` 和 bash。[`tool-fs-search`](packages/fs/tool-fs-search/src/search-core.ts) 通过 subprocess 直接启动打包的 ripgrep，`grep.path` 和 `glob.path` 可接收任意绝对路径，因此它当前绕过 [`fs-sandbox`](packages/fs/fs-sandbox/src/index.ts) 的文件策略。
- Cordis 动态执行面不再只属于 `examples/web-cordis`。[Web app bundle](packages/bundle/web-app/cordis.patch.yml) 挂载 host runner，正式 CLI 还提供可选的 [Cordis agent preset](apps/cli/config/agent-presets/cordis/agent.cordis.yml)；标准预设不挂载 `tool-cordis`。
- 不把“移除少量 host-realm 对象”列为 `node:vm` 修复方案。[runner 的沙箱说明](packages/extensions/cordis-host-runner/src/sandbox.ts) 已明确它不是安全边界；本计划把 Cordis 动态代码定义为与 bash 等价的高权限能力。如果产品需要运行不可信插件，必须另立项目改为进程外执行和能力代理。
- 环回 API 已把 settings、credentials、原生动作、预设编写和模型发现等高权限方法固定到 loopback，但 [`api-request-trust`](packages/client/connection/src/api-request-trust.ts) 明确不是认证。能够连接 loopback 的模型进程仍满足当前检查。
- 当前 CLI 已拒绝 `--host 0.0.0.0`，并有 [built CLI test](apps/cli/tests/built-bin.e2e.ts) 固定该行为。自定义组合仍可监听所有接口，但这不是当前 CLI 默认缺口；在 API 认证完成前继续保持 CLI 禁止。

## 威胁模型

以下输入均视为不可信：模型生成的工具参数、仓库内容、项目级 skill、网页和工具输出、MCP 或 hook 返回值，以及与 harness 同一用户身份运行但没有取得用户批准的本地进程。

以下动作才可扩大权限：用户对当前调用作出的明确批准，或部署者在配置中作出的明确选择。批准必须说明资源、权限类型、持续时间和触发来源；缺少 answerer 时继续 fail-closed。

环回地址、同一 Unix 用户、同源浏览器请求和 `node:vm` 都不是身份或安全隔离。安全属性必须由可执行的文件策略、网络策略、认证凭据和服务声明规则提供。

本计划不尝试通过提示注入检测证明内容安全。提示注入只能通过缩小能力、标记来源、要求批准和隔离高影响操作来降低后果。

## 目标安全不变量

1. 文件写权限、文件读权限和网络权限是三个独立维度；扩大其中一个维度不会隐式扩大另外两个维度。
2. 默认模型调用只能读取工作区和运行命令必需的系统文件，且不能读取已登记的凭据路径；默认模型进程不能访问网络，包括 loopback。
3. `tool-fs`、`tool-fs-search`、bash、后台作业和 PTY 对同一会话解析出相同的有效策略；没有支持完整策略的 provider 时拒绝执行。
4. Web API 的每个 HTTP RPC 和 WebSocket upgrade 都在进入 Typert 或 fallback 路由前完成认证；Host、Origin 和 Fetch Metadata 检查保留为独立的 DNS rebinding 与 CSRF 防线。
5. host-mediated web fetch 只能连接校验并绑定后的公网地址，每次重定向重新执行同样检查。
6. 动态 Cordis host 代码在每次激活前取得明确批准，且运行时只能读取 `inject` 声明的服务。
7. 项目 skill 默认只允许用户显式调用；项目文件不能自行把该 skill 提升为 model-invocable。
8. 长生命周期进程持有策略租约时，会话不能切换任何会造成策略解释不一致的权限状态。
9. 所有进入模型请求的安全策略、批准结果和内容来源都可从 session log 重建，但认证令牌和凭据值永不进入日志、错误、快照或模型上下文。

## 已验证的现有控制

- [`api-request-trust`](packages/client/connection/src/api-request-trust.ts) 对 HTTP 和 WebSocket 路径实施 Host、Origin 与 Fetch Metadata 检查，并阻止未经声明的非 loopback Host。
- [`subprocess`](packages/subprocess/subprocess/src/index.ts) 清洗名称包含 `KEY`、`PASSWORD`、`SECRET` 或 `TOKEN` 的继承环境变量；local provider 还使用私有 spill 目录、独占创建和进程树终止。
- [`credentials-local`](packages/credentials/credentials-local/src/index.ts) 对凭据文件和目录实施权限检查与写锁。其 README 正确声明这不能防止同一用户身份下的模型工具读取文件。
- [`sandbox-local`](packages/sandbox/sandbox-local/src/index.ts) 在找不到可用文件写隔离后端时 fail-closed，不静默回退到裸命令。
- [`user-approval`](packages/interaction/user-approval/src/index.ts) 在没有 answerer 时 fail-closed。
- [`terminal-bash`](packages/terminal/terminal-bash/src/index.ts) 通过 `confine()` 启动 PTY，并在存活 PTY 存在时阻止当前沙箱模式切换。
- [`session-persistence-jsonl`](packages/session/session-persistence-jsonl/src/index.ts) 对持久化路径执行 realpath 校验。

## 目标设计

### 统一执行策略

扩展现有 [`SandboxExecutionPolicy`](packages/sandbox/sandbox/src/index.ts)，保留 `SandboxMode` 作为文件修改权限，并增加独立的读权限和网络权限判别字段。建议使用 `readAccess: 'workspace' | 'host'` 和 `networkAccess: 'deny' | 'full'`；最终命名可以在实现 PR 中调整，但不得把新权限重新折叠进 `danger-full-access`。

`readAccess: 'workspace'` 允许工作区与后端声明的运行时只读根，拒绝用户目录中的其它文件；已登记的敏感路径具有更高优先级，即使它位于工作区内也拒绝读取。`readAccess: 'host'` 仍不隐式允许敏感路径；读取敏感路径需要一次性、列出规范化目标的单独批准。

`networkAccess: 'deny'` 阻止所有出站连接和 loopback；需要网络的 shell 命令使用一次性批准重试。Web search、web fetch 和其它 host-mediated provider 不通过模型子进程出网，它们各自执行自己的 URL、SSRF、凭据和审计规则。

[`sandbox-policy`](packages/sandbox/sandbox-policy/src/index.ts) 是策略解析的唯一所有者。`tool-fs`、search、bash、后台作业和 terminal 都消费完整的已解析策略，不得在各工具内部添加不一致的默认值。

### Web API 认证

Web app 每次启动生成至少 256 bit 的随机、进程内 bearer secret，并使用 branded 类型跨包传递。静态 HTML、`DSH_WEB_URL`、session log、配置输出和普通 API 错误不得包含该 secret。

启动器只向可信用户输出带 URL fragment 的配对 URL；fragment 不发送给 HTTP server。浏览器读取后立即清理地址栏，并在当前浏览器会话内保存凭据。HTTP RPC 使用 `Authorization: Bearer`；WebSocket 使用专用 `Sec-WebSocket-Protocol` 值，避免把 secret 放入查询字符串和访问日志。

认证检查位于 `/api` HTTP 和 WebSocket 的共同最外层。tokenless 静态页面可以加载，但不得读取或修改任何 RPC 状态；没有有效凭据的 API 请求返回固定的 401/403 响应，不泄漏方法是否存在。

### 可执行内容信任

Cordis host package 是批准后运行的宿主代码，不宣称 `node:vm` containment。批准卡显示包名、host/client 组成、声明的服务和“等同宿主 shell 代码”的风险；host-only 与含 client 的包使用同一批准流程。

Skill registry 已有 `source` 和 `invocation` 数据，整改应把根来源策略作为 frontmatter 之上的上限。项目根默认 `modelInvocable: false`、`userInvocable: true`；恶意项目 frontmatter 不能覆盖该上限。可信部署可以通过经过 schema 验证的配置显式允许项目 skill 的模型调用。

## 实施顺序与依赖

| 阶段 | 工作流 | 依赖 | 可并行关系 |
|---|---|---|---|
| A | WS-00 安全测试基线 | 无 | 必须先完成 |
| B | WS-01 读权限、WS-02 网络出口、WS-03 API 认证 | WS-00 | 三项相互独立，可分别提交 |
| C | WS-04 fetch SSRF | WS-00；启用 fetch 前必须完成 | 可与阶段 B 开发，但不能借网络沙箱替代 provider 防护 |
| D | WS-05 Cordis 信任、WS-06 skill 信任 | WS-00 | 两项相互独立 |
| E | WS-07 长生命周期策略租约 | WS-01 和 WS-02 的策略字段稳定 | 完成后才能增加新的运行期策略切换入口 |
| F | WS-08 发布验证与文档收口 | 前述工作流全部完成 | 发布阻断 |

独立工作流使用独立 PR；不要为了方便把所有安全变更压成一个提交。每个非平凡 PR 同步更新受影响 README、JSDoc、双语文档和一份未归档 Agent Note，并按仓库规则补齐 unit、e2e 和 keyless snapshot 证据。

## WS-00：建立安全测试基线

目标是先把当前可利用行为和目标拒绝行为写成安全、可重复的测试，不读取开发者真实 home、环境变量或凭据。

实施任务：

1. 在临时 home、临时工作区和临时 loopback server 中创建假凭据与 canary；所有测试显式覆盖 `HOME`、`DSH_HOME` 和服务端口，不访问真实用户目录。
2. 为 `tool-fs`、`tool-fs-search`、bash 和 PTY 增加共同的安全用例表：工作区普通文件可读、工作区 `.env` 被拒绝、工作区外普通文件按读权限决定、登记凭据始终需要精确批准。
3. 为 shell 和后台作业增加默认无法连接 loopback 与公网测试；批准后的单次调用可连接，后续调用恢复默认拒绝。
4. 为 `/api` HTTP 与 WebSocket 增加无凭据、错误凭据、有效凭据和 Host/Origin 组合测试。
5. 为 SSRF 建立本地 DNS/HTTP fixture，覆盖直接 IP、域名解析、重定向、双栈地址和 DNS 结果变化，不连接云元数据或真实私网目标。
6. 在 Agent Note 中记录威胁主体、权限维度、默认值、平台支持矩阵和不测试真实凭据的规则。

验收标准：测试在修复前只因预期的安全断言失败；fixture 退出后不留下进程、端口或文件；失败输出不包含 canary 值。

## WS-01：统一文件读权限并封闭 search 绕过

主要文件：[`packages/sandbox/sandbox`](packages/sandbox/sandbox/)、[`packages/sandbox/sandbox-policy`](packages/sandbox/sandbox-policy/)、[`packages/sandbox/sandbox-local`](packages/sandbox/sandbox-local/)、[`packages/fs/fs-sandbox`](packages/fs/fs-sandbox/)、[`packages/fs/tool-fs`](packages/fs/tool-fs/) 和 [`packages/fs/tool-fs-search`](packages/fs/tool-fs-search/)。

实施任务：

1. 在 sandbox Service Definition 中增加读权限、敏感路径拒绝列表和一次性精确授权的数据类型；在 `sandbox-policy` Config 中提供经过验证的部署默认值，并把完整策略记录为 model-visible session context。
2. 由 credentials、`.env` provider 和部署配置贡献规范化敏感路径；拒绝规则优先于 workspace 允许规则。不要把固定文件名黑名单作为唯一防线。
3. 为 bwrap、Landlock、Seatbelt 和 Windows provider 实现并报告读策略完整度。运行时系统根只允许执行命令所需的只读文件；任一平台只能部分执行承诺时，标准安全配置必须 fail-closed。
4. 让 `fs-sandbox` 对 read、stat、list 和其它可观察内容的入口使用同一个规范化策略；保留已文档化的 symlink TOCTOU 取舍，不扩大允许窗口。
5. 让 `tool-fs-search` 停止启动不受策略约束的 ripgrep。可以通过完整 `ctx.sandbox.confine()` 运行 rg，或改为消费支持策略的 filesystem provider；无论选择哪条路径，绝对路径和 symlink 都必须得到与 `tool-fs` 相同的结果。
6. 为读权限升级增加独立的批准目标和 UI 呈现；批准必须显示规范化路径，不能由 shell 字符串猜测要读取的文件。
7. 更新 sandbox、fs、search、credentials 和工具 README/JSDoc，明确 0600 只防其它 OS 用户，真正的模型隔离来自读策略。

验收标准：默认模式下，模型工具无法读取临时 home 中的 canary、项目 `.env` 或登记凭据；不能通过 glob、grep、symlink、目录读取、bash 或 PTY 获得同一内容；普通工作区源码仍可读；精确批准只对当前调用和批准路径生效。

定向验证：

```sh
pnpm exec vitest run packages/sandbox/sandbox/tests packages/sandbox/sandbox-policy/tests packages/sandbox/sandbox-local/tests packages/fs/fs-sandbox/tests packages/fs/tool-fs/tests packages/fs/tool-fs-search/tests
pnpm run typecheck
pnpm run doc-sync
```

## WS-02：默认阻止模型进程网络出口

主要文件：[`packages/sandbox/sandbox`](packages/sandbox/sandbox/)、[`packages/sandbox/sandbox-policy`](packages/sandbox/sandbox-policy/)、[`packages/sandbox/sandbox-local`](packages/sandbox/sandbox-local/)、[`packages/shell/tool-bash`](packages/shell/tool-bash/) 和 [`packages/terminal/terminal-bash`](packages/terminal/terminal-bash/)。

实施任务：

1. 在现有 process-confinement capability seam 中加入独立网络判别字段，不创建只有一个角色的新 capability seam，也不让文件模式暗含网络权限。
2. 为每个平台 provider 实现默认 deny，包括 loopback、IPv4、IPv6 和子进程继承；bwrap、Seatbelt、Landlock 或 Windows 后端不能完整执行时必须报告 `partial`，安全配置的 consumer 随即拒绝启动。
3. bash、后台作业和 PTY 使用同一 resolved policy；批准网络后只重试当前调用，不更改会话默认值，也不沿用到后续后台进程。
4. 为批准卡增加网络权限、目的说明和持续时间；不得尝试从 shell 文本推断域名白名单。
5. 保留 web capability 作为受控 host-mediated 网络入口，并在文档中解释 shell 网络批准与 web provider 策略是两层独立控制。

验收标准：默认 shell、后台作业和 PTY 不能连接测试 loopback server、Unix socket 转接器或外部网络；一次批准不会改变文件读写权限；平台不支持完整网络隔离时操作 fail-closed，而不是退回裸命令。

定向验证：

```sh
pnpm exec vitest run packages/sandbox/sandbox/tests packages/sandbox/sandbox-policy/tests packages/sandbox/sandbox-local/tests packages/shell/tool-bash/tests packages/terminal/terminal-bash/tests
pnpm run test:snapshot -- -t bash
pnpm run typecheck
```

## WS-03：为环回 API 增加每次启动认证

主要文件：[`packages/client/connection`](packages/client/connection/)、[`packages/bundle/web-app`](packages/bundle/web-app/) 和 Web client 启动代码。

实施任务：

1. 生成每次进程启动唯一的高熵 secret，并定义 branded 认证类型；使用 constant-time 比较，停止时清除内存引用。
2. 在 HTTP bridge 和 WebSocket upgrade 的共同入口验证凭据，再解析 RPC method 或建立 downlink；现有 Host、Origin、Fetch Metadata 和 privileged-method loopback 检查继续执行。
3. HTTP client 发送 bearer header，WebSocket client 发送专用 subprotocol；服务端不接受 URL query token。
4. 用 URL fragment 完成首次浏览器配对，读取后立即清理地址栏。token-bearing 启动 URL 只面向人类，不进入 `ctx.shellEnv`、`DSH_WEB_URL`、session log、静态 HTML、错误或 telemetry。
5. 明确重载和重连语义：同一浏览器会话可以重连；新浏览器或丢失会话凭据后必须重新使用启动器提供的配对入口。
6. 未认证静态页面显示可操作的配对提示；API 对未知 method 和已知 method 返回相同的未认证响应。
7. 更新 connection/web-app README、API trust Agent Note、用户启动文档和 Web snapshots。

验收标准：本地 curl 即使提供正确 loopback Host 也不能访问任何 RPC；抓取静态 HTML 不能得到 secret；有效浏览器完成 HTTP 和 WebSocket 流程；重连不把 secret 写入日志；现有 DNS rebinding 与 CSRF 负向测试继续通过。

定向验证：

```sh
pnpm exec vitest run packages/client/connection/tests packages/bundle/web-app/tests
pnpm run test:web:built -- apps/web/tests/shipped-composition.e2e.ts
pnpm run typecheck
pnpm run doc-sync
```

## WS-04：阻止 web fetch SSRF

主要文件：[`packages/web/web-fetch-http/src/policy.ts`](packages/web/web-fetch-http/src/policy.ts)、[`provider.ts`](packages/web/web-fetch-http/src/provider.ts) 和 [`fetch-http.spec.ts`](packages/web/web-fetch-http/tests/fetch-http.spec.ts)。

实施任务：

1. 对每个目标解析全部 A/AAAA 地址，并拒绝任意非公网结果，包括 unspecified、loopback、private、link-local、carrier-grade NAT、multicast、documentation/reserved 和 IPv4-mapped IPv6。
2. 把通过校验的 IP 绑定到实际连接；禁止“先解析校验、随后由通用 fetch 再解析”的 DNS rebinding TOCTOU。优先采用维护中的传输或 IP 地址库，避免自写不完整地址解析器。
3. 手动处理每一次重定向，对新 URL 重复 scheme、credential、port、DNS、IP 和连接绑定检查；达到跳数上限后失败。
4. 明确代理策略。默认不继承环境代理；如果未来支持代理，代理本身和最终连接分别受配置与审计约束。
5. 错误只返回分类和安全目标信息，不回显响应体中的凭据或内部服务内容。
6. 在 SSRF 测试完成前保持 base bundle 和所有正式预设 `fetch: false`。

验收标准：测试覆盖 IPv4/IPv6 文本变体、混合 DNS 结果、重定向到私网、解析结果切换和允许的公网 fixture；任何一个解析地址不安全即拒绝；实际连接只能使用已验证地址。

定向验证：

```sh
pnpm exec vitest run packages/web/web-fetch-http/tests/fetch-http.spec.ts
pnpm run test:snapshot -- -t web-fetch
pnpm run typecheck
pnpm run doc-sync
```

## WS-05：统一 Cordis 动态代码批准与服务声明

主要文件：[`packages/extensions/cordis-host-runner`](packages/extensions/cordis-host-runner/)、`packages/extensions/tool-cordis/`、[Cordis preset](apps/cli/config/agent-presets/cordis/agent.cordis.yml) 和相关 advanced examples。

实施任务：

1. 删除 host-only 快速激活分支；所有包含 host code 的 package 在 activation 前走同一个 approval request，没有 answerer 时 fail-closed。
2. 批准记录包含 package identity、代码摘要、host/client 组成、声明的 `inject` 服务和调用来源；批准只绑定当前代码摘要，代码变化后重新批准。
3. 把 `ctx.get(name)` 改为与属性读取相同的声明检查，未在 `inject` 中声明的服务返回稳定错误；为 credentials、subprocess、settings 和 web 增加负向测试。
4. 保留 `node:vm` 作为兼容执行机制，但从文档和 UI 中删除任何隔离暗示，明确批准等同宿主代码执行。不要通过删减少数 globals 宣称修复 VM escape。
5. 若批准是 model-visible 决策，按 “model-visible ⟺ logged” 记录批准结果和代码摘要，不记录源码中可能存在的 secret。
6. 更新 [self-referential Cordis Agent Note](.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md)、runner/tool README、Cordis preset 文案和 assembled snapshots。

验收标准：host-only、client-only 和 mixed package 的批准行为一致；无批准不产生任何 host effect；未声明 `ctx.get()` 失败；批准旧摘要不能激活新代码；标准预设仍不暴露 `tool-cordis`。

定向验证：

```sh
pnpm exec vitest run packages/extensions/cordis-host-runner/tests packages/extensions/tool-cordis/tests
pnpm run test:web:built -- apps/web/tests/cordis-tool-round.e2e.ts
pnpm run test:snapshot -- -t code-mode
pnpm run typecheck
pnpm run doc-sync
```

## WS-06：限制项目 skill 的模型调用并传播来源

主要文件：[`packages/skill/skill`](packages/skill/skill/)、[`skill-filesystem`](packages/skill/skill-filesystem/)、[`tool-skill`](packages/skill/tool-skill/) 和 skill Web UI/tests。

实施任务：

1. 在 filesystem provider 配置中增加按来源的模型调用策略；`project-dsh` 和 `project-agents` 默认禁止 model invocation，但保持 user invocation。配置 schema 必须允许可信部署显式开启，不能用测试钩子或硬编码旁路。
2. 合并 invocation policy 时使用来源上限与 skill frontmatter 的交集；项目文件不能把 provider 禁止的 `modelInvocable` 改为 true。
3. 把 `source`、provider 和安全化后的路径/资源根加入 model catalog 的 durable entries、skill body framing、工具返回和人类可见 UI；路径必须经过现有转义与呈现规则。
4. 用户显式 `/<skill>` 继续只接受真实 user source，并保持 deterministic pre-step 注入。外部网页、工具输出和模型文本不能伪造这一手势。
5. 批准界面显示触发操作关联的 skill/tool 来源；文档明确普通工具输出仍可能包含提示注入，安全性来自能力控制而非内容分类器。
6. 更新 [skill invocation policy Agent Note](.agents/notes/implemented/feature/2026-07-28-skill-invocation-policy.md)、[user-explicit invocation Agent Note](.agents/notes/implemented/feature/2026-08-08-user-explicit-skill-invocation.md)、README 和 snapshots。

验收标准：克隆带恶意 project skill 的仓库不会把该 skill 放入模型目录；用户显式调用仍可加载；部署配置开启后才允许模型加载；catalog、session log 和 UI 对同一 skill 报告一致来源。

定向验证：

```sh
pnpm exec vitest run packages/skill/skill/tests packages/skill/skill-filesystem/tests packages/skill/tool-skill/tests
pnpm run test:web:built -- apps/web/tests/skill-invocation-policy.e2e.ts apps/web/tests/skill-user-invoke.e2e.ts
pnpm run test:snapshot -- -t skill
pnpm run typecheck
pnpm run doc-sync
```

## WS-07：用策略租约覆盖所有长生命周期进程

主要文件：[`packages/sandbox/sandbox-policy`](packages/sandbox/sandbox-policy/)、[`packages/shell/tool-bash/src/background.ts`](packages/shell/tool-bash/src/background.ts)、[`packages/terminal/terminal-bash`](packages/terminal/terminal-bash/) 和 permission preset consumer。

实施任务：

1. 把 `setSandboxMode(session, mode)` 的直接写路径收进 `SandboxPolicyService`，由 service 统一检查状态、写事件并暴露 disposer-based policy lease API。
2. 每个后台 bash job、PTY 和其它跨调用存活的 confined process 在 spawn 前取得租约，进程树完全退出后释放；启动失败、abort、kill 和 teardown 都必须释放。
3. 任何会改变有效 file、read 或 network policy 的会话状态更新，在租约存在时返回结构化拒绝；不要在 terminal 中继续维护独立事件拦截器。
4. 清点 subprocess、workflow、subagent 和远程 sandbox provider 的长生命周期用法；没有长生命周期行为的 consumer 在 Agent Note 中明确排除理由。
5. 用并发测试固定 spawn/transition、transition/exit 和 teardown race，运行时不依赖 service 或 method presence 作为不变量。

验收标准：任一长生命周期进程存活时策略切换失败并指出占用类型；最后一个 lease 释放后切换成功；异常和取消路径无泄漏；session replay 重建最终策略而不重建已结束 lease。

定向验证：

```sh
pnpm exec vitest run packages/sandbox/sandbox-policy/tests packages/shell/tool-bash/tests packages/terminal/terminal-bash/tests packages/interaction/permission-presets/tests
pnpm run test:snapshot -- -t permission
pnpm run typecheck
pnpm run doc-sync
```

## WS-08：发布验证与文档收口

实施任务：

1. 按 [pre-push checks](.agents/skills/dsh-pre-push-checks/SKILL.md) 为每个 PR 运行与改动面对应的 focused tests、snapshot、typecheck、build、hygiene 和 docs gates；不要以一次全仓测试替代定向证据。
2. 在 macOS、Linux 和 Windows CI 分别运行真实后端负向测试。平台只能报告 `partial` 而 consumer 仍执行命令时，P0 不得关闭。
3. 运行 keyless assembled snapshots，确认批准卡、skill 来源、网络拒绝、API 配对和 Cordis 激活对用户可见，并可从 session log 重放。
4. 运行 `pnpm run test:coverage` 作为 CI coverage gate；本地只在 CI 诊断或明确要求时复跑全量 coverage。
5. 运行 `pnpm run doc-sync`、`pnpm run website:build` 和 `git diff --cached --check`；同步所有受影响 README、JSDoc、Agent Notes 和中英文文档。
6. 更新本文件状态表，只在负向测试、平台矩阵和文档全部通过后把项目标记为完成；保留被接受风险及其依据。

发布退出条件：SEC-01 与 SEC-02 在所有正式支持平台关闭；SEC-03 至 SEC-06 关闭或对应能力保持不可启用；SEC-07 完成；CI 没有安全相关跳过；任何测试、日志、snapshot 和错误输出都不包含 fixture secret。

## 接受或暂缓的风险

- `fs-sandbox` 检查到委托之间仍有 symlink TOCTOU 窗口。现有实现已在 [`fs-sandbox`](packages/fs/fs-sandbox/src/index.ts) 记录该取舍；WS-01 不扩大窗口。若威胁模型加入并发恶意本地进程，需要改用 descriptor-relative OS API，另立设计。
- `node:vm` escape 不作为独立待修漏洞，因为 Cordis host code 被明确归类为批准后的宿主代码。未取得批准的代码能激活，或代码能读取未声明服务，仍分别由 SEC-04 跟踪。
- 自定义组合监听非 loopback 继续属于部署者选择；CLI 在 API 认证上线前保持拒绝 `0.0.0.0`。完成 SEC-02 后才能重新评估远程监听、TLS 和多用户授权，它们不由 bearer token 自动解决。
- 工具和网页输出中的提示注入无法由本计划消除。整改完成的含义是恶意内容不能在没有独立批准或策略允许的情况下扩大文件、网络、API、插件或 skill 权限。
