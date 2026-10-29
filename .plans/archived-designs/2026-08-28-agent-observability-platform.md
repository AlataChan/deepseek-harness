# Agent Observability and Control Platform Implementation Plan

English | [中文](2026-08-28-agent-observability-platform.zh.md)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build one event-sourced observability platform that supports single-session diagnosis, team-wide reliability analysis, policy-based intervention, and controlled replay evaluation without adding behavior to `agent-loop`.

**Architecture:** A deterministic `sessionDiagnostics` projection derives evidence-backed findings from the canonical Session Event log. Browser UI, live guard policy, OpenTelemetry export, and replay evaluation consume the same finding fields; derived findings remain replaceable projection state, while every model-visible intervention uses an existing logged message or tool-result path. Fleet analytics use bounded OTel metrics and traces without session ids on metric labels, and automatic intervention remains disabled until replay evidence promotes an individual rule.

**Tech Stack:** TypeScript, Cordis services and events, `@deepseek-ai/dsh-session-projection`, React slot plugins, Zod/Schemastery, OpenTelemetry Logs/Metrics/Tracing, Vitest, Loader composition tests, ACP/headless/Web snapshots.

---

## Delivery rules

- Deliver the work as an official GitHub stack. Each phase below is independently reviewable and leaves the default product safe.
- Keep `SessionEventMap` unchanged in the first four phases. Findings are deterministic projections; advisory interventions become ordinary source-attributed `user/message` records, and blocked calls remain ordinary `tool/result` records. Add a durable event only if implementation proves that neither existing record can reconstruct a policy decision.
- Keep telemetry `DISABLED` by default. Enabling export defaults to metadata-only redaction; content export requires an additional explicit setting.
- Do not add dollar-cost policy until the LLM capability exposes a provider-independent pricing source. Token, step, wall-clock, error, and tool-call budgets are in scope.
- Do not add a model-based judge to the live request path. Optional judges run only in evaluation jobs and their outputs never authorize a live intervention.
- Every rule has one stable code, severity, evidence sequence numbers, threshold inputs, and a deterministic recovery condition. UI strings are localized client-side rather than stored in projection state.

## Phase 1 — Deterministic findings and local inspection

### Task 1: Record the architecture decision

**Files:**

- Create: `.agents/notes/proposed/architecture/2026-08-28-agent-observability-control-plane.md`
- Create: `.agents/notes/proposed/architecture/2026-08-28-agent-observability-control-plane.zh.md`
- Create: `.agents/notes/proposed/architecture/2026-08-28-agent-observability-control-plane.i18n.yaml`

**Step 1: Write the proposed Agent Note**

Record these decisions:

- The canonical Session Event log is the only fact source.
- `sessionDiagnostics` is a synchronous, plain-JSON projection and never appends findings back into the log.
- A finding contains `id`, `code`, `severity`, `status`, `firstSeq`, `lastSeq`, `evidenceSeqs`, `scope`, and numeric/string `facts`; it contains no localized prose or copied message/tool payload.
- Policies consume finding codes and independent accounting projections. They cannot consume UI state.
- The default policy mode is `observe`; `advise` may inject source-attributed context; `enforce` is restricted to deterministic rules explicitly allowed by config.
- Metrics exclude high-cardinality session, message, call, path, and prompt values.
- Replay evaluation owns model-based judging and policy promotion evidence.

Document alternatives: raw-log-only UI, durable finding events, a model judge in the live loop, and a monolithic external monitoring service.

**Step 2: Record the bilingual pair**

Run:

```sh
pnpm run verify-translation-pairing --write .agents/notes/proposed/architecture/2026-08-28-agent-observability-control-plane.md
```

Expected: the consistency sidecar is created and the pair passes.

**Step 3: Validate the note**

Run:

```sh
pnpm run verify-agent-note-format
pnpm run verify-md-links
git diff --check
```

Expected: all commands pass.

**Step 4: Commit**

```sh
git add .agents/notes/proposed/architecture/2026-08-28-agent-observability-control-plane.*
git commit -m "docs: design the agent observability control plane"
```

### Task 2: Add the `sessionDiagnostics` projection

**Files:**

