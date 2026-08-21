# Agent Note: First-party dsh terminal client before the Tauri desktop shell

Status: proposed

English | [中文](2026-08-20-dsh-terminal-client.zh.md)

## Problem

`dsh` has first-party headless, Web, VS Code, ACP, and JSON-RPC surfaces, but its bare command does not open an interactive terminal client. A user must select an implementation profile explicitly or leave the terminal for a browser or editor surface.

The repository removed its earlier TUI because it had no named deployment, no maintained package boundary, no concrete interaction provider, and no assembled transcript or lifecycle acceptance. Restoring those sources would also restore their removed terminal renderer dependency and their old integration assumptions rather than establish a current product surface.

The next product sequence is terminal first and desktop second. The terminal surface must remain a normal CLI, run in the same process as Cordis, preserve shell scrollback, support Windows without shell shims or extra file-descriptor protocols, and provide approvals and user questions rather than leaving the agent fail-closed. The later desktop application must use Tauri rather than Electron, but it must not distort the terminal design.

## Proposal

Add a first-party `tui` profile composed from `@deepseek-ai/dsh-base` and a new `@deepseek-ai/dsh-tui-app` bundle. The bundle mounts `@deepseek-ai/dsh-tui`, a Node-only interactive plugin that creates or resumes one top-level Agent through the existing in-process Cordis services.

The TUI uses Ink 7 as its terminal renderer and React 19.2 or newer as Ink's package-local renderer dependency. Ink 7 requires Node 22 and React 19.2, which matches the repository's Node floor while requiring the TUI package to keep its React dependency separate from the browser Client aggregate. The TUI does not compose `dsh-client-app`, Host RPC, an HTTP server, WebSocket, or a browser runtime.

The TUI's authoritative application state is a framework-free TypeScript store. Pure reducers and selectors consume owned actions and session events; Cordis adapters produce those actions; Ink subscribes through a narrow React adapter. React components never own session, approval, question, command, or draft truth independently of the store.

After the TUI acceptance criteria pass, a separate Agent Note and implementation plan may add a Tauri 2 desktop shell around the existing React client and a Node Harness companion. That shell may reuse the interactive Host APIs and carrier work established by Web and VS Code. It does not reuse Ink components or turn the TUI state store into a cross-surface protocol.

## Product command contract

`dsh` starts the interactive TUI in a fresh session rooted at the current working directory.

`dsh "task"` starts the interactive TUI, creates a fresh session, and submits the joined positional task after the application is ready.

`dsh --resume` starts the TUI in its session selector. `dsh --resume <id>` resumes that exact persisted session. A resume option and an initial task are mutually exclusive in the first release.

`dsh tui` is the explicit alias for the same TUI profile. `dsh exec "task"` is the automation-oriented alias for the existing headless profile. `dsh web`, `dsh plugin`, and `dsh --profile <name>` remain available. A positional equal to a reserved subcommand is passed as a task after `--`, for example `dsh -- web`.

Bare `dsh` and `dsh tui` require interactive stdin and stdout. A non-TTY invocation exits with a usage error that names `dsh exec`; it never silently changes output format or starts an interactive renderer on a pipe.

The launcher continues to own only profile selection, patches, dumps, and aliases. The `tui-app` startup plugin owns `--resume`, the optional task positional, app help, and validation, following the existing `cmdlineArgs` provider pattern.

## Package and composition boundaries

Create `packages/ui/tui` as the Node terminal-presentation group and document the new `ui/` group in the package hierarchy. The package owns terminal input, terminal-safe rendering, the state store, the single-agent controller, and the approval and user-question adapters. It depends only on Service Definitions and presentation types, never concrete LLM, persistence, shell, filesystem, or sandbox providers.

Create `packages/bundle/tui-app` as the profile patch carrier and startup-argument provider. Its patch applies TUI-specific persona and tool-presentation values over `dsh-base`, disables shared HMR until TUI remount behavior is proven, mounts the worker-thread code runtime when the configured tool mode needs it, mounts the startup provider, and mounts the TUI plugin.

