# SDK current-writer fixture integration

Completed in `/Users/apple/deepseek-harness/.worktrees/p0-upstream-022-2026-11-04` on 2026-11-05. Final strict replay: SDK **26/26**, headless owning cases **5/5**. This is scoped keyless fixture integration, not repository-wide acceptance; root retains shared builds and final review.

## Change and ownership

Read root AGENTS.md, snapshots/AGENTS.md, SDK header lookup/write/verification code, and declared manifests. Refreshed headless session/text-turn before SDK text-turn, then all SDK26 through the genuine shipped headless and SDK profiles with llm-replay. No live provider, paid API, credential use, recording mode, product source, shared manifest/config, generator, build, git index/branch/commit, skip, or normalizer changes were performed.

`snapshots/sdk/sdk.snapshot.ts` has exactly one changed line: persistent-tools now expects `{ bash: ['command'], str_replace_editor: ['command', 'path'], working_directory: [] }`. Exact tool-set matching, existing argument semantics, bash description, system prompt, runtime policy, workspace, and failure assertions remain intact. The new tool has no required argument; omitting cd reads the directory. Actual captures, rather than expected-data construction, supply all fixture changes.

SDK/shared pins use sdk/text-turn and session/text-turn. The first all-SDK refresh improved the root's reported 18 failures to four, exposing declared headless owners outside initial scope. Coordinator explicitly approved these four additional owners in an orchestration ask reply: session/dynamic-tool-updates (all three schema revisions), session/system-prompt-in-history (schema), session/ptc-turn (PTC prompt tool declarations), session/both-mode-turn (PTC prompt declarations and schema). Their required current v4 runtime-context captures were refreshed too. Both PTC prompt sidecars add only working_directory ToolArgsMap/ToolOutputMap declarations.

Initial text-turn refresh incidentally wrote its current writer.expected.jsonl; that file was restored to its verified initial bytes while scope allowed only header sidecars. Strict owner replay then exposed its missing mandatory cwd context. A second explicit coordinator approval authorized the real current writer.expected.jsonl capture; a new genuine headless refresh produced it. Historical session.jsonl and session.v1.jsonl were never replaced.

Current captures add the mandatory working-directory:current runtime-context section and working_directory tool schemas. Existing structured header config may reorder JSON object keys without changing values. Retained multi-turn current writer capture includes newly captured stream timing/dt values; historical streams and responses remain unchanged. Wire notifications include corresponding runtime context; results, workspace expectations, manifests, original replay inputs, failure oracles, and symlink targets remain unchanged.

## Commands and outcomes

Every Vitest invocation used the required pnpm environment/options shown below. Name-filter exclusions are ordinary selection from the unchanged test harness, not added skips. Replay does not load .env; refresh uses recorded model scripts.

```sh
DSH_SNAPSHOT=refresh PNPM_CONFIG_ENABLE_GLOBAL_VIRTUAL_STORE=false pnpm --config.enable-global-virtual-store=false --config.verify-deps-before-run=error exec vitest run --config vitest.snapshot.config.ts snapshots/session/headless.snapshot.ts -t 'refreshs text-turn through' > .plans/rc1-execution/sdk-owner-headless-refresh.log 2>&1
```

1 passed / 159 filtered; exit 0.

```sh
DSH_SNAPSHOT=refresh PNPM_CONFIG_ENABLE_GLOBAL_VIRTUAL_STORE=false pnpm --config.enable-global-virtual-store=false --config.verify-deps-before-run=error exec vitest run --config vitest.snapshot.config.ts snapshots/sdk/sdk.snapshot.ts -t 'refreshs text-turn through' > .plans/rc1-execution/sdk-owner-sdk-refresh.log 2>&1
```

1 passed / 25 filtered; exit 0.

```sh
DSH_SNAPSHOT=refresh PNPM_CONFIG_ENABLE_GLOBAL_VIRTUAL_STORE=false pnpm --config.enable-global-virtual-store=false --config.verify-deps-before-run=error exec vitest run --config vitest.snapshot.config.ts snapshots/sdk/sdk.snapshot.ts > .plans/rc1-execution/sdk-current-writer-refresh.log 2>&1
```

22 passed / 4 failed: additional owners; exit 1.