- Create: `packages/session/session-diagnostics/package.json`
- Create: `packages/session/session-diagnostics/tsconfig.json`
- Create: `packages/session/session-diagnostics/tsdown.config.ts`
- Create: `packages/session/session-diagnostics/src/types.ts`
- Create: `packages/session/session-diagnostics/src/projection.ts`
- Create: `packages/session/session-diagnostics/src/index.ts`
- Create: `packages/session/session-diagnostics/src/invariant.ts`
- Create: `packages/session/session-diagnostics/tests/projection.spec.ts`
- Create: `packages/session/session-diagnostics/README.md`
- Create: `packages/session/session-diagnostics/README.zh.md`
- Create: `packages/session/session-diagnostics/README.i18n.yaml`
- Modify: `packages/session/README.md`
- Modify: `packages/session/README.zh.md`
- Modify: `packages/session/README.i18n.yaml`
- Modify: `tsconfig.host.json`

**Step 1: Write failing projection tests**

Cover the first closed rule set:

```ts
type SessionDiagnosticCode =
  | 'repeated-tool-call'
  | 'consecutive-tool-errors'
  | 'tool-latency'
  | 'step-latency'
  | 'llm-retry'
  | 'abnormal-turn-end'
```

Tests must prove:

- property-order-only argument changes remain the same repeated call;
- an unrelated tracked call closes a repeat run;
- successful tool results close an error run;
- completed tool and step pairs produce latency findings only at or above configured thresholds;
- retry and abnormal turn-end evidence points at exact event sequence numbers;
- an uninterested event returns the same state reference;
- state and wire schemas reject malformed findings;
- evidence is capped without losing `firstSeq`/`lastSeq`;
- the fold gives the same result in one pass and after checkpoint restore.

**Step 2: Run the focused test and observe failure**

Run:

```sh
pnpm exec vitest run packages/session/session-diagnostics/tests/projection.spec.ts
```

Expected: FAIL because the package and projection do not exist.

**Step 3: Implement the public fields and pure fold**

Use branded `SessionDiagnosticId`; derive it deterministically from `code`, scope identity, and `firstSeq`. Keep all state JSON-compatible.

```ts
export interface SessionDiagnosticFinding {
  readonly id: SessionDiagnosticId
  readonly code: SessionDiagnosticCode
  readonly severity: 'info' | 'warn' | 'error'
  readonly status: 'active' | 'resolved'
  readonly firstSeq: number
  readonly lastSeq: number
  readonly evidenceSeqs: readonly number[]
  readonly scope: {
    readonly turn?: number
    readonly step?: number
    readonly callId?: string
    readonly tool?: string
  }
  readonly facts: Readonly<Record<string, string | number | boolean>>
}
```

`SessionDiagnosticsState` may retain compact detector working state in addition to findings, but `wire.view()` returns only findings and aggregate counts. Config owns `repeatWarnAt`, `errorRunWarnAt`, `slowToolMs`, `slowStepMs`, and `maxEvidenceSeqs`; every field is validated at load and has a documented default.

**Step 4: Register the projection**

Merge `sessionDiagnostics` into both `SessionProjectionStateMap` and `SessionProjectionMap`, export client-safe types from `src/client.ts`, and register exactly one definition through `ctx.sessionProjections.register()`.

**Step 5: Pass focused package tests**

Run:

```sh
pnpm exec vitest run packages/session/session-diagnostics/tests
```

Expected: PASS.

**Step 6: Update package documentation and compile references**

Document configuration, finding semantics, replay/checkpoint behavior, zero direct model effect, and the distinction between evidence fields and localized presentation. Re-record both bilingual README pairs.

**Step 7: Commit**

```sh
git add packages/session/session-diagnostics packages/session/README* tsconfig.host.json
git commit -m "feat(session): derive evidence-backed diagnostics"
```

### Task 3: Mount diagnostics in the base composition

**Files:**

- Modify: `packages/bundle/base/cordis.patch.yml`
- Modify: `packages/bundle/base/package.json`
- Modify: `packages/bundle/base/tests/base.spec.ts`
- Create: `packages/session/session-diagnostics/tests/loader-composition.e2e.ts`
- Create: `examples/headless-agent/tests/fixtures/session-diagnostics.cordis.yml`
- Create: `examples/headless-agent/tests/fixtures/session-diagnostics-driver.ts`

**Step 1: Write the real Loader test**

Boot the fixture through the shared subprocess launcher, append a repeated-call sequence, request the projection snapshot, and assert the stable finding code and evidence seqs.

