# AlataStudio npm Publication Implementation Plan

English | [中文](2026-08-22-alatastudio-npm-publication.zh.md)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Publish the complete DSH package family as `@alatastudio/*` at `0.1.1-rc.4`, with the installed executable still named `dsh`, without renaming the source package graph.

**Architecture:** The release packer resolves a closed publication target, creates the normal source tarball in an isolated staging directory, projects only known DSH package identities in its manifest and UTF-8 payload, and repacks the projected files. The publisher remains target-independent because final tarballs and `publish-order.txt` carry the complete registry identity.

**Tech Stack:** TypeScript ESM, Node filesystem and subprocess APIs, pnpm pack, system tar, Vitest, npm registry CLI, and the existing release-family scripts.

---

## Scope and execution rules

The approved [design](2026-08-22-alatastudio-npm-publication-design.md) and [implemented Agent Note](../../.agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.md) own direction and rationale. If implementation requires source-package renaming, Cordis republishing, or runtime loader changes, stop and amend the design before proceeding.

Execute on a visible `release/dsh-0.1.1-rc.4` branch created from the current checkout. Preserve the existing untracked user files and directories. Use test-driven development for Tasks 1 through 4: observe each focused test fail for the intended reason, implement the smallest behavior, rerun it, and commit the task.

Never print, inspect, store, or commit the npm authentication token. npm commands use the user's existing local authentication. Publication starts only after local artifacts, the Linux install, the remote branch, and registry preflight all verify successfully.

## Task 1: Define publication targets

**Files:**

- Create: `scripts/release/targets.ts`
- Create: `scripts/release/targets.spec.ts`
- Modify: `scripts/release/families.ts`
- Modify: `scripts/release/families.spec.ts`

**Step 1: Create the release branch**

```sh
git switch -c release/dsh-0.1.1-rc.4
```

Expected: the branch starts at the approved design commit and the unrelated untracked files remain untouched.

**Step 2: Add failing target tests**

Cover the default `official` target, the explicit `alatastudio` target, root and suffixed DSH names, known-package subpaths, the target-specific installed entry, unknown targets, and rejection of `alatastudio` for the vendor family. Prove `@deepseek-ai/cordis` is not a projectable DSH identity.

```sh
pnpm vitest run scripts/release/targets.spec.ts scripts/release/families.spec.ts
```

Expected: FAIL because the target model does not exist and the DSH installed entry is fixed to the source package name.

**Step 3: Implement the closed target model**

Add `official` and `alatastudio` as the only target identifiers. Resolve targets against a `ReleaseFamily` and its full member inventory, return projected member identities without mutating the originals, and move installed-entry selection behind the resolved target. Keep tag prefixes, source member discovery, and dependency ordering source-named.

**Step 4: Run focused tests and commit**

```sh
pnpm vitest run scripts/release/targets.spec.ts scripts/release/families.spec.ts
git add scripts/release/targets.ts scripts/release/targets.spec.ts scripts/release/families.ts scripts/release/families.spec.ts
git commit -m "feat(release): define npm publication targets"
```

Expected: PASS, followed by one target-model commit.

## Task 2: Project packed DSH payloads

**Files:**

- Create: `scripts/release/projection.ts`
- Create: `scripts/release/projection.spec.ts`
- Modify: `scripts/release/tarball.ts`

**Step 1: Add failing projection tests**

Cover structural manifest rewriting across dependency-key and string-value positions, longest-known-name matching, package subpaths, JavaScript and declaration references, YAML configuration, external `@deepseek-ai` preservation, unknown DSH references, residual source names, invalid UTF-8 or NUL-bearing binary files, and unsafe archive paths.

Use a fixture whose binary bytes are hashed before and after projection. Require a diagnostic that names the file and unresolved package when projection cannot prove a safe result.

```sh
pnpm vitest run scripts/release/projection.spec.ts
```

Expected: FAIL because no payload projector exists.

**Step 2: Implement fail-closed projection**

