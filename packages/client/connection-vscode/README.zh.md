# @deepseek-ai/dsh-client-connection-vscode

[English](README.md) | 中文

由 dsh companion 进程、VS Code extension host 与嵌入式 Webview 共用的有界载体。该协议让 API Proxy RPC 校验保持权威，保留既有 `events.mux` 恢复 payload，并将 host stream 限制为无字段的打开 payload。其 wire codec 只序列化每个逻辑 frame 一次，通过顺序发送物理记录提供背压，每个方向只接纳一条分块消息，在解析前核对声明长度与 SHA-256，并在任何违规后关闭 decoder。物理记录默认上限为 256 KiB；控制消息默认上限为 1 MiB；RPC 与 stream 数据 frame 复用浏览器 connection 包的 160 MiB 请求容量，使默认 100 MiB 图片总量限额仍然可用。

与浏览器兼容的 `protocol` 和 `codec` 入口保持独立于 Node。Host 根插件消费进程 IPC channel，依据配置的 `workspaceRoot` 校验启动握手（未配置的嵌入场景使用 `process.cwd()`），公布经过验证的 Client Plugin 产物，路由既有 ApiProxy envelope，并通过其 Cordis fiber 排空 stream pump。`client` 入口消费由 shell 私下提供的 record port、扩展既有 `AbstractApiClient`，并公布标准 `ctx.connection` handle。它关联有界 unary 调用与 receipt，只向上游打开 `mux` 和 Host 生命周期 frame，所有 stream 数据只从下行接收，就绪与重连仍由共享 `ConnectionController` 负责。

## 模型体验

无。VS Code 载体只运输既有消息，不贡献任何模型上下文。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **每个方向只允许一条分块消息**：第二个 start 或 inline frame 会关闭该 decoder，而不会排队积累无界工作。
- **完整 frame 的内存有界但仍非流式**：分块消息会在接收 chunk 前按声明字节数预留空间；附件与其他 RPC 共用逻辑上限，没有单独的流式路由。
- **仅支持已安装运行时 IPC**：Host 插件要求已连接的 Node IPC channel；extension launcher 负责进程发现、启动期消息缓冲与 workspace lease 处理。