**Step 2: Verify the test fails before composition**

Run:

```sh
pnpm exec vitest run packages/session/session-diagnostics/tests/loader-composition.e2e.ts
```

Expected: FAIL because the Loader tree has no diagnostics row.

**Step 3: Add one base row**

Mount `session-diagnostics` after `session-projection`. Keep defaults in the plugin's `resolveConfig()`; the bundle row must not repeat tunable values.

**Step 4: Pass composition tests**

Run:

```sh
pnpm exec vitest run packages/session/session-diagnostics/tests packages/bundle/base/tests/base.spec.ts
```

Expected: PASS.

**Step 5: Commit**

```sh
git add packages/bundle/base packages/session/session-diagnostics/tests examples/headless-agent/tests/fixtures/session-diagnostics*
git commit -m "feat(bundle): mount session diagnostics"
```

### Task 4: Add a Diagnostics conversation view and Trajectory evidence links

**Files:**

- Create: `packages/client/ui-diagnostics/package.json`
- Create: `packages/client/ui-diagnostics/tsconfig.json`
- Create: `packages/client/ui-diagnostics/tsdown.config.ts`
- Create under that package: `src/client/index.ts`, `src/client/DiagnosticsView.tsx`, `src/client/DiagnosticsView.module.css`, and `src/client/locales.ts`
- Create under that package: `src/index.ts`, `src/invariant.ts`, `tests/diagnostics-view.client.spec.tsx`, and `tests/apply.client.spec.ts`
- Create under that package: `README.md`, `README.zh.md`, and `README.i18n.yaml`
- Modify: `packages/client/ui-conversation/src/client/contract/views.ts`
- Modify: `packages/client/ui-conversation/src/client/stores.ts`
- Modify: `packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx`
- Modify: `packages/client/ui-trajectory/src/client/TrajectoryView.tsx`
- Modify: `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx`
- Modify: `packages/client/ui-trajectory/tests/table.client.spec.tsx`
- Modify: `packages/bundle/client-app/cordis.patch.yml`
- Modify: `packages/bundle/client-app/package.json`
- Modify: `tsconfig.client.json`

**Step 1: Write failing component tests**

Prove that the view:

- reads only `useProjection('sessionDiagnostics')`;
- groups active findings before resolved findings and orders severity deterministically;
- shows code-specific localized title, explanation, threshold facts, and exact evidence seqs;
- exposes severity without using color alone;
- handles projection absence and an empty finding list;
- sends `{ eventSeq }` through the existing one-shot conversation inspect channel.

**Step 2: Extend the inspect target**

Change the shared target from `{ callId }` to the discriminated union:

```ts
export type InspectTarget =
  | { readonly kind: 'tool-call'; readonly callId: CallId }
  | { readonly kind: 'event'; readonly eventSeq: number }
```

Migrate the existing Chat tool-call handoff and make Trajectory reveal, unfold, select, and scroll to the record containing `eventSeq`. Clear the one-shot target only after the record is loaded; if the seq is older than the current page, load older pages until found or history is exhausted.

**Step 3: Implement the slot plugin**

Register a `conversation.view` entry with id `diagnostics`, order after Trajectory, bilingual labels, and no new service. Components receive only standard slot shares and callbacks from `inject`.

**Step 4: Run focused browser-unit tests**

Run:

```sh
pnpm exec vitest run packages/client/ui-diagnostics/tests packages/client/ui-trajectory/tests packages/client/ui-conversation/tests
```

Expected: PASS.

**Step 5: Add the assembled Web snapshot**

Extend the keyless browser replay with a session that produces one repeated-tool finding and one tool-error finding. Assert the Diagnostics tab, evidence details, and evidence-to-Trajectory navigation.

Run:

```sh
pnpm run test:web -- -g diagnostics
```

Expected: PASS after reviewing the new snapshot.

**Step 6: Commit**

```sh
git add packages/client/ui-diagnostics packages/client/ui-conversation packages/client/ui-trajectory packages/bundle/client-app tsconfig.client.json apps/web/tests
git commit -m "feat(client): inspect session diagnostics"
```

## Phase 2 — Live budgets and deterministic intervention

### Task 5: Replace the standalone repeat reminder with a unified diagnostic policy

**Files:**

