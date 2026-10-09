# Agent Note: the staged upstream upgrade completes through hop four, the client taxonomy, and the packaged pipeline

Status: implemented

English | [中文](2026-10-08-upstream-hops-three-four-and-packaging.zh.md)

## Problem

Hops 1 and 2 of the staged upstream upgrade landed with a repair checkpoint that made the intake gate honest and proved the migration chain on real data. Two hops remained (`dsh-v0.1.7-alpha.1` with the v3 to v4 session format, then `dsh-v0.2.1-alpha.1` with the engine and client catch-up), the client layer still carried fork edits inside upstream files as B-class debt, and the packaging pipeline had not run since the preset split, so no DMG had exercised the merged tree.

## Decision

Both hops merged whole-tree, resolved under the intake registry's rules: class-C desktop paths stayed deleted, registered patches reconciled on the upstream base, and every upstream-side choice recorded. Hop 3 patched the frozen released-v3 vocabulary with the nine fork session events (proven first on a scratch branch, so the patch carried a passing test before the merge), ported the `admitSelect` hook into the split `agent-preset-registry` so the ask-data select gate cannot silently no-op again, and adapted call sites to upstream's renamed events and reshaped inputs. Hop 4 followed the never-merge policy's analytics strip through eight client packages, restored the desktop companion's manifest entry and build entry the merge had dropped, and re-recorded the corpus when the Loader began refusing patch rows whose name differs from the target row.

The client layer then applied the plan's own taxonomy: a patch that cannot be expressed without editing an upstream file is not a B but an A with a registered reason. Dead fork styling and locale strings reverted to the upstream pin, four rows that already equaled the pin were deleted, and each remaining edit registered with the exact framework seam that would make it movable — renderSlot binds to the declaring entry, a factory has one definition, and the fork's positions (hero row, pre-header plate, headline, composer takeover) sit inside upstream JSX.

The packaging pass produced the first DMG of the merged tree and caught what code review could not: the build still copied a preset directory the preset split had deleted, and its bundle gate still asserted that directory. The step was removed, the gate now requires the composition preset providers inside the harness closure, and the packaged companion was verified against a copied legacy profile.

## Verification

Real-data migration on both hops: 152 of 152 logs migrate, open, and publish the current generation, with the originals byte-identical throughout and every pre-migration backup byte-identical to its source. The recorded-session corpus passes on the hop-4 writer, including the fork's nine events. The documentation gates pass in full, with the pairing corpus in upstream's per-section record format. The unit suite passes with only load-induced timeouts remaining, each of which passes in isolation. `verify-desktop-bundle` reports 80 checks passed and produces `dist/octopus_DSH.dmg`; a packaged handshake against a copied legacy profile completes, holds, and reuses both data roots. The telemetry exporter is asserted silent before feedback and under `DISABLED`.

## Alternatives considered

**Migrate the client chrome into an overlay package.** Rejected by the framework's own binding rules, verified in the source: no reaching slot exists for the fork's positions, and the empty official cells nearby render only with a current session, which would lose the cold-start home screen the fork's UX depends on.

**Leave the B rows as aspirations.** Rejected: the registry's taxonomy exists precisely to record what cannot move and why, and an unregistered aspiration is the debt the upgrade exists to retire.

**Keep the standalone preset directory in the build.** Rejected: the preset split replaced file-scanned presets with composition rows; the copy wrote a directory nothing reads.

**Recreate the packaging evidence from source instead of building.** Rejected: the dead preset path was invisible to every check except a real DMG build, which is the argument for the build being the gate.

## Consequences

Every remaining fork delta against upstream is a registered patch, an overlay, or a recorded composition decision; the intake gate enforces that on each hop. The packaged application is verified end to end on a real build, and the migration evidence on real data extends through the v4 format. The owner's remaining decisions are hop-4's release sign-off and the client-seam proposals the migration recorded for a future upstream conversation; the dated plan and handover carry the full execution record.
