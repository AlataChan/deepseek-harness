# AGENTS.md

DeepSeek Harness is an all-plugin Cordis agent harness. Read [docs/architecture.md](docs/architecture.md) before changing `packages/`; follow [docs/AGENTS.md](docs/AGENTS.md) for documentation.

## Pre-release stance: foundation over blast radius

**Remove at the first tagged release.** Until then, prefer correct foundations to compatibility shims: rename or repackage freely and update every reference. Backends reject old on-disk formats. SQLite uses monotonic `SCHEMA_VERSION`; `dsh-session` keeps `SESSION_FORMAT_VERSION` at `0` with no compatibility promise.

**Application launch.** Only `dsh` profiles launch supported Node apps; package bins, demos, and public SDK argv escapes are forbidden ([rule](docs/architecture.md#application-launch)).

## Repository layout

```
vendor/      Vendored Cordis source — manifest + sync procedure in vendor/README.md
packages/    @deepseek-ai/dsh-<pkg> workspaces at packages/<group>/<pkg>/
  core/        product API spine: session, system-prompt, tools, agent, agent-loop
  api/         Remote BFF assembly and Typert RPC gateway
  typert/      type graph generator, loader, and runtime registry
  llm/         LLM capability: Service Definition/Consumer + DeepSeek providers
  e2b/         E2B POC: sandbox + FS/subprocess adapters
  shell/        bash capability: Service Definition + local/pwsh providers + shell Consumers
  subprocess/  subprocess capability + local process-tree provider + shared Win32 library
  terminal/         persistent sessions
  fs/          filesystem capability + policy
  lsp/         language-server capability
  skill/       skill provider registry + local impl + catalog/loader tool
  web/         web capability: Service Definition + search/fetch providers + tool Consumer
  compaction/     compaction capability + basic provider
  context/     request-context plugins
  subagent/    subagent capability: Service Definition + providers + delegation Consumers
  bundle/      installable dsh --profile patch-layer bundles
  workflow/    workflow capability + worker-thread provider + tool Consumer
  webhook/     webhook ingress
  todo/        todo_write tool
  plan/        plan mode as logged state
  preset/      per-session agent composition from preset cordis.yml files
  guard/       loop-hygiene + tool-timeout plugins
  self-modification/  the agent inspects/mounts its own plugins
  hooks/       Claude Code/Codex hook bridges + wire-protocol library
  session/     durable session data: persistence, projection, titles, telemetry
  identity/    anonymous identity
  settings/    user-settings capability + file provider
  credentials/ credential/authorization capabilities + env/.env provider
  acp/         automation-only Agent Client Protocol server
  interaction/ approval/interaction capabilities, permission, commands, ask-user
  boot/        shared profile/application boot glue
  sdk/         JSON-RPC protocol + TypeScript client/server
  experimental/ private prototypes excluded from official releases
  support/     dev/test infrastructure
  util/        zero-dependency utilities
python/      Python SDK and bundled runtime (see python/README.md)
native/      @deepseek-ai/node-addon-landlock-run source of record (see native/README.md)
.agents/     Agent workflows and Agent Notes (`notes/`)
docs/        architecture, generated catalogs, postmortems, cookbook (see docs/AGENTS.md)
scripts/     repo gates and generators
website/     VitePress projection of selected bilingual docs/ sources
```

Package groups: [packages/README.md](packages/README.md).

## Commands

```sh
pnpm install            # pnpm workspaces, node ^22.19 || >=24
pnpm run clean           # remove build outputs and safe residue from deleted packages
pnpm run test           # unit tests
pnpm run test:coverage  # CI coverage gate: per-file 100% on packages/*/*/src
pnpm run test:e2e       # real-API tests; self-skip without DEEPSEEK_API_KEY
pnpm run test:expected  # owner-local process expectations
pnpm run test:snapshot  # keyless recorded-session replay through shipped profiles; filter: -t <name>
pnpm run test:snapshot:record  # re-record expected outputs (needs key)
pnpm run typecheck
pnpm run lint
pnpm run duplication    # cross-file TypeScript clone detection
pnpm run build          # tsc emits lib/types, tsdown bundles runtime
pnpm run hygiene        # publint + workspace/package/dependency checks + NodeNext consumer check
pnpm run check:windows-wine  # ONLY when diagnosing a known Windows failure (needs wine); CI owns this signal
pnpm run doc-sync       # all documentation gates; leaf list in scripts/run-gates.ts
pnpm run test:docs      # quick documentation checks (no build; doc-quick aggregate)
pnpm run website:build  # VitePress build (doubles as dead-link check)
pnpm dsh --profile headless "task"  # run one task from source (needs DEEPSEEK_API_KEY)
pnpm run demo:ptc -- "task"  # headless PTC mode run (needs key)
```

### Host sandbox failures

If a required `gh`, `pnpm`, build, test, or generator command fails because the sandbox blocks credentials, network, IPC, watching, or nested `sandbox-exec`, retry unchanged with the narrowest host escalation. Require sandbox evidence; never bypass test failures or the product sandbox.

### Run relevant checks locally

Run checks before pushes via [dsh-pre-push-checks](.agents/skills/dsh-pre-push-checks/SKILL.md); report only commands run. After `gh stack sync`, validate immediately; do not merge before checks pass.

- Match evidence to the surface: focused behavior tests, model/user-output snapshots, `doc-sync` for docs, built smokes for published paths, and real-API e2e for providers.
- Never default to the full suite or repeat a passing check for commit or push. CI owns exhaustive coverage and the platform matrix; rehearse all locally only by explicit request, for CI diagnosis, or for an irreducibly repository-wide change.
- `test:coverage`, not `test`, is the CI coverage gate ([why](docs/testing.md)).

## Secrets / .env

Real-API tests and demos read `DEEPSEEK_API_KEY`, optional `DEEPSEEK_BASE_URL`, and root `.env`. cordis.yml allows `!!js` (never `!js`) under plugin `config` and entry `disabled`; other metadata stays literal, so conditional composition also uses overlays ([primer](docs/cordis-primer.md#loader-configuration)). Never commit credentials. CI e2e skips without a key; [testing.md](docs/testing.md) owns key policy.

## Conventions

- Every npm package is `@deepseek-ai/dsh-<name>`; vendored packages are rescoped ([mapping](docs/rescope.md)) and `private: true`. `@deepseek-ai/cordis` is a peerDependency (+ dev) of every harness package.
- ESM everywhere (`"type": "module"`). Use package names across packages and `.ts` in local relative imports. Config subprocesses run built `lib/` under plain Node; source regressions use their declared launcher ([testing policy](docs/testing.md#test-subprocess-launch-modes)). The `dsh` CLI source launch runs through tsx's ESM-only hook (`node --import tsx/esm`); modules it reaches must stay ESM (no CJS-only exports) — Node's native TypeScript modes are unavailable across the engines range ([source-launch contract](.agents/notes/implemented/architecture/2026-07-29-dsh-source-launch-tsx-esm.md)). Raw/Web `cordis.yml` bare plugins must appear in their resolver manifest's `dependencies`; `verify-cordis-config` enforces it.
- **Registrations are effects**: every contribution goes through `ctx.effect()` / `ctx.on()`; a registry's `register()` returns the disposer.
- **Runtime invariants assert owned relationships.** Publish `./invariant` only when independent observations can diverge. Otherwise omit its source and wiring and record why in its README; empty installers and checks of service presence, plugin metadata, effects, or fixed examples are invalid ([package invariant rules](packages/AGENTS.md)).
- **Typed events use declaration merging** and merge-extensible maps. Event JSDoc needs `@mode` and payload `@param`; scoped keys absent from payloads need `@dshScopeScan unsupported`. Public service methods document parameters and non-void returns. `SessionEventMap` members are required-on-read by default — builds that do not know a type refuse the log unless the event carries the envelope's `ignorable: true`; only structural format changes bump `SESSION_FORMAT_VERSION` ([mechanism](.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)).
- **Switch on discriminant tags.** Closed unions end in `assertNever`; merge-extensible unions fall through a documented default.
- **Waterfall listeners MUST call `next()`** to delegate; returning without it short-circuits the chain ([semantics](docs/cordis-primer.md#cordis-waterfall-semantics)).
- **Model-visible ⟺ logged**: anything that reaches a model request must be reconstructable from the session log; a new model-visible input requires a session event.
- **Plugins, not loop changes**: new behavior goes on documented extension points; changing `agent-loop` requires updating docs/architecture.md.
- **A capability seam comprises Service Definition / Service Provider / Consumer roles.** It is complete, never one role; split only when roles evolve independently ([glossary](docs/glossary.md#capability-seam)).
- **Prefer maintained dependencies over hand-rolling** when they genuinely delete owned code and tests ([policy](.agents/notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.md)).
- **Explicit > implicit at package boundaries**: defaulting is an explicit `resolve(request): Spec` step in the owning implementation, never a hidden `?? default` inside `run()` (the `dsh-shell` request/spec split is the template).
- **No hardcoded tunables in plugins**: deployment-varying choices are validated `Config` fields changeable from cordis.yml; a `DEFAULT_*` constant or test hook is not configurability. Protocol constants, external specs, and security invariants stay fixed.
- **Misconfiguration fails loud** at load when self-contained, otherwise at the earliest resolvable point; never silently skip a missing referent.
- **Opaque cross-boundary ids are branded** (`Branded<B>` from `dsh-brand`), never bare `string`.
- **Trust TypeScript at typed same-process boundaries.** Do not add runtime validation, fallback behavior, or hostile-input tests solely for values the static interface requires; validate at parser/config, queued, model/tool JSON, durable/file, worker, process, and wire boundaries.
- **Source plane vs artifact plane, never mixed.** Static gates and tests resolve workspace imports through tsconfig `paths` to `src` and pass on a clean tree; gates consuming built `lib/` declare that dependency ([layout](docs/development.md#typescript-project-layout)).
- **Keep compiler faces explicit.** A package with both Host and Client programs exposes face-specific leaf configs and a solution-only root; repo-wide programs seed a face config, never the root solution ([layout](docs/development.md#typescript-project-layout)).
- **An empty `catch` names what it swallows** and why nothing else can reach it; keep the `try` to one statement.
- **Keep comments local.** Do not restate code, explain distant behavior unless locally required, or expand unrelated comments ([rationale](.agents/notes/implemented/process/2026-08-09-concrete-prose-names-actors-and-recorded-facts.md)).
- **Prefer symmetry for parallel values**; unexplained asymmetry usually signals a missed extraction.
- **Tests describe behavior, not correctness.** Change obsolete behavior with its tests; explain why in the PR.
- **Non-trivial changes MUST include an Agent Note in the same PR;** only mechanical/local edits are exempt ([scope](.agents/notes/README.md#when-to-write-one)). Archived notes are frozen: never edit or treat them as current authority ([archive policy](.agents/notes/README.md#archiving-and-deletion)).
- **Client UI copy is locale-owned.** Route product text through typed dictionaries and `t` or localized primitive props; `verify-client-ui-i18n` rejects hardcoded copy ([decision](.agents/notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md)).
- **Testing policy** — [docs/testing.md](docs/testing.md). Every non-trivial model- or product-user-visible change updates a keyless recorded-session snapshot; [snapshot ownership](snapshots/AGENTS.md) reserves the top-level tree for session-driven cases and keeps other expected output owner-local. Fixtures replay on macOS/Linux; fix fixtures, not normalizers.
- **Design each tool's UI presentation up front.** Host presenters stay pure; Web cards derive from raw events and persisted result metadata ([cookbook](docs/cookbook/adding-a-tool.md)).
- **Plan unit, e2e, and snapshot coverage** for capability seams, lifecycle paths, and transcript output; include missing snapshot-harness support in the same change.
- **Both SDKs project the loop.** Agent-loop, session-lifecycle, and `SessionEventMap` changes update the TypeScript and Python SDK expected outputs in the same PR; `pnpm run test` covers neither ([surfaces](docs/testing.md#when-a-snapshot-test-is-required)).
- **Choose PR history deliberately.** Split independent changes and fix the introducing PR before propagation. Standalone/stack branches may merge-forward or rebase. Rewrites use `--force-with-lease`, abort on remote movement, never raw `--force`; preserve an in-progress merge-forward checkpoint before taking a newer base ([rationale](.agents/notes/implemented/process/2026-08-02-native-github-stacks-and-optional-rebases.md)).
- **Labels:** one PR `kind/*`, all material `area/*`, and native Issue Type ([taxonomy](.agents/notes/implemented/process/2026-08-08-unified-github-label-taxonomy.md)).
- TODO markers: `FIXME`/`TODO`/`XXX` by urgency ([semantics](docs/development.md)).
- Files end with exactly one trailing newline; `git diff --cached --check` (pre-commit) gates it.

## Defensive patterns

Read [docs/defensive-patterns.md](docs/defensive-patterns.md) before lifecycle, concurrency, subprocess, or teardown work.

## Type safety and documentation

Everything compiles under `strict: true` with `noImplicitAny`; every remaining `any` explains why narrowing is infeasible. Every module and export has concise JSDoc for its non-obvious contract; function-like exports include `@param`/`@returns`, as enforced by `verify-export-jsdoc`. Heritage-declared members, plugin-protocol slots, and constructors keep their docs at the declaring Service Definition, protocol, or class.

Comments and docs state complete contracts and context, not reasoning transcripts. Use direct, concrete terms. Do not use metaphors. Before writing `contract`, `boundary`, or `shape`, ask whether a more exact term names the subject: write `response fields`, `JSON validation`, or `ESM exports` instead of `response shape`, `validation boundary`, or `module shape`. Keep `contract` for preconditions, postconditions, invariants, compatibility promises, and other obligations that callers, callees, implementers, providers, producers, or consumers rely on. Keep a literal process, wire, security, transaction, or lifecycle boundary. Do not narrate control flow or tests, preserve review history, or restate code. Keep behavior, failure, timing, ownership, and safe-use facts; link the rationale. Use [dsh-prose-standard](.agents/skills/dsh-prose-standard/SKILL.md) for decisions. Wire mechanically checkable invariants into an executed top-level gate and prove each changed acceptance path rejects an invalid case. Use narrow, justified exceptions instead of disabling a rule globally.

Docs accompany every code change: update affected README and JSDoc contracts together. Routine bilingual work follows [docs/AGENTS.md](docs/AGENTS.md); only explicit user invocation may run `dsh-translate-docs`. Current-state prose, one physical line per paragraph, one home per fact, and word budgets live there.

## Editing these instructions

`CLAUDE.md` symlinks `AGENTS.md` at root and `packages/`; edit the real file. Keep each rule self-contained while linking high-level docs. Condense when clarity survives; raise a `verify-doc-budgets` ceiling when the required content genuinely needs more space.

## Vendoring policy

`vendor/` packages are pinned source copies (manifest with upstream SHAs in [vendor/README.md](vendor/README.md)). Update via the sync procedure there; re-apply or retire the logged local modifications; rerun `pnpm run test && pnpm run build`.

<!-- CCB-TEAM-ROUTING:START -->
## CCB Team Role Routing

This section applies only to CCB-managed agents for this project. Ordinary
Codex, Cursor, Claude, or other sessions outside this project's CCB runtime
must ignore it.

Activate the routing only when at least one of these conditions is true:

- `CCB_CALLER_ACTOR` is exactly `opus`, `sol`, or `grok`; or
- the effective `HOME` path is below this project's
  `.ccb/agents/<agent>/provider-state/` directory and `<agent>` is exactly
  `opus`, `sol`, or `grok`.

At the beginning of a CCB-managed task:

1. Determine the logical agent from `CCB_CALLER_ACTOR`. If unavailable,
   inspect `HOME` and extract the agent name only from the managed path shape
   above.
2. Read `.ccb/ccb_memory.md`.
3. Read only the matching private memory:
   `.ccb/agents/<agent>/memory.md`.
4. Apply the shared contract and that one private role for the current task.
5. Do not load or impersonate another CCB agent's private role.

If identity cannot be established by these rules, do not guess and do not
activate a CCB role. The current user request and higher-priority instructions
always override CCB memory.
<!-- CCB-TEAM-ROUTING:END -->

## Learned User Preferences

- 用户对话使用中文；桌面端用户可见文案优先中文
- 本仓库更新推送到 github.com/AlataChan/deepseek-harness 与 Gitee 镜像，不向上游开 PR，分支可直接 merge
- 桌面首次进入应直接到首页，不要先强迫选择 Node / workspace；设置项须对普通用户可理解；分发目标：新用户只需配置 API Key，安装器自动处理 Node 和运行时
- 公益课期包与社区桌面外挂均不改官方 `apps/desktop`、`packages/bundle/desktop-app`、`desktop-companion` 的产品逻辑；默认助理保持 `standard`，「公益项目助手」只做新会话 chip 入口；本 fork 桌面产品名为 `octopus_DSH`，dock 用原创绿叶鲸鱼标，主页品牌位用自有黑白/白绿标（不用 DeepSeek 默认 logo），窗口内 `FishLogo` 保持原样
- 社区插件市场与「让模型搜装第三方插件」只作可选设置入口，不写进开机默认组合
- 不要只列命令或让用户当测试员：涉及构建/打包/分发的活自己跑完并自验后再交付，反复出现的低级错误要变成打包链路里的硬门禁检查项
- fork 桌面功能以装盘版可正常开机可用为交付标准：须钉进 `desktop-profile-plugins` 并保证 harness 闭包可解析，不能只停在 experimental 源码；上游合入后要对齐 companion 与 harness 版本
- 问数路径要对普通用户足够简单：先选或上传数据源，再点「开始提问」；提供示例表与脏表避坑提示；同一入口不要并列多个「开始提问」
- 打包体积敏感：优先轻量依赖；问知识 PDF 入库值得加；表格类优先引导走问数，避免为 Excel 再引入沉重 extras
- Agent Team 须对普通用户可自助使用：中文区分一次性任务与常驻队友；面板填入机构向启动话术（文书/案例/传播小队；队友 name 为英文 kebab、职责中文）；队友模型选择应对用户开放，且面板展示与实际选用一致
- Agent Team 协作可视化：实时互动用自建 UI；archify 只做事后总结（可选 `dsh plugin --profile web add @tt-a1i/archify-dsh@0.1.0`，不进默认开机种子）；实时层须控制开销，避免拖慢桌面端或冗余

## Learned Workspace Facts

- 本仓库是 DeepSeek Harness 的 AlataChan fork；npm 发布为 `@alatastudio/*`（CLI 为 `@alatastudio/dsh`），源码包名仍为 `@deepseek-ai/dsh*`
- 桌面端是 Tauri 2 外壳（现有 React Client + Node companion），不是 Electron。companion 跑 web-app Host（Typert remotes、官方 Connection、loopback `127.0.0.1` port `0`）；stdio 只做 handshake / bundle cache / 把 fetch+stream 隧穿到 `__DSH_TRANSPORT__`
- 公益「公益项目助手」外挂包在课程仓库 `course/dsh-env-ngo/`，不入库官方 `packages/skill`
- 桌面分发链路：`pnpm run build` → `cd apps/desktop && cargo tauri build` → `bash scripts/build-dmg.sh --arch arm64`；`scripts/verify-desktop-bundle.sh` 是 build-dmg 的强制门禁（组装 Node/Harness/plugins 之后再验），含 companion 模块解析与生命周期烟测，不通过不产出 DMG
- 桌面 bundle 的运行时依赖由 `scripts/collect-runtime-deps.mjs` 扁平收集（`pnpm deploy` 会漏 vendored 包的传递依赖），产物零 symlink；workspace 包可跳过 `src/`，第三方包的 `src/` 可能是运行时代码不能删；profile-plugin 的 `workspace:` Host 依赖须进 `apps/cli` dependencies 才能打进 harness（Agent Team 的 `agent-team`/`tool-agent-team` 缺则 companion 整树加载失败、工作区选择卡死；`verify-desktop-bundle` 已门禁）
- 打包版 companion 的 stderr 落在 `~/Library/Application Support/studio.octopus.dsh/companion.log`（每次启动截断），是排查 companion 崩溃与 Broken pipe 的入口；companion 与 harness 版本字符串须一致，否则握手报 `Harness runtime version mismatch`，旧安装不会随重打 DMG 自更新
- 社区桌面外挂由 `scripts/desktop-profile-plugins.json` 钉版本（文件工作台 + `@yejiming/dsh-data-agent@0.1.3` + `desktop-ask-data` + `desktop-ask-knowledge` + `client-ui-agent-team`）；pin 须 dual-face（`dsh.bundle.patch` + `dsh.client` + `./client`），Host-only profile 层不能直接 seed。seed 丢弃 `workspace:` 传递依赖、只装第三方生产依赖（`schemastery` 等同时在 dependencies/devDependencies 的要先剥 dev）；DMG 嵌 `Resources/resources/profile-plugins/`，首次启动合并；用户从 bundles 删掉后刷新不写回；`dsh-context@0.36.0` 依赖 0.1.1 的 `settingsNamespace`，不能再种子
- 文件工作台是 overlay `experimental/desktop-files`，不写进官方 `desktop-app`；Client 走 `session.listEntries` / `session.openWorkspacePath`；冷会话 cwd 读 `persistence.list()`
- 微信公众号提取 skill 在 `.agents/skills/wechat-article-extractor/`（宽松本地限流：每小时 8 篇、间隔 20s）；DMG 经 `bundled-skills` 种子到 `~/.dsh/skills/`，启动时由 `install_bundled_skills` 刷新并保留限流计数
- 问数是 overlay `experimental/desktop-ask-data`（配合 seeded data-agent）：先有数据再有会话，上传/选 Excel·CSV 后 Host 建 SQLite 并绑定会话
- 问知识是 overlay `experimental/desktop-ask-knowledge`：库目录默认 `<app_data_dir>/knowledge-bases`（工作区放快捷方式）；Python sidecar 由 `scripts/build-kb-sidecar.sh` 打进 DMG；入库与「仅本会话看文档」分流