- Create: `packages/guard/diagnostic-policy/package.json`
- Create: `packages/guard/diagnostic-policy/tsconfig.json`
- Create: `packages/guard/diagnostic-policy/tsdown.config.ts`
- Create: `packages/guard/diagnostic-policy/src/index.ts`
- Create: `packages/guard/diagnostic-policy/src/config.ts`
- Create: `packages/guard/diagnostic-policy/src/invariant.ts`
- Create: `packages/guard/diagnostic-policy/tests/policy.spec.ts`
- Create: `packages/guard/diagnostic-policy/tests/loader-composition.e2e.ts`
- Create: `packages/guard/diagnostic-policy/README.md`
- Create: `packages/guard/diagnostic-policy/README.zh.md`
- Create: `packages/guard/diagnostic-policy/README.i18n.yaml`
- Modify: `packages/bundle/base/cordis.patch.yml`
- Modify: `packages/bundle/base/package.json`
- Remove after parity is proven: `packages/guard/repeat-tool-reminder/`
- Modify: `packages/guard/README.md`
- Modify: `packages/guard/README.zh.md`
- Modify: `tsconfig.host.json`

**Step 1: Write a policy matrix test**

Use three modes:

```ts
type DiagnosticPolicyMode = 'observe' | 'advise' | 'enforce'
```

Prove:

- `observe` never changes a request or tool result;
- `advise` reproduces the current repeat-tool reminder at configured counts;
- `enforce` blocks only explicitly allowlisted finding codes at explicit thresholds;
- an absent diagnostics projection fails loud at plugin load or first resolvable agent event;
- every waterfall calls `next()` unless it intentionally returns a documented block/reject decision;
- per-session state cannot cross into a parent, child, or sibling agent.

**Step 2: Implement policy consumption**

Read findings with `ctx.sessionProjections.stateOf(agent.session, 'sessionDiagnostics')`. Reuse existing `tools/post-execute` additional context for advice and its block result for enforcement. Stamp advice with source `{ kind: 'plugin', plugin: 'diagnostic-policy', form: 'notice' }` so model-visible intervention remains reconstructable.

**Step 3: Prove behavioral parity before deletion**

Run old and new package tests against the same scripted call sequences. Delete `repeat-tool-reminder` only after the new advisory output and reset semantics are pinned by the existing snapshot tier.

**Step 4: Replace the base row and pass the Loader test**

Default to `mode: observe`. A deployment must explicitly patch `advise` or `enforce`.

**Step 5: Commit**

```sh
git add packages/guard packages/bundle/base tsconfig.host.json
git commit -m "feat(guard): unify diagnostic policy enforcement"
```

### Task 6: Add per-turn and per-session resource budgets

**Files:**

- Modify: `packages/guard/diagnostic-policy/src/config.ts`
- Modify: `packages/guard/diagnostic-policy/src/index.ts`
- Modify: `packages/guard/diagnostic-policy/tests/policy.spec.ts`
- Modify: `packages/guard/diagnostic-policy/README.md`
- Modify: `packages/guard/diagnostic-policy/README.zh.md`
- Modify: `packages/guard/diagnostic-policy/README.i18n.yaml`
- Modify: `examples/headless-agent/tests/scenarios.ts`
- Create: `examples/headless-agent/tests/snapshots/diagnostic-budget.jsonl`

**Step 1: Write failing budget tests**

Cover independently configurable limits for:

- steps per turn;
- tool calls per turn;
- provider-reported tokens per session;
- consecutive tool errors;
- context-pressure ratio before the next request.

Read accounting from `sessionStats`, `tokenUsage`, and `contextPressure`; do not duplicate their folds. Missing optional projections make only their corresponding budget unavailable and emit one local warning, while a configured budget whose required projection is missing fails loud.

**Step 2: Implement admission behavior**

- `observe`: publish no model-visible content.
- `advise`: inject one bounded warning before the next request.
- `enforce`: reject the next step with an actionable, source-attributed message; do not cancel an in-flight tool or mutate completed history.

**Step 3: Add a keyless assembled snapshot**

The scenario must show a real runnable agent reaching a tool-call budget, receiving one notice, and ending without an extra model request. Pin the persisted JSONL so the intervention's source and turn closure are auditable.

**Step 4: Run checks**

```sh
pnpm exec vitest run packages/guard/diagnostic-policy/tests
pnpm run test:snapshot -- -t diagnostic-budget
```

Expected: PASS.

