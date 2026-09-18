---
description: "octopus_DSH 桌面空白会话 Hero 氛围：对话列后方的浅水循环底板，供组合桌面 profile 的用户使用。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-hero-atmosphere

[English](README.md) | 中文

## 概述

本 overlay 占用官方 `conversation.atmosphere` 孔位，在空白会话 Hero 上播放打包的 16:9 浅水循环。shell 离开 Hero 时底板淡出；`prefers-reduced-motion: reduce` 或 video 无法播放时留下 K0/K1 交叉淡化；底板不接收指针事件。官方 `dsh-desktop-app` 与 `PROFILE_TEMPLATES.desktop` 不点名本包。桌面 profile 种子复制构建树（[scripts/desktop-profile-plugins.json](../../../scripts/desktop-profile-plugins.json) 中 `source: "workspace"`）。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

octopus_DSH 桌面通过 [scripts/desktop-profile-plugins.json](../../../scripts/desktop-profile-plugins.json) 播种本包。Host 导出为空操作。Client 面在 `ui-conversation` 声明 `conversation.atmosphere` 之后注册。从该名单去掉 pin（或删除已播种的包名）后，官方孔位保持为空；FishLogo 与 composer 仍由官方绘制。

### 你会得到什么

空白会话 Hero 上，对话列显示高调沙洲静帧加六秒焦散循环，并加一层纱，保证输入可读。出现 transcript 时 `hero: false`，底板透明度降为零。减少动态效果的用户只看到 K0。`HTMLVideoElement.play()` 失败或被 CSP 拦截时留下 K0/K1 交叉淡化。Client bundle 把这些文件内联成 `data:` URL。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`cordis.patch.yml` 只插入一行 Host。`dsh.client` 在该 fiber 就绪后发现 Client 面。Host `apply` 为空；Client `apply` 用内联的 `media/poster.jpg`、`media/k1.jpg` 与 `media/hero.mp4` 调用 `ctx.slots.inject('conversation.atmosphere', …)`。播放是自主的（`muted` / `loop` / `playsInline`）。官方 `ConversationRoot` 拥有绝对定位的列座位，并传入 `hero`。

不发布 `./invariant` 伴生。Host apply 为空，Client 占用只是一次可释放的 slot 注册，缺席时孔位为空；没有可以独立分叉的自有关系可供断言。

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 双面 Host 插入行 |
| [`src/index.ts`](src/index.ts) | 空操作 Host 入口 |
| [`src/client/index.ts`](src/client/index.ts) | slot 占座 |
| [`src/client/HeroAtmosphere.tsx`](src/client/HeroAtmosphere.tsx) | 海报、漂移静帧、循环、纱、淡出 |
| [`media/`](media/) | 打包的 K0/K1 静帧与 GOP 循环 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Conversation UI](../../client/ui-conversation/README.zh.md) — 官方 `conversation.atmosphere` 孔位与 Hero phase。
- [Web Client Slots](../../../docs/subsystems/slots.zh.md) — slot 层级。
- [实验包](../README.zh.md) — 孵化状态与发布排除。

-----

<a id="model-experience"></a>
## 模型体验

无直接影响，因为本 overlay 只绘制装饰性对话列底板，没有任何内容进入模型请求。

#### KV Cache 影响

无直接影响；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅 Hero** — 底板是装饰，transcript 激活后隐藏；它不是会话壁纸。
- **不改官方 desktop-app 组合** — 本 overlay 是 profile pin。
- **仅自主播放** — 循环不随滚动 scrub。
- **桌面 CSP 没有 `media-src`** — 官方 WebView 回退到 `default-src 'self'`，因此 `data:` 或远程 `<video>` 播不了。底板保留内联的 K0/K1 交叉淡化。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