```sh
DSH_SNAPSHOT=refresh PNPM_CONFIG_ENABLE_GLOBAL_VIRTUAL_STORE=false pnpm --config.enable-global-virtual-store=false --config.verify-deps-before-run=error exec vitest run --config vitest.snapshot.config.ts snapshots/session/headless.snapshot.ts -t 'refreshs (dynamic-tool-updates|system-prompt-in-history|ptc-turn|both-mode-turn) through' > .plans/rc1-execution/sdk-expanded-owners-refresh.log 2>&1
```

4 passed / 156 filtered; exit 0.

```sh
DSH_SNAPSHOT=refresh PNPM_CONFIG_ENABLE_GLOBAL_VIRTUAL_STORE=false pnpm --config.enable-global-virtual-store=false --config.verify-deps-before-run=error exec vitest run --config vitest.snapshot.config.ts snapshots/sdk/sdk.snapshot.ts > .plans/rc1-execution/sdk-current-writer-refresh-final.log 2>&1
```

26 passed; exit 0.

```sh
DSH_SNAPSHOT=replay PNPM_CONFIG_ENABLE_GLOBAL_VIRTUAL_STORE=false pnpm --config.enable-global-virtual-store=false --config.verify-deps-before-run=error exec vitest run --config vitest.snapshot.config.ts snapshots/session/headless.snapshot.ts -t 'replays (dynamic-tool-updates|system-prompt-in-history|ptc-turn|both-mode-turn|text-turn) through' > .plans/rc1-execution/sdk-owners-strict-replay.log 2>&1
```

4 passed / 1 failed: original scope excluded text-turn current writer; exit 1.

```sh
DSH_SNAPSHOT=replay PNPM_CONFIG_ENABLE_GLOBAL_VIRTUAL_STORE=false pnpm --config.enable-global-virtual-store=false --config.verify-deps-before-run=error exec vitest run --config vitest.snapshot.config.ts snapshots/sdk/sdk.snapshot.ts > .plans/rc1-execution/sdk-current-writer-strict-replay.log 2>&1
```

26 passed; exit 0.

```sh
DSH_SNAPSHOT=refresh PNPM_CONFIG_ENABLE_GLOBAL_VIRTUAL_STORE=false pnpm --config.enable-global-virtual-store=false --config.verify-deps-before-run=error exec vitest run --config vitest.snapshot.config.ts snapshots/session/headless.snapshot.ts -t 'refreshs text-turn through' > .plans/rc1-execution/sdk-text-owner-writer-refresh.log 2>&1
```

1 passed / 159 filtered; exit 0.

```sh
DSH_SNAPSHOT=replay PNPM_CONFIG_ENABLE_GLOBAL_VIRTUAL_STORE=false pnpm --config.enable-global-virtual-store=false --config.verify-deps-before-run=error exec vitest run --config vitest.snapshot.config.ts snapshots/session/headless.snapshot.ts -t 'replays (dynamic-tool-updates|system-prompt-in-history|ptc-turn|both-mode-turn|text-turn) through' > .plans/rc1-execution/sdk-owners-strict-replay-final.log 2>&1
```

5 passed / 156 filtered; 9.61s; exit 0.

```sh
DSH_SNAPSHOT=replay PNPM_CONFIG_ENABLE_GLOBAL_VIRTUAL_STORE=false pnpm --config.enable-global-virtual-store=false --config.verify-deps-before-run=error exec vitest run --config vitest.snapshot.config.ts snapshots/sdk/sdk.snapshot.ts > .plans/rc1-execution/sdk-current-writer-strict-replay-final.log 2>&1
```

26 passed; 29.24s; exit 0.

`git diff --check -- snapshots/sdk snapshots/session/text-turn snapshots/session/dynamic-tool-updates snapshots/session/system-prompt-in-history snapshots/session/ptc-turn snapshots/session/both-mode-turn` passed (exit 0). Read-only Python audits compared current files against HEAD, verified all historical bytes and Session first-line metadata, recursively reviewed changed JSON fields, and checked each changed schema sidecar equals its original after removing only the added working_directory entry. One initial audit attempted to JSON-parse a sidecar symlink's Git blob (a relative link path); corrected audit verifies link targets as links and audits physical owning files.

