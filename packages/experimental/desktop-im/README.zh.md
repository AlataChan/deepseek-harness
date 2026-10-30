---
description: "在桌面设置中配置飞书和钉钉私聊接入。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-im

[English](README.md) | 中文

## 概述

此分支桌面扩展新增“设置 → IM 接入”。飞书和钉钉分别保存配置和启用状态。Host 在当前桌面用户的权限下复用实验性持久接入及 Agent 消息处理服务。桌面载荷清单包含此扩展，渠道在配置并启用前保持关闭。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

打开“设置 → IM 接入”。按渠道卡片的开发者后台说明操作，再填写应用 ID、密钥、组织 ID、授权私聊 ID 和用户 ID。选择已有模型服务商、模型，以及属于当前桌面用户的绝对工作目录。身份字段须与平台事件一致，群聊和其他操作者会被拒绝。

保存设置、测试连接，然后启用渠道。保存修改会停用该渠道，需手动重新启用。密钥留空即可保留已保存的值。连接测试认证官方传输连接，但不接收任务或调用模型，也不验证平台事件订阅和完整消息往返。

连接期间保持桌面应用运行。停用会关闭新消息接入、取消所属 Agent 任务并等待资源释放。已启用状态会在重启后恢复，启动失败会显示错误。现有凭据服务保存密钥，读取配置仅返回密钥是否存在，连接 JSON 不含密钥。

<a id="understand-the-implementation"></a>
## 理解实现

补丁插入 `desktop-im` Host 服务，Client 侧贡献本地化设置页和由应用外层持有的通知。`src/controller.ts` 串行执行配置操作并管理连接生命周期。`im-feishu/desktop` 提供单用户直接组合，复用 SQLite 收发记录、回执、精确操作者绑定及现有 Session 对账，不开放租户 TCP 服务，也不声明跨 UID 隔离。

配置文件位于 `$DSH_HOME/profiles/desktop/im/`，设置目录由一个桌面 Host 独占，各平台分别持有消息数据库；修改授权身份或工作目录会选择独立的消息状态。可在 Host 配置行中设置部署限额、派发间隔及停机期限。损坏配置会保留并在对应渠道报告。扩展打包其 IM 适配器和存储库，稳定应用默认依赖不引入实验包。

### 远程数据

| 类型 | 含义 |
|---|---|
| `ImChannel` | 飞书或钉钉渠道选择 |
| `ConnectionConfig` | 不含密钥的应用、操作者、工作目录和模型配置 |
| `ImSnapshot` | 已保存配置、启用状态、密钥是否存在、连接阶段及脱敏错误类别 |

<a id="model-experience"></a>
## 模型体验

通过 [IM 消息服务](../im-feishu/README.zh.md) 间接影响模型，人类提示准入和模型请求由该服务负责。

#### KV 缓存影响

设置操作本身不影响缓存，请求 token 与缓存复用由 IM 消息服务及所选 Agent preset 负责。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 这是单用户桌面连接，不是 Linux systemd 多租户部署。身份 ID 当前从平台开发者后台获取。首版每个渠道支持一个授权私聊及用户组合，不安装 IM 审批或卡片回答器，现有工具审批策略继续生效。真实飞书和钉钉应用权限、订阅及端到端回复需通过获授权的测试应用验证，模拟传输测试不能证明这些结果。

<a id="dev-note"></a>
### 开发备注

现有 [IM 服务](../im-feishu/README.zh.md) 负责消息语义。安装验收拒绝引用绝对文件路径的模块导入，包括 Windows 构建路径。[桌面设置设计](../../../.plans/feature-expansion-2026-10-24/desktop-im-settings-design.md) 记录本地执行模型。
