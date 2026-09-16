---
description: "实验性文件型电商 Provider：表格导入、有界只读 SQLite 分析、CSV 渲染与非破坏性 preset 安装。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-commerce-mode

[English](README.md) | 中文

## 概述

`dsh-experimental-commerce-mode` 在固定的 `orders`、`products` 与 `inventory` SQLite 表之上实现 [`ctx.commerce`](../../host/commerce/README.zh.md) Provider。它通过 Ask Data 支持的解码入口导入 CSV 或电子表格字节，将数据源保存到配置的绝对 `sourcesRoot` 下，提供固定电商读取，执行有界只读分析查询，在会话 ledger 中暂存有据可查、经 guardrail 检查的变更，把经批准的变更导出为 workspace 中的 CSV 文件，渲染可安全供电子表格打开的 CSV，并发布两种工具挂载：`./preset` 在不替换用户副本的前提下安装随包 `commerce` agent preset，并且只在该 preset 的 standing scope 中挂载原生工具；`./tools` 则为没有 preset 名册的部署在 Host 根部挂载这些工具。它的 `./client` 表面渲染「电商助手」数据源页面，以及暂存、丢弃与导出调用的卡片。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

仅在显式实验 profile 中挂载此包。`sourcesRoot` 必须是绝对路径。`platforms` 针对每种数据类别，把规范字段映射到输入电子表格表头；映射是部署配置，不是 Provider 内置默认值，并且必须包含 `sample`，即随包虚构样例使用的映射。商品映射可额外包含可选的 `price`（数值）与 `description` 列，供商品读取与暂存价格变更使用。`analysis` 设置行数、输出字节、墙钟时间与终止宽限限制。`lockWaitMs` 限制导入等待数据源存储锁的时间；该锁在共享 `sourcesRoot` 的多个 Host 之间串行化导入。空 `sqlite3Path` 通过 subprocess 服务解析 `sqlite3`。加载时 Provider 会把 `sourcesRoot` 设为 `0700` 权限；manifest 以仅所有者可访问的方式写入，已提交的数据库为仅所有者只读。随包 patch 提供淘宝、拼多多、抖音小店、有赞和虚构样例映射。

```yaml
- id: commerce-mode
  name: '@deepseek-ai/dsh-experimental-commerce-mode'
  config:
    sourcesRoot: !!js dshHomePath('commerce-sources')
    platforms:
      example:
        products: { listing_id: product_id, title: product_name }
        orders: { order_id: order_id, listing_id: product_id, quantity: quantity, gross_sales: paid }
        inventory: { listing_id: product_id, available: available }
      sample:
        products: { listing_id: listing, title: title }
        orders: { order_id: order, listing_id: listing, quantity: quantity, gross_sales: sales }
        inventory: { listing_id: listing, available: available }
    analysis:
      maxRows: 500
      maxOutputBytes: 1048576
      timeoutMs: 10000
      graceMs: 1000
    lockWaitMs: 60000

- id: commerce-preset
  name: '@deepseek-ai/dsh-experimental-commerce-mode/preset'
  config:
    maxResultChars: 50000
    maxListingIds: 200
    maxMetaBytes: 16384
    maxImportBytes: 33554432
    maxStagedChanges: 50
    guardrails:
      maxItemsPerChange: 25
      maxPriceDeltaPct: 20
      maxPromotionDiscountPct: 50
      maxRestockQuantity: 500
      maxCampaignBudget: 10000
      maxListingFieldChars: 2000
      protectedFields: [listing_id, currency, tax_category, compliance_notes]
      priceBearingFields: [price]
      listingUpdateBlockedFields: [price, stock, available]
```