**Step 5: Commit**

```sh
git add packages/guard/diagnostic-policy examples/headless-agent/tests
git commit -m "feat(guard): enforce agent resource budgets"
```

## Phase 3 — Privacy-safe fleet telemetry

### Task 7: Add a default metadata redaction policy

**Files:**

- Create: `packages/session/session-telemetry-redaction/package.json`
- Create: `packages/session/session-telemetry-redaction/tsconfig.json`
- Create: `packages/session/session-telemetry-redaction/tsdown.config.ts`
- Create: `packages/session/session-telemetry-redaction/src/index.ts`
- Create: `packages/session/session-telemetry-redaction/src/invariant.ts`
- Create: `packages/session/session-telemetry-redaction/tests/redaction.spec.ts`
- Create: `packages/session/session-telemetry-redaction/README.md`
- Create: `packages/session/session-telemetry-redaction/README.zh.md`
- Create: `packages/session/session-telemetry-redaction/README.i18n.yaml`
- Modify: `packages/bundle/base/cordis.patch.yml`
- Modify: `packages/bundle/base/package.json`
- Modify: `docs/subsystems/session-telemetry.md`
- Modify: `docs/subsystems/session-telemetry.zh.md`

**Step 1: Write fail-closed redaction tests**

Define `contentMode: 'metadata' | 'diagnostic' | 'full'`, default `metadata`.

- `metadata` removes message text, tool arguments/results, system prompts, schemas, feedback text, cwd, and local paths; it preserves event identity, types, sizes, timing, finish reasons, error codes, tool names, provider/model names, usage, and diagnostic codes.
- `diagnostic` additionally permits bounded error summaries after secret and path replacement.
- `full` retains content but still applies configured key-name and value-pattern secret removal.
- A redaction exception drops the record through the existing coordinator containment.

**Step 2: Implement one `session-telemetry/record` waterfall listener**

Transform a detached copy only. Never rewrite the canonical Session log. Add structured metadata fields instead of placeholder prose where consumers need aggregation.

**Step 3: Mount the policy before the OTel backend**

`DISABLED` remains the exporter default. Uploading without an explicit `contentMode` exports metadata only.

**Step 4: Update telemetry documentation and tests**

Update the current statement that no rules are mounted by default. Add invalid cases for every sensitive event family and re-record the bilingual pairs.

**Step 5: Commit**

```sh
git add packages/session/session-telemetry-redaction packages/session/session-telemetry* packages/bundle/base docs/subsystems/session-telemetry*
git commit -m "feat(telemetry): redact exported sessions by default"
```

### Task 8: Project OTel traces and metrics from the ledger stream

**Files:**

- Modify: `packages/session/session-telemetry-otel/package.json`
- Modify: `packages/session/session-telemetry-otel/src/index.ts`
- Create there: `src/trace-fold.ts` and `src/metric-fold.ts`
- Modify: `packages/session/session-telemetry-otel/tests/otel.spec.ts`
- Create there: `tests/trace-fold.spec.ts` and `tests/metric-fold.spec.ts`
- Modify: `packages/session/session-telemetry-otel/README.md`
- Modify: `packages/session/session-telemetry-otel/README.zh.md`
- Modify: `packages/session/session-telemetry-otel/README.i18n.yaml`

**Step 1: Write pure reconstruction tests**

Reconstruct this hierarchy from ledger records:

```text
session
└── turn
    └── step
        ├── llm request
        └── tool call
```

Prove correct pairing for success, retry, cancellation, timeout, missing final records, resumed streams, forks, and feedback-only historical replay.

**Step 2: Define bounded semantic fields**

Metrics:

- counters: turns, steps, LLM requests, retries, tool calls, tool errors, abnormal endings, diagnostic findings;
- histograms: TTFT, decode duration, step duration, tool duration, input/output/cache tokens;
- attributes: service version, provider, model, preset, tool name, finish category, finding code.

Never attach `session.id`, call id, prompt, path, error message, or user id to metrics. Traces and logs retain correlation ids under the selected redaction mode.

**Step 3: Add optional SDK pipelines**

Keep logs configuration compatible in role but fail loud on incomplete metrics/traces endpoints. Each pipeline owns its SDK processor and joins the existing bounded shutdown sequence. Do not create any provider in `DISABLED`.

**Step 4: Test with in-memory exporters**

