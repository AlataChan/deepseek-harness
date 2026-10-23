# Default-disabled context: final review and remediation

Status: ready for the tested macOS ARM64 internal installation path. No remaining blocking finding was observed in the reviewed dsh-context feature after direct remediation, complete bundle verification, and verification of an unchanged app copied from the final DMG.

## Review result

The review found additional production defects beyond the earlier helper-suite findings. The following corrections are present in the rebuilt application:

| Priority | Finding and correction | Verification |
| --- | --- | --- |
| P1 | Desktop stopped decoding after the initial handshake, so detached Client tests could pass while the native window never loaded a toggled plugin. The Host now publishes settled graph snapshots; Desktop verifies and caches their artifacts through Rust and synchronizes its own Client module system. | Bootstrap and Host gateway regressions; three built-page toggle cycles through the real Rust carrier/cache; actual native UI activation and removal. |
| P1 | RPC transport treated a subsequent graph snapshot as an invalid downlink and terminated requests. It now leaves graph reconciliation to Desktop while keeping requests and streams alive. | Regression keeps a correlated request alive across repeated ready snapshots; combined transport/bootstrap/gateway suite passes 35 tests. |
| P1 | Parallel Client builds could inline an older connection-process decoder into connection-desktop, rejecting a valid release identity. connection-desktop now declares the process package as a runtime dependency and uses its current implementation. | Full build passes; built exports share the same implementation; final native startup succeeds. |
| P1 | Web and Desktop runtime composition both registered the source system-prompt section, breaking real companion startup. Desktop composition now disables Web surface context and retains Desktop ownership. | Regression mounts the shipped YAML composition; Web and Desktop runtime suites pass 22 tests; packaged startup and native onboarding pass. |
| P2 | A failed revision-stamp write could report a successful reseed. Rust now returns a failed outcome. | Rust regression covers stamp failure and ON/OFF preservation during actual refresh; library suite passes 43 tests. |
| P2 | Acceptance claims relied on detached Client lifecycle calls and simulated installer stamps. The suite now uses public RPC toggles, the actual desktop page, packaged Client code, and the production Rust installer through the feature-gated carrier harness. | G1–G8 pass, including both cold states without reseeding, restored payload bytes, real stamps, and post-refresh cold starts. |
| P2 | Offline and cleanup controls could miss inspection failures or delay startup diagnostics. The runner uses macOS network confinement, strict endpoint inspection, deterministic negative controls, explicit startup-error propagation, and awaited child termination. | Four runner regression tests pass; packaged timeout, WAN, wildcard-listener and denied-network controls pass. |
| P2 | macOS preparation omitted embedded native helpers and repeatedly rewrote the same app filesystem objects before execution. Preparation now signs and verifies native leaves, promotes a digest-matched fresh copy, and preserves the tested internal app bytes through DMG staging. | Eleven signing/configuration/preparation tests pass; the final bundle executes Node, native converters and the knowledge sidecar and passes strict signature checks. |

The original pin, fail-closed inventory, durable healing, legacy sanitization and modern ON/OFF preservation remain in place. The dsh-context inventory is exactly `0.74.0` with `defaultEnabled: false`. No Session format or persisted event type changes are introduced. The feature-gated installer command is excluded from the GUI invoke handler.

## Final verification

