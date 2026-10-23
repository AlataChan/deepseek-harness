# Second review: compatibility intake

Verdict: changes requested; merge blocked. No branch, worktree, installed app, or user profile was removed or replaced.

Reviewed committed range: `47675a706f4f1cf3ce20b78d4d3e8a46e993d0ca..107e09fd859cfc47fba5b02041d0079d825cacb7`, plus the uncommitted plan and verification amendments. The actual default branch is `master` (also `fork/HEAD`), not `main`. No remote push was attempted.

## R1 — P1: New dependency classification breaks a required hygiene check

Location: `packages/client/connection-desktop/package.json:37–39`, introduced by prerequisite checkpoint `4e0717914c`.

The branch moves `@deepseek-ai/dsh-client-connection-process` from devDependencies to dependencies. The unchanged dependency policy classifies these source imports as development/build inputs. Running the real verifier at the reviewed head exits 1 with exactly one violation: the relationship must be devDependencies-only. The base manifest has the required placement; neither the policy nor the build configuration changed in this range. This is introduced by this branch, not an unrelated baseline failure. The earlier verification report's treatment of it as baseline is incorrect.

The runtime dependency was intended to prevent stale decoder inlining during a parallel build, but that intention does not satisfy the current published-package policy. Resolve build scheduling/static linking while retaining the correct dependency classification, or justify and implement an accurately derived Host-runtime classification with its focused policy tests. Do not simply restore the old manifest without verifying the clean/parallel build and packaged decoder regression, and do not suppress the gate.

Evidence: `node --import tsx/esm scripts/verify-package-dependencies.ts` → exit 1. Full output: `evidence/second-review-dependencies.log`.

## R2 — Required acceptance gap: native WKWebView remains unverified

Locations: implementation plan Task 4 steps 3–5 (lines 137–141), and the verification report's native qualification section.

The approved acceptance explicitly requires actual Tauri WKWebView observations for locales, model route/reasoning, resize/zoom, restart, assistant/team choices and context lifecycle, including the copied-DMG application. The recorded native attempts exposed a blank window and then an AX read failure; they did not establish these results. The passing browser-driven Rust carrier/cache test is useful but does not complete native WKWebView acceptance. This is missing required evidence, not a confirmed product failure. Complete the native checks and attach observations before approval, or obtain an explicit scope change; no such exclusion is assumed here.

## Independently rerun checks

- Change-scope report against exact base/head completed.
- Six focused suites passed: 306/306 tests (intake CLI controls, model selection, inline renderer, DeepSeek adapter/runtime). Intentional crash-control console output is present; the process exits 0.
- Real dependency verifier fails as described in R1.
- `git worktree prune --dry-run --verbose` finds no stale registrations.

Review inspected provider/model identity propagation, fallback and disposal, inline error anchors, zoom placement, executed ownership checks, and prerequisite seeding/graph changes. No additional confirmed code defect is reported in those inspected paths. Prior bundle/typecheck evidence is recorded as prior evidence and was not rerun solely for this review.

## Merge and cleanup inventory

There are two registered worktrees: the dirty canonical `master` checkout and the isolated compatibility feature checkout. There are two local branches: `master` and `feat/upstream-compatibility-20261023`; the feature branch owns seven commits absent from master. Neither is a redundant merged branch, and neither worktree can be deleted without removing active work. No local `main` exists. The conditional merge was not performed because R1 and R2 remain open. Cleanup is deferred until approval and preservation of the canonical dirty layers and feature evidence/artifact.
