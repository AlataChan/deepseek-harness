# dsh 终端客户端实施计划

[English](2026-08-20-dsh-terminal-client.md) | 中文

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标：** 让裸 `dsh` 命令成为第一方进程内交互式终端客户端，支持持久化恢复、安全转录渲染、工具、命令、审批、用户问题、取消与跨平台生命周期。

**架构：** 新的 `dsh-tui-app` profile bundle 直接在 `dsh-base` 上挂载仅 Node 使用的 `dsh-tui` Cordis 插件。一个不依赖框架的 reducer/store 拥有全部产品状态；Cordis adapter 把 Agent 与 Session 活动转换为 action；Ink 7 与包内 React 19.2 把已完成行写入普通 scrollback，并且只让实时状态留在重绘区域。实现不组合 Host RPC、HTTP、WebSocket、浏览器 Client package 或 Tauri。

**技术栈：** TypeScript ESM、vendored Cordis、Ink 7.x、React 19.2+、Commander 15、Vitest、Schemastery、Loader composition test、确定性 TTY stream，以及仓库的 LLM replay snapshot harness。

---

## 范围与执行规则

设计权威是 `.agents/notes/proposed/feature/2026-08-20-dsh-terminal-client.md` 中的拟议 Agent Note。如果实施暴露出产品或架构变化，必须先更新并重新评审该 Note，再改变本计划方向。

按照用户要求，在可见 feature branch 或当前工作分支执行，不在隐藏 worktree 中实施。保留无关用户文件。每个行为任务都使用测试驱动开发：增加一个失败的聚焦测试，运行并观察预期失败，实现最小行为，重新运行聚焦测试，然后提交该任务。

这 13 个任务 commit 设计为通过一个 PR 或一个经过评审的 stack 落地，其最终 diff 包含 Agent Note。如果工作拆成独立合并的多个 PR，每个非平凡 PR 都必须新增或更新一个适用的 Agent Note；不能把全部决策文档推迟到任务 13。本 contributor 执行计划继续接受双语 `docs/**` 检查，但不是产品约定的权威来源。

计划中命名的 `superpowers:*` skill 是执行辅助，不是代码库的先决条件。缺少这些 skill 的执行者仍须逐任务工作，在声称完成前根据新鲜证据验证，并请求最终评审；凡明确命名的 `dsh-pre-push-checks` 等仓库自有 workflow 仍然是强制要求。

本计划不增加 Tauri 代码。桌面阶段只能在任务 13 通过后开始，并且需要自己的 Agent Note，覆盖应用身份、签名、updater channel、sidecar 打包与 WebView 支持。

Ink 7 当前要求 Node 22 与 React 19.2+。锁定一个已验证的当前 7.x 版本，而不是宽泛 major range；在 `packages/ui/tui` 中使用兼容的精确 React 19.2 版本；本改动不升级浏览器 Client package 的 React 18。

## 任务 1：锁定命令行产品约定

**文件：**

- 修改：`apps/cli/src/args.ts`
- 修改：`apps/cli/tests/args.spec.ts`

**步骤 1：增加失败的 parser 测试**

增加以下证明：

- `[]` 解析为 `{ mode: 'profile', profile: 'tui', patches: [], args: [] }`。
- `['write', 'the', 'tests']` 把完整位置参数尾部路由到 TUI。
- `['--resume']` 与 `['--resume', 'session-id']` 保持为 TUI 应用参数。
- `['tui', '--resume', 'session-id']` 是显式 TUI 别名。
- `['exec', 'write', 'the', 'tests']` 是 headless 别名。
- `['--', 'web']` 把 `web` 当作 TUI 任务，而 `['web']` 仍然是 Web 别名。
- `--profile`、`--patch`、两个 config dump、`web` 与 `plugin` 保持现有所有权规则。
- 只有完全由 `-h` 或 `--help` 组成的调用才打印 launcher 帮助。
- 一旦存在任务或应用 token，`-h` 与 `--help` 无论顺序如何都向内传递：覆盖 `['write', 'tests', '-h']`、`['-h', 'write', 'tests']`、`['--resume', '--help']`、`['tui', '--help']` 与 `['exec', '--help']`。
- `-V` 与 `--version` 继续由 launcher 拥有，config dump 继续拒绝包括帮助 token 在内的应用参数。

运行：`pnpm vitest run apps/cli/tests/args.spec.ts`

预期：FAIL，因为当前 root action 要求 `--profile`，并且没有 `tui` 或 `exec` 别名。

**步骤 2：实现 launcher grammar**

让 root action 默认选择 `tui` profile。增加小型共享 alias builder，使 `web`、`tui` 与 `exec` 复用 patch/dump 行为且不复制命令定义。把 `exec` 映射到 `headless`。仅把完全独立的帮助调用视为 launcher help；出现第一个任务或应用 token 后，把其余 token 原样交给启动后的应用。launcher flag 保持位于 inner argument 之前。

更新帮助 copy 与示例，列出 `dsh`、`dsh --resume`、`dsh exec`、`dsh web` 与高级 `--profile` 路径。

**步骤 3：运行聚焦测试**

