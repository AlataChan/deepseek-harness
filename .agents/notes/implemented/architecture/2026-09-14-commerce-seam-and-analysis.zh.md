# Agent Note: 电商数据采用 release 能力接缝、单一写入方绑定事件和由 sqlite3 强制执行的分析

Status: implemented

[English](2026-09-14-commerce-seam-and-analysis.md) | 中文

## 问题

商家需要一个能分析自家店铺导出数据的助手：从淘宝、拼多多等平台下载的订单、商品和库存表。回答必须基于这些文件，会话的数据源必须能在重放后恢复，做其他工作的 Agent 不应看到电商工具，模型编写的 SQL 也不能读取或写入导入数据之外的任何内容。Ask Data 已能把电子表格解码为 SQLite，但它的会话绑定属于它自己的控制器，查询路径属于 data-agent 包。

## 决策

`@deepseek-ai/dsh-host-commerce` 是位于 `ctx.commerce` 的 release 组 Service Definition。它声明带品牌的数据源、商品与变更 ID，封闭的 `CommerceError` 代码，导入方法，`platforms()`，读取方法（`searchListings`、`getListing`、`salesSummary`、`inventoryHealth`、`analysisSchema`、`runAnalysisQuery`），以及 `renderExport`。它的具体方法 `bind(agent, sourceId)` 是 `commerce/bound` 会话事件的唯一写入方：先通过 Provider 验证数据源，在提交点再次检查 `commerceBinding` projection，然后追加一个事件。该事件属于生成的持久化词汇表，因此重放可以重建绑定。

在出现第二个 Provider 之前，`@deepseek-ai/dsh-experimental-commerce-mode` 同时承载 Provider 和它的 Consumer。Provider 把每个数据源保存为 `sourcesRoot` 下的一个 SQLite 数据库，包含固定的 `orders`、`products` 和 `inventory` 表；通过 `Config.platforms` 把平台表头映射为规范列，并通过已构建的 `@deepseek-ai/dsh-experimental-desktop-ask-data/spreadsheet` 导出解码电子表格。每次导入都会写出仅所有者可访问的完整数据库文件，并在 manifest 提交成功前以硬链接备份保留旧数据库；被捕获的失败会恢复旧数据库，而数据库重命名与 manifest 重命名之间的进程崩溃可能使新数据库与旧 manifest 并存。随包样例以一次提交导入三张表。导入会持有 manifest 旁的跨进程锁，因此共享 `sourcesRoot` 的多个 Host 会串行提交。

分析安全由 sqlite3 进程强制执行。插件加载要求 sqlite3 3.41.2 或更高版本，并在临时目录中运行三个探测，它们必须在 `-safe` 下拒绝 `readfile()`、`writefile()` 和 `ATTACH`。每次查询先通过 realpath 与 lstat 检查确认数据库是 `sourcesRoot` 内的普通文件，再通过 `ctx.subprocess` 以 `sqlite3 -safe -readonly -nofollow -batch -bail -json <db> 'SELECT * FROM (<query>) LIMIT <maxRows+1>'` 执行；stdout 字节上限和超时会终止进程树。词法检查（一条 `SELECT` 或 `WITH`，无注释，无写入或 attach 关键字）只生成面向模型的诊断。可恢复的拒绝会返回带修正步骤的 held 工具结果，SQLite 执行拒绝还会附带已绑定数据源的 schema。

`./tools` Consumer 注册 `commerce_import_file`、`commerce_load_sample` 和五个读取工具。每个工具主体都会拒绝 parented 调用，从 projection 解析绑定，把 Provider 值作为外部数据围栏包装并限制在 `maxResultChars` 内，并且只为搜索、完整商品和库存读取在 `tool/result.meta` 中记录返回的商品 ID。`commerceSession` projection 从日志折叠出绑定与商品读取来源。分析结果行从不计为读取来源，因为它们的列由查询编写者决定。

工具可见性取决于部署的组合。在带 agent preset 名册的部署中（例如 Web 和桌面），`./preset` row 会在缺失时安装随包 `commerce` preset，并在 `agentPresets.standingKeyFor('commerce')` 对应的 scope 中挂载 `./tools`，因此只有使用该 preset 的 Agent 能看到这些工具。随包 preset composition 只命名 release 包，并从已安装的 preset 目录加载 `commerce-sales-analysis` skill。headless、SDK 和 ACP bundle 不组合名册，它们创建的 Agent 读取全局层，所以这些部署以根 row 挂载 `./tools`。Cordis 的 `inject` 没有可选形式，因此三个 row 各自声明静态的必需服务集合。

## 备选方案

**像 Ask Data 那样使用抽象 bind，由会话控制器追加事件。** 未采用，因为包括工具和控制器 remote 在内的每个 Consumer 都会拥有一条追加路径，并重复提交点复查。

**实验性的 Service Definition 包。** 未采用，因为 release 应用必须能在不依赖实验包的情况下命名该接缝；只有 Provider 是实验性的。

**共享的电子表格导入包。** 未采用，因为 Ask Data 是唯一的其他使用方；已构建的 `./spreadsheet` 导出无需新包即可消除重复。

**导入 Ask Data 的 `src/` 路径。** 未采用，因为配置子进程运行已构建的 `lib/` 代码，源码子路径不是受支持的包接口。

**依赖词法 SQL 校验。** 未采用，因为 SQL 函数、pragma 和 attach 形式多于任何阻止列表；sqlite3 的 safe、read-only 和 no-follow 模式不论查询文本如何都会强制执行限制。

**在随包 preset composition 中命名实验工具包。** 未采用，因为 preset composition 相对 harness base 解析，而实验包不在其中。

**让 Provider 通过 scope 选项挂载工具。** 未采用，因为 Provider 在无名册部署中也必须注入 `agentPresets`，而那里不存在该服务。

**在 Python SDK 场景中挂载实验 Provider。** 未采用，因为这些场景运行只组合 release 包的 `sdk-minimal` 运行时。

## 影响

电商绑定与商品读取来源可以从会话日志重建，第二个 Provider 无需修改 Consumer 就能实现该接缝。SQL 安全依赖主机 sqlite3 的行为，加载探测会在每次启动时检查；sqlite3 版本过旧或构建有误的主机无法加载该插件。词法诊断可能拒绝字面量中包含禁用词的无害查询。导入崩溃可能遗留存储锁，此后的导入会超时，直到运维人员将其删除。

部署通过 row 选择工具可见性：带名册的部署添加 `./preset`，自动化 profile 添加 `./tools`；同时添加两者的 composition 会在加载时失败，因为两个 row 会声明同一个工具挂载服务。录制会话快照 `commerce-sales-analysis` 与 `commerce-load-sample` 固定根挂载、skill 文本以及 TypeScript SDK 输出中的 `commerce/bound`；Loader 组合测试固定 preset scope 内的可见性与销毁。
