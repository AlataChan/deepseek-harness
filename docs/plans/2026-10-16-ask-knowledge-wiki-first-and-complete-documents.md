# Ask Knowledge: Wiki-First Answers and Complete Documents

English | [中文](2026-10-16-ask-knowledge-wiki-first-and-complete-documents.zh.md)

**Status:** Tasks 1–3 are accepted for their reviewed scope. Tasks 4–6 and the Required source remediations are implemented and await independent acceptance. Task 7 includes a rebuilt macOS artifact; native Windows installed acceptance, packaged WebView resource measurement and final independent release approval remain pending. The upload default remains 20 MiB.

## Summary

Make LLM Wiki the primary knowledge representation and answering path. Preserve complete accepted documents for evidence and fallback. Apply bounded processing and model requests without silently discarding document tails. Ordinary users upload documents, see truthful readiness, and ask questions; they do not configure retrieval algorithms.

This self-contained plan supersedes the query-order and session-document decisions in the earlier 2026-10-15 source-retention proposal. It keeps retention, recovery, isolation and explicit spending approval, makes wiki navigation primary, and adds conversion tools over official durable attachments. The historical proposal is not a linked prerequisite or a clean-checkout dependency. This English file, its Chinese counterpart and their pairing record form one delivery set.

## Table of Contents

