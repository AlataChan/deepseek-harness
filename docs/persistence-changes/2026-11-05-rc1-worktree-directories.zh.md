---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-05-rc1-worktree-directories

[English](2026-11-05-rc1-worktree-directories.md) | 中文

## 概述

新增必需的 working-directory/change 事件、working-directory 消息来源和 workingDirectory 投影。 新增必需的 worktree/record 请求、取消、创建及恢复记录，并提供 forgeWorktree 投影。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-05-rc1-worktree-directories
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-14-persistent-assistants-stage-c"
    after: "589c40dfcf75db2f53f7b8dad956a5cee91218496f007ecfbe136f83df50e25a"
    decision: same-version
  - root: "event:assistant/auxiliary"
    previous: "2026-10-14-persistent-assistants-stage-c"
    after: "38033a3c71f48f43420b9d2eee6f1d5b702e3d4f53628a9509759d1a77b2c649"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-14-persistent-assistants-stage-c"
    after: "a30e4bb3c1e8878e52a6a7c7614bfcb941f76957d74f37951b773091ef8dca30"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-14-persistent-assistants-stage-c"
    after: "6d7de69faba4defbdf9c384671401b6c67fa5ecf0fc38630055c8265c3eb4965"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-14-persistent-assistants-stage-c"
    after: "2e9dc9eb417abe5c021c31782f5e510f8f063db0cac9e34f1c5fe5a608644b4c"
    decision: same-version
  - root: "event:working-directory/change"
    previous: null
    after: "124aa62078ca3311353b39cc3bf6c75da281338be6bbf672f8b361d828cddca3"
    decision: same-version
  - root: "event:worktree/record"
    previous: null
    after: "e77034285cded4066f8070cb67d6f7ade6da3a625e97996fc4c92d5596ab83ca"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有格式 4 日志继续有效且不会重写。新事件为必需读取事件，不可忽略；不认识这些事件的旧构建会拒绝读取。Header.cwd 保持原项目，投影缓存域版本 7 和 SQLite 版本不变。冻结的历史代际和九种已有必需分支事件保持原状。

<a id="verification"></a>
## 验证

根协调方独立使用 Node 运行 Vitest：新增组件 11 个测试文件、92 项测试通过，覆盖真实 Git 创建与恢复、沙箱拒绝、目录准入、冷启动 Host 控制器和真实双面模块发现。钩子、工作流和持久问题守卫回归测试 261 项通过。当前类型分类器报告两个新增必需事件根及五个仅来源标注扩展，均允许维持版本；历史 Session 代际和 SQLite 版本未改变。这些定向结果不代表最终交付验收。

<a id="dev-note"></a>
## 开发备注

无。
