# Agent Note: Desktop knowledge picker dismisses, and page-meta rejections heal

Status: implemented

English | [中文](2026-09-16-desktop-knowledge-picker-dismiss-and-reject-heal.zh.md)

## Problem

Two defects met in the desktop 知识库 picker, and together they made a knowledge library look like it accepted one document.

The panel could not be dismissed. It rendered no close control, and the hero chip returned early when a panel already existed, so clicking 知识库 a second time did nothing. The only exits — picking a library name and Skip — both attach the library, so a user who wanted to back out was trapped in the panel, including in the upload panel after a failed ingest, which has neither a close control nor a way back to the list.

A library appeared to hold one document. Two mechanisms caused it. The composer plus entry opened the picker directly on the upload panel with no target library, so its only possible outcome was a newly created library, and one file produced one library. Separately, every proposal whose `create_page` frontmatter failed the page-meta schema was written to `.octopus-kb/rejections/` and never retried: the document stayed under `raw/` and never became a searchable wiki page. The vendored `heal_page_meta_rejections` never ran, because the `inbox-list` command lists only `.octopus-kb/inbox/`, and no production caller existed. On the reporting machine, 8 uploads across 3 libraries produced 1 wiki page.

## Decision

The picker is a `Modal`; Escape and the Modal close control dismiss both phases, and the hero chip toggles: a second click on 知识库 closes the picker. The plus-menu bridge keeps an idempotent open, so a request to add a document never closes an open panel. `LibraryPicker` no longer accepts `initialPhase` and `LibraryPickerPhase` is no longer exported, because no entry opens the upload panel directly.

The composer plus entry opens the picker on the library list. A document then lands in the library the user picks through 添加文档, or in a new one through 新建知识库 ([picker entry](../feature/2026-08-31-composer-plus-attach.md) owns the plus menu itself).

`healPageMetaRejections` runs inside `attach`, after `recoverPendingAudits`. For each `.octopus-kb/rejections/<id>.json` whose recorded failure is only `schema.page_meta_invalid`, it reads the matching `.octopus-kb/proposals/<id>.json`, applies `rewriteInvalidCreatePageMeta`, writes the file back, and re-runs sidecar `validate-apply`. Sidecar apply fills `role`, `layer`, and a wiki `summary` and evaluates the frontmatter after that fill, so a `type` outside the page-meta enum is the only field the Host has to repair. The heal rewrites only when the rewrite reports a change, so a rejection that failed any other rule is left alone and never retried. A failed `validate-apply` is swallowed because apply records its own rejection or audit; an aborted caller propagates, so an aborted attach does not hang.

## Alternatives considered

**Keep the upload panel as the plus entry's first panel.** Rejected: that panel can only create a library, which is exactly the one-library-per-file outcome the report describes. Opening the list makes the target library an explicit choice.

**Give the panel a modal backdrop instead of a close control.** Rejected: the picker renders inside the composer stack beside the hero row rather than over the app, so an outside-click region would add a layering rule for no gain over a close control plus a toggling chip.

**Heal through a new sidecar command.** Rejected: octopus-kb is vendored and ships `heal_page_meta_rejections` with no CLI command reachable from `sidecar.py`; adding one edits vendored source. The Host already owns the proposal files and already calls `validate-apply`.

**Heal during `finishIngest`.** Rejected: that adds a vault scan and sidecar calls to every upload. Attach is where the user is about to read the library, the scan costs nothing when no rejections exist, and a healed page is then visible to the first retrieve of that session.

**Broaden the rewrite to `title`, `lang`, `layer`, and `summary`.** Rejected: sidecar apply already repairs `role`, `layer`, and wiki `summary`, and every observed rejection carried an invalid or missing `type`/`role`. Repairing fields apply overwrites would add branches with no observed case.

## Consequences

Both exits work: the close control and a second chip click dismiss the panel from either panel, and the upload panel is no longer a dead end after a failed ingest. A plus-menu upload no longer silently creates a library per file, so several documents can accumulate in one library.

Documents already under `raw/` whose only failure was page-meta become searchable on the next attach. Each is healed once — the second attach finds valid page-meta and skips it — and a proposal that keeps failing another rule is not retried.

Attach pays one `validate-apply` per pending page-meta rejection, and nothing when the vault has no rejections directory. A broken proposal cannot block attaching, because a failed apply is swallowed.

`LibraryPickerInjected` loses `initialPhase` and the `/client` entry drops `LibraryPickerPhase`; both are private overlay API with no external consumer. Verification is `packages/experimental/desktop-ask-knowledge/tests/ingest.spec.ts` for the heal cases (applied, skipped, missing proposal, unparsable rejection, failed apply, aborted caller), `library-picker.client.spec.tsx` for the close control and the create control's upload panel, and `apply.client.spec.ts` for the chip toggle and the idempotent bridge open.