Parse `package/package.json` as JSON and project object keys and string values only when they name a known DSH member or its subpath. Process other safe UTF-8 files with known names ordered longest first. Treat NUL-bearing or invalid UTF-8 files as binary, retain their bytes, and scan all final bytes for the source DSH prefix without rewriting arbitrary unknown names.

Reject absolute paths, traversal segments, links escaping `package/`, mapping collisions, unknown DSH package names, and residual source-scope DSH references. Keep file modes and symlink targets needed by the original tarball.

**Step 3: Run focused tests and commit**

```sh
pnpm vitest run scripts/release/projection.spec.ts
git add scripts/release/projection.ts scripts/release/projection.spec.ts scripts/release/tarball.ts
git commit -m "feat(release): project packed dsh identities"
```

Expected: PASS, including byte-identical binary coverage.

## Task 3: Integrate projection into release packing

**Files:**

- Modify: `scripts/release/pack.ts`
- Create: `scripts/release/pack.spec.ts`
- Modify: `scripts/release/targets.ts`
- Modify: `scripts/release/tarball.ts`

**Step 1: Add a failing real-pack integration test**

Build a temporary two-package DSH fixture with manifest dependencies, runtime imports, declarations, configuration, and a binary asset. Invoke the exported pack operation with `alatastudio`, inspect the real tarballs, and require projected manifest identities, projected internal references, unchanged Cordis references, unchanged binary bytes, projected filenames, and projected `publish-order.txt` entries.

Pack the same fixture twice into separate directories and require identical final tarball hashes. Add failure cases proving an incomplete final tarball and publish-order entry are not retained.

```sh
pnpm vitest run scripts/release/pack.spec.ts
```

Expected: FAIL because `pack.ts` has no target option or staged projection flow.

**Step 2: Implement two-stage packing**

Parse `--target`, default it to `official`, and resolve it before deleting the output directory. For projected members, run the normal source `pnpm pack` in a task-local temporary directory, extract its exact `package/` payload, apply projection, and run the second pack from the staged payload. Ensure staged packed manifests cannot execute source lifecycle scripts.

Validate the final tarball payload and identity against the projected member before appending its filename. Always remove staging directories. Remove an incomplete destination tarball when a member fails, and write `publish-order.txt` only after every member succeeds.

**Step 3: Run release-script tests and commit**

```sh
pnpm vitest run scripts/release/pack.spec.ts scripts/release/projection.spec.ts scripts/release/targets.spec.ts scripts/release/families.spec.ts
git add scripts/release/pack.ts scripts/release/pack.spec.ts scripts/release/targets.ts scripts/release/tarball.ts
git commit -m "feat(release): pack projected npm artifacts"
```

Expected: PASS with deterministic projected tarballs.

## Task 4: Drive the projected installed entry

**Files:**

- Modify: `scripts/release/verify-packed-install.ts`
- Modify: `scripts/release/verify-packed-install.spec.ts`

**Step 1: Add failing installed-entry tests**

Test that omitted `--target` drives `@deepseek-ai/dsh`, `--target alatastudio` drives `@alatastudio/dsh`, a missing projected entry fails before npm install, and vendor plus `alatastudio` is rejected.

```sh
pnpm vitest run scripts/release/verify-packed-install.spec.ts
```

Expected: FAIL because the verifier always reads the source-named installed entry.

**Step 2: Implement target-aware verification**

Add `--target` parsing, resolve the same target definition used by pack, and select the projected installed entry while continuing to discover all supplied tarballs by their packed identities. Do not project vendor or Landlock tarballs and do not change override construction.

**Step 3: Run focused tests and commit**

```sh
pnpm vitest run scripts/release/verify-packed-install.spec.ts scripts/release/targets.spec.ts
git add scripts/release/verify-packed-install.ts scripts/release/verify-packed-install.spec.ts
git commit -m "feat(release): verify projected cli installs"
```

Expected: PASS.

## Task 5: Finalize release documentation

**Files:**

