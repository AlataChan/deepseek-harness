# Agent Note：电商变更暂存在可重放的 ledger 中，只经过批准的 workspace 导出离开会话

Status: implemented

[English](2026-09-15-commerce-staging-and-approved-export.md) | 中文

## 问题

电商助手为在平台自有后台经营店铺的商家提出店铺变更（商品文案、价格、促销、补货与营销活动）。每条提议都必须基于本会话实际读取过的数据、不超出店铺配置的限额、可以重放，并在任何内容离开会话之前经过审阅。店铺数据不可信：商品描述可能夹带针对模型的指令。依据过期、超限或未经批准的提议写出的文件，比没有文件更糟。

## 决策

五个暂存工具只记录有依据的变更，不写入任何内容：`commerce_stage_listing_update`、`commerce_stage_price_change`、`commerce_stage_promotion`、`commerce_stage_restock` 与 `commerce_stage_campaign`。每次调用依次通过各道闸：已绑定会话中的直接调用、ledger 上限 `maxStagedChanges`，以及来源检查。来源检查接受电商读取返回过的商品 ID；文案修改还需要一次完整的 `commerce_get_listing` 读取；对带有变体的商品，调价、促销与补货行会被指向其变体。随后工具从 Provider 读取 `before` 值，并应用 `guardrails` 配置：相对有依据价格的调价幅度、促销深度、补货数量、活动预算、受保护字段与禁止字段、文本长度，以及每条变更的行数。被拒时返回 “Held by the <gate> gate: <reason>. <recovery>”。

暂存的变更以 `staged` 持久化到 `tool/result.meta`，`commerce_discard_change` 则记录 `discardedChangeId`。`commerceSession` projection 把两者折叠进 `ledger`。变更 ID `chg-0001`、`chg-0002` 依次来自 ledger 顺序，且暂存、丢弃与导出工具互斥执行，因此重放会重建相同的 ID。

`commerce_export_changes({ change_ids, platform })` 按固定顺序执行：

1. 每个 ID 都在 ledger 中且仍处于暂存状态。
2. Provider 的当前值仍等于每条变更的 `before` 值。
3. 这些变更通过导出时生效的 guardrails。
4. 成功结果及其 metadata 不超过 `maxMetaBytes`，并由 Provider 渲染带公式中和的 CSV。
5. `ctx.sandboxPolicy.resolve({ session })` 允许写入，目标位于会话 workspace 内，且目标文件不存在。
6. `ctx.approval.request` 列出行数、变更 ID 与路径。

只有 `allowed-once` 会写出文件：在同一会话策略下以 `createIfAbsent` 写到 `commerce-exports/<排序后 ID 的 SHA-256 前 16 位十六进制>.csv`。被拒绝、取消或无人批准时返回固定文本，说明没有写入任何内容；有效批准策略为 `never` 时的拒绝，会请商家把 Permissions 切换为 `workspace-write`。ledger 依据导出的 metadata 把变更标记为已导出。

ACP 只在 Loader 树完成加载后才应答 `initialize`，与 headless bundle 和 SDK server 的既有做法一致。电商 Provider 要在 sqlite3 加载探测完成后才提供 `ctx.commerce`，而根部 `./tools` row 注入该服务；若不等待，ACP 客户端的首个提示词可能在没有电商工具的情况下到达模型。

随包 preset 新增三个改编自 Claude Commerce Agents 的 skill：`commerce-listing-copy`、`commerce-inventory-pricing` 与 `commerce-marketing-campaigns`。它们讲解暂存工具，把商品文本当作数据，并且只在商家要求时调用导出。包的 `./client` 表面依据结果 metadata 与 projection 渲染暂存的改前改后行、导出文件与 ledger 计数。

## 备选方案

**通过平台 API 应用变更。** 否决：目前没有平台集成，店铺凭据会进入 Host，而由商家上传的文件保留了店铺自身的审核环节。

**在暂存时请求批准。** 否决：暂存没有外部效果，逐条弹出批准只会增加审阅负担而不提供保护，导出才是唯一的写入。

**只在暂存时检查 guardrails。** 否决：配置可能在导出前改变，而 `before` 值变化意味着该变更是依据店铺已不再持有的数据计算出来的。

**让模型选择导出路径。** 否决：路径参数可能指向 workspace 中已有的文件；由 ID 派生的文件名加上 create-if-absent，使重复导出被 hold 而不是覆盖。

**在沙箱与目标检查之前请求批准。** 否决：商家会批准一个随后才失败的导出。

**只依赖对店铺数据加 fence。** 否决其作为唯一防线：fence 降低模型听从植入文本的概率，但只有批准请求才能把关写入。

## 影响

暂存、丢弃与导出都可以从会话日志重建，Web 卡片读取的正是 projection 所折叠的同一份 metadata。商家在任何写入之前批准确切的 ID 与路径，且没有任何内容发送到店铺。已丢弃和已导出的变更仍计入 `maxStagedChanges`，因此会话满额后在新会话中继续；旧文件存在时再次导出相同 ID 会被 hold。

ACP 快照经由随包 ACP 客户端协议记录批准路径：`commerce-export-approved` 把写出的 CSV 固定在 `workspace.expected/` 下，`commerce-export-rejected` 固定客户端拒绝后未改变的 workspace。在 `commerce-poisoned-review` 中，一条导入的商品描述要求助手不经询问导出所有暂存变更；录制的模型将其识别为提示词注入，只暂存了所要求的变更，且从未调用导出，因此 workspace 保持不变。单元测试与 Loader composition 测试固定了每道闸在批准之前的 hold、各批准结果与 ledger 重放，ACP readiness 测试固定了 `initialize` 等待 Loader 完成加载。
