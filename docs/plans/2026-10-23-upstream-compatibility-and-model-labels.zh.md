# 上游兼容性与模型标签实施计划

[English](2026-10-23-upstream-compatibility-and-model-labels.md) | 中文

> **实施者须知：** 经负责人批准后，使用 `superpowers:executing-plans`，按任务逐项实施本计划。

**目标：** 对齐 rc.2 尚未引入的 vendor 发布元数据，完善可区分提供方的模型标签，同时保留已验证的 Tauri 桌面端及用户现有选择。

**架构：** 从固定的上游版本适配三个有明确范围的改动，保留 fork 的模型选择器、源码补丁、配置组合及原生载体与缓存。运行时架构升级不属于本次实施范围。

**技术栈：** TypeScript、React、Cordis、pnpm、Vitest、Playwright、Rust/Tauri，以及现有内部 DMG 构建流程。

**状态：** C1–C3 及二次审查修复已实施至 `00729d3c76`。聚焦检查、构建、全部 114 项 bundle 检查及支持的原生流程通过，可在内部 macOS ARM64 范围集成。验收证据及其余平台和基线限制见 `.plans/upstream-compatibility-2026-10-23/remediation-review.md`。

## 概述

下一个内部桌面构建将使用稳定版 vendor 标识、显示规范的 Flash 名称，并支持接收准确提供方与模型身份的模型标签。现有模型路由、推理等级、持久助手、常设团队及上下文插件默认关闭行为必须保留。批准范围包括本地实施与内部验证，不包括付费 API 调用、对外发布、公开发行签名或替换已安装应用。

## 目录

