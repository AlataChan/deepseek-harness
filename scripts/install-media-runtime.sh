#!/usr/bin/env bash
# Record a user-owned FFmpeg prefix for octopus_DSH desktop media.
# Does not copy Homebrew binaries into the app bundle.
set -euo pipefail

dsh_home="${DSH_HOME:-${HOME}/.dsh}"
marker="${dsh_home}/media/user-runtime-home"

if ! command -v brew >/dev/null 2>&1; then
  echo "install-media-runtime: Homebrew is required on macOS." >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  brew install ffmpeg
fi

prefix="$(brew --prefix)"
ffmpeg_bin="${prefix}/bin/ffmpeg"
ffprobe_bin="${prefix}/bin/ffprobe"

if [[ ! -x "${ffmpeg_bin}" || ! -x "${ffprobe_bin}" ]]; then
  echo "install-media-runtime: ${ffmpeg_bin} or ${ffprobe_bin} is missing." >&2
  exit 1
fi

mkdir -p "${dsh_home}/media"
printf '%s' "${prefix}" > "${marker}"
echo "install-media-runtime: wrote ${marker} -> ${prefix}"
