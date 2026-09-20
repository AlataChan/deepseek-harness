# Agent Note：团队协作舱脱离会话头部层叠上下文

Status: implemented

[English](2026-09-20-agent-team-dock-out-of-header-stacking-context.md) | 中文

## 问题

「团队协作」面板被绘制在对话正文之下。正文的文字、链接和表格行透过舱面显示，未钉住时的遮罩也始终不出现。

`ui-conversation` 的 `ConversationRoot` 把 `.header` 与 `.body` 组合为兄弟节点，两者都声明 `position: relative` 与 `z-index: 1`。`.body` 在文档顺序上位于 `.header` 之后，因此在 `z-index` 相同时，`.body` 的每一个像素都绘制在整个 `.header` 子树之上。client-ui-agent-team 的舱注册进 `conversation.session.header.actions` 槽位，该槽位渲染在 `.header` 内部，其 `position: fixed; z-index: 121` 只在头部自己的层叠上下文内参与竞争——后代元素的 z-index 无法越过兄弟层叠上下文。舱能正确贴到视口边缘，是因为没有祖先带 transform，这使缺陷看起来像缺少背景，而不是图层被关住。

## 决定

`TeamAction` 用 `createPortal` 把舱与遮罩渲染到 `document.body`，使 `position: fixed` 保持相对视口解析、`z-index` 在根层参与竞争。这是仓库对视图浮层既有的做法：`ui-primitives`（`Modal`、`Menu`、`Toast`、`HoverCard`、`OnboardingSurface`）与 `ui-chat`（`TurnUsagePanel`）都如此。

`react-dom` 是 `PLATFORM_MODULES` 的基线条目，浏览器半边无需改动清单即可引用；该包保留原有 `devDependencies` 条目，并新增 `@types/react-dom`。

触发按钮仍留在头部槽位。只有两个浮层节点移动，槽位归属、拖拽调宽、钉住和自动刷新间隔都不变。

## 已考虑的替代方案

**抬高 `.header` 的 `z-index`。** 否决：为一个实验性浮层改稳定层 `ui-conversation`，而且头部随后必须压过输入卡座位（`z-index: 9`）、宽度拖拽条（`z-index: 8`）和 markdown 粘性代码横幅（`z-index: 6`）——这些都是在 `.body` 内为各自原因抬高的。

**去掉 `.header` 的 `z-index: 1`。** 否决：头部自身的 `::after` 规则依赖该上下文定位，改动会同时静默改变头部与氛围底板的绘制顺序。

**把舱渲染进 `ui-layout` 的 `shell.overlay` 槽位。** 否决：该槽位属于另一个包的声明，而舱必须在任何提供头部槽位的 shell 下都能挂载。

## 后果

舱与遮罩绘制在应用框架之上（其 `z-index: 121` 高于框架 `shell.overlay` 层的 `z-index: 20`），并位于弹层与提示层之下（`z-index: 1000` 与 `1100`）。关闭舱时，两个浮层节点随原有的条件渲染一起移除。

`packages/experimental/client-ui-agent-team/tests/team-action.client.spec.tsx` 断言两个节点都是 `document.body` 的子节点，且插件自身容器内不含 `[data-team-dock]`。该用例在修复前的渲染下失败，那时舱仍留在槽位容器内。