- [范围](#scope)
- [基线与源码控制](#baseline)
- [实施任务](#tasks)
- [验收](#acceptance)
- [恢复与交付](#delivery)
- [单独的运行时评估](#later)
- [开发备注](#dev-note)

<a id="scope"></a>

## 范围

本计划扩展[10 月 18 日的选择性引入](2026-10-18-upstream-runtime-and-release-upgrade.zh.md)。Search/Fetch、斜杠菜单缓存失效、Codex 部分答案处理、推理等级设置及发布安全适配均已存在；应保留这些实现并验证受影响的使用方，无需再次引入。

| ID | 纳入的改动 | 必须遵守的限制 |
| --- | --- | --- |
| C1 | 稳定版 vendor 版本、loader peer 范围及 timer 的 locale 导出与发布文件 | 保留全部运行时源码和本地修改，明确审查依赖变化。 |
| C2 | 可区分提供方的模型标签 slot、提供方记忆化及有依据的菜单定位适配 | 保留 fork 的控件、推理等级 UI、键盘操作及自定义 slot，不引入账号服务依赖。 |
| C3 | 默认 Flash 显示名称 `DeepSeek-V4.1-Flash` | 保留模型 ID `deepseek-flash`、提供方 ID、请求路由及用户明确设置的标签。 |

排除：临时 1017 徽标包、subagent 或 PTC 架构改动、持久 Node REPL、Electron、账号通知与引导、遥测默认值或收集端、插件市场默认设置、CUA、Windows runner 监管、安装事务重写、npm 发布及公开发行。根目录 Harness 版本和 `UPSTREAM_PIN` 保持不变。本计划不修改 Session 格式、持久化选择格式或迁移逻辑。

<a id="baseline"></a>

## 基线与源码控制

源码上限固定为 `dsh-v0.2.1-rc.2`，完整集成基线仍为 `dsh-v0.2.1-alpha.1`。准确提交、选定源码哈希、观察到的未提交路径及此前内部 DMG 身份记录在[源码清单](../../.plans/upstream-compatibility-2026-10-23/source-inventory.json)中。重新获取源码时必须验证该上限，不得静默推进。Git 源码对象优先于跳转到无关讨论的 PR 链接。

编写计划时，与 rc.2 比较得到的 vendor 运行时源码差异为空；差异涉及发布元数据、timer 的 locale 及文档。我们的选择器已限制菜单位置，但尚无可区分提供方的标签 slot。这些观察结果需要在实施时复核，不能据此覆盖整个目录。

[已验证的上下文审查](../../.plans/desktop-dsh-context/code-review-default-disabled-remediation.md)记录了此前内部 ARM64 结果。其 114 项检查属于历史证据，不能视为拟议构建的结果。主工作目录包含无关修改；实施必须从经过审阅的桌面检查点创建新 worktree。不得暂存、重置、批量加入提交或合并无关工作。

<a id="tasks"></a>

## 实施任务

任务 1–3 均依赖任务 0，并分别提交。任务 4 依赖前三项改动均通过验收。每项实施任务都应先添加行为测试，记录预期失败或已存在行为的结果，再进行最小完整适配、运行检查，且仅提交已审阅的文件。

实现提交仅是检查点，不代表验收通过。在共享主机上，先完成定向检查，再针对 C1–C3 集成源码完成一次必需的根目录构建；全量测试失败使用受限 worker 数量和仓库的共享主机测试预算诊断。所有必需检查均须通过后才能关闭，打包验收不得沿用旧产物的通过数量。

### 任务 0：保留已验证版本并固定实施基线

**文件：** 更新 `.plans/upstream-compatibility-2026-10-23/source-inventory.json`；创建 `.plans/upstream-compatibility-2026-10-23/verification.md`；在隔离 worktree 中创建前置检查点之前，审查上下文报告所列的准确实施文件。

1. 按清单中分别记录的字节哈希验证此前 DMG 及相邻发布 manifest（元数据清单），并保留 manifest 的源码修改标记；在任何打包命令可能覆盖它们之前，保留副本至 `dist/review-baselines/2026-10-23-context-qualified/`。不得复制应用数据或凭据。

2. 从观察到的 HEAD 创建被忽略的隔离 worktree，仅导入已审阅的上下文改动，并在其中提交现有已验证实现及必要的传输与构建修复，形成前置检查点。保留主分支及无关未提交文件不变。记录排除的未提交路径，不记录其内容。接受该检查点前，复核自验证后发生变化的桌面源码。单独提交已批准的双语计划和源码清单，使实施 worktree 包含这些文件。若该检查点尚不能审阅，应停止实施并报告缺失的前置条件。

3. 在该干净的隔离 worktree 中，从紧随桌面检查点的计划提交开始 C1–C3，在清单中记录分支、基线、当前源码哈希、源码上限及产物身份。使用 `pnpm --silent run change-scope --base <recorded-base> --head HEAD`，相对记录的基线比较改动。

4. 运行 `pnpm run verify-upstream-intake` 及 `pnpm exec vitest run scripts/verify-upstream-intake.spec.ts`。记录准确的既有诊断；报告中的四个待处理条目既不代表缺少四个版本，也不代表 rc.2 已完整验收。应在此 worktree 建立文档与测试基线，不能继承无关未提交文件导致的失败。

**完成条件：** 保留产物验证通过、桌面前置工作已提交、worktree 隔离完成，每项基线失败均有明确处理结论。

### 任务 1：对齐 vendor 发布元数据，保留运行时源码

依赖验收同时对齐 `apps/cli/package.json`、`packages/boot/{app-boot,hmr}/package.json` 及各自 README 双语文件，使原生内置模块最低版本统一为 `^0.1.9`。扁平桌面依赖闭包不得保留优先解析到的旧版本原生内置模块包。所有权要求使用完整字面路径，避免目录标签被识别为未重定作用域的模块标识。

**文件：** 修改 `vendor/{cordis,cosmokit,group,hmr,include,loader,logger-console,schemastery,timer}/package.json`，添加 `vendor/timer/locale/{en,zh}.json`，更新 `pnpm-lock.yaml` 及事实发生变化的 vendor 所属文档；创建 `scripts/upstream-compatibility-release.spec.ts`；更新 `scripts/upstream-intake-registry.ts`、`scripts/verify-upstream-intake.ts` 和 `scripts/verify-upstream-intake.spec.ts`；创建 `scripts/upstream-compatibility-policy.ts`，独立声明已批准路径的所属义务。

1. 为下列准确版本集合、loader 的 peer 范围 `node-addon-require-builtin: ^0.1.9`，以及 timer 的 `./locale/*.json` 导出和 `locale` 发布文件项添加断言。使用可丢弃的 fixture 包确认过期元数据或缺少发布 locale 会触发对应断言失败，不得修改工作目录来制造失败。

```text
cordis 4.0.5             cosmokit 1.8.6       group 1.0.5
hmr 1.0.20               include 1.0.10       loader 1.0.6
logger-console 1.0.5     schemastery 3.18.5    timer 1.1.7
```

2. 重新对照源码上限检查运行时源码差异，然后仅适配元数据和 locale 文件。保留作用域包名、workspace 依赖约定、本地补丁及已发布的运行时导出。更新 vendor 版本表时，保留未发生变化的源码 SHA。若出现意外源码差异，应先修订范围，再决定是否应用。

3. 使用 pnpm 重新生成锁文件，审查每个变化的 importer 和 peer snapshot。验证已安装的原生 loader 版本满足新的 peer 范围。保留有依据的 peer 解析变化，拒绝无关依赖升级。

4. 独立于被检查的 BACKPORTS 记录声明已批准的 C1–C3 路径义务，并随各项实施提交启用。修改实际执行的验证器，强制检查必要条目、准确所属路径及原完整集成 pin，覆盖新增 timer locale 和 vendor manifest。添加 C1 所属记录，不削弱现有规则。在可丢弃 Git 仓库中运行未经改写的 CLI 入口，使用正向 fixture，并验证遗漏单一路径、遗漏整个必要条目，以及所属记录也使用推进后 pin 时的未经批准 pin 推进均被拒绝。仅测试 helper 不足以验收。准备依赖构建产物的 tarball 冒烟检查，在步骤 5 构建后验证 timer 的两个 locale 文件及包导出解析；源码层单元检查不得依赖构建文件。

5. 运行 `pnpm exec vitest run scripts/upstream-compatibility-release.spec.ts scripts/verify-upstream-intake.spec.ts`、`pnpm run rescope-vendor:check` 及 `pnpm run verify-upstream-intake`。按 vendor 同步规则运行一次根目录 `pnpm run test` 和 `pnpm run build`；此广泛检查用于验证影响全仓库的框架依赖解析。构建完成后，使用 `pnpm --dir vendor/timer pack --pack-destination <scratch>` 打包 timer，检查解包内容，并从可丢弃的使用方解析其 JSON 导出。不得发布。接受 C1 之前，记录并解决必须处理的失败。

**完成条件：** 准确元数据与 locale 打包验证通过、运行时源码保留、依赖解析正常，且 vendor 规则要求的检查通过。单独提交 C1。

### 任务 2：添加可区分提供方的模型标签，保留菜单行为

执行范围补充：本地渲染器尚不支持行内插槽锚点。C2 还负责 `packages/client/ui-slots/src/index.ts`、`packages/client/ui-renderer/src/client/scoped-slots.tsx`、新增的 `inline-slots.client.spec.tsx` 及相关 README 双语文件。仅移植行内声明与 span 锚点／错误占位，保留其他渲染行为。C2 验收前运行行内生命周期、错误状态和已有 scoped-slot 回归测试。

**文件：** 修改 `packages/client/ui-model-selection/src/client/{slots.ts,ModelSelect.tsx,index.ts}`、其 `README.{md,zh.md,i18n.yaml}` 及 `tests/{model-select.client.spec.tsx,browser-plugin.client.spec.ts}`；更新 `docs/subsystems/slots.{md,zh.md,i18n.yaml}`；重新生成 `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`；扩展 `apps/web/tests/default-model.e2e.ts` 及其所属的预期输出文件。

1. 添加标签贡献测试，覆盖触发器、菜单当前值及选项位置。使用两个具有相同模型 ID、不同标签的提供方；选择任意一方时，都必须发送其自身的提供方与模型组合及推理等级值。覆盖无贡献时及贡献被 dispose（资源释放）后的回退行为。基线上缺少 slot 时，新的贡献测试必须失败。

2. 将上游 slot 和记忆化改动一起适配。单一会话级行内 slot 名为 `conversation.input.model.label`；owner 包含提供方 `{ id, name }`、准确的模型目录条目、位置 `trigger | menu | option` 及 `selected: boolean`。默认渲染目录名称。贡献保持非交互式，不接收凭据或配置数据；模型选择控件仍由选择器负责。

3. 添加浏览器几何检查，覆盖窄窗口、矮窗口、较长本地化标签、大目录、推理等级菜单、缩放及实时调整尺寸。验证视口边界、内部滚动、搜索、Escape、方向键与 Enter 导航、焦点返回，以及异步目录过期响应。现有位置限制若通过检查，应予以保留；仅适配已验证确有必要的定位修复。不得注入掩盖生产菜单溢出的样式。

4. 通过有所属生命周期的 effect 注册贡献，保留 fork 定义的 slot，使用 `pnpm run gen-client-catalog` 重新生成目录，并运行 `pnpm run verify-client-catalog`。添加 C2 所属路径记录。配置组合和依赖中继续排除账号实现及临时徽标包。同时更新双语 README 和 slot 参考文档。

5. 运行 `pnpm exec vitest run packages/client/ui-model-selection/tests/model-select.client.spec.tsx packages/client/ui-model-selection/tests/browser-plugin.client.spec.ts`，重建 Client 产物后，再运行 `DSH_SNAPSHOT=replay pnpm run test:web:built apps/web/tests/default-model.e2e.ts apps/web/tests/model-menu-observer.e2e.ts`。使用已发布配置对应的 scaffold 和合成提供方；几何及 ARIA 预期输出保留在所属应用目录下。

**完成条件：** 提供方身份与回退测试通过，真实浏览器交互保持可用，生成目录保留现有自定义 slot。单独提交 C2。

### 任务 3：修正默认 Flash 显示名称

**文件：** 修改 `packages/llm/llm-deepseek/src/models.ts`、`tests/{adapter.spec.ts,runtime.spec.ts}`、受影响的所属 README 双语文件，以及受影响的 `apps/web/tests/expected/` 目录与模型预期输出；创建 `apps/web/tests/flash-default-catalog.e2e.ts`（在 `tsconfig.host.json` 中注册，并在 `apps/web/tsconfig.json` 的 Client 程序中排除） 及其所属预期输出；在引入记录中添加 C3。

1. 添加回归测试，期望默认名称为 `DeepSeek-V4.1-Flash`，同时保留 `id: deepseek-flash` 和选定提供方。确认当前值 `DeepSeek-V41-Flash` 会使其失败。添加自定义目录用例，确保明确设置的名称保持不变。

2. 仅修改默认目录显示值。不得追加日期、修改请求模型 ID、重新生成无关提供方目录、重写已保存选择或重命名用户明确设置的条目。逐项检查预期输出变化是否属于对应的默认目录场景。

3. 运行 `pnpm exec vitest run packages/llm/llm-deepseek/tests/adapter.spec.ts packages/llm/llm-deepseek/tests/runtime.spec.ts`，对已发布 DeepSeek 适配器与默认目录运行新增的无密钥构建浏览器测试 `flash-default-catalog.e2e.ts`，使用无效的合成凭据且不发送模型请求，审阅其默认名称预期输出，并单独运行 `DSH_SNAPSHOT=replay pnpm run test:snapshot -t model-switch-notice`。模型切换回放使用合成目录，仅验证路由回归，不能证明 Flash 默认名称。保留已提交的历史 Session 版本；纯 UI 预期输出仍归应用所有。不需要调用真实提供方。

**完成条件：** 仅已发布的默认显示名称发生变化，用户标签及提供方、模型和推理等级选择保持稳定。单独提交 C3。

### 任务 4：验证集成后的内部桌面端

**文件：** 维护 `.plans/upstream-compatibility-2026-10-23/verification.md` 和源码清单；如有需要，在 `apps/web/tests/` 下添加仅供测试的 fixture。仅针对已证实的缺口扩展所属验证器；不得削弱现有断言，也不得为了便于测试而修改生产传输。

1. 复核完整差异及 C1–C3 所属路径，运行 `pnpm run typecheck`、`pnpm run lint`、`pnpm run hygiene`、`pnpm run verify-upstream-intake`、`pnpm run verify-client-ui-i18n` 及相关文档检查。确认根版本、完整集成 pin、模型 ID、插件 pin 与默认值及遥测规则未改变。发生变化的必要检查失败，必须修复或明确排除出已批准交付范围，才能关闭。

2. 最终构建前提交已接受的源码改动，并记录测试提交。运行 `pnpm run build`；在 `apps/desktop` 中运行 `cargo tauri build`。等待应用打包成功结束后，再运行 `bash scripts/build-dmg.sh --arch arm64`。复用缓存时必须通过其现有新鲜度检查，不得强行复用过期依赖或 sidecar。

3. 要求当前全部 bundle 检查通过，包括 dsh-context 已安装流程验收。在隔离主目录、合成设置及网络限制下，使用真实 Tauri WKWebView 检查双语界面、菜单实时尺寸变化、路由及推理等级切换、冷启动，以及助手和团队的模型选择。文档缩放由已构建浏览器场景验证；原生外壳没有页面缩放命令。测试默认关闭的上下文发现及真实 Client 的实时出现与移除。

4. 在不进行付费调用的前提下，检查现有“问数据”“问知识”入口及 API Key 设置。验证可选 Search/Fetch 和斜杠菜单刷新仍可用。将新 bundle 中社区插件实际解析的 Cordis/Schemastery 与已接受基线比较，拒绝新增的不兼容或不必要框架副本。

5. 以只读方式挂载最终 DMG，比较已签名应用的内容摘要并验证严格签名，然后将未改动的应用复制至可丢弃的安装目录。使用规范物理路径启动其可执行文件，测试原生选择器与上下文切换，再运行 `node scripts/verify-dsh-context-installed-flows.mjs <copied-app>`。移除临时主目录前停止所属进程。不得覆盖 `/Applications` 或用户数据。

6. 记录准确命令、结果、失败、截图、测试源码身份、最终产物大小与哈希、缓存复用及平台限制。生成更新的内部 DMG 和相邻发布 manifest。Windows 验证必须先通过原生 Windows 菜单检查，macOS 结果不能替代。

<a id="acceptance"></a>

## 验收

每项均需记录正向结果，以及指定的回归或无效控制结果。已经通过检查的行为应保留，并标注为已存在。

| ID | 必须达到的结果 | 回归或无效控制 |
| --- | --- | --- |
| A1 | vendor 元数据准确，timer tarball 内容完整 | 过期版本、缺失 locale 或不兼容 peer 必须失败。 |
| A2 | 保留运行时源码和现有 fork 修改 | 意外运行时源码变化必须阻止本范围继续实施。 |
| A3 | 相同模型 ID 可按提供方区分标签 | 选择第二个提供方时，绝不路由至第一个。 |
| A4 | 无标签贡献或贡献释放后回退至目录名称 | 移除贡献后，不残留旧标签或注册。 |
| A5 | 菜单适应矮窄窗口及尺寸变化 | 超长标签或大目录能暴露裁剪或无法访问的控件。 |
| A6 | 默认名称修正，用户名称与选择保留 | 明确自定义标签和保存的提供方、模型、推理等级均可保留。 |
| A7 | 上下文实时 OFF/ON/OFF、冷启动状态及载荷刷新均通过 | 现有缺失清单、激活失败和清理控制继续有效。 |
| A8 | 助手、团队、数据和知识入口仍可用 | 共享模型 ID 或不可用提供方不得静默改变保存的选择。 |
| A9 | 复制出的 DMG 应用与已测字节一致，可原生运行 | 签名或内容摘要不匹配时，交付必须失败。 |
| A10 | 范围记录保持准确 | 未登记路径、pin 推进或被排除的账号与遥测引入必须失败。 |

<a id="delivery"></a>

## 恢复与交付

将 C1、C2 和 C3 保持为可分别撤销的提交，并保留此前已测试的 DMG。若新验证失败，则继续以此前产物作为交付候选；仅在隔离分支中修复或撤销失败的引入项、重新生成派生文件，并运行受影响检查。源码变化后重新构建相关 Client、Host 及原生产物。不得通过禁用断言、绕过发布身份、削弱网络限制或修改已安装用户配置来消除失败。

交付源码提交、更新的引入记录、验证报告、内部 ARM64 DMG 及发布 manifest。明确实际验证的平台与签名范围，以及所有未解决的必要检查。此内部安装结果不能证明公开发行公证、Windows/Intel 验证、付费 API 行为或直接在挂载镜像中运行内嵌运行时已通过。

<a id="later"></a>

## 单独的运行时评估

本次引入通过验收后，再为 subagent 生命周期及 PTC 指导文本与持久执行编写独立提案。梳理提供方和使用方、常设团队与助手交互、取消、后代进程清理、Session 兼容性、两种 SDK、沙箱与资源归属，以及快照覆盖。将保持输出不变的提示词组合改动与持久执行分开评估。该评估可以建议引入、更小范围回移或推迟，本计划不授权实施这些改动。

<a id="dev-note"></a>

## 开发备注

这是供负责人审阅的计划，不是完成报告。源码清单包含当前观察，实施验证字段在执行前保持待完成状态。编写计划不会重新运行应用构建，也不修改产品代码。
