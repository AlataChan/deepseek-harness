# Agent Note: 桌面知识库面板可关闭，page-meta 拒件可修复

Status: implemented

[English](2026-09-16-desktop-knowledge-picker-dismiss-and-reject-heal.md) | 中文

## Problem

桌面知识库面板上有两个缺陷叠在一起，合起来让一个知识库看起来只能收一份文档。

面板关不掉。它没有任何关闭控件，而 hero chip 在面板已存在时直接返回，所以再点一次「知识库」什么也不会发生。唯二的出口——点库名和「先空着，直接提问」——都会挂库，于是只想退出的用户被困在面板里；入库失败后的上传面板更是死路，它既没有关闭控件，也没有回到名单的入口。

一个库看起来只装一份文档。两个机制共同造成。加号入口直接在上传面板打开选择器，且没有目标库，它唯一可能的结果就是新建一个库，于是一份文件就是一个库。另外，凡是 `create_page` 前言不过 page-meta schema 的提案都会写进 `.octopus-kb/rejections/` 且永不再试：文档留在 `raw/` 下，永远不变成可检索的 wiki 页。被 vendor 进来的 `heal_page_meta_rejections` 从未运行，因为 `inbox-list` 只列 `.octopus-kb/inbox/`，而且它没有任何生产调用方。在报告问题的机器上，3 个库、8 次上传只产出 1 个 wiki 页。

## Decision

选择器是 `Modal`；Escape 和 Modal 关闭控件会关掉两个阶段，hero chip 变成开关：再点一次「知识库」收起选择器。加号菜单那座桥保持幂等的「打开」，所以「添加文档」的请求不会把已打开的面板关掉。`LibraryPicker` 不再接 `initialPhase`，`LibraryPickerPhase` 也不再导出，因为没有入口会直接打开上传面板。

加号入口改为在选库名单上打开选择器。文档随后进入用户点「添加文档」选中的库，或经「新建知识库」进入新库（加号菜单本身由[选库入口](../feature/2026-08-31-composer-plus-attach.zh.md)负责）。

`healPageMetaRejections` 在 `attach` 内、`recoverPendingAudits` 之后运行。对每个记录中唯一失败为 `schema.page_meta_invalid` 的 `.octopus-kb/rejections/<id>.json`，它读取同名的 `.octopus-kb/proposals/<id>.json`，套用 `rewriteInvalidCreatePageMeta`，把文件写回，再重跑 sidecar `validate-apply`。sidecar 的 apply 会补 `role`、`layer` 和 wiki `summary`，并在补完之后再判前言，因此枚举外的 `type` 是 Host 唯一必须修好的字段。只有改写函数报告有变化时才会重跑，所以败在其他规则上的拒件会原样留下、永不重试。`validate-apply` 失败会被吞掉，因为 apply 自己会写拒件或 audit；调用方中止则向上抛，所以被中止的挂库不会挂住。

## Alternatives considered

**保留上传面板作为加号入口的第一屏。** 否决：那一屏只能新建库，正是报告里「一份文件一个库」的结果。先开名单才能让目标库成为显式选择。

**改成模态遮罩来关面板，而不是加关闭控件。** 否决：选择器渲染在 composer 栈里、与 hero 行并排，并不是盖在整个应用上；加一块外部点击区域等于新增一层叠放规则，换不来比「关闭控件加 chip 开关」更多的东西。

**给 sidecar 加一条 heal 命令。** 否决：octopus-kb 是 vendor 进来的，它带了 `heal_page_meta_rejections`，但 `sidecar.py` 没有任何 CLI 命令能到达它；加命令就要改 vendor 源码。Host 本来就掌管提案文件，也本来就在调 `validate-apply`。

**在 `finishIngest` 里修复。** 否决：那会给每次上传加上一次库扫描和若干 sidecar 调用。挂库才是用户即将读库的时刻，没有拒件目录时扫描零成本，而且修好的页面在该会话第一次检索时就已可见。

**把改写扩到 `title`、`lang`、`layer`、`summary`。** 否决：sidecar 的 apply 已经会补 `role`、`layer` 和 wiki `summary`，而观测到的每个拒件都是 `type`/`role` 非法或缺失。去修 apply 会覆盖的字段，只会加出没有实例的分支。

## Consequences

两个出口都能用：关闭控件和再次点击 chip 都能从任一状态收起面板，上传面板也不再是入库失败后的死路。加号入口的上传不再悄悄一份文件建一个库，因此多份文档可以积累在同一个库里。

本来只败在 page-meta 上的、已经在 `raw/` 下的文档，会在下一次挂库时变得可检索。每份只修一次——第二次挂库看到合法 page-meta 就跳过——而仍败在其他规则上的提案不会被重试。

挂库会为每个待处理的 page-meta 拒件付一次 `validate-apply`；库里没有拒件目录时不付任何代价。坏掉的提案不会挡住挂库，因为失败的 apply 会被吞掉。

`LibraryPickerInjected` 去掉 `initialPhase`，`/client` 入口去掉 `LibraryPickerPhase`；两者都是没有外部消费方的私有 overlay API。验证见 `packages/experimental/desktop-ask-knowledge/tests/ingest.spec.ts`（修复的各类情形：已应用、跳过、缺提案、拒件不可解析、apply 失败、调用方中止）、`library-picker.client.spec.tsx`（关闭控件与新建控件的上传面板）、`apply.client.spec.ts`（chip 开关与幂等的桥接打开）。
