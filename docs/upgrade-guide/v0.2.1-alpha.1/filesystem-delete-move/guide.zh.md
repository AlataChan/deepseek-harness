---
kind: upgrade-guide
description: "实现 FileSystem 的代码必须增加 deleteFile 与 moveFile；除非组合显式设置 applyPatch，否则 apply_patch 保持关闭。"
---

# 文件系统删除与移动

[English](guide.md) | 中文

## 变更

`FileSystem` 现在要求实现 `deleteFile` 与 `moveFile`。`deleteFile` 删除一个普通文件。`moveFile` 把源文件文本或调用方提供的替换文本发布到目标路径，然后删除源文件。两条路径相同时报告 `FS_SAME_TARGET`。目标路径已经发布而源文件仍在时，结果以 `sourceDeleted: false` 结束，不会回滚。

`fs/delete-intent` 是删除的观察防护。编辑和移动的源路径仍使用 `fs/edit-intent`。目标路径使用 `fs/write-intent`。已交付的 base、headless、desktop、standard 和 persistent-question 组合保持启用 `fs-observation-policy`，并让 `tool-fs` 的 `applyPatch` 为 false，因此在部署把 `applyPatch` 设为 true 之前，`apply_patch` 不会注册。

多文件补丁仍然不是一次事务。`apply_patch` 在任何写入之前拒绝符号链接源路径或目标路径，更新或移动会保留已有文件的 CRLF 换行。调用方在一次写入之后取消时，中止结果仍会写出该路径以及未执行的操作。此 seam 不改变会话日志格式。

## 迁移

1. 每个继承 `FileSystem` 的类都要实现 `@deepseek-ai/dsh-fs` 中的 `deleteFile` 与 `moveFile`。沙箱后端必须先围栏每条路径再委托。SSH 辅助程序必须接受 `fs.delete` 与 `fs.move`。
2. 除非该部署应当暴露 `apply_patch`，否则保持 `applyPatch` 为 false。不要给 `fs-observation-policy` 设置 `disabled: true`。
3. 确认删除只移除已读取的普通文件，移动到未读取的现有文件时两边都不变，源删除失败时新目标路径留下并在结果中说明。不需要重写会话日志。
