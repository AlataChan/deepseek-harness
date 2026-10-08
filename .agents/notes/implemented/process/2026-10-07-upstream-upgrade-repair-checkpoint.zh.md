# Agent Note: 上游升级维修检查点：让 intake gate 真正执行规则，并证明迁移链

Status: implemented

[English](2026-10-07-upstream-upgrade-repair-checkpoint.md) | 中文

## 问题

分阶段上游升级的 hop 1、hop 2 合入之后，交接文档（[`docs/plans/2026-10-06-upstream-upgrade-handover.md`](../../../../docs/plans/2026-10-06-upstream-upgrade-handover.md)）记录了检查点证据不足以支持当时的声明：intake gate 通过的方式是错的——merge-time 规则从未运行，`FORBIDDEN_ENDPOINTS` 没有被任何规则引用；15 个失败的测试套件靠与 master 的按文件对比放行，而不是计划自己的验收标准；Phase 2 的迁移证据不存在；迁移前备份守卫是一个未决的 owner 决策。Owner 要求在 hop 3 合并之前先完成维修检查点（交接文档 §0.5）。

检查点必须同时关闭交接文档暴露的两类失败模式——规则存在但从不执行，以及可被组合配置绕过的遥测检查——并在任何后续上游 hop 之前，在真实会话数据上产出迁移证据。

## 决策

维修落在分支 `upstream-upgrade/repair-2026-10-07` 上，并先重定了基线到 `master`（owner 确认的偏差，记录于交接文档 §0.0）：`master` 已越过交接文档的合并基点，`bc7dd22f35` 在 DMG 中发布了五个 `media/*` 会话事件，因此 fork 事件基线是九个而不是四个。rebaseline 合并 `e0064c17df` 加上 `bd112611c5` 与 `790a447cd6` 为 host 与 client 聚合补齐了 desktop-media 测试的类型，并把 `conversation-media-creation` 快照在 Session v3 上重录。

冻结 v0 清表现在覆盖全部九个 fork 事件，`team/member` 载荷按 schema 版本校验：v1 拒绝 `model` 字段，v2 禁止排队成员上的 `delivery`（`ce5f4f430b`、`774a4b3f6a`）。该缺口由真实数据运行拒绝 152 个日志中的 11 个而发现——这是[历史未知事件拒绝决策](../architecture/2026-08-31-alpha-historical-unknown-event-refusal.zh.md)的停止条件按设计工作，不是被压制的失败。

intake gate（[`scripts/verify-upstream-intake.ts`](../../../../scripts/verify-upstream-intake.ts)，规则在 [`scripts/upstream-intake-registry.ts`](../../../../scripts/upstream-intake-registry.ts)）改为执行自己的规则而不是信任手工计算的 diff：它自己对照 `upstreamPin`（`dsh-v0.1.5-alpha.1`）计算 `changedUpstreamFiles`，规则 6 从组合后的 `cordis` 配置解析每个挂载遥测行的端点与模式，命中 `FORBIDDEN_ENDPOINTS` 或遇到无法解析的 `!!js` 组合时 fail closed（`fd45067654`）。失败用例 spec 覆盖未登记的补丁文件、携带上游端点的遥测行、`undefined` 的 E-class 处置；`26b935ca7b` 关闭了评审发现的同一 gate 的两个逃逸口。三个 E-class 处置记录为 follow-upstream-deletion。`ignorable` 检查是类型化的 registry 数据：9 个事件、152 个真实日志、required-not-ignorable。17 个 fork 编辑登记在 `PATCHES`，其中 4 个只有通过组合面扩展才浮出——包括备份守卫提交本身。

rebaseline 带入的媒体面在 cordis catalog 中完成分类，0 违规；master 在那里仍报 2 个，是 master 一侧 `collectEvents` 的盲点（`a5f8db13f2`）。slot catalog 为合并进来的 client slots 重新生成（`1124954ae1`）。

迁移前备份守卫位于 `packages/session/session-persistence-jsonl` 的 `prepareStoredMigration` 头部，覆盖两条 open 路径，因此 companion、`dsh` CLI 与 Python SDK 同时被覆盖（`60684b5c60`）。守卫执行 fsync、校验写入大小、幂等，备份失败时以 `JsonlMigrationBackupError` 大声停止启动；[`migration-backup.spec.ts`](../../../../packages/session/session-persistence-jsonl/tests/migration-backup.spec.ts) 固定了该停止。