运行：`pnpm vitest run apps/cli/tests/args.spec.ts`

预期：PASS。

**步骤 4：提交**

```sh
git add apps/cli/src/args.ts apps/cli/tests/args.spec.ts
git commit -m "feat(cli): make tui the default dsh surface"
```

## 任务 2：搭建仅 Node 使用的 TUI 包与 UI group

**文件：**

- 新建：`packages/ui/README.md`
- 新建：`packages/ui/README.zh.md`
- 新建：`packages/ui/README.i18n.yaml`
- 新建：`packages/ui/tui/package.json`
- 新建：`packages/ui/tui/tsconfig.json`
- 新建：`packages/ui/tui/tsdown.config.ts`
- 新建：`packages/ui/tui/src/index.ts`
- 新建：`packages/ui/tui/src/invariant.ts`
- 新建：`packages/ui/tui/tests/invariant.spec.ts`
- 修改：`packages/README.md`
- 修改：`packages/README.zh.md`
- 修改：`packages/README.i18n.yaml`
- 修改：`tsconfig.base.json`
- 修改：`tsconfig.host.json`
- 修改：`package.json`
- 修改：`pnpm-lock.yaml`
- 修改：`scripts/verify-package-readme-model-experience.ts`
- 仅当 package 不能直接满足常规 section 时修改：`scripts/verify-package-readme-limitations.ts`

**步骤 1：增加 package registration 测试**

创建 invariant 测试，在真实 Cordis context 中挂载空 package plugin 与 invariant companion。初始预期只验证两个 export 可以 load 与 dispose；后续任务再增加 package-owned 生命周期关系。

运行：`pnpm vitest run packages/ui/tui/tests/invariant.spec.ts`

预期：FAIL，因为 package 还不存在。

**步骤 2：增加 package metadata 与依赖隔离**

把 `@deepseek-ai/dsh-tui` 声明为 ESM，提供 root 与 `./invariant` export。runtime dependency 包含锁定的 Ink 7.x、兼容 React 19.2、`@deepseek-ai/cordis`，以及 `src` 实际导入的 Service Definition package。dev dependency 增加与 React 19 兼容的 `@types/react`。

不要把 TUI source 放进 `tsconfig.client.json`。把项目引用加入 `tsconfig.host.json`。当前 `tsconfig.base.json` 的 invariant path 是按 group 显式枚举的列表，且没有 `ui` 条目，因此只增加 `packages/ui/*/src/invariant.ts`；如果执行前 base 已改成能覆盖该路径的 wildcard，则不要重复增加。仅在 TUI package project 中增加 JSX compiler 设置。

Group README 把 `ui/` 定义为 Node-native presentation package，并列出没有全局 `ctx` key 的 `tui/`。双语更新根 package hierarchy。Package README 包含 `Model Experience` 与 `Known Limitations and Deferred Work` section。

运行 `pnpm install` 更新 lockfile；不要手工编辑 lockfile。

**步骤 3：增加最小 export 并通过测试**

导出 `name = 'tui'`、没有行为的 placeholder `apply()`，以及标准 package invariant identity。此时不要渲染或创建 Agent。

运行：`pnpm vitest run packages/ui/tui/tests/invariant.spec.ts`

预期：PASS。

**步骤 4：验证 React graph 隔离**

运行：`pnpm why react --filter @deepseek-ai/dsh-tui`

预期：TUI 为 Ink 解析 React 19.2+；浏览器 Client package 仍然使用 React 18。

**步骤 5：提交**

```sh
git add packages/ui packages/README.md packages/README.zh.md packages/README.i18n.yaml tsconfig.base.json tsconfig.host.json package.json pnpm-lock.yaml scripts
git commit -m "feat(tui): scaffold the node terminal package"
```

## 任务 3：增加 TUI startup parsing 与 process adapter

**文件：**

- 新建：`packages/bundle/tui-app/package.json`
- 新建：`packages/bundle/tui-app/tsconfig.json`
- 新建：`packages/bundle/tui-app/tsdown.config.ts`
- 新建：`packages/bundle/tui-app/src/startup.ts`
- 新建：`packages/bundle/tui-app/tests/startup.spec.ts`
- 新建：`packages/ui/tui/src/process.ts`
- 修改：`packages/ui/tui/src/index.ts`
- 新建：`packages/ui/tui/tests/config.spec.ts`
- 新建：`packages/ui/tui/tests/process.spec.ts`
- 修改：`tsconfig.base.json`
- 修改：`tsconfig.host.json`

**步骤 1：编写失败的 startup grammar 测试**

测试 `parseTuiStartupArgs()` 的空 fresh run、合并初始任务、selector resume、精确 id resume、`--help`、未知 flag，以及 resume 与 task 互斥。Result type 是封闭联合：

```ts
import type { SessionId } from '@deepseek-ai/dsh-session'

type TuiStartupValues =
  | { kind: 'fresh'; task?: string }
  | { kind: 'resume-picker' }
  | { kind: 'resume'; sessionId: SessionId }
```

运行：`pnpm vitest run packages/bundle/tui-app/tests/startup.spec.ts`

预期：FAIL，因为 startup provider 不存在。

