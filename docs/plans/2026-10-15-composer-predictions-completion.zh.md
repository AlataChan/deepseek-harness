# 输入框下一步建议的完善与验收实施计划

[English](2026-10-15-composer-predictions-completion.md) | 中文

> **实施者：** 按依赖顺序逐项执行本计划，采用 executing-plans 工作流，每项任务以独立提交落地。

**目标：** 前台对话完成后，在空输入框内以灰色文字提供一条结合上下文的下一步输入建议；Tab 只接受为可编辑草稿，不发送消息。

**架构：** 完善现有 assistant-registry 建议服务与 client-ui-assistants 集成。Host 判断资格并组织上下文，保留辅助请求与用量证据，复用输入框覆盖层和设置插槽。普通、专属智能体与常驻团队协调者对话使用同一路径，不改变绑定或应用默认模型。

**技术栈：** Cordis、Typert remotes、React、现有 Session 查询和输入 API、带修订号的 Settings API，以及现有模型适配器。

**状态：** 这是基于源码、已安装 macOS 界面、现有测试与独立合成控制形成的实施提案。本文件本身不启用功能、不修改产品、不发起付费推理，也不授权打包；实施前须评审产品选择。

**第二轮计划评审（2026-10-16）：** 已对照设置门面、loader volatile 更新、输入框按键仲裁、路由投影和测试发现机制检查源码。可开始隔离的可行性任务；行内呈现仍由任务 1 决定。计划通过不等于产品或发行验收通过。

## 摘要

实验性基础已经存在，但直接打开当前开关无法交付目标体验：普通对话被排除，建议显示为独立横条，Host 和按键保护不足。应先完善这些路径，再开放面向普通用户的设置。默认关闭，用户看到模型额度提示并主动启用后才生成建议。

## 目录