Assert exact span relationships, timestamps, metric labels, no forbidden high-cardinality attributes, and final flush behavior.

**Step 5: Commit**

```sh
git add packages/session/session-telemetry-otel
git commit -m "feat(telemetry): export agent traces and metrics"
```

### Task 9: Ship an operator reference deployment

**Files:**

- Create: `examples/observability/README.md`
- Create: `examples/observability/otel-collector.yaml`
- Create: `examples/observability/prometheus.yaml`
- Create: `examples/observability/grafana/provisioning/datasources/datasources.yaml`
- Create: `examples/observability/grafana/provisioning/dashboards/dashboards.yaml`
- Create: `examples/observability/grafana/dashboards/dsh-agent-health.json`
- Create: `examples/observability/docker-compose.yml`
- Create: `examples/observability/tests/config.spec.ts`
- Modify: `examples/README.md`
- Modify: `examples/README.zh.md`

**Step 1: Write static configuration tests**

Reject public bind addresses, default credentials, missing health checks, unknown metric names, and dashboard queries with forbidden high-cardinality labels.

**Step 2: Add the local-only stack**

Expose collector, Prometheus, Tempo, and Grafana on loopback. The dashboard must include reliability, latency, token/cache, tool health, diagnostic-code, and version/model comparison panels.

**Step 3: Add an optional Docker smoke**

Boot the stack, send a fixture OTLP payload, query one metric and one trace, then dispose the complete stack. Self-skip only when Docker is unavailable.

**Step 4: Commit**

```sh
git add examples/observability examples/README*
git commit -m "docs(example): add the agent observability stack"
```

## Phase 4 — Replay evaluation and safe policy promotion

### Task 10: Define the evaluation capability

**Files:**

- Create: `packages/evaluation/evaluation/package.json`
- Create: `packages/evaluation/evaluation/tsconfig.json`
- Create: `packages/evaluation/evaluation/tsdown.config.ts`
- Create: `packages/evaluation/evaluation/src/index.ts`
- Create: `packages/evaluation/evaluation/src/types.ts`
- Create: `packages/evaluation/evaluation/src/invariant.ts`
- Create: `packages/evaluation/evaluation/tests/service.spec.ts`
- Create: `packages/evaluation/evaluation/README.md`
- Create: `packages/evaluation/evaluation/README.zh.md`
- Create: `packages/evaluation/evaluation/README.i18n.yaml`
- Modify: `packages/README.md`
- Modify: `packages/README.zh.md`
- Modify: `tsconfig.host.json`

**Step 1: Write the Service Definition tests**

Define branded evaluation/run/candidate ids and this minimum request:

```ts
export interface EvaluationRequest {
  readonly sourceSessionId: SessionId
  readonly atSeq: number
  readonly prompt: readonly PromptContentPart[]
  readonly candidates: readonly {
    readonly id: EvaluationCandidateId
    readonly agentPreset: string
  }[]
  readonly limits: {
    readonly timeoutMs: number
    readonly maxSteps: number
    readonly maxTokens: number
  }
}
```

The result contains child session ids, diagnostics, resource measurements, world-verification results, optional judge scores, and explicit incomplete/cancelled/error states. Duplicate candidate ids and invalid boundaries fail before any child is created.

**Step 2: Implement only the capability contract and lifecycle**

`ctx.evaluations.run()` returns an owned handle with snapshot, subscription, cancellation, and disposal. The Service Definition does not create agents or choose a scoring strategy.

**Step 3: Test registration, duplicate provider rejection, cancellation, and disposer behavior**

**Step 4: Commit**

```sh
git add packages/evaluation packages/README* tsconfig.host.json
git commit -m "feat(evaluation): define replay evaluation capability"
```

### Task 11: Implement the session-fork evaluation provider

**Files:**

- Create: `packages/evaluation/evaluation-session-fork/package.json`
- Create: `packages/evaluation/evaluation-session-fork/tsconfig.json`
- Create: `packages/evaluation/evaluation-session-fork/tsdown.config.ts`
- Create: `packages/evaluation/evaluation-session-fork/src/index.ts`
- Create: `packages/evaluation/evaluation-session-fork/src/run.ts`
- Create: `packages/evaluation/evaluation-session-fork/src/invariant.ts`
- Create: `packages/evaluation/evaluation-session-fork/tests/run.spec.ts`
- Create: `packages/evaluation/evaluation-session-fork/tests/loader-composition.e2e.ts`
- Create: `packages/evaluation/evaluation-session-fork/README.md`
- Create: `packages/evaluation/evaluation-session-fork/README.zh.md`
- Create: `packages/evaluation/evaluation-session-fork/README.i18n.yaml`