- [Requirements](#requirements)
- [Current implementation](#current-implementation)
- [Scope](#scope)
- [Architecture and behavior](#architecture-and-behavior)
- [Implementation sequence](#implementation-sequence)
- [Acceptance matrix](#acceptance-matrix)
- [Verification and release](#verification-and-release)
- [Dev Note](#dev-note)

<a id="requirements"></a>
## Requirements

1. An accepted library upload preserves the complete original. Conversion, source indexing and wiki processing either finish their declared work or expose the exact incomplete work. Upload success alone never means knowledge preparation is complete.
2. A session-only attachment makes the complete supported document available to its owning session, including its final pages. It does not join a knowledge library automatically. A bounded inline preview is allowed only when the complete document remains accessible.
3. Search/read responses remain bounded. Relevance, diversity, result count and continuation govern what enters one model request; those bounds never delete retained content.
4. The knowledge module adds no final-answer character cap. The selected model and general agent runtime continue to own output limits.
5. Ordinary library questions use wiki pages and their links first. Original sources verify citations and answer omissions, incomplete wiki coverage or explicit source-reading requests.
6. User-facing controls cover library selection, upload, progress, spending approval, cancellation and recovery. Chunk size, top-k and ranking weights remain internal deployment settings.

**Proposed library upload ceiling:** 100 MiB per file (104,857,600 bytes), conditional on Task 1 memory, transport and conversion measurements on macOS and Windows. Retain the current supported default until those measurements pass. Official generic attachments currently have no file-size cap; reuse that intake unchanged and apply the measured document-conversion admission ceiling in the overlay. An accepted attachment can therefore be retained while its conversion is explicitly refused. Do not promise a shared Client upload cap without a separately reviewed change to the official intake. Archive expansion, page, memory, disk, elapsed-time and converted-output limits must fail visibly without reporting a complete conversion.

<a id="current-implementation"></a>
## Current implementation

The following observations refer to the inspected working tree, not a committed release. Task 1 must freeze the exact reviewed source state before implementation.

| Observation | Source | Consequence |
| --- | --- | --- |
| The model-facing retrieve tool chooses the passage search branch when supplied | [tools.ts](../../packages/experimental/desktop-ask-knowledge/src/tools.ts) | Wiki and raw passages share the primary query path |
| The passage index includes raw and wiki Markdown but excludes INDEX.md and LOG.md | [search.py](../../packages/experimental/desktop-ask-knowledge/python/documents/search.py) | Wiki navigation does not lead ordinary answers |
| Live planning slices complete text into windows; a second structural planner also exists | [pipeline.py](../../packages/experimental/desktop-ask-knowledge/python/documents/pipeline.py), [chunks.py](../../packages/experimental/desktop-ask-knowledge/python/documents/chunks.py) | Complete coverage needs one authoritative production manifest |
| Legacy session extraction clips at 32,000 characters, but its composer slot is no longer rendered | [extract.ts](../../packages/experimental/desktop-ask-knowledge/src/extract.ts), [InputBar.tsx](../../packages/client/ui-conversation/src/client/skeleton/InputBar.tsx) | The declared slot and framing tests do not establish a reachable product path |
| Official generic file attachments retain exact bytes and log name, size and digest; storage has no file-size cap or automatic deletion | [attachment definition](../../packages/attachment/attachment/src/index.ts), [file store](../../packages/attachment/attachment-local/src/file-store.ts), [attachment README](../../packages/attachment/attachment/README.md) | Reuse official upload, ownership and retention; add conversion rather than a second attachment store |
| Legacy library upload materializes the whole file and all base64 chunks; conversion has 90-second call sites, a 50 MiB output cap and an 8 MiB DOCX XML cap | [ingest-file.ts](../../packages/experimental/desktop-ask-knowledge/src/client/ingest-file.ts), [LibraryPicker.tsx](../../packages/experimental/desktop-ask-knowledge/src/client/LibraryPicker.tsx), [conversion.ts](../../packages/experimental/desktop-ask-knowledge/src/conversion.ts), [extract-docx.ts](../../packages/experimental/desktop-ask-knowledge/src/extract-docx.ts) | Raising the upload ceiling requires streaming and measured, explicit conversion limits |

<a id="scope"></a>
## Scope

Own implementation in `packages/experimental/desktop-ask-knowledge/`, including its overlay-owned document service, tools, Client and Python sidecar. Reuse the existing wiki proposal/apply machinery, source store, library catalog, durable jobs, session query and managed subprocess services. Packaging scripts, plugin pins, generated catalogs, tests, paired READMEs and necessary upgrade guidance may change.

Do not modify `packages/core/`, `packages/client/`, `packages/subagent/`, `apps/desktop/`, official desktop composition or companion product logic under this plan. Consume official attachments through public services and the caller session’s durable file references. Do not revive `conversation.input.attachSessionDocument`, use `frameSessionDocument`, invent claimable text markers, or add a second pre-session upload/ownership protocol. If a necessary public API is missing, identify it explicitly for separate scope review rather than duplicating the official attachment system.

No vector database, embedding service, external OCR service or new inference provider is required. Scanned content remains explicitly OCR-required until a separately accepted OCR capability exists. Source references use existing logged user messages and tool results; add no new Session event type for this feature.

<a id="architecture-and-behavior"></a>
## Architecture and behavior

### 1. Separate completeness from model context

Preserve immutable original bytes and versioned normalized text. Conversion records page/block diagnostics and unsupported content where the format exposes them. A mixed scanned/text PDF or a fallback converter that omits tables, notes or other supported-content targets is partial, even if the extracted text was fully indexed. Do not equate successful conversion exit, full normalized-text coverage or successful LLM calls with proof that every source fact was understood.

Track original retention, conversion, source indexing and wiki compilation independently. Show aggregate states such as processing, ready, source-only, partially converted, awaiting approval, paused, failed and cancelled, with reasons and counts. Wiki-ready means every eligible range in the approved revision has been processed and its proposals validated/committed, not semantic infallibility. When no facts are extracted, persist the valid no-candidate outcome rather than inventing a wiki page.

### 2. Use one complete document manifest

Make the production job planner the sole owner of an immutable manifest containing source/conversion revision, primary ranges, overlap context, block locations, prompt/schema version, route constraints and approved budget ceiling. Do not freeze complete future requests or existing wiki bodies into this manifest. Integrate structural planning from `chunks.py` where useful; remove or delegate the second independently generated plan. Extraction, progress, retries and acceptance must consume the same manifest. A separate checker derives expected coverage from normalized text and validates ordered, nonoverlapping primary spans covering the full eligible interval; it must not trust a producer-provided complete flag.

Budget the entire manifest conservatively using prompt/schema overhead, a per-chunk wiki-context allowance, output reserves and explicit retry reserves. The approval is a maximum spending ceiling, not a promise of exact cost. Resolve relevant wiki context when each chunk executes, so chunk 20 can read pages committed by chunks 1–19. Bound and log the actual serialized request immediately before dispatch, recheck the remaining ceiling, and pause before any call that cannot fit. The stable work key is document/conversion revision plus primary range and prompt/schema version; each deliberate paid attempt receives a durable attempt ID. Dynamic request hashes are audit evidence, not a new work identity or permission to replay uncertain work. Route/prompt revisions or higher ceilings require renewed approval. Insufficient approval pauses the remaining work; it never reduces the planned source range. Conversion and source indexing remain available without paid compilation. A provider output-limit finish or ambiguous response cannot complete a chunk. Resume must require an explicit outcome decision when previous paid execution is uncertain.

### 3. Compile a maintained wiki

LLM processing proposes additions or revisions to existing entity, concept and topic pages. Resolve candidate pages by stable identity, aliases, links and bounded relevant context rather than the first alphabetically sorted wiki files. Merge repeated claims, preserve citations, distinguish conflicting dated facts and retain human-authored edits. Link accepted pages into the curated topic index and related-page graph. Merely emitting one independent summary per source chunk does not satisfy wiki compilation.

Each claim or supported claim group identifies its document/conversion revision and available page/block/span locators. Never fabricate page numbers. Page/index/link publication uses revision checks, existing proposal validation, a recoverable commit record and durable operation deduplication. A crash must recover or disclose an incomplete publication; it must not lose sources, erase human edits or apply the same fact twice. Deleted or superseded sources invalidate affected citations and wiki readiness until repaired.

### 4. Make the answering path wiki-first

Keep `ask_knowledge_retrieve` as the existing model entry, but make its ordinary-library mode search wiki titles, aliases, topic index and page content first. Return a bounded selection of wiki pages with related links, citations and coverage status. `ask_knowledge_lookup` reads a selected wiki page or linked section with continuation. Do not flatten raw-source hits into the same initial ranking pool. Preserve `retrieveBundle` and `lookup` remotes for existing consumers or update all consumers explicitly where an API change is necessary.

For library model tools, mechanically require a successful logged wiki attempt earlier in the same turn and authorized library before source fallback, including a recorded no-hit or unavailable result. Verify session/library identity, current turn, revision, cursor and actual read outcomes in code; reject a fabricated attempt ID. Source-view UI and official session-only attachments are separate authorized operations. Fallback reasons such as explicit user request, contradiction or citation verification are model-declared explanations, not facts the executor can prove. Prompts and independent answer evaluations govern those semantic decisions; the plan does not claim code can authenticate user intent from a reason string. A source-only library remains useful through a logged wiki-unavailable attempt and clearly disclosed fallback.

**Source verification rule:** Any answer presenting a number, date, obligation, exception or direct quotation as verified source fact must cite a document revision and source span successfully read in that same turn. Wiki citations alone do not establish verification. If source reading is unavailable or not performed, explicitly label the claim as coming from an unverified wiki summary; do not silently present it as confirmed. Code can validate read receipts and citation targets and expose verification metadata. It cannot reliably detect every factual claim in unrestricted generated prose; answer-level compliance requires prompts, adversarial evaluation and review. Wiki still supplies the organization and synthesis; source reads supply evidence.

A follow-up such as “show me the source for that” repeats both the wiki attempt and the source read in the new turn; previous-turn receipts do not qualify. The extra calls and latency are an intentional evidence-freshness cost, not a duplicate-work defect. Caches may reduce conversion or I/O, but must revalidate revisions and emit fresh same-turn tool results.

Rank each layer independently, suppress duplicate excerpts, retain document diversity and keep related exceptions/table headers attached. Use sensible internal result and byte/token budgets. A continuation token binds the library or session, document revision, query and index generation. The model may continue reading within the normal agent budget; hitting a read or navigation limit must disclose incomplete inspection. Keyword misses and bounded searches never prove that the whole library lacks a fact.

### 5. Provide complete session-only document access

Use the official composer file attachment flow and `ctx.attachments` as the only original-byte owner for this mode. Its logged user-message file parts identify the attachment by digest, name and size and already cover upload before session creation and durable prompt admission. The overlay adds a tool that converts supported PDF/DOCX attachments, then exposes bounded search and read with locators and continuation, even when no knowledge library is bound. The tool accepts a digest or filename only as a selector matched against authorized `FileBlock` references in the caller session. A selector grants no access itself; ambiguous filenames require a digest or a bounded list of authorized choices. Never accept an arbitrary filesystem path or copied text marker as authority. Implement this explicit authorization rule: a matching-digest `FileBlock` must appear in the caller session’s model-visible history, including history inherited at a fork. Shared storage retention or a digest mentioned in ordinary text does not satisfy the rule.

After resolving an authorized reference, use `ctx.attachments.readFileStream(ref)` for digest- and length-checked reads. `ctx.attachments.fileHostPath(ref)` may provide a provider-owned local path where supported; it is not a model-supplied path. Start from the [public attachment APIs](../../packages/attachment/attachment/src/index.ts) and the existing file-reference traversal in [session-log export](../../packages/session-query/session-log-export/src/archive.ts). Verify integrity before publishing converted results.

Cache normalized text and conversion diagnostics by attachment digest plus converter version/options; immutable input can share conversion work without sharing access. Revalidate membership in the caller session on every search/read, including cache hits and continuation. Cache keys grant no authority, and cross-session requests must reveal neither cached text nor existence. Apply the explicit model-visible-history rule above to inherited references as well; storage sharing alone never grants a fork access. All model-visible excerpts and conversion/read outcomes use ordinary logged tool results. Bound conversion resources and expose refusal or partial conversion without pretending the retained file was lost or fully understood.

Preserve official retention semantics: generic attachment objects survive restart and are not automatically deleted. Do not promise session deletion, clear or fork will physically delete shared content-addressed originals. The overlay may evict regenerable conversion caches without deleting originals; after session deletion, its session-authorized tools must refuse access through that deleted session. Any future original-byte garbage collection or retention change is a separate attachment-service design and user-facing policy. No new claim protocol, framing reference, custom upload store or 24-hour expiry is introduced.

### 6. Keep the interface simple

Library flow: select/create a library, upload, see conversion/source/wiki readiness, approve the estimated wiki compilation when necessary, then ask. Session flow: attach, see whether the full document is available, then ask. Offer original/text viewing and clear recovery actions. Keep extraction budget approval separate from ordinary model answer usage; disclose that automatic wiki preparation uses model quota. Do not require ordinary users to select chunking, FTS, overlap, top-k or ranking parameters.

<a id="implementation-sequence"></a>
## Implementation sequence

Each task lands with passing focused tests and its valid/invalid controls. Do not land failing characterization tests as a standalone change. The Task 1 baseline disposition and Task 2 have been accepted. Task 3’s required fixes are verified. Tasks 4–6 are implemented; final acceptance and the remaining Task 7 platform evidence are still required. Task 1 is a read-only audit/measurement and test-prototype checkpoint; it does not revive the retired attachment slot.

| Task | Deliverable and owning files | Exit condition |
| --- | --- | --- |
| 1. Checkpoint and audit the existing implementation | Tracked/untracked inventory and hashes; keep/replace table; prior finding/control ledger; official attachment and resource probes | Reproducible baseline checkpoint; no unverified finding marked closed; measured input/output/transport limits and official attachment public APIs documented before Task 2 |
| 2. Unify completeness and upload admission | `src/upload-temp.ts`, `src/source-store.ts`, `src/documents-service.ts`, `python/documents/store.py`, `pipeline.py`, `chunks.py` | File.slice streaming with bounded outstanding chunks; configurable conversion limits; measured upload ceiling; one manifest; independent full-range verifier rejects lost tails |
| 3. Maintain linked wiki pages | `python/documents/pipeline.py`, existing wiki propose/apply/index code, versioned metadata | Execution-time bounded wiki context observes prior chunk commits; stable work/attempt IDs, budget ceiling, citations, merge/link/conflict safety and crash recovery |
| 4. Route ordinary answers through wiki (implemented; review pending) | `src/tools.ts`, `src/prompt-retrieve.ts`, `src/document-retrieve.ts`, sidecar wiki navigation/search | Logged same-turn wiki attempt enforced before library source tools; same-turn source evidence or explicit wiki-summary label for factual answers; semantic claims evaluated separately |
| 5. Convert official session attachments | Overlay conversion cache and session-authorized search/read tools over `ctx.attachments`; no custom upload/store/slot | PDF/DOCX first/middle/final facts readable after restart through official attachment references; cache-hit isolation and corruption controls pass without a library |
| 6. Mount truthful status and defaults | Existing library/session attachment Client components and typed bilingual locales | Readiness and missing work are visible; model spending is explicit; technical search controls are absent from normal flow |
| 7. Migrate and package | Monotonic migrations, profile pins, installed flow verifiers, affected docs/catalogs | Existing libraries remain usable; DMG and native Windows installed acceptance establish the same behavior |

### Baseline checkpoint and keep/replace inventory

Before Task 2, create a named, restorable checkpoint covering tracked diffs and untracked product/tests/build files, with per-file hashes and the actual base revision; exclude credentials and private user material. A scoped baseline commit may be used when authorized, otherwise retain a patch plus source archive and restore instructions. Do not rewrite the uncommitted implementation in place without this checkpoint. Inventory the earlier Required findings, including K1–K15 and later follow-up findings, against their archived controls; mark each verified closed, still open or superseded with evidence. A remediation report or passing helper test alone cannot close a finding. Any unresolved finding relevant to a task is a prerequisite or explicit task acceptance item. Current planning status: historical Required findings have not been rerun in this revision and remain unverified for baseline acceptance; this document does not certify their closure.

Task 1 publishes the finding ledger in `docs/plans/2026-10-16-ask-knowledge-baseline-audit.md`, with a Chinese counterpart and pairing record. Its historical input includes `.plans/desktop-ask-knowledge/implementation-independent-review-2026-10-15.md` (K1–K15), an owner-local archive rather than a clean-checkout link dependency. Each ledger row identifies the finding, source report/control, current disposition, executed command/result and reviewable evidence reference. Controls not rerun remain unverified. Publish enough evidence with the audit to review its conclusions without the private archive.

| Existing component | Disposition | Required check before reuse |
| --- | --- | --- |
| Immutable source store and library document catalog | Keep | Integrity, authorization, registration recovery and prior controls |
| Durable jobs, fencing, cancellation and recovery | Keep; adapt work/attempt identity | Real public callers, crash/cancel races and uncertain paid execution |
| Isolated converter worker and format adapters | Keep; revise limits/configuration | Full output, cancellation, confinement and installed-platform behavior |
| Passage index, source search and `ask_knowledge_read` | Keep as evidence/fallback | Refresh/deletion, stable references, continuation and CJK ranking |
| Frozen requests, alphabetical wiki context and duplicate chunk planners | Replace with one range manifest and execution-time context | Complete span coverage, sequential wiki visibility and paid-attempt deduplication |
| Existing proposal/apply, approval and token budgeting | Keep validation/publication; revise dynamic-context budget ceiling | Preserve manual edits, concurrent revisions and actual spend accounting |
| Flat wiki/raw initial query ranking and prompt | Replace with wiki-first navigation and evidence rules | Actual tool order, fallback receipts and answer evaluations |
| Legacy extract slot, clipping and text framing | Retire from this design; no new consumer | Repository-wide caller search before removing dead code |
| Official attachment upload/store/admission | Reuse unchanged | Logged references, public resolver, integrity, inherited history and installed closure |

Task 1 measures the current whole-file `readFileBytes`/`file.arrayBuffer()` and `encodeIngestChunks` path. Task 2 replaces library upload buffering with sequential `File.slice()` reads, encoding only the current bounded chunk and keeping a bounded number of requests in flight. Measure WebView peak memory, Host memory, chunk-call count, stdio throughput, cancellation and restart behavior at increasing sizes up to the proposed ceiling; do not pre-encode a whole 100 MiB file or create hundreds of unnecessary serial round trips. Reuse the official file-upload transport for session attachments and measure it independently; do not assume its unlimited storage API implies unlimited transport throughput.

Inventory and replace deployment-varying 90-second conversion deadlines in `extract.ts`, `conversion.ts` and any active `sidecar.ts` default with validated overlay configuration at the owning live call paths. Measure the current 50 MiB converted-output cap and 8 MiB DOCX XML-entry cap with compressible text and archive-expansion fixtures. Each supported resource ceiling must be explicit, cancellable and produce a truthful refusal/partial state. Input bytes, expanded XML and converted text are separate dimensions; accepting a 100 MiB file must never silently clip an internal result. Publish measured thresholds before adopting the higher default, including tests at the boundary and one byte beyond it.

Migration keeps originals, library IDs, wiki pages, session history and completed job identities. Existing converted prefixes cannot be retroactively labelled complete. Reconvert retained originals where possible; otherwise mark legacy completeness unknown and request re-upload. Introduce no automatic paid recompilation. Future-schema refusal and backup-or-stop behavior remain mandatory.

<a id="acceptance-matrix"></a>
## Acceptance matrix

Use independently authored expected facts, including a fact after 32,000 characters and a final-page exception. Freeze the corpus before implementation. Positive and negative controls must run through actual public Host/tool/Client consumers, not only the producer helpers.

| ID | Required result | Negative control |
| --- | --- | --- |
| A1 | Library uploads and official attachments retain original bytes through restart | Interrupted library upload never reports complete; conversion oversize refusal does not erase an officially retained attachment |
| A2 | Normalized first/middle/final spans are all indexed and readable | Delete the final manifest span; complete status must fail |
| A3 | One frozen range manifest owns coverage; later chunks read newly committed wiki pages | Change wiki context without changing work identity; completed work is not replayed; gaps/overlaps fail coverage |
| A4 | All wiki chunks settle before wiki-ready | Exhaust budget, cancel or return output-limit finish; remaining work stays visible |
| A5 | Library source tools require a real earlier wiki-attempt receipt in the same turn | Forged, other-library or previous-turn attempt receipts are refused; declared user intent is not treated as mechanically verified |
| A6 | Related wiki pages support cross-document synthesis with source citations | A conflicting later policy is retained as conflict, not silently overwritten |
| A7 | Source fallback recovers a late fact absent from a valid wiki summary | Empty keyword search cannot produce an unsupported whole-library absence claim |
| A8 | Source reads preserve quote locations, exceptions and table context | Stale/forged cursor and cross-library passage ID are refused |
| A9 | Session-only document beyond 32,000 characters answers final-page questions after restart | A prefix-only conversion cache cannot be labelled full-document availability |
| A10 | Official pre-session attachment admission and logged file references authorize overlay conversion | Guessed digest, copied filename/path and cross-session cache hits reveal no converted data |
| A11 | Official retention/fork semantics are preserved; overlay cache eviction never deletes originals | Deleting one session/cache cannot erase another session’s shared attachment or authorize reads via a deleted session |
| A12 | Partial PDF/DOCX conversion has explicit diagnostics | Missing OCR or omitted content never becomes full conversion |
| A13 | Wiki merge preserves manual edits and is idempotent across crashes | Inject page/index publication failure and concurrent edit; no false commit or lost edit |
| A14 | Bounded result ranking returns relevant, diverse evidence with continuation | Distractor passages and duplicate pages cannot crowd out the expected evidence corpus |
| A15 | User flow needs no retrieval-engine configuration | Default fresh profile completes both workflows without tuning chunk/top-k settings |
| A16 | Numbers, dates, obligations, exceptions and quotations have same-turn source-read evidence or an explicit unverified-summary label | A polished wiki summary with a fabricated or previous-turn source receipt cannot count as verified evidence |
| A17 | Legacy libraries stay usable with truthful completeness | Missing originals and future schema cannot be silently treated as complete/current |
| A18 | Packaged macOS and native Windows execute the accepted paths | Workspace-only dependencies, missing FTS/converter support or stale embedded plugins fail readiness |
| A19 | Promoted upload/conversion ceilings have measured memory, throughput and boundary evidence | Whole-file base64 buffering, hidden 90-second deadlines, XML/output overflow and cancelled uploads cannot yield complete status |
| A20 | The pre-rewrite checkpoint is restorable and prior finding dispositions are evidenced | Missing untracked files or an unrerun Required control prevents baseline acceptance |

<a id="verification-and-release"></a>
## Verification and release

The following are required implementation-time checks, not checks claimed to have run for this plan. Run focused owning tests first, then the affected coverage gate, both compiler faces, keyless recorded-session snapshots and assembled browser tests. Add scenario coverage for wiki-first order, explicit source fallback, complete long attachments, official attachment conversion/cache authorization and failed processing. Record model-visible requests/results and inspect the actual source/table/page evidence independently.

Required repository checks include `pnpm run test:coverage`, `pnpm exec tsc -b tsconfig.host.json`, `pnpm exec tsc -b tsconfig.client.json`, `pnpm run test:snapshot`, the affected `DSH_SNAPSHOT=replay` Web cases, i18n/package/catalog/intake/persistence/unknown-cast checks, paired-document validation and `git diff --check`. Check exact trailing LF bytes on new and changed text files. Report unrelated working-tree failures by path; do not describe a partially passing aggregate as a clean release.

Release acceptance uses a freshly built DMG mounted read-only and a native Windows runner with an extracted/installed EXE. Exercise uploads, wiki compilation, source fallback, full session documents, cancellation, cold restart and legacy libraries through packaged public operations without importing checkout product modules. Verify the actual embedded revision, package closure, converter/SQLite capabilities and artifact hash. A macOS pass does not establish Windows acceptance. Keep previous installers until both new artifacts have independently passed.

Acceptance requires all Required findings closed and A1–A20 evidenced. A source-only import can be useful without being wiki-ready; a platform or format that fails acceptance must be disclosed as unsupported or pending rather than included in an unconditional completion claim.

<a id="dev-note"></a>
## Dev Note

Task 1 must distinguish verified current behavior from review claims about an earlier tree. The overlay currently registers no final-answer stream/agent postprocessor; no knowledge-owned final-answer truncation defect has been established. Keep model/runtime output settings as their existing owners and investigate any observed clipped answer separately before adding remediation scope. The measured 100 MiB decision and prior finding dispositions remain review prerequisites.
