---
description: "在同一自动化任务页面中手动创建、编辑、运行和查看投递历史。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-schedule

[English](README.md) | 中文

## 概述

在同一自动化任务页面中手动创建、编辑、运行和查看投递历史。

<a id="use-this-package"></a>

## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## 使用本包

唯一的 Automation tasks / 自动化任务侧栏入口打开宿主级目录。“新建”启动会话，“手动创建”在现有详情栏打开表单。手动创建支持全部六种时间规则，以及现有会话、仅新建一次会话和每次新建会话三种目标。搜索及全部、启用、暂停、已结束过滤操作保留目录。

所选任务包含规则与记录标签页。规则通过带修订检查的 `edit` 修改名称、指令、时间和目标。“立即运行”调用 `run`，暂停与恢复修改活动状态，清除已结束任务调用 `deleteInactive`。此详情中已结束任务的名称和指令保持只读。关联会话入口在打开目标前检查当前会话和工作区元数据。会话头部目录和侧栏标记读取目标字段，不假设每个任务都有原始会话。

页面、右侧栏任务标签、对话记录卡片和侧栏标记保留现有注册。本包仅注册英文和中文字典，不创建第二个调度器或第二个自动化任务面板。

<a id="understand-the-implementation"></a>

## 理解实现

目录仅在被观察时订阅。`schedule/changed` 通知或连接重置使正在进行的读取失效；清除已结束任务后的回读同样取代旧响应。变更失败会保留可见草稿并提供重试。记录按任务标识延迟读取，每页二十条已存回执，不激活会话；切换任务会忽略旧响应。投递记录表示收件箱接收，不表示模型完成。

<a id="model-experience"></a>

<a id="further-exploration"></a>

## 进一步阅读

- [Schedule subsystem](../../../docs/subsystems/schedule.zh.md).

## Model Experience

本浏览器界面不直接影响模型；模型可见工具与投递由定时任务的所属包负责。

#### KV Cache effect

模型请求内容及缓存效果由所组合的所属包决定；本包不发起辅助模型请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 宿主必须保持运行。崩溃可能导致重复投递，删除任务不撤回已入队输入。历史保留无法重建缺失回执，也不证明模型执行完成。

### 开发备注

<a id="dev-note"></a>

None.