**Step 1: Write the lifecycle tests**

Use real `ctx.sessions.fork()` semantics and the real `ctx.agents.createAgent()` transaction, mocking only the LLM adapter and clock. Prove:

- every candidate receives the exact same source prefix and prompt;
- candidate preset setup is mounted before publication;
- candidate sessions remain distinct children with reconstructable lineage;
- one candidate failure does not cancel siblings unless the whole run is cancelled;
- timeout and token/step limits quiesce and dispose every owned AgentHandle;
- the source session is never mutated;
- world verification reads files or commands externally instead of trusting assistant prose.

**Step 2: Implement bounded parallel candidates**

Use a validated `concurrency` config. Create child ids before launch, but publish each child only through the existing agent creation transaction. Persist evaluation results outside source Session history; child sessions already preserve their own evidence.

**Step 3: Add deterministic scoring**

Start with rule-based fields only: completion state, negative feedback, diagnostic severity counts, steps, tool errors, tokens, and elapsed time. Normalize each field separately; do not collapse everything into one unexplained score.

**Step 4: Add optional judge scoring as a separate provider hook**

The judge receives redacted deliverables and verification results, never raw credentials or unrestricted workspace access. Its score is labeled nondeterministic and cannot promote a policy by itself.

**Step 5: Pass real composition and built-artifact tests**

**Step 6: Commit**

```sh
git add packages/evaluation/evaluation-session-fork
git commit -m "feat(evaluation): compare agents from session forks"
```

### Task 12: Add evaluation UI and result comparison

**Files:**

- Create: `packages/client/ui-evaluation/package.json`
- Create: `packages/client/ui-evaluation/tsconfig.json`
- Create: `packages/client/ui-evaluation/tsdown.config.ts`
- Create under that package: `src/client/index.ts`, `src/client/EvaluationView.tsx`, `src/client/EvaluationView.module.css`, and `src/client/locales.ts`
- Create under that package: `src/index.ts`, `src/invariant.ts`, and `tests/evaluation-view.client.spec.tsx`
- Modify: `packages/api/remotes/src/types.ts`
- Modify: `packages/api/remotes/src/index.ts`
- Modify: `packages/api/remotes/src/client/index.ts`
- Modify: `packages/client/runtime/src/client/contract/sessions.ts`
- Modify: `packages/client/runtime/src/client/sessions/service.ts`
- Modify: `packages/bundle/client-app/cordis.patch.yml`
- Modify: `packages/bundle/client-app/package.json`
- Modify: `tsconfig.client.json`

**Step 1: Add typed remote operations**

Expose start, inspect, cancel, and dispose operations plus a streamed snapshot. Validate every wire request and use branded ids throughout.

**Step 2: Write UI tests**

The comparison table shows candidates as columns and diagnostics, completion, steps, tokens, latency, tool errors, verification, and judge results as separate rows. Never hide missing data behind zero. Provide links to each child Session's Diagnostics and Trajectory views.

**Step 3: Add a keyless browser snapshot**

Use scripted candidates with one successful result, one tool loop, and one timeout. Pin start, live progress, comparison, cancellation, and child navigation.

**Step 4: Update both SDK projections if the remote protocol changes their generated outputs**

Run TypeScript JSON-RPC and Python single-executable snapshot generators and review the diffs.

**Step 5: Commit**

```sh
git add packages/client/ui-evaluation packages/api/remotes packages/client/runtime packages/bundle/client-app examples/jsonrpc-agent scripts/snapshots/python-sdk-single-exe apps/web/tests tsconfig.client.json
git commit -m "feat(client): compare replay evaluations"
```

### Task 13: Add evidence-based policy promotion

**Files:**

- Create: `packages/evaluation/evaluation-policy-report/package.json`
- Create: `packages/evaluation/evaluation-policy-report/tsconfig.json`
- Create: `packages/evaluation/evaluation-policy-report/tsdown.config.ts`
- Create: `packages/evaluation/evaluation-policy-report/src/index.ts`
- Create: `packages/evaluation/evaluation-policy-report/src/report.ts`
- Create: `packages/evaluation/evaluation-policy-report/tests/report.spec.ts`
- Create: `packages/evaluation/evaluation-policy-report/README.md`
- Modify: `packages/guard/diagnostic-policy/README.md`
- Modify: `packages/guard/diagnostic-policy/README.zh.md`

