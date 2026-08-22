# AlataStudio npm 发布实施计划

[English](2026-08-22-alatastudio-npm-publication.md) | 中文

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标：** 在不重命名源码包依赖图的前提下，以 `0.1.1-rc.4` 把完整 DSH 包 family 发布为 `@alatastudio/*`，并保持安装后的可执行命令名为 `dsh`。

**架构：** 发布打包器解析一个封闭的发布目标，在隔离的暂存目录中创建正常源码 tarball，只投射 manifest 和 UTF-8 内容中的已知 DSH 包身份，再重新打包投射后的文件。发布器继续与目标无关，因为最终 tarball 和 `publish-order.txt` 已携带完整注册表身份。

**技术栈：** TypeScript ESM、Node 文件系统与子进程 API、pnpm pack、系统 tar、Vitest、npm 注册表 CLI，以及现有 release-family 脚本。

---

## 范围与执行规则

已批准的[设计](2026-08-22-alatastudio-npm-publication-design.zh.md)和[已实现 Agent Note](../../.agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.zh.md)负责记录方向和理由。如果实现需要重命名源码包、重新发布 Cordis 或修改运行时 loader，请停止执行并先修改设计。

在当前 checkout 上创建可见的 `release/dsh-0.1.1-rc.4` 分支并执行。保留现有的用户未跟踪文件和目录。任务 1 至任务 4 使用测试驱动开发：先观察每个聚焦测试因预期原因失败，实现最小行为，重新运行测试，再提交该任务。

绝不打印、检查、存储或提交 npm 认证 token。npm 命令使用用户现有的本地认证。只有本地产物、Linux 安装、远程分支和注册表预检全部验证成功后，才能开始发布。

## 任务 1：定义发布目标

**文件：**

- 新建：`scripts/release/targets.ts`
- 新建：`scripts/release/targets.spec.ts`
- 修改：`scripts/release/families.ts`
- 修改：`scripts/release/families.spec.ts`

**步骤 1：创建发布分支**

```sh
git switch -c release/dsh-0.1.1-rc.4
```

预期：分支从已批准的设计 commit 开始，无关的未跟踪文件保持不变。

**步骤 2：增加失败的目标测试**

覆盖默认 `official` 目标、显式 `alatastudio` 目标、DSH 根包和带后缀包名、已知包 subpath、目标特定安装入口、未知目标，以及拒绝 vendor family 使用 `alatastudio`。证明 `@deepseek-ai/cordis` 不是可投射的 DSH 身份。

```sh
pnpm vitest run scripts/release/targets.spec.ts scripts/release/families.spec.ts
```

预期：失败，因为目标模型不存在，DSH 安装入口固定为源码包名。

**步骤 3：实现封闭的目标模型**

只把 `official` 和 `alatastudio` 定义为目标标识符。根据 `ReleaseFamily` 及其完整成员清单解析目标，返回投射后的成员身份而不修改原对象，并把安装入口选择移到已解析目标之后。标签前缀、源码成员发现和依赖排序继续使用源码名称。

**步骤 4：运行聚焦测试并提交**

```sh
pnpm vitest run scripts/release/targets.spec.ts scripts/release/families.spec.ts
git add scripts/release/targets.ts scripts/release/targets.spec.ts scripts/release/families.ts scripts/release/families.spec.ts
git commit -m "feat(release): define npm publication targets"
```

预期：测试通过，并生成一个目标模型 commit。

## 任务 2：投射已打包的 DSH 内容

**文件：**

- 新建：`scripts/release/projection.ts`
- 新建：`scripts/release/projection.spec.ts`
- 修改：`scripts/release/tarball.ts`

**步骤 1：增加失败的投射测试**

覆盖 dependency 键和字符串值位置的结构化 manifest 重写、最长已知名称匹配、包 subpath、JavaScript 与声明引用、YAML 配置、保留外部 `@deepseek-ai` 包、未知 DSH 引用、残留源码名称、无效 UTF-8 或含 NUL 的二进制文件，以及不安全归档路径。

使用一个在投射前后计算二进制字节 hash 的 fixture。若投射无法证明结果安全，要求诊断信息指出文件和未解析包。

```sh
pnpm vitest run scripts/release/projection.spec.ts
```

预期：失败，因为内容投射器不存在。

**步骤 2：实现快速失败的投射**

