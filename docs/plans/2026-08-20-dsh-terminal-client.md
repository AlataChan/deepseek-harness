# dsh Terminal Client Implementation Plan

English | [中文](2026-08-20-dsh-terminal-client.zh.md)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the bare `dsh` command a first-party, in-process interactive terminal client with durable resume, safe transcript rendering, tools, commands, approvals, user questions, cancellation, and cross-platform lifecycle behavior.

**Architecture:** A new `dsh-tui-app` profile bundle mounts a Node-only `dsh-tui` Cordis plugin directly over `dsh-base`. A framework-free reducer/store owns all product state; Cordis adapters translate Agent and Session activity into actions; Ink 7 and package-local React 19.2 render finalized rows into normal scrollback and keep only live state in the redraw region. The implementation does not compose Host RPC, HTTP, WebSocket, browser Client packages, or Tauri.

**Tech Stack:** TypeScript ESM, vendored Cordis, Ink 7.x, React 19.2+, Commander 15, Vitest, Schemastery, Loader composition tests, deterministic TTY streams, and the repository LLM replay snapshot harness.

---

## Scope and execution rules

The design authority is the proposed Agent Note at `.agents/notes/proposed/feature/2026-08-20-dsh-terminal-client.md`. If implementation reveals a product or architecture change, update and re-review that note before changing this plan's direction.

Execute on the visible feature branch or current working branch requested by the user, not in a hidden worktree. Preserve unrelated user files. Use test-driven development for every behavior task: add one failing focused test, run it and observe the expected failure, implement the minimum behavior, rerun the focused test, then commit that task.

Do not add Tauri code in this plan. The desktop phase begins only after Task 13 passes and receives its own Agent Note covering application identity, signing, updater channel, sidecar packaging, and WebView support.

Ink 7 currently requires Node 22 and React 19.2+. Pin one verified current 7.x release rather than a broad major range, and use a compatible exact React 19.2 release in `packages/ui/tui`; do not change the browser Client packages from React 18 as part of this work.

## Task 1: Lock the command-line product contract

**Files:**

- Modify: `apps/cli/src/args.ts`
- Modify: `apps/cli/tests/args.spec.ts`
- Modify: `apps/cli/package.json`

**Step 1: Add failing parser tests**

Add cases proving:

- `[]` resolves `{ mode: 'profile', profile: 'tui', patches: [], args: [] }`.
- `['write', 'the', 'tests']` routes the complete positional tail to the TUI.
- `['--resume']` and `['--resume', 'session-id']` remain TUI app arguments.
- `['tui', '--resume', 'session-id']` is the explicit TUI alias.
- `['exec', 'write', 'the', 'tests']` is the headless alias.
- `['--', 'web']` treats `web` as a TUI task while `['web']` keeps the Web alias.
- `--profile`, `--patch`, both config dumps, `web`, and `plugin` retain their existing ownership rules.
- Bare `-h` prints launcher help; `tui --help` and `exec --help` pass help to their app.

Run: `pnpm vitest run apps/cli/tests/args.spec.ts`

Expected: FAIL because the current root action requires `--profile` and no `tui` or `exec` aliases exist.

**Step 2: Implement the launcher grammar**

Make the root action default to profile `tui`. Add a small shared alias builder so `web`, `tui`, and `exec` use the same patch/dump behavior without copying the command definition. Map `exec` to `headless`. Keep launcher flags before inner arguments and keep app help owned by the booted app.

Update help copy and examples to name `dsh`, `dsh --resume`, `dsh exec`, `dsh web`, and the `--profile` advanced path.

**Step 3: Run focused tests**

Run: `pnpm vitest run apps/cli/tests/args.spec.ts`

Expected: PASS.

**Step 4: Commit**

```sh
git add apps/cli/src/args.ts apps/cli/tests/args.spec.ts apps/cli/package.json
git commit -m "feat(cli): make tui the default dsh surface"
```

## Task 2: Scaffold the Node-only TUI package and UI group

**Files:**

