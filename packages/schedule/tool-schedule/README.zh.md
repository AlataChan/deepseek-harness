---
description: "预设范围内的宿主任务创建、列表、查看和编辑工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-schedule

[English](README.md) | 中文

## 概述

预设范围内的宿主任务创建、列表、查看和编辑工具。

<a id="use-this-package"></a>

## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## 使用本包

将此消费者与宿主 Schedule 服务一起挂载到智能体预设。它仅注册 `schedule_create`、`schedule_list`、`schedule_view` 和 `schedule_edit`，由挂载范围负责清理。每次调用都需要智能体；委派调用者会在派发前被拒绝。

`schedule_create` 接受 `title`、`prompt`、一个带类型的 `timing` 和可选 `target`。时间规则支持 [Schedule 服务](../schedule/README.zh.md) 记录的六种，目标默认为 `new_once`。`schedule_list` 接受活动状态过滤和分页，返回 `items`、`shown`、`total`、`limit` 与 `offset`。`schedule_view` 按规范标识读取任务。`schedule_edit` 接受带补丁的 `action: update` 或 `action: delete`，可用修订标记阻止过期写入。不存在旧更新或删除工具别名。

任务归宿主所有，因此工具可以管理其他会话创建的任务。创建和编辑时传入实际行动会话，仅记录参与关系。工具不将投递来源设为 user，创建或修改任务需要明确用户授权。

<a id="understand-the-implementation"></a>

## 理解实现

本包在 `ctx.schedule` 可用时通过 `ctx.tools` 注册带类型的工具 schema。没有宿主服务就没有工具。工具解析时为 JSON 目标标识添加类型品牌。`ScheduleInputError` 转换为稳定的 `{ code, message }`，其他异常变为 `internal_error`，不暴露存储细节。计时器、存储、重启和投递由宿主负责。

<a id="model-experience"></a>

<a id="further-exploration"></a>

## 进一步阅读

- [Schedule subsystem](../../../docs/subsystems/schedule.zh.md).

## Model Experience

### 任务工具与投递

#### What the model sees

可见工具贡献固定 schema 前缀。每个结果为一块无损 JSON 文本，包含已存任务、分页列表、删除、冲突或错误。结果追加到会话历史并保留至压缩，令牌成本随内容和页大小变化，保留之前可复用前缀。到期输入使用现有提醒格式和 `schedule` 来源。

#### Token effect

目录读取不发送模型请求，工具结果和投递内容的成本随实际文本增长。

#### KV Cache effect

已记录结果追加在历史末尾；工具注册变动可能使 schema 前缀失效。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 宿主必须保持运行。崩溃可能导致重复投递，删除任务不撤回已入队输入。历史保留无法重建缺失回执，也不证明模型执行完成。

### 开发备注

<a id="dev-note"></a>

None.