把 `package/package.json` 解析为 JSON，只在对象键和字符串值命名已知 DSH 成员或其 subpath 时进行投射。其他安全 UTF-8 文件按照已知名称从长到短处理。把含 NUL 或无效 UTF-8 的文件视为二进制文件，保留其字节，并扫描全部最终字节中的源码 DSH 前缀，但不随意重写未知名称。

拒绝绝对路径、遍历路径段、逃出 `package/` 的链接、映射冲突、未知 DSH 包名和残留的源码 scope DSH 引用。保留原 tarball 所需的文件 mode 和符号链接目标。

**步骤 3：运行聚焦测试并提交**

```sh
pnpm vitest run scripts/release/projection.spec.ts
git add scripts/release/projection.ts scripts/release/projection.spec.ts scripts/release/tarball.ts
git commit -m "feat(release): project packed dsh identities"
```

预期：测试通过，包括二进制文件逐字节不变的覆盖。

## 任务 3：把投射集成到发布打包流程

**文件：**

- 修改：`scripts/release/pack.ts`
- 新建：`scripts/release/pack.spec.ts`
- 修改：`scripts/release/targets.ts`
- 修改：`scripts/release/tarball.ts`

**步骤 1：增加失败的真实打包集成测试**

创建包含 manifest 依赖、运行时 import、声明、配置和二进制资源的临时双包 DSH fixture。使用 `alatastudio` 调用导出的打包操作，检查真实 tarball，并要求 manifest 身份与内部引用已投射、Cordis 引用不变、二进制字节不变、文件名已投射，以及 `publish-order.txt` 使用投射后的条目。

把同一个 fixture 分别打包到两个目录，并要求最终 tarball hash 相同。增加失败用例，证明系统不会保留未完成的最终 tarball和发布顺序条目。

```sh
pnpm vitest run scripts/release/pack.spec.ts
```

预期：失败，因为 `pack.ts` 没有目标参数或分阶段投射流程。

**步骤 2：实现两阶段打包**

解析 `--target`，默认使用 `official`，并在删除输出目录之前解析目标。对投射成员，在任务专用临时目录中运行正常源码 `pnpm pack`，解开其确切 `package/` 内容，应用投射，再从暂存内容运行第二次打包。确保暂存的已打包 manifest 无法执行源码生命周期脚本。

把文件名加入发布顺序之前，根据投射成员验证最终 tarball 内容和身份。始终删除暂存目录。成员失败时删除不完整的目标 tarball，且只在全部成员成功后写入 `publish-order.txt`。

**步骤 3：运行发布脚本测试并提交**

```sh
pnpm vitest run scripts/release/pack.spec.ts scripts/release/projection.spec.ts scripts/release/targets.spec.ts scripts/release/families.spec.ts
git add scripts/release/pack.ts scripts/release/pack.spec.ts scripts/release/targets.ts scripts/release/tarball.ts
git commit -m "feat(release): pack projected npm artifacts"
```

预期：测试通过，并生成确定性的投射后 tarball。

## 任务 4：驱动投射后的安装入口

**文件：**

- 修改：`scripts/release/verify-packed-install.ts`
- 修改：`scripts/release/verify-packed-install.spec.ts`

**步骤 1：增加失败的安装入口测试**

测试省略 `--target` 时驱动 `@deepseek-ai/dsh`、`--target alatastudio` 时驱动 `@alatastudio/dsh`、投射后的入口缺失时在 npm install 前失败，以及拒绝 vendor 与 `alatastudio` 的组合。

```sh
pnpm vitest run scripts/release/verify-packed-install.spec.ts
```

预期：失败，因为验证器始终读取源码名称的安装入口。

**步骤 2：实现目标感知验证**

增加 `--target` 解析，解析与 pack 相同的目标定义，并选择投射后的安装入口，同时继续根据已打包身份发现全部给定 tarball。不要投射 vendor 或 Landlock tarball，也不要改变 override 构造逻辑。

**步骤 3：运行聚焦测试并提交**

```sh
pnpm vitest run scripts/release/verify-packed-install.spec.ts scripts/release/targets.spec.ts
git add scripts/release/verify-packed-install.ts scripts/release/verify-packed-install.spec.ts
git commit -m "feat(release): verify projected cli installs"
```

预期：测试通过。

## 任务 5：完成发布文档

**文件：**