**步骤 2：实现 startup provider**

遵循 `packages/bundle/headless/src/startup.ts`：只从 `ctx.cmdlineArgs` 解析，发布 `TUI_STARTUP_SERVICE`，让 Commander 拥有应用帮助与 usage error。不要直接读取 `process.argv`。

**步骤 3：编写失败的 process adapter 测试**

测试 production policy 要求 stdin 与 stdout 都具备 TTY 能力，输出包含 `dsh exec` 的提示，以配置提供经过校验的 terminal columns fallback，并让 resize 与 exit subscription 可 dispose。测试 TUI Schemastery `Config` 拒绝无效的 `terminalColumnsFallback`、`resumeTranscriptRows`、`sessionSelectorLimit` 与 `toolOutputDisplayBudget` 值。使用 fake stream；不要增加仅测试环境变量。

运行：`pnpm vitest run packages/ui/tui/tests/config.spec.ts packages/ui/tui/tests/process.spec.ts`

预期：FAIL，因为 adapter 不存在。

**步骤 4：实现 adapter**

建立唯一 `TuiProcess` interface，包含 stream、TTY fact、dimensions、current directory 与 exit request。导出 production constructor 与狭窄 test constructor。在 TUI plugin 的 Schemastery `Config` 上集中声明 `terminalColumnsFallback`、`resumeTranscriptRows`、`sessionSelectorLimit` 与 `toolOutputDisplayBudget`；把已经校验的 column fallback 传给没有隐藏默认值的 production constructor。所有直接 `process` 访问都留在该 module。不要在这里注册 SIGINT 或 SIGTERM；共享 profile launcher 已经拥有进程级 signal。

**步骤 5：运行聚焦测试并提交**

运行：`pnpm vitest run packages/bundle/tui-app/tests/startup.spec.ts packages/ui/tui/tests/config.spec.ts packages/ui/tui/tests/process.spec.ts`

预期：PASS。

```sh
git add packages/bundle/tui-app packages/ui/tui/src/index.ts packages/ui/tui/src/process.ts packages/ui/tui/tests/config.spec.ts packages/ui/tui/tests/process.spec.ts tsconfig.base.json tsconfig.host.json
git commit -m "feat(tui): define startup and terminal process contracts"
```

## 任务 4：建设不依赖框架的 store 与 editor reducer

**文件：**

- 新建：`packages/ui/tui/src/state/types.ts`
- 新建：`packages/ui/tui/src/state/reducer.ts`
- 新建：`packages/ui/tui/src/state/store.ts`
- 新建：`packages/ui/tui/src/state/selectors.ts`
- 新建：`packages/ui/tui/src/state/editor.ts`
- 新建：`packages/ui/tui/tests/state.spec.ts`
- 新建：`packages/ui/tui/tests/editor.spec.ts`

**步骤 1：编写失败的 state 测试**

覆盖 fresh state、单调 finalized transcript row、一个 live assistant row、overlay 排他、approval/question ownership、resize、runtime failure 与 dispose。为每个 pending interaction 使用本地 minted opaque id，证明 stale settlement action 不能关闭更新的 interaction。

运行：`pnpm vitest run packages/ui/tui/tests/state.spec.ts`

预期：FAIL，因为 state module 不存在。

**步骤 2：实现 reducer 与 store**

本地 action 与 overlay 使用封闭判别联合，并以 `assertNever` 结束 switch。Store 只暴露 `getSnapshot()`、`subscribe()` 与 `dispatch()`。在测试中冻结对 subscriber 暴露的 state，或者通过没有 mutable alias 的方式构造；不要为类型化内部 action 增加 runtime validation。

**步骤 3：编写失败的 editor 测试**

覆盖 Unicode insertion、carriage-return submit、line-feed newline、left/right/home/end、backspace/delete、multiline paste、history traversal、empty submit 与三阶段 Ctrl+C policy。Terminal input decoding 作为 adapter action；editor 本身消费 semantic key。

运行：`pnpm vitest run packages/ui/tui/tests/editor.spec.ts`

预期：FAIL。

**步骤 4：实现 editor reducer**

让文本与 cursor offset 使用一种表示，并进行 grapheme-aware movement。不要增加 mouse、selection、image 或 full-screen editing state。

**步骤 5：运行聚焦测试并提交**

运行：`pnpm vitest run packages/ui/tui/tests/state.spec.ts packages/ui/tui/tests/editor.spec.ts`

预期：PASS。

```sh
git add packages/ui/tui/src/state packages/ui/tui/tests/state.spec.ts packages/ui/tui/tests/editor.spec.ts
git commit -m "feat(tui): add the framework-free state core"
```

## 任务 5：把持久化 event 投影为终端安全转录

**文件：**

- 新建：`packages/ui/tui/src/transcript/display-text.ts`
- 新建：`packages/ui/tui/src/transcript/project.ts`
- 新建：`packages/ui/tui/src/transcript/markdown.ts`
- 新建：`packages/ui/tui/src/transcript/retention.ts`
- 新建：`packages/ui/tui/tests/display-text.spec.ts`
- 新建：`packages/ui/tui/tests/transcript.spec.ts`
- 新建：`packages/ui/tui/tests/markdown.spec.ts`