- [当前实现](#observed-implementation)
- [产品与架构选择](#product-and-architecture-decisions)
- [必要行为](#required-behavior)
- [实施任务](#implementation-tasks)
- [验收与发行](#acceptance-and-release)
- [尚未核验的范围](#remaining-verification-limits)

<a id="observed-implementation"></a>
## 当前实现

检查对象为当前工作树和运行中的 `/Applications/octopus_DSH.app`，未修改产品代码或配置。检查通用设置时没有更改设置或提交提示词。私有会话正文与截图不进入本计划及交付证据。

| 发现 | 当前源码或观察 | 影响 |
| --- | --- | --- |
| 默认关闭 | `AssistantService.Config.enableComposerPredictions` 默认 false，安装包保持该值 | 打包代码不会自动启用建议 |
| 限于绑定会话 | `getComposerContext()` 在 `isAssistantBound(sessionId)` 不成立时返回 null | 普通会话无法通过已挂载界面取得建议 |
| 缺少用户设置 | 通用设置没有开关，Client 没有对应设置组件 | 用户无法发现和启用 |
| 设置接口不可写 | 配置为普通 `z.boolean()` 而非 `.volatile()`；配置表单不暴露该字段，`isVolatilePath` 拒绝写入 | 需要 volatile 声明和实时读取才能持久化开关 |
| 独立横条 | 使用 `conversation.input.dock`，CSS 绘制带边框横条 | 不符合行内灰字体验 |
| 全局捕获按键 | 监听 `window.keydown`，符合资格时接受所有 Tab | 其他控件、Shift+Tab 和输入法可能误接受 |
| Host 信任请求状态 | `predictComposer()` 未核验完成轮次便转交客户端上下文、草稿和序号 | 直接调用仍可能触发不合格推理 |
| 上下文短且无结构 | 仅从最新完成轮次收集文本，再保留最后三个、每个至多 300 字符的片段 | 原始目标、角色、工具结果与先前决策可能丢失 |
| 可复用基础 | 辅助推理、用量、取消、生成 remotes、修订插入和部分过期检查已存在 | 应复用，避免另建运行时 |

四个现有测试文件的 24 项检查通过；独立合成控制复现了四个失败：焦点不在输入框时接受建议、Shift+Tab 接受、输入法组合时接受，以及非空草稿配合伪造序号且没有合格完成轮次时 Host 仍推理。Host 控制使用合成适配器，观察到建议及用量记录，未调用付费服务。

证据保存在 `.plans/composer-predictions-audit/`，包括 `existing-prediction-tests.log`、`adversarial-prediction-probes.log`、可复现控制源码和去敏后的原生设置摘要。临时控制已从包测试目录移除；它们不是干净检出的依赖，实施时须将回归控制纳入所属测试。

参考：[现有产品设计](2026-10-12-persistent-assistants-and-teams-design.zh.md)、[Host 服务](../../packages/experimental/assistant-registry/src/index.ts)、[建议推理](../../packages/experimental/assistant-registry/src/review-prediction.ts)、[Client 集成](../../packages/experimental/client-ui-assistants/src/client/ComposerPrediction.tsx)、[OpenAI 公开交互说明](https://learn.chatgpt.com/docs/features/composer-predictions)。不推测 OpenAI 私有模型或请求实现。

<a id="product-and-architecture-decisions"></a>
## 产品与架构选择

| 方案 | 收益 | 局限 | 结论 |
| --- | --- | --- | --- |
| 完善现有服务并复用覆盖层和设置插槽 | 复用路由、用量、remotes 与输入所有权，覆盖普通会话 | 需要真实编辑器集成及资格检查 | 推荐 |
| 仅打开开关并保留横条 | 改动小 | 安全缺陷、范围限制与视觉差异仍在 | 不作为发行方案 |
| 新建独立建议包和运行时 | 生命周期独立 | 重复推理、设置、路由与计费职责 | 仅在现有服务无法承载时再考虑 |

第一版推荐：

- 覆盖前台普通对话、专属智能体和常驻团队协调者；不覆盖后台子会话、席位会话、取消、失败或权限询问后的状态。
- 通过 `settings.general.item` 增加“显示下一步建议”设置行，旁边显示额度提示。通过带修订号的 Host 设置持久化 volatile 字段，不增加浏览器本地付费功能开关或独立设置页。
- 默认关闭，说明“根据当前对话生成下一步建议，会使用当前模型额度；Tab 仅填入，不会自动发送”，不得连带启用记忆复核。
- 空输入框内只显示一条短纯文本建议，提供“Tab 采用”和可点击的接受操作，保持正常输入、附件及引用标签。
- 复用会话有效路由，不修改全局默认模型；独立低成本建议路由留待后续显式配置。
- 只在新观察到前台会话从运行转为成功空闲时自动生成；打开旧历史不得自动重复计费。

产品改动限于两个 fork 自有实验包。允许修改验收脚本、生成文档及目录、录制会话夹具和 `apps/web/tests/` 下的测试运行器。不修改 `packages/core`、`packages/client`、`apps/desktop` 或 `packages/subagent`，不复制现有编辑器或导入私有 `ComposerKeyboard`。

<a id="required-behavior"></a>
## 必要行为

### Host 资格与上下文

复用经过身份认证的桌面所有者 remote 入口，核实 Session 存活、精确最新完成轮次、空闲状态、配置及有效路由，从日志构建上下文。本操作属于单用户 Host，不作为委派模型工具，传入 Session ID 本身不代表授权。普通会话去除智能体绑定前提，但保留退役、删除及团队限制；生命周期检查不能替代调用方权限检查。`assertSessionUsable` 只涵盖生命周期和删除；`authorizeSessionSource` 判断历史可见性，调用方与目标相同时返回 true，均不能冒充所有权检查。

不得信任远程 `recentTexts`。`getComposerContext()` 仅用于有上限的资格查询，`predictComposer()` 再次独立检查当前 Session 与已提交序号，所有消费者及生成 remotes 同步更新。任何非空草稿（包括空白）均不合格。Host 只能检查声明的草稿快照；Client 负责实时状态、焦点、修订插入和取消。发出请求后输入可以使结果失效，但不能保证提供方尚未计费。

通过 Session ID 和完成轮次序号确定目标。Host 从日志重新推导最新完成轮次，拒绝伪造或过期序号，无需新增资格令牌或寿命存储。捕获当前 Session 对象，防止相同 ID 下替换实例后旧任务被接受。Client 分别捕获请求身份、绑定实例与草稿修订；新增跨进程 ID 必须带品牌类型。拒绝的过期、未授权、关闭、运行中或非空请求必须为零模型调用。

从最新用户请求、完成摘要、相关前序交流与有限日志结果组织带角色的上下文。不得倾倒任意工具输出、文件、私有记忆、其他席位或会话。派发及辅助请求记录前使用已有 `SECRET_PATTERN` 筛查，命中时跳过且诊断不得记录命中文本；这不是全面秘密检测或授权。保持语言和用户意图，要求一条有用的下一步用户消息，不是助手回答、列表或无条件追问。

增加经验证的 `predictionContextMaxBytes` 配置，覆盖完整序列化消息、提示词框架和角色标签；通过任务 3 的中英文夹具选择并记录默认值。读取事件及选择内容时先限制规模，固定开销已超限时跳过。本版采用保守 UTF-8 字节上限，精确分词器及提供方调优后续再做，中文不能按字符数除以四计算。现有输出与期限默认为 150 token 和 3,000 ms，保持可配置，修改前测量代表性提供方。失败、空输出、非法输出或超时不显示建议，也不阻塞输入。

跨窗口按当前 Session 实例、完成序号、有效路由和配置及策略合并同一请求，并复用合格成功结果。每个订阅者只拥有自身订阅；关闭 A 不得中止仍被 B 等待的请求。全部订阅者释放、轮次或路由或设置失效、期限耗尽或服务释放时中止底层请求。所有结束路径都清理监听及运行记录，不让一个取消污染可复用结果。检查现有 `assistant/auxiliary` 证据，避免重连或重启后自动重复不确定的付费调用；复用现有事件和用量，不新增 Session 事件。呈现前再次核验 Session 与轮次。通过现有所有者解析 `modelSelection.next`、智能体或席位覆盖以及应用默认路由，不能只依赖历史请求头；比较包含推理强度及其他有效请求配置。辅助推理结束后在 `predictComposer` 内重新解析，不匹配则无结果；切换路由不能修改全局默认。

### Client 生命周期与接受

请求时捕获空草稿的 `TokenSpan` 和修订，将请求身份、Session 绑定实例、已提交轮次序号和草稿修订一起保存。只有全部一致且草稿完整为空时才显示。绑定变化、任意输入或空白、输入法组合、导航、设置变化、发送或新轮次都取消或使请求失效。

接受使用 `inputActions.insertText(text, capturedSpan)` 并检查布尔结果，不能重取新 span 让旧建议冒充有效，也不能回退到 `setDraft()` 或调用 `submit()`。插入失败不能宣告成功或覆盖文本。

键盘由获得焦点的输入框拥有。覆盖层锚点是编辑器在卡片内的兄弟元素，收不到编辑器冒泡事件；通过 `closest('[data-composer-card]')` 在卡片上注册冒泡监听，在 Lexical 仲裁后核实 `event.target` 为所属编辑器。`InputActions` 没有按键注册 API，私有 `ComposerKeyboard.arbitrate` 也未导出，任务 1 必须用真实编辑器验证。忽略被阻止事件、组合快捷键、Shift+Tab、输入法事件和外部目标；`/`、`@` 菜单及焦点遍历优先。组合状态同时检查 `isComposing`、`keyCode === 229`、包含结束后延迟清理语义的 `data-composer-composing` 及已提交输入状态，不仅依赖 React 状态。监听跟随所属编辑器和卡片绑定、重新绑定及释放。

### 输入框内呈现的可行性

`conversation.input.overlay` 是 Session 范围的现有插槽，锚点位于卡片顶部且高度为零，原本用于浮动条目，不是现成的灰字编辑 API。

任务 1 必须证明 fork 覆盖层能对齐空编辑器、保留原生占位符，并适应附件、字体、窄窗口和明暗主题。使用现有数据属性和公开 hooks，不使用生成 CSS 私有类、DOM 重新挂载或替换 Lexical。临时监听和测量观察器跟随所属输入框释放，不得全局隐藏占位符。

若现有插槽必须依靠脆弱操作才能满足要求，报告缺失的公开扩展点。保留紧凑 dock 作为显式产品备选，不得称为行内灰字。扩展受保护包前须另外批准范围。

<a id="implementation-tasks"></a>
## 实施任务

每项任务先增加并运行预期失败的回归控制，再做最小修改、通过所属检查并独立提交；不得提交仅有失败测试的变更。

### 任务 1：验证编辑器集成并确定视觉方向

**文件：** 只读检查 `packages/client/ui-conversation/src/client/{contract/slots.ts,input/editor/keymap.ts,skeleton/InputBar.tsx,skeleton/InputBar.module.css}`；在 `packages/experimental/client-ui-assistants/tests/composer-overlay.client.spec.tsx` 和隔离浏览器夹具中做原型。

1. 在现有组件上复现三项历史按键失败。
2. 经覆盖层将合成建议挂载到真实输入框，不用假 textarea 冒充视觉验收。通过标准 Session props 取得 `useSession`、`useInput` 和 `inputActions`；覆盖层不会像 dock 那样直接传入所有者值。
3. 验证行内位置、占位符、尺寸和字体变化、点击接受、输入法、菜单优先级、附件及双主题；提供真实截图和草稿断言，不能只有回调 spy。
4. 记录仅改 fork 是否足够，公开能力不足时停止行内部分，不暗中扩大范围。

**运行：** `pnpm exec vitest run packages/experimental/client-ui-assistants/tests/composer-overlay.client.spec.tsx`；浏览器使用受支持的 `dsh` Web profile，涉及目录选择时使用固定 browse-picker overlay。

**预期：** 先看到预期按键失败，再确认行内方案可行；本任务不全局启用功能。

### 任务 2：让 Host 判断请求资格并覆盖普通对话

**修改：** `packages/experimental/assistant-registry/src/{index.ts,review-prediction.ts,types.ts}`。

**测试：** 现有 `tests/predictions.spec.ts` 与新增 `tests/composer-eligibility.spec.ts`。

1. 验证普通、智能体及协调者成功路径；不存在、运行、失败、过期序号、退役席位和非空草稿均零调用。另测入口拒绝未认证或越权调用，不能用生命周期代替授权。
2. 将资格与上下文构建移入 Host，实时检查身份和结果新鲜度，不使用远程文本作上下文。
3. 确定性验证双窗口共享、单方退出保留另一方、全部退出中止、轮次或路由变化失效，以及旧订阅者不能取消新请求。用真实 remote 载体和阻塞流证明取消抵达适配器，只有模拟回调收到信号不够。
4. 修改原来允许 `draftText: 'What are the'` 且无完成用户轮次仍返回建议的测试；该行为应被移除。
5. 请求、结果及提供方实际用量仍能重建辅助推理，已报告的失败和中止付费用量也要保留。

**运行：** `pnpm exec vitest run packages/experimental/assistant-registry/tests/predictions.spec.ts packages/experimental/assistant-registry/tests/composer-eligibility.spec.ts`。

**预期：** 日志上下文进入记录适配器；非法请求零调用，等价重复请求一次调用。

### 任务 3：完善有上限的建议上下文和输出

**修改：** `packages/experimental/assistant-registry/src/{index.ts,review-prediction.ts}` 及必要的请求和上下文类型。

**测试：** 新建 `packages/experimental/assistant-registry/tests/composer-context.spec.ts`。

1. 创建中英文合成会话，关键目标位于最后三个片段之前，覆盖已完成、未完成和合理验证步骤。
2. 保留角色和有限结果，对完整请求使用 UTF-8 字节上限，不按字符数估算。
3. 要求会话语言的一条短用户消息；空、畸形或超限输出拒绝，不虚构替代建议。单测断言输入及结构规则，不固定随机措辞。
4. 排除其他范围和无关私有记忆，所有模型可见内容仍在现有辅助日志中。

**范围：** 保持 `maxPredictionTokens` 150 与 `predictionTimeoutMs` 3,000 的默认值。本任务必须实现序列化消息字节限制；精确分词和提供方优化后续再做。测试完整请求、固定开销溢出、长中文及秘密筛查零调用。

**运行：** `pnpm exec vitest run packages/experimental/assistant-registry/tests/composer-context.spec.ts`。

**预期：** 先前意图在限制内保留，中文序列化额度有效，不增加额外请求或工具。

### 任务 4：增加付费功能设置并更新 Client 状态

**修改：** `packages/experimental/client-ui-assistants/src/client/{mount.ts,index.ts,ComposerPrediction.tsx,locales.ts}`；Host 的 `src/{index.ts,review-prediction.ts}` volatile 字段、所属 locale JSON，以及必要依赖声明。

**新增：** `tests/prediction-setting-row.client.spec.tsx`，不新建设置页，现有原语不能表达时才加局部样式。

1. 通过 `settings.general.item` 和注入的 `ctx.configForms` 及带修订号 Host 镜像注册一行，不另建 remote 缓存。使用 assistant-registry 命名空间并核实描述符；通过现有注册生命周期暴露设置，必要时调用 `settings.configure({ auto: false }, ctx.fiber)`，无设置的 headless 仍可运行。
2. 声明 `.volatile()` 与 `Volatile<boolean>`，向管理器传入实时 getter，在准入、派发前及结束后读取 `.get()`。通过所属 context 监听 `loader/volatile-update`，关闭时取消建议；Volatile 本身没有订阅 API。建议与记忆复核使用不同控制器。声明与实时读取缺一不可。
3. 使用 `ConfigForm.set()` 及镜像串行修订只修改目标字段，保留其他配置。表单就绪、可写且 Host 模式时才启用设置行，不将付费功能仅存于浏览器内存。启用前展示额度提示，写入失败保留原有效状态并报告。
4. 不改记忆复核，测试持久化、跨窗口、推理中关闭及插件释放和重载。
5. 用显式请求身份和草稿修订生命周期替代零散 refs；新完成的前台轮次触发，挂载历史空闲会话不触发。

**运行：** `pnpm exec vitest run packages/experimental/client-ui-assistants/tests/prediction-setting-row.client.spec.tsx packages/experimental/client-ui-assistants/tests/remediation-dock-lifecycle.client.spec.tsx`。

**预期：** 关闭零调用，启用重启保留，输入与设置变化使旧请求失效，已有输入占用和草稿重载后不丢失。

### 任务 5：交付行内显示与编辑器安全接受

**修改：** `packages/experimental/client-ui-assistants/src/client/{ComposerPrediction.tsx,ComposerPrediction.module.css,mount.ts}`；仅当任务 1 表明独立呈现职责有用时增加 `ComposerPredictionOverlay.tsx`。

**测试：** 现有建议及生命周期测试，纳入三项历史按键控制和真实输入框夹具。

1. 使用已验证覆盖层，不重复显示横条。
2. 焦点内冒泡按键与可点击接受并存，保留菜单仲裁和读屏行为。
3. 仅在使用捕获 span 插入成功后清除建议，不无条件覆盖草稿。
4. 输入法、Shift+Tab、外部焦点、输入后清空、修订竞态、插入失败、轮次推进及切换会话均不能接受或复活旧建议。

**运行：** `pnpm exec vitest run packages/experimental/client-ui-assistants/tests/prediction.client.spec.tsx packages/experimental/client-ui-assistants/tests/remediation-dock-lifecycle.client.spec.tsx packages/experimental/client-ui-assistants/tests/composer-overlay.client.spec.tsx`。

**预期：** 历史负向控制通过，Tab 向真实编辑器插入一次，用户发送前不产生提交或新推理轮次。

### 任务 6：验证安装态并记录功能

**修改：** 两个包的中英文 README、受影响的 Config/Cordis 生成目录及双语所有者、桌面验收门禁；使用所属生成器，不改无关区域。只有文档公开接口变化才更新 `docs/subsystems/agent-team.{md,zh.md}`。

**新增：** `scripts/verify-composer-predictions-installed-flows.mjs` 使用安装运行时与隔离合成 profile/provider。按 `snapshots/AGENTS.md` 增加 shipped `dsh` profile 的无密钥会话夹具及真实建议事件；浏览器运行器位于 `apps/web/tests/composer-predictions.snapshot.ts`，数据位于 `snapshots/web/composer-predictions/`。Web 配置只发现 `apps/web/tests/` 的运行器；纯 Session 夹具经测试 driver 只能到 Host，无法验证自动 Client 触发或真实编辑器插入。不新建生产 Node 启动器。

1. 用隔离 Host 验证真实设置、编辑器和普通对话，请求必须含已提交上下文及实际所选路由。
2. 阻塞并释放响应，检查过期与取消，再 Tab 接受为可编辑草稿且无新用户轮次。
3. 冷重启保留设置与用量，打开旧历史不重复计费，覆盖关闭及非法序号负向控制。
4. 同步用户文档、双语说明、路由额度提示与所有公开消费者。本计划不新增 Session 事件；如实施发现实际持久化类型变化，按要求记录。

**本地检查：** 运行所属 Host/Client 套件和所有改动源码的范围覆盖率，保持逐文件阈值并记录具体命令。检查双编译面、`verify-client-ui-i18n`、`verify-client-packages`、`gen-client-catalog --check`、受影响 Cordis/Config 目录、`verify-no-unknown-casts`、`verify-upstream-intake`、相关文档及空白。显式运行新 Session 快照与浏览器运行器；通用 PONG 不代表建议覆盖。`test:gui` 只选 `packages/client` 和 `packages/host`，不替代实验包测试。

**CI 与集成：** 保留 `test:coverage` 的全量逐文件覆盖门禁、共享 UI 的 `test:gui`、构建浏览器回放的 `DSH_SNAPSHOT=replay pnpm run test:web` 和 `doc-sync`。本地使用已有过滤器；除非定位失败或仓库级改动，全量交由 CI。未运行与失败分别报告。

**仅授权打包时运行：** 重建 Host/Client，执行桌面 bundle 门禁，DMG 只读挂载并运行安装态建议验证器，Windows workflow 必须针对同一提交安装并验收。将实际推理和接受纳入构建门禁，不能只靠静态标记。记录产物哈希。Windows Host 与浏览器验收不等于 WebView 键盘等价，宣称交互一致前仍需真实 Windows GUI 证据。

<a id="acceptance-and-release"></a>
## 验收与发行

| 控制 | 必须结果 |
| --- | --- |
| 启用后普通对话完成 | 空输入框出现一条有用建议 |
| 专属智能体或协调者完成 | 同样交互，正确本地路由和范围 |
| 未启用 | 无建议请求或辅助计费 |
| 输入空格、文字或开始输入法组合 | 请求或建议失效，不改草稿 |
| 合格输入框内 Tab | 插入可编辑文本一次，不调用提交或产生用户轮次 |
| Shift+Tab、修饰键、外部焦点、输入法或已阻止事件 | 保持原行为，不接受建议 |
| 菜单、附件、引用及被占用输入 | 原编辑器优先，不破坏内容或争用覆盖层 |
| 导航、新轮次、绑定变化或迟到响应 | 过期建议不能显示或插入 |
| 模型选择变化 | 旧结果失效，使用当前路由且不改默认 |
| 直接过期、非空或未授权请求 | 零推理，无虚构用量 |
| 双窗口相同请求 | 一次提供方请求；单方退出保留另一方，全部退出中止 |
| 推理中关闭 | 请求中止，迟到结果拒绝，记忆复核不受影响，实际计费用量保留 |
| 超长中文或秘密模式命中 | 完整字节限制有效；命中零调用且不记秘密正文 |
| 提供方失败、超时或空输出 | 输入响应正常，不虚构建议，保留观察到的用量 |
| 冷重启或打开旧历史 | 偏好保留，不自动重放不确定或已发出的付费工作 |
| 明暗主题、大字体与窄窗口 | 灰字清晰对齐，无双占位符或布局跳动 |
| macOS 与 Windows 安装包 | 产物含功能，安装态负向控制通过 |

仅当 Host、真实编辑器交互及安装路径均通过才接受。已有单测、布尔配置或模拟组件截图均不能单独证明交付。

<a id="remaining-verification-limits"></a>
## 尚未核验的范围

本轮规划未启用用户设置、提交付费提示词、重建应用或修改产品。安装检查仅说明当前控件和代码存在，不证明安装态建议成功。真实提供方延迟与原生编辑器布局仍需实施验收；不承诺仅延长三秒期限便能改善质量或解决缺陷。
