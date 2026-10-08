# Agent Note: Conversation-driven media creation and works browsing

Status: implemented

English | [中文](2026-09-20-conversation-media-creation.zh.md)

## Problem

Xiaolvjing users need to turn conversation copy and activity photos into short videos or personal narration, then review, save, and retrieve results. A complete editor introduces project, timeline, and multitrack overhead; API forms alone cannot reuse conversational intent.

## Decision

Use existing conversations for creation and a sidebar Works button for results. Keep `standard` as the default assistant. A dedicated creation skill supplies methods. The dual-face overlay `@deepseek-ai/dsh-experimental-desktop-media` supplies MiniMax H3, TTS, cloning, task queries, and local composition. Official `apps/desktop`, `desktop-app`, and `desktop-companion` product logic is unchanged.

V1 ships the overlay without embedding FFmpeg. The one-click DMG asks users who want video to install FFmpeg and run `scripts/install-media-runtime.sh`. Official `session-controller` remotes duck-type `ctx.get('desktopMedia')` so the official package never imports the overlay. `listMediaWorks`, `listMediaVoices`, `mediaRuntimeStatus`, `openMediaWork`, `revealMediaWork`, `copyMediaWorkPath`, `importMediaBytes`, and `saveMediaWorkAs` never activate an Agent. A Host without the overlay answers `session/media-unavailable`.

### Scope

Support one video or a small sequence with one narration track, plus standalone speech. Save works locally automatically with Open File, Show in Folder, Save As, and source-conversation navigation. Use the system default player. Leave complex editing to external tools.

Exclude project editors, multitrack timelines, visual workflows, precise lip synchronization, automatic publishing, music editing, and subtitle layout. Clip count, duration, concurrency, file size, retries, and paid-call and estimated-spend limits are validated plugin configuration. The Host checks both limits before every paid call. Unknown prices block automatic paid submission until the user confirms an explicit estimate.

### User path

Shortcuts in an opened session load methods without changing the default assistant or immediately submitting paid generation. The blank Hero has no media shortcut. The Host binds explicit confirmation to the request revision, pilot artifact, selected reference or endpoint SHA-256 hashes, and the subsequent paid scope. A tool-supplied `approved: true` does not authorize spending. Changed inputs require renewed confirmation.

### Creation skill and H3

The skill ships through `scripts/desktop-bundled-skills.json`. Each generation handles one main shot. Text, image-to-video (`imageIds`), and exclusive `first_last` endpoints are the V1 modes. Skills describe methods; Host validates parameters and scope.

### Interface and works

`conversation.input.left` holds the Chinese shortcuts. `tool.call.toolview` shows result cards. `sidebar.footer.action` and `shell.overlay` hold Works. Empty state is “还没有作品，在会话中选择‘做视频’或‘做配音’开始”. V1 Works rows show type icons. Save As appears only when a native directory-flow occupant is present; otherwise Works offers Copy Path. Cards and Works share durable artifact IDs.

### Voice cloning and composition

Clone requires an explicit consent declaration and a durable record of actor, recording digest, request ID, and time before upload. Voice ids use the `dshVoice` prefix. Narration replaces original audio by default. Composition requires a user-installed FFmpeg that exposes `h264_videotoolbox` and native `aac`. The app does not inspect that user-owned build for LGPL shippability.

### Module and persistence

The overlay registers a `media` JobKind, log-only `media/*` session events, and one media projection. Catalogues are atomic JSON under `$DSH_HOME/media/catalog` rather than `ctx.storage.domain`. V1 import admission is extension, size, and bytes; ffprobe stream inspect remains in the [media-import admission proposal](../../proposed/architecture/2026-09-20-media-import-admission.md). Recovery listens for `agent/created`, confirms a live owner and job controller, then starts at most one job per `providerTaskId`. Explicit `job_kill` appends `media/stop`. Paid confirmation requires `userQuestions` and fails closed when that seam is absent.

The Host plugin injects `tools`, `jobs`, `sessionProjections`, `systemPrompt`, and `sessions` so those registrations wait for the seams. Credentials and `userQuestions` stay optional via `ctx.get`.

### Local opening and distribution

Open File and Show in Folder respond only to user clicks. The skill reports only that system opening was requested. [Media-runtime distribution](../process/2026-09-20-media-runtime-distribution.md) owns user-install resolution. `verify-desktop-bundle` checks `listMediaWorks` on the session-controller remote face and Chinese Client copy in the seeded overlay.

## Stage 1 evidence

Measured 2026-09-20 on macOS arm64, branch `feature/conversation-media-creation-stage1`. Authorized paid MiniMax calls ran against `https://api.minimax.cn` with `MINIMAX_API_KEY` and `MINIMAX_E2E_ALLOW_PAID=1`. `packages/experimental/desktop-media/tests/provider.e2e.ts` passed twice with `retry: 0`. Clone used a synthetic `speech-2.8-hd` sample.

