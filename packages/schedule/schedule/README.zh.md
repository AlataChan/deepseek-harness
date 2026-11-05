---
description: "宿主级持久化自动化任务，支持六种时间规则和三种会话目标。"
kind: "package-reference"
---

# @deepseek-ai/dsh-schedule

[English](README.md) | 中文

## 概述

宿主级持久化自动化任务，支持六种时间规则和三种会话目标。

<a id="use-this-package"></a>

## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## 使用本包

同一个 Schedule 服务负责创建、分页列表、完整目录、单任务查看、编辑、立即运行、投递历史和清除已结束任务。管理读取不激活会话。人类远程调用不携带行动会话；模型消费者传入实际会话，仅记录参与关系，不授予人类权限。

创建需要不超过 120 字符的名称、非空指令，以及选择 `after`、`at`、`every`、`daily`、`weekly` 或 `cron` 的 `timing` 对象。固定间隔至少为 60 秒。每日、每周和五字段 Vixie cron 规则保存明确的 IANA 时区，跳过不存在的本地时间，重复时间选择较早的一次。周期任务仅投递最近一次错过的执行。

目标为 `session`、`new_once` 和 `new`，省略时默认为 `new_once`：首次投递新建一个会话，随后复用；`new` 每次投递新建会话。现有目标不能归档或由委派智能体拥有。新建会话通过现有会话控制器完成，未指定 cwd 时继承行动会话原始头部的 cwd；有效执行目录不替换此身份。

`edit` 接受更新补丁或删除操作。`expectedUpdatedAt` 与已存修订比较；旧记录无修订时使用 `null`。每次接受的编辑都推进修订，时钟回退也不例外。暂停和结束记录仍可读取。恢复过期周期任务会选择未来一次执行；已过期的一次性任务需要替换时间。立即运行不消耗原定执行。取消会在持久化写入前检查，包括等待队列后；已开始的写入不回滚。

<a id="understand-the-implementation"></a>

## 理解实现

`schedule` 领域写入版本 2，通过 `compatibleVersions: [1]` 读取版本 1。旧 `sessionId` 仅在内存中转换为会话目标，`inactive` 转换为 `ended`。打开不改写；下一次变更才写入不含旧绑定的当前记录。历史版本 1 的 `schedule/change` 会话事件保持惰性且定义不变。

新建投递会话前，运行时在同一任务行持久化 `pendingDelivery`，保留稳定会话标识。冷启动通过 `sessionController.create` 和 `resolveAgent` 采用该标识。投递以 `schedule` 来源入队，不带用户 RPC 标识，等待会话持久化，然后更新该任务的回执和周期。这些是独立持久化写入；至少一次投递在崩溃后可能重复。普通收件箱处理会让投递取代正在等待的问题，且不会授予 Goal 人类权限。

历史按最新在前分页，明确页大小为 1–100。旧回执在读取时补充已有目标会话标识；缺失回执不重建。保留期限默认 30 天、200 条，通过 `deliveryHistoryDays` 和 `deliveryHistoryRecords` 配置，仅在追加时裁剪。

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
