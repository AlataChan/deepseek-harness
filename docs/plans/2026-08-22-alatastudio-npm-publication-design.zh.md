# AlataStudio npm 发布设计

[English](2026-08-22-alatastudio-npm-publication-design.md) | 中文

[操作者自有 npm scope 决策](../../.agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.zh.md)负责记录决策和替代方案。本文定义把 DSH family 发布为 `@alatastudio/*`，同时保留上游源码命名空间的实现设计。

## 目标与限制

- 把完整 DSH 发布 family 发布为 `@alatastudio/dsh` 和 `@alatastudio/dsh-*`。
- 保持可执行命令名为 `dsh`，源码包依赖图继续使用 `@deepseek-ai/dsh*`。
- 保持 `@deepseek-ai/cordis*` 等外部官方依赖不变。
- 复用现有 family 排序、完整性感知发布、dist-tag 选择和打包安装验证。
- 以 `0.1.1-rc.4` 发布投射后的 family；现有 `dsh-v0.1.1-rc.3` 标签保持不变。

## 发布目标模型

发布脚本拥有一个封闭的发布目标定义。`official` 是默认值，并保留全部现有身份。`alatastudio` 仅对 `dsh` family 有效，并通过完整 DSH family 清单映射每个成员。

目标定义提供投射后的成员名称、安装入口包和命名空间验证策略。tarball 发布器不接收目标参数：它继续信任从已验证产物中读取的身份。

## 打包数据流

1. 使用现有 family 依赖图发现并排序源码 DSH family。
2. 在任务专用暂存目录中运行正常的包打包生命周期，使源码 manifest 继续选择权威发布内容。
3. 解开暂存 tarball，投射其包 manifest 和 UTF-8 文本文件，并保持二进制文件逐字节不变。
4. 拒绝未知 DSH 包引用和任何残留的 `@deepseek-ai/dsh` 包引用。
5. 使用稳定条目顺序和规范化归档元数据重新打包投射后的内容，再验证其文件和投射后身份。
6. 使用投射后的名称写入最终 tarball 和 `publish-order.txt`。

临时路径绝不会成为发布输出。任何成员失败时，都删除其未完成的最终 tarball，也不会留下可能授权发布的 publish-order 条目。

## 投射规则

| 输入 | 投射输出 |
|---|---|
| `@deepseek-ai/dsh` | `@alatastudio/dsh` |
| 已知 `@deepseek-ai/dsh-*` family 成员 | `@alatastudio` 下具有相同后缀的名称 |
| 已知 DSH 包的 subpath | 投射后的包名和相同 subpath |
| `@deepseek-ai/cordis*` 或其他外部包 | 不变 |
| 二进制内容 | 不变 |

包清单而不是自由形式的 scope 替换负责授权映射。JSON manifest 以结构化方式重写；其他 UTF-8 内容按照包名从长到短匹配已知名称，避免包名前缀局部重写相邻包名。

## 验证与失败行为

命令会拒绝未知目标、DSH family 以外的 `alatastudio` 目标、投射后的名称冲突、无法识别的源码 scope DSH 引用、残留的源码 scope DSH 引用、发生变化的二进制文件，以及 manifest 身份、tarball 文件名与发布顺序之间的任何不一致。

单元覆盖固定目标解析、名称和 subpath 投射、外部包保留、最长名称匹配、残留检测，以及无效目标与 family 组合。打包集成 fixture 通过真实 tarball 证明 manifest 依赖键、JavaScript import、声明、配置引用、二进制保留、最终身份和发布顺序。

## 发布验证

发布序列把 DSH family 升级到 `0.1.1-rc.4`，构建官方源码依赖图，运行聚焦发布测试和文档检查，再使用 `--target alatastudio` 打包全部 DSH 成员。现有官方 vendor 和 Landlock tarball 仍是有效输入，因为它们的包身份不会被投射。

干净 Linux 环境仅安装本地 tarball，并验证已安装的 `@alatastudio/dsh` 报告 `0.1.1-rc.4`。注册表预检验证已认证 npm 身份、目标组织的写权限、目标版本不存在，以及凭据能够满足账户发布时的双因素认证策略。

发布后，发布验证器检查每个预期注册表身份和产物完整性，确认 `@alatastudio/dsh@next` 解析到 `0.1.1-rc.4`，并在另一个干净环境中从注册表安装 CLI。只有全部检查通过，且 `dsh-v0.1.1-rc.4` 在操作者 fork 上指向已发布的源码提交时，本次发布才算完成。

## 范围外事项

本工作不重命名源码包，不在 `@alatastudio` 下重新发布 vendored Cordis 或 Landlock 包，不增加兼容 alias，不修改运行时插件解析，也不改变 `dsh` 可执行命令名。