Add `tui: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-tui-app']` to the shipped profile templates. The CLI installation depends on both new packages so installed profile resolution never relies on a workspace-only path alias.

Every new package ships an `./invariant` companion. The TUI invariant checks only package-owned live relationships, such as one mounted TUI controller owning at most one root Agent and one active interaction provider; it does not assert fixed component output or the presence of services already guaranteed by injection.

## In-process runtime

The controller waits for Loader settlement before creating or resuming an Agent. Fresh creation reads `ctx.agentDefaultModel.currentSelection()`, creates a random branded Session id with the current working directory, and installs the model selection through `installModelSelection()` during Agent setup. Resume calls `ctx.agents.resume()` for the selected persisted id and restores the model selection through the existing logged-selection mechanism before accepting input.

The session selector obtains newest-first identities from `ctx.sessionQuery.listSessions()` and resolves titles in one bounded batch through `readTitleSnapshots()`. The selector limit is plugin configuration rather than a hardcoded presentation tunable. Operational failure for one title leaves that row usable with its id and workspace; a failed corpus listing is a startup error.

The controller subscribes to scoped `session/event` delivery for its exact Agent and folds the committed event into the state store. It sends user text with `agent.followup(createUserMessage(...))`, interrupts active work with `agent.cancel({ kind: 'user' })`, waits for `agent.whenIdle()` at ownership transitions, and flushes through `ctx.sessions.flush()` before normal exit.

Slash commands first resolve through `ctx.commands.execute()`. TUI-local commands are limited to presentation and navigation operations such as `/help`, `/resume`, and `/exit`; they do not duplicate a domain command. Unknown slash input remains a normal user message only after the user confirms that intent, preventing command typos from reaching the model silently.

## Framework-free state core

The state store contains the active Session identity, immutable transcript rows, one live assistant draft, composer text, status, one overlay discriminated union, pending approval or question ownership, and terminal dimensions. State actions name external facts such as a committed Session event, typed input, a resize, an interaction request, an interaction settlement, and runtime disposal.

Reducer, event projection, display sanitization, truncation, and selectors are pure synchronous modules. They import no Cordis, React, Ink, process globals, timers, or wall clock. Callers supply time and terminal dimensions explicitly. Closed local unions end in `assertNever`; merge-extensible Session event unions use a documented default that produces no dedicated row unless the event is a surface event requiring a generic fallback.

The store exposes `getSnapshot()`, `subscribe()`, and `dispatch()`. Ink uses `useSyncExternalStore`; no component mirrors authoritative state with `useState`. Transient component state is limited to focus mechanics that cannot survive a component unmount and does not affect a pending decision or draft.

## Transcript and rendering

The UI is transcript-first and does not enter the terminal's alternate screen. Finalized transcript rows render through Ink's `Static` component so they become ordinary shell scrollback. Only the current streaming assistant row, status line, composer, and active overlay remain in Ink's redraw region.

On resume, the controller folds the complete durable log for correctness but emits only the configured most-recent transcript-row window into terminal scrollback. It prints an explicit omitted-history marker when earlier rows exist. The cap, selector limit, and tool-output display budget are validated TUI configuration fields; protocol and terminal-safety rules remain fixed invariants.

Text rendering accepts Markdown as content but starts with a deterministic terminal subset: paragraphs, lists, headings, fenced code, inline code, and links rendered as visible labels plus URLs. Unsupported Markdown degrades to readable text. Rendering never executes OSC hyperlinks or model-provided ANSI.

Every model, tool, title, command, and error string passes through one `displayText` function before reaching Ink. The function preserves permitted newline and tab layout, replaces C0/C1 controls and escape sequences with visible safe text, neutralizes bidi controls, and applies the caller's byte or column budget without splitting a Unicode grapheme.