Homebrew FFmpeg 8.1.2 at `/opt/homebrew/bin/ffmpeg` (SHA-256 `2ce81b92499c1b6b96eb060c69723114bd0da13f1bfbd9da26dee24d099e644a`) reports `--enable-gpl --enable-libx264`. `inspectFfmpegLicense` marks it not shippable. `composeAudiovisual` joined a silent 1 s clip with 0.4 s AAC narration and wrote a 10880-byte H.264 + AAC MP4. `openMediaFile` and `revealMediaFile` accepted that path. Success means the system opener was requested.

Domestic pay-as-you-go list prices from [MiniMax 按量计费](https://platform.minimax.cn/docs/guides/pricing-paygo) on 2026-09-20 estimated the captured run: MiniMax-H3-Max 768P text-to-video 5 s ≈ ¥2.50; system `speech-2.8-hd` 29 billed characters ≈ ¥0.01; first formal TTS on a new voice ≈ ¥9.90 clone fee plus ¥0.01. Immediate requery of the H3 task succeeded.

## Stage 2-4 shipped facts

Catalogues stay JSON under `$DSH_HOME/media/catalog`. Image-to-video reuses imported stills through `imageIds` and exclusive `imageMode`. Production flush uses `sessions.flush` when tests do not inject one. Save As refuses an existing destination (`save-as-exists`). `runVideo` re-hashes imported stills immediately before the paid HTTP call. The keyless headless snapshot `snapshots/session/conversation-media-creation/` loads the skill, keeps media tools registered, and pins 「已请求系统打开文件」 plus confirmation-before-paid. Client result cards stay in package tests. Official TypeScript and Python SDK default-profile expected outputs are unchanged because those profiles do not mount the overlay; `media/*` is in `KNOWN_SESSION_EVENT_TYPES`.

## Alternatives considered

**Complete video workbench.** Projects, storyboards, and multitrack timelines exceed lightweight conversation creation.

**Three API forms.** APIs become callable, but users must organize context and production themselves.

**Separate video assistant.** Adds switching and result-ownership questions; a dedicated skill works inside `standard`.

**Bundle oil-motion directly.** Its web runtime and personal credentials are outside scope.

**In-app player.** V1 omits Range transport, media tokens, and WebView playback and uses system applications.

**`ctx.storage.domain` catalogues in V1.** Rejected so the overlay does not require official storage-domain wiring.

## Consequences

Users create short video and speech from `standard` without a second assistant or an editor. Video composition stays gated on a user-installed FFmpeg. Users leave the workbench to review or listen. Provider retention and pricing can change; interrupted paid submissions may be unverifiable. Official desktop product logic stays free of media imports.

## Testing

The Host `bundle` script is `tsc -b tsconfig.json && tsdown`. Package-local `tsdown` alone rebundles stale `lib/types` and can ship `inject = { optional: […] }`; Cordis then waits for a service named `optional` and the desktop companion never becomes ready.

```bash
pnpm exec vitest run packages/experimental/desktop-media/tests/
pnpm exec vitest run --config vitest.snapshot.config.ts snapshots/session/headless.snapshot.ts --testNamePattern=conversation-media-creation
```

`verify-desktop-bundle` greps the seeded Host `lib/index.js` for a `tools`/`sessions` inject array and rejects object-form `inject.optional`. Companion lifecycle smoke installs every pinned overlay before handshake. Seed drops `workspace:` peers, so a bare `import()` of that Host file is not a load check. The Models footer card writes `MINIMAX_API_KEY` through credentials remotes; it is not a chat provider row. The composer chip 克隆声音 is the file control. Choosing an mp3, m4a, or wav opens the consent sheet on `document.body`. A dialog mounted inside the composer or `shell.overlay` did not appear. The session plus control stays image and document only.

Paid MiniMax remains `MINIMAX_E2E_ALLOW_PAID=1 pnpm exec vitest run --config vitest.e2e.config.ts packages/experimental/desktop-media/tests/provider.e2e.ts` with `retry: 0`. Missing-key skips are not passes.

## Related

This decision does not replace jobs, attachments, credentials, storage, or the directory picker. [task-surface](../../proposed/feature/2026-08-04-task-surface.md) places background execution and persistent UI in client-plugin workflows. [Storage roots](../../proposed/architecture/2026-07-28-storage-root-and-derived-medium-recovery.md) and [cancellation](../../proposed/architecture/2026-07-19-required-cancellation-through-tool-capability-seams.md) remain proposed. Images reuse [image attachments](2026-08-26-generic-file-upload.md). Session state follows [projection ownership](../architecture/2026-08-25-session-observations-and-projection-owned-client-state.md). Save As uses the [directory-picker](../../archived/architecture/2026-07-28-directory-picker-capability-seam.md) native provider.

## Sources

Domestic references: [H3 task creation](https://platform.minimax.cn/docs/api-reference/video-generation-v2-create), [task query](https://platform.minimax.cn/docs/api-reference/video-generation-v2-query), [voice cloning](https://platform.minimax.cn/docs/api-reference/voice-cloning-clone), [sync TTS](https://platform.minimax.cn/docs/api-reference/speech-t2a-http). Stage 1 pinned H3-Max text-to-video at 5 s / 768P / 16:9 and `speech-2.8-hd`.
