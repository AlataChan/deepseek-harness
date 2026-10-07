# Agent Note: Fork-owned documents are excluded from the bilingual pairing corpus

Status: implemented

English | [中文](2026-10-06-fork-owned-doc-exclusions.zh.md)

## Problem

`verify-translation-pairing` requires every document in scope to merge as a complete English/Simplified Chinese pair. This fork carries documents that have no counterpart to pair against and no reader who needs one: the Tauri shell's README and icon notes, the companion carrier packages, the bundled Python sidecar's directory notes, and dated working plans whose audience is the owner reviewing that piece of work.

Those documents failed the gate, and a merge of upstream is where that becomes blocking rather than cosmetic. A merge commit stages the whole tree, so every unpaired fork document is checked at once; because a hook gates the commit, the fork could not merge upstream at all until the debt was cleared. Ten such documents predated this decision.

## Decision

**List them as explicit exclusions in `scripts/translation-pairing.manifest.json` and state the reason for each group in `docs/i18n/README.md`.** The manifest already exists for this purpose, and the gate already rejects a `.zh.md` or `.i18n.yaml` for an excluded path, so an exclusion is a closed statement rather than a weakening: a translator cannot later add a half-maintained counterpart.

**Three groups, one reason each.**

- Fork-authored desktop and companion surface — the shell, its icons, and the companion carrier packages. Upstream ships no counterpart to pair against, and their audience is the fork's own maintainers rather than a reader of the published product.
- Dated working plans — the audience is the owner reviewing that work, and a plan is superseded rather than maintained once the work lands. A plan promoted into `docs/` proper joins the corpus at its new path.
- Bundled Python sidecar internals — directory notes for the sidecar's prompt and schema trees, read by whoever edits those trees.

**No directory-wide entry for `docs/plans/`.** Two plans in that directory do have reviewed Chinese counterparts, and excluding the directory would make the gate reject those existing pairs as translations that must not exist. The four unpaired plans are named individually, which also means a future plan must either ship a pair or be added here deliberately.

## Consequences

- The pairing gate passes, so an upstream merge can be committed. The remaining fork documents in scope are either paired or named in the manifest.
- A new fork-owned single-language document now fails the gate until it is either paired or added to the manifest with a reason. That is the intended cost: the decision stays deliberate instead of recurring as unexplained red.
- Excluded paths must carry no `.zh.md` and no `.i18n.yaml`. Adding a counterpart later requires removing the exclusion in the same change, so the two states cannot both be true.
- The exclusions are the fork's own, not upstream's. An upstream merge that rewrites one of these paths brings a conflict rather than silently un-excluding it.
- The documents still appear in the repository and remain readable; only their participation in the pairing contract changes.

## Alternatives considered

- **Translate all eleven documents.** Rejected because the pairing contract exists for readers of the published product, and none of these has that audience. Translating a dated plan also produces a second document to keep in step with work that will be replaced anyway.
- **Exclude `docs/plans/` as a directory.** Rejected: two plans there are already paired, and excluding the directory makes the gate reject those pairs as forbidden translations.
- **Narrow the gate to skip unpaired READMEs.** Rejected because it would silently exempt the whole product surface rather than naming the five fork-authored READMEs, and README pairing is exactly what the contract is for.
- **Commit the merge with hooks bypassed and fix the documents afterwards.** Rejected because it leaves the gate red in the commit that introduces the change, which is the state the repository's gate rules exist to prevent.
- **Bring the eleven documents along by hand, one at a time.** This is the path taken for the two generated catalogs, which are paired documents and must move with their English source. It is the wrong instrument here, where the pairing itself is the thing not wanted.