**步骤 1：编写失败的终端安全测试**

覆盖 ESC/CSI/OSC、C0/C1 control、bidi control、tab/newline、malformed surrogate input、grapheme-safe truncation 与 byte/column budget。包含如果原样输出就会改变终端标题、创建 hyperlink、清除行或移动 cursor 的字符串。

运行：`pnpm vitest run packages/ui/tui/tests/display-text.spec.ts`

预期：FAIL。

**步骤 2：实现唯一 display sanitizer**

让之后每个 renderer 接受已经消毒的 display value，或者在其 public entry 调用该函数。不要把 ANSI stripping 分散到多个 component。

**步骤 3：编写失败的 event projection 测试**

使用真实 `SessionEvent` value 覆盖 user message、assistant chunk 与 settled message、reasoning、tool call/result pairing、turn status、command lifecycle、retry、error 与未知 merge-extensible event。证明 chunk replacement 不会重复 settled assistant message，并证明 replay 与 live folding 产生相同 finalized row。

**步骤 4：实现 pure projection 与 resume retention**

投影不导入 Cordis 或 Ink。为任务 8 保留工具参数与 result metadata 的结构字段。`resumeTranscriptRows` 只用于选择初始 static output，不从 resumed Agent 丢弃 event。输出一个明确 omission row。

**步骤 5：增加 Markdown 子集**

为 heading、paragraph、list、fenced code、inline code 与 link 编写测试和确定实现。Raw HTML 与不支持构造变成可见文本。不要输出 OSC 8 link。

**步骤 6：运行聚焦测试并提交**

运行：`pnpm vitest run packages/ui/tui/tests/display-text.spec.ts packages/ui/tui/tests/transcript.spec.ts packages/ui/tui/tests/markdown.spec.ts`

预期：PASS。

```sh
git add packages/ui/tui/src/transcript packages/ui/tui/tests/display-text.spec.ts packages/ui/tui/tests/transcript.spec.ts packages/ui/tui/tests/markdown.spec.ts
git commit -m "feat(tui): project safe durable transcripts"
```

## 任务 6：实现 fresh、resume 与 selector 的 runtime ownership

**文件：**

- 新建：`packages/ui/tui/src/driver/controller.ts`
- 新建：`packages/ui/tui/src/driver/session.ts`
- 新建：`packages/ui/tui/src/driver/resume.ts`
- 新建：`packages/ui/tui/tests/controller.spec.ts`
- 新建：`packages/ui/tui/tests/resume.spec.ts`
- 修改：`packages/ui/tui/src/index.ts`

**步骤 1：编写失败的 controller 测试**

挂载真实 `SessionStore`、`AgentRegistry`、command、approval 与 question Service Definition，并使用狭窄 fake Agent factory。验证 Loader settlement 先于 creation，fresh session 使用 cwd 与默认模型，setup 安装 model-selection ref，初始任务只在 publication 后提交，并且其他 Agent 的 scoped event 被忽略。

运行：`pnpm vitest run packages/ui/tui/tests/controller.spec.ts`

预期：FAIL。

**步骤 2：实现单 Agent ownership**

每个已挂载 TUI plugin 创建一个 controller。用一个 lifecycle object 拥有 `AgentHandle`、scoped event listener 与 model-selection ref。使用 `ctx.agents.create()` 和 `ctx.agents.resume()`；不要直接实例化 loop 或 Session。Resume selection 先从最新 logged request header 推导，缺失时再回退到 `ctx.agentDefaultModel.currentSelection()`。

**步骤 3：编写失败的 selector 测试**

验证 `ctx.sessionQuery.listSessions()` 的 newest-first row、配置化 `sessionSelectorLimit`、一次 batched `readTitleSnapshots()`、单标题失败回退、空语料、精确 id 不存在、selector cancellation 与 collision error。

**步骤 4：实现 selection 与 resume**

Selector row 保持 immutable state。不要逐个 inspect 无界日志。选中的 id 只有在 selector 关闭后才传给 `ctx.agents.resume()`。

**步骤 5：运行聚焦测试并提交**

运行：`pnpm vitest run packages/ui/tui/tests/controller.spec.ts packages/ui/tui/tests/resume.spec.ts`

预期：PASS。

```sh
git add packages/ui/tui/src/driver packages/ui/tui/src/index.ts packages/ui/tui/tests/controller.spec.ts packages/ui/tui/tests/resume.spec.ts
git commit -m "feat(tui): own fresh and resumed agent sessions"
```

## 任务 7：渲染 inline Ink 应用

**文件：**

- 新建：`packages/ui/tui/src/render/app.tsx`
- 新建：`packages/ui/tui/src/render/transcript.tsx`
- 新建：`packages/ui/tui/src/render/composer.tsx`
- 新建：`packages/ui/tui/src/render/status.tsx`
- 新建：`packages/ui/tui/src/render/overlays.tsx`
- 新建：`packages/ui/tui/src/render/use-store.ts`
- 新建：`packages/ui/tui/src/render/start.tsx`
- 新建：`packages/ui/tui/tests/render.spec.tsx`
- 新建：`packages/ui/tui/tests/static-transcript.spec.tsx`

