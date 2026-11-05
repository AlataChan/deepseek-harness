# 原生团队编排实施计划

[English](2026-11-02-native-team-orchestration.md) | 中文

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标：** 默认随包提供 DSH 原生 `team-orchestration` 技能，帮助用户分派明确要求的团队任务、协调依赖并获得有证据支持的结果，无需安装 Orca。

**架构：** 保留 DSH 的 Team 服务、工具、Session 日志及现有桌面协作面板作为执行系统。通过现有内置技能流水线增加简明技能与按需读取的参考文件。生命周期保证由所属运行时验证，不把技能指令表述为已经强制执行的尝试隔离或恢复机制。

**技术栈：** Markdown 技能、Cordis、现有 Team 与子智能体服务、Vitest、录制的 Session 快照及现有 Tauri 桌面打包脚本。

**状态：** 待评审草案。本文不授权实施、安装依赖、模型付费调用、提交、推送或发布。规划及下述定向基线检查已经完成，实施与发布验收尚未进行。

## 摘要

第一版使用 DSH 现有工具交付有明确限制的工作流。默认安装只让技能可发现，只有用户明确要求团队协作时才允许创建队友。如果初始审查发现需要更强的自动重试、执行尝试所有权及远端工作者恢复能力，应另行定义运行时扩展。

## 目录

