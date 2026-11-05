---
description: "可安装的配置层：为会话添加可持久化、会过期的结构化提问与桌面一键作答，供组合或自定义配置的用户使用。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-session-decisions

[English](README.md) | 中文

## 概述

这一层为配置中的 Agent 提供一种持久、结构化的方式向用户提问，问题可以跨越轮次、压缩与重启而存活。它会插入 Host 决策服务、`request_persistent_question` / `read_persistent_question` 两个工具，以及一个可选启用的 `persistent-questions` Agent 预设；配套的客户端渲染问题卡片。每个 Session 同时最多存在一个未决问题，提出新问题前必须先回答、取消或被新的用户输入取代。本包以实验性名称发布，不承诺任何稳定性。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当模型需要用户在桌面或浏览器输入框中一键作答、且必须在提问会话被压缩之后仍可读的阻塞性选择时，把这一层加入配置。

### 安装到配置

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-session-decisions
dsh plugin --profile <name> remove @deepseek-ai/dsh-experimental-session-decisions
```

本包的 `dsh.bundle.patch` 在 reconcile 时应用两层：Host 补丁（`cordis.patch.yml`）在有持久化存储时挂载决策服务，预设补丁（`preset.cordis.yml`）插入可选启用的预设行。移除本包即同时撤掉两层。缺少补丁声明时该层不激活，工具保持缺席。所有限额均可选并在启动时校验：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 功能开关；禁用的服务不打开存储域也不受理任何答案 |
| `feishuEnabled` | `false` | 通过桌面现有 IM 连接发送选择题通知；需要 `desktopIm` 和会话持久化服务 |
| `defaultTtlMs` | `86400000` | 问题默认有效期（24 小时） |
| `closedRetentionMs` | `2592000000` | 已关闭记录保留期（30 天） |
| `maxRecords` | `1000` | 保留记录上限（含未决与已关闭） |
| `maxQuestionBytes` | `16384` | 问题文本的最大 UTF-8 字节数 |
| `maxChoices` | `8` | 每个问题的选项数上限 |
| `maxChoiceLabelBytes` | `512` | 单个选项文本的最大 UTF-8 字节数 |
| `maxAnswerTextBytes` | `16384` | 自由文本答案的最大 UTF-8 字节数 |
| `reconcileMaxEvents` | `100000` | 启动 reconcile 时每个会话扫描的持久会话事件数上限；超出后剩余部分按"未知"保守处理 |

请在空白新会话页面、工作目录旁的预设选择器中选择 **Persistent questions**，再发送第一条消息。安装本包不会让默认标准模式或已有团队会话自动获得这些工具。请使用没有运行中队友或后台任务的独立根会话测试持久问题。

### 你会得到

模型获得两个 Agent 作用域的工具——提出一个带编号选项、会过期的问题，以及在压缩后以 JSON 读取已保存记录——外加"同一时刻至多一个未决问题"的不变式、在步骤结束或新的已认证人工输入被领取时释放的生产步骤守卫，以及经由普通排队提示路径的答案受理。客户端在禁用状态渲染前同步锁定操作，拒绝作答时保留草稿，重试读取时保持面板可见。

-----

待回答卡片直接显示在普通输入框上方，不受工具历史折叠影响。提问轮次结束时会立即刷新共享问题缓存；后台另每 15 秒核对外部状态变化。点击选项会立即提交；文字回答请填写卡片内的回答框，再点击「发送回答」。页头问号保留为快捷入口。回答进入会话或问题被取消后，待回答卡片收起，保存的问题仍可在工具历史中读取。

### 可选的飞书回答

在桌面配置飞书连接后，将 `session-decisions` 的 `feishuEnabled` 设为 `true`。桌面继续持有唯一连接，问题功能只注册卡片回调。连接离线时，仍可在桌面回答。自由文本问题只在桌面回答；选择题通过纯文本按钮作答。飞书中直接输入文字仍进入独立的 IM 会话，卡片按钮才回答原问题。

问题记录持有通知状态。发送前先保存发布占位；发送确认丢失时保留“待确认”，不自动重发。卡片绑定平台消息、应用、租户、操作人、聊天、工作目录、问题版本和持久化授权代次。禁用连接或替换凭据会先更新授权代次，再替换凭据；正常退出保留代次以支持重启。

通过验证的卡片回答复用桌面回答的同一占位及排队输入路径。独立的 `decision_answer_receipts` 存储域复用 IM 回执和对账能力。占位后写回执失败时，回答保持待确认，重试不会再次投递。回答进入会话不等于业务操作完成。完成身份及目标验证后的回调响应会把卡片替换为不可作答的展示；外来回调不会得到问题内容。不承诺离线回调；重启后可在桌面回答。合成 Host 测试不能证明真实飞书应用的权限或投递行为。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Host 补丁文档在存储插件之上插入服务行；预设补丁插入一行 `@deepseek-ai/dsh-agent-preset`（`preset-persistent-questions`，order 2），其中重述了随包标准子清单，外加 `./tools` 消费者行和一行显式钉死 `mode: native` 的 `@deepseek-ai/dsh-agent-tool-presentation`。之后的用户配置编辑会整体替换该预设行的 config 且不会被强制改回：被移除的消费者保持移除，用户选择的 PTC 或 both 模式保持"可宣告但拒绝"语义。激活采用声明式依赖门控：启用的服务会等待会话依赖就绪，不受配置挂载顺序影响；禁用的服务不要求这些依赖。服务负责保存、取代、过期清扫、守卫武装与答案受理；观察者关联持久会话证据——队列编辑让替换消息保持跟踪并跟随文本摘要，原载荷重试会判定冲突——启动 reconcile 通过公开只读持久化句柄读取每条记录锚点之后的持久会话证据：普通输入跨重启取代过期未决问题，已写入日志但索引写入失败的答案重建为 admitted 且不再二次提示。无法核实的证据按"失败关闭"处理：缺少可用锚点、会话日志不可读或超出扫描预算的未决问题拒绝受理（重试返回 `reconciliation_required`），普通取消与关闭流程保持可用；没有持久进入证据的保留降级为诚实的 `needs_reconciliation` 未知态。`src/client/` 负责卡片。源码映射：`cordis.patch.yml`、`preset.cordis.yml`、`src/`。

</details>

会话持久化所有者必须先刷盘对应的人工消息，任何竞争中的问题记录更新才能将其记为 admitted。已进入会话的证据仍优先于关闭跟踪，但必须等待刷盘确认；缺少写入方或刷盘失败会禁用进入索引并保留不确定状态。这一顺序不构成两个存储之间的事务。统一的卸载所有者先等待卡片操作结束，再关闭问题域及回执域。

过期与保留期清理共用一个定时器。清理进行中或停止后的通知不会再次启动清理；重新安排定时器时丢失存储，会被捕获并反映为功能不可用状态。

-----

<a id="model-experience"></a>
## 模型体验

### 持久问题

#### 模型看到什么

`request_persistent_question` 返回已保存问题的决策 ID、修订号、过期时间与选项，结果文本说明答案格式约定：答案以排队用户消息到达，以 `Answer to question <decisionId>:` 开头。问题需要零个选项（有界的自由文本）或至少两个选项；单选项问题在任何保存之前即被拒绝。`read_persistent_question` 以 JSON 返回已保存记录，但不包含线上请求 ID——该关联标识只留在 Host 侧面向客户端的视图中——因此问题与其答案在上下文压缩后仍可读取。在 PTC 程序内，提问工具以固定字面量拒绝："Persistent questions are unavailable inside PTC programs. Ask the user in ordinary chat instead."

#### Token 影响

每个问题增加一条工具结果（约定文本加编号选项）和一条排队的用户消息（答案句）。持久化的 `{ decisionId, revision }` 展示元数据随结果元数据提供给客户端卡片，不消耗模型 token。

#### KV Cache 影响

问题工具结果追加在该步骤可复用前缀之后；答案作为更晚的用户消息到达。压缩之后，已保存记录仍可通过 `read_persistent_question` 取回，而不是依赖上下文。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下限制描述该功能当前做不到或需要特别运维注意的事项，属于本包现状约束，而非与其他提问机制的比较。

- **每个 Session 至多一个未决问题** — 提第二个问题前必须先回答、取消或取代第一个；没有问题队列。
- **仅限根会话** — PTC 程序、受委托子代理、拥有运行中后台任务或存活子代理会话的会话，以及 Team 队友（或拥有运行中/供应中队友的 Lead）都会被拒绝并回退到普通聊天。
- **用户编辑过的 PTC 组合** — 保留工具消费者但把展示模式改为 PTC 或 both 的已存预设编辑依赖"可宣告但拒绝"：SDK 可以宣告工具，读取工具保持可用，问题创建在保存前返回固定的 PTC 拒绝。
- **答案由单进程判定** — 持久证据可以判定保留状态，重启时从每条记录的持久会话证据重建已判定事实（admitted、取代）；但只有拥有会话存活代理的进程会观察到新事件，由另一 harness 进程作答的会话只有在该进程观察到事件时才会 reconcile。在上下文锚点字段出现之前创建的记录无法用持久证据证明上下文时效：未决的此类记录按"不可核实"拒绝受理（失败关闭），而不是保持可作答。
- **无稳定性承诺的实验原型** — 本包公开，但在孵化期内契约可以自由变化。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

`lib/typert/` 中的生成物已建立检查点；检查点之后的主机线格式变更在验收前需要最终重新生成。composition 测试保证本功能预设清单与 `packages/bundle/web-app/presets/standard.patch.yml` 同步，并通过 `applyEntryPatches` 钉死离线补丁语义，因此单独改动任一补丁文件会让这些测试失败。Root 负责安装器钉扎与共享元数据；清单依赖变更需要 root 执行 `pnpm install` 同步后才能验收。

</details>