**步骤 1：编写失败的 render 测试**

使用确定性 stdin/stdout stream 渲染，并断言 welcome line、status、composer、resume selector、error state 与窄 columns compact layout。断言 React 通过 `useSyncExternalStore` 读取，store update 不通过 component-owned copy 也能改变 frame。

运行：`pnpm vitest run packages/ui/tui/tests/render.spec.tsx`

预期：FAIL。

**步骤 2：实现 dynamic shell**

把 production process adapter 显式传给 Ink `render()`。不要使用 alternate-screen escape code。每个 component 都是 store selector 与 event callback 上的纯 view。

**步骤 3：证明 scrollback 行为**

增加测试：finalize 多行，多次更新一个 live assistant row，然后退出。断言每个 finalized row 在 captured output 中出现一次，最终 live row 不会因 Ink remount 重复。使用单调 row key；一个 controller lifecycle 内绝不重置 `Static` identity。

**步骤 4：实现 `Static` 加 redraw region**

通过一个稳定 `Static` list 渲染 finalized row。在其下渲染 live assistant output、status、composer 与 overlay。Resume 时只把 retained initial row 与 omission marker 输入同一个单调序列。

**步骤 5：运行聚焦测试并提交**

运行：`pnpm vitest run packages/ui/tui/tests/render.spec.tsx packages/ui/tui/tests/static-transcript.spec.tsx`

预期：PASS。

```sh
git add packages/ui/tui/src/render packages/ui/tui/tests/render.spec.tsx packages/ui/tui/tests/static-transcript.spec.tsx
git commit -m "feat(tui): render an inline ink transcript"
```

## 任务 8：呈现工具意图但不执行内容

**文件：**

- 新建：`packages/ui/tui/src/render/tool.tsx`
- 新建：`packages/ui/tui/src/render/tool-model.ts`
- 新建：`packages/ui/tui/tests/tool-render.spec.tsx`
- 修改：`packages/ui/tui/src/transcript/project.ts`
- 修改：`packages/ui/tui/src/render/transcript.tsx`

**步骤 1：编写失败的 projection 测试**

注册带 `presentCall` 与 `presentResult` 的真实 tool definition。分别命名 call 侧 `generic`/`terminal`/`diff` union 和 result 侧 `generic`/`terminal`/`diff`/`read`/`search`/`web` union 的 case，包括 search path 与 match 以及 Web source。覆盖缺失 definition、presenter 返回 `undefined`、未来未知 result card、被 tool presenter 拒绝的 malformed replay argument，以及超过显示预算的 terminal output。显式写明 call/result 不对称，使未来 card union 变化在所属 projection 上准确失败。

运行：`pnpm vitest run packages/ui/tui/tests/tool-render.spec.tsx`

预期：FAIL。

**步骤 2：实现 model adapter**

通过 `ctx.tools.get(name, agent)` 解析，并且只调用 pure presentation method。通过持久化 call id 配对 result。绝不调用 `execute`，绝不读取文件，也绝不信任 embedded ANSI。缺失或未知 presentation 使用通用结构化 fallback。

**步骤 3：实现紧凑 card**

显示 terminal command、cwd、有界 output 与 exit status；unified diff hunk；编号 read line；search count 与保留 row；Web source label 与 URL；generic JSON/content。Expansion 与 mouse navigation 延期。

**步骤 4：运行聚焦测试并提交**

运行：`pnpm vitest run packages/ui/tui/tests/tool-render.spec.tsx packages/ui/tui/tests/transcript.spec.ts`

预期：PASS。

```sh
git add packages/ui/tui/src/render/tool.tsx packages/ui/tui/src/render/tool-model.ts packages/ui/tui/src/render/transcript.tsx packages/ui/tui/src/transcript/project.ts packages/ui/tui/tests/tool-render.spec.tsx
git commit -m "feat(tui): render tool-owned terminal cards"
```

## 任务 9：提供审批与用户问题

**文件：**

- 新建：`packages/ui/tui/src/driver/approval.ts`
- 新建：`packages/ui/tui/src/driver/questions.ts`
- 新建：`packages/ui/tui/src/render/approval.tsx`
- 新建：`packages/ui/tui/src/render/questions.tsx`
- 新建：`packages/ui/tui/tests/approval.spec.tsx`
- 新建：`packages/ui/tui/tests/questions.spec.tsx`
- 修改：`packages/ui/tui/src/driver/controller.ts`
- 修改：`packages/ui/tui/src/render/overlays.tsx`

**步骤 1：编写失败的 approval 测试**

在 open turn 内运行真实 `ApprovalService.request()`。验证 TUI 只认领其准确根 Agent，为其他 Agent 调用 `next()`，显示 tool/call/reason，只在显式 allow 时授权一次，支持显式 reject，在 request abort 时返回 cancelled，并且 shutdown 期间绝不授权。

运行：`pnpm vitest run packages/ui/tui/tests/approval.spec.tsx`

预期：FAIL。

