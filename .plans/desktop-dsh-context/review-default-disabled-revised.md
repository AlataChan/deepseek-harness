# Second review: revised default-disabled dsh-context plan

Decision: changes required; not approved for execution yet. This review writes only this report. The original artifact and product code remain unchanged.

Reviewed artifact: `/Users/apple/.gemini/antigravity-cli/brain/ff101cbc-ec78-47c8-a834-bf5ec98e7abd/plan-bundle-dsh-context-default-disabled.md`, revised version, lines 1–185. Compared with the previous three findings and current installer entry points.

## R1 — Partially addressed; two delivery guarantees remain Required (P1)

The authoritative JSON, exported resource manifest and revision hashing are sound choices. However, artifact lines 80–83 explicitly default Rust installation to enabled when the manifest file or field is absent. In a new payload containing dsh-context, a missing export, missing row or missing false field can therefore activate it on first launch. Source-pin validation does not validate this packaged/runtime input. Task 3 checks the source pin, but does not specify checking that the exported inventory matches the packaged directories, versions and activation defaults. The optional default for existing source pins must be distinguished from a missing/corrupt export of the new authoritative manifest.

Required: export normalized boolean defaults for all pins; validate the complete resource manifest and agreement with packaged package identities/versions before seeding. A new payload missing required metadata must fail rather than silently enable context. If compatibility with pre-manifest payloads is retained, define exactly when that fallback is permitted and how a context-bearing new payload is distinguished. Add negative controls for missing file, missing plugin row, invalid boolean and payload/inventory mismatch.

The JS helper now accepts options, but task lines 137–139 still do not name the real `install` and `seed` CLI callers that must supply them. Current calls at `scripts/seed-desktop-profile-plugin.mjs:483` and `:503` pass only directory, profile and shipped bundles. Required: explicitly resolve/pass the authoritative activation default at both callers, and test those actual paths. A direct helper test does not close the original value-dropping defect.

## R2 — Still Required (P1): version resolution and absent-payload behavior remain incomplete

Artifact lines 90–98 define legacy by `dependencies["dsh-context"] < "0.74.0"`. A dependency value is an install specification, not necessarily a version: it may be `^0.36.0`, a file reference, absent while a selection remains, or disagree with node_modules. The previous review explicitly identified this distinction. Merely naming the string comparison “strictly by version” does not resolve it, and a broad cutoff also classifies unverified intermediate releases as broken without an explicit decision.

Required: define JS/Rust-equivalent parsing/resolution and precedence for recorded and installed versions, with a deterministic policy for unresolvable specs. Either deliberately scope the repair to the evidenced broken generation or justify the chosen broader policy. Include mismatched recorded/installed versions, dependency ranges/local specs, and selected-but-unrecorded remnants in the tests. Do not equate an unknown version with a verified modern installation.

Artifact lines 105–109 promise safety if either the whole payload or the context directory is absent. Current Rust returns `Absent` before healing when the resources directory is absent (`app.rs:440–450`). It also enumerates only directories that exist; a missing context directory is silently omitted from `bundled`, and the remaining packages can receive a completed stamp. The setup logs the outcome and continues; withholding a new stamp alone does not prevent a bad selected plugin from booting. The revised tasks do not yet specify changing these paths.

Required: explicitly run the legacy safety decision before payload-absence exits; use the exported manifest as the expected inventory so an absent required directory is a failed seed, not a smaller successful inventory. Define how heal/write errors prevent known-broken activation before companion launch. Add whole-root-absent, individual-package-absent, stale/matching stamp, and copy/heal-write-failure tests at the Rust installation/startup path. Preserve modern ON/OFF as already specified.

## R3 — Addressed at plan level

G1–G8 now state the relevant packaged-runtime acceptance criteria: offline availability, default OFF with no active contributions, Host and Client hot activation, cleanup, repeated cycles, restart/refresh persistence and failure feedback. These remain future gates, not passing evidence. Use the actual installed desktop/companion and installable DMG for the macOS delivery; a CLI `--offline` or mocked network alone is not proof that the packaged runtime makes no external dependency fetches. No additional scope is requested here.

The corrected runtime dependency description and exact 0.74.0 pin address the prior wording/pin findings. No package refresh was required for this review: the request changed the plan, not the pinned package.

## Evidence and limits

Read revised artifact, previous report, current JS CLI install/seed calls, Rust resource discovery/heal/completeness/stamping and setup continuation, and the seed revision/build call sites. No unit tests, installation, package import, runtime activation, builds or packaging were run. This is a design review; it does not assert that implementation has already failed the newly proposed acceptance tests.
