# Agent Note: octopus_DSH desktop Hero atmosphere

Status: implemented

[English](2026-09-18-desktop-hero-atmosphere.md) | 中文

## Problem

octopus_DSH 桌面的空白会话 Hero 是平坦的一列。动态背景必须保证 composer 可读，在 transcript 出现后淡出，遵守减少动态效果，并且不得改动官方 `apps/desktop`、`dsh-desktop-app` 与 desktop-companion 产品逻辑。FishLogo 保持官方实现。

## Decision

官方 [`ui-conversation`](../../../../packages/client/ui-conversation/README.zh.md) 将 `conversation.atmosphere` 声明为 root `single` 孔位。`ConversationRoot` 把它画在 header 与 body 后方的绝对定位、不接收指针的座位上（仅在 shell 处于空白会话 Hero 时 `hero: true`）。官方 web 让该孔位保持为空。

占座是私有 overlay [`@deepseek-ai/dsh-experimental-desktop-hero-atmosphere`](../../../../packages/experimental/desktop-hero-atmosphere/README.zh.md)。补丁只插入一行 Host；`dsh.client` 发现 Client 面。Client 注入内联的 `data:` URL（K0 海报、K1 漂移静帧、六秒 GOP 循环：`media/poster.jpg`、`media/k1.jpg`、`media/hero.mp4`）。Client 面 tsdown 的 `load` 钩子同时匹配 `src/media-urls.ts` 和 `lib/types/media-urls.js`；只匹配源文件会让 `lib/client.js` 留下 CJS 的 `require("url")`。Client 工厂不计算 Node 的 `import.meta.url`。播放静音、循环且 `playsInline`。`prefers-reduced-motion: reduce` 时只保留 K0。`play()` 被拒绝或被 CSP 拦截时卸载 video，留下 K0/K1 交叉淡化。透明度随 `hero` 过渡。48% 的 `bg-base` 纱保持 composer 对比度。

播种遵循 [`scripts/desktop-profile-plugins.json`](../../../../scripts/desktop-profile-plugins.json)（`source: "workspace"`）。官方 `desktop-app` 与 `PROFILE_TEMPLATES.desktop` 不点名该 overlay。

## Alternatives considered

**把氛围画进官方 `dsh-desktop-app` 或 `apps/desktop`。** 否决：课程与 overlay 工作不得改动这些产品包。

**只放静帧壁纸。** 否决：motion brief 要求 Hero 上可见的活循环，而不是一层 CSS 也能完成的静帧。

**把 oil-motion 全关键帧编译结果当作 `hero.mp4` 发布。** 否决：该产物约 18 MB；自主播放不需要逐帧关键帧，355 KB 的 GOP master 才是打包循环。

**实时 WebGL / CSS 焦散。** 否决：烘焙六秒底板符合 Hero 座位的显示预算，减少动态效果已有海报路径。

**沿用深色航拍鲸图。** 否决：底板位于输入 chrome 后方；忙、低调的画面会抢对比度。

## Consequences

播种后的 octopus_DSH 桌面在空白会话 Hero 显示浅水底板，并在 transcript 激活后隐藏。官方 web 默认组合不占用 `conversation.atmosphere`。用户删除该包名后，后续种子刷新不会写回。本包不发布 `./invariant`：Host apply 为空，Client 占用只是一次可释放的注册。

## Testing

包测试覆盖空操作 Host `apply`、打包媒体 URL、减少动态效果的订阅/释放与 `window.matchMedia` 默认值、Client `slots.inject('conversation.atmosphere')`、Hero 播放并带 K1 漂移静帧、减少动态效果时仅 K0、`hero` 为 false 时暂停，以及 `play()` 拒绝或 video 出错时卸载 video。官方 `ui-conversation` skeleton 测试已经要求发起 atmosphere 渲染调用。