**步骤 2：实现 scoped waterfall answerer**

通过 controller context 注册；request 不属于该 TUI 时始终通过 `next()` 委托。Pending resolver 留在 runtime adapter，其可见 immutable description 留在 store。Settlement 必须 single-shot。

**步骤 3：编写失败的 question 测试**

使用一个与多个 question、option、free-form answer、review intent detail、invalid incomplete answer、abort、controller dispose 与 duplicate-provider error 运行 `ctx.userQuestions.ask()`。验证所有必答项原子结算。

**步骤 4：实现 provider 与 panel**

为 TUI lifecycle 注册一个 provider。复用 service type 与 validation rule；不要发明第二套 question schema。Abort 或 dispose 只关闭与其匹配的 overlay。

**步骤 5：运行聚焦测试并提交**

运行：`pnpm vitest run packages/ui/tui/tests/approval.spec.tsx packages/ui/tui/tests/questions.spec.tsx`

预期：PASS。

```sh
git add packages/ui/tui/src/driver packages/ui/tui/src/render packages/ui/tui/tests/approval.spec.tsx packages/ui/tui/tests/questions.spec.tsx
git commit -m "feat(tui): answer approvals and user questions"
```

## 任务 10：连接命令、输入、取消与有序 shutdown

**文件：**

- 新建：`packages/ui/tui/src/driver/commands.ts`
- 新建：`packages/ui/tui/src/driver/input.ts`
- 新建：`packages/ui/tui/src/driver/shutdown.ts`
- 新建：`packages/ui/tui/tests/commands.spec.ts`
- 新建：`packages/ui/tui/tests/input.spec.ts`
- 新建：`packages/ui/tui/tests/shutdown.spec.ts`
- 修改：`packages/ui/tui/src/driver/controller.ts`
- 修改：`packages/ui/tui/src/render/composer.tsx`
- 修改：`packages/ui/tui/src/index.ts`
- 修改：`packages/ui/tui/src/invariant.ts`
- 修改：`packages/ui/tui/tests/invariant.spec.ts`

**步骤 1：编写失败的 command 测试**

注册真实 command definition，验证已知 slash command 使用准确 Agent 与 abort signal 调用 `ctx.commands.execute()`，command result 通过持久化 event 进入 transcript，`/help` 列出有效 scoped descriptor，turn 或 interaction 期间拒绝 `/resume`，`/exit` 遵循 shutdown，未知 slash 必须确认后才成为 model input。

**步骤 2：实现 command routing**

`/help`、`/resume` 与 `/exit` 保持本地。其他 slash line 先委托 registry。Command error 后保留 draft 与 attachment；本版本不支持 attachment，因此它们不能进入 command execution。

**步骤 3：编写失败的 input 与 shutdown 测试**

通过 input adapter 驱动 Enter、Ctrl+J、Escape、Ctrl+R 与 Ctrl+C state machine。验证 shutdown 顺序：

1. 拒绝新输入；
2. 在不授权的情况下结算 interaction；
3. 取消活跃 Agent work；
4. 等待 `whenIdle()`；
5. flush Session；
6. unmount Ink 并恢复 raw mode；
7. dispose owned effect；
8. 请求 exit。

覆盖 setup failure、正常 `/exit`、stdin closure、活跃工作期间 raw-input Ctrl+C、第二次 raw-input Ctrl+C 在 cancellation drain 期间请求 shutdown、来自 launcher process-signal 路径的 owner-fiber disposal，以及重复 shutdown call 共享一个 Promise。

**步骤 4：实现 lifecycle 并加强 invariant**

使用一个幂等 shutdown coordinator。不要调用 `process.exit`，也不要注册进程 signal。用户拥有的 cleanup 完成后才请求现有 `ctx.appExit`；owner-fiber disposal 运行相同 cleanup，但不再次请求 exit。Invariant 观察 controller/Agent/provider publication 与 disposal event；duplicate live ownership 时失败，无 controller 挂载时保持空 companion。

**步骤 5：运行聚焦测试并提交**

运行：`pnpm vitest run packages/ui/tui/tests/commands.spec.ts packages/ui/tui/tests/input.spec.ts packages/ui/tui/tests/shutdown.spec.ts packages/ui/tui/tests/invariant.spec.ts`

预期：PASS。

```sh
git add packages/ui/tui
git commit -m "feat(tui): complete interactive input and shutdown"
```

## 任务 11：组合并注册已发布 TUI profile

**文件：**

- 新建：`packages/bundle/tui-app/README.md`
- 新建：`packages/bundle/tui-app/README.zh.md`
- 新建：`packages/bundle/tui-app/README.i18n.yaml`
- 新建：`packages/bundle/tui-app/cordis.patch.yml`
- 新建：`packages/bundle/tui-app/src/index.ts`
- 新建：`packages/bundle/tui-app/src/invariant.ts`
- 新建：`packages/bundle/tui-app/tests/tui-app.spec.ts`
- 修改：`packages/bundle/README.md`
- 修改：`packages/bundle/README.zh.md`
- 修改：`packages/bundle/README.i18n.yaml`
- 修改：`packages/boot/app-boot/src/profile.ts`
- 修改：`packages/boot/app-boot/tests/profile.spec.ts`
- 修改：`apps/cli/package.json`
- 修改：`tsconfig.base.json`
- 修改：`tsconfig.host.json`
- 修改：`pnpm-lock.yaml`

