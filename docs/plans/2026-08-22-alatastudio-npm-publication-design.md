# AlataStudio npm Publication Design

English | [中文](2026-08-22-alatastudio-npm-publication-design.zh.md)

The [operator-owned npm scope decision](../../.agents/notes/implemented/process/2026-08-22-operator-owned-npm-scope.md) owns the decision and alternatives. This document defines the implementation design for publishing the DSH family as `@alatastudio/*` while preserving the upstream source namespace.

## Goals and constraints

- Publish the complete DSH release family as `@alatastudio/dsh` and `@alatastudio/dsh-*`.
- Keep the executable name `dsh` and the source package graph under `@deepseek-ai/dsh*`.
- Keep external official dependencies such as `@deepseek-ai/cordis*` unchanged.
- Reuse the existing family ordering, integrity-aware publishing, dist-tag selection, and packed-install verification.
- Release the projected family as `0.1.1-rc.4`; the existing `dsh-v0.1.1-rc.3` tag remains unchanged.

## Publication-target model

Release scripts own a closed publication-target definition. `official` is the default and preserves every current identity. `alatastudio` is valid only with the `dsh` family and maps each member through the complete DSH family inventory.

The target definition supplies the projected member name, the installed entry package, and the namespace validation policy. Tarball publishing does not receive a target: it continues to trust identities read from validated artifacts.

## Pack data flow

1. Discover and order the source DSH family with the existing family graph.
2. Run the normal package pack lifecycle into a task-local staging directory so the source manifest still selects the authoritative payload.
3. Extract the staged tarball, project its package manifest and UTF-8 text files, and keep binary files byte-identical.
4. Reject unknown DSH package references and any remaining `@deepseek-ai/dsh` package reference.
5. Repack the projected payload with stable entry ordering and normalized archive metadata, then validate its files and projected identity.
6. Write final tarballs and `publish-order.txt` using the projected names.

Temporary paths never become release outputs. A failed member removes its incomplete final tarball and leaves no publish-order entry that could authorize publication.

## Projection rules

| Input | Projected output |
|---|---|
| `@deepseek-ai/dsh` | `@alatastudio/dsh` |
| A known `@deepseek-ai/dsh-*` family member | The same suffix under `@alatastudio` |
| A subpath of a known DSH package | The projected package name with the same subpath |
| `@deepseek-ai/cordis*` or another external package | Unchanged |
| Binary payload | Unchanged |

The package inventory, not a free-form scope replacement, authorizes mappings. JSON manifests are rewritten structurally; other UTF-8 payloads use known package-name matching ordered from longest name to shortest so package prefixes cannot partially rewrite sibling names.

## Validation and failure behavior

The command rejects an unknown target, an `alatastudio` target outside the DSH family, a projected-name collision, an unrecognized source-scope DSH reference, a residual source-scope DSH reference, a changed binary file, and any mismatch among manifest identity, tarball filename, and publication order.

Unit coverage pins target parsing, name and subpath projection, external-package preservation, longest-name matching, residual detection, and invalid target-family combinations. A pack integration fixture proves manifest dependency keys, JavaScript imports, declarations, configuration references, binary preservation, final identity, and publication order through a real tarball.

## Release verification

The release sequence bumps the DSH family to `0.1.1-rc.4`, builds the official source graph, runs the focused release tests and documentation checks, and packs all DSH members with `--target alatastudio`. Existing official vendor and Landlock tarballs remain valid inputs because their package identities are not projected.

A clean Linux environment installs only local tarballs and verifies that the installed `@alatastudio/dsh` reports `0.1.1-rc.4`. Registry preflight verifies the authenticated npm identity, write access to the target organization, absence of the target versions, and use of a credential that can satisfy the account's publication-time two-factor authentication policy.

After publication, the release verifier checks every expected registry identity and artifact integrity, confirms `@alatastudio/dsh@next` resolves to `0.1.1-rc.4`, and installs the CLI from the registry in another clean environment. The release is complete only after all checks pass and `dsh-v0.1.1-rc.4` points at the published source commit on the operator fork.

## Out of scope

This work does not rename source packages, republish vendored Cordis or Landlock packages under `@alatastudio`, add compatibility aliases, alter runtime plugin resolution, or change the `dsh` executable name.
