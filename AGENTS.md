# AGENTS.md

DeepSeek Harness is an all-plugin Cordis agent harness. Read [docs/architecture.md](docs/architecture.md) before changing `packages/`; follow [docs/AGENTS.md](docs/AGENTS.md) for documentation.

## Pre-stable APIs and released Session data

Public APIs are pre-stable; update every consumer. Follow [version/status](docs/session-format-status.md) and [type acknowledgements](docs/cookbook/reviewing-persistence-type-changes.md). [Adjacent migration](.agents/notes/implemented/architecture/2026-08-31-released-session-format-migrations.md) may add a version-named successor but never move, overwrite, or delete committed generations; predecessors imply neither fallback nor downgrade support. SQLite uses monotonic `SCHEMA_VERSION`.

Acknowledge [declared persistence-type changes](docs/cookbook/reviewing-persistence-type-changes.md).

Record each externally perceptible breaking change immediately in an [upgrade guide](.agents/skills/dsh-create-upgrade-guide/SKILL.md).

**Application launch.** Only `dsh` profiles launch supported Node apps; package bins, demos, and public SDK argv escapes are forbidden ([rule](docs/architecture.md#application-launch)).

## Repository layout

```
vendor/      Vendored Cordis (vendor/README.md)
packages/    @deepseek-ai/dsh-<pkg> workspaces at packages/<group>/<pkg>/
  core/                 agent/session API
  api/                  remote BFF
  typert/               type graphs
  llm/                  model providers
  shell/                command execution
  subprocess/           child-process management
  ssh/                  SSH execution providers
  terminal/             persistent terminals
  ptc-runtime/          PTC execution
  sandbox/              process confinement
  deliverables/         turn deliverables
  fs/                   filesystem access
  lsp/                  language servers
  skill/                skill loading
  web/                  search/fetch tools
  computer-use/         computer interaction
  browser-use/          browser interaction
  compaction/           context compaction
  context/              request context
  subagent/             delegated agents
  jobs/                 background jobs
  bundle/               profile bundles
  workflow/             workflow execution
  webhook/              webhook ingress
  todo/                 todo_write tool
  plan/                 logged planning
  goal/                 session goals
  schedule/             scheduled follow-ups
  preset/               agent composition
  guard/                loop/tool guards
  extensions/           runtime self-modification
  hooks/                Claude Code/Codex bridges
  session/              durable sessions
  session-query/        browsing/search/export
  attachment/           binary attachments
  spill/                output spill
  storage/              non-session storage
  workspace/            workspace entities
  feedback/             human feedback
  identity/             anonymous identity
  settings/             user settings
  credentials/          credentials/authorization
  acp/                  automation-only ACP
  interaction/          human interaction
  boot/                 application boot
  sdk/                  JSON-RPC SDK
  host/                 GUI host
  client/               GUI client
  mcp/                  external tools
  experimental/         pre-stable prototypes; public by default with explicit private exceptions
  test-support/         test infrastructure
  util/                 zero-dependency utilities
python/      Python SDK/runtime (python/README.md)
native/      @deepseek-ai/node-addon-system source (native/README.md)
benchmarks/  performance gates
.agents/     Agent workflows/notes
docs/        Documentation (docs/AGENTS.md)
scripts/     gates and generators
website/     VitePress documentation projection
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
pnpm run doc-sync       # documentation gates (scripts/run-gates.ts)
pnpm run test:docs      # quick documentation checks (no build; doc-quick aggregate)
pnpm run website:build  # VitePress build (doubles as dead-link check)
pnpm dsh --profile headless "task"  # run one task from source (needs DEEPSEEK_API_KEY)
pnpm run demo:ptc -- "task"  # headless PTC mode run (needs key)
pnpm run dev:web | dev:desktop  # build, then launch; Web also rebuilds client bundles on edits. start:web | start:desktop skip the build
make web|dev-web|desktop|dev-desktop|build  # the same commands; ARGS='--no-open' forwards options
```

### Host sandbox failures

If a required `gh`, `pnpm`, build, test, or generator command fails because the sandbox blocks credentials, network, IPC, watching, or nested `sandbox-exec`, retry unchanged with the narrowest host escalation. Require sandbox evidence; never bypass test failures or the product sandbox.

### Run relevant checks locally

Before pushing, follow [dsh-pre-push-checks](.agents/skills/dsh-pre-push-checks/SKILL.md); report only commands run. After `gh stack sync`, validate immediately; do not merge before checks pass.

- Match evidence to the surface: focused behavior tests, model/user-output snapshots, `doc-sync` for docs, built smokes for published paths, and real-API e2e for providers.
- Never default to the full suite or repeat a passing check for commit or push. CI owns exhaustive coverage and the platform matrix; rehearse all locally only by explicit request, for CI diagnosis, or for an irreducibly repository-wide change.
- `test:coverage`, not `test`, is the CI coverage gate ([why](docs/testing.md)).
- **Web browser automation and GIF recording:** launch with `pnpm dsh web --patch apps/web/tests/pin-browse-picker.overlay.yml` to use the [in-page directory picker](apps/web/tests/pin-browse-picker.overlay.yml); omit this override only when testing native picker behavior explicitly.

## Secrets / .env

Real-API tests/demos read `DEEPSEEK_API_KEY`, optional `DEEPSEEK_BASE_URL`, and root `.env`. cordis.yml allows `!!js` (never `!js`) under plugin `config` and entry `disabled`; other metadata stays literal, so conditional composition also uses overlays ([primer](docs/cordis-primer.md#loader-configuration)). Never commit credentials. CI e2e skips without a key; [testing.md](docs/testing.md) owns key policy.

## Conventions

- Packages use `@deepseek-ai/dsh-<name>`; vendor is [rescoped](docs/rescope.md) and `private: true`. Harness packages declare `@deepseek-ai/cordis` in `peerDependencies`/`devDependencies`. Workspace dependency sections use DSH `workspace:*`, vendor/native `workspace:~` ([rules](.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
- ESM everywhere (`"type": "module"`). Use package names across packages and `.ts` in local relative imports. Config subprocesses run built `lib/` under plain Node; source regressions use their declared launcher ([testing policy](docs/testing.md#test-subprocess-launch-modes)). The `dsh` CLI source launch runs through tsx's ESM-only hook (`node --import tsx/esm`); modules it reaches must stay ESM (no CJS-only exports) — Node's native TypeScript modes are unavailable across the engines range ([source-launch contract](.agents/notes/implemented/architecture/2026-07-29-dsh-source-launch-tsx-esm.md)). Raw/Web `cordis.yml` bare plugins must appear in their resolver manifest's `dependencies`; `verify-cordis-config` enforces it.
- **Registrations are effects**: every contribution goes through `ctx.effect()` / `ctx.on()`; a registry's `register()` returns the disposer.
- **Typed events use declaration merging** and merge-extensible maps. Event JSDoc needs `@mode` and payload `@param`. Public service methods document parameters and non-void returns. `SessionEventMap` members are required-on-read by default — builds that do not know a type refuse the log unless the event carries the envelope's `ignorable: true`; only structural format changes bump `SESSION_FORMAT_VERSION` ([mechanism](.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)).
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
- **No new assertions to `unknown`** (`as unknown` or `<unknown>`). Preserve or reduce the exact legacy baseline; use typed values or validation for replacements ([rule](.agents/notes/implemented/process/2026-09-19-no-unknown-casts.md)).
- **Source plane vs artifact plane, never mixed.** Static gates and tests resolve workspace imports through tsconfig `paths` to `src` and pass on a clean tree; gates consuming built `lib/` declare that dependency ([layout](docs/development.md#typescript-project-layout)).
- **Keep compiler faces explicit.** A package with both Host and Client programs exposes face-specific leaf configs and a solution-only root; repo-wide programs seed a face config, never the root solution ([layout](docs/development.md#typescript-project-layout)).
- **An empty `catch` names the error** and why; keep its `try` to one statement.
- **Keep comments local.** Do not restate code, expand unrelated comments, or explain distant behavior without local need ([rationale](.agents/skills/dsh-prose-standard/SKILL.md)).
- **Ban `prove` + `nance`** ([rule](.agents/notes/implemented/process/2026-08-26-ban-ambiguous-origin-label.md)).
- **Prefer symmetry for parallel values**; unexplained asymmetry usually signals a missed extraction.
- **Tests describe behavior, not correctness.** Change obsolete behavior with its tests; explain why in the PR.
- **Create Agent Notes only for durable decision rationale;** mechanical/local edits are exempt, including local UI changes ([scope](.agents/notes/README.md#when-to-write-one)). Archived notes are frozen: never edit or treat them as current authority ([archive policy](.agents/notes/README.md#archiving-and-deletion)).
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

This section applies only to CCB-managed agents for this project. Ordinary Codex, Cursor, Claude, or other sessions outside this project's CCB runtime must ignore it.

Activate the routing only when at least one of these conditions is true:

- `CCB_CALLER_ACTOR` is exactly `opus`, `sol`, or `grok`; or
- the effective `HOME` path is below this project's `.ccb/agents/<agent>/provider-state/` directory and `<agent>` is exactly `opus`, `sol`, or `grok`.

At the beginning of a CCB-managed task:

1. Determine the logical agent from `CCB_CALLER_ACTOR`. If unavailable, inspect `HOME` and extract the agent name only from the managed path shape above.
2. Read `.ccb/ccb_memory.md`.
3. Read only the matching private memory: `.ccb/agents/<agent>/memory.md`.
4. Apply the shared contract and that one private role for the current task.
5. Do not load or impersonate another CCB agent's private role.

If identity cannot be established by these rules, do not guess and do not activate a CCB role. The current user request and higher-priority instructions always override CCB memory.
<!-- CCB-TEAM-ROUTING:END -->

## Learned User Preferences

- Communicate with the user in English; desktop-end user-visible copy still prefers Chinese.
- This repo pushes to github.com/AlataChan/deepseek-harness and its Gitee mirror, no upstream PRs, branches can be merged directly.
- Desktop first launch goes straight to the home page, don't force Node/workspace selection first; the first screen must feel like a generational leap — visible upgrade lives in the home info architecture, not hidden behind bind-then-appear modals or chips; settings must be understandable to ordinary users; distribution target: new users only need to configure an API Key, the installer handles Node and runtime automatically.
- Public-service course packages and community desktop add-ons never modify the product logic of official `apps/desktop`, `packages/bundle/desktop-app`, or `desktop-companion`; open-pstack and anywhere-labs/dsh-desktop are benchmarks only, not forked into the official desktop; default assistant stays `standard`, "Public-service project assistant" is only a chip entry for new sessions; engineering name stays `octopus` / `octopus_DSH`, dock uses the original green-leaf whale logo, home page brand slot uses the own black-white/white-green logo (not the DeepSeek default logo), window `FishLogo` stays as-is; the in-window brand slot is called "Little Green Whale", externally writable as "Public-service Little Green Whale", don't use "Green Octopus" unless the dock logo changes to an octopus.
- Community plugin marketplace and "let the model search and install third-party plugins" are optional settings only, not in the default boot composition.
- Don't just list commands or let the user play tester: build/package/distribution tasks must be run and self-verified by you before delivery; repeated low-level mistakes become hard gate checks in the packaging pipeline.
- Forked desktop features deliver as working installable DMG: must be pinned into `desktop-profile-plugins` and resolvable by the harness closure, not stuck in experimental source; after upstream merge, align companion and harness versions.
- The "ask data" path must be simple enough for ordinary users: first select or upload a data source, then click "Start asking"; provide sample tables and dirty-table avoidance tips; don't put multiple "Start asking" buttons at the same entry point.
- Package size is sensitive: prefer lightweight dependencies; adding PDF ingestion for "ask knowledge" is worthwhile; table-type tasks guide toward "ask data" to avoid pulling in heavy extras for Excel; do not bundle FFmpeg or a media runtime in the one-click DMG (Homebrew FFmpeg is GPL) — users who want conversation video install FFmpeg and run `scripts/install-media-runtime.sh`.
- Agent Team must be self-service for ordinary users: distinguish in Chinese between "ad-hoc team" (temporary spawn within a session, existing capability) and "standing team" (roster that pre-exists the conversation, not a pstack job → model mapping); the panel accepts institution-facing launch prompts (documentation/case/communications squad; teammate names in English kebab-case, responsibilities in Chinese); teammate model selection must be open to the user, and panel display must match actual selection; subsequent standing team first raises home/blank-composer entry, not the pstack settings page.
- Agent Team collaboration visualization: real-time interaction uses a self-built right-side width-adjustable collaboration pod (topology-focused, tasks/ops at the bottom; dispatch/return uses lightweight communication light-points); the pod does ~1.5s soft refresh when opened (stops when closed); message edges show sent-and-received exchanges; Archify goes through `bundled-skills` into desktop by default; after task completion, CTA sends with one click, summary diagram previews HTML in sandbox (fallback to browser open if it fails); collaboration entry must not be too deep; real-time layer must control overhead.
- Blank-session Hero atmosphere must be shallow, light, visible at first glance: shallow sea beach (transparency of water and sand), not too deep or whale-wallpapered; lightweight ambient loop, fades once conversation starts, doesn't compete with input, doesn't make the whale a background protagonist.

## Learned Workspace Facts

- This repo is the AlataChan fork of DeepSeek Harness; npm publishes as `@alatastudio/*` (CLI as `@alatastudio/dsh`), source package names remain `@deepseek-ai/dsh*`.
- Desktop is a Tauri 2 shell (existing React Client + Node companion), not Electron. The companion runs a web-app Host (Typert remotes, official Connection, loopback `127.0.0.1` port `0`); stdio only does handshake / bundle cache / tunnels fetch+stream to `__DSH_TRANSPORT__`. Upstream ships no Tauri shell: its Electron `apps/desktop` arrived after the 2026-09-03 merge base, so that path collides with fork-authored code rather than evolving from it. `scripts/verify-upstream-intake.ts` enforces the intake rules held in `scripts/upstream-intake-registry.ts`.
- The public-service "Public-service project assistant" add-on package lives in the course repo `course/dsh-env-ngo/`, not in the official `packages/skill`.
- Desktop distribution pipeline: `pnpm run build` → `cd apps/desktop && cargo tauri build` → `bash scripts/build-dmg.sh --arch arm64`; `scripts/verify-desktop-bundle.sh` is a hard gate for build-dmg (validates after assembling Node/Harness/plugins), including companion module resolution and lifecycle smoke tests — fails without producing a DMG. Before signing, must have executable `Contents/MacOS/dsh-desktop`, `Contents/Resources/icon.icns`, and `Contents/Resources/resources/installed-runtime-cli.js`; when binary or icon is missing the skeleton, `build-dmg.sh` fills from `target/release/dsh-desktop`, `apps/desktop/src-tauri/icons/icon.icns`, and `packages/boot/installed-runtime/lib/cli.js`; fails immediately if cargo artifacts are absent. Workspace pins must not bundle `src/`, `tests/`, `motion/`, `node_modules/.bin` into profile-plugins (`.bin` pointing at seed temp dirs will fail on boot re-copy and drop `package.json`). A distributable DMG must include overlay patches; fixing only the local `/Applications` isn't enough for others to install; output is `dist/octopus_DSH.dmg`.
- Desktop bundle runtime deps are flat-collected by `scripts/collect-runtime-deps.mjs` (`pnpm deploy` misses vendored transitive deps), output has zero symlinks; workspace packages can skip `src/`, third-party `src/` may be runtime code and can't be deleted; profile-plugin `workspace:` Host deps must be in `apps/cli` dependencies to bundle into the harness (missing `agent-team`/`tool-agent-team` for Agent Team causes companion full-tree load failure and workspace selection freeze; `verify-desktop-bundle` already gates this).
- The packaged companion's stderr goes to `~/Library/Application Support/studio.octopus.dsh/companion.log` (truncated each start); this is the entry point for debugging companion crashes and Broken pipe errors; companion and harness version strings must match, otherwise the handshake reports `Harness runtime version mismatch`, and old installs won't self-update when re-packaged DMG is applied.
- Community desktop add-ons are version-pinned by `scripts/desktop-profile-plugins.json` (file workspace + `@yejiming/dsh-data-agent@0.1.3` + `desktop-ask-data` + `desktop-ask-knowledge` + `client-ui-agent-team` + `desktop-hero-atmosphere` + `desktop-media`); conversation media is overlay `experimental/desktop-media` (skill `conversation-media-creation` in `desktop-bundled-skills.json`); official `session-controller` remotes duck-type `ctx.desktopMedia` and official desktop/companion product logic stays unchanged. Pins must be dual-face (`dsh.bundle.patch` + `dsh.client` + `./client`), the Host-only profile layer can't directly seed. Seed drops `workspace:` transitive deps, only third-party production deps (deps like `schemastery` that are in both dependencies/devDependencies must have dev stripped first); DMG embeds `Resources/resources/profile-plugins/`, merged on first start; user deletions from bundles don't write back on refresh; `dsh-context@0.36.0` depends on `settingsNamespace` from 0.1.1, can't be re-seeded.
- File workspace is an overlay `experimental/desktop-files`, not written into official `desktop-app`; Client goes through `session.listEntries` / `session.openWorkspacePath`; cold-session cwd reads `persistence.list()`; its `cordis.patch.yml` also makes `connection-desktop` inject `sessionController`, otherwise with default `workspaceRoot=$HOME`, the post-handshake immediate open of `session/control` would `gateway-failure` and reconnect forever.
- WeChat public-account article extraction skill lives in `.agents/skills/wechat-article-extractor/` (lenient local rate-limit: 8 articles/hour, 20s interval); Archify skill comes from `@tt-a1i/archify-dsh` via npm source pinned in `desktop-bundled-skills.json` into the DMG; both are seeded via `bundled-skills` to `~/.dsh/skills/`, refreshed at startup by `install_bundled_skills` (WeChat side retains the rate-limit counter).
- "Ask data" is overlay `experimental/desktop-ask-data` (paired with seeded data-agent): data before session, upload/select Excel·CSV then Host creates SQLite and binds the session.
- "Ask knowledge" is overlay `experimental/desktop-ask-knowledge`: library directory defaults to `<app_data_dir>/knowledge-bases` (workspace holds shortcuts); Python sidecar is built into the DMG by `scripts/build-kb-sidecar.sh`; routes between ingestion and "session-only document view".
- Homepage atmosphere is overlay `experimental/desktop-hero-atmosphere`, occupying the official `conversation.atmosphere` slot; only plays the beach loop (K0 poster + short GOP) on blank Hero, fades when conversation starts, `prefers-reduced-motion` keeps only K0; seeded via `desktop-profile-plugins`, not written into official `desktop-app`.
- Upstream selective upgrade runs on staged hops on branch `upstream-upgrade/repair-2026-10-07` in worktree `/Users/apple/octopus-upstream-upgrade` (the only authoritative plan copy: `docs/plans/2026-10-06-upstream-selective-upgrade.md`); hops 1–2 merged (`dsh-v0.1.3-alpha.1`, `dsh-v0.1.5-alpha.1`), the 2026-10-07 repair checkpoint passed (real-data migration 152/152, intake gate enforcing, 0 test regressions); hop 3 (`dsh-v0.1.7-alpha.1`) is unblocked pending owner go, with the 125-line `RELEASED_V3_EVENT_TYPES` patch recorded verbatim in the plan docs as its first work item, then the `admitSelect` port into `agent-preset-registry` (upstream removed the hook; the fork's ask-data select gate would silently no-op without it).
- The fork's recorded deltas against upstream live as machine-checked data in `scripts/upstream-intake-registry.ts` (patches, never-merge, dispositions, mounts, forbidden endpoints, the ignorable inspection over 152 real logs, `UPSTREAM_PIN`); `pnpm run verify-upstream-intake` computes its own pin diff and fails on unregistered edits, undefined dispositions, or telemetry resolving to forbidden endpoints — register new fork edits there at every hop.
- Released session logs migrate under a backup-or-stop guard at `prepareStoredMigration` in `packages/session/session-persistence-jsonl` (`<source>.pre-migration.bak`, fsync, size-verified, idempotent; `JsonlMigrationBackupError`): the fork's 9 session events (4 bound + 5 `media/*`) and team/member v2 are required (not ignorable) in real logs and are admitted by the frozen v0 inventory; extending that inventory (version-conditional validation) is the pattern for any future fork event or schema bump.
