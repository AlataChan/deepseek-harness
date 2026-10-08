---
description: "octopus_DSH conversation-media overlay: MiniMax tools, a media job producer, session events, and $DSH_HOME catalogue storage, with a user-installed FFmpeg runtime."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-media

English | [中文](README.zh.md)

## Summary

`desktop-media` is the private desktop overlay for conversation-driven media: the Host half registers MiniMax tools, a `media` job producer, session events/projection, and catalogues under `$DSH_HOME/media`, while the Client half occupies the composer and tool-view slots. No media runtime is bundled; composition fails only when the user-installed FFmpeg or a required encoder is absent.

Private octopus_DSH overlay for conversation-driven media creation. The Host half registers MiniMax tools, a `media` job producer, session events/projection, catalogues under `$DSH_HOME/media`, and system open/reveal. The Client half occupies `conversation.input.left`, `tool.call.toolview`, `sidebar.footer.action`, `shell.overlay`, and `settings.models.footer` (MiniMax key, not a chat provider). Official `dsh-desktop-app` and `PROFILE_TEMPLATES.desktop` do not name this package; desktop profile seeding does.

No `./invariant` companion is published. Catalogues and session events are the owned records; there is no independently observable relationship that can diverge from those writes.

## Table of Contents

- [Config](#config)
- [Stage 1 findings](#stage-1-findings)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="config"></a>
## Config

```yaml
- id: desktop-media
  name: '@deepseek-ai/dsh-experimental-desktop-media'
  config:
    mediaRuntimePath: ''
    maxPaidCallsPerSession: 8
    maxEstimatedSpendYuan: 40
    maxClipCount: 4
    maxClipDurationSeconds: 15
    maxFileBytes: 20971520
    pollIntervalMs: 4000
    pollTimeoutMs: 600000
    videoModel: MiniMax-H3-Max
    ttsModel: speech-2.8-hd
    defaultDurationSeconds: 5
    defaultResolution: 768P
    defaultRatio: '16:9'
```

Empty `mediaRuntimePath` falls through to `OCTOPUS_MEDIA_HOME`, then `$DSH_HOME/media/user-runtime-home`. Missing runtime does not fail companion boot; `composeAudiovisual` fails when binaries or required encoders are absent. Managed files resolve to `$DSH_HOME/media`, never cwd or `OCTOPUS_APP_DATA`.

Users who want video install FFmpeg and run `scripts/install-media-runtime.sh`. Composition checks `h264_videotoolbox` and native `aac`. It does not apply the LGPL shipping rule to a user-owned binary.

<a id="stage-1-findings"></a>
## Stage 1 findings

- Homebrew FFmpeg 8.1.2 on this machine is `--enable-gpl` and `--enable-libx264`. `inspectFfmpegVersionOutput` marks it not shippable if we were embedding it. V1 uses it as the user-owned runtime after the install script.
- FFmpeg 8 fails closed when concat emits an unused audio pad. Replace-narration uses `concat=…:v=1:a=0` and maps `[narr]`; mix and no-narration keep `a=1`.
- A silent 1 s 640×360 clip plus 0.4 s AAC narration composed to a 1.000 s, 10880-byte H.264/AAC MP4 through `h264_videotoolbox` and native `aac`.
- `openNativePath` has no workspace fence; it can open a file under `$DSH_HOME/media`. `session.openWorkspacePath` must not be reused for media artifacts.
- The live owner for recovery is `SessionController.resolveAgent` after resume. Recovery listens for `agent/created`, then confirms an attached job controller before `ctx.jobs.start`.
- Authorized `provider.e2e.ts` (`retry: 0`) passed against `https://api.minimax.cn`: `speech-2.8-hd` / `male-qn-qingse`, MiniMax-H3-Max 5 s 768P 16:9 text-to-video, and clone-from-synthetic-sample plus first formal TTS.

<a id="model-experience"></a>
## Model Experience

Indirectly, through registered media tools and a creation system-prompt section that return request identifiers rather than bytes.

#### KV Cache effect

Tool schemas and the creation-skill section enter the system prompt when the overlay is loaded.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No bundled FFmpeg** — the DMG does not embed a media-runtime; users run the install script.
- **No in-app playback** — open/reveal request the system desktop only.
- **Save As** — offered only when a native directory-flow occupant is present; refuses an existing destination; otherwise Copy Path.
- **Paid confirmation** — `userQuestions` is required; absence fails closed.
- **Image-to-video** — imported `png`/`jpg`/`webp` stills go to MiniMax as `imageIds`; `imageMode: first_last` needs exactly two frames and must not mix with references.
- **Catalogues** — atomic JSON under `$DSH_HOME/media/catalog`, not `ctx.storage.domain`.

<a id="dev-note"></a>
## Dev Note

Paid calls fail closed without `userQuestions`, and a missing media runtime must not fail companion boot — only `composeAudiovisual` fails. Catalogues are atomic JSON under `$DSH_HOME/media/catalog` and session events are the owned records, which is why the package publishes no `./invariant` companion; `openNativePath` deliberately has no workspace fence, so do not reroute media artifacts through `session.openWorkspacePath`.