**Step 1: Define promotion evidence**

A rule may be recommended for `advise` or `enforce` only when a report names:

- baseline and candidate policy configurations;
- sample count and task strata;
- completion, world-verification, resource, and diagnostic deltas;
- false-positive examples;
- confidence interval or an explicit “insufficient sample” result;
- every regression threshold that blocks promotion.

**Step 2: Write failing statistical and safety tests**

Include zero samples, imbalanced strata, regressions hidden by averages, all-timeout candidates, judge-only improvement, and a safe deterministic win.

**Step 3: Generate a report, never mutate deployment config**

The package emits JSON and Markdown artifacts. A human applies the recommended patch. Automatic config mutation remains out of scope until a separate approval and rollback design exists.

**Step 4: Commit**

```sh
git add packages/evaluation/evaluation-policy-report packages/guard/diagnostic-policy/README*
git commit -m "feat(evaluation): report policy promotion evidence"
```

## Phase 5 — Final integration and release gates

### Task 14: Verify the complete assembled product

**Files:**

- Modify: `.agents/notes/proposed/architecture/2026-08-28-agent-observability-control-plane.md`
- Modify: `.agents/notes/proposed/architecture/2026-08-28-agent-observability-control-plane.zh.md`
- Move after implementation: both notes and sidecar to `.agents/notes/implemented/architecture/`
- Modify: `docs/architecture.md`
- Modify: `docs/architecture.zh.md`
- Modify: `docs/subsystems/README.md`
- Modify: `docs/subsystems/README.zh.md`
- Create or regenerate: the owning subsystem and generated Cordis references required by changed public types

**Step 1: Run focused behavioral suites**

```sh
pnpm exec vitest run packages/session/session-diagnostics/tests packages/guard/diagnostic-policy/tests packages/session/session-telemetry-redaction/tests packages/session/session-telemetry-otel/tests packages/evaluation/evaluation/tests packages/evaluation/evaluation-session-fork/tests packages/evaluation/evaluation-policy-report/tests packages/client/ui-diagnostics/tests packages/client/ui-evaluation/tests
```

Expected: PASS.

**Step 2: Run assembled presentation and protocol checks**

```sh
pnpm run test:snapshot -- -t 'diagnostic|evaluation'
pnpm run test:web -- -g 'diagnostic|evaluation'
```

Expected: PASS with reviewed snapshots.

**Step 3: Run published-path and documentation checks**

Use `dsh-pre-push-checks` to choose the final outgoing-diff checks. At minimum run:

```sh
pnpm run doc-sync
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run hygiene
git diff --check
```

Expected: PASS. Run `pnpm run test:coverage` only if explicitly rehearsing the CI coverage gate; ordinary local delivery uses focused tests.

**Step 4: Update the Agent Note to shipped reality**

Move the complete triplet from `proposed/architecture` to `implemented/architecture`, change `Status`, replace proposal/acceptance prose with the implemented decision and consequences, and re-record the bilingual sidecar.

**Step 5: Commit documentation and generated references**

```sh
git add .agents/notes docs packages/*/README* packages/*/*/README*
git commit -m "docs: publish the observability platform architecture"
```

## Release sequence and success criteria

1. **Developer preview:** Tasks 1–4. A user can see a finding, understand its evidence, and jump to the exact Trajectory record.
2. **Safe control preview:** Tasks 5–6. Default behavior remains observation-only; explicit patches enable advice or deterministic enforcement.
3. **Team operations preview:** Tasks 7–9. Metadata-only export produces useful reliability dashboards without prompt or workspace content.
4. **Evaluation preview:** Tasks 10–12. The same source boundary can run multiple presets and compare verified outcomes.
5. **Governance release:** Tasks 13–14. Policy changes require measured evidence and human application; no live model judge or silent self-modification exists.

The platform is complete when the same diagnostic code can be reproduced from a persisted Session, rendered locally with exact evidence, counted without high-cardinality metric labels, used by an explicitly enabled live policy, and compared across replay candidates without mutating the source Session.
