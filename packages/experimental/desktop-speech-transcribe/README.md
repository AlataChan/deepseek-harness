---
description: "octopus_DSH long-recording transcription overlay: a speech_transcribe Host tool that decodes a local recording and writes a Markdown transcript through the speech-to-text seam."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-speech-transcribe

English | [中文](README.zh.md)

## Summary

`desktop-speech-transcribe` is the private desktop overlay for long-recording transcription: the Host half registers one model-visible `speech_transcribe` tool that reads a recording from the session workspace, decodes it to 16 kHz mono PCM WAV (macOS `afconvert`, FFmpeg fallback), recognizes it through `ctx.speechToText`, and writes `<name>.transcript.md` beside the audio. The Client half contributes the 录音转文字 row to the 专业能力 hero menu and stages a picked recording into the workspace through the Host. The desktop profile seed installs the package. No model, media, or runtime asset is bundled.

## Table of Contents

- [Use this package](#use-this-package)
- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The tool takes a workspace-relative or absolute `audioPath` plus optional `language` and `providerId`. It resolves relative paths against the calling Session's workspace, refuses directories and files over 2 GiB, and decodes anything that is not already the canonical 16 kHz mono PCM16 WAV the speech seam forwards. The transcript keeps the audio file's directory: `访谈.m4a` becomes `访谈.transcript.md`.

The overlay boots even when the optional voice-input bundle is disabled. Each tool call resolves the live speech registry; if absent, it returns Chinese setup guidance before reading or decoding audio. Before transcription it reads the selected provider's preparation phase. An `unprepared`, `failed`, or `cancelled` provider does not trigger a download; the result carries Chinese guidance pointing at 插件 → 语音输入 → 下载并准备, and an in-flight preparation returns a 正在准备中 waiting notice. The tool never prepares models and never submits a message on the agent's behalf.

The desktop profile seed installs this package from `scripts/desktop-profile-plugins.json`; official `dsh-desktop-app` and `PROFILE_TEMPLATES.desktop` do not name it. The 公益项目助手 preset loads the companion skill `env-ngo-audio-minutes`, which turns a transcript into meeting minutes.

The 专业能力 hero menu carries one added row, 录音转文字: it opens the local file picker, reads the chosen recording, and stages it into `<workspaceRoot>/recordings` through the `session/importTranscriptAudio` Remote. On success the composer draft becomes 把 `<workspace-relative path>` 转成文字稿 and is submitted, so the `speech_transcribe` tool starts from the staged file. Failures appear as an inline notice on the row; the row never overwrites an existing staged recording.

<a id="config"></a>
## Config

```yaml
- id: desktop-speech-transcribe
  name: '@deepseek-ai/dsh-experimental-desktop-speech-transcribe'
  config:
    maxAudioMinutes: 120
    maxUploadMiB: 64
```

`maxAudioMinutes` bounds the recording; a longer recording fails with a Chinese diagnostic before recognition starts. The bound is computed from the WAV header before the payload is read, so rewrapped WAV input is covered as well.

`maxUploadMiB` is the staging cap for one picked recording, but the effective limit is `min(64 MiB, maxUploadMiB)`: the `importTranscriptAudio` Remote decodes at most 64 MiB per payload, so raising `maxUploadMiB` above 64 has no effect until that wire constant changes. The row pre-checks the same effective default and the Host refuses an oversized upload with a Chinese message.

## Model Experience

### `speech_transcribe` tool

#### What the model sees

One registered tool whose name, description, and `audioPath`/`language`/`providerId` parameters enter every request while the overlay is loaded. A successful call returns `transcriptPath`, `characters`, the first 1200 characters of the transcript, and — when the derived name collided — a `note` naming the suffixed file, all on one bounded result; a blocked call returns Chinese preparation guidance instead.

#### Token effect

The tool definition costs input tokens once per request. A result carries only the bounded preview and the file path, so a long transcript stays on disk and enters the request only when the user asks to read the file.

#### KV Cache effect

The tool definition and the Client row add no turn-to-turn variance beyond the result text itself, so the cached prefix stays stable while transcripts change between calls.

## Known Limitations and Deferred Work

- **Provider per-request limit** — the seam forwards one recording per call. The shipped voice-input composition raises the SenseVoice worker limits for long recordings (`maxAudioBytes` 512 MiB ≈ 4.5 h of 16 kHz mono PCM, `inferenceTimeoutMs` 2 h, `maxResponseBytes` 4 MiB), so a 90-minute recording fits; a recording beyond the composition's limits is rejected by the provider.
- **Decode dependency** — canonical WAV passes through; every other container (m4a, mp3) needs macOS `afconvert` or an FFmpeg binary on PATH, at `/opt/homebrew/bin/ffmpeg`, or at `/usr/local/bin/ffmpeg`. Without either, the tool fails with Chinese guidance naming the file and the missing tools.
- **Text only** — SenseVoice returns plain text: no speaker labels and no timestamps. Within one accepted recording the provider VAD-segments speech, but the transcript is one `## 全文` block.
- **Collision suffix** — the transcript path is derived from the audio name; when that name already exists, the tool writes `<stem>.transcript.2.md` (incrementing) and reports the used name in a `note` instead of overwriting the existing transcript.
- **No progress UI** — the row disables itself while staging and reports failures in an inline notice; there is no progress bar, and the transcription itself reports only through the tool result.
- **Staged uploads stay** — the row writes the picked recording into `<workspaceRoot>/recordings`; the file remains in the workspace after transcription.
- **Chunked transcription (deferred)** — recordings above the provider's per-request limit wait for a multi-call chunking path.
- **Speakers and timestamps (deferred)** — output gains speaker separation and timestamps once a provider reports them through the seam.
- **One-click setup (deferred)** — the guidance result gains a 前往安装 deep link into the voice-input plugin page.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Staging writes into `<workspaceRoot>/recordings` with `wx`, so a staged recording is the user's file until they delete it. The effective upload cap is `min(64 MiB wire constant, maxUploadMiB)` — raising `maxUploadMiB` above 64 MiB takes effect only after the wire constant changes.

</details>