**步骤 1：编写失败的 composition equivalence 测试**

断言 `PROFILE_TEMPLATES.tui` 精确等于 `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-tui-app']`。通过真实 Loader 组合两份 patch list，并断言产品预期的有序有效 row 与 config：

- base service 保持存在；
- `hmr` disabled；
- TUI persona 与 tools mode 覆盖 base value；
- code runtime、`tui-startup`、`tui` 与两个 invariant row 存在；
- 不存在 `api-gateway`、Host server、client modules、Web runtime、VS Code carrier 或 network listener row。

另以旧 base-only tuple 初始化一个已有 `tui` profile，加载它，并断言其被规范化为已发布 TUI template。证明带任意用户新增 bundle 的 tuple 保持不变。

运行：`pnpm vitest run packages/boot/app-boot/tests/profile.spec.ts packages/bundle/tui-app/tests/tui-app.spec.ts`

预期：FAIL。

**步骤 2：实现 bundle patch 与 registration**

让 startup value 通过 lazy row config 传递；TUI row 不读取 global argv。把 package 加入 CLI dependency、两个 aggregate/path registration、bundle index 与 shipped template。在 `INSTALLATION_OWNED_PROFILE_TUPLES` 中增加 `tui: ['@deepseek-ai/dsh-base']`，使已发布 TUI 出现前创建的 profile 精确升级一次，同时任何用户修改过的 tuple 继续由用户拥有。运行 `pnpm install` 更新 lockfile。

**步骤 3：增加 package docs 与 invariant**

说明该 bundle 是直接在 base 上运行的 in-process UI，以及它为何不包含 `client-app`。Bundle invariant 检查自有 startup-to-runner 关系，不重复 composition test 已覆盖的固定 row。

**步骤 4：运行聚焦测试并提交**

运行：`pnpm vitest run packages/boot/app-boot/tests/profile.spec.ts packages/bundle/tui-app/tests/tui-app.spec.ts`

预期：PASS。

```sh
git add packages/bundle/tui-app packages/bundle/README.md packages/bundle/README.zh.md packages/bundle/README.i18n.yaml packages/boot/app-boot apps/cli/package.json tsconfig.base.json tsconfig.host.json pnpm-lock.yaml
git commit -m "feat(tui): ship the in-process tui profile"
```

## 任务 12：增加组装转录与跨平台验收

**文件：**

- 新建：`examples/tui-agent/package.json`
- 新建：`examples/tui-agent/README.md`
- 新建：`examples/tui-agent/README.zh.md`
- 新建：`examples/tui-agent/README.i18n.yaml`
- 新建：`examples/tui-agent/cordis.snapshot.yml`
- 新建：`examples/tui-agent/tests/fixtures/terminal-driver.ts`
- 新建：`examples/tui-agent/tests/tui.snapshot.ts`
- 新建：`examples/tui-agent/tests/snapshots/tui-transcript/session.jsonl`
- 新建：`examples/tui-agent/tests/snapshots/tui-transcript/transcript.expected.txt`
- 新建：`examples/tui-agent/tests/snapshots/tui-interactions/session.jsonl`
- 新建：`examples/tui-agent/tests/snapshots/tui-interactions/transcript.expected.txt`
- 新建：`examples/tui-agent/tests/snapshots/tui-lifecycle/session.jsonl`
- 新建：`examples/tui-agent/tests/snapshots/tui-lifecycle/transcript.expected.txt`
- 修改：`examples/README.md`
- 修改：`examples/README.zh.md`
- 修改：`examples/README.i18n.yaml`
- 修改：`examples/package.json`
- 修改：`tsconfig.host.json`
- 修改：`apps/cli/tests/windows-shell.spec.ts`
- 仅当现有 glob 无法发现新测试时修改：`vitest.snapshot.config.ts`

**步骤 1：建设确定性 terminal driver**

提供 TTY-capable in-memory stream、固定 columns、semantic key injection、resize、frame capture、ANSI normalization 与 completion Promise。Driver 导入并挂载真实 TUI package 与 bundle composition；不复制 controller 或 reducer。

先编写聚焦 driver 测试并观察失败，再实现。

**步骤 2：增加三个聚焦的 LLM replay scenario**

使用三个可独立选择的测试，每个测试都通过同一个 driver 挂载真实应用：

- `tui assembled transcript` 覆盖初始位置参数 prompt 提交、assistant streaming 后跟 settled message，以及一个 terminal tool call 与 result。
- `tui assembled interactions` 覆盖一个显式 allow-once approval、一个多项 user question、一个 registered command result，以及持久化 balanced Session output。
- `tui assembled lifecycle` 覆盖一个被取消的 follow-up turn、通过空 draft Ctrl+C 正常退出、raw-mode 恢复，以及 balanced shutdown output。