插件加载要求 SQLite 3.41.2 或更高版本，并分别验证 `-safe` 会拒绝 `readfile`、`writefile` 与 `ATTACH`。分析只接受一条词法上的 `SELECT` 或 `WITH` 语句，拒绝注释和写入类关键字，验证数据源数据库是规范数据源根目录下非符号链接的普通文件，并以 `-safe -readonly -nofollow -batch -bail -json` 执行 `SELECT * FROM (<query>) LIMIT <maxRows + 1>`。调用方中止信号、墙钟计时器和 stdout 字节计量器都会终止受管进程树。

`./preset` 与 `./tools` row 接受相同的必填设置 `maxResultChars`、`maxListingIds`、`maxMetaBytes`、`maxImportBytes`、`maxStagedChanges` 与 `guardrails`。带 preset 名册的部署（例如 Web 或桌面）添加 `./preset`；headless、SDK 或 ACP composition 没有名册，改为添加 `./tools`。同时添加两者的 composition 会在加载时失败，因为两个 row 会声明同一个工具挂载服务。两个 row 还都需要审批服务与沙箱策略服务。导入 schema 的平台枚举来自 `ctx.commerce.platforms()`，它返回已配置的 `platforms` key。`commerce_import_file` 在调用会话 workspace 内解析普通文件，并在读取最多 `maxImportBytes` 字节前拒绝父目录穿越、外部路径和符号链接。解码失败会作为输入拒绝返回 held 结果；存储与进程故障仍是错误，manifest 提交前被捕获的失败会恢复旧数据库。随包样例以一次提交导入三张表。

暂存工具记录有据可查的变更供商家审阅；不会写入任何店铺。每次调用依次通过直接调用与绑定门控、ledger 门控（`maxStagedChanges` 条目总数）和来源门控（商品 ID 必须由目录读取返回；内容编辑还需先对该商品调用 `commerce_get_listing`；带变体商品上的价格、促销与补货行会被指向其变体）。随后从 Provider 读取 `before` 值并应用 `guardrails`：每次变更的行数、相对有据可查正价的价格变动百分比、促销深度、补货数量、活动预算、受保护字段、商品更新不得携带的字段、商品文本长度，以及每个商品与字段只出现一行。变更 ID 按 ledger 顺序为 `chg-0001`、`chg-0002` 等。

`commerce_export_changes` 把暂存变更写入会话 workspace 中的 `commerce-exports/<已排序变更 ID 的 SHA-256 前 16 个十六进制字符>.csv`，并使用所选平台映射的列表头。它依次要求：已绑定会话中的直接调用；变更 ID 在 ledger 中且仍为暂存状态；`before` 值仍与绑定数据源一致；导出时生效的 guardrail；结果 metadata 不超过 `maxMetaBytes`；会话沙箱模式不是 `read-only` 且 workspace 包含目标路径；目标文件不存在。满足全部条件后才向 `ctx.approval` 请求审批，并在 `allowed-once` 后以仅在不存在时创建的方式、按会话沙箱策略写入文件。审批策略为 `never` 时的拒绝会返回提示，请商家把 Permissions 切换为 `workspace-write`。

`renderExport` 返回 CSV 文本且从不写文件。以 `=`、`+`、`-`、`@`、制表符或回车开头的文本单元格会增加前导单引号；有限数值单元格保持数值。Consumer 负责审批与文件创建。

加载时，`./preset` row 只在目标不存在时将 `preset/commerce/` 复制到 `.agent-presets/commerce`。它从不覆盖已编辑的 preset；复制失败会记录包含手工源路径与目标路径的日志，并且不挂载工具。随包 composition 只命名 release 包，并从已安装 preset 的 `skills/` 目录加载四个电商 skill。解析该 preset 后，该 row 在 `agentPresets.standingKeyFor('commerce')` 对应的 scope 中挂载 `./tools` Consumer；销毁该 row 会销毁该 scope 和全部工具注册。`NOTICE` 与 `preset/commerce/LICENSE-APACHE-2.0.txt` 为改编自 Claude Commerce Agents 的 skill 文本提供署名。

