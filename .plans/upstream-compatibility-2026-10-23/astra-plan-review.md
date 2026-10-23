# Independent plan review

Verdict: **ready with required revisions**. One P2 revision is required before implementation approval. No P1 finding. Review scope is the English/Chinese plan, pairing record, source inventory, relevant current consumers and tests, and pinned upstream Git objects. This is plan readiness review, not implementation or artifact acceptance.

## Required revision

### P2 — Make C1 ownership enforcement part of the executed intake runner

Location: `docs/plans/2026-10-23-upstream-compatibility-and-model-labels.md:75`, `:89`, `:156`; equivalent Chinese lines.

Task 1 requires an omitted C1 path to fail, and A10 requires unregistered paths to fail, but the assigned files include only the registry and verifier tests, not the production verifier. The existing runner cannot enforce this promise: `scripts/verify-upstream-intake.ts:469` restricts composition manifests to `packages/` and `apps/`; `:490` filters the Git diff to modified paths and excludes vendor manifests and new timer locales; `:512` calls `backportViolations` without its optional selected-path list. A test calling that helper with a manually supplied list could pass while the actual top-level command still accepts missing C1 ownership. General permission to extend a verifier in Task 4 does not specify how this known mandatory acceptance gap will be closed.

Failure scenario: correct vendor versions and locales are applied, but a vendor manifest or locale is omitted from the C1 backport record. Metadata/packaging tests pass and the normal intake command never compares that path against C1. An existing broad patch registration can likewise conceal missing selected-backport ownership for already-registered source paths.

Fix: explicitly assign the verifier and its input/ownership mechanism to Task 1. Derive the selected C1–C3 path obligations independently of the ownership records being checked, retaining the whole-release pin. Specify how added locale files are included. Require the normal executed intake entry point to reject a fixture with one C1 path omitted, an entire required backport omitted, and an unauthorized pin advance. Keep fixtures in disposable repositories or use an explicit testable runner root; do not mutate this checkout.

Verification performed: a read-only import of `changedUpstreamFilesAgainstPin` and `backportViolations` with the live registry returned `{"vendorPathsSeen":[],"absentC1Violations":[]}`. This is baseline mechanism evidence, not a claimed execution of the future C1 negative control. Missing verification is a CLI-level negative control through the same inputs the required top-level gate will use.

## Advisories

### P3 — Identify the browser scenario that observes the shipped Flash default

Location: English and Chinese plan `:113–119`.

The proposed adapter/runtime assertions do exercise the default catalog, and the pinned rc.2 source confirms `DeepSeek-V4.1-Flash` with ID `deepseek-flash`. However, `snapshots/session/model-switch-notice/cordis.snapshot.yml:3` disables the real DeepSeek provider and supplies replay models, including the historical `deepseek-v4-flash` ID at `:18`. Passing that scenario is retained routing regression evidence, not evidence for the new catalog name. The currently named `default-model.e2e.ts` uses synthetic Origin/Acme catalogs (`:26–31`).

Name the browser catalog scenario to extend or add for the actual default name, and describe the replay snapshot as a separate unchanged routing check. Preserve historical session generations as already required. This is advisory because Task 3 already requires default-catalog tests and affected browser snapshots; the issue is reproducibility of that handoff, not absence of all naming coverage.

### P3 — Record the adjacent baseline manifest identity explicitly

Location: English and Chinese plan `:63`; `.plans/upstream-compatibility-2026-10-23/source-inventory.json:70–80`.

Task 0 says to verify both the previous DMG and its adjacent manifest against recorded hashes, but the inventory records only the DMG hash. It also records the base commit without the dirty-source flags present in the actual adjacent manifest. Preserve the manifest byte hash and its dirty-source markers alongside the artifact identity, or explicitly reference the qualified evidence copy and compare against it. Otherwise a replaced adjacent manifest cannot be checked against the promised inventory hash. The existing Task 0 checkpoint review is appropriate and must still establish which source edits accompany that historical artifact.

## Verified strengths and limits

- HEAD and the rc.2 tag resolve to the commits recorded in the inventory. All 15 upstream-file SHA-256 values match bytes read from the pinned Git object. The current vendor runtime-source diff against that object is empty.
- The provider-aware upstream slot and memoization changes are present in the named upstream commits. The fork selector has its own reasoning and menu behavior; the plan correctly requires bounded adaptation instead of file replacement. Provider/model pair tests, default effort preservation, contribution disposal, custom-name retention, and real browser geometry checks address the principal regression risks.
- C1 separates source assertions from build-dependent timer packing/export resolution and explicitly follows the vendor full-test/build policy. The metadata-only scope and unchanged runtime-source requirement are consistent with the inspected source.
- Bilingual semantic review found no material divergence. The named pairing check passed with `pnpm run verify-translation-pairing docs/plans/2026-10-23-upstream-compatibility-and-model-labels.md`. An initial invocation with an extra `--` was rejected as an unknown flag; it was corrected, not counted as a passing check.
- The checkpoint-before-worktree sequence, separate reversible commits, preserved prior DMG, coupled artifact rebuild, isolated native execution, copied-DMG verification, and platform qualification limits are sound. Historical pass counts are expressly excluded as evidence for this change.

No builds, paid APIs, commits, merges, application launches, installed-profile writes, or private evidence reads were performed. The only review-created file is this report. Full documentation gates and application suites were not rerun; source-level review and the narrow probes above do not qualify the proposed artifact. Implementation remains contingent on the required plan revision, owner approval, and Task 0's reviewable desktop checkpoint.
