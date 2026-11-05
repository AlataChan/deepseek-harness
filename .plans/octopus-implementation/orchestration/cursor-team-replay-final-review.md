# Cursor final review — Stage A replay compiler and Cordis cleanup

Date: 2026-11-04. Task `task_bb8f16b212cd`. Dispatch `ctx_d603623d49d5`.
Verdict: **ACCEPT**. Score: **8/10**.
Observed model identity: **Grok 4.7**, named by this session's system prompt. The process environment exposed no separate model id. This records the model that ran the review.

This is a source and test review of the replay compiler, its Cordis cleanup, the header comparator, and the skill-filesystem discriminant lines. **A6 installed qualification remains unqualified.** Nothing here builds, installs, or exercises an installer or DMG. `docs/plans/2026-11-03-octopus-stage-a-native-teamwork-plan.md` still leaves A6 pending. B1 source was not read or edited.

OpenCode reports `opencode-team-replay-compiler-fix.md`, `opencode-stage-a-test-compiler-cleanup.md`, and `opencode-replay-public-test-import.md` were treated as implementation notes. The findings below were re-derived from current source, hashes, and the commands in Evidence.

| Axis | Score | Reason |
| --- | --- | --- |
| Correctness | 8 | Both prior blockers are fixed in source. The Cordis spec proves proxy wrap, prototype restore, reapply, and later-owner preservation. The empty-splice guard is correct and has no direct unit. Fiber registration is traced, not asserted. |
| Simplicity | 8 | One unwrap, one descriptor helper, and the existing disposer registered on the installing fiber. |
| Security | 9 | Test-support only, default off, frozen JSONL, no manufactured tool or wait results. |
| Conformance | 8 | Public `Agent`, dev-only edges, public type import, README pair consistent, check program is `noEmit` and unreferenced. Header `toEqual` remains. |

## Prior Required

### 1. Public `Agent` caller and empty splices — CLOSED

`TeamScheduleSeam.waitForChange` and `tryMembership` are function properties whose caller parameter is `Agent` from `@deepseek-ai/dsh-agent` (`packages/test-support/llm-replay/src/causal-team-schedule.ts` lines 3 and 110–113). The import is type-only. The seam stays function-property syntax, so method bivariance is not used to hide the parameter. `releaseFor` takes the same `Agent` (line 524). There is no `TeamMemberRef`, no `as unknown`, and no `this: void` on a method that uses `this`.

`expectSettlement` reads `event.data.inserted[0]` and returns false when that element is `undefined` before it touches `.source` (lines 661–665). An empty `agent/inbox/spliced` therefore does not throw inside the matcher and does not count as a settlement. `UserMessage` requires `source`, so a present inserted message has a `kind` to compare.

Unit doubles are structural `Agent` values built with `unsupportedInbox()` (`tests/causal-team-schedule.spec.ts` lines 28–44). `tsc` accepts them as `Agent` without an `as unknown` cast. The spec file contains no `as unknown`.

Independent `tsc` of `tsconfig.check.json` (src + tests) and of `tsconfig.json --noEmit` (src) both exited 0 with no diagnostics. That closes the three errors in `root-team-replay-final-typecheck.log` (TS18048 twice, TS2322 on `TeamService` versus the seam).

### 2. Raw Cordis method restore, descriptors, later owner, fiber dispose — CLOSED

`originalOf` reads `symbols.original` and returns that object only when it is a non-null object; a plain double passes through (`causal-team-schedule.ts` lines 196–201). `overrideMethod` (lines 410–427):

- captures the own descriptor before replacement;
- throws when an own descriptor exists and its `value` is not a function (accessors fail loud);
- installs the wrapper on the raw instance, which is where `===` sees the function (`vendor/cordis/src/utils.ts` `createTraceable` mints a new shadow on every proxy get);
- on dispose, returns immediately when the own value is no longer this wrapper, so a later owner stays;
- deletes the own property when the method previously lived on the prototype;
- otherwise reinstalls the captured own descriptor with `defineProperty`.

`driver.dispose` returns on the second call (lines 344–347), then runs restorers, rejects holds, settle deferreds, and the park timer. `installLlmReplay` makes `handle.dispose` idempotent and registers `ctx.effect(() => handle.dispose)` (`src/index.ts` lines 1136–1163). Cordis `Fiber.effect` treats a returned function as the disposer (`vendor/cordis/src/fiber.ts` lines 367–368 and 418–419). `handle.dispose` closes over its state and does not use `this`, so the bare disposer call is valid. `ReplayHandle.dispose` is already declared `this: void`.

Fiber restart sets the epoch inactive, starts `_unload`, and `_unload` awaits every disposer before `_reload` runs plugin code again when the epoch has moved on (`fiber.ts` lines 625–638 and 675–695). Teardown of the installing plugin therefore restores the raw methods before a reapply installs a new driver. The driver's own later-owner check also leaves a replacement that landed first.