- Move: `.agents/notes/proposed/process/2026-08-22-operator-owned-npm-scope.md` to `.agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.md`
- Move: `.agents/notes/proposed/process/2026-08-22-operator-owned-npm-scope.zh.md` to `.agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.zh.md`
- Move: `.agents/notes/proposed/process/2026-08-22-operator-owned-npm-scope.i18n.yaml` to `.agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.i18n.yaml`
- Modify: `docs/plans/2026-08-22-alatastudio-npm-publication-design.md`
- Modify: `docs/plans/2026-08-22-alatastudio-npm-publication-design.zh.md`
- Modify: `docs/plans/2026-08-22-alatastudio-npm-publication.md`
- Modify: `docs/plans/2026-08-22-alatastudio-npm-publication.zh.md`

**Step 1: Record shipped behavior**

Move the Agent Note triplet to `implemented/process`, change `Status: proposed` to `Status: implemented`, rewrite `Proposal` as the present-tense `Decision`, replace proposal-only acceptance and risk headings with present-tense consequences and verification, and preserve the recorded alternatives. Update both plan links to the implemented path.

Update module JSDoc and CLI usage strings in the changed scripts during the owning code tasks; do not duplicate implementation inventories in standing documentation. No model or product transcript changes, so no snapshot is required.

**Step 2: Re-record and validate the pairs**

```sh
pnpm run verify-translation-pairing --write .agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.md docs/plans/2026-08-22-alatastudio-npm-publication-design.md docs/plans/2026-08-22-alatastudio-npm-publication.md
pnpm run verify-agent-note-format
pnpm run verify-translation-pairing .agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.md docs/plans/2026-08-22-alatastudio-npm-publication-design.md docs/plans/2026-08-22-alatastudio-npm-publication.md
git diff --check
```

Expected: all three pairs are consistent and Agent Note format passes.

**Step 3: Commit**

```sh
git add .agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.md .agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.zh.md .agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.i18n.yaml docs/plans/2026-08-22-alatastudio-npm-publication-design.md docs/plans/2026-08-22-alatastudio-npm-publication-design.zh.md docs/plans/2026-08-22-alatastudio-npm-publication-design.i18n.yaml docs/plans/2026-08-22-alatastudio-npm-publication.md docs/plans/2026-08-22-alatastudio-npm-publication.zh.md docs/plans/2026-08-22-alatastudio-npm-publication.i18n.yaml
git add -u .agents/notes/proposed/process
git commit -m "docs(release): record npm projection workflow"
```

Expected: the proposed triplet is represented as a rename and no unrelated file is staged.

## Task 6: Bump the DSH family to rc.4

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: every DSH and private workspace manifest selected by the existing bump script

**Step 1: Confirm a clean tracked worktree and dry-run**

```sh
git status --short
pnpm release:dsh 0.1.1-rc.4 --dry-run
```

Expected: only the known user-owned untracked paths appear, and the dry-run reports the complete shared version set without writing.

**Step 2: Run the repository-owned bump**

```sh
pnpm release:dsh 0.1.1-rc.4
git show --stat --oneline HEAD
pnpm run release:verify --family dsh
```

Expected: the bump script creates `release(dsh): 0.1.1-rc.4`, all DSH versions agree, and the 234-member publish order resolves.

## Task 7: Build, pack, install-test, and push the release branch

**Files:**

- Generated outside Git: projected DSH tarballs, official vendor tarballs, and previously verified Landlock tarballs

**Step 1: Run focused and repository checks**

```sh
pnpm vitest run scripts/release/targets.spec.ts scripts/release/projection.spec.ts scripts/release/pack.spec.ts scripts/release/families.spec.ts scripts/release/verify-packed-install.spec.ts
pnpm run typecheck
pnpm run lint
pnpm run hygiene
pnpm run doc-sync
git diff --check
```

Expected: every command passes. Inspect any formatter or generated-file change before committing it.

**Step 2: Build and pack artifacts**