`./client` 表面为每个暂存工具、`commerce_discard_change` 与 `commerce_export_changes` 注册一张 `tool.call.toolview` 卡片，并在 `commerce-mode` 命名空间中提供中文与英文词典。Web 与桌面 Host 通过包的 `dsh.client` 清单行加载它。卡片只依据调用的日志参数、结果文本与结果 metadata 生成：暂存变更列出商品、字段、改前与改后行，并附促销日期或活动；导出卡片给出写入的 workspace 文件，并提供经 Host 打开该文件的「打开」操作。暂存、丢弃与导出结果还会显示来自 `commerceSession` projection 的 ledger 计数。metadata 校验失败时，卡片保留结果文本；其他电商工具仍使用通用工具行。

同一表面还在 `conversation.hero.commerce` 注册「电商助手」新会话 chip，并在 `conversation.commerce.gate` 注册数据源页面。页面先给出随包示例，再按订单、商品、库存分别上传并选择导出它的平台，列出已导入的数据源；选定数据源后「开始提问」可用，它调用 `commitCommerce` Remote，把数据源绑定到空白会话或新建的 `commerce` preset 会话并打开它。

<a id="understand-the-implementation"></a>
## 了解实现

| 路径 | 职责 |
|---|---|
| `src/provider/index.ts` | `Commerce` Provider、固定读取、导入和串行化的数据源变更 |
| `src/provider/analysis.ts` | 词法诊断、规范路径检查、受管 sqlite3 执行和启动探测 |
| `src/provider/manifest.ts` | 版本化 manifest 与确定性数据库文件名 |
| `src/provider/export.ts` | 纯 CSV 渲染与公式中和 |
| `src/install.ts` | 非破坏性的随包 preset 安装 |
| `src/preset/index.ts` | `./preset` row：preset 安装与 standing scope 工具挂载 |
| `src/tools/index.ts` | 原生导入与读取工具、挂载声明，以及暂存工具注册 |
| `src/tools/staging.ts` | 暂存与丢弃工具：门控、由 Provider 提供的 `before` 值与 ledger metadata |
| `src/tools/export.ts` | 经审批的 CSV 导出：审批前的 ledger、时效、guardrail、metadata、沙箱与目标检查 |
| `src/tools/guardrails.ts` | 改编自 Claude Commerce Agents 的 guardrail 检查 |
| `src/tools/outcome.ts` | held 与成功结果、有界渲染、metadata 上限与 Provider 故障映射 |
| `src/tools/projection.ts` | binding、商品读取来源与暂存变更 ledger 的重放 fold |
| `src/client/index.ts` | `./client` 表面：词典与按键分派的工具卡片注册 |
| `src/client/CommerceChangeRow.tsx` | 暂存、丢弃与导出卡片，含 ledger 计数行 |
| `src/client/models.ts` | 依据日志参数与结果 metadata 校验得到的卡片模型 |
| `preset/commerce/` | 随包 agent preset 及其四个电商 skill |
| `cordis.patch.yml` | 实验 Provider 与 `./preset` row，以及平台映射 |

本包不发布运行时 invariant companion，因为 Provider 不存在可与其拥有关系产生偏差的 manifest、数据库文件或服务状态独立观察。每次访问都会执行持久数据解析和文件系统验证。

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到的内容

