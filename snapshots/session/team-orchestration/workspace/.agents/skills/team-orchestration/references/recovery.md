# 异常与恢复

这些是当前 Team 运行时的真实边界。按现状处理并如实向用户汇报；不要宣称存在不存在的自动恢复或隔离保证。

## 中断（interrupt_agent）

- `interrupt_agent({ target })` 请求取消该成员当前轮次，返回 `previousStatus`。中断是"请求停止"，不是终止成员；成员身份、待收邮箱、已认领的任务全部保留。
- 被中断成员认领的任务不会自动完成，也不会自动回退；Lead 用 `team_task_update` 决定 release（放回待认领）或保持 in_progress 等成员恢复后继续。
- 中断后先 `list_agents` 复查状态，再决定是重新 `send_message` 唤醒还是收尾记账。

## inactive 成员

- inactive 成员不会响应 `wait_agent`；`wait_agent` 从不唤醒任何人，没有其他成员在运行/准备中时立即返回 `noProgress`。
- 唤醒 inactive 成员的方法是 `send_message`：投递后会冷恢复。唤醒前不要空等。

## 排队与重复发送

- `send_message` 返回 `status: "queued"` 表示消息已耐久落盘，会在目标可达时投递。不要重发。
- 普通发送没有去重键：对同一内容再发一次会产生一条新消息。需要"再提醒"时发新的、有增量信息的消息，并说明这是新消息。

## 未决结果（unresolved）

- 成员会话可能以 `result.outcome: "completed"` 结束，而其认领的任务仍停留在 in_progress：报告完成不等于任务完成。这类任务按 unresolved 记账：Lead 亲自检查产物，能补救则补派，不能补救则如实向用户报告未完成。
- 文字标签 `succeeded` / `failed` / `unresolved` 只是 Lead 报告用语；Team 的任务状态只有 `pending` / `in_progress` / `completed`（以及 deleted）。

## 重名与失败配置

- 队友名字在本 Team 内唯一（lower-kebab）。重名报 `TEAM_MEMBER_NAME_TAKEN`；配置失败的名字同样占用，不会释放。换一个新名字重建，不要指望旧名字被回收，也不要复用旧名字。
- 非 Lead 调用 Lead 专属操作（`spawn_teammate`、`interrupt_agent`、`propose_action`、reassign）报 `TEAM_LEAD_REQUIRED`：不要找成员绕过，改由 Lead 自己执行。
- fork 队友携带模型覆盖参数报 `TEAM_FORK_NO_ROUTE_OVERRIDE`：要么去掉覆盖参数，要么改用 fresh。
- 路由不在会话白名单报 `child LLM route "..." is not allowed for this Session`：如实转述给用户并请用户调整会话的模型选择策略；不要换一个未经确认的路由偷偷重试。
- 会话未开启显式选路报 `child model selection is disabled for this tool instance`：省略 provider/model/reasoning_effort，让成员继承默认路由。
- 环依赖报 `TEAM_TASK_DEPENDENCY_CYCLE`，未满足依赖报 `TEAM_TASK_BLOCKED`：修正 `blocked_by` 后重试。