v3→v4 步骤已证明但未提交：在 `dsh-v0.1.7-alpha.1` 的 scratch 分支上，九个 fork 事件类型全部缺失于 `RELEASED_V3_EVENT_TYPES`，包括 v2 载荷在内的 `team/*` 已由上游撰写，共享常量上的一个 125 行补丁同时覆盖迁移阶段与历史 V3 读取。补丁逐字记录在升级计划 findings 中，作为 hop 3 的首项工作重放；没有任何提交携带它。

交接文档 §0.0 与计划状态记录了已执行的检查点；检查点通过后 owner 追溯授权了 hop 1 与 hop 2（`4e6c6717b9`）。

## 验证

真实数据迁移证据：team-v2 修复之后，152 个会话中的 152 个完成迁移、列出、打开、发布 v3 并重开；152 个备份与参照副本 `cmp` 逐字节一致；原始文件全程保持逐字节不变，由 shasum 清单钉死。一个脱敏的真实 `ask-data` 日志作为整日志回放 fixture 提交为 [`released-v0-fork-ask-data.jsonl`](../../../../packages/session/session-persistence-jsonl/tests/fixtures/released-v0-fork-ask-data.jsonl)；上游撰写的 v0 覆盖由迁移链自身的 v0 语料加 `released-v0-real-shapes.jsonl` 承担。重定基线树上的全量套件显示 0 个合并引入的回归：16 个失败文件在两棵树上分别单独运行后归约为 14 个 pre-existing-on-master 与 2 个 load-sensitive。scratch 的 v3→v4 树在 session-persistence-jsonl 套件中 384/384 通过。逐步日志、失败表格与逐字 S8 补丁记录在工作 checkout 的 `.plans/upstream-upgrade-repair/findings.md`。

## 备选方案

**直接进入 hop 3，边合并边修。** 交接文档的裁定是该执行已经无视过计划自身的验收标准一次；在未强制的 gate 与缺失的迁移证据之上再叠第三个上游合并，是在更多代码处于风险的情况下重复同一失败。

**补丁两次四事件基线，而不是重定基线。** Owner 确认 rebaseline，让九事件基线在新分支上一次定义，代价是现在重新为媒体测试补类型并重录一个快照。

**保留 gate 的文件列表为手工输入。** 手工计算的 diff 正是 gate 以错误方式通过的原因；在 gate 内部对照 `upstreamPin` 计算 `changedUpstreamFiles`，把未登记补丁的情形变成失败的 spec，而不是诚实人假设。

**对照各插件的静态配置检查遥测端点。** 媒体 overlay 中的 `!!js` 组合在加载时决定端点；只有解析组合后的 `cordis` 配置——并在无法解析时 fail closed——才能关闭评审发现的逃逸口。

**在每个入口（companion、CLI、SDK）守卫备份。** 三个入口守卫会漂移；`prepareStoredMigration` 头部的一个守卫覆盖两条 open 路径与任何未来调用方。

**在本分支提交 v3→v4 补丁。** 补丁属于 hop 3 对 `dsh-v0.1.7-alpha.1` 的合并；在那次合并之前提交会把面向上游的改动落在升级尚未到达的树上。逐字记录保存了已证明的工作，且不重排 hop。

## 后果

检查点的五项 §0.5 条目通过，两类 gate 失败模式——休眠的规则与可绕过的遥测检查——以失败用例 spec 而非断言关闭。迁移链在真实数据上端到端证明，附带完整性校验的备份副本，Phase 2 的 hop 无关项（fixture、备份测试、真实 profile 运行）完成。Hop 3 解锁，其最高风险项已预解决并记录以待重放。

代价：分支携带 rebaseline 合并而非交接文档假设的基点，因此相对旧基点的 diff 包含 master 一侧的媒体工作；v3→v4 补丁在 hop 3 应用之前只以记录文本存在；master 的两个 cordis-catalog 违规仍归 master 修复，本文档将其记录为 `collectEvents` 盲点而不并入本树的账目。写作本文档时，owner 对迁移的 sign-off 与 hop 3 的放行仍待决。