使用 `./preset` row 时，使用 `commerce` preset 的 Agent 会看到十四个生成的 [`commerce_*` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-commerce-mode)，使用其他 preset 的 Agent 看不到这些工具；使用根 `./tools` row 时，所有 Agent 都能看到。`commerce_import_file` 接受 CSV 或 XLSX `path`、`kind`（`orders`、`products` 或 `inventory`）以及包含已配置平台 ID 的 `platform` 枚举；`commerce_load_sample` 不接受字段。`commerce_search_listings` 接受可选 `query` 与必填 `limit`；`commerce_get_listing` 接受 `listing_id`；`commerce_sales_summary` 接受可选 `from` 与 `to`；`commerce_inventory_health` 不接受字段；`commerce_analysis_query` 接受 `query`。暂存工具都接受 `summary`，另外：`commerce_stage_listing_update` 接受 `listing_id` 与由 `field` 和文本 `value` 组成的 `fields`；`commerce_stage_price_change` 接受由 `listing_id` 与 `price` 组成的 `items`；`commerce_stage_promotion` 接受 `listing_ids`、`discount_pct`、`starts_on` 与 `ends_on`；`commerce_stage_restock` 接受由 `listing_id` 与整数 `quantity` 组成的 `items`；`commerce_stage_campaign` 接受 `name`、`budget`、`starts_on`、`ends_on` 与 `listing_ids`。`commerce_discard_change` 接受 `change_id`。`commerce_export_changes` 接受 `change_ids` 与由已配置平台 ID 组成的 `platform` 枚举。

#### Token 影响

十四个 schema 为能看到它们的 Agent 增加固定开销：使用 `commerce` preset 的 Agent，或根 `./tools` row 下的所有 Agent。

#### KV Cache 影响

只要工具配置和 preset 成员关系不变，schema 前缀就保持稳定。

### Skill 目录

#### 模型看到的内容

使用 `commerce` preset 的 Agent 会在 skill 目录中看到四个 skill 及其 frontmatter 描述。加载 `commerce-sales-analysis` 后返回一套方法：说明基线与对比周期、先确认变化再解释、把变化归因到商品或商品线、区分结构与水平、核对库存、分级表述置信度并组织回答，且映射到 `commerce_*` 读取工具。`commerce-listing-copy` 覆盖基于记录的标题与描述修改、文案审查和批量修正，并通过 `commerce_stage_listing_update` 暂存；`commerce-inventory-pricing` 覆盖库存排查、按销售速度确定补货量、滞销品处理、调价与限期促销，并通过补货、调价与促销工具暂存；`commerce-marketing-campaigns` 覆盖营销活动草案、推广商品、日期与预算，并通过 `commerce_stage_campaign` 暂存。每个暂存类 skill 都要求模型把商品文本当作数据、按 hold 结果的恢复步骤操作，并且只在商家要求时导出。根 `./tools` row 不挂载 skill。

#### Token 影响

目录条目增加每个 skill 的名称与描述；只有模型加载某个 skill 时，其正文才进入上下文。

#### KV Cache 影响

只要已安装 preset 的 `skills/` 目录不变，目录字节就保持稳定；编辑已安装的 skill 会从下一次请求起改变这些字节。

### 工具调用历史与结果

#### 模型看到的内容

