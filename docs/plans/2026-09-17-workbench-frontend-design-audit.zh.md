# 工作台前端设计审计

[English](2026-09-17-workbench-frontend-design-audit.md) | 中文

日期：2026-09-17

范围：octopus_DSH 工作台前端 —— 会话外壳加三个工作台界面（知识库选择器、问数 gate、电商），在设计系统层面评估。

方法：对设计 token、组件结构、交互状态、可访问性属性、文案密度与动效策略做源码级审计，并把每个 token 名逐一对照 `packages/client/ui-theme/src/styles/` 核验。本次审计无视觉截图可用；每条结论都引用产生该渲染结果的文件。

## 摘要

底层设计系统是健康的：颜色由 token 驱动且有真正的暗色主题，elevation 与字阶已 token 化，聊天区有焦点态与 reduced-motion 处理，所有用户文案都走 locale 字典并有门禁。工作台面板游离于这套体系之外，而机制比「手写像素值」更具体：**两个工作台包引用了根本不存在的设计 token。** `LibraryPicker.module.css` 与 `DataSourcePage.module.css` 共用了七个 `ui-theme` 从未定义的 `--dsw-alias-*` 变量，因此两种主题下真正渲染出来的都是 CSS 回退值 —— 或者什么都没有。此外，选择器以行内区域渲染却声明 `role="dialog"`，没有焦点、加载、空态，并在该放一行摘要的位置放了五段散文。修法比重设计窄得多：修正 token 名，一次性决定「行内区域还是 `Modal`」，然后压文案、补状态。

## 已经做得好的

- **token 驱动的颜色与真暗色主题。** `body[data-ds-dark-theme]` 切换 alias token 集（`packages/client/ui-theme/src/styles/design-platform.css`）。
- **token 化的 elevation 与字阶。** `--dsw-elevation-prominent` / `-panel` / `-soft` / `-stroke` 与 `--dsw-font-*`（如 `--dsw-font-xxs-12`、`--dsw-font-s-strong-14`）定义于 `gradient-shadow-text.css`；聊天区所有弹层（`Modal`、`Menu`、`MenuView`、`PopupSelectView`、`ModelSelect`、`ContextMeter`、`TurnUsagePanel`）都用 `--dsw-elevation-prominent`。
- **计算式正文字阶。** `--dsh-content-font-size` 加派生 delta 驱动 markdown 标题/正文字阶。
- **聊天区的焦点与动效纪律。** 客户端各包普遍有 `:focus-visible` 规则，`ui-chat` 的过渡置于 `prefers-reduced-motion` 守卫下。
- **文案归 locale 所有。** 所有字符串走类型化字典并受 `verify-client-ui-i18n` 门禁，组件里没有硬编码文案。
- **可复用的 dialog 原语。** `ui-primitives/Modal` 提供 body 挂载的卡片，自带遮罩、`Escape`、`aria-modal`、`--dsw-alias-bg-layer-2` 与 `--dsw-elevation-prominent`。

## 发现 1 —— 渲染缺陷

这些是 bug，不是打磨问题。每个未定义变量都会让声明退到逗号后的字面值；若没有字面值，则在计算值阶段判为无效并重置为属性初始值。

| 幻影 token | 位置 | 实际渲染 | 正确 token |
|---|---|---|---|
| `--dsw-alias-bg-elevated`、`--dsw-alias-bg-primary` | `LibraryPicker.module.css` `.panel` | 两者都未定义且无字面回退：**面板在两种主题下都没有背景。** 看起来正常只因其后的 composer 栈是不透明的。 | `--dsw-alias-bg-layer-2` |
| `box-shadow: 0 8px 24px rgb(0 0 0 / 12%)` | `LibraryPicker.module.css` `.panel` | 暗色模式下出现亮色主题的阴影。 | `--dsw-elevation-prominent` |
| `--dsw-alias-label-danger` | `LibraryPicker.module.css` `.remove`、`.batchFailed`、`.error` | 永远是 `#c00`；token 一侧从未生效。 | `--dsw-alias-state-error-primary` |
| `--dsw-alias-text-danger` | `DataSourcePage.module.css` `.missing`、`.error` | 永远是 `#b42318`，一个只适合亮色的红。 | `--dsw-alias-state-error-primary` |
| `--dsw-alias-border-primary` | `DataSourcePage.module.css` `.rowPick:hover` | 永远是 `#3d3d3d`，一个只适合暗色的边框。 | `--dsw-alias-border-l2` |
| `--dsw-alias-border-brand` | `DataSourcePage.module.css` `.rowSelected .rowPick` | 永远是 `#4d8dff`。 | `--dsw-alias-state-business-primary` |
| `--dsw-alias-fill-brand-soft` | `DataSourcePage.module.css` `.rowSelected .rowPick` | 永远是 `rgb(77 141 255 / 12%)`。 | `--dsw-alias-state-business-tertiary` |
| `--dsw-alias-bg-elevated` | `DataSourcePage.module.css` `.templateBody` | 永远是 `transparent`。 | `--dsw-alias-bg-layer-2` |