- [已核实的起点](#starting-point)
- [产品决策](#product-decisions)
- [能力映射](#capability-mapping)
- [实施任务](#implementation-tasks)
- [验收与发布](#acceptance)
- [延后的运行时工作](#deferred-work)

<a id="starting-point"></a>
## 已核实的起点

本机 Orca 技能是发现入口。通过 `orca skills get orchestration` 读取的版本匹配指南定义了具有执行权限的尝试、持久化消息交付、明确的完成报告和资源处置。原生技能将使用 DSH 术语独立描述这些做法，不分发 Orca 文档，也不调用 Orca 命令。

已检查的 DSH 源码包括 [Team 类型](../../packages/experimental/agent-team/src/types.ts)、[任务变更](../../packages/experimental/agent-team/src/task-board.ts)、[消息邮箱](../../packages/experimental/agent-team/src/mailbox.ts)、[活动等待](../../packages/experimental/agent-team/src/activity.ts)、[模型工具与策略](../../packages/experimental/tool-agent-team/src/index.ts)及[常设团队轮次](../../packages/experimental/assistant-registry/src/rounds.ts)。通用 Team 任务当前只有 `pending`、`in_progress`、`completed`、`deleted` 状态，没有暴露 Orca Dispatch 实体。常设团队的轮次尝试属于另一套机制，不得悄然当作通用 Team 任务的尝试机制。

桌面分发已有[技能清单](../../scripts/desktop-bundled-skills.json)、[装配脚本](../../scripts/seed-desktop-bundled-skills.mjs)及[启动安装逻辑](../../apps/desktop/src-tauri/src/app.rs)。当前清单尚未包含新技能。[技能注册表](../../packages/skill/skill/README.zh.md)支持发现与按需加载。

规划基线：`pnpm exec vitest run packages/experimental/agent-team/tests/team.spec.ts packages/experimental/agent-team/tests/persistence.spec.ts packages/experimental/tool-agent-team/tests` 的三个文件共 79 项测试通过。这只说明选定的现有基线通过，不代表下述新增验收场景已通过。规划期间没有启动外部 Orca 工作者或付费模型调用。

<a id="product-decisions"></a>
## 产品决策

1. 在分支的桌面发行包中默认安装技能。不自动启动团队、不更改默认助手、不增加后台调度器，也不要求在已配置的 DSH 模型供应商之外另设模型账户。
2. 只使用原生工具。如果配置缺少所需工具，应说明限制并停止委派，不安装 Orca、不通过 Shell 启动替代智能体，也不自动修改组合配置。
3. 首先支持用户明确要求的临时团队。已有常设团队继续使用自己的名册、模型、协调者、轮次与取消机制，不通过新建临时队友替换常设成员。
4. 保留用户的模型与推理强度选择。通过现有模型选择策略解析覆盖值，区分请求值与实际生效值，对不支持的选择明确报错，不悄然切换。
5. 保留人的决策权限及现有权限检查。工作者提问不能扩大权限、批准发布或扩大任务范围。只读评审任务继续保持只读，除非用户授权修复。
6. 常用路径保持简短：定义验收、划分所有权、启动独立工作、协调、验证、报告。仅在需要时读取恢复与任务编写参考文件。本功能不新增持久记忆或自动记忆提取。
7. 复用协作面板与已有本地化控件。第一版不增加设置页、首页入口、面板、供应商，也不修改 `apps/desktop`、`packages/bundle/desktop-app` 或 desktop-companion 的应用产品逻辑。

<a id="capability-mapping"></a>
## 能力映射

| Orca 做法 | DSH 所属模块或操作 | 第一版要求 |
| --- | --- | --- |
| 自包含任务说明 | `team_task_create`、任务描述、`write_scopes` | 明确目标、结果、限制、负责人、依赖及可观察的验收证据 |
| 独立执行批次 | `spawn_teammate`、`send_message` | 仅启动用户要求且真正独立的工作，共享文件编辑按顺序执行 |
| 依赖就绪 | `team_task_list`、`team_task_get`、`team_task_update` | 变更前读取当前修订，就绪不会唤醒工作者 |
| 持久化消息 | `send_message`、Team 邮箱 | `accepted` 或 `queued` 只说明发送已持久化，不证明理解或任务成功 |
| 监督等待 | `list_agents`、`wait_agent` | 等待前唤醒必要的非活动工作者；变化、超时或 `noProgress` 后重新读取状态 |
| 工作者提问 | 原生队友消息及现有 Lead 向用户提问路径 | 问题经 Lead 处理；现有提问与审批工具只能在既有权限内使用 |
| 明确结果与验收 | 工作者消息、任务状态、产物、测试及 Lead 验证 | 工作者结束文本和 `completed` 状态属于待核实的声明，不是独立证据 |
| 停止与清理 | `interrupt_agent`、子智能体生命周期 | 重新分配编辑前确认取消已结束；不指导关闭终端或删除工作树 |
| 尝试隔离与自动重试 | 尚未确认通用 Task 对应 Dispatch 的机制 | 不承诺自动重试或尝试隔离；未解决的工作保持明确的未解决状态 |
| 远端执行位置与工作树隔离 | 不属于第一版工作流 | 不宣称支持 SSH 执行、分布式调度或自动隔离工作树 |

<a id="implementation-tasks"></a>
## 实施任务

### 任务 1：确认运行时的准确保证

**检查：** 上述源码所属模块；`packages/experimental/agent-team/src/roster.ts`；`packages/subagent/subagent/src/index.ts`；`packages/experimental/assistant-registry/src/dispatch-ownership.ts`；以及现有 Team 与工具测试。

**步骤：** 沿每项映射操作追踪实际执行模块与持久化事件。仅在 `packages/experimental/agent-team/tests/team.spec.ts`、`packages/experimental/agent-team/tests/persistence.spec.ts` 和 `packages/experimental/tool-agent-team/tests/tool-team.spec.ts` 增加缺少的行为测试。在所属 README 双语文件中记录确认的保证与限制，本计划保留链接，不另写一份运行时规范。

**必要探测：** 两个申请者使用同一修订领取任务；依赖环和阻塞任务准入；排队消息重启后交付且不产生重复目标输入；等待返回 `noProgress`；中断后尝试重新分配任务；取消后迟到的结果；工作者停止却未完成任务。按需断言持久化事件、实际子会话状态及外部文件。不仅凭名册标签推断取消或工作成功。

**决策：** 如果当前操作足以表达安全工作流，按已记录限制继续。如果探测发现正确性缺陷，先写失败回归，再修复最小所属路径，最后才做相应保证。如果安全性需要新任务尝试持久化或新能力，则将该实施片段停在具体的后续设计，不增加推测性数据结构，也不在技能文字中掩盖缺口。

**验证：** 运行同一条 79 项基线命令及新增影响的定向文件。每个新回归都应在修复前拒绝错误行为。竞态场景使用同步屏障与临时资源目录，不以固定等待时间作为证据。

### 任务 2：编写原生技能与定向参考文件

**新增：** `.agents/skills/team-orchestration/SKILL.md`、`.agents/skills/team-orchestration/references/task-spec.md`、`.agents/skills/team-orchestration/references/recovery.md`。只有分发需要时才增加 Codex 调用元数据，且与 frontmatter 策略一致。实施时读取仓库技能编写指导。

**步骤：** 发现元数据明确匹配用户要求团队协作与监督的请求。主指南保持简洁，解释 Lead 与队友职责、当前工具名、任务修订、持久化发送、有界等待及基于证据的报告。任务示例与失败恢复示例放入两个参考文件。独立编写 DSH 指导，不复制 Orca 入口或其运行时专用指令。

**必要任务字段：** 目标文件或材料；明确产物；限制；每个共享文件唯一编辑负责人；真实依赖；用户指定时的模型选择；验收证据。队友使用小写连字符名称，语言适合用户任务。不编造任务 `failed` 状态、`worker_done`、确认命令、终端释放操作或 DSH 尚未暴露的运行时 API。

**必要工作者报告：** 标明任务；在报告文本中声明 `succeeded`、`failed` 或 `unresolved`；列出产物与检查结果；说明限制及是否修改文件。这些词是报告内容，不是新增持久任务状态。工作者先报告，再将任务标记完成；失败或不确定时保持任务未完成，通知 Lead，不自动启动替代者。

**必要 Lead 报告：** 覆盖全部请求任务，用产物与验证核对工作者声明，标明未完成工作，说明明确的后续负责人安排。必要工作未解决时不得宣称整体完成。不施加 DSH 原生生命周期尚不支持的永久空闲或清理义务。

**验证：** 对照当前工具结构审查所有工具及字段。运行 `pnpm run verify-skill-invocation-metadata`；另用真实 DSH 文件系统提供者加载技能与参考文件，因为元数据检查本身不能证明可发现性或行为。

### 任务 3：通过真实配置验证模型可见行为

**新增：** 按照 `snapshots/AGENTS.md` 创建 Session 驱动场景 `snapshots/session/team-orchestration/`。**扩展：** 在 `packages/experimental/tool-agent-team/tests/tool-team.spec.ts` 增加工具层反例。只有已有策略或工具结构输出确实变化时，才更新 `snapshots/session/team-targets/` 中的对应预期。

**步骤：** 在真实 `dsh` 配置中，通过临时 DSH home 和随包技能提供者挂载技能。录制包含两个队友、依赖、消息、验收检查及最终任务核对的明确协作请求。使发现、按需加载、原生工具调用、子 Session 和最终产物可观察。使用现有快照运行器及模拟或录制的模型调用，不仅依靠手工挂载演示。

**反例：** 普通单智能体请求不创建队友；缺少 Team 工具不触发 Shell 替代；持久化的 `queued` 消息不重复发送；超时不启动替代者；等待前先向必要的非活动工作者发消息；冲突修订被拒绝；重叠写入范围始终只是提示，不能冒充锁；没有对应产物的虚构成功报告不能通过 Lead 验收。

**验证：** 场景创建并注册后运行 `pnpm run test:snapshot -- -t team-orchestration` 及定向 Team/工具测试。需要快照框架支持时在同一变更补齐。任何需要付费推理的新录制都须另获有界调用授权；无密钥回放仍是必须可重复执行的检查。

### 任务 4：固定并验证默认技能分发

**修改：** `scripts/desktop-bundled-skills.json`。**新增：** 如果现有测试未覆盖，在 `scripts/seed-desktop-bundled-skills.spec.ts` 创建隔离的清单及装配测试。**仅在需要时修改：** `scripts/seed-desktop-bundled-skills.mjs`、`scripts/verify-desktop-bundle.sh`、`scripts/verify-desktop-exe.mjs`。

**步骤：** 向清单加入 `{ "name": "team-orchestration", "path": ".agents/skills/team-orchestration" }`。复用清单驱动收集。验证主指南与两个参考文件完整经过装配、启动安装及升级刷新，已有同名覆盖按当前优先级与刷新规则处理。不增加新依赖，不携带 Orca 运行时。

**验收：** 缺失或损坏的内置技能文件须使所属验证失败，并报告准确路径；有效载荷可经 DSH 加载；无关用户技能在安装与刷新后保留。不能仅为此技能改写刷新行为或覆盖策略。若当前流水线不满足要求，在原所属模块做最小且经过测试的修改。

**验证：** 运行新装配测试及受影响的现有验证器测试。实施期间用 `node scripts/seed-desktop-bundled-skills.mjs --out <temporary-directory>` 装配到唯一创建的临时目录；记录现有 npm 来源条目需要的联网操作。规划期间不修改默认清单。

### 任务 5：文档、资格验证与可安装桌面交付

**按影响更新：** Team 与工具 README 双语文件、`apps/desktop/README.md`，以及覆盖到的分支变更对应 upstream intake 注册表。模型可见保证保留在所属包，技能链接引用。新增生命周期或持久化变更需要所属文档、声明类型变更确认，以及适用时的 TypeScript/Python SDK 投影；仅新增技能不构成 Session 格式升级理由。

**步骤：** 运行定向行为与快照检查、技能元数据验证、`pnpm run test:docs` 及 `pnpm run doc-sync`。准备提交或推送时应用 `dsh-pre-push-checks`，保留无关未提交内容。准确记录阻塞或未执行检查，不复用旧打包证据。

**桌面资格验证：** 按现有流水线运行 `pnpm run build`，在 `apps/desktop` 执行 `cargo tauri build`，再从仓库根目录执行 `bash scripts/build-dmg.sh --arch arm64`。包验证器必须通过。将应用从挂载 DMG 复制到全新测试位置与 home，核实安装后的技能内容和发现，执行明确的协作场景，重启并确认任务与消息持久化及未解决状态的真实报告。普通聊天仍不得创建工作者。测试时让启动的应用无法使用 Orca。

**发布证据：** 保留脱敏命令与结果、打包及安装技能的哈希、实际工作者模型选择、Session/任务标识、验收产物及重启观察。不包含凭据或用户私有会话。只声明实际测试的平台与安装路径。Windows 验收需要自己的构建安装器及安装后流程证据，macOS 证据不能替代。

<a id="acceptance"></a>
## 验收与发布

| 里程碑 | 必要证据 | 可以做出的声明 |
| --- | --- | --- |
| 计划 | 源码映射与选定现有测试 | 仅为设计草案 |
| 原生技能 | 工具准确的指南、提供者加载、反例、无密钥 Session 回放 | 原生工作流已在测试的组合中验证 |
| 默认内置 | 有效载荷及故意缺失参考文件时的拒绝 | 技能已包含且安装受到检查 |
| 桌面交付 | 全新复制 DMG 应用运行、无 Orca 依赖、明确团队任务、重启、普通聊天对照 | 可用于测试过的桌面平台与渠道 |
| 更强恢复 | 单独评审的运行时设计及对抗性生命周期证据 | 仅限具体已实现保证 |

实施顺序为任务 1、任务 2、任务 3、任务 4、任务 5。运行时修复、技能与快照、分发变更分别形成可评审的限定范围提交。本次规划请求不包含提交、推送或打包。

<a id="deferred-work"></a>
## 延后的运行时工作

自动重试、通用任务尝试标识、旧尝试隔离、机器强制验收、跨工作者阻塞问答状态、远端执行位置及分布式清理不属于第一版承诺。每项需要的扩展均应先明确所属服务与使用方、持久化转换、准确执行权限、取消结束点、重启行为、模型与用户可见输出及反例。只有完整使用方映射成立时才能复用常设团队尝试所有权，不因类比 Orca 而另建一套协调运行时。

此前评审发现的四项记忆缺陷属于独立工作。此技能不得依赖自动记忆提取，也不能暗示安装编排技能会修复记忆删除、提取或提示选择行为。