```sh
CI=true pnpm run build:official
pnpm run release:pack --family dsh --target alatastudio --out /private/tmp/dsh-release-0.1.1-rc.4/npm-dsh
pnpm run release:pack --family vendor --out /private/tmp/dsh-release-0.1.1-rc.4/npm-vendor
```

Expected: the DSH output contains 234 projected tarballs plus one publish-order file; vendor artifacts retain their official names. Reuse the previously verified rc.3 Landlock tarballs only after checking their packed identities and hashes; if they are absent or changed, reacquire the verified Linux artifacts rather than fabricating platform binaries on macOS.

**Step 3: Verify local and Linux installation**

```sh
pnpm run release:verify-packed-install --family dsh --target alatastudio --from /private/tmp/dsh-release-0.1.1-rc.4/npm-dsh --from /private/tmp/dsh-release-0.1.1-rc.4/npm-vendor --from /private/tmp/dsh-release-0.1.1-rc.4/npm-landlock
docker run --rm --platform linux/amd64 -v /Users/apple/deepseek-harness:/repo:ro -v /private/tmp/dsh-release-0.1.1-rc.4:/release:ro -w /repo node:24-bookworm npx -y tsx@4.22.4 scripts/release/verify-packed-install.ts --family dsh --target alatastudio --from /release/npm-dsh --from /release/npm-vendor --from /release/npm-landlock
```

Expected: both probes report that installed `@alatastudio/dsh` is `0.1.1-rc.4`.

**Step 4: Apply the pre-push workflow and push**

Use `dsh-pre-push-checks` to inspect the outgoing scope against the verified fork base and reuse the fresh checks above rather than repeating them. Push only the release branch to `fork`, then verify the remote OID.

```sh
git push -u fork release/dsh-0.1.1-rc.4
git rev-parse HEAD refs/remotes/fork/release/dsh-0.1.1-rc.4
```

Expected: both OIDs match. Do not push to the upstream remote, where this npm account has no repository write permission.

## Task 8: Publish, verify, tag, and install globally

**Step 1: Run registry preflight without exposing credentials**

```sh
npm whoami
npm view @alatastudio/dsh@0.1.1-rc.4 version --json
```

Expected: `npm whoami` reports `alatachan`; the version lookup reports an npm 404 before first publication. Confirm the locally configured granular token grants package read/write for `alatastudio` and can bypass the account's publication-time two-factor authentication requirement. Never display the token value.

**Step 2: Publish the exact verified directory**

```sh
pnpm run release:publish --family dsh --from /private/tmp/dsh-release-0.1.1-rc.4/npm-dsh
```

Expected: all 234 packages settle as published or already present with identical integrity. If npm rejects authorization or two-factor authentication, stop without changing version or artifacts, correct local npm authentication, and resume the same command.

**Step 3: Verify registry integrity and dist-tag**

```sh
pnpm run release:publish --family dsh --from /private/tmp/dsh-release-0.1.1-rc.4/npm-dsh
npm view @alatastudio/dsh@0.1.1-rc.4 version
npm view @alatastudio/dsh dist-tags.next
```

Expected: the second publisher run skips all 234 artifacts with matching integrity, and both npm views report `0.1.1-rc.4`.

**Step 4: Verify a clean registry install, then install globally**

```sh
npm install --prefix /private/tmp/dsh-registry-smoke-0.1.1-rc.4 --no-audit --no-fund @alatastudio/dsh@0.1.1-rc.4
node /private/tmp/dsh-registry-smoke-0.1.1-rc.4/node_modules/@alatastudio/dsh/lib/bin.js --version
npm install -g @alatastudio/dsh@next
dsh --version
```

Expected: both version probes report `0.1.1-rc.4` and the global binary resolves as `dsh`.

**Step 5: Tag the published commit and push the tag**

```sh
git tag dsh-v0.1.1-rc.4 HEAD
git push fork dsh-v0.1.1-rc.4
git ls-remote --tags fork refs/tags/dsh-v0.1.1-rc.4
```

Expected: the remote tag resolves to the same source commit as the published release branch. Leave `dsh-v0.1.1-rc.3` unchanged.