`waitForChange` uses `this.roster` and `this.activity` (`packages/experimental/agent-team/src/index.ts` lines 310–312). `flush` uses `this.ctx.events`, and child contexts inherit the root `events` object (`vendor/cordis/src/context.ts` lines 80 and 99–106). `collectSessionCallbacks` filters by the session carrier, the first dispatch argument (`packages/core/session/src/index.ts` lines 394–395 and 1190–1193). Calling the saved prototype method with the raw instance keeps those listeners. The wrapper calls `original.call(owner, ...)`.

The spec `wraps and restores real Cordis Service methods across install, dispose, and reapply` mounts real `Service` subclasses, calls through a fresh `ctx.get` proxy, and asserts the wrapper rejects, the restored prototype method resolves `{ timedOut: false }`, and `Object.hasOwn(proxy, 'waitForChange')` is true then false. The proxy has no `getOwnPropertyDescriptor` trap, so `Object.hasOwn` reads the raw instance. A second driver wraps and restores again. `leaves a later owner’s replacement in place when it disposes` assigns a different function on the raw instance and expects that descriptor value after dispose. This review ran that file: 14 passed, exit 0.

## Prior Suggested

- **Watchdog constant versus injected bound — CLOSED.** `armStepEightGate` and `bounded` both use `this.watchdogMs` (`causal-team-schedule.ts` lines 722–724 and 756–758).
- **README said the driver holds parent tool calls — CLOSED.** English and Chinese now say teammate tool holds, with Lead gating by model-call index (`README.md` lines 78–80, `README.zh.md` line 78). `verify-translation-pairing` on that README exited 0.
- **Cordis restore was only a plain-object identity check — CLOSED** by the Service spec above. The plain-object dispose test remains; it is no longer the restore evidence.
- **Abort listener leak — CLOSED.** `abortOf` returns a disposer and `bounded` calls it from `finally` (lines 183–186 and 761–764).

## New Required

None.

## Suggested

- **S1 — Empty splice is untested.** The settlement spec appends only non-empty splices (`causal-team-schedule.spec.ts` lines 461–474). The guard at `causal-team-schedule.ts` lines 662–664 is the fix. A case that appends `inserted: []` while the notes settlement gate is armed, then the matching splice, would lock the non-match.
- **S2 — Fiber unload is not the assertion that restores methods.** The Cordis spec calls `driver.dispose()` directly. Removing `ctx.effect(() => handle.dispose)` would not fail that spec or the existing waterfall HMR test, because `ctx.on` already removes its own listener. The registration and Cordis unload-before-reload order are in the source this review read.

## Skill-filesystem discriminant

Only the directory narrowing in the already accepted precedence test was reviewed. No A4 redesign.

```252:255:packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts
    expect(loaded.resourceBase).toEqual({ kind: 'directory', path: projectSkill })
    if (loaded.resourceBase?.kind !== 'directory') throw new Error('expected directory resourceBase')
    expect(await readFile(join(loaded.resourceBase.path, 'references/task-spec.md'), 'utf8')).toBe('# project task template\n')
    expect(await readFile(join(loaded.resourceBase.path, 'references/recovery.md'), 'utf8')).toBe('# project recovery\n')
```

The `toEqual` pins `kind: 'directory'` and the `kind` check narrows `directory | url | opaque` so `.path` is legal. Both `readFile` assertions still expect the project-local reference bytes. List/get ranks stay project-agents, then user-dsh, then bundled. `cursor-a4-refresh-precedence-review.md` (ACCEPT 9/10, no Required) still stands. Its S4 note remains: these reads use `node:fs`, and installed discovery stays an A6 obligation.

## Header comparator and child prompts

`verifyHeaders` still `toEqual`s each reconstructed request header, including `adapterDefaults` (`snapshots/session/headless.snapshot.ts` lines 849–853). Log 0 and any log without a pinned child file keep the primary baseline (`pinnedHeaderBaselines`, lines 796–803). A log with a pinned child file is normalized from that file. The prompt check is still `toBe` against the child sidecar or the primary sidecar (lines 855–859).

The three cases under `pinned request-header baselines` still reject a changed child `reasoningEffort`, a changed `adapterDefaults.reasoningEffort` marker, and a changed `maxTokens` (lines 1402–1420). No header assertion was removed. This is the same comparator the prior review accepted, and the current source does not weaken it.

`system-prompt.1.expected.md` and `system-prompt.2.expected.md` contain `Your Team role is teammate; your Team name is notes-writer|summary-writer`. Each of the three JSONL fixtures has one `system/message`, and its text is the token `{{system}}`. Historical prompt byte equivalence is unavailable and is not claimed.

## Frozen fixtures

SHA-256 computed in this review:

| File | SHA-256 | Rows |
| --- | --- | --- |
| `snapshots/session/team-orchestration/session.v4.jsonl` | `28250b55f94a3a19c3b80a249a16e729e972c6dbceab81937aa8dff80272ba48` | 138 |
| `session.1.v4.jsonl` | `cf70825fe6f0f01919ff4fb7e1f8008e690573ea0d46db660c131bfa5208f779` | 54 |
| `session.2.v4.jsonl` | `5ae919705caf5a0046278fd60cd3994ad11b7e64b44967c5fe36e5f33581fd11` | 81 |

These match `cursor-team-replay-implementation-review.md` and `root-stage-a-final-verification.json`. No JSONL, override, or normalizer edit is part of accepting this cleanup.

## Source hashes (this review)

| File | SHA-256 |
| --- | --- |
| `packages/test-support/llm-replay/src/causal-team-schedule.ts` | `0fd608cbe8e8ae3e2ee2ee21db75eec757911acf06499cdf22fb5c778970e4e9` |
| `src/index.ts` | `e205a525f065232149208eba2cb05be142fd49ff0c135d883f734cedad313272` |
| `tests/causal-team-schedule.spec.ts` | `b6fb8a8b611f3b7b239f4e18ad00245cc0f714923d29d89f73eda5612267eb65` |
| `tests/llm-replay.spec.ts` | `7537d403181fb588b123b15aecd7dd378501b63e11064014180dbf4a5c96a88c` |
| `package.json` | `5590561968026c635131898a516738e70764bc48191b9db2c082837d2b73f829` |
| `tsconfig.json` | `6a30f829f2ad8637afa893ad08eee6a9b52dfd691f7132ddbf31a408fe63162f` |
| `tsconfig.check.json` | `b4aece92cf18edda40dd61b8113a12a8e955ae1b741b1edc53557f152e51acae` |
| `README.md` | `ac5d5780ff3c25069dff8026da6031f7c87d53cd0300645767b6429c30e4fa4f` |
| `README.zh.md` | `4c3db1b2be548f9443d6e300ea2303a0532d980d7ca38a9fa8c167fcb6b6882a` |
| `README.i18n.yaml` | `ab9fecac9e57610d0d8db184e89f1dfe47c5348833ff72c738d3014a7619a37e` |
| `packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts` | `be2ec5dafbf72d5ad04de13a9140fb4c51f8ee49dfed4af5b8a2417e5f26851e` |
| `snapshots/session/headless.snapshot.ts` | `cd456de8256a60521d0cbf9958e0346e14c489460763db6ea019a20aa62e876a` |

`tsconfig.check.json` sets `composite: false`, `noEmit: true`, and includes `src` plus `tests`. No aggregate references it. `package.json` adds `@deepseek-ai/dsh-agent`, `dsh-agent-loop-testkit`, `dsh-experimental-agent-team`, `dsh-permission-presets`, `dsh-subagent`, and `dsh-tools` under `devDependencies` only. `llm-replay.spec.ts` imports `@deepseek-ai/dsh-permission-presets` and does not import `interaction/permission-presets/src`.

## Evidence

| Check | Result |
| --- | --- |
| `pnpm --config.enable-global-virtual-store=false --config.verify-deps-before-run=error exec tsc -p packages/test-support/llm-replay/tsconfig.check.json --pretty false` | exit 0, no diagnostics |
| same prefix, `tsc -p packages/test-support/llm-replay/tsconfig.json --noEmit --pretty false` | exit 0, no diagnostics |
| same prefix, `vitest run packages/test-support/llm-replay/tests/causal-team-schedule.spec.ts --reporter=verbose` | exit 0, 14 passed, 3.07s |
| same prefix, `tsx scripts/verify-translation-pairing.ts packages/test-support/llm-replay/README.md` | exit 0, 1 named pair consistent |
| `root-team-replay-src-and-tests-final-check.log` | 0 bytes on disk. A clean `tsc` prints nothing; this review's rerun is the typecheck evidence |
| `root-stage-a-final-runtime-tests.log` | vitest summary: 3 files, 181 passed, 11.82s. Titles and the shell exit line are absent. `root-stage-a-final-verification.json` records exit 0. Not re-run here |
| `root-stage-a-final-strict-replays.log` | vitest summary: 8 passed, 148 skipped, 49.63s wall. Names are absent. The verification JSON records exit 0. Not re-run here |
| Fixture SHA-256 | unchanged, table above |
| Paid model call | none |

## Not claimed

- A6 installed acceptance, a DMG, or a Host install path. Those remain open.
- B1 behavior. That source was left untouched.
- Re-execution of the 181-test runtime log or the eight strict replay and header checks. The no-weakening conclusion is from the comparator source and the frozen fixture hashes.
- Historical equality between `system-prompt.1/.2.expected.md` and paid-run prompt bytes. Those bytes are not in the JSONL.