只规范化 nondeterministic id、timestamp、absolute temp path 与 renderer cursor movement。不要规范化缺失或重复的用户可见 row。保持 replay input 与 expected transcript 相互独立，使一个行为的变化不要求重新录制其他 scenario。

运行：`pnpm run build && pnpm run test:snapshot -- -t "tui assembled"`

记录 expected output 前预期：FAIL，原因是 snapshot 缺失或刻意 mismatch。通过仓库 snapshot workflow 记录，再 keyless 重跑并预期 PASS。

**步骤 3：扩展 Windows 验收**

增加断言：installed launcher 解析 TUI package 的真实 JS entry，不解析 `.cmd` 或 `.ps1` shim，并且只使用 stdin/stdout/stderr。在 Windows test lane 运行确定性 terminal integration，不依赖 Unix signal 或额外 fd。

在可用 host 上运行：`pnpm vitest run apps/cli/tests/windows-shell.spec.ts`

预期：PASS。除非诊断已知 Wine failure，否则不要运行 `check:windows-wine`；平台信号由 CI 拥有。

**步骤 4：提交**

```sh
git add examples/tui-agent examples/README.md examples/README.zh.md examples/README.i18n.yaml examples/package.json tsconfig.host.json apps/cli/tests/windows-shell.spec.ts vitest.snapshot.config.ts
git commit -m "test(tui): add assembled terminal acceptance"
```

## 任务 13：完成文档、覆盖率与发布 gate

**文件：**

- 修改：`AGENTS.md`
- 修改：`README.md`
- 修改：`README.zh.md`
- 修改：`README.i18n.yaml`
- 修改：`docs/development.md`
- 修改：`docs/development.zh.md`
- 修改：`docs/development.i18n.yaml`
- 修改：`docs/architecture.md`
- 修改：`docs/architecture.zh.md`
- 修改：`docs/architecture.i18n.yaml`
- 如果确定性 TTY harness 增加了新测试类别则修改：`docs/testing.md`
- 如需要修改：`docs/testing.zh.md`
- 如需要修改：`docs/testing.i18n.yaml`
- 移动并更新：`.agents/notes/proposed/feature/2026-08-20-dsh-terminal-client.{md,zh.md,i18n.yaml}` 到 `.agents/notes/implemented/feature/`
- Generated catalog 与 module graph 只通过 generator 修改

**步骤 1：更新 current-state 文档**

记录新的默认命令、显式别名、非 TTY 提示、resume 行为、快捷键、配置字段与已知限制。在 root `AGENTS.md` 的 repository-layout tree 中加入新的 `ui/` group；如果其中的命令示例仍然只描述 profile 启动，也一并更新。更新 architecture，加入 Node terminal presentation package 与 direct in-process interaction path。不要把本实施计划粘贴到产品文档。

使用实际实现的 config field name 与 default。记录当前限制：model switching、image attachment、mouse input、alternate-screen mode 与 Tauri desktop 延期。

**步骤 2：有意识地完成逐文件覆盖率**

先运行聚焦 package coverage：

```sh
pnpm vitest run --coverage packages/ui/tui packages/bundle/tui-app
```

为可达 failure arm 增加测试。`/* v8 ignore */` 只用于结构上不可达的 typed exhaustiveness，或 coverage policy 已允许的平台 callback，并提供本地说明。不要为整文件关闭 coverage。

随后运行一次 CI coverage gate，因为每个新的 `packages/*/*/src` 文件都在其范围：

```sh
pnpm run test:coverage
```

预期：逐文件 100% PASS。

**步骤 3：只运行一次相关验证**

运行：

```sh
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run hygiene
pnpm run test:snapshot -- -t "tui assembled"
pnpm run doc-sync
git diff --check
```

预期：全部 PASS。不要只为 commit 重复已经通过的检查。

**步骤 4：提升 Agent Note**

把 status 改为 `implemented`，更新任何已经与实际发布行为不一致的 proposal 文案，一起移动三个双语文件，并重新生成 translation pairing record。Implemented Note 不保留评审历史。

**步骤 5：评审最终 diff 并提交**

运行：

```sh
git status --short
git diff --stat
git diff --check
```

确认没有无关 untracked 用户文件被暂存。

```sh
git add AGENTS.md README.md README.zh.md README.i18n.yaml docs packages examples apps/cli tsconfig.base.json tsconfig.host.json package.json pnpm-lock.yaml .agents/notes
git commit -m "docs(tui): publish the terminal client contract"
```

## 完成交接

Push 前使用 `.agents/skills/dsh-pre-push-checks/SKILL.md`，只选择最终 diff 尚未运行的检查。声称完成前使用 `superpowers:verification-before-completion`。使用 `superpowers:requesting-code-review` 请求 code review，并列出准确执行的命令。

评审通过后报告：

- 最终命令行为；
- 已安装 profile composition；
- 支持的 terminal 与 Windows evidence；
- 关键 shortcut 与 deferred feature；
- 三个 keyless snapshot 位置；
- 被刻意保留、不受影响的 VSIX 工作和根目录 scratch file；
- 下一个获授权设计任务是单独的 Tauri 2 desktop Agent Note，而不是在该 stack 中增加 desktop code。
