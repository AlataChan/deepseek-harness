---
description: "常驻助手与智能体团队花名册、作用域模型路由与生命周期管理。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-assistant-registry

[English](README.md) | 中文

## 概述

`assistant-registry` 是实验性叠加层包，提供常驻助手档案、已保存团队定义、私密会话绑定、作用域模型路由优先级执行以及角色系统提示词段落注入。

## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

## Stage C 执行与辅助调用记录

轮次从空闲 Agent 开始，独占完整执行区间。取消席位时只移除该席位自己的输入，保留其他输入，中止执行并等待空闲后释放执行权；席位超时采用相同流程。模型请求限制剩余输出 token，实际输入与输出用量计入累计额度；提供方返回用量前，输入计费可能已超过剩余额度。重启后的未确认执行标记为待确认，不自动重跑；已提交回复在重启后只发布一次。轮次准入身份包含接收席位及解析后的执行限制。

自动记忆审核只在专属会话成功结束一轮后运行，使用该轮有界的用户与助手文本。输入建议从 Host 获取最近已完成轮次的上下文，不使用编辑器修订号。辅助调用的模型请求和结果保存为 `assistant/auxiliary` 会话事件，计费用调用 ID 去重；这些事件不创建会话轮次。包含该事件的新日志需要具有 assistant-registry 事件声明的运行时。

群聊轮次日志、阅读游标和辅助推理计费在档案写入租约下，使用串行、原子替换且同步到磁盘的 JSON 存储。加载时先校验全部记录，再公开内存状态；无效文件保持原样并阻止后续写入。只有持久化成功后，阅读游标才推进，计费记录才可见；重复的辅助调用标识不会重复计费。用量筛选从私密会话及团队历史运行实例解析会话标识，去重共享的会话，并排除各持久化会话从父会话继承的分叉前缀。


团队头像保留可选的本地选择标识，例如 `character:<preset>` 及历史 `icon:<preset>` 字符串；空字符串选择姓名缩写。默认头像由 Client 渲染。元数据与模型路由仅在持久化成功后生效；组合席位编辑会先校验模型，已退役席位不可编辑。协调者席位创建后，不允许更换团队协调者档案，以保留现有角色和会话身份。

`getTeamActivity` 仅读取团队当前在线协调者的成员、任务和交互；休眠团队不返回活动，读取不会恢复会话或触发模型调用。 显式执行团队初始化时，会为旧版空成员团队补建原协调者席位，并保留已有协调者会话。

<a id="model-experience"></a>
## Model Experience

Indirectly, through logged session events and injected dynamic system prompt sections.

#### KV Cache effect

重入轮次复用已缓存前缀；更新后的角色段落从下一个请求边界开始生效。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 跨设备目录同步与分布式事务不在 V1 范围内。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

此维护者说明仅供维护者参考，明确不具规范效力。

#### Future directions

未决方向包括跨设备同步、按席位工作区目录以及实时语音。

</details>