两个包各自凭空造了七个名字。没有任何门禁把 `var(--dsw-…)` 引用对照 `ui-theme` 检查（`scripts/` 下没有这类校验器），在门禁出现之前这个模式会反复出现。

## 发现 2 —— 改进空间

| # | 改进点 | 证据 |
|---|---|---|
| 1 | 给工作台面板补焦点样式。聊天区处处有 `:focus-visible`，知识库与问数面板一处都没有，键盘用户看不见焦点。 | `LibraryPicker.module.css` 无 `:focus`；`DataSourcePage.module.css` 无；只有电商有 1 处。 |
| 2 | 补加载态与空态。`listLibraries` 是异步的，面板在返回前渲染空列表；目录真为空时只出现新建按钮，没有任何说明。 | `LibraryPicker.tsx` 只跟踪 `rows`/`error`，没有 loading 标志，也没有 `rows.length === 0` 分支。 |
| 3 | 降低文案密度。选择器在操作区上方连排五段说明。 | `locales.ts` 定义 5 个 `picker.lead*` 键，全部在 `LibraryPicker.tsx` 中以 `<p className={css.lead}>` 渲染。 |
| 4 | 接入字阶 token。面板手写 `font-size: 12px; line-height: 18px` 与 `font-size: 14px; font-weight: 600`，而 `--dsw-font-xxs-12`、`--dsw-font-s-strong-14` 已存在。间距与圆角在 `ui-theme` 中没有 token，聊天区 chrome（`InputBar.module.css`）同样用 px 字面量，所以间距不是本次要修的分歧。 | `LibraryPicker.module.css` 的 `.lead`、`.title`、`.batch`。 |
| 5 | 增加动效策略。面板瞬间出现/消失，而聊天区弹层有过渡。 | ask-knowledge / ask-data 的 CSS 无 `transition` / `prefers-reduced-motion`。 |
| 6 | 批次状态不要只靠颜色。失败行是红字、无图标或形状，色觉障碍用户读不出（WCAG 1.4.1）。 | `LibraryPicker.tsx` 批次 `<li>` 只换红色 class。 |
| 7 | 用危险态 hover token。`.remove:hover` 用的是中性 hover 背景。 | `--dsw-alias-interactive-bg-hover-danger` 已存在，`Menu.module.css` 用它标记破坏性条目。 |

## 发现 3 —— 设计缺陷

**A. 行内区域挂着 dialog 角色。** `LibraryPicker` 声明 `role="dialog"`，但 `ConversationRoot.tsx` 把它行内渲染在 composer 栈中、hero 行与输入栏之间，没有 portal、遮罩或焦点管理。在这里加 `aria-modal` 与焦点陷阱会是可访问性倒退：这个面板并非模态。角色必须与渲染方式一致，这迫使下一节的决策。无论选哪条路，当前状态 —— dialog 角色、只给鼠标用户的关闭按钮、无 `Escape`、打开时焦点不移入、关闭时焦点不归还 —— 都是功能性可访问性缺陷。

**B. 散文当界面。** 选择器把「知识库是什么、与问数的区别、数据模式行为、如何加文档」写成操作区上方五段连续说明。用户的任务是「选一个库」，界面却回以一堵文字墙。层级应来自结构（分组、披露、tooltip），而非段落数量。问数 gate 有同样的缺陷，且是全屏尺度。

**C. 三个入口、三种语义。** 同一个选择器可从 hero chip（`conversation.hero.askKnowledge`，toggle）、composer「+」菜单（`conversation.input.attachKnowledge`，打开列表）、设置页（`settings.section`，名单）进入，三者行为各异，「知识库」的心智模型不稳定 —— 取决于你从哪进，它是按钮、菜单项还是设置项。这种不一致是早前「每次上传都新建一个库」困惑的诱因之一：从「+」进入并不传达「你正在新建」。

**D. 一个产品、两套视觉语言。** 聊天区是完整体系（token、elevation、动效、焦点）；工作台面板是手写浮块，带幻影 token、无动效、无焦点。并置时工作台读起来像事后补的，而非产品本身。

## 先决决策：行内区域还是 `Modal`

后续每个升级都依赖这个选择，所以它排在最前。

