# Agent Note: 将 DSH npm 产物投射到操作者自有 scope

Status: proposed

[English](2026-08-22-operator-owned-npm-scope.md) | 中文

## 问题

DSH workspace 的源码包名属于 `@deepseek-ai` npm scope，但发布操作者可能只有另一个组织的发布权限。npm 不允许该操作者发布现有名称，而重命名源码依赖图会为了一个分发问题改变全仓库包身份。

公开 CLI 还依赖完整的 DSH 包依赖图。只发布 `@alatastudio/dsh` 会让其运行时依赖无法通过操作者控制的名称获得。

## 提案

DSH 发布打包器接受显式发布目标。默认目标保留源码包身份；`alatastudio` 目标把每个已打包的 `@deepseek-ai/dsh` 或 `@deepseek-ai/dsh-*` 包投射为对应的 `@alatastudio` 名称，不修改 workspace manifest 或源码 import。

投射作用于正常包生命周期选择出的确切发布内容。它重写包身份、DSH 依赖键和已知 DSH 包名的文本引用，再使用确定性归档元数据创建最终 tarball。包括 `@deepseek-ai/cordis*` 在内的外部包保留原身份。

该目标只适用于 DSH 发布 family。若最终内容仍引用源码 scope 的 DSH 包、映射未知 DSH 名称、改变二进制内容，或生成与 tarball 和发布顺序不一致的身份，打包立即失败。

发布流程继续由产物驱动并与目标无关：发布器从 tarball 读取投射后的身份，保留现有的完整性重试行为，并把预发布版本分配给 `next`。

## 考虑过的替代方案

**重命名 workspace 包。** 这会让 fork 在一个 npm 组织内保持内部一致，但也会把发布授权限制变成全仓库源码分歧，并使合并上游改动产生不必要的成本。

**只在 CLI 包中使用 npm alias。** alias 无法覆盖完整包依赖图中的运行时 import、对等依赖名称、生成的声明、配置引用或动态加载插件。这样的产物可能成功安装，却在启动后失败。

**发布一个自包含 CLI bundle。** harness 通过包身份和文件系统路径加载插件、资源、原生包与配置。单一 bundle 需要另一套打包架构，也会削弱现有逐包验证和重试模型。

## 验收标准

- 源码树继续使用 `@deepseek-ai/dsh*` 包身份。
- `release:pack --family dsh --target alatastudio` 以 `@alatastudio` 名称创建完整 DSH family。
- 投射后的内容不含源码 scope 的 DSH 包引用，并保持外部 `@deepseek-ai` 包不变。
- 干净的 Linux consumer 能安装投射后的 tarball，并成功运行 `dsh --version`。
- 注册表中的 `0.1.1-rc.4` 发布包含全部投射包、设置 `@alatastudio/dsh@next`，并通过干净的注册表安装探测。

## 风险

文本投射可能漏掉包含包名的文件格式，或改写并非包引用的内容。打包器仅编辑 UTF-8 文本，只匹配发布 family 中的包身份，扫描全部最终内容中的残留源码名称，并保持二进制文件逐字节不变。

投射后的依赖图增加了一套发布身份，但没有创建第二套源码命名空间。consumer 必须把 `@alatastudio/*` 视为此 fork 的分发产物，而不是可互换的源码包名。

npm 发布不是原子操作。基于完整性的重试让已经发布且内容一致的产物不会阻塞恢复，但在全部预期包和最终 dist-tag 验证成功前，consumer 不应认为该版本可用。