Tool rows resolve the exact visible definition through `ctx.tools.get(toolName, agent)`, then call its pure `presentCall` and `presentResult` projections with durable arguments, content, error state, and presentation metadata. The renderer switches on `card`: `terminal`, `diff`, `read`, `search`, and `web` receive compact terminal presentations; `generic` and unknown future result cards receive a safe generic fallback. The TUI never executes tool content and never reads workspace files to enrich a card.

## Input and interaction

Enter submits a non-empty composer. Ctrl+J inserts a newline. Escape closes the active non-blocking overlay. Ctrl+C cancels an active turn; when idle it clears a non-empty draft; when idle with an empty draft it requests normal exit. Ctrl+R opens the resume selector only while no turn or human decision is active.

The editor behavior is a pure reducer over text, cursor, selection-free movement, insertion, deletion, and history actions. The first release supports Unicode text, multiline drafts, left/right/home/end movement, backspace/delete, and paste. Image attachments, mouse input, and a full-screen editor are deferred.

The TUI registers one scoped `approval/request` waterfall answerer. It claims requests only for its exact root Agent, displays the tool name, call link, and reason, and resolves `allowed-once`, `rejected`, or `cancelled`. Requests for another Agent call `next()`. Closing the UI or cancelling the owning turn settles the visible request without granting it.

The TUI registers the one `ctx.userQuestions` provider. It presents every question, options, free-form allowance, and review detail, validates the completed answer locally, and resolves only after all required items are answered. An abort removes the panel and rejects with the service's cancellation semantics. Pending approvals and questions live in the store, so an Ink remount cannot lose them.

## Lifecycle and platform behavior

The TUI receives stdin, stdout, stderr, environment facts, terminal dimensions, and normal exit requests through an injectable process adapter. Production uses the real Node streams; tests use deterministic TTY streams without product-only environment switches. Process-level SIGINT and SIGTERM remain owned by the shared profile launcher; raw-mode Ctrl+C is an input byte owned by the TUI.

Ink owns raw-mode transitions only while the mounted controller is active. Setup failure, normal exit, stdin closure, and launcher-owned root disposal after SIGINT or SIGTERM all converge on one idempotent cleanup path: stop accepting input, settle or cancel active interaction, cancel and drain the Agent, flush the Session, unmount Ink, and restore terminal state. A user-owned normal exit requests `ctx.appExit` after cleanup; owner disposal performs the same cleanup without recursively requesting another exit.

The implementation uses no shell shim, extra stdio file descriptor, Unix-only signal assumption, or filesystem lock. Windows runs the same Node entry and libuv stdio streams as macOS and Linux. Platform-specific shell tools remain selected by the base profile.

Two TUI processes may open the same workspace because workspace identity is not session identity. They use separate fresh Sessions unless an exact resume collides with a live process; the existing persistence and Agent registration collision behavior remains authoritative. The TUI does not introduce a workspace-wide process lock.

## Testing and release sequence

Pure state, editor, sanitizer, transcript projection, tool-card projection, and keyboard policy receive table-driven unit tests. Runtime tests use real Cordis Service Definitions with narrow fakes only for provider behavior and verify creation, resume, command dispatch, cancellation, approval, question, flush, and teardown ordering.

Loader composition tests boot the actual `base + tui-app` patch list and prove the startup service, TUI row, interaction providers, Agent lifecycle, and invariant companion. CLI parser tests cover aliases, reserved positional escape, app-argument forwarding, config dumps, and non-TTY guidance. The Windows CI lane runs the parser and injectable-terminal integration tests without `.cmd` or shell invocation.

A keyless assembled snapshot under a real runnable TUI example drives the mounted Ink application with deterministic TTY streams and an LLM replay fixture. Its normalized transcript covers initial prompt submission, streamed assistant text, a terminal tool card, an approval, a user question, a command result, cancellation, and clean exit. The same fixture replays on macOS and Linux; the Windows lane runs equivalent assertions without owning the golden ANSI transcript.