| | 保持行内 | 采用 `ui-primitives/Modal` |
|---|---|---|
| 语义 | 把 `role="dialog"` 换成 `<section aria-labelledby={titleId}>`；挂载时焦点移到标题；关闭时焦点归还到触发它的 chip 或菜单项；本地处理 `Escape`。 | `Modal` 已提供 `role="dialog"`、`aria-modal`、遮罩点击与 `Escape`。 |
| 视觉 | 需手动修复背景、elevation、圆角（发现 1）。 | 继承 `--dsw-alias-bg-layer-2`、`--dsw-elevation-prominent`、圆角、标题栏与关闭按钮；选择器自己的标题栏标记与 `.panel` / `.close` CSS 可删除。 |
| 三入口（缺陷 C） | 仍是三种不同姿态。 | 三个入口打开同一个 modal，姿态统一，无需等到升级 3。 |
| 布局 | 打开时把 composer 往下推。 | 覆盖显示；composer 原地不动。 |
| 缺口 | — | `Modal` 没有焦点陷阱和焦点归还。若需要，加到原语里一次，而不是加到选择器里。 |

建议：采用 `Modal`。它减少选择器的代码，顺带修掉发现 1 的大部分，并在同一次改动里解决缺陷 C 的姿态不一致。

## 建议 —— 三个升级，按序

**升级 1 · 修正 token 并加门禁。**

把发现 1 的「正确 token」列应用到 `LibraryPicker.module.css` 与 `DataSourcePage.module.css`；删除所有字面回退，让未来的幻影 token 显性失败而非静默。把手写的 `font-size` / `line-height` 对换成 `--dsw-font-xxs-12` 与 `--dsw-font-s-strong-14`。给 `.remove:hover` 加 `--dsw-alias-interactive-bg-hover-danger`。补与聊天区一致的 `:focus-visible` 规则。在 `@media (prefers-reduced-motion: no-preference)` 下加 120ms 的 opacity / transform 进场过渡。同一 PR 中新增 `scripts/verify-client-css-tokens.ts`，拒绝 `packages/**/*.css` 下任何未在 `ui-theme/src/styles/` 声明的 `var(--dsw-…)` 引用，接入 `run-gates.ts`，并证明它能拒绝修复前的文件。

收益：面板首次在两种主题下正确渲染；这类 bug 不再复发。成本：低 —— 映射表写好后就是一次查找替换，加一个短校验器。风险：低。

**升级 2 · 渐进披露、三态、正确的 dialog 语义。**

五段 lead 压成一行摘要加可折叠的规则披露。用 `--dsw-alias-bg-skeleton` 加加载骨架，加带自身文案的显式空态，加从面板到 `.error` 的 `aria-describedby`。给每个批次行在颜色之外加图标或字形，使状态在色盲下仍可读。落实上一节选定的语义 —— `<section>` 区域模式或 `Modal` 包裹 —— 若选 `Modal`，删除选择器自己的标题栏、关闭控件与 `.panel` CSS。

收益：首屏文字约降 80%，层级清晰，可访问性缺陷关闭。成本：中（组件加文案）。风险：低。

**升级 3 · 统一的「数据源」视觉语言。**

把问数与知识库收敛为一个「数据源」概念：类型徽章（表 / 文档库）、库身份（首字头像加文档数）、批次状态用图标加形状；三个入口统一为同一隐喻。图标扩展 `ui-primitives/src/icons/index.tsx`；桌面包对体积敏感，第二套图标库不在范围内。

收益：工作台获得视觉身份，三入口困惑消失。成本：高（信息架构加图标扩展）。风险：中。

建议顺序 1 → 2 → 3。升级 1 是正确性修复，可单独落地。升级 2 依赖行内 / `Modal` 决策。升级 3 重定义信息架构，应在前两者落地之后。

## 验证

每个升级都改变组装后的浏览器输出，所以每个 PR 都需要下表的检查；用户可见变更需要快照证据。

| 升级 | 命令 |
|---|---|
| 1 | `pnpm run verify-client-css-tokens`（新增；必须在修复前的树上失败、修复后通过）、`pnpm run test:gui`、`DSH_SNAPSHOT=replay pnpm run test:web`，加选择器与问数 gate 的亮/暗截图各一对。 |
| 2 | `pnpm run test:gui` 并新增加载、空态、错误态及 `Escape` / 焦点行为的 spec；`DSH_SNAPSHOT=replay pnpm run test:web`；新文案键跑 `pnpm run verify-client-ui-i18n`。 |
| 3 | 升级 2 的全套，若图标导出有变再加 `pnpm run verify-client-packages`。 |

## 开放问题

- 行内区域还是 `Modal` —— 已选 `Modal`（升级 1–2 按此落地）。
- 三个入口是否应收敛为两个 —— 已选：保留三个（hero chip、加号菜单、设置名单）。身份落在这些界面上，不另做首页。
- 是否应另起提案向 `ui-theme` 引入间距与圆角 token。它们今天不存在，聊天区 chrome 同样用 px 字面量，加它们是设计系统改动而非工作台修复。
