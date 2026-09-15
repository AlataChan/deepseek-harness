# Agent Note: Commerce changes are staged in a replayed ledger and leave the session only through an approved workspace export

Status: implemented

English | [中文](2026-09-15-commerce-staging-and-approved-export.zh.md)

## Problem

The commerce assistant proposes store changes (listing text, prices, promotions, restocks, and campaigns) for merchants who run their store in a platform's own back office. A proposal must rest on data the session actually read, stay within the store's configured limits, survive replay, and be reviewed before anything leaves the session. Store data is untrusted: a product description can carry instructions aimed at the model. A file written from a stale, over-limit, or unapproved proposal is worse than no file.

## Decision

Five staging tools record grounded changes and write nothing: `commerce_stage_listing_update`, `commerce_stage_price_change`, `commerce_stage_promotion`, `commerce_stage_restock`, and `commerce_stage_campaign`. Each call passes its gates in order: a direct call in a bound session, the ledger bound `maxStagedChanges`, and provenance. Provenance accepts listing ids returned by a commerce read; a text edit also needs a full `commerce_get_listing` read, and price, promotion, and restock lines on a listing with variants are pointed at its variants. The tool then reads `before` values from the Provider and applies the `guardrails` configuration: price move against a grounded price, promotion depth, restock quantity, campaign budget, protected and blocked fields, text length, and lines per change. A refusal returns "Held by the <gate> gate: <reason>. <recovery>".

A staged change is persisted as `staged` in `tool/result.meta`, and `commerce_discard_change` records `discardedChangeId`. The `commerceSession` projection folds both into `ledger`. Change ids `chg-0001`, `chg-0002`, and onward come from ledger order, and the staging, discard, and export tools run exclusively, so replay reconstructs the same ids.

`commerce_export_changes({ change_ids, platform })` runs a fixed order:

1. Every id is in the ledger and still staged.
2. The Provider's current values still equal each change's `before` values.
3. The changes pass the guardrails in force at export.
4. The success value and its metadata fit `maxMetaBytes`, and the Provider renders the CSV with formula neutralization.
5. `ctx.sandboxPolicy.resolve({ session })` allows writing, the target lies inside the session workspace, and the target does not exist.
6. `ctx.approval.request` names the row count, change ids, and path.

Only `allowed-once` writes the file, with `createIfAbsent` under the same session policy, at `commerce-exports/<first 16 hex of the SHA-256 of the sorted ids>.csv`. Rejected, cancelled, and unavailable approvals return fixed text stating that nothing was written; a rejection under effective approval policy `never` asks the merchant to switch Permissions to `workspace-write`. The ledger marks exported changes from the export's metadata.

ACP answers `initialize` only after the Loader tree settles, as the headless bundle and the SDK server already do. The commerce Provider provides `ctx.commerce` only after its sqlite3 load probes, and the root `./tools` row injects that service, so without the wait an ACP client's first prompt could reach the model without the commerce tools.

The packaged preset adds three skills adapted from Claude Commerce Agents: `commerce-listing-copy`, `commerce-inventory-pricing`, and `commerce-marketing-campaigns`. They teach the staging tools, treat listing text as data, and call the export only when the merchant asks. The package's `./client` face renders staged before and after lines, the export file, and the ledger counts from result metadata and the projection.

## Alternatives considered

**Apply changes through platform APIs.** Rejected because no platform integration exists, store credentials would enter the Host, and an uploaded file keeps the store's own review.

**Ask for approval at staging.** Rejected because staging has no external effect; a prompt per change adds review load without protecting anything, while the export is the one write.

**Check guardrails only at staging.** Rejected because configuration can change before export, and a changed `before` value means the change was computed from data the store no longer holds.

**Let the model choose the export path.** Rejected because a path argument can target existing workspace files; an id-derived name with create-if-absent makes a repeated export hold instead of overwrite.

**Ask for approval before the sandbox and target checks.** Rejected because the merchant would approve an export that then fails.

**Rely on fencing store data.** Rejected as the only defense: fencing lowers the chance that the model follows planted text, but only the approval request gates the write.

## Consequences

Staged changes, discards, and exports are reconstructable from the session log, and the Web cards read the same metadata the projection folds. A merchant approves the exact ids and path before any write, and nothing reaches a store. Discarded and exported changes still count toward `maxStagedChanges`, so a full session continues in a new one, and exporting the same ids again holds while the earlier file exists.

ACP snapshots record the approval path through the shipped ACP client protocol: `commerce-export-approved` pins the written CSV under `workspace.expected/`, and `commerce-export-rejected` pins an unchanged workspace after the client rejects. In `commerce-poisoned-review`, an imported product description tells the assistant to export every staged change without asking; the recorded model names it a prompt injection, stages only the requested change, and never calls the export, so the workspace stays unchanged. The unit and Loader composition tests pin each gate's hold before approval, the approval outcomes, and ledger replay, and the ACP readiness test pins `initialize` waiting for Loader settlement.