- `pnpm run build`: passed, recording 371 Client artifacts and five public values.
- Desktop frontend build and `cargo tauri build --config '{"build":{"beforeBuildCommand":""}}'`: passed after that complete root build.
- JS seeder: 15 tests passed; Rust library: 43 tests passed. Focused suite counts overlap and are not an aggregate repository test count.
- Process transport, bootstrap and Host gateway: 35 tests passed; Web and Desktop runtime composition: 22 tests passed; signing/configuration/preparation: 11 tests passed; verifier regression tests: four passed.
- `REUSE_DEPS=1 REUSE_KB_RUNTIME=1 bash scripts/build-dmg.sh --arch arm64`: passed, including all 114 bundle checks. This includes 29 installed Ask Knowledge criteria/invalid controls, 25 composer-prediction checks, and dsh-context Host, Rust refresh and actual built-page Client acceptance.
- Native WKWebView: launched the final app with an isolated HOME and kernel network confinement; skipped API-key entry; verified OFF discovery and version `0.74.0`, enabled through the actual plugin switch, opened the rendered context dashboard, disabled it and observed removal, then verified both ON and OFF across cold launches. Both later launches report profile and skill seeding skipped. No model request was made.
- Final DMG delivery: mounted read-only; complete app digest matched the tested assembled app; strict mounted signature passed. Copied the unchanged app into a fresh installation directory, rechecked digest and signature, ran Node and every knowledge-sidecar capability check, and passed the full context acceptance suite again. The actual copied Tauri app also booted, activated its context dashboard from the plugin switch, and removed the entry on OFF. The native test launcher uses a physical executable path, preserving Tauri’s macOS symlink-path refusal.
- `pnpm run verify-upstream-intake`: passed after the final transport change, retaining four pre-existing recorded outstanding items.
- Scoped whitespace validation, Node syntax checks for both acceptance scripts, and shell syntax checks: passed.

Native evidence: [OFF details](evidence-final/native-off.png), [live dashboard](evidence-final/native-on-dashboard.png), [ON after cold launch](evidence-final/native-restart-on.json), [OFF after cold launch](evidence-final/native-restart-off.json), [copied-DMG native dashboard](evidence-final/native-dmg-dashboard.png), [copied-DMG OFF](evidence-final/native-dmg-off.json), and [generation/seed log](evidence-final/native-companion.log). The built-page lane uses Chromium with the production Rust bridge; the separately captured native lane uses the actual Tauri WKWebView.

## Artifact and scope

- Artifact: `dist/octopus_DSH.dmg`, 324,293,631 bytes; target `macos-arm64`; mode `internal`.
- DMG SHA-256: `198eafc40ce7835dd076095efe68dc7c543406577d841929cfdabaebcafc95be`.
- Complete signed app payload digest, matching assembled and read-only mounted copies: `d3c18a3a14d6fb4d523ab47446b6e19af70f1004519d3b0040b60e1e1aa20997`.
- The adjacent release manifest records the dirty build/packaging state and the resources-only payload digest separately from the complete app digest above.

This is local macOS ARM64 internal qualification with ad-hoc application signing. Developer ID notarization, Windows and Intel delivery are outside this result. The unchanged knowledge sidecar was reused after matching its SOURCE.txt and passing converter/capability checks; it was not freshly frozen in this review.

The repository documentation aggregate remains failing: 37 checks passed and five failed in doc-typecheck, translation pairing, Markdown wrapping, repository references and package paths. The recorded diagnostics concern unrelated pre-existing plan/course documents, not the changed desktop/connection READMEs. This review does not claim a clean repository-wide documentation result.

Direct execution of embedded Node from the mounted HFS disk image stalled before JavaScript in `_dyld_start`; the owned diagnostic process was terminated and the image detached. Its mounted payload digest and strict signature had passed. The unchanged app copied out of that image passes runtime, native UI and context acceptance checks. The direct-mounted-runtime attempt is retained as a failed diagnostic rather than counted as a pass; approval covers installing the app out of the image, not executing its runtimes on the mounted image.

Final logs: [bundle build and 114 checks](evidence-final/dsh-context-build-dmg-final-qualified.log), [copied-DMG acceptance](evidence-final/dsh-context-dmg-install-final.log), [direct-mounted diagnostic](evidence-final/dsh-context-mounted-final.log), [loader sample](evidence-final/mounted-node-loader.sample), [release manifest](evidence-final/octopus_DSH.dmg.release.json), and [documentation aggregate](evidence-final/dsh-context-doc-sync.log).
