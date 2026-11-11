---
name: team-orchestration
description: 只在用户明确要求使用 DSH Agent Teams / 团队协作 / 委派队友时使用。指导 Lead 用真实的 Team 工具做委派、共享任务板、耐久消息和有界监督；包括常设编制（standing squad）与临时 ad-hoc 团队的分支处理、队友模型路由规则、产物核验与如实收尾。本技能内容是指引，不是权限 enforcement。
whenToUse: 用户明确提出"用团队/队友协作、委派、多智能体分工"时。没有 Team 工具时解释限制并继续，不招募、不安装替代品。
---

# Agent Teams 协作（Lead 指引）

只有用户本轮明确要求使用 Agent Teams / 队友协作时才创建队友。创建队友只允许 Team Lead 调用 `spawn_teammate`。Team 成员共享同一工作目录和文件系统，写操作互相立即可见；`write_scopes` 是建议性提示，不是文件锁，也不承诺只读成员。共享文件同一时间只安排一名成员编辑；需要审查的改动让 Lead 复核最终 diff 并运行测试。缺少 Team 工具时，如实说明当前会话不具备团队协作能力，然后继续完成用户任务本身。

## 第一步：判断团队形态

- **常设编制（standing squad）**：会话已是某个编制（文书组/案例组/传播部）的常设 Lead。识别依据：系统提示的 Team 政策里有"你是机构小队「…」的主控"字样，且 `list_agents` 能看到编制座位的常驻成员。只使用已有席位，绝不为本主题追加新成员。席位的 provider/model 绑定属于编制目录（institution catalog），由 Host 管理；模型不修改席位配置。Host 的 round 远程接口不是模型可调用的工具。向自己所属的常设 round 发普通消息可能需要等待；不要通过另招替补来"绕过"等待。`list_agents` 里看不到编制座位，或某个座位 `status` 为 `failed`（原因见 `diagnostics`），说明本会话的常设编制配置尚未完成或被中断：如实向用户转述 `list_agents` 的状态和诊断信息，请用户从首页「机构常驻小队」卡片重新进入该编制或调整座位模型；重新进入不保证 failed 的座位会被自动修复。不用 `spawn_teammate` 顶替席位。
- **临时团队（ad-hoc）**：用户要求为本次任务组建团队。Lead 用 `spawn_teammate` 显式创建每一名成员；成员是耐久的，任务结束后不自动销毁，也不自动重生。

## 队友模型路由（spawn_teammate）

- `context: "fresh"`（默认）从零开始；`context: "fork"` 继承 Lead 已完成的轮次。fork 队友不允许任何模型覆盖参数：传入 `provider`/`model`/`reasoning_effort` 会报 `TEAM_FORK_NO_ROUTE_OVERRIDE`（fork 继承 Lead 的路由以复用 KV cache 前缀）。
- fresh 队友可以显式选路由，但 `provider` 与 `model` 必须成对提供，且要求 Lead Session 配置了模型选择策略（routes 白名单）。请求的路由不在白名单时工具会报 `child LLM route "provider/model" is not allowed for this Session`；会话未开启选择时报 `child model selection is disabled for this tool instance`。把真实报错转述给用户，不要改写或臆造错误码。
- `reasoning_effort` 是可选覆盖。注意：换了 provider/model 路由而未显式给 `reasoning_effort` 时，原路由上的 effort 会被清除，新路由使用其自身默认值。
- 区分"请求的路由"和"生效的路由"：`spawn_teammate`/`list_agents` 成员行里的 `provider` 字段是委派机制（默认为 `spawn`/`fork`），不是生效的 LLM 服务商；`model` 字段是生效模型 id，已知时返回、可能缺省。生效的 LLM 服务商和 reasoning effort 这些工具都不展示。汇报时给出请求的路由加上返回的 `model`，其余如实说明未经核实；不要把 `provider` 字段当生效服务商汇报。

## 正常工作流

1. **目标与证据**：先把用户要的结果、验收证据、限制写成可检查的陈述，再动队。
2. **所有权与依赖**：用 `team_task_create` 建共享任务（subject/description/blocked_by/write_scopes），用 `team_task_get` 读最新值，用 `team_task_update` 配合 `expected_revision` 做 claim/complete 等迁移。任务就绪不会自动启动任何人；启动只来自显式 `spawn_teammate` 或 `send_message`。
3. **显式启动**：每名成员一个明确职责和完整初始任务（prompt 必须自包含）。
4. **耐久消息**：`send_message` 是耐久投递。返回 `status: "queued"` 也代表已落盘，不要重发；普通发送没有恰好一次承诺，第二次发送会产生新消息。运行中的目标在最近的步进边界收到，空闲目标被唤醒，inactive 成员冷恢复。
5. **有界监督**：`wait_agent` 只观察调用之后的变化，不会唤醒 inactive 成员；没有其他成员在运行/准备中时立即返回 `noProgress`。等待前先 `list_agents` 确认有活跃同伴；超时或唤醒后重新 `list_agents` / `team_task_list`，不要空轮询。
6. **产物核验**：需要人在执行前批准的补丁、命令或后续任务，用 `propose_action`（仅 Lead）交人工审批；不需要审批的成员产出也由 Lead 亲自核实后才记账。Lead 亲自检查产物文件/运行结果，不把成员自述当证据。FS_STALE_VERSION 的文件冲突按重读-重放-重试处理；命令、生成器不受版本保护，需显式协调。
7. **如实收尾**：逐条核对每个必需任务；`succeeded/failed/unresolved` 这类文字标签只是报告用语，不是 Team 的内置状态。缺少证据或任务未完成时如实标记 unresolved，不编造成果。成员报告必须能对应到任务、产物、检查结果、局限和是否发生过编辑。

工具集以此为准：`spawn_teammate`、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent`、`propose_action`、`team_task_create`、`team_task_list`、`team_task_get`、`team_task_update`。Team 没有别的模型可调操作。

## 参考资料（按需显式读取）

`skills.get()` 只返回本文件正文，不会自动带上引用文件。需要时用文件读取工具按本技能目录下的相对路径显式读取：

- [任务模板与共享任务板用法](references/task-spec.md)：建单、认领、依赖、write_scopes 与成员报告模板。
- [异常与恢复](references/recovery.md)：中断、inactive 成员、排队消息、未决结果、重名与失败配置的处理。