Parented 调用返回“Commerce tools run as direct calls. Call this tool directly instead of from run_code.”。缺少 Agent 的调用返回普通 held 结果，要求模型启动或恢复 commerce session。绑定前的读取返回普通 held 结果，要求模型先调用 `commerce_import_file` 或 `commerce_load_sample`。已绑定会话加载示例会保持 held 并要求新建 commerce session，因为替换商家的表会导致数据丢失。可恢复的导入、数据源、查询策略、超时和输出上限拒绝会以包含修正步骤的 held 结果返回；复制到导入或分析 held 结果的 Provider 详情会经过结构转义和围栏包装。SQLite 执行拒绝还会包含绑定数据源当前的分析 schema。无效或缺失的已存储数据源不会披露内部路径或 manifest 详情，而是要求在新会话重新导入；基础设施故障仍是错误。每个 held 结果（包括围栏中的 Provider 详情）都受 `maxResultChars` 限制。成功的 Provider 值会渲染为 JSON，经过结构转义，包装在 `<external-data>` 中，并按 `maxResultChars` 限制完整渲染。搜索、完整商品和库存读取在 `tool/result.meta` 中最多持久化 `maxListingIds` 个 Provider 返回的商品 ID 和 `fullListing` 标志；分析查询绝不贡献商品来源记录。序列化 metadata 超过 `maxMetaBytes` 时会 hold 整次调用，而不是截断来源信息。`commerceSession` projection 从 session log 重建 binding、全部已读取商品 ID 与完整读取商品 ID。暂存与丢弃的 held 结果以“Held by the <gate> gate: <reason>. <recovery>”命名其门控，门控包括 ledger、provenance、record-read、options、inventory 与 guardrail；这些消息中引用的商品 ID 与字段名会经过结构转义并截短。暂存成功返回“Staged chg-NNNN for review only. Nothing changes in the store; an approved export writes staged changes to a CSV file.”，随后是围栏中的变更，并在 `tool/result.meta` 中以 `staged` 记录该变更；丢弃返回“Discarded chg-NNNN. It stays in the session ledger and will not be exported.”，并记录 `discardedChangeId`。`commerceSession` projection 会按暂存顺序把这些记录折叠进 `ledger`，状态为 staged、discarded 或 exported。经批准的导出返回“Exported N staged change(s) to <path>. Nothing was sent to a store; the merchant uploads the file.”，随后是围栏中的导出行，并记录 `exportedChangeIds` 与 `exportPath`；导出的 held 结果会命名 ledger、staleness、guardrail 或 sandbox 门控，审批被拒绝、取消或无人可用时返回固定文本，说明未写入任何内容。

#### Token 影响

每次直接调用都会追加参数和一个受 `maxResultChars` 限制的结果；held 结果使用简短、稳定的恢复文本。

#### KV Cache 影响

工具调用历史以 append-only 方式跟随可复用请求前缀。本包不添加 system-prompt section。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 主机必须具备 SQLite 3.41.2 或更高版本，并正常支持 `-safe`、`-readonly` 与 `-nofollow`；版本或拒绝探测不满足要求时，插件在加载阶段失败。
- 导入每次替换一张固定表，不提供 join、任意目标 schema、远程平台 API 或线上店铺写入。
- 在替换数据源数据库与提交 manifest 之间发生进程崩溃时，新数据库可能与旧 manifest 并存；被捕获的失败会恢复旧数据库，提交后的清理失败只记录日志。
- 导入进程崩溃可能在 `sourcesRoot` 中留下 `manifest.json.lock`；在运维人员删除该文件之前，后续导入会在 `lockWaitMs` 后超时。
- SQL 词法诊断有意保守，可能拒绝字面量中的无害注释或禁用词；SQLite flags 与规范路径检查仍是执行强制措施。
- Commerce 工具有意拒绝 PTC sub-dispatch 与其他 parented 调用；child Agent 与进程外 Agent 不会获得这些工具，除非它们加入 `commerce` preset，或运行在带根 `./tools` row 的 composition 中。
- 读取工具会保持 held，直到会话通过 `commerce_import_file` 或 `commerce_load_sample` 完成绑定。
- 暂存与导出都不会写入线上店铺；商家需自行上传导出的 CSV 文件。随包的 `price` 与 `description` 表头映射属于部署配置，尚未对照每个平台当前的导出文件核实。
- 已丢弃与已导出的变更仍保留在 ledger 中并计入 `maxStagedChanges`；达到上限的会话需在新的 commerce 会话中继续。
- 导出文件名由变更 ID 决定，因此旧文件存在时再次导出相同 ID 会被 hold。
- 卡片的 ledger 行显示会话 ledger 的当前状态，因此较早的卡片显示的是当前计数，而不是该次调用刚结束时的计数。
- 这个私有实验包不在已发布应用的依赖闭包中。octopus_DSH 桌面构建改为把它作为 profile-plugin bundle 种子安装，钉在 [scripts/desktop-profile-plugins.json](../../../scripts/desktop-profile-plugins.json) 中；进入应用依赖的只有 `dsh-host-commerce`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