## Preservation evidence and hashes

All **68 historical V0–V3 Session files** in SDK plus the five headless owner directories remain byte-identical to HEAD. All **106 Session headers** (including current v4) retain exactly the original parsed fields and byte hashes. All 16 changed physical schema sidecars preserve every prior schema definition. No Session generation or baseline was deleted.

Durable machine-readable evidence:

- `sdk-retained-evidence.json`: historical per-file SHA-256, all Session header hashes, and files changed since worker entry (18 paths; entry already contained the root's partial SDK refresh).
- `sdk-changed-fixture-hashes.json`: SHA-256 for all 71 scoped files differing from HEAD, including root-preexisting capture changes and approved owner updates.
- `sdk-fixture-diff-audit.json`: exact changed JSON paths against HEAD; only runtime context, added tool schemas, and current retained writer stream timings differ semantically.
- `sdk-schema-preservation.json`: physical schema sidecar preservation checks.
- `sdk-integration-before-hashes.json`: initial snapshot for ownership-safe audit; extra owner hashes added before those refreshes.
- `sdk-source-hashes.json`: source/runtime inputs below; supplied builds were consumed without running a build.

| File | SHA-256 |
| --- | --- |
| `snapshots/sdk/sdk.snapshot.ts` | `7fcf97e5b42874cd7395e4650e32e4323130d06c2cdffbebd194269de94eead6` |
| `snapshots/session/headless.snapshot.ts` | `bea842f8e311950679edd7cb0796321d4697db4a8b1687f57b14941c38b9ff75` |
| `vitest.snapshot.config.ts` | `ba338443e7f7fddb97813acb490904a339a46c7b20cfe504f9955df4a2514886` |
| `packages/test-support/session-snapshot/src/normalize.ts` | `7aa3d8101a26272ee7b151572219f5cc41bf78a628777148d470aa7371bebd63` |
| `packages/session/working-directory/src/index.ts` | `b44c79f8993e5586b0f6d84054fe473abf6bb74b39b339aa00a9a7411577887c` |
| `packages/session/tool-working-directory/src/index.ts` | `c318bea6a4ab0f8f5c1482334471fc217315111ee579dc9581635a1a608c23eb` |
| `apps/cli/lib/bin.js` | `857253fcac48bb541bdaafc0abb491ee9abed6fccf235c43fc0d139f331da738` |

## Scoped files differing from HEAD

- `snapshots/sdk/account-provider-signout/notifications.expected.jsonl`
- `snapshots/sdk/account-provider-signout/session.v4.jsonl`
- `snapshots/sdk/bash-tool/notifications.expected.jsonl`
- `snapshots/sdk/bash-tool/session.v4.jsonl`
- `snapshots/sdk/bash-tool/tool-schemas.expected.json`
- `snapshots/sdk/commerce-load-sample/session.v4.jsonl`
- `snapshots/sdk/commerce-load-sample/tool-schemas.expected.json`
- `snapshots/sdk/dynamic-tool-updates/notifications.expected.jsonl`
- `snapshots/sdk/dynamic-tool-updates/session.v4.jsonl`
- `snapshots/sdk/inline-image-prompt/session.v4.jsonl`
- `snapshots/sdk/max-tokens-continue/session.v4.jsonl`
- `snapshots/sdk/multi-turn/writer.expected.jsonl`
- `snapshots/sdk/persistent-tools/notifications.expected.jsonl`
- `snapshots/sdk/persistent-tools/session.v4.jsonl`
- `snapshots/sdk/persistent-tools/tool-schemas.expected.json`
- `snapshots/sdk/ptc-turn/notifications.expected.jsonl`
- `snapshots/sdk/ptc-turn/session.v4.jsonl`
- `snapshots/sdk/sdk.snapshot.ts`
- `snapshots/sdk/serial-created/session.v4.jsonl`
- `snapshots/sdk/session-title-after-turn/session.v4.jsonl`
- `snapshots/sdk/subagent-activation-limit/session.1.v4.jsonl`
- `snapshots/sdk/subagent-activation-limit/session.v4.jsonl`
- `snapshots/sdk/subagent-activation-limit/tool-schemas.1.expected.json`
- `snapshots/sdk/subagent-continuable-inheritance/session.1.v4.jsonl`
- `snapshots/sdk/subagent-continuable-inheritance/session.v4.jsonl`
- `snapshots/sdk/subagent-continuable-inheritance/tool-schemas.1.expected.json`
- `snapshots/sdk/subagent-continuable/session.1.v4.jsonl`
- `snapshots/sdk/subagent-continuable/session.v4.jsonl`
- `snapshots/sdk/subagent-continuable/tool-schemas.1.expected.json`
- `snapshots/sdk/subagent-dsh-sdk-diagnostic/notifications.expected.jsonl`
- `snapshots/sdk/subagent-dsh-sdk-diagnostic/session.v4.jsonl`
- `snapshots/sdk/subagent-dsh-sdk-diagnostic/tool-schemas.expected.json`
- `snapshots/sdk/subagent-dsh-sdk-dynamic-route/notifications.expected.jsonl`
- `snapshots/sdk/subagent-dsh-sdk-dynamic-route/session.1.v4.jsonl`
- `snapshots/sdk/subagent-dsh-sdk-dynamic-route/session.v4.jsonl`
- `snapshots/sdk/subagent-dsh-sdk-dynamic-route/tool-schemas.1.expected.json`
- `snapshots/sdk/subagent-dsh-sdk-dynamic-route/tool-schemas.expected.json`
- `snapshots/sdk/subagent-fork-in-process/session.1.v4.jsonl`
- `snapshots/sdk/subagent-fork-in-process/session.v4.jsonl`
- `snapshots/sdk/subagent-list-agents/session.1.v4.jsonl`
- `snapshots/sdk/subagent-list-agents/session.v4.jsonl`
- `snapshots/sdk/subagent-list-agents/tool-schemas.1.expected.json`
- `snapshots/sdk/subagent-mixed/session.1.v4.jsonl`
- `snapshots/sdk/subagent-mixed/session.2.v4.jsonl`
- `snapshots/sdk/subagent-mixed/session.v4.jsonl`
- `snapshots/sdk/subagent-send-message/session.1.v4.jsonl`
- `snapshots/sdk/subagent-send-message/session.v4.jsonl`
- `snapshots/sdk/subagent-send-message/tool-schemas.1.expected.json`
- `snapshots/sdk/subagent-spawn-in-process/notifications.expected.jsonl`
- `snapshots/sdk/subagent-spawn-in-process/session.1.v4.jsonl`
- `snapshots/sdk/subagent-spawn-in-process/session.v4.jsonl`
- `snapshots/sdk/system-prompt-in-history/notifications.expected.jsonl`
- `snapshots/sdk/system-prompt-in-history/session.v4.jsonl`
- `snapshots/sdk/text-turn/notifications.expected.jsonl`
- `snapshots/sdk/text-turn/session.v4.jsonl`
- `snapshots/sdk/text-turn/tool-schemas.expected.json`
- `snapshots/sdk/tool-error-details/notifications.expected.jsonl`
- `snapshots/sdk/tool-error-details/session.v4.jsonl`
- `snapshots/sdk/tool-scheduler-recovery/notifications.expected.jsonl`
- `snapshots/sdk/tool-scheduler-recovery/session.v4.jsonl`
- `snapshots/session/text-turn/tool-schemas.expected.json`
- `snapshots/session/text-turn/writer.expected.jsonl`
- `snapshots/session/dynamic-tool-updates/session.v4.jsonl`
- `snapshots/session/dynamic-tool-updates/tool-schemas.expected.json`
- `snapshots/session/system-prompt-in-history/session.v4.jsonl`
- `snapshots/session/system-prompt-in-history/tool-schemas.expected.json`
- `snapshots/session/ptc-turn/session.v4.jsonl`
- `snapshots/session/ptc-turn/system-prompt.expected.md`
- `snapshots/session/both-mode-turn/session.v4.jsonl`
- `snapshots/session/both-mode-turn/system-prompt.expected.md`
- `snapshots/session/both-mode-turn/tool-schemas.expected.json`

Nothing remains for this SDK/current-writer integration task. Root owns repository-wide checks, shared build consistency, and final acceptance.
