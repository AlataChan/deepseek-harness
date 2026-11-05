# 上游 0.2.2-rc.1 选择性引入实施计划

[English](2026-11-04-upstream-022-rc1-selected-intake.md) | 中文

> **执行者须知：** 使用 `superpowers:executing-plans` 按顺序执行已放行任务。本文不隐含任何委派或启动工作者的要求。

**目标：** 适配选定的 RC1 能力，保留已验证的 Tauri 桌面、助手、常驻团队、持久问题和用户数据。

**架构：** 任何实施之前都先建立检查点。可移植项目沿用当前 API；有依赖的项目等待包含完整调用方台账的协同运行时迁移。

**技术栈：** TypeScript、Cordis、React、pnpm、Vitest、录制会话、Playwright，以及现有 Tauri 分发流水线。

**状态：** 总体方向已获认可，评审条件已纳入。[P0 验证记录](../../.plans/upstream-0.2.2-rc1-assessment-2026-11-04/baseline-validation.md)说明源码检查点、基线结果以及是否允许开始选定回移。仅创建检查点不会开放 P0；其验证必须通过。

## 目录

- [范围与前置条件](#scope)
- [P0：硬性检查点](#checkpoint)
- [P1：可移植的回移项目](#portable)
- [AD：专用桌面操作插件](#desktop)
- [M：协同运行时迁移](#migration)
- [依赖迁移的功能](#dependent)
- [登记与验收](#acceptance)
- [开发说明](#dev-note)

<a id="scope"></a>
## 范围与前置条件

源码上限为 `dsh-v0.2.2-rc.1`。`UPSTREAM_PIN` 和每个选定回移项的 `basePin` 均保留为 `dsh-v0.2.1-alpha.1`。不得借用仅存在于 master 的提交，也不得修改产品版本标签来暗示已经完成整版上游升级。

[评估](../../.plans/upstream-0.2.2-rc1-assessment-2026-11-04/assessment.md)、[逐项前置条件](../../.plans/upstream-0.2.2-rc1-assessment-2026-11-04/prerequisites.md)、[投影调用方](../../.plans/upstream-0.2.2-rc1-assessment-2026-11-04/projection-callers.md)和[请求监听器](../../.plans/upstream-0.2.2-rc1-assessment-2026-11-04/request-listeners.md)保存详细证据。实施前重新生成源码清单；行号和数量仅标识本次检查点，不是永久豁免。

| 项目 | 前置条件 | 放行约束 |
| --- | --- | --- |
| RC1-01 指令预算；RC1-02 可读技能根目录 | P0 | 适配当前 API 和事件词汇 |
| RC1-03 Markdown 复制；RC1-04 apply_patch | P0 加当前 API 适配证明 | 复用现有菜单/导出和 fs/tools 接口，不暗中升级核心 |
| AD-01 agent-desktop | P0 加仅使用 MCP 的组合证明 | 不注册投影、不监听请求、不增加 Session 事件 |
| RC1-05 引用；RC1-06 输入接收与去重 | M 验收 | 一并移植完整的输入/Host 行为 |
| RC1-07 移动端输入；RC1-08 轨迹/侧栏/菜单行为 | M 验收 | 保留分支特有界面和读取模型 |
| RC1-09 插件更新与回滚 | M 验收 | 加载器、安装状态和原生依赖固定版本一并验证 |
| RC1-F1 本地 Worktree/Forge；RC1-S1 统一 Schedule | M 加各功能验收 | 分别集成，不自动隔离 Team 或发布结果 |

如果可移植项目需要迁移后的 API，停止该项，记录实际缺失的符号，并将其移至 M 之后。不得扩展为框架升级或悄悄引入整个上游包。OAR 继续延后；上游 CUA、Electron、账号、策略、发布源和分析统计默认能力仍排除。Superagent 留在这些选定升级之后讨论。

<a id="checkpoint"></a>
## P0：硬性检查点

**文件：** 创建 `.plans/upstream-0.2.2-rc1-assessment-2026-11-04/checkpoint.json`、`checkpoint-files.json` 和 `baseline-validation.md`；读取现有发布元数据、源码哈希、五份已批准的 Octopus 计划以及引入登记表。本任务不开始任何产品回移。

1. 刷新 HEAD、分支、暂存/未暂存/未跟踪路径、当前文件哈希、登记项和安装包身份。区分产品输入与复制的参考源码、构建残留、凭据及无关工作。不得以固定的脏文件数量作为验收条件。
2. 准备明确且已评审的文件清单，覆盖实际 A/B 实现、profile、依赖、分支预设和必要文档。保留无关改动。不得使用 `git add .`，不得 stash/reset 用户工作，不得复制凭据，也不得假定从 HEAD 创建的 worktree 含有未提交功能。
3. 在独立检查点分支建立可评审源码检查点，不移动或改写用户分支。记录提交/tree 和明确纳入、排除的输入。脏 diff、成功的工作者报告或旧安装包都不等于源码检查点。
4. 从该检查点创建实施 worktree。核对源码哈希与目标基线，并验证相关源码、浏览器和安装包行为。构建覆盖旧 DMG 前先保存它；区分继承的问题与该检查点自身的问题。
5. 只有记录了检查点身份、已评审的纳入清单、干净的独立 worktree、基线结果及所有阻塞问题的处置后，P0 才能放行。在此之前不得运行 P1、AD、M、依赖安装或回移登记变更。如果基线不能复现，先修复并评审，再开始升级。

<a id="portable"></a>
## P1：可移植的回移项目

每一项均按以下步骤执行：冻结明确的当前/tag 文件，增加失败行为探针，实现最小的当前 API 适配，运行所属测试及受影响的录制会话/浏览器案例，随后单独评审并提交该项。只随已验收代码记录对应的 BackportEntry。若需要付费录制，必须记录适用授权及有界预算；不得仅凭环境中有密钥就推断已获授权。

### RC1-01：分开计算指令链预算

**文件：** 按需适配 `packages/context/agent-instructions/src/config.ts`、`render.ts`、`index.ts` 和 README 双语文件；扩展 `tests/agent-instructions.spec.ts` 及预算会话 fixture。该项源码提交记录在评估中；最终行为来自固定 tag，不是未经检查的整提交引入。

对大型项目指令链与用户全局指令链同时存在的场景，检查初始/动态渲染、UTF-8 限制和禁用加载。确认两条链各自遵守声明预算，模型可见内容与日志一致。运行 `pnpm exec vitest run packages/context/agent-instructions/tests/agent-instructions.spec.ts` 和指定预算回放。沿用现有模型选择与提示词 API；在所属文档中声明任何外部可感知的预算变化。

### RC1-02：隔离不可读技能根目录

**文件：** 适配 `packages/skill/skill-filesystem/src/index.ts`、README 双语文件及 `tests/skill-filesystem.spec.ts`；扩展范围前先检查当前 `skill` 与 `tool-skill` 消费方。该项源码提交记录在评估中。

在一个根目录不可读、项目/home/内置根目录仍可读时，验证优先级、不完整观测和后续恢复。使用当前的完整性表示，不在该项中引入新的目录持久化字段。运行 `pnpm exec vitest run packages/skill/skill-filesystem/tests packages/skill/skill/tests packages/skill/tool-skill/tests` 及受影响的技能发现回放。保留团队协作引用文件和已安装技能验证。

### RC1-03：将完整历史复制为 Markdown

**文件：** 适配 `packages/session-query/session-log-export/src/index.ts`、`routes.ts`、`client/HeaderAction.tsx`、`client/locales.ts`、README 双语文件及编译配置；创建 `src/markdown.ts`、`tests/markdown.host.spec.ts` 和 `tests/markdown-route.host.spec.ts`。扩展现有 header/action/route 测试和所属真实浏览器导出案例。该项源码提交记录在评估中 及 tag 中后续修复。

复用现有 Host/archive 访问读取全部已提交历史，并使用当前 HeaderAction 菜单。不得引入新的共享右键菜单绑定、投影句柄或 Session 订阅。测试尚未加载的旧历史、分支前缀、剪贴板失败、用户/助手/工具内容和当前分支事件。导出历史不得虚构后来仅保存在存储中的问题状态。运行 `pnpm exec vitest run packages/session-query/session-log-export/tests` 及指定的已构建 Client 导出案例。

### RC1-04：受保护的 apply_patch

**文件：** 引入有界的解析器所属包 `packages/fs/fs-patch/`；适配 `packages/fs/tool-fs/src/index.ts`、包清单、当前修改控制器和展示器；创建 apply-patch 工具/输出/展示及补丁执行模块和所属测试。实施前冻结每个新增文件名；明确更新工作区解析和运行时依赖闭包，不引入新版 tools 或 working-directory API。

验证语法/hunk/缺文件预检查、沙箱拒绝、观测/新鲜度拒绝、创建/编辑/删除/移动、符号链接、部分提交、取消和真实 Review 元数据。运行解析器测试、`pnpm exec vitest run packages/fs/tool-fs/tests`、录制的原生/PTC 调用，以及真实 Client 展示案例。预检查不等于原子的多文件提交；不得隐藏部分结果或自动重放不确定写入。

固定 tag 中 `dsh-base` 与 Web standard 都明确设置 `applyPatch: false`；base 的 observation-policy 行存在但被禁用。还要检查实际解析后的分支 desktop/headless/persistent-question 预设与用户 overlay。该项保持 apply_patch 可选启用，并保留我们已启用的 observation policy。增加负向组合检查：复制的预设一旦禁用该策略，检查必须失败。仅检查 schema 默认值不能通过此门槛。

<a id="desktop"></a>
## AD：专用桌面操作插件

用户已批准 AD-01；不得再次索取该批准。其来源为 Vercel agent-desktop，而非 DSH RC1 tag。在自身固定版本清单中记录发布版/原生资产摘要，不得伪造 DSH BackportEntry。

编写适配器前，冻结仅使用 MCP 的 Host/Client/预设/原生资产文件清单，并通过当前 MCP client 证明启动、工具发现与释放。不注册投影、不监听 agent/request、不增加 Session 事件，也不修改通用输入控制器。如果任何一项变得必要，停止并给出具体依赖说明，将 AD 调整到 M 之后。

内置专用桌面操作入口，保持 standard 不变，共享桌面交互保留单一所有者。原生程序/helper/版本/技能/license 必须一同分发，构建时校验摘要并支持离线启动；不得首次启动再下载，也不得全局启用依赖安装脚本。现有原生预检只是证据。交付前必须通过已安装 MCP、权限/拒绝、过期 ref、取消、释放和干净副本打包验收。

<a id="migration"></a>
## M：协同运行时迁移

### M0：冻结完整迁移清单

**文件：** 在评估目录旁创建限定范围的 `migration-files.json`、`projection-dispositions.json`、`request-dispositions.json` 和 `migration-validation.md`。M1 之前必须评审完整的文件/消费方/测试清单；只列包名不够。

重新生成 AST 清单，检查别名、解构和 get-service 用法。链接台账中的当前 29 处注册、83 处直接服务调用及其他读取方/别名都必须有处置。明确覆盖 commerce-mode、host/commerce、tool-agent-team、API 模型选择投影、Team 和两个 ask 包。对每处旧注册，记录新所有者/替代、状态兼容、已等待的初始化、保留读取器、已等待的释放、检查点行为、已验收源码哈希和可运行所属测试。整包引入上游不能免除分支差异和旧调用方检查。

我们的 helper 已有模型选择状态/通知机制。复用它及其测试，但要从入口所有的 ModelSelectionRef 加请求时路由，迁移到 Agent 所有、在组装前捕获的持久选择。盘查四个现存请求监听器：core/model-selection、assistant route-override、assistant rounds、webhook 初始 effort。将 API 所有的模型选择投影映射到新所有者；不得在同一 key 下注册竞争所有者。

rounds 监听器限制 maxTokens，并在预算耗尽时抛错；它不改变 provider/model/effort。保留兼容的控制路径，或只在有等价的逐请求、重叠轮次、取消和恢复测试后迁移。不得因为 agent/request 的路由用途被弃用而删除它。通过实际发出的请求测试助手与常驻席位的 provider/model/effort，包括图片验证、重试、未指定 effort 和冷恢复。

### M1：明确运行时和 Node 决策

可移植路径保留 `^22.19.0 || >=24.0.0`。协同 DSH 运行时迁移采用 `>=24.9.0`；不得宣称 Cordis 4.1 单独要求它，或已证明兼容 Node 22。审计内置 Node 程序、源码启动、依赖 engines、两种 SDK 运行时分发和平台 CI。

提高版本下限的同一变更中，如果 root 版本仍未改变，在 `docs/upgrade-guide/v0.2.1-alpha.1/node-runtime-floor/` 创建 Node 迁移指南双语文件及配对记录；否则按所属 skill 使用变更当时的 root 版本。说明受影响的源码/SDK 用户、运行时安装及验证方法。运行 `verify-upgrade-guides`、指定配对检查、受支持运行时的源码/SDK smoke，以及具有可操作提示的不受支持运行时预检查。仅修改元数据或已有 macOS Node 24.14 程序均不足以通过。

M1 按已评审清单，将 vendor Cordis/Loader/Include、工具解析/执行、模型选择、Session/投影/存储兼容、PTC 传输/取消、自定义预设和两种 SDK 消费方组合实施。保留不可变持久化代次、明确类型确认、分支必需事件以及备份失败即停止行为。Session 格式同为 4、SQLite schema 同为 1 不免除数据及生命周期评审。PTC 的 ABORTED 分类与配置变化需要各自适用的升级指南。

### M2：集成验收

每条注册台账都必须有处置并通过测试；不得遗留同步旧调用方、重复投影所有者或失效读取器。覆盖初始化失败、运行中卸载、保留读取器/检查点、重新启用及冷恢复。验证每个请求监听器的处置和轮次预算行为。运行所有变更所属包的定向测试与规定逐文件覆盖率、Host/Client 编译、两种 SDK 预期输出和严格录制会话。

重跑真实 Host/Client 问题流程、规范排队回答准入、原生/PTC/MCP 提问步骤保护、旧日志与 profile 副本、Goal 权限、IM 收据/连接所有权、Team/常驻名单/模型选择，以及现有安装包检查。冻结准确代码与产物身份。类型检查、更新版本标签或放宽快照都不等于运行时迁移验收。继承的无关失败必须明确处置，不能记为通过。

<a id="dependent"></a>
## 依赖迁移的功能

M2 之后，按链接的前置条件分类，为 RC1-05–09 提供有界实施清单；输入/Host、读取模型和加载器变更保持完整。每个验收项增加单独的 BackportEntry，并验证当前用户路径，不复制全部 Client 包。

RC1-F1 从本地 Worktree/Forge 与有效 cwd 行为开始。对 Team 预览、文件导航、数据/知识绑定和飞书问题授权，分开定义原工作区身份与执行 cwd。每个 worktree Lead Session 一个 Team，与新增隔离队友 provider 不同；后者需要单独设计。保留共享工作区的常驻团队。在可选 GitHub 评审/发布前测试丢失 worktree 恢复及取消/还原。不得由任务完成推导合并或发送权限。

RC1-S1 保留一个「自动化任务」入口，通过真实 Host 控制器测试持久化、人工/事件输入来源、等待问题时的取代、取消和冷恢复。它不授权已延后的外层 Stage C 运行时。按用户要求，Superagent 留到选定升级及这些实际能力评估之后讨论。

<a id="acceptance"></a>
## 登记与验收

每个已实施的 RC1 项和 migration/Forge/Schedule 子项，都需要在 `scripts/upstream-intake-registry.ts` 中建立自身 BackportEntry：`sourceTag: 'dsh-v0.2.2-rc.1'`、`basePin: 'dsh-v0.2.1-alpha.1'`、准确路径、真实依赖、源码依据及可运行验证。不得使用目录豁免、占位已接受条目、推进整版 pin，或替换现有 rc.2 条目。

所有 pnpm 命令沿用工作区已验证的依赖配置。先运行所属测试及有意义的负向控制，再运行变更界面的快照/浏览器/SDK 检查。对集成检查点执行完整源码/原生构建和所有必需安装包门槛，使用新的产物副本并核对签名/包内容。分别记录付费/平台及全仓限制。不得将旧产物通过数当作新结果。

当前验收：P0 和 M2 已完成。主代理已验收所选客户端、本地工作目录和调度实现，以及集成构建、严格 SDK/浏览器检查和新挂载复制的内部 macOS 安装包。最终 DMG 的 122 项安装检查通过，复制产物上的 Worktree/Schedule、持久问题/原生团队及团队技能检查也通过。`.plans/rc1-execution/root-final-acceptance.md` 记录精确证据和保留的仓库/平台限制；这不表示全仓库检查通过，也不表示完成公开公证。`.plans/rc1-execution/current-progress.json` 记录验收检查点，`.plans/rc1-execution/final-review-prompt.md` 定义独立评审要求。提交、快进集成及向分叉仓库和镜像发布在该检查点后执行，完成状态须另查实时 Git 引用。UPSTREAM_PIN 和产品版本保持不变。

<a id="dev-note"></a>
## 开发说明

无。
