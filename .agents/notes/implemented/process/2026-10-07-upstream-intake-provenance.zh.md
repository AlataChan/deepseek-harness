# Agent Note: 上游 intake 溯源记录存在于机器可校验的 registry 中

Status: implemented

[English](2026-10-07-upstream-intake-provenance.md) | 中文

## Problem

本 fork 相对上游的增量是未记录的补丁欠账。fork 对上游 authored 文件的编辑存在，却没有记录改了什么、为什么改，于是每次上游合并都要把这些编辑当作冲突重新发现一遍，并可能静默丢失 fork 行为。被拒绝的面也有同样的缺口：没有任何记录说明 `apps/desktop` 是 fork 自研、而非从上游的 Electron 应用演化而来，也没有记录说明上游的 shell、账号、遥测与发布面不得进入本 fork。

[选择性升级方案](../../../../docs/plans/2026-10-06-upstream-selective-upgrade.md) 把这一点列为 Phase 0 要求：每个 fork 增量必须以 overlay 包、已登记补丁、或已记录的组合决定三种形态之一存在，且记录必须可校验。根 `AGENTS.md` 陈述了 `apps/desktop` 的事实；本 note 补上推理，使该问题不再被重新提出。

## Decision

**溯源记录是 [`scripts/upstream-intake-registry.ts`](../../../../scripts/upstream-intake-registry.ts) 中的机器可校验数据，而不是 markdown 台账。** [`scripts/verify-upstream-intake.ts`](../../../../scripts/verify-upstream-intake.ts) 把该 registry 当作唯一权威读取，并在任何 registry 未承认的增量上失败。方案的 Phase 0 原本命名的是 `docs/plans/` 下的一份 markdown 台账；该偏差按第 3 轮评审建议被接受，且不存在生成的台账视图——registry 的字段文档与方案承载说明文字。

### registry 记录了什么

- `UPSTREAM_PIN`（`dsh-v0.1.5-alpha.1`）：gate 用它对工作树做 diff、计算出 fork 编辑的上游文件所依据的上游 tag，因此合并期规则始终运行，而不依赖手工维护的清单。
- `PATCHES`：fork 编辑的每一个上游文件——2026-10-07 修复检查点时为 59 条，其中 40 条 `A` 行作为 fork 编辑保留、19 条 `B` 行等待 Phase 3 下移为 overlay——每条带理由。没有理由的补丁正是这张表要抓的缺陷。
- `NEVER_MERGE`、`UPSTREAM_ONLY_DIRECTORIES`、`REMOVALS`：fork 在结构上拒绝的上游面，各带类别与处置。E 类行（`packages/e2b`、`packages/code-runtime`、`packages/runtime-diagnostics`）带 `follow-upstream-deletion`，owner 于 2026-10-07 确认。
- `MOUNTS`、`GATED_PACKAGE_NAMES`、`FORBIDDEN_ENDPOINTS`，以及 `FORBIDDEN_DEPENDENCIES` 与 `GUARDED_MANIFESTS`：组合决定及其执行——哪些遥测与账号行存在、必须改什么、被挂载的行永远不得解析到哪些上游采集端点。
- `IGNORABLE_INSPECTION`：对 152 份真实用户日志的检查，确认 fork 的九个会话事件写入时不带 `ignorable: true`，因此每条迁移边都必须把它们当作必需事件承认，否则拒绝整个日志。
- `FORK_OWNED_PATHS`：`apps/desktop/` 与 `packages/experimental/`，在补丁检查之前被扣除。`apps/desktop` 正是 Phase 0 动作 3 点名的溯源发现：fork 在该路径上自研了 Tauri 外壳，上游的 Electron `apps/desktop` 在 2026-09-03 合并基线之后才出现，因此该路径与 fork 代码冲突，而非由上游演化而来。这棵冲突树由精确的 `NEVER_MERGE` 文件加 `FORBIDDEN_DEPENDENCIES` 规则——`apps/desktop/package.json` 中的 `electron`、`electron-builder`、`electron-updater`——守卫，因为枚举上游的 Electron 树会在上游的下一次提交时腐烂，而依赖规则不会。

## Alternatives considered

- **方案里的 markdown 台账**（`docs/plans/2026-10-06-upstream-intake-registry.md`）。不采纳：散文无法被执行，台账与代码树之间的漂移要等到某次合并失败或静默丢失 fork 行为时才会被注意。registry 以 gate 可运行的类型化数据承载同样的内容。
- **依赖 git 历史与合并冲突。** 不采纳：冲突重新浮出一次编辑，却不带它的理由；一次干净的合并也不是 fork 行为幸存的证据。冲突是每次合并的重新发现，不是溯源记录。
- **在 registry 中枚举上游的 `apps/desktop` 树。** 不采纳：枚举会在上游的下一次提交时腐烂。精确的 `NEVER_MERGE` 文件加依赖规则守住同一条不变量，却不必追踪上游的变动。
- **只承认 overlay，拒绝一切就地 fork 编辑。** 不采纳：Phase 3 会把 `B` 行逐步下移为 overlay；给未清欠账记录类别与处置，使其保持可见，而不是在改动落地前让整棵树失败。

## Consequences

- 选择性升级是可执行的，而非愿景。gate 在未登记的上游编辑、合并期模式下未定义的 removal 处置、或解析到禁止端点的遥测行上失败；每条拒绝路径都有失败用例 spec 证明。
- registry 随每一跳增长。第 3 跳的第一个动作就是把合并浮出的新 fork 编辑登记进来，因此溯源在合并时维护，而不是事后审计。
- 记录即代码：它通过类型检查、随交付它的 diff 一起评审，改一个字段名会让 gate 而不是某篇文档失败。代价是读者看到的是 TypeScript 而不是一页台账，且散文中引用的条数必须随 registry 同步。
- 遥测行交叉链接到 [fork 遥测默认值](../feature/2026-10-06-fork-telemetry-disabled-default.zh.md)；[交接文档](../../../../docs/plans/2026-10-06-upstream-upgrade-handover.md) 跟踪剩余跳的工作。
