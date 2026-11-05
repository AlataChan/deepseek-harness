---
kind: upgrade-guide
description: "投影所有者等待注册完成，并保留自己的读取句柄。"
---

# 保留投影注册句柄

[English](guide.md) | 中文

## 变更

`sessionProjections.register(definition)` 异步初始化一个投影并返回其 `ProjectionHandle`。所有者保留该句柄，通过 `stateOf(session)` 或 `readerFor(session)` 读取。注册被替换后，读取器仍绑定原来的注册，不会悄悄读取新所有者。初始化失败会拒绝注册；向消费者提供能力前必须等待所有者就绪。

旧的按键读取返回 `unknown`，每个键警告一次。注册结果为兼容同步清理而采用可调用的 thenable，并非原生 Promise。异步 Cordis 插件或 effect 必须等待注册完成并返回 void；返回解析后的句柄不构成有效的 effect 清理函数。

子智能体策略助手 `subagentModelSelectionPolicy` 和 `recordSubagentModelSelection` 现在接受所保留策略句柄的 `stateOf` 读取器，不再接受注册表的按键读取。该句柄保持在工具组合内部。其他领域通过 `agentPresets.presetOf(session)` 读取日志中的预设选择，包括空白会话的切换记录。

桌面媒体助手 `optionalHostSeam(ctx, name)` 返回 `unknown`，不再接受类型参数。消费方依据其已知服务类型进行收窄或断言；该助手只负责服务查找，不验证所选服务的方法。

## 迁移

1. 在拥有投影的插件中等待注册，并保存所得句柄。向消费者提供领域方法，不导出句柄，也不重复注册同一个键。
2. 将同步按键读取替换为所有者保留的句柄或领域方法。保留状态缺失和失败时的拒绝行为，不用空状态代替。
3. 随所有者释放句柄，等待异步清理完成。保留的读取器不转移清理责任。
4. 测试初始化拒绝、并发准备、替换、所有者释放，以及旧投影缓存的冷恢复。注册 API 不改变 Session 日志。

同步清理的兼容细节见[投影参考](../../../../packages/session/session-projection/README.zh.md)。
