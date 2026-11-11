# 任务模板与共享任务板用法

共享任务板是 Team 内唯一的分工登记处。任务就绪（ready）只表示依赖满足，不会启动任何人；启动仍然只来自显式 `spawn_teammate` 或 `send_message`。

## 建单模板（team_task_create）

```json
{
  "subject": "为订单导出功能补齐验收测试",
  "description": "目标：……。验收证据：……。限制：……。完成后向 lead 发送报告，报告必须包含：任务标识、产物路径、执行的检查与结果、局限、是否发生过文件编辑。",
  "blocked_by": ["task-1"],
  "write_scopes": ["src/export/", "tests/export.spec.ts"]
}
```

- `description` 必须自包含：目标、验收证据、限制、报告要求。成员拿不到本会话的上下文。
- `blocked_by` 引用已有任务 id；形成环会报 `TEAM_TASK_DEPENDENCY_CYCLE`，依赖未满足就 claim 会报 `TEAM_TASK_BLOCKED`。
- `write_scopes` 是建议性的工作区相对前缀，用于提示分工边界；它不是锁，不阻止他人写入。两个任务的 scopes 重叠时 `team_task_list` 会给警告：按"共享文件同一时间只有一名编辑者"协调，而不是假设会被强制隔离。

## 认领与迁移（team_task_update）

标准序列：`team_task_list`（或 `get`）→ 用最新 `revision` 作为 `expected_revision` → `claim` → 干活 → `complete`。

```json
{ "task_id": "task-2", "expected_revision": 3, "action": "claim" }
```

- 修订号过期报 `TEAM_TASK_STALE_REVISION`：重新 `team_task_get`，基于最新值再操作一次；不要盲改其他人的字段。
- 只改自己任务需要的字段；`edit`/`set_dependencies` 会整体替换对应字段。
- `reassign` 仅 Lead 可用。`release` 是把任务放回待认领，不是成员生命周期操作。
- Lead 收尾前逐条核对每个必需任务：`pending`/`in_progress` 的任务按未完成记账；不要把成员的完成话术当任务完成。

## 成员报告模板（成员向 lead 发送）

```
任务：<task_id> <subject>
产物：<文件路径 / 命令输出位置；没有产物时写明>
检查：<执行了哪些检查，结果如何；没跑的写明原因>
局限：<遗留问题、假设、未覆盖场景>
编辑：<列出改动过的文件；未编辑则写"未编辑文件">
```

Lead 的验收方式：亲自读取报告里声称的产物、复跑关键检查；证据缺失或与任务验收标准不符时，把任务按未完成处理并要求补充，不得替成员编造结果。
