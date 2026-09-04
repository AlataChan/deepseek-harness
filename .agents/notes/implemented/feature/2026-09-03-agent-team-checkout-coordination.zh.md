# Agent Note: Agent Team checkout 协作 —— 团队感知的乐观并发

Status: implemented

[English](2026-09-03-agent-team-checkout-coordination.md) | 中文

## 问题

Team 部署已经处于乐观并发控制之下：base 层挂载了 `fs-observation-policy`（`bundle/base/cordis.patch.yml`），Team profile 构建于该 base 之上，因此 Team checkout 对每次文件系统编辑都强制执行先读的 `editIntent`/`replaceIfVersion`。这个拒绝是通用的：撞到的 worker 只得知文件变了，却不知道 Team 里谁改的、也不知道 Team 内怎么解决。而提出新的按文件合作写锁，会与已实现的决策正面冲突——该决策明确拒绝把任务所有权或 write scopes 当作锁，因为外部写者绕过、崩溃的所有者仍持久、路径前缀重叠无法证明语义独立；虚假的互斥比显式警告更危险（[agent-teams](2026-08-05-agent-teams.zh.md)）。

协作规则本身也已是 prompt 策略，不是运行时状态：Team policy 段告诉成员「把写工作拆成不重叠的 scopes、在共享任务上记录预期 write scopes、需排序的工作用任务依赖；write-scope 重叠是 advisory、不是锁」（`tool-agent-team` `TEAM_POLICY`，以及 [agent-teams](2026-08-05-agent-teams.zh.md) 的共享 checkout 边界）。

## 决策

正确性边界保持为现有的带版本 OCC。Team 协作给 stale-write 补救增加归因，不增加运行时锁或并发底座。

`dsh-fs` 暴露 `fs/error-remedy` waterfall event，允许监听器丰富 guarded-mutation 补救文案。`tool-fs` 在仍持有 `FsTarget`、`operation` 与 `actor` 的 catch 点，通过 `remediateFsToolError` 调用该 waterfall，以描述失败的 mutation。

`agent-team` runtime 只监听 `write` 与 `edit` 操作的 `fs/observed`，并记录 `targetKey → teammate name`。它也监听 `fs/error-remedy`，当最近观察到的写入者是 teammate 时，为 `FS_STALE_VERSION` 补上 `last changed by <teammate>; re-read and rebase, or ask the Lead to re-assign`。归因是进程本地的，并与 OCC observed state 对齐；Bash、formatter、generator 与外部写入没有 Team actor 归因。

默认保持共享 checkout 上既有的 prompt 引导串行/写隔离策略：拆成不重叠 scopes 并排序依赖工作。不定义运行时锁，也不定义全局并发设置。并行仍是 Lead 在指派时的判断，`writeScopeWarnings` 是辅助诊断；advisory 的 `writeScopes` 值从不授权写入、从不串行化、也从不证明语义独立（[agent-teams](2026-08-05-agent-teams.zh.md)）。

`fs` invariant 覆盖新的 `fs/error-remedy` event，使该 event 成为已声明 fs 行为的一部分，而不是未经测试的 Team 专用 hook。

## 备选方案

- **新的按文件合作写锁。** 拒绝：它只保护一次本就原子的编辑，或保护 OCC 已拒绝的整文件覆盖，相对 OCC 买不到什么；还会重新引入 [agent-teams](2026-08-05-agent-teams.zh.md) 决策拒绝的虚假互斥风险。
- **运行时强制串行/写隔离。** 拒绝：它需要一个互斥或排序门，其回收与 process-global 语义正是为避开配置开关才绕开的复杂度；prompt 引导策略已表达该意图，模型违反由 OCC 捕获。
- **把 `writeScopes` 当作锁（仅对表）。** 拒绝：计划是预测，外部写者绕过路径前缀，重叠无法证明独立；OCC 才是承重兜底。
- **自动 worktree**。被 [agent-teams](2026-08-05-agent-teams.zh.md) 决策拒绝，因其是部署选择，会改变现有 subagent 与 sandbox 的 same-world 契约。

## 后果

Team 部署中的 stale filesystem-tool 写入可以指明最近修改目标的 teammate，并给出 Team 专用恢复提示，同时相同 OCC 规则继续拒绝 stale version 与未先读的编辑。归因只覆盖 filesystem-tool 的 `write`/`edit` observation，因此 Bash、formatter、generator 与外部写入仍由 Lead 通过最终 diff 与测试完成集成检查。

保持 prompt 引导协作，避免了会重复既有 Team policy 的运行时锁、process-global 并发设置与回收语义。若 worker 对改变后的内容 rebase，OCC 仍可让重复、冲突的编辑串行落地；Lead 的 diff 审查仍是最终防线。
