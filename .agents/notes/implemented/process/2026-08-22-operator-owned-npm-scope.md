# Agent Note: Project DSH npm artifacts into an operator-owned scope

Status: implemented

English | [中文](2026-08-22-operator-owned-npm-scope.zh.md)

## Problem

The DSH workspace source names belong to the `@deepseek-ai` npm scope, but a release operator may have publication rights only in another organization. npm does not allow that operator to publish the existing names, while renaming the source graph would change repository-wide package identities for a distribution concern.

The public CLI also depends on the complete DSH package graph. Publishing only `@alatastudio/dsh` would leave its runtime dependencies unavailable under names the operator controls.

## Decision

The DSH release packer accepts an explicit publication target. The default target retains the source package identities. The `alatastudio` target projects every packed DSH package from `@deepseek-ai/dsh` or `@deepseek-ai/dsh-*` to the corresponding `@alatastudio` name without modifying workspace manifests or source imports.

Projection operates on the exact payload selected by the normal package lifecycle. It rewrites package identity, DSH dependency keys, and textual references to known DSH package names, then creates the final tarball with deterministic archive metadata. External packages, including `@deepseek-ai/cordis*`, keep their original identities.

The target applies only to the DSH release family. Packing fails if the final payload retains a source-scope DSH package reference, maps an unknown DSH name, changes a binary payload, or produces an identity inconsistent with its tarball and publication order.

Publication remains artifact-driven and target-independent: the publisher reads the projected identities from the tarballs, keeps the existing integrity-aware retry behavior, and assigns prereleases to `next`.

## Alternatives considered

**Rename the workspace packages.** This would make the fork internally consistent with one npm organization, but it would turn a publication-authorization constraint into a repository-wide source divergence and make upstream changes unnecessarily expensive to merge.

**Use npm aliases only in the CLI package.** Aliases do not cover runtime imports, peer dependency names, generated declarations, configuration references, or dynamically loaded plugins across the complete package graph. The resulting artifacts could install but fail after launch.

**Publish one self-contained CLI bundle.** The harness loads plugins, resources, native packages, and configuration through package identities and filesystem paths. A single bundle would require a separate packaging architecture and would weaken the existing per-package verification and retry model.

## Verification

- Target tests pin the default official identities, AlataStudio names and subpaths, source-member immutability, installed entries, and rejected target-family combinations.
- Projection tests pin manifest keys and values, text payloads, external package preservation, binary identity, residual source-name rejection, and archive path safety.
- A real two-package pack fixture runs source lifecycle scripts, repacks projected payloads twice with equal hashes, and withholds `publish-order.txt` when one member fails.
- Packed-install tests require the target-specific CLI tarball before npm install while retaining the existing direct-file dependency overrides.

## Consequences

Text projection can miss a package-bearing file format or rewrite content that is not a package reference. The packer limits edits to UTF-8 text, matches only release-family package identities, scans every final payload for residual source names, and keeps binary files byte-identical.

The projected graph doubles the published identity set without creating a second source namespace. Consumers must treat `@alatastudio/*` as a distribution of this fork rather than as interchangeable source package names.

npm publication is not atomic. Integrity-aware retries prevent already-published matching artifacts from blocking recovery, but consumers must not treat the release as available until every expected package and the final dist-tag verify successfully.
