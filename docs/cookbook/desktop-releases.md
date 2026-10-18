# Desktop release preparation and publication

English | [中文](desktop-releases.zh.md)

Desktop builds default to `internal`: unsigned Windows installers and ad-hoc-signed, unnotarized macOS images are for controlled testing. Set `DSH_DESKTOP_ARTIFACT_DIR` to an empty candidate directory to avoid replacing delivered installers. Every build writes an external `.release.json` containing the tested source, runtime and shell versions, target, CI run/attempt when present, installed payload digest, and final artifact size and SHA-256. A local build cannot qualify as a public CI artifact.

## Prepare a candidate

1. Build the workspace and frozen knowledge sidecar, then run `node scripts/build-exe.mjs` on Windows or `bash scripts/build-dmg.sh --arch arm64` on macOS. The Windows custom template is based on Tauri CLI 2.11.4; its upstream template digest is recorded in the template header. Template updates must preserve the WebView installation, registry, shortcut, association and uninstaller behavior.
2. Run installed verification against a disposable installation or read-only DMG mount. The Windows workflow requires a zero installer exit, installed readiness, knowledge Host checks, and the native `scripts/tests/desktop-installer-upgrade.ps1` controls. Those controls compile real NSIS fixtures using the production transaction include and cover A-to-B upgrades, transient/permanent companion locks, failed publication, rollback failure, interrupted recovery, reinstall, and companion restart. Source tests do not establish native upgrade acceptance.
3. For public mode, set `DSH_DESKTOP_BUILD_MODE=public`. Windows requires `DSH_WINDOWS_CERTIFICATE_THUMBPRINT` with its private key in the current user's certificate store and `DSH_WINDOWS_PUBLISHER` matching the trusted certificate subject. macOS requires `DSH_MAC_SIGNING_IDENTITY`, `DSH_MAC_TEAM_ID`, and an authenticated `DSH_NOTARY_PROFILE` in the keychain. Missing credentials fail preflight before building. Final qualification invokes native Authenticode or Developer ID, OS trust, notarization and stapling checks; a manifest claim never substitutes for them.

## Recover an interrupted Windows upgrade

The installer stages a complete candidate beside the installation before replacing it. It probes the installed main executable, Node companion and knowledge sidecar for exclusive access, then retries only access/sharing/lock violations for at most ten seconds per replacement step. It does not kill Node processes. Replacement failures preserve the previous payload and report the staging, backup and journal paths. A journal with a missing live installation can restore the backup; the installer then exits unsuccessfully and asks for a rerun. Ambiguous states retain both trees for operator inspection.

Successful upgrades retain the previous installation in an `*.octopus-backup-*` sibling directory. This consumes additional disk space but preserves files the installer does not own. After verifying the new installation and checking the backup for personal files, an operator may remove that specific backup. No automatic cleanup touches user homes, libraries, originals, sessions or credentials. Do not remove recovery directories while a replacement or rollback remains unresolved.

## Plan and publish explicitly

Publication targets only `AlataChan/deepseek-harness`. Create the version release/tag `desktop-v<version>` at the exact tested commit and a dedicated channel release/tag `desktop-channel-<channel>-<target>` before planning. Publication never creates or moves tags. Each platform has its own authoritative channel record, so publishing Windows does not discard macOS destinations. These are download records; they do not enable an automatic updater.

Use the manual `Desktop release publication` workflow, initially with `operation=plan`, the exact successful packaging run ID/attempt/commit, its artifact name and target. It downloads the installer and manifest, independently queries GitHub run/job/installed-check evidence, installs only into a disposable directory or mounts read-only, and invokes native signature verification. Review the emitted plan JSON before invoking `verify` or `publish`; those operations require the exact reviewed JSON. `plan` and `verify` never write releases. Public unsigned inputs are refused even when an old manifest claims otherwise.

The publisher uploads immutable versioned binaries, downloads them to compare size and digest, then updates the channel record last. Identical objects are reused; conflicting objects are refused. A failed binary upload/readback leaves valid uploaded assets intact and can resume with the same plan. A failed channel operation must be verified before rerunning; if deletion succeeded but replacement failed, explicitly re-plan against the observed missing record. The publication workflow serializes supported writers with one repository-wide concurrency group. GitHub release asset replacement is not atomic compare-and-swap: the publisher checks the observed revision before and after replacement, but out-of-band manual channel writes are unsupported and require operator reconciliation.

Signing credentials, positive native signing evidence, and native Windows upgrade acceptance are external prerequisites. Missing evidence stays pending; source or fixture tests do not qualify an installer for public distribution.