The first release gate is the interactive terminal product, not the desktop shell. After it passes, desktop design starts with Tauri 2, the existing React client, and a Node companion; signing, updater channel, installer identity, sidecar packaging, WebView compatibility, and marketplace-independent distribution receive their own decision record and acceptance suite.

## Alternatives considered

### Restore the deleted TUI

Rejected. It restores a removed renderer and pre-removal integration model, while the current repository has stronger Session, command, presentation, approval, and question seams that should be consumed directly.

### External TUI over HTTP and WebSocket

Rejected for the first-party product. The external prototype validated interaction needs, but it depends on an internal Host API, requires a second process and port, and duplicates reconnect behavior that an in-process client does not need.

### Full-screen alternate-screen TUI

Rejected for the default. It hides ordinary scrollback and makes terminal output less composable. A future optional full-screen mode would require its own navigation and lifecycle acceptance.

### Browser shell or Tauri before the terminal

Deferred. The existing Web and VS Code surfaces already cover graphical use. The terminal closes the missing `dsh` command experience with less packaging and identity work, and it gives the later desktop companion another proven interactive lifecycle.

### Electron desktop

Rejected. It duplicates a Chromium runtime already available through Tauri's system WebView and does not match the desired lightweight distribution.

## Acceptance criteria

- `dsh`, `dsh "task"`, `dsh --resume`, `dsh --resume <id>`, `dsh tui`, and `dsh exec "task"` implement the product command contract, while existing profile, Web, plugin, and config-dump paths retain their behavior.
- The shipped `tui` profile is exactly `dsh-base + dsh-tui-app`; it opens no network listener and composes no Host RPC or browser Client runtime.
- One framework-free store owns drafts, transcript state, overlays, approvals, and questions; Ink is a renderer subscriber.
- Finalized rows become ordinary scrollback, active output updates in place, resumed history is bounded with an explicit omission marker, and all untrusted display text is terminal-safe.
- Fresh and resumed sessions can complete multiple turns, run and render tools, execute registered slash commands, cancel work, answer approvals, answer user questions, flush, and exit without leaving raw mode enabled.
- Unit, Loader composition, CLI integration, keyless assembled transcript snapshot, and Windows injectable-terminal tests pass under the repository's supported Node versions; every new source file remains inside the per-file coverage gate.
- Package READMEs, group indexes, CLI help, user documentation, module graph, dependency lockfile, invariants, and this Agent Note remain synchronized.
- No Tauri or desktop packaging code lands in the TUI implementation stack; desktop work starts only through a separate approved plan.

## Risks

Ink 7 requires React 19.2 while the browser Client packages currently use React 18. Keeping the TUI on the Host aggregate and declaring React only in the TUI package avoids a shared renderer graph, but workspace dependency deduplication and type resolution must be tested explicitly.

Ink `Static` has had recent 7.x fixes for identity changes and remounts. The implementation must pin a verified 7.x release, keep finalized-row keys monotonic within one controller, and test remount and shutdown rather than relying on renderer internals.

A long resumed log still has to be loaded by Agent resume even when terminal output is bounded. The display cap controls terminal flooding, not persistence memory or resume latency.

Terminal key encodings vary. Ctrl+J is distinguishable from Enter on the supported terminals only if the input adapter preserves line-feed versus carriage-return; the keyboard integration tests must cover the actual Ink input event before this binding is treated as stable.

Generic handling of merge-extensible Session events can hide a newly model-visible event if its owning package omits a presentation. The snapshot and package documentation must treat dedicated TUI presentation as part of the feature design when a new event materially affects a terminal user.

The later Tauri shell will add code signing, updater trust, WebView variance, and Node sidecar packaging. Deferring it keeps those risks out of the terminal release but does not remove them.
