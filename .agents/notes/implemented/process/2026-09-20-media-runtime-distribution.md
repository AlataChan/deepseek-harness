# Agent Note: Distribute the desktop media runtime

Status: implemented

English | [中文](2026-09-20-media-runtime-distribution.zh.md)

## Problem

Desktop media composition needs FFmpeg and ffprobe on the user's machine. Embedding those binaries in the one-click DMG would require architecture, code signing, library closure, and a verified LGPL-only build. Homebrew FFmpeg on the Stage 1 machine is GPL with libx264 and cannot be copied into a proprietary app.

## Decision

V1 does not embed FFmpeg. The one-click DMG ships the desktop-media overlay only. Users who want video install FFmpeg themselves and run `scripts/install-media-runtime.sh`. The script installs via Homebrew on macOS when `ffmpeg` is missing, resolves `$(brew --prefix)`, writes that absolute prefix to `$DSH_HOME/media/user-runtime-home`, and checks that `bin/ffmpeg` and `bin/ffprobe` exist. It does not copy Homebrew binaries into the app bundle.

The plugin resolves the runtime home in this order:

1. Absolute `mediaRuntimePath` plugin config
2. Absolute `OCTOPUS_MEDIA_HOME`
3. The path stored in `$DSH_HOME/media/user-runtime-home`

Missing runtime does not fail companion boot. Composition, import probe, and thumbnail extract fail closed with install-script guidance. Compose requires `h264_videotoolbox` and native `aac`. The app does not apply the LGPL shipping rule to a user-owned binary. `inspectFfmpegLicense` / `assertShippableFfmpeg` remain for a later change that embeds a runtime we distribute.

The packaged desktop shell does not export `OCTOPUS_MEDIA_HOME` at a bundled `Contents/Resources/resources/media-runtime` tree. It does not change `OCTOPUS_SIDECAR_HOME`. V1 does not add a media-enabled x64 DMG kill, because the DMG contains no media binaries.

A later bundled LGPL runtime would need `scripts/build-media-runtime.sh`, embed, sign, `LICENSE`/`SOURCE.txt`, and relocated composition checks. That route is deferred.

### Stage 1 evidence

Measured 2026-09-20 on macOS arm64. Homebrew FFmpeg 8.1.2 (`/opt/homebrew/bin/ffmpeg`, SHA-256 `2ce81b92499c1b6b96eb060c69723114bd0da13f1bfbd9da26dee24d099e644a`) reports `--enable-gpl --enable-libx264 --enable-libx265 --enable-openssl`. It is not shippable if we were embedding it. V1 uses it as the user-owned runtime after the install script writes `/opt/homebrew` to `user-runtime-home`.

The same binaries composed a silent 1 s clip plus 0.4 s narration into a 10880-byte H.264/AAC MP4 via `h264_videotoolbox` and native `aac`. Copies placed under a path with spaces still load Homebrew dylibs from `/opt/homebrew`; V1 therefore keeps the user prefix in place instead of relocating binaries into the app.

## Alternatives considered

**A generic `OCTOPUS_RESOURCES_HOME` root.** It could serve a later third packaged runtime, but V1 needs only one media path and does not embed that runtime.

**Embed an LGPL FFmpeg in the DMG.** Correct if we redistribute FFmpeg. Stage 1 could not produce a verified LGPL tree; embedding Homebrew would ship GPL/libx264.

**Executable files inside the plugin seed.** The plugin dependency check does not sign Mach-O libraries, prove relocation, or supply licensing materials.

## Consequences

A one-click arm64 DMG boots chat without FFmpeg. Composition stays fail-closed until the user writes `user-runtime-home`. User-installed FFmpeg versions and encoder sets vary; a missing `h264_videotoolbox` or `aac` fails closed. Homebrew upgrades can move the prefix; the user reruns the script. Target-machine playback remains the system player's responsibility. The knowledge sidecar keeps `OCTOPUS_SIDECAR_HOME`.
