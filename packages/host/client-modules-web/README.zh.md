# `@deepseek-ai/dsh-host-client-modules-web`

[English](README.md) | 中文

[`@deepseek-ai/dsh-client-modules`](../../client/modules/README.md) 的 Web 传输适配器。它在 `/plugins/<id>/client.js` 下提供注册表发现的 Client Plugin bundle 及相邻 source map。在浏览器 shell bundle 运行前，其 index tap 会安装登记队列，通过 parser preload 加载模块系统与 Client runtime bundle，再把当前 `ClientBootGraph` 发布为 `window.__DSH_BOOT__`。模块注册表自身负责发现、bundle 路径、哈希、图组合和重建通知，不要求 Web 服务器；本包只拥有 Web 路由和 index tap。

两项注册都由 effect 管理。释放本插件会释放 `/plugins` 路由并移除其 index 转换，不会停止注册表。

## 模型体验

无，因为该适配器只提供浏览器资源和启动元数据；这里没有任何内容会进入模型请求。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延后工作

- **路由 namespace 固定** — Web 组合为 Client Plugin bundle 和 HMR 事件端点保留 `/plugins`；其他传输直接消费注册表，而不配置本适配器。
