# DeepSeek Harness (DSH) 扩展能力工程实施方案

本文档为 DeepSeek Harness（分支版本 `octopus_DSH`）扩展三大核心能力的工程方案：
1. **国内主流 IM 聚合总线（含个人微信、企业微信、飞书、钉钉免公网长连接接入）**
2. **多用户平台与多工作区物理隔离体系**
3. **基于 ACP 协议的跨节点分布式 AgentTeam 编队协同**

---

## 一、 核心架构设计

遵循 DSH 既有的 **微内核 + 全插件（Cordis Plugins）** 与 **能力缝（Capability Seams）** 架构，所有新功能均作为外围插件和驱动提供，**核心 Agent Loop 零改动**。

```
┌────────────────────────────────────────────────────────────────────────┐
│                        外部多端接入 (Ingress)                           │
│   个人微信 (微信客服/Wechaty) │ 企微/飞书/钉钉 (长连接 Stream) │ 移动/远程 Web  │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    @deepseek-ai/dsh-gateway-im                         │
│   • 免公网长连接管理 (WebSocket / Stream, No Public IP Needed)           │
│   • 用户与群聊映射 (ChatID / OpenID ↔ DSH SessionID)                    │
│   • 流式富文本与动态卡片回包 (Interactive Streaming Cards)               │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   @deepseek-ai/dsh-multiuser                           │
│   • JWT 认证与鉴权中间件 (Bearer Token / RBAC: Admin vs User)          │
│   • 物理工作区隔离 (~/.dsh/users/{userId}/sessions, workspaces, keys)   │
│   • 独立配额与 API Key 凭据管理                                        │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│              DSH 核心智能体底座 (Harness Core & Presets)                │
│   • 严格三明治提示词组装 (dsh-context Prefix / Suffix)                  │
│   • PTC 编程式工具调用 / 事件溯源不可篡改留痕                           │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│              @deepseek-ai/dsh-subagent-remote (跨节点编队)             │
│   • 基于 ACP (JSON-RPC over WSS) 的远程 Worker 挂载                    │
│   • 桌面端 Agent Team 协同 Pod 拓扑图与实时通信光点可视化               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 二、 模块一：`@deepseek-ai/dsh-gateway-im`（多 IM 聚合网关）

### 1. 渠道支持矩阵与技术选型

| 渠道 | 接入协议 | 是否需要公网 IP | 账号封禁风险 | 推荐适用场景 |
| :--- | :--- | :---: | :---: | :--- |
| **个人微信（官方正规）** | 微信客服 API (WeChat Customer Service) / 企微互通 | **否**（长轮询/长连接） | **0 风险（官方白名单）** | **最推荐**：用户用自己的普通微信扫码，直接在个人微信里与 AI 对话。 |
| **个人微信（开源 Web）** | Wechaty (UOS 桌面网页协议) | **否** | **高风险（极易受限）** | 仅限临时小号测试体验，不作为生产推荐。 |
| **飞书 (Feishu)** | 官方 `@larksuiteoapi/node-sdk` (WSClient) | **否** (WebSocket) | 0 风险 | 团队/企业办公、富文本卡片交互、文档协作。 |
| **钉钉 (DingTalk)** | 官方 `dingtalk-stream` | **否** (Stream WebSocket) | 0 风险 | 团队办公、流式卡片更新、企业内网部署。 |
| **企业微信 (WeCom)** | 内部应用 / 自建应用 Stream | **否** | 0 风险 | 企业内协同、群聊机器人。 |

### 2. 核心工作流
1. 网关建立长连接（飞书 WS、钉钉 Stream、微信客服轮询），监听接收用户文本、语音、图片。
2. 提取 `user_id` 与 `chat_id`，映射至绑定的 DSH 会话（支持多轮对话上下文持久化）。
3. 调用 DSH 会话驱动：`session.createTurn(prompt)`。
4. 捕获模型流式输出与工具调用事件（`turn/delta`, `tool/start`），通过 IM 的**富文本/交互式卡片（Interactive Cards）**原地更新进度。

---

## 三、 模块二：`@deepseek-ai/dsh-multiuser`（多用户与租户隔离体系）

### 1. 架构设计
- **无状态接入层**：在 `packages/api` 引入 JWT 鉴权中间件。客户端请求携带 `Authorization: Bearer <token>`。
- **RBAC 角色划分**：
  - `Admin`（管理员）：具备插件热插拔、配置修改、全局审计权限；
  - `User`（普通用户）：仅能访问自身名下的会话、工具与工作区。

### 2. 物理存储分层规范
每一个用户在宿主机文件系统中完全物理隔离，互不串扰：
```
$DSH_HOME/users/{userId}/
├── credentials.json       # 该用户独立的 API 密钥（如私人 DeepSeek Key）
├── preferences.json       # 用户的 UI/系统偏好（如三明治铁律前缀后缀）
├── workspaces/            # 用户的独立工作区实体与代码目录
│   └── default/
└── data/
    └── sessions.db        # 该用户专有的 SQLite 会话记录与向量记忆
```

---

## 四、 模块三：`@deepseek-ai/dsh-subagent-remote`（跨节点分布式编队）

### 1. 协议选型：基于现有的 ACP（Agent Client Protocol）
DSH 原生支持 ACP 协议（JSON-RPC 2.0）。因此，我们不需要发明新的 RPC 协议：
- **Coordinator（协调节点）**：如本机的 `octopus_DSH` 桌面客户端；
- **Worker（工作节点）**：远端 Linux GPU 服务器、家庭私有 NAS 或云服务器上运行的 `dsh --profile acp`。

### 2. 调度与可视化联动
1. 协调节点通过 WebSocket 握手挂载远程节点的 ACP 端点，将其声明为一个特化子代理（如 `remote-gpu-analyst`）；
2. 主 Agent 决定派发子任务时，`RemoteAcpSubagentDriver` 负责打包上下文并发送请求；
3. 远程执行产生的 Token、日志、工具结果流式回传，直接点亮本地桌面端的 **Agent Team 协同 Pod（右侧拓扑图与跳动通信光点）**。

---

## 五、 项目建议补充：`dsh-tui`（交互式终端 UI）

- **与当前 CLI 的定位差异**：
  - 现有的 `apps/cli` 是 **Command Runner（启动器/单次任务批处理）**；
  - 建议的 `dsh-tui`（对应官方预留的 `dsh --profile tui`）是 **Interactive Terminal UI（沉浸式交互终端）**，利用 React Ink 在字符终端内提供多轮打字机流式渲染、工具抽屉折叠、键盘命令补全，满足纯终端极客需求。

---

## 六、 阶段落地推进计划

| 阶段 | 交付物 | 关键验收指标 |
| :--- | :--- | :--- |
| **Phase 1** | `@deepseek-ai/dsh-gateway-im` | 飞书/钉钉 WebSocket 免公网启动，能在群里/私聊中流式与 DSH 对话。 |
| **Phase 2** | 个人微信正规接入（微信客服） | 支持手机端普通微信直接扫码发起会话，0 封号风险，多轮会话正常。 |
| **Phase 3** | `@deepseek-ai/dsh-multiuser` | 租户物理隔离上线，多用户各自拥有独立的 Key、工作区与会话历史。 |
| **Phase 4** | `@deepseek-ai/dsh-subagent-remote` | 跨机器 ACP 互联，两台 DSH 协同完成复杂长任务，并在桌面端 Pod 渲染拓扑。 |
