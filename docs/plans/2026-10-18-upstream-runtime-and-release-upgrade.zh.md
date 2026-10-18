# 上游运行时与发布安全升级实施计划

> **实施者须知：** 获得负责人批准后，使用 `superpowers:executing-plans` 逐项执行本计划。

[English](2026-10-18-upstream-runtime-and-release-upgrade.md) | 中文

**状态：** 负责人已授权在修正审查意见后实施。运行时与发布两组独立验收；发布、覆盖应用和付费提供方调用仍须另行决定。

**目标：** 将七项选定的上游运行时/界面改进与四项桌面/凭据工作整合到 Octopus，保留 Tauri 应用、现有插件和优先配置 API Key 的使用方式。

**架构：** 以已验证的分支发布版本为基础，在隔离分支回移固定上游版本的行为。安装与发布机制适配本项目脚本；账号整合、远程策略、遥测收集、托管服务和 Electron 不在升级范围。验证同时覆盖包的调用方与打包后的 Tauri 入口。

**技术栈：** TypeScript、Cordis、React、pi-ai、Vitest、Rust/Tauri、NSIS、PowerShell、GitHub Actions，以及现有 macOS 应用包验证器。

## 摘要

用户将获得更可靠的网页搜索、Codex 委派、模型设置、插件刷新和桌面升级。维护者将获得可验证的产物身份、可恢复的发布流程，以及内部构建与签名公开发布的明确区分。签名凭据仍是外部前提；不得伪造证书，不得将未签名产物判为可公开发布。

## 目录