- 移动：`.agents/notes/proposed/process/2026-08-22-operator-owned-npm-scope.md` 到 `.agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.md`
- 移动：`.agents/notes/proposed/process/2026-08-22-operator-owned-npm-scope.zh.md` 到 `.agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.zh.md`
- 移动：`.agents/notes/proposed/process/2026-08-22-operator-owned-npm-scope.i18n.yaml` 到 `.agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.i18n.yaml`
- 修改：`docs/plans/2026-08-22-alatastudio-npm-publication-design.md`
- 修改：`docs/plans/2026-08-22-alatastudio-npm-publication-design.zh.md`
- 修改：`docs/plans/2026-08-22-alatastudio-npm-publication.md`
- 修改：`docs/plans/2026-08-22-alatastudio-npm-publication.zh.md`

**步骤 1：记录已交付行为**

把 Agent Note triplet 移到 `implemented/process`，把 `Status: proposed` 改为 `Status: implemented`，把 `Proposal` 重写为现在时的 `Decision`，用现在时的后果和验证替换仅适用于提案的验收与风险标题，并保留已记录的替代方案。更新两个计划中指向 implemented 路径的链接。

在负责代码的任务中更新已改脚本的模块 JSDoc 和 CLI 用法字符串；不要在常设文档中重复实现清单。本改动不影响模型或产品 transcript，因此不需要 snapshot。

**步骤 2：重新记录并验证配对**

```sh
pnpm run verify-translation-pairing --write .agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.md docs/plans/2026-08-22-alatastudio-npm-publication-design.md docs/plans/2026-08-22-alatastudio-npm-publication.md
pnpm run verify-agent-note-format
pnpm run verify-translation-pairing .agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.md docs/plans/2026-08-22-alatastudio-npm-publication-design.md docs/plans/2026-08-22-alatastudio-npm-publication.md
git diff --check
```

预期：三组配对一致，Agent Note 格式检查通过。

**步骤 3：提交**

```sh
git add .agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.md .agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.zh.md .agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.i18n.yaml docs/plans/2026-08-22-alatastudio-npm-publication-design.md docs/plans/2026-08-22-alatastudio-npm-publication-design.zh.md docs/plans/2026-08-22-alatastudio-npm-publication-design.i18n.yaml docs/plans/2026-08-22-alatastudio-npm-publication.md docs/plans/2026-08-22-alatastudio-npm-publication.zh.md docs/plans/2026-08-22-alatastudio-npm-publication.i18n.yaml
git add -u .agents/notes/proposed/process
git commit -m "docs(release): record npm projection workflow"
```

预期：拟议 triplet 显示为 rename，且没有暂存无关文件。

## 任务 6：把 DSH family 升级到 rc.4

**文件：**

- 修改：`package.json`
- 修改：`pnpm-lock.yaml`
- 修改：现有 bump 脚本选中的每个 DSH 和 private workspace manifest

**步骤 1：确认已跟踪工作区干净并 dry-run**

```sh
git status --short
pnpm release:dsh 0.1.1-rc.4 --dry-run
```

预期：只显示已知的用户未跟踪路径，dry-run 报告完整共享版本集合且不写入文件。

**步骤 2：运行仓库内置 bump**

```sh
pnpm release:dsh 0.1.1-rc.4
git show --stat --oneline HEAD
pnpm run release:verify --family dsh
```

预期：bump 脚本创建 `release(dsh): 0.1.1-rc.4`，全部 DSH 版本一致，234 个成员的发布顺序可解析。

## 任务 7：构建、打包、安装测试并推送发布分支

**文件：**

- Git 外生成：投射后的 DSH tarball、官方 vendor tarball 和先前已验证的 Landlock tarball

**步骤 1：运行聚焦检查和仓库检查**

```sh
pnpm vitest run scripts/release/targets.spec.ts scripts/release/projection.spec.ts scripts/release/pack.spec.ts scripts/release/families.spec.ts scripts/release/verify-packed-install.spec.ts
pnpm run typecheck
pnpm run lint
pnpm run hygiene
pnpm run doc-sync
git diff --check
```

预期：全部命令通过。提交任何 formatter 或生成文件改动前，先检查其内容。

**步骤 2：构建并打包产物**

