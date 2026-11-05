---
kind: upgrade-guide
description: "执行工具改用会话执行目录，持久化工作区仍保留原始身份。"
---

# 执行目录升级

[English](guide.md) | 中文

## 变更

文件、Shell、LSP、技能、指令、展示、PTC 和钩子操作的相对路径基于执行目录解析。会话 header.cwd、沙箱 workspaceRoot、导航、数据与知识绑定、飞书授权、商务及媒体文件、团队预览继续使用原项目。新增 working-directory/change 和 worktree/record 事件为必需读取事件。已启动的 Shell 保持启动时目录。

## 迁移

1. 挂载执行工具的自定义组合必须同时挂载 dsh-working-directory、文件系统、session-projection 和 system-prompt；需要目录工具时挂载 dsh-tool-working-directory。
2. header.cwd 和沙箱 workspaceRoot 保持原项目。执行前调用 ctx.workingDirectory.ensure(agent, signal)，明确切换时调用 set(agent, path, signal)。
3. 确认新命令使用选定工作树，导航和授权仍使用原项目。通过变更页签返回或恢复目录。包含新增必需事件的日志不可交给不认识这些事件的旧构建；历史格式代际保持原位。