- [范围与决策](#scope-and-decisions)
- [基线与整合策略](#baseline-and-integration-strategy)
- [实施任务](#implementation-tasks)
- [验收与交付](#acceptance-and-delivery)
- [开发备注](#dev-note)

<a id="scope-and-decisions"></a>

## 范围与决策

采用核对依赖后的定向回移。整体合并上游会引入被排除的产品行为；只复制可见修改行又会遗漏提供方、类型、配置组合与测试。每项批准行为只引入完整且最小的依赖集合，应用前记录所有新增前置依赖。

| ID | 批准行为 | 处理方式 |
|---|---|---|
| U1 | DeepSeek Search/Fetch API | 新增可选提供方与设置；保留现有搜索/抓取默认值。 |
| U2 | 关闭辅助搜索的思考模式 | 包含 Messages 搜索请求的独立修复。 |
| U3 | 从 schema 读取模型推理设置 | 保留本项目 pi-ai 版本、补丁、提供方和持久化值。 |
| U4 | Codex `partial_answer` | 接受该消息阶段，但不把它当作任务成功完成的证明。 |
| U5 | 技能菜单缓存刷新 | 插件变化后清除已打开会话的目录，阻止旧的进行中请求恢复过期缓存。 |
| U6 | 右侧栏溢出 | 阻止键盘操作导致页面框架位移，同时保留浮动面板显示。 |
| U7 | Client/Host 发布版本兼容 | 在解释或安装新模块图之前阻止跨发布版本更新。 |
| D1 | Windows 安装器恢复 | 将有限次文件锁重试、回滚保留和有效诊断适配到 Tauri NSIS。 |
| D2 | 发布身份与签名资格 | 将产物绑定到准确构建次数；区分内部构建与公开发布。 |
| D3 | 安全发布 | 先发布已验证的不可变二进制，再更新发布元数据；支持中断续发。 |
| D4 | 凭据改进 | 采用已保存密钥优先、真实认证提示，以及安全保留凭据文件的无关字段。 |

签名策略归入 D2。D3 针对本地测试传输与显式配置的本项目 GitHub 发布目标实现安全机制；不增加自动更新器，也不在开发期间发布版本。首个产物目标选用 GitHub，因为本项目已经在那里构建和保留 Windows 产物；Gitee 源码镜像保持现状。

排除：Electron、DeepSeek 账号引导/通知堆叠、账号默认配置、设备/产品分析、上游收集端、COS 部署、强制更新服务、自托管 Windows runner 监管、无关上游功能及替换 Tauri 外壳。保留遥测默认关闭与现有禁止端点检查。本次升级不修复或重新提取已有用户 Wiki，不调用付费提供方，不修改真实凭据，也不移除文档。

<a id="baseline-and-integration-strategy"></a>

## 基线与整合策略

上游来源上限固定为标签 `dsh-v0.2.1-rc.2`。准确来源/基线提交 ID、标签引用类型与源文件哈希记录在 `.plans/upstream-runtime-release-2026-10-18/source-inventory.json`，不写入维护型正文。之后重新获取远端时不得悄然提高来源上限。

主检出目录目前有大量无关修改。已验证发布位于 `fork/codex/ask-knowledge-task7-20261017`，并有独立的现存发布 worktree。核对本地/远端 tip 后，从该版本新建实施 worktree；不得占用现有 worktree、stash 用户修改，或从较旧的主目录 HEAD 开始。发布 tip 若发生变化，须先审查新增差异并更新已记录基线。未提交的助手/输入框/语音工作不属于本次回移；如需整合，应单独审查。

[此前的选择性升级计划](2026-10-06-upstream-selective-upgrade.md)负责推进 `UPSTREAM_PIN`。现有引入登记表仍记录 `dsh-v0.2.1-alpha.1`。保留该整体上游基线：选择性回移不代表已完整整合至 rc.2。在 `BACKPORTS` 中增加 `BackportEntry`，记录项目 ID、来源标签、来源提交、处理方式、所属路径、前置依赖与验证引用，并增加新鲜度检查，区分引入、适配、已存在、前置依赖和排除项。继续执行现有策略检查，单独记录继承的失败。

| 行为 | 上游检索入口 | 主要依赖关注点 |
|---|---|---|
| U1/U2 | PR #6103 | Web 服务、提供方包、设置控制器、配置包组合及端点/认证诊断。 |
| U3 | PR #6261 及推理编辑器后续修复 | 本项目尚缺完整编辑器；schema 与提供方元数据前置依赖须一起引入。 |
| U4 | PR #6272 | 消息解析、答案选择、取消/失败结果与子进程夹具。 |
| U5 | PR #6275 | 转发的插件管理事件、类型依赖、缓存生命周期和 Loader 重载顺序。 |
| U6 | PR #6353 | 右侧栏 CSS、DockSurface 前提及浏览器键盘/几何夹具。 |
| U7 | rc.2 之前的 Host 发布变化相关提交 | 启动模块图的产生/解析、更新协调、重载提示及随包构建身份。 |
| D1 | PR #6227 及恢复诊断后续修复 | 上游自定义安装器与 Tauri 生成的 NSIS 安装器不同。 |
| D2/D3 | rc.2 之前的保留产物发布与构建任务身份相关提交 | 准确 run/attempt 身份、签名验证、不可变对象与渠道并发。 |
| D4 | PR #5483 与 PR #6121 | 凭据来源顺序、全部调用方、headless 组合、pi-ai 原生认证及文件保留。 |

PR 标号仅用于检索。在固定标签下解析真实 Git 对象和最终源码；不得把网页重定向或 PR 标题当作已引入代码的证据。

<a id="implementation-tasks"></a>

## 实施任务

每项任务按小步骤执行：新增或引入回归夹具，在选定基线上展示失败，适配实现，执行定向检查，更新所属文档，然后仅提交该任务文件。夹具若在基线上已通过，则记录行为已存在；不得人为制造失败或复制不必要代码。以下任务顺序由依赖决定。

### 任务 0：固定基线与依赖清单

**文件：** 新建 `.plans/upstream-runtime-release-2026-10-18/source-inventory.json`；仅为选定回移清单扩展 `scripts/upstream-intake-registry.ts`、`scripts/verify-upstream-intake.ts` 和 `scripts/verify-upstream-intake.spec.ts`。

1. 记录主目录的未提交路径，不记录文件内容或秘密；记录已验证发布 tip、上游轻量标签引用及对应提交、解析后的来源提交，以及 U1–U7/D1–D4 文件哈希。针对发布检出核对祖先关系和补丁等价性，而非仅对照未提交的主目录。
2. 建立独立运行时与发布实施分支/worktree；发布分支基于已验收运行时组，运行时验收不依赖签名或 Windows 证据。新建干净的同级实施 worktree，记录 `pnpm --silent run change-scope --base fork/codex/ask-knowledge-task7-20261017`。远端变化时改用固定基线引用重新执行；不得针对未审查的新基线重算验收。
3. 为每项列出引入的类型、包、配置行、生成物和调用方修改。前置依赖若扩展到排除的账号/Electron/分析行为，则采用更小的本项目适配，或暂停该项交回审查。
4. 执行 `pnpm exec vitest run scripts/verify-upstream-intake.spec.ts` 和 `pnpm run verify-upstream-intake`。增加未登记回移、虚假提高整体发布基线、禁止挂载/端点及缺失前置依赖的负向控制。保留现有插件固定版本、默认 skills 和 pi-ai 流式补丁。

**退出条件：** 每个批准项均有固定来源与完整引入/适配决策；代码修改前已记录基线失败。

### 任务 1：Codex 部分答案兼容（U4）

**文件：** `packages/subagent/subagent-codex/src/wire.ts`、`tests/subagent-codex.spec.ts`、现有子进程夹具及该包 README 双语文档。

1. 引入解析与选择行为：优先最后一条最终答案，否则最后一条部分答案，否则最后一条未分阶段答案。排除 commentary；未知阶段仍报错。
2. 通过假 app-server 入口覆盖部分答案 → 工具活动 → 最终答案、多条部分消息、仅部分答案、空输出、取消、提供方失败和未知阶段。文本须逐字节保留；部分文本不得掩盖失败或取消结果。
3. 执行 `pnpm exec vitest run packages/subagent/subagent-codex/tests/subagent-codex.spec.ts`。基于现有 `product-subagent-codex` 用例及子进程夹具机制，在 `snapshots/session/codex-partial-answer/` 新增无密钥录制会话用例；不要求真实 Codex 登录。

**退出条件：** 已识别的部分消息不再导致委派失败，同时保留最终输出与运行结果的既有优先级。

### 任务 2：技能刷新与侧栏行为（U5/U6）

**文件：** `packages/client/ui-skill/src/client/index.ts`、其包声明/编译配置及 `tests/browser-plugin.client.spec.ts`；`packages/client/ui-sidebar-right/src/client/shell/SidebarRight.module.css`；`packages/client/ui-dockkit/src/components/DockSurface.tsx`；相关 `apps/web/tests/` 夹具。

1. 通过显式声明的依赖接入转发的 `plugin-manager/changed` 事件。重载后清除受影响的目录；中止旧请求或使用代次校验，避免迟到响应恢复已禁用的技能。卸载时清理监听器并等待进行中工作结束。
2. 连同 DockSurface 放置规则引入溢出修复。在侧栏收起、编辑器聚焦时测试 PageUp；测量页面框架位置，并确认浮动面板可见、滚动与键盘焦点正常。
3. 执行 `pnpm exec vitest run packages/client/ui-skill/tests/browser-plugin.client.spec.ts`。引入上游 `apps/web/tests/skill-menu-plugin-change.e2e.ts` 并扩展 `apps/web/tests/sidebar-right.e2e.ts`；构建后以无密钥重放模式执行 `pnpm run test:web:built apps/web/tests/skill-menu-plugin-change.e2e.ts apps/web/tests/sidebar-right.e2e.ts`，再记录所属界面快照。原生 Windows WebView 键盘验证须单独给出结果。

**退出条件：** 在已有会话中启停插件能够刷新技能，侧栏不会导致框架位移或隐藏浮动内容。

### 任务 3：凭据顺序与认证引导（D4）

**文件：** `packages/credentials/credentials-local/src/index.ts` 与 `tests/{local,watcher}.spec.ts`；`packages/credentials/credentials/src/index.ts`；`packages/llm/llm-pi-ai/src/{auth,index}.ts` 及按需引入的上游 native-auth 辅助模块；`packages/llm/llm/src/{index,types}.ts`；`packages/api/settings-controller/src/credentials.ts`；`packages/client/ui-settings-models/src/client/`；`packages/bundle/{base,headless}/cordis.patch.yml`。

1. 引用解析顺序采用已保存凭据 → 启动环境 → 项目 `.env` → 用户 `.env`。提供方管理的记录与原生 pi-ai 认证须遵循一致顺序。保存/替换/移除密钥后应立即生效，重启后也一致；删除已保存值后使用下一来源。
2. 保留凭据文件中未知的顶层字段，并发出仅含键名、不含值的警告。继续拒绝无效版本和格式错误的 `refs`/`records`。保留注释、大整数、无关条目、文件权限、写锁和重载通知。
3. 将真实认证来源/端点元数据传递到服务与 Models 界面。根据实际安装的 pi-ai 1.3.x 核对解析器，不沿用上游旧清单；保留本项目所有提供方路由和流式补丁。
4. 采用上游 headless 环境认证组合，让单次运行/CI 可以使用环境凭据而不挂载桌面可写存储。分别测试 desktop、headless 与 SDK 的来源选择；记录 SDK 行为，不得为了与 headless 一致而静默修改 SDK。
5. 执行 `pnpm exec vitest run packages/credentials/credentials-local/tests/local.spec.ts packages/credentials/credentials-local/tests/watcher.spec.ts packages/llm/llm-pi-ai/tests/auth.spec.ts packages/client/ui-settings-models/tests/store.client.spec.ts`。使用合成秘密引入并执行上游 native-auth 与 headless 凭据测试。引入上游现有 `snapshots/session/headless-credentials/` 用例并适配本项目。

**退出条件：** 认证调用方对来源选择保持一致，没有测试读取真实密钥，并提供双语升级指南解释环境覆盖行为变化。检测到持久化类型变化时按规定确认；保留已提交历史 schema。

### 任务 4：模型推理编辑器（U3）

**文件：** 修改 `packages/client/ui-settings-models/src/client/{ModelsSection,ProviderEditor,CustomProviderCard,ModelListEditor,ModelRow}.tsx` 和 `src/client/{store,locales}.ts`；从上游引入 `ModelReasoningEfforts.tsx` 及定向测试；仅在必要处更新 pi-ai schema/元数据产生方。

1. 回移完整推理编辑器及后续修复。从已安装 pi-ai schema 读取支持的键；保留未知持久化键、异步编辑中的模型身份、提供方拒绝，以及显式关闭与省略值的区别。
2. 增加 schema 新增档位、未知已保存档位、编辑中切换模型、不支持的模型、保存被拒和重启持久化回归用例。更新失败时不得显示为已保存。
3. 执行 `pnpm exec vitest run packages/client/ui-settings-models/tests/model-reasoning-efforts.client.spec.tsx packages/client/ui-settings-models/tests/provider-form.client.spec.tsx packages/llm/llm-pi-ai/tests/dynamic-config.spec.ts`。以两种语言执行 Models 浏览器夹具并更新所属快照。

**退出条件：** 编辑模型后，该模型发给提供方的请求使用对应推理设置，其他提供方/模型配置保持完整。

### 任务 5：Search/Fetch 提供方与辅助搜索修复（U1/U2）

**文件：** 引入 `packages/web/web-deepseek-api/`；修改 `packages/web/web-search-deepseek/src/provider.ts`、`packages/web/web/src/index.ts`、`packages/client/ui-settings-web-search/`、`packages/bundle/base/{package.json,cordis.patch.yml}`、`apps/cli/package.json`、编译项目列表、锁文件和包/子系统文档。

1. 将 U2 作为可独立验证的修改落地：辅助 Messages 搜索发送 `thinking: { type: 'disabled' }`；保留结果规范化与请求记录。
2. 引入新提供方包及每次操作的提供方选择，包含完整依赖。默认继续使用 Messages 搜索与本地 HTTP 抓取；保存开启选项后选择两个新提供方，关闭后恢复随附默认值。
3. 从本项目新提供方传输中移除账号令牌路由、账号导入及 peer/dev 依赖；不保留闲置的 `deepseekAccount.resolveToken()` 分支。明确拒绝账号路由请求，并验证没有账号服务时仅用 API Key 能正常工作。保留聊天/搜索独立端点、路由前缀、条数范围、可信代理行为、取消、凭据发往其他源之前拒绝重定向、HTTP/非 JSON 失败，以及自定义网关缺少 tools 路由时的明确错误。不增加自动提供方回退。
4. 显示并保存原问题转发选项，提供清晰中英文说明。明确适配为默认关闭转发；仅在用户明确保存开启后转发，说明 128 字符上限，并测试省略/false 默认值及开启时的有界载荷。之后保存或重置其他设置时不得静默改变用户的转发选择。
5. 执行 `pnpm exec vitest run packages/web/web-deepseek-api/tests packages/web/web-search-deepseek/tests/deepseek.spec.ts packages/web/web/tests/web.spec.ts packages/client/ui-settings-web-search/tests --maxWorkers=2`。引入 `deepseek-fetch` 无密钥会话用例并更新 `web-search-round` 与端点引导证据。真实提供方测试若产生费用，须另行授权并单独报告。

**退出条件：** 两种模式都通过真实 profile 组合工作，设置重启后保留，新提供方无需账号登录即可从桌面收集后的运行时解析。

### 任务 6：Client/Host 发布身份与重载处理（U7）

**文件：** 新建 `scripts/desktop-build-identity.ts` 及测试；包含 `apps/desktop/src/bootstrap.ts` 及握手/缓存测试；修改 `packages/client/modules/src/{index.ts,client/manifest.ts,client/entries.ts,client/index.ts}`、上游 `client/{release-change,notify}.ts`；`packages/client/ui-settings-general/src/client/` 及测试；`scripts/build-{dmg.sh,exe.mjs}` 构建元数据；仅在需要转发既有运行时身份时修改 Tauri/companion 握手产生方。

1. 将发布身份产生方、浅层读取、比较、更新拒绝与本地化重载提示作为完整修改引入。比较 Host 运行时版本及可用的构建提交；不得替换为独立 Tauri 外壳版本或单个插件版本。
2. 本任务建立共享构建身份产生模块，供随包 Host 与 Client 启动模块图使用。任务 8 创建产物清单时再使用此模块；任务 6 不写尚不存在的清单。保留 `bootstrap.ts` 启动前对 manifest/companion 运行时版本不匹配的拒绝，用于拦截不一致安装。模块图身份检查用于拦截过期 Client 缓存或重装后重连，在新工厂执行前生效。两个检查均基于同一安装运行时身份，提交级新鲜度由图检查负责。保留同发布版本下的插件图修订更新；区分普通插件变化和 Host 发布变化。
3. 测试相同发布/不同图、不同发布/新图格式错误、同版本/不同提交、旧 Host 无身份、重连、重复通知及接受/延后重载。采用并记录上游明确的旧版处理策略；不得让缺失身份成为永久跨版本绕过。检测到不匹配后不得执行新图的模块工厂。
4. 执行 `pnpm exec vitest run packages/client/modules/tests packages/client/ui-settings-general/tests --maxWorkers=2`。使用两个合成发布身份增加已安装 companion 重连控制，确认重载提示保留已有会话/设置。不引入上游强制更新服务。

**退出条件：** 图解析/应用前拒绝不匹配更新，普通插件刷新正常，Tauri 启动无需账号/网络策略检查。

### 任务 7：Windows 升级文件锁恢复（D1）

**文件：** 新建固定到 Tauri CLI 模板的 `scripts/desktop-installer-template.nsi` 及事务 include 和 `scripts/tests/desktop-installer-upgrade.ps1`；更新 `apps/desktop/src-tauri/tauri.windows.conf.json`、`scripts/build-exe.mjs`、`.github/workflows/desktop-windows.yml`、`scripts/verify-desktop-exe.spec.ts` 和桌面打包文档。

1. 采用自定义 `nsis.template`，不依赖安装 hooks：保留固定 Tauri 模板必要的安装/注册表/WebView 行为，在应用载荷周围添加 staging、有界目录替换及回滚。记录上游模板摘要，并针对固定 CLI 验证替换项。明确覆盖残留 companion 锁住 `resources/node.exe`：主程序运行检查不能证明 companion 已退出。不得终止无关 Node 进程，也不得在新安装可恢复前删除旧安装。
2. 仅对访问拒绝/共享/锁冲突等临时 Windows 错误执行有限次重试。保留原始错误与恢复路径；恢复失败时保留先前完整载荷。升级或回滚不得删除 harness home、用户原文件、知识库、会话或凭据。
3. 在原生 Windows runner 安装合成版本 A，启动 companion，使用子进程锁定文件，再安装版本 B。覆盖预算内解锁、永久锁、中断替换、回滚失败、正常升级及重装。核对实际安装字节/版本与重启行为，而非只检查目录存在。
4. 拒绝非预期非零安装器退出；仅区分已文档化的成功/需重启结果。失败时保留日志和备份路径。执行 PowerShell 控制及 `pnpm exec vitest run scripts/verify-desktop-exe.spec.ts`；恢复后继续执行已安装 Host 验收。

**退出条件：** 原生 Windows 证据表明流程在有限时间内完成，或在保留用户数据的同时给出可操作、可恢复的失败。macOS/Wine/源码测试不能关闭该任务。

### 任务 8：产物身份与公开发布资格（D2）

**文件：** 新建 `scripts/desktop-release-manifest.ts`、`scripts/verify-desktop-release.ts` 及定向测试；整合 `scripts/build-{dmg.sh,exe.mjs}`、`scripts/verify-desktop-{bundle.sh,exe.mjs}`、`.github/workflows/desktop-windows.yml` 和本项目发布工作流。

1. 使用任务 6 的共享构建身份模块。定义版本化清单，包含源码提交、工作流提交、仓库、可用的 run ID/attempt、目标/架构、运行时与外壳版本、载荷身份、产物名/大小/SHA-256、构建模式和实际签名/公证结果。最终组装/签名后计算摘要；最终产物摘要保存在产物之外，避免自引用。
2. 对照独立 GitHub run/job/artifact 证据及真实下载字节验证清单。拒绝错误仓库/ref/提交/attempt/平台、过期载荷身份、篡改字节、歧义输出、失败任务和缺失的必要安装验证。本地内部构建使用明确本地身份，不得伪装为 CI 合格公开产物。
3. 保留明确的 `internal` 模式，按需允许未签名/未公证。`public` 模式要求 Windows Authenticode 配置的可信发布者，或 macOS Developer ID 加已验证公证/stapling；调用原生验证，不相信清单布尔值。凭据缺失时，在昂贵构建前拒绝公开预检，同时保留内部模式。
4. 执行 `pnpm exec vitest run scripts/desktop-release-manifest.spec.ts scripts/verify-desktop-release.spec.ts`。增加缺失/不可信/无效签名及公证不匹配的原生控制；凭据可用时验证有效签名正向路径。外部前提不可用时不得报告已可公开发布。

**退出条件：** 内部产物仍可测试，公开资格独立执行验证，每个交付产物均可追溯至准确的已测构建。

### 任务 9：本项目可恢复发布（D3）

**文件：** 新建 `scripts/desktop-release-publish.ts`、定向测试与本地夹具传输；增加本项目手动发布工作流和双语发布说明。不得为桌面二进制扩展 npm 发布脚本 `scripts/release/publish.ts`。

1. 先实现 `plan` 与只读 `verify` 路径，再实现 `publish`。计划显示本项目仓库、渠道、版本、准确来源、签名资格、不可变目标名、大小/摘要及发布元数据变化。上游端点、自动更新器或生产写入都不得成为默认行为。
2. 将不可变版本化二进制发布到配置的本项目 GitHub release，下载/读取并比较字节，最后更新唯一权威渠道记录。记录放在专用本项目 release asset 中，核对观察到的远端修订；所有受支持渠道写入方通过同一个仓库级工作流并发组串行执行。GitHub asset 替换不是原子比较交换：替换前后重新核对远端状态，拒绝结果不明确的情况，并说明不支持流程外手动写入。本地传输测试执行同一发布器决策。
3. 续发时跳过相同对象、拒绝不同的不可变对象、重新验证部分进度，并在其他发布者修改渠道时停止。失败时保留已上传有效文件；不得提前推进元数据或移动既有标签掩盖未完成发布。区分产物已发布与最后标签/元数据操作失败。
4. 执行 `pnpm exec vitest run scripts/desktop-release-publish.spec.ts`。在每次写入前后注入失败，覆盖过期渠道状态、重复执行、错误 run 身份、未签名公开输入及字节冲突。通过合成录制响应测试 GitHub 适配器请求；真实远端写入仍须稍后明确发起发布。

**退出条件：** 发布中断后可继续，既不替换已发布二进制，也不宣传未验证产物。实施期间不发布任何版本。

### 任务 10：文档、策略检查与整体验证

**文件：** 受影响 README 双语文档、升级指南、`scripts/upstream-intake-registry.ts` 清单、生成目录/项目列表、现有已安装流程验证器及本次证据目录。

1. 行为落地时同步更新所属 README/JSDoc、类型化中英文界面文字及必要升级指南。从源码重新生成派生目录。对持久化设置/记录变化评估持久化类型确认；不得修改已提交 Session 代次或重写历史 schema。
2. 执行 `pnpm exec tsc -b tsconfig.host.json tsconfig.client.json`、`pnpm run verify-no-unknown-casts`、`pnpm run verify-export-jsdoc`、`pnpm run verify-client-ui-i18n`、`pnpm run verify-config-catalog`、`pnpm run verify-upstream-intake` 和 `pnpm run test:docs`。对修改文件使用仓库 lint 运行器。单列继承失败；不得豁免受影响的 Required 失败。
3. 通过 `DSH_SNAPSHOT=replay pnpm run test:web:built apps/web/tests/web-search-round.e2e.ts` 执行 `web-search-round`；这是 Web 快照，不是 Session 快照。使用 `pnpm run test:snapshot -t '<selected scenario pattern>'` 执行选定无密钥快照；不得插入导致过滤失效的单独 `--`。共享凭据/模块/profile 整合后运行一次知识库包定向回归套件，并执行已有安装版知识库和助手控制。真实提供方跳过仍记录为跳过。
4. 源码验收后，从准确且干净的实施 HEAD 构建一次性候选产物。执行 `NODE_OPTIONS=--max-old-space-size=12288 RAYON_NUM_THREADS=2 pnpm run build`、重新构建 `bash scripts/build-kb-sidecar.sh`、Tauri macOS 组装及原生 Windows 工作流。对只读 DMG 挂载执行 `bash scripts/verify-desktop-bundle.sh <mounted-app>`，对已安装 Windows 目录执行 `node scripts/verify-desktop-exe.mjs <install-root>` 及安装版 Host 控制。候选产物保存在本次证据目录，不替换已交付 `dist/` 安装器或 `/Applications`。
5. 执行 Models、搜索设置、技能变化、侧栏几何和重载提示的浏览器行为控制；单独记录原生 Windows WebView 键盘结果。对已组装输出执行产物/发布负向检查。原生平台、签名检查不可用时保持待验证，不得依据单测改判为通过。
6. 后续如要求推送，应用 pre-push skill。逐项报告引入/适配文件、测试命令和退出码、未解决问题、源码/产物身份及平台/签名限制。发布决策前，对照固定基线审查完整输出差异。

**退出条件：** U1–U7 与 D1–D4 均有可独立核对证据；每个未运行的原生/签名/真实提供方检查均明确标识。

<a id="acceptance-and-delivery"></a>

## 验收与交付

负责人先审查计划，再实施。实施批准允许隔离代码修改、合成测试和验证所需一次性候选构建；不包含付费模型调用、真实账号/凭据变化、发布、覆盖用户应用安装或替换此前交付安装器。

运行时组（任务 0–5）在所属行为、迁移引导、回归与策略检查通过，且无未解决 Required 问题后独立验收。发布组（任务 6–9）基于该运行时单独审查；缺失 Windows/签名证据不得阻塞已验收运行时修复。整体验收仍要求全部选定工作完成。内部产物验收另须挂载 macOS 与原生安装 Windows 验证，包含文件锁恢复和 Client/Host 不匹配。公开发布验收再要求真实签名/公证验证与外部构建证据；缺少签名基础设施会阻止该状态，但不阻止内部验证。

先交付双语计划与来源清单。实施后交付按任务分组的提交和证据报告，再由负责人决定最终打包/发布。全过程保留已知可用发布和安装器副本。发布前在引入问题的任务中修复新发现；不得声称已整体升级 rc.2，也不得为获得构建通过而静默扩大范围。

<a id="dev-note"></a>

## 开发备注

本提案不宣称已实施或测试通过。准确基线/来源身份和后续命令输出属于本次执行证据，与维护型计划分开保存。现有无关未提交文件和用户知识数据均不属于本次修改。