```sh
CI=true pnpm run build:official
pnpm run release:pack --family dsh --target alatastudio --out /private/tmp/dsh-release-0.1.1-rc.4/npm-dsh
pnpm run release:pack --family vendor --out /private/tmp/dsh-release-0.1.1-rc.4/npm-vendor
```

预期：DSH 输出包含 234 个投射后 tarball 和一个发布顺序文件；vendor 产物保留官方名称。只有检查已打包身份和 hash 后，才能复用先前验证过的 rc.3 Landlock tarball；如果它们不存在或发生变化，请重新获取已验证的 Linux 产物，不要在 macOS 上伪造平台二进制文件。

**步骤 3：验证本地和 Linux 安装**

```sh
pnpm run release:verify-packed-install --family dsh --target alatastudio --from /private/tmp/dsh-release-0.1.1-rc.4/npm-dsh --from /private/tmp/dsh-release-0.1.1-rc.4/npm-vendor --from /private/tmp/dsh-release-0.1.1-rc.4/npm-landlock
docker run --rm --platform linux/amd64 -v /Users/apple/deepseek-harness:/repo:ro --mount type=tmpfs,destination=/repo/node_modules -v /private/tmp/dsh-release-0.1.1-rc.4:/release:ro -w /repo node:24-bookworm npx -y tsx@4.22.4 scripts/release/verify-packed-install.ts --family dsh --target alatastudio --from /release/npm-dsh --from /release/npm-vendor --from /release/npm-landlock
```

预期：两次探测都报告已安装的 `@alatastudio/dsh` 为 `0.1.1-rc.4`。

**步骤 4：应用 pre-push 工作流并推送**

使用 `dsh-pre-push-checks` 检查相对已验证 fork base 的待推送范围，并复用上面的新鲜检查，不要重复运行。只把发布分支推送到 `fork`，再验证远程 OID。

```sh
git push -u fork release/dsh-0.1.1-rc.4
git rev-parse HEAD refs/remotes/fork/release/dsh-0.1.1-rc.4
```

预期：两个 OID 相同。不要推送到此 npm 账户没有仓库写权限的上游 remote。

## 任务 8：发布、验证、打标签并全局安装

**步骤 1：运行注册表预检且不暴露凭据**

```sh
npm whoami
npm view @alatastudio/dsh@0.1.1-rc.4 version --json
```

预期：`npm whoami` 报告 `alatachan`；首次发布前，版本查询报告 npm 404。确认本地配置的 granular token 对 `alatastudio` 具有 package read/write 权限，并能绕过账户发布时的双因素认证要求。绝不显示 token 值。

**步骤 2：发布已经验证的确切目录**

```sh
pnpm run release:publish --family dsh --from /private/tmp/dsh-release-0.1.1-rc.4/npm-dsh
```

预期：全部 234 个包以已发布或已存在且完整性一致的状态完成。如果 npm 拒绝授权或双因素认证，请停止，不要修改版本或产物；修正本地 npm 认证后继续运行同一命令。

**步骤 3：验证注册表完整性和 dist-tag**

```sh
pnpm run release:publish --family dsh --from /private/tmp/dsh-release-0.1.1-rc.4/npm-dsh
npm view @alatastudio/dsh@0.1.1-rc.4 version
npm view @alatastudio/dsh dist-tags.next
```

预期：第二次发布器运行跳过全部 234 个完整性相同的产物，两个 npm view 都报告 `0.1.1-rc.4`。

**步骤 4：验证干净的注册表安装，再全局安装**

```sh
npm install --prefix /private/tmp/dsh-registry-smoke-0.1.1-rc.4 --no-audit --no-fund @alatastudio/dsh@0.1.1-rc.4
node /private/tmp/dsh-registry-smoke-0.1.1-rc.4/node_modules/@alatastudio/dsh/lib/bin.js --version
npm install -g @alatastudio/dsh@next
dsh --version
```

预期：两次版本探测都报告 `0.1.1-rc.4`，全局 binary 以 `dsh` 解析。

**步骤 5：给已发布 commit 打标签并推送标签**

```sh
git tag dsh-v0.1.1-rc.4 HEAD
git push fork dsh-v0.1.1-rc.4
git ls-remote --tags fork refs/tags/dsh-v0.1.1-rc.4
```

预期：远程标签解析到与已发布分支相同的源码 commit。保持 `dsh-v0.1.1-rc.3` 不变。
