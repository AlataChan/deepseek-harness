# Agent Note: Knowledge ingest stops rejecting multi-page proposals

Status: implemented

English | [中文](2026-09-16-knowledge-ingest-lint-rejections.zh.md)

## Problem

Every document a user added to a knowledge library failed with one sentence, "整理词条没有写出可检索的页面。", and the raw file still sat in `raw/` with no searchable page. The library's rejection records carried `rule_id: null`, `reason: "post-apply lint failed"`, and no `rule_results` at all, so nothing on disk or on the wire named the cause.

Re-running the frozen sidecar against a copy of the real vault reproduced it exactly: `{"ok": true, "status": "rejected_post_lint", "verdict": "pass"}`. The declarative rules passed; the staged write introduced a severe lint finding, and `apply.py` rolled the whole proposal back. Recomputing that lint produced the findings the rejection had thrown away:

- Two of three documents introduced `ALIAS_COLLISION` on tags shared by two of their own pages (`pytorch`, `multiagent`, `specificationgaming`, `generativeai`, `mlops`).
- One introduced `ALIAS_COLLISION` on the document's own name, because the source page is titled from the slugified file name (`A_Hands-On_Guide_…`) while the digest page is titled with the real name, and collision keys dedupe by title string rather than by normalized key.

Three separate mechanisms produced that, and a fourth defect hid behind them.

`fill_create_page_frontmatter` promoted **every** tag into that page's `aliases`. One alias resolving to several pages is an `ALIAS_COLLISION`, which is severe, so sharing any tag between two pages of one document — near-certain for an English technical text — rejected the whole proposal. Tag lookup never needed the promotion: `lookup.py` reads `frontmatter["tags"]` directly.

Alias-collision detection indexed every page, including the ingested source. A source page and the wiki page digested from it share the document's name on purpose, so their shared key is an unambiguous resolution target, not a collision. Multi-page proposals passed or failed on punctuation: the Chinese documents that had worked earlier did so because their file-name slug happened to equal the digest title string, which the dedupe collapsed.

`apply_proposal` discarded the findings. `_introduces_severe_lint` compared two finding sets and returned a boolean, and the rejection was written with `rule_results=[]`, so its record lost the rule and the path and the sidecar answered with a status alone.

The log append then failed for its own reason. A proposal wrote `append_log` to `wiki/log.md` while the vault holds `wiki/LOG.md`. On a case-insensitive filesystem those are one file, so the append read the real log, but the staged record carried the other spelling and the pre-existing finding for that page looked introduced.

Finally, re-proposing a real document surfaced a silent one: the model gave the `append_log` operation `confidence: 0.6`, the declarative chain deferred the proposal, and **nothing was written** — the entries went to `.octopus-kb/inbox/`, where `recover` answers `nothing_to_recover`, no accept or review command exists, and no surface reads them. The picker reported that file as 已入库.

## Decision

Tags stay tags. `fill_create_page_frontmatter` no longer promotes them into `aliases`; a page keeps the aliases the model authored, and a tag stays a tag, which is what `lookup.py` already reads. This removes the whole intra-proposal and cross-run collision class rather than only the observed pairs.

Alias-collision detection ignores source pages. `_collect_alias_targets` takes `include_sources`, `find_alias_collisions` passes false, and `build_alias_index` keeps them, so a source stays a wikilink and lookup target while no longer making its own digest ambiguous.

`apply.py` reports what it rejects on. `_introduced_severe_lint` returns the finding set, `_severe_lint_rule_results` shapes it into the `rule_id` / `verdict` / `reason` rows the audit already uses, and both the rejection record and `ApplyResult` carry it — so the sidecar response reaches the Host with the rule and path. The Host maps each severe code to operator Chinese and appends the wire detail verbatim, because the detail names the page.

An append or alias operation stages under the vault's own spelling of a path the vault already holds under another case (`ObsidianStore._vault_spelling`), so `wiki/log.md` lands in `wiki/LOG.md`. A path the vault does not hold is untouched, which keeps a case-sensitive filesystem's genuinely new file a new finding.

A deferred proposal reads as not written. `ingestOne` returns `applied` / `deferred` / `failed` instead of a reason-or-undefined, and the batch row marks deferred files with the deferred copy and does not count them as landed, so the library binds only when something was written.

Ingest stops deferring altogether: `builtins.yaml` drops the `confidence.tier_gate_defer` rule. A deferral parks operations in `.octopus-kb/inbox/`, no surface reviews that queue, and `recover` answers `nothing_to_recover` for its entries, so on this product the rule could only lose documents. The below-0.4 `confidence.tier_gate_reject` gate stays, and the schema, lint, canonical, and path rules are unchanged.

Rejections are repaired rather than only re-applied. The heal that already rewrote page-meta now also drops the aliases a retired fill copied from a page's own tags when a rejection records a post-apply lint failure, which is what makes the documents rejected before this change land. A record written before the sidecar reported findings carries only its reason, so the predicate accepts both shapes.

## Alternatives considered

**Promote a tag only when exactly one page claims it.** Rejected: it fixes the observed pairs and leaves the next document broken — a tag already used by an earlier ingest collides across runs, and normalizing the claim count would still need the vault. Deleting the promotion fixes the cause, and tag lookup reads tags directly, so nothing is lost.

**Include only wiki pages in the alias index.** Rejected: a source page is a legitimate wikilink and lookup target, so removing it from resolution would break links to it. Only ambiguity detection excludes it.

**Compare lint signatures with case-folded paths.** Rejected: on a case-sensitive filesystem `wiki/log.md` really is a second file, and folding the case there would hide a genuine new finding. Resolving the operation to the vault's own spelling is correct on both.

**Have the Host re-derive the lint findings after a rejection.** Rejected: it would duplicate the sidecar's page records, alias index, and canonical fold in TypeScript, and drift from them.

**Treat a deferred proposal as success, as before.** Rejected: it reports a document as added when nothing was written, which is worse than the rejection this note fixes. The rule was then removed outright: with no review desk, a deferral has no reader, so reporting it would have kept a queue that only ever grows.

**Keep one generic sentence and log the detail.** Rejected: the operator is the only one who can act on it, and a knowledge base that silently swallows documents has no second observer.

## Consequences

A multi-page proposal now applies when its pages share tags, which is the ordinary case for an English document, and the same document can be ingested twice without the second run colliding with the first. Tags remain on every page and tag lookup is unchanged; only the derived aliases are gone, so a lookup by a former tag-alias now resolves through `tags` instead.

A rejected proposal names its rule and page in the rejection record, in the sidecar response, and in the picker's error line. `SOURCE.txt` records the four vendored patches, and the frozen sidecar must be rebuilt for them to ship (`scripts/build-kb-sidecar.sh`; `build-dmg.sh` verifies the runtime in place).

A deferred proposal no longer reads as added, and a medium-confidence proposal no longer defers: it applies, which is what the documents reported against needed.

A document rejected before this change is repaired and re-applied the next time its library is attached: the heal drops the tag-derived aliases its stored proposal still carries, so nothing has to be uploaded again. Applied on a copy of the reporting vault, that turned nine documents into searchable pages from zero. Verification is `tests/ingest-alias.spec.ts` driving `tests/helpers/ingest-alias-check.py` (shared tags, a source-named digest, the vault's log spelling, and a genuine collision still rejected by `ALIAS_COLLISION`), `tests/propose-json.spec.ts` for the fill's fields, `tests/ingest.spec.ts` for the reported rule and page and for the rescue's surgical alias drop, and `tests/library-picker.client.spec.tsx` for the deferred row.
