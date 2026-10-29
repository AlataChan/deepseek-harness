# 两份方案完成情况与后续验收

更新日期：2026-10-29。本文统一说明当前完成范围；具体测试证据分别由[扩展验收记录](expansion-completion.md)和[TUI 独立验收记录](codex-tui-acceptance.md)维护。历史评审报告保留当时结论，不作为当前状态。

## 当前结论

| 方案 | 实现与独立评审 | 已验证环境 | 尚未完成的验收 |
| --- | --- | --- | --- |
| [扩展能力：IM、租户隔离、远程 Worker](dsh_feature_expansion_architecture_plan.md) | 本地实现及评审通过；飞书、钉钉、持久化、交互、租户 IPC 和 SSH 组合已落地 | macOS 源码/安装产物检查；独立可丢弃 Linux 容器中的 systemd、UID 隔离和真实 SSH 测试 | 真实飞书/钉钉测试应用与授权操作者、生产 Linux 部署、指定物理两主机 SSH、GitHub CI 执行及发布 |
| [交互式终端 TUI](dsh_tui_implementation_plan.md) | T0–T6 本地范围实现及独立评审通过；内置 tui profile、会话/模型、输入/呈现、问题/审批、终端复原已落地 | macOS 原生 PTY、独立安装闭包、真实 Node PTC、keyless Session replay | Linux 原生 PTY、Windows ConPTY、跨平台 CI、真实 provider 与生产发布 |

两份方案均不再是“仅有设计”或“只完成一个阶段”。通过的是上述明确环境内的本地验收，不是全平台或生产发布批准。扩展能力的 Linux 容器通过不能替代 TUI 的 Linux 原生 PTY 验收。

## 实现与证据

扩展能力保留 kind=user 的人类消息语义，使用 storage-domain/storage-sqlite 保存业务状态，通过受保护 Unix socket 和独立运行时隔离租户，复用 subagent-acp 与现有 SSH provider。严格禁止任意 TCP 转发的部署使用强制命令 Path B；Path A 的功能通过不代表同等安全限制。已验证的 Linux 租户矩阵为十组，SSH 为九个 Path A 功能案例及五组严格 Path B 控制；完整证据和边界见[扩展验收记录](expansion-completion.md)。

TUI 已位于 packages/tui/tui 与 packages/bundle/tui，使用 dsh profile 启动，不进入 DMG/EXE 默认插件组合。独立复现包括完整 87 项 TUI 测试、后续受影响安装/组合测试 11 项、最终 snapshot/corpus 六项、严格源码与测试类型检查、lint 和产品隔离门禁；这些测试选择存在重叠，不累加为独立用例总数。独立安装闭包验证了原生与 PTC 写入的拒绝/允许、事件顺序、多轮和恢复；最终 snapshot 在持久化 assistant/message 与 turn/end 后退出。见[TUI 验收记录](codex-tui-acceptance.md)。

TUI 的晋升早于完整验收，随后通过独立安装闭包中的显式 staging profile 补充等价性验证；不能描述为历史上严格先完成 T5 再晋升。普通无终端 owner 的 HUP 行为保持原状；显式 DSH_DETACHED=1 提供后台模式，终端 owner 的恢复和退出仍优先。不能承诺所有 Node/终端环境下 plain nohup 均透明存活。

## 后续执行顺序

1. 在 Linux 和 Windows runner 分别运行新构建的安装产物；使用私有 HOME/DSH_HOME、keyless 模型及真实 PTY/ConPTY，禁止从 checkout 回退解析产品代码。
2. Linux 验证 Unicode 编辑、问题/原生与 PTC 审批、多轮/恢复、跨进程 writer 锁、信号与异常终端复原、失败子进程清理。
3. Windows 验证相同产品能力及 ConPTY 复原、取消、进程清理和持久恢复；POSIX 专项明确标注不适用，不能用跳过所有交互测试获得 Windows 通过。
4. 独立审阅 CI 日志和产物，修复失败直至目标平台验收通过，再更新平台支持声明。
5. 另外安排有明确账号、主机和预算的真实 IM/SSH 验收；生产发布与打包单独执行。

macOS 主机可触发并检查远端 CI，也可运行 Linux 虚拟机或容器；本机 macOS PTY 结果不能证明 Linux 原生 PTY 或 Windows ConPTY。本文未启动工作流或外部平台调用。

## 工作区与发布状态

所有工作使用现有工作树，未创建新 worktree。此次修复前保存了 62 个已有 tracked 修改的原始内容与哈希；只改动明确授权的修复文件和状态说明，其他既有改动保持不变。AGY 任务已结算并在确认消息前释放；外部终端保留为空闲状态，没有待处理的 worker 清理决定。未执行合并、提交、推送、CI dispatch 或生产发布。

## 本次文档核对结果

本地合并阻塞已修复。最终完整 `pnpm run doc-sync` 为 42 项通过、零失败或跳过；`pnpm run hygiene` 为 16 项通过、零失败或跳过。IM 的十二个签名类型已有真实文档归属，两项服务已有生成参考，派生目录、双语配对、旧示例、引用和包发布载荷均通过检查。独立重跑的 IM 会话提供方测试七项及目录分区测试十二项通过；不同选择的测试数量不累加。完整命令、日志和打包导入验证见[本地修复记录](local-merge-repairs.md)。

旧设计原文和核实为生成文件的未跟踪源码目录产物均保留在带哈希的归档中；没有通过关闭运行时检查或只改配对记录来隐藏失败。之前 28/42、38/42、41/42 的文档结果由最终通过结果替代，不再是当前待办。

用户明确暂缓 Linux 原生 TUI PTY 和 Windows ConPTY 验收；这两项仍为未验证，不能写为通过。本地合并检查通过不代表跨平台、真实外部账号或生产发布批准。
