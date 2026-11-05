---
kind: upgrade-guide
description: 定时任务工具和远程接口改为通过带类型的时间规则、明确目标及修订检查编辑管理宿主级任务。
---

# 定时任务管理

[English](guide.md) | 中文

## 变更

定时任务继续使用同一宿主服务和自动化任务面板，支持手动创建、编辑、立即运行和清除已结束任务。模型工具为 `schedule_create`、`schedule_list`、`schedule_view` 和 `schedule_edit`。移除旧 `schedule_update` 和 `schedule_delete` 工具及远程接口；历史对话结果仍可显示。

创建接受 `{title, prompt, timing, target?}`，时间规则仍为 `after`、`at`、`every`、`daily`、`weekly` 和 `cron`。目标为 `session`、`new_once` 和 `new`。省略目标时，首次投递新建一个会话并复用。列表返回包含 `items`、`shown`、`total`、`limit` 和 `offset` 的分页。历史按任务标识读取，不再绑定会话。

定时任务存储领域写入版本 2，在内存中读取版本 1，打开时不改写。下一次任务变更才写入当前字段。JSON 整单元存储接受明确声明的兼容版本，下一次成功变更写入当前版本。不改变会话日志代际或全局 SQLite schema。投递仍为至少一次：保留目标可避免重启后新建重复会话，但崩溃可能造成重复入队。

## 迁移

1. 将创建参数的顶层选择器移入 `timing`，例如 `{kind: 'after', after_seconds: 60}`。要继续向现有会话投递，传入 `target: {kind: 'session', sessionId}`；省略会有意改变投递目标。
2. 读取 `list(...).items`，通过 `view({id})` 查看任务。更新改为 `edit({id, action: 'update', patch, expectedUpdatedAt})`，删除改为 `edit({id, action: 'delete', expectedUpdatedAt})`。传入最近读取的 `updatedAt`，旧行没有修订时传 `null`，以检测冲突。
3. 更新预设工具过滤为四个当前名称。进程内智能体消费者向 `create` 和 `edit` 传入实际行动会话，人类远程调用不传。历史请求移除会话标识。
4. 首次变更前保留备份。确认旧任务显示会话目标，未指定目标的创建采用 `new_once`，过期编辑返回 `schedule_conflict`，且重启后投递复用保留会话。旧精确版本调度器无法打开新版任务行。