- Create: `packages/ui/README.md`
- Create: `packages/ui/README.zh.md`
- Create: `packages/ui/README.i18n.yaml`
- Create: `packages/ui/tui/package.json`
- Create: `packages/ui/tui/tsconfig.json`
- Create: `packages/ui/tui/tsdown.config.ts`
- Create: `packages/ui/tui/src/index.ts`
- Create: `packages/ui/tui/src/invariant.ts`
- Create: `packages/ui/tui/tests/invariant.spec.ts`
- Modify: `packages/README.md`
- Modify: `packages/README.zh.md`
- Modify: `packages/README.i18n.yaml`
- Modify: `tsconfig.base.json`
- Modify: `tsconfig.host.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `scripts/verify-package-readme-model-experience.ts`
- Modify: `scripts/verify-package-readme-limitations.ts` only if the package cannot satisfy the normal section directly

**Step 1: Add the package registration test**

Create an invariant test that mounts the empty package plugin and its invariant companion in a real Cordis context. The initial expectation is only that both exports load and dispose; later tasks add the package-owned lifecycle relationship.

Run: `pnpm vitest run packages/ui/tui/tests/invariant.spec.ts`

Expected: FAIL because the package does not exist.

**Step 2: Add package metadata and dependency isolation**

Declare `@deepseek-ai/dsh-tui` as ESM with root and `./invariant` exports. Add runtime dependencies on a pinned Ink 7.x, compatible React 19.2, `@deepseek-ai/cordis`, and only the Service Definition packages actually imported by `src`. Add `@types/react` compatible with React 19 to dev dependencies.

Do not put TUI source in `tsconfig.client.json`. Add its project reference to `tsconfig.host.json`. Add `packages/ui/*/src/invariant.ts` to the invariant wildcard in `tsconfig.base.json`. Add JSX compiler settings only to the TUI package project.

The group README defines `ui/` as Node-native presentation packages and lists `tui/` with no global `ctx` key. Update the root package hierarchy in both languages. Give the package README a `Model Experience` section and a `Known Limitations and Deferred Work` section.

Run `pnpm install` to update the lockfile; do not edit the lockfile manually.

**Step 3: Add minimal exports and pass the test**

Export `name = 'tui'`, a placeholder `apply()` with no behavior, and the standard package invariant identity. Do not render or create an Agent yet.

Run: `pnpm vitest run packages/ui/tui/tests/invariant.spec.ts`

Expected: PASS.

**Step 4: Verify the isolated React graph**

Run: `pnpm why react --filter @deepseek-ai/dsh-tui`

Expected: the TUI resolves React 19.2+ for Ink; browser Client packages retain React 18.

**Step 5: Commit**

```sh
git add packages/ui packages/README.md packages/README.zh.md packages/README.i18n.yaml tsconfig.base.json tsconfig.host.json package.json pnpm-lock.yaml scripts
git commit -m "feat(tui): scaffold the node terminal package"
```

## Task 3: Add TUI startup parsing and the process adapter

**Files:**

- Create: `packages/bundle/tui-app/package.json`
- Create: `packages/bundle/tui-app/tsconfig.json`
- Create: `packages/bundle/tui-app/tsdown.config.ts`
- Create: `packages/bundle/tui-app/src/startup.ts`
- Create: `packages/bundle/tui-app/tests/startup.spec.ts`
- Create: `packages/ui/tui/src/process.ts`
- Create: `packages/ui/tui/tests/process.spec.ts`
- Modify: `tsconfig.base.json`
- Modify: `tsconfig.host.json`

**Step 1: Write failing startup grammar tests**

Test `parseTuiStartupArgs()` for an empty fresh run, a joined initial task, selector resume, exact-id resume, `--help`, unknown flags, and the mutual exclusion of resume with a task. The result type is a closed union:

```ts
import type { SessionId } from '@deepseek-ai/dsh-session'

type TuiStartupValues =
  | { kind: 'fresh'; task?: string }
  | { kind: 'resume-picker' }
  | { kind: 'resume'; sessionId: SessionId }
```

Run: `pnpm vitest run packages/bundle/tui-app/tests/startup.spec.ts`

Expected: FAIL because the startup provider is absent.

**Step 2: Implement the startup provider**

Follow `packages/bundle/headless/src/startup.ts`: parse only from `ctx.cmdlineArgs`, publish `TUI_STARTUP_SERVICE`, and let Commander own app help and usage errors. Do not read `process.argv` directly.

**Step 3: Write failing process-adapter tests**

Test that the production policy requires both stdin and stdout TTY capability, emits guidance naming `dsh exec`, exposes terminal columns with a validated fallback supplied by configuration, and makes resize and exit subscriptions disposable. Use fake streams; do not introduce a test-only environment variable.

Run: `pnpm vitest run packages/ui/tui/tests/process.spec.ts`

Expected: FAIL because the adapter is absent.

**Step 4: Implement the adapter**

Create one `TuiProcess` interface for streams, TTY facts, dimensions, current directory, and exit request. Export a production constructor and a narrow test constructor. Keep all direct `process` access in this module. Do not register SIGINT or SIGTERM here; the shared profile launcher already owns process-level signals.

**Step 5: Run focused tests and commit**

Run: `pnpm vitest run packages/bundle/tui-app/tests/startup.spec.ts packages/ui/tui/tests/process.spec.ts`

Expected: PASS.

```sh
git add packages/bundle/tui-app packages/ui/tui/src/process.ts packages/ui/tui/tests/process.spec.ts tsconfig.base.json tsconfig.host.json
git commit -m "feat(tui): define startup and terminal process contracts"
```

## Task 4: Build the framework-free store and editor reducer

**Files:**

- Create: `packages/ui/tui/src/state/types.ts`
- Create: `packages/ui/tui/src/state/reducer.ts`
- Create: `packages/ui/tui/src/state/store.ts`
- Create: `packages/ui/tui/src/state/selectors.ts`
- Create: `packages/ui/tui/src/state/editor.ts`
- Create: `packages/ui/tui/tests/state.spec.ts`
- Create: `packages/ui/tui/tests/editor.spec.ts`

**Step 1: Write failing state tests**

Cover fresh state, monotonic finalized transcript rows, one live assistant row, overlay exclusivity, approval/question ownership, resize, runtime failure, and disposal. Prove stale settlement actions cannot close a newer interaction by giving each pending interaction an opaque locally minted id.

Run: `pnpm vitest run packages/ui/tui/tests/state.spec.ts`

Expected: FAIL because the state modules are absent.

**Step 2: Implement the reducer and store**

Use closed discriminated unions for local actions and overlays and end switches with `assertNever`. Make the store expose only `getSnapshot()`, `subscribe()`, and `dispatch()`. Freeze state exposed to subscribers in tests or construct it without mutable aliases; do not add runtime validation for typed internal actions.

**Step 3: Write failing editor tests**

Cover Unicode insertion, carriage-return submit, line-feed newline, left/right/home/end, backspace/delete, multiline paste, history traversal, empty submit, and the three-stage Ctrl+C policy. Treat terminal input decoding as an adapter action; the editor itself consumes semantic keys.

Run: `pnpm vitest run packages/ui/tui/tests/editor.spec.ts`

Expected: FAIL.

**Step 4: Implement the editor reducer**

Keep text and cursor offsets in one representation and use grapheme-aware movement. Do not add mouse, selection, image, or full-screen editing state.

**Step 5: Run focused tests and commit**

Run: `pnpm vitest run packages/ui/tui/tests/state.spec.ts packages/ui/tui/tests/editor.spec.ts`

Expected: PASS.

```sh
git add packages/ui/tui/src/state packages/ui/tui/tests/state.spec.ts packages/ui/tui/tests/editor.spec.ts
git commit -m "feat(tui): add the framework-free state core"
```

## Task 5: Project durable events into a terminal-safe transcript

**Files:**

- Create: `packages/ui/tui/src/transcript/display-text.ts`
- Create: `packages/ui/tui/src/transcript/project.ts`
- Create: `packages/ui/tui/src/transcript/markdown.ts`
- Create: `packages/ui/tui/src/transcript/retention.ts`
- Create: `packages/ui/tui/tests/display-text.spec.ts`
- Create: `packages/ui/tui/tests/transcript.spec.ts`
- Create: `packages/ui/tui/tests/markdown.spec.ts`

**Step 1: Write failing terminal-safety tests**

Cover ESC/CSI/OSC, C0/C1 controls, bidi controls, tabs/newlines, malformed surrogate input, grapheme-safe truncation, and byte/column budgets. Include strings that would change a terminal title, create a hyperlink, clear a line, or move the cursor if emitted raw.

Run: `pnpm vitest run packages/ui/tui/tests/display-text.spec.ts`

Expected: FAIL.

**Step 2: Implement the sole display sanitizer**

Make every later renderer accept an already-sanitized display value or call this function at its public entry. Do not scatter ANSI stripping among components.

**Step 3: Write failing event-projection tests**

Use real `SessionEvent` values for user messages, assistant chunks and settled messages, reasoning, tool call/result pairing, turn status, command lifecycle, retries, errors, and unknown merge-extensible events. Prove chunk replacement does not duplicate the settled assistant message and prove replay produces the same finalized rows as live folding.

**Step 4: Implement pure projection and resume retention**

Project events without Cordis or Ink. Keep tool arguments and result metadata as structured fields for Task 8. Apply `resumeTranscriptRows` only when selecting initial static output; do not discard events from the resumed Agent. Emit one explicit omission row.

**Step 5: Add the Markdown subset**

Write tests and implement deterministic blocks for headings, paragraphs, lists, fenced code, inline code, and links. Raw HTML and unsupported constructs become visible text. Do not emit OSC 8 links.

**Step 6: Run focused tests and commit**

Run: `pnpm vitest run packages/ui/tui/tests/display-text.spec.ts packages/ui/tui/tests/transcript.spec.ts packages/ui/tui/tests/markdown.spec.ts`

Expected: PASS.

```sh
git add packages/ui/tui/src/transcript packages/ui/tui/tests/display-text.spec.ts packages/ui/tui/tests/transcript.spec.ts packages/ui/tui/tests/markdown.spec.ts
git commit -m "feat(tui): project safe durable transcripts"
```

## Task 6: Implement fresh, resume, and selector runtime ownership

**Files:**

- Create: `packages/ui/tui/src/driver/controller.ts`
- Create: `packages/ui/tui/src/driver/session.ts`
- Create: `packages/ui/tui/src/driver/resume.ts`
- Create: `packages/ui/tui/tests/controller.spec.ts`
- Create: `packages/ui/tui/tests/resume.spec.ts`
- Modify: `packages/ui/tui/src/index.ts`

**Step 1: Write failing controller tests**

Mount real `SessionStore`, `AgentRegistry`, command, approval, and question Service Definitions with a narrow fake Agent factory. Verify Loader settlement precedes creation, fresh sessions use cwd and the default model, setup installs a model-selection ref, an initial task submits only after publication, and scoped events from another Agent are ignored.

Run: `pnpm vitest run packages/ui/tui/tests/controller.spec.ts`

Expected: FAIL.

**Step 2: Implement single-Agent ownership**

Create one controller per mounted TUI plugin. Own the `AgentHandle`, scoped event listener, and model-selection ref in one lifecycle object. Use `ctx.agents.create()` and `ctx.agents.resume()`; do not instantiate the loop or Session directly. Resume selection derives from the latest logged request header before falling back to `ctx.agentDefaultModel.currentSelection()`.

**Step 3: Write failing selector tests**

Verify newest-first rows from `ctx.sessionQuery.listSessions()`, configured `sessionSelectorLimit`, one batched `readTitleSnapshots()` call, per-title failure fallback, empty corpus, exact-id not found, selector cancellation, and collision errors.

**Step 4: Implement selection and resume**

Keep selector rows as immutable state. Do not inspect unbounded logs one at a time. A selected id is passed to `ctx.agents.resume()` only after the selector closes.

**Step 5: Run focused tests and commit**

Run: `pnpm vitest run packages/ui/tui/tests/controller.spec.ts packages/ui/tui/tests/resume.spec.ts`

Expected: PASS.

```sh
git add packages/ui/tui/src/driver packages/ui/tui/src/index.ts packages/ui/tui/tests/controller.spec.ts packages/ui/tui/tests/resume.spec.ts
git commit -m "feat(tui): own fresh and resumed agent sessions"
```

## Task 7: Render the inline Ink application

**Files:**

- Create: `packages/ui/tui/src/render/app.tsx`
- Create: `packages/ui/tui/src/render/transcript.tsx`
- Create: `packages/ui/tui/src/render/composer.tsx`
- Create: `packages/ui/tui/src/render/status.tsx`
- Create: `packages/ui/tui/src/render/overlays.tsx`
- Create: `packages/ui/tui/src/render/use-store.ts`
- Create: `packages/ui/tui/src/render/start.tsx`
- Create: `packages/ui/tui/tests/render.spec.tsx`
- Create: `packages/ui/tui/tests/static-transcript.spec.tsx`

**Step 1: Write failing render tests**

Render with deterministic stdin/stdout streams and assert the welcome line, status, composer, resume selector, error state, and compact layout at narrow columns. Assert React reads through `useSyncExternalStore` and that a store update changes the frame without component-owned copies.

Run: `pnpm vitest run packages/ui/tui/tests/render.spec.tsx`

Expected: FAIL.

**Step 2: Implement the dynamic shell**

Pass the production process adapter explicitly to Ink `render()`. Do not use alternate-screen escape codes. Make every component a pure view over store selectors plus event callbacks.

**Step 3: Prove scrollback behavior**

Add a test that finalizes several rows, updates a live assistant row repeatedly, and exits. Assert each finalized row occurs once in captured output and the final live row is not duplicated by an Ink remount. Use monotonic row keys; never reset a `Static` identity during one controller lifecycle.

**Step 4: Implement `Static` plus redraw region**

Render finalized rows through one stable `Static` list. Render live assistant output, status, composer, and overlay below it. On resume, feed only the retained initial rows plus omission marker into the same monotonic sequence.

**Step 5: Run focused tests and commit**

Run: `pnpm vitest run packages/ui/tui/tests/render.spec.tsx packages/ui/tui/tests/static-transcript.spec.tsx`

Expected: PASS.

```sh
git add packages/ui/tui/src/render packages/ui/tui/tests/render.spec.tsx packages/ui/tui/tests/static-transcript.spec.tsx
git commit -m "feat(tui): render an inline ink transcript"
```

## Task 8: Render tool presentation intents without executing content

**Files:**

- Create: `packages/ui/tui/src/render/tool.tsx`
- Create: `packages/ui/tui/src/render/tool-model.ts`
- Create: `packages/ui/tui/tests/tool-render.spec.tsx`
- Modify: `packages/ui/tui/src/transcript/project.ts`
- Modify: `packages/ui/tui/src/render/transcript.tsx`

**Step 1: Write failing projection tests**

Register real tool definitions with `presentCall` and `presentResult` and cover `generic`, `terminal`, `diff`, `read`, `search` paths, `search` matches, and `web` results. Cover a missing definition, a presenter returning `undefined`, a future unknown result card, malformed replay arguments rejected by the tool presenter, and a display budget exceeded by terminal output.

Run: `pnpm vitest run packages/ui/tui/tests/tool-render.spec.tsx`

Expected: FAIL.

**Step 2: Implement the model adapter**

Resolve with `ctx.tools.get(name, agent)` and call only the pure presentation methods. Pair results by durable call id. Never invoke `execute`, never read a file, and never trust embedded ANSI. Use a generic structured fallback for every missing or unknown presentation.

**Step 3: Implement compact cards**

Show terminal command, cwd, bounded output, and exit status; unified diff hunks; numbered read lines; search counts and retained rows; Web source labels and URLs; and generic JSON/content. Keep expansion and mouse navigation deferred.

**Step 4: Run focused tests and commit**

Run: `pnpm vitest run packages/ui/tui/tests/tool-render.spec.tsx packages/ui/tui/tests/transcript.spec.ts`

Expected: PASS.

```sh
git add packages/ui/tui/src/render/tool.tsx packages/ui/tui/src/render/tool-model.ts packages/ui/tui/src/render/transcript.tsx packages/ui/tui/src/transcript/project.ts packages/ui/tui/tests/tool-render.spec.tsx
git commit -m "feat(tui): render tool-owned terminal cards"
```

## Task 9: Provide approvals and user questions

**Files:**

- Create: `packages/ui/tui/src/driver/approval.ts`
- Create: `packages/ui/tui/src/driver/questions.ts`
- Create: `packages/ui/tui/src/render/approval.tsx`
- Create: `packages/ui/tui/src/render/questions.tsx`
- Create: `packages/ui/tui/tests/approval.spec.tsx`
- Create: `packages/ui/tui/tests/questions.spec.tsx`
- Modify: `packages/ui/tui/src/driver/controller.ts`
- Modify: `packages/ui/tui/src/render/overlays.tsx`

**Step 1: Write failing approval tests**

Exercise the real `ApprovalService.request()` inside an open turn. Verify the TUI claims only its exact root Agent, calls `next()` for another Agent, shows tool/call/reason, grants once only on explicit allow, rejects explicitly, returns cancelled on request abort, and never grants during shutdown.

Run: `pnpm vitest run packages/ui/tui/tests/approval.spec.tsx`

Expected: FAIL.

**Step 2: Implement the scoped waterfall answerer**

Register through the controller's context and always delegate with `next()` when the request is not owned. Keep the pending resolver in the runtime adapter and its visible immutable description in the store. Make settlement single-shot.

**Step 3: Write failing question tests**

Exercise `ctx.userQuestions.ask()` with one and multiple questions, options, free-form answers, review intent detail, invalid incomplete answers, abort, controller disposal, and the duplicate-provider error. Verify all required answers settle atomically.

**Step 4: Implement the provider and panels**

Register exactly one provider for the TUI lifecycle. Reuse service types and validation rules; do not invent a second question schema. An aborted or disposed request closes its matching overlay only.

**Step 5: Run focused tests and commit**

Run: `pnpm vitest run packages/ui/tui/tests/approval.spec.tsx packages/ui/tui/tests/questions.spec.tsx`

Expected: PASS.

```sh
git add packages/ui/tui/src/driver packages/ui/tui/src/render packages/ui/tui/tests/approval.spec.tsx packages/ui/tui/tests/questions.spec.tsx
git commit -m "feat(tui): answer approvals and user questions"
```

## Task 10: Wire commands, input, cancellation, and ordered shutdown

**Files:**

- Create: `packages/ui/tui/src/driver/commands.ts`
- Create: `packages/ui/tui/src/driver/input.ts`
- Create: `packages/ui/tui/src/driver/shutdown.ts`
- Create: `packages/ui/tui/tests/commands.spec.ts`
- Create: `packages/ui/tui/tests/input.spec.ts`
- Create: `packages/ui/tui/tests/shutdown.spec.ts`
- Modify: `packages/ui/tui/src/driver/controller.ts`
- Modify: `packages/ui/tui/src/render/composer.tsx`
- Modify: `packages/ui/tui/src/index.ts`
- Modify: `packages/ui/tui/src/invariant.ts`
- Modify: `packages/ui/tui/tests/invariant.spec.ts`

**Step 1: Write failing command tests**

Register real command definitions and verify known slash commands call `ctx.commands.execute()` with the exact Agent and abort signal, command results enter the transcript through durable events, `/help` lists the effective scoped descriptors, `/resume` is refused during a turn or interaction, `/exit` follows shutdown, and an unknown slash requires confirmation before becoming model input.

**Step 2: Implement command routing**

Keep `/help`, `/resume`, and `/exit` local. Delegate every other slash line to the registry first. Preserve a draft and attachments on a command error; attachments remain unsupported in this release and therefore cannot reach command execution.

**Step 3: Write failing input and shutdown tests**

Drive Enter, Ctrl+J, Escape, Ctrl+R, and the Ctrl+C state machine through the input adapter. Verify shutdown ordering:

1. reject new input;
2. settle interactions without a grant;
3. cancel active Agent work;
4. await `whenIdle()`;
5. flush the Session;
6. unmount Ink and restore raw mode;
7. dispose owned effects;
8. request exit.

Cover setup failure, normal `/exit`, stdin closure, raw-input Ctrl+C during active work, a second raw-input Ctrl+C requesting shutdown while cancellation drains, owner-fiber disposal from the launcher's process-signal path, and repeated shutdown calls sharing one Promise.

**Step 4: Implement lifecycle and strengthen the invariant**

Use one idempotent shutdown coordinator. Do not call `process.exit` or register process signals. Request the existing `ctx.appExit` only after user-owned cleanup; an owner-fiber disposal runs the same cleanup without requesting exit again. The invariant observes controller/Agent/provider publication and disposal events; it must fail on duplicate live ownership and remain empty when no controller is mounted.

**Step 5: Run focused tests and commit**

Run: `pnpm vitest run packages/ui/tui/tests/commands.spec.ts packages/ui/tui/tests/input.spec.ts packages/ui/tui/tests/shutdown.spec.ts packages/ui/tui/tests/invariant.spec.ts`

Expected: PASS.

```sh
git add packages/ui/tui
git commit -m "feat(tui): complete interactive input and shutdown"
```

## Task 11: Compose and register the shipped TUI profile

**Files:**

- Create: `packages/bundle/tui-app/README.md`
- Create: `packages/bundle/tui-app/README.zh.md`
- Create: `packages/bundle/tui-app/README.i18n.yaml`
- Create: `packages/bundle/tui-app/cordis.patch.yml`
- Create: `packages/bundle/tui-app/src/index.ts`
- Create: `packages/bundle/tui-app/src/invariant.ts`
- Create: `packages/bundle/tui-app/tests/tui-app.spec.ts`
- Modify: `packages/bundle/README.md`
- Modify: `packages/bundle/README.zh.md`
- Modify: `packages/bundle/README.i18n.yaml`
- Modify: `packages/boot/app-boot/src/profile.ts`
- Modify: `packages/boot/app-boot/tests/profile.spec.ts`
- Modify: `apps/cli/package.json`
- Modify: `tsconfig.base.json`
- Modify: `tsconfig.host.json`
- Modify: `pnpm-lock.yaml`

**Step 1: Write a failing composition equivalence test**

Assert `PROFILE_TEMPLATES.tui` is exactly `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-tui-app']`. Compose both patch lists through the real Loader and assert the ordered effective rows and configs expected by the product:

- base services remain present;
- `hmr` is disabled;
- TUI persona and tools mode override the base values;
- code runtime, `tui-startup`, `tui`, and both invariant rows exist;
- no `api-gateway`, Host server, client modules, Web runtime, VS Code carrier, or network listener row appears.

Run: `pnpm vitest run packages/boot/app-boot/tests/profile.spec.ts packages/bundle/tui-app/tests/tui-app.spec.ts`

Expected: FAIL.

**Step 2: Implement the bundle patch and registration**

Make startup values flow through lazy row config; do not read global argv in the TUI row. Add the package to CLI dependencies, both aggregate/path registrations, bundle indexes, the shipped template, and installation-owned template normalization where required. Run `pnpm install` for the lockfile.

**Step 3: Add package docs and invariant**

Document that this bundle is direct in-process UI over base and why it does not include `client-app`. The bundle invariant checks its owned startup-to-runner relationship, not fixed rows already covered by the composition test.

**Step 4: Run focused tests and commit**

Run: `pnpm vitest run packages/boot/app-boot/tests/profile.spec.ts packages/bundle/tui-app/tests/tui-app.spec.ts`

Expected: PASS.

```sh
git add packages/bundle/tui-app packages/bundle/README.md packages/bundle/README.zh.md packages/bundle/README.i18n.yaml packages/boot/app-boot apps/cli/package.json tsconfig.base.json tsconfig.host.json pnpm-lock.yaml
git commit -m "feat(tui): ship the in-process tui profile"
```

## Task 12: Add assembled transcript and cross-platform acceptance

**Files:**

- Create: `examples/tui-agent/package.json`
- Create: `examples/tui-agent/README.md`
- Create: `examples/tui-agent/README.zh.md`
- Create: `examples/tui-agent/README.i18n.yaml`
- Create: `examples/tui-agent/cordis.snapshot.yml`
- Create: `examples/tui-agent/tests/fixtures/terminal-driver.ts`
- Create: `examples/tui-agent/tests/tui.snapshot.ts`
- Create: `examples/tui-agent/tests/snapshots/tui/session.jsonl`
- Create: `examples/tui-agent/tests/snapshots/tui/transcript.expected.txt`
- Modify: `examples/README.md`
- Modify: `examples/README.zh.md`
- Modify: `examples/README.i18n.yaml`
- Modify: `examples/package.json`
- Modify: `tsconfig.host.json`
- Modify: `apps/cli/tests/windows-shell.spec.ts`
- Modify: `vitest.snapshot.config.ts` only if its existing globs do not discover the new test

**Step 1: Build the deterministic terminal driver**

Provide TTY-capable in-memory streams, fixed columns, semantic key injection, resize, frame capture, ANSI normalization, and a completion Promise. The driver imports and mounts the real TUI package and bundle composition; it does not copy the controller or reducer.

Write a focused driver test first and observe failure before implementing it.

**Step 2: Add the LLM replay scenario**

The scenario must exercise, in one real mounted application:

- initial positional prompt submission;
- assistant streaming followed by a settled message;
- one terminal tool call and result;
- one approval with explicit allow-once;
- one multi-item user question;
- one registered command result;
- one cancelled follow-up turn;
- normal empty-draft Ctrl+C exit;
- persisted balanced Session output.

Normalize only nondeterministic ids, timestamps, absolute temp paths, and renderer cursor movement. Do not normalize missing or duplicated user-visible rows.

Run: `pnpm run build && pnpm run test:snapshot -- -t "tui assembled transcript"`

Expected before recording expected output: FAIL with a missing snapshot or intentional mismatch. Record through the repository snapshot workflow, then rerun keyless and expect PASS.

**Step 3: Extend Windows acceptance**

Add assertions that the installed launcher resolves the TUI package's real JS entry, never a `.cmd` or `.ps1` shim, and uses only stdin/stdout/stderr. Run the deterministic terminal integration under the Windows test lane without Unix signals or extra fds.

Run on the available host: `pnpm vitest run apps/cli/tests/windows-shell.spec.ts`

Expected: PASS. Do not run `check:windows-wine` unless diagnosing a known Wine failure; CI owns the platform signal.

**Step 4: Commit**

```sh
git add examples/tui-agent examples/README.md examples/README.zh.md examples/README.i18n.yaml examples/package.json tsconfig.host.json apps/cli/tests/windows-shell.spec.ts vitest.snapshot.config.ts
git commit -m "test(tui): add assembled terminal acceptance"
```

## Task 13: Finish documentation, coverage, and release gates

**Files:**

- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `README.i18n.yaml`
- Modify: `docs/development.md`
- Modify: `docs/development.zh.md`
- Modify: `docs/development.i18n.yaml`
- Modify: `docs/architecture.md`
- Modify: `docs/architecture.zh.md`
- Modify: `docs/architecture.i18n.yaml`
- Modify: `docs/testing.md` if the deterministic TTY harness adds a new test class
- Modify: `docs/testing.zh.md` if needed
- Modify: `docs/testing.i18n.yaml` if needed
- Move and update: `.agents/notes/proposed/feature/2026-08-20-dsh-terminal-client.{md,zh.md,i18n.yaml}` to `.agents/notes/implemented/feature/`
- Modify generated catalogs and module graph only through their generators

**Step 1: Update current-state docs**

Document the new default command, explicit aliases, non-TTY guidance, resume behavior, shortcuts, configuration fields, and known limitations. Update architecture with the Node terminal presentation package and direct in-process interaction path. Do not paste this implementation plan into product docs.

Use the actual implemented config field names and defaults. Include the current limitation that model switching, image attachments, mouse input, alternate-screen mode, and Tauri desktop are deferred.

**Step 2: Complete per-file coverage intentionally**

Run focused package coverage first:

```sh
pnpm vitest run --coverage packages/ui/tui packages/bundle/tui-app
```

Add tests for reachable failure arms. Use `/* v8 ignore */` only for structurally unreachable typed exhaustiveness or platform callbacks that the coverage policy already permits, with a local explanation. Do not disable coverage for whole files.

Then run the CI coverage gate once because every new `packages/*/*/src` file is in its scope:

```sh
pnpm run test:coverage
```

Expected: PASS at 100% per file.

**Step 3: Run relevant verification once**

Run:

```sh
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run hygiene
pnpm run test:snapshot -- -t "tui assembled transcript"
pnpm run doc-sync
git diff --check
```

Expected: all PASS. Do not rerun passing checks merely for the commit.

**Step 4: Promote the Agent Note**

Change its status to `implemented`, update any proposal wording that no longer matches the shipped behavior, move all three bilingual files together, and regenerate translation pairing records. Do not preserve review history in the implemented note.

**Step 5: Review the final diff and commit**

Run:

```sh
git status --short
git diff --stat
git diff --check
```

Confirm no unrelated untracked user files are staged.

```sh
git add README.md README.zh.md README.i18n.yaml docs packages examples apps/cli tsconfig.base.json tsconfig.host.json package.json pnpm-lock.yaml .agents/notes
git commit -m "docs(tui): publish the terminal client contract"
```

## Completion handoff

Before push, use `.agents/skills/dsh-pre-push-checks/SKILL.md` to select only checks not already run for the final diff. Before claiming completion, use `superpowers:verification-before-completion`. Request a code review with `superpowers:requesting-code-review` and include the exact commands run.

After review passes, report:

- the final command behavior;
- the installed profile composition;
- supported terminals and Windows evidence;
- key shortcuts and deferred features;
- the keyless snapshot location;
- the VSIX work and unrelated root scratch files that were deliberately left untouched;
- that the next authorized design task is the separate Tauri 2 desktop Agent Note, not desktop code in this stack.
