---
kind: upgrade-guide
description: Desktop artifact qualification requires recorded source-state flags, and Windows installers refuse downgrades.
---

# Desktop source state and Windows downgrades

English | [中文](guide.zh.md)

## Change

Internal desktop builds may use modified source. Their build information and release manifests record `sourceState.modifiedAtBuild` and `sourceState.modifiedAtPackaging`. Public builds require both flags to be false. Every mode still requires the completed root build's commit and Client artifact digests to match the packaging inputs. Older manifests without these flags no longer qualify an artifact; do not infer clean source from missing metadata.

Windows installers refuse an older registered application version, including silent installation. This protects persisted data that older releases may not understand. An existing installation remains in place when a downgrade is refused.

Public macOS DMGs require separate preparation and signing phases. Preparation runs the bundled readiness check with an ad-hoc signature before signing credentials are imported; signing accepts only its unchanged, readiness-verified input. Earlier preparation records must be regenerated.

## Migration

1. Run `pnpm run build:desktop:frontend` before assembling a desktop artifact, or run `pnpm run build` before a separate Tauri build. Both paths produce the complete build record before building the WebView.
2. Use internal mode for modified-source testing. For public builds, start from clean source and keep it unchanged through packaging. Rebuild after changing HEAD; a new commit cannot relabel earlier binaries.
3. Rebuild and qualify artifacts whose manifests lack `sourceState`; editing the external manifest alone does not establish the artifact's source state. Confirm the flags in both `build-info.json` and the external `.release.json`.
4. Install the same or a newer Windows version. Do not bypass downgrade refusal against a live user-data directory. [Desktop release preparation](../../../cookbook/desktop-releases.md) describes qualification and recovery.

5. For public macOS builds, run `bash scripts/build-dmg.sh --arch arm64 --prepare-only` before importing signing credentials, then run the same command with `--sign-prepared`. Run mounted bundled-code checks only after removing the signing keychain.
