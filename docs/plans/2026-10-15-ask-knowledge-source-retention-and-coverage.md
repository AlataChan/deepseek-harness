# Ask Knowledge Source Retention and Coverage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve uploaded documents, process their complete extractable content, and retrieve relevant passages from any part of a document without presenting partial processing as complete.

**Architecture:** Extend the fork-owned Ask Knowledge overlay with a passage index over existing raw pages first, then immutable retained sources, durable processing jobs, structured conversion and complete chunk manifests. Keep wiki generation as an enrichment layer above searchable source passages. Use format-specific conversion adapters and retain bounded model requests with explicit continuation.

**Tech Stack:** Existing Cordis Host and React Client, the bundled Python sidecar, Python standard-library SQLite, existing MarkItDown/openpyxl, and a pinned AnyDoc adapter subject to format and installed-platform acceptance.

**Status:** Proposed implementation; no product changes are authorized by this document alone. The user approved the direction and requested this English plan. Proposed configuration values and verification steps below are implementation requirements, not claims of completed verification.

**Scope:** Desktop Ask Knowledge library ingestion, retrieval and enrichment. Session-only full-document reading is deferred; its current bounded preview and retention behavior remain unchanged. Default assistant selection, workspace behavior, Ask Data, and assistant/team memory remain separate.

## Summary

Users must be able to distinguish an uploaded source, searchable text, completed knowledge extraction, and material that still needs attention. A successful upload must preserve the exact original bytes. Every available source passage must enter the retrieval index, including passages near the end of long documents and passages whose wiki extraction failed. Model context limits must produce smaller requests and continuation, rather than silent loss of the document suffix.

This plan prioritizes correctness before additional format coverage: full-text passage indexing over existing raw pages first, retention and recovery second, complete resumable knowledge extraction third, and converter promotion after measured evaluation. OCR remains a separate capability.

## Table of Contents

- [Evidence and decisions](#evidence-and-decisions)
- [Required behavior](#required-behavior)
- [Data and processing design](#data-and-processing-design)
- [Retrieval and model limits](#retrieval-and-model-limits)
- [Compatibility and user experience](#compatibility-and-user-experience)
- [Implementation sequence](#implementation-sequence)
- [Acceptance and release](#acceptance-and-release)
- [Dev Note](#dev-note)

## Evidence and decisions

The controlled evaluation summary below records observations from 14 synthetic documents across 10 extensions and 32 assertions. The assertions describe successes and failures, not a conversion accuracy percentage. It does not establish representative accuracy, downstream answer quality, throughput, or installed Windows compatibility. The implementation must preserve its negative cases as regression fixtures rather than count successful conversions alone.

The synthetic evaluation found better headings, tables, lists and footnotes for one DOCX with AnyDoc 0.2.4, but both paths omitted its header/footer. AnyDoc retained the PPTX text/table/notes and cleaned RTF; the shipping Python environment lacked PPTX dependencies. Existing CSV/XLSX extraction was substantively equivalent, including an unavailable uncached formula result. Existing HTML/JSON/Markdown routes worked where AnyDoc rejected them. AnyDoc flagged a scanned second PDF page that the existing converter silently omitted, but also misclassified an extractable Chinese CID-font PDF as OCR-required. Neither path established local OCR capability. These observations must be reproduced in Task 1; the scratch evaluation is not a clean-checkout dependency or release evidence. Task 1 commits self-contained generators, fixtures and expected facts with its test change.

Current source owners are [Word extraction](../../packages/experimental/desktop-ask-knowledge/src/extract-docx.ts), [ingestion](../../packages/experimental/desktop-ask-knowledge/src/ingest.ts), [conversion](../../packages/experimental/desktop-ask-knowledge/python/sidecar.py), [proposal generation](../../packages/experimental/desktop-ask-knowledge/python/kb/src/octopus_kb_compound/propose.py), [retrieval](../../packages/experimental/desktop-ask-knowledge/python/kb/src/octopus_kb_compound/retrieve.py), and [result bounds](../../packages/experimental/desktop-ask-knowledge/src/result-bounds.ts). The implementation starts by reproducing the documented failures through those callers.

| Observed problem | Required decision |
| --- | --- |
| Uploads are temporary; raw pages contain converted Markdown | Retain original bytes and distinguish them from conversion output |
| Word extraction flattens structure and omits footnotes | Evaluate a structured DOCX adapter; preserve omissions as explicit limitations |
| Proposal generation reads only the first 12,000 characters | Replace prefix-only processing with a complete, checkpointed chunk plan |
| Retrieval clips page prefixes and does not rank source passages | Index the complete available source text and return ranked passages with continuation |
| A mixed PDF can return nonempty but incomplete text | Track conversion completeness separately from conversion success |
| AnyDoc misclassified one extractable Chinese PDF as OCR-required | Keep PDF routing independent; do not treat any one converter as the completeness authority |
| PPTX dependencies are absent from the current release-build Python environment | Compare AnyDoc with the cost of adding MarkItDown PPTX support before selecting the shipped adapter |

Three approaches were considered: raising existing character limits, replacing all conversion with AnyDoc, and adding durable source processing with format-specific adapters. Raising limits postpones failures and increases request size. A universal converter replacement leaves retention, long-document extraction and retrieval unchanged, and regresses supported HTML/text routes. This plan selects durable processing with format-specific adapters.

## Required behavior

1. An accepted upload has an immutable, hash-verified original revision before conversion starts. Filename, MIME information, byte length, import time and source revision remain available.
2. Every extracted content block has a stable identity and location within a specific conversion version. Source page numbers are recorded only when the converter actually supplies them.
3. Source retention, conversion completeness, passage indexing and knowledge extraction have independent durable states. An empty candidate list is not an extraction failure when a valid response explicitly reports no knowledge candidates.
4. Every eligible normalized source character belongs to a primary chunk or an explicitly recorded exclusion. Overlap is context and never counts twice toward coverage.
5. Every primary chunk is indexed for retrieval. Wiki generation may fail without making its source text inaccessible.
6. Knowledge extraction processes every planned chunk or reports the exact remaining work. Exhausted budgets, cancellation and errors never produce a completed document status.
7. Search and reading enforce bounded responses with stable continuation references. A bounded response never implies that only the returned prefix exists.
8. Existing libraries remain usable during migration. Missing original binaries are disclosed and never reconstructed falsely from Markdown.
9. Library and session authorization applies to source opening, passage search, continuation, retry and deletion. Original paths are not exposed as arbitrary filesystem capabilities.
10. Document text is untrusted data. Extraction outputs pass existing proposal validation and cannot change system instructions, execute tools, escape the vault, or turn source text into executable HTML.

## Data and processing design

### Ownership and storage

Keep product implementation in `packages/experimental/desktop-ask-knowledge/`. Add an overlay-owned documents service definition, provider and Client remote declarations, rather than extending closed official service unions with assertions. Preserve existing `ctx.askKnowledge` methods and existing session binding events. New document operations use the new service; existing consumers receive conservative compatibility results. Use ordinary persisted tool results for new model-visible search/read outcomes. Add no SessionEventMap members, overlay-owned session events or regenerated core event inventory; existing binding events remain unchanged.

Do not change `packages/core/`, `packages/client/`, `packages/subagent/`, `apps/desktop/`, official desktop-app composition, or companion product logic. Fork-owned packaging scripts, plugin pins, generated catalogs and documentation may change when required. Register affected fork changes in the upstream intake registry. Any necessary public API change outside this scope requires a separately reviewed scope adjustment before implementation.

Per-library layout, to be introduced through a versioned migration:

```text
<vault>/
  raw/                              Existing readable raw pages
  wiki/                             Existing knowledge pages
  .octopus-kb/
    documents.sqlite                Source records, jobs, coverage and passage index
    sources/<revision-id>/original  Immutable uploaded bytes
    conversions/<conversion-id>/    Normalized blocks and rendered Markdown
    staging/<job-id>/               Uncommitted work, never searched
```

The existing library catalog remains the owner of library membership. The new SQLite database owns document processing records; it does not replace the catalog or the existing wiki audit. Store schema changes with a monotonic `SCHEMA_VERSION`. Keep source binary deduplication within a library, and avoid exposing cross-library hash existence.

Use branded document, revision, conversion, chunk and job IDs across TypeScript service calls. Validate durable JSON, sidecar messages and model outputs at their respective parsers. Bind all references to their library and revision. Resolve source paths internally, reject symlinks/path traversal, and verify that opened files remain under the expected library directory.

### Frozen SQLite runtime acceptance

“Standard-library SQLite” identifies the Python API; it does not guarantee that the frozen interpreter includes `_sqlite3`, its native dependencies, FTS5 or the trigram tokenizer. Task 2 defines one sidecar preflight shared by service readiness, both build scripts and installed checks. On an isolated database it creates an FTS5 table with `tokenize='trigram'`, inserts a known Chinese/English fixture, executes a parameterized `MATCH` query and verifies the expected row. It reports Python/SQLite versions and probe outcomes. The same preflight exercises the separate one-/two-character query path. Import success, compile options and a `SELECT fts5(...)` call alone do not satisfy this test. See the [SQLite FTS5 documentation](https://www.sqlite.org/fts5.html).

Tasks 2 and 10 must verify `sqlite3`/`_sqlite3` discovery, the resolved native library dependencies and the target architecture in both frozen builds. Use PyInstaller hooks or explicit hidden imports where discovery requires them; adding a hidden import alone does not establish FTS5 support. Run the frozen executable after relocation with developer Python and Homebrew paths unavailable. A missing module, missing trigram support or unresolved DLL/shared library fails package readiness. At runtime it makes the new passage-index capability visibly unavailable; it must not terminate ordinary chat, destroy retained sources, or silently substitute empty search results. Windows acceptance belongs to the native Windows workflow, not an inference from the macOS build. See [PyInstaller hook behavior](https://pyinstaller.org/en/stable/hooks.html).

### Record model

| Record | Essential fields and meaning |
| --- | --- |
| Document | Stable document ID, library ID, display filename, source identity, availability state |
| Source revision | SHA-256, byte length, immutable object location, import identity; no implicit replacement by filename |
| Conversion | Source revision, converter ID/version/options, normalized schema version, output hash, warnings, completeness and available locators |
| Block | Block ID, kind, ordered text, structural context, supplied source locator, exclusions or unsupported content |
| Chunk | Conversion ID, ordered primary spans, context spans, section path, content hash and token estimate |
| Job | Stage, startup attempt, cancellation, error, budget usage and resumable checkpoint |
| Extraction result | Chunk/prompt/model versions, candidate operations, validated no-candidate result, proposal/apply identity and outcome |
| Passage index generation | Conversion/chunker versions, passage count, indexed spans and activation state |

Define locations as block IDs plus Unicode code-point offsets in normalized block text. Byte offsets and UTF-16 indices must not be substituted. DOCX locators may identify a paragraph/table cell, PPTX a slide, XLSX a sheet/cell range, and PDF a page when reliably available. A normalized locator is not a promise of original page coordinates or a viewer highlight. Keep extracted text hashes with locators so a changed conversion cannot silently reuse old citations.

### Retain, checkpoint and recover

Stream accepted upload chunks into a private staging file while computing its hash. At finalization, flush and close the file, move it atomically into an immutable source location on the same filesystem, then transactionally register the source revision and queued job. Verify the durable source before acknowledging acceptance. An interruption between file publication and database registration leaves a recoverable orphan; it must not invent an accepted document or delete another job's object.

Before publication, await completion of all writes, flush the staging file to disk, and close every owned handle on success, failure and cancellation. Publish on the same filesystem without first deleting a valid destination. Immutable revision objects are never replaced: a collision requires verified identity or a visible conflict. Use bounded, cancellation-aware retries only for classified transient Windows `EACCES`/`EBUSY`/`EPERM` interference; an exhausted retry leaves the prior object intact and the job unaccepted. An antivirus lock or another process's handle cannot be resolved by killing that process or weakening permissions.

The existing [atomic-write helper](../../packages/util/atomic-write/src/index.ts) already retries transient Windows replacement failures, but accepts complete string content and explicitly excludes fsync durability. Reuse it only where those guarantees fit. The overlay's streamed-source publication must provide its own explicit file-flush/close sequence and supported directory-durability handling. Tests distinguish atomic visibility, process-crash recovery and sudden-power-loss durability; a passing restart test proves only the first two. Record any unsupported filesystem durability guarantees rather than silently claiming full power-loss safety.

Use one supported desktop writer per library. Desktop already uses the single-instance Tauri plugin; this release does not introduce distributed writer leases, heartbeats or lease clocks. Persist a monotonic startup attempt and attach it to jobs. Increment it under a short per-library interprocess commit lock before admitting recovered work. Every mutating commit, including wiki application and file publication, holds that same lock while checking the current attempt; stale sidecars cannot publish after a newer startup. Network inference runs outside the lock and SQLite write transaction. The in-process mutex alone is insufficient for an orphaned sidecar.

The startup attempt does not stop external applications from writing files. Unsupported concurrent CLI/manual writers must be refused by the shared ownership check, or the library opened read-only; do not claim coordination with writers that bypass it. Test an old sidecar delayed across a companion restart, and a concurrent ownership claim. Recover staging objects only after their attempt is inactive and owned processes have settled; no time-based lease renewal is required.

After restart, recover queued or interrupted jobs from durable checkpoints. Retry conversion/indexing deterministically. For model calls whose response was not durably recorded, mark the attempt uncertain, disclose possible duplicate billing, and require an explicit retry; do not silently issue the paid request again. Persist successful model responses before validation/application. Reuse existing proposal audit recovery to determine whether a wiki write committed before repeating it.

Cancellation stops future chunks and propagates to the active converter/model subprocess. Preserve completed results and the original source. If abort does not confirm provider cancellation, retain an uncertain attempt rather than claim no cost occurred.

Each converter and sidecar worker has an owned managed-process handle registered through `ctx.effect()` or `ctx.on()` disposal. Cancellation, HMR, provider unload and application shutdown request termination and await the provider's owned-range observation within a configured deadline; sending a signal or observing only the direct child's exit is insufficient. Use the [existing subprocess provider](../../packages/subprocess/subprocess-local/README.md) for both signalling and waiting. On supported Windows builds, retain its kill-on-close Job Object ownership from before target code starts. On POSIX, request graceful termination, wait for the configured grace period, then escalate through the selected process owner. Use `taskkill` only through the provider's documented fallback when native ownership is unavailable; never kill by an unverified or recycled PID. On macOS the provider falls back to process groups, which can miss escaped descendants: shipped workers must not daemonize or escape their process group. Tests verify those supported workers and report any uncertainty; this plan does not promise universal descendant confinement. Cleanup timeout/failure remains visible, and a stale worker cannot publish after its startup attempt is superseded. Native-process ownership controls lifetime, not an OS-enforced memory limit: each promised CPU/memory restriction needs a supported mechanism and an executed limit-exceeding test. Report unavailable resource confinement explicitly.

### One-shot workers and result transport

Keep one child process per bounded command; do not introduce a persistent sidecar daemon. Batch all retrieval terms into one search command instead of spawning a process for each term. Introduce a versioned file-result protocol for new commands: the Host creates a private per-job directory, workers write bounded result files there, and stdout carries only a small completion/error envelope. Validate result paths, file type, byte count and hashes before consumption; never parse a document body from the managed subprocess provider's bounded stdout tail. Stderr is bounded diagnostic output. Adapt existing callers deliberately; preserve legacy remote response types and do not silently truncate the old JSON protocol when moving execution providers.

The chosen AnyDoc candidate is the evaluated Node package `@firecrawl/anydoc@0.2.4` (MIT). Its native addon runs only in the private entry `packages/experimental/desktop-ask-knowledge/src/converter-worker.ts`, emitted as `lib/converter-worker.js` by an explicit Host build entry. Launch it with the installed Node runtime through the managed subprocess service. It is a conversion worker with validated file jobs, no Cordis application, listener or public package bin. Register its classification and tests in `scripts/verify-application-entrypoints.ts`; it must not become an alternative application launcher. Do not import the addon into the companion Host or Client bundle. Kill the worker on timeout/cancellation; `toMarkdown()` itself is not abortable.

Task 5 declares the exact Node/native dependencies and build entry. Task 10 verifies `collect-runtime-deps.mjs`, profile-plugin seeding and relocation retain the needed native package: `@firecrawl/anydoc-darwin-arm64@0.2.4` or `@firecrawl/anydoc-win32-x64-msvc@0.2.4` for the corresponding release. Test the actual addon load inside each installed worker, including missing/wrong-architecture modules. The reported native binaries are approximately 7 MB and 8.3 MB respectively; these are planning inputs, not installer measurements. Before promotion, measure compressed installer and installed-directory deltas against MarkItDown plus its PPTX dependencies, and record an explicit accepted size ceiling for each platform. An unapproved size increase blocks promotion, not existing-library search. AnyDoc also offers [Python bindings](https://github.com/firecrawl/anydoc#python); this plan does not assume their compatibility or adopt a second binding without evaluation.

Use the provider's cleaned environment with an explicit allowlist. Local converters receive no model credentials or hosted OCR configuration; inference commands receive only the selected vault profile's required credentials. Bound file sizes and decompressed output with enforceable checks, and document which CPU/memory limits lack an OS-backed mechanism. No hosted fallback is enabled.

### Conversion routing and completeness

| Format | Initial routing policy |
| --- | --- |
| MD/TXT | Direct text reader with explicit decoding outcome |
| HTML/JSON | Retain current path; render source content safely |
| CSV/XLSX | Retain dedicated parsers; preserve sheet/cell references and disclose uncached formulas |
| DOCX | Pilot pinned AnyDoc against the existing extractor and richer fixtures |
| PPTX | Compare AnyDoc and MarkItDown optional dependencies; enable only the accepted packaged route |
| RTF | Candidate AnyDoc route after fixture and packaging acceptance |
| EPUB | Evaluate existing converter first; do not add a dependency solely to enable EPUB |
| PDF | Preserve existing text path while adding page/content inspection and explicit partial/uncertain outcomes |
| Legacy DOC/PPT/XLS and ODF | Remain disabled until valid format-specific fixtures and installed-platform tests pass |

The adapter result reports `complete`, `partial`, `needs_ocr`, `unsupported`, `failed`, or `unknown`, with warnings and known missing sections/pages. Here `complete` means the declared extraction checks passed for the supported content classes; it does not assert that every visual element was understood. Images, charts, page furniture, equations and unsupported embedded content require explicit capability/omission reporting. Preserve the converter's own diagnostics separately from product classification.

For PDF, compare page inventory and available text/image evidence. A textless or suspicious page prevents an unqualified complete status. Image presence alone is not proof of missing text; native image captions and scanned body pages need different treatment. Inconsistent extractor results remain `unknown` or `partial` pending inspection. Preserve both the mixed-page missing-content case and the extractable Chinese false-OCR case in acceptance tests. Never enable hosted OCR or upload a source to Firecrawl automatically. Run native converters in an owned, disposable subprocess with bounded time, memory, decompression and output; cancellation terminates that process rather than assuming a native conversion promise accepts an AbortSignal. Use the existing subprocess management mechanisms, not a new standalone Harness application launcher. Validate configurable limits for normalized output, page/block count, staging storage and total library storage; a limit produces an explicit partial/failed outcome with remaining work, never a complete status.

### Complete chunk planning and wiki enrichment

Create chunks from normalized blocks, preferring section, paragraph, list and table-row boundaries. Repeat table headers as context. Split an oversized paragraph or cell into mapped spans rather than discard it. Preserve cross-chunk section context and adjoining references; overlap is distinct from primary ownership. Build and verify the entire ordered manifest before model extraction starts.

The coverage verifier compares the union of primary spans with all eligible normalized spans. It rejects gaps, duplicate primary ownership, invalid offsets and stale conversion hashes. Unsupported image content is not made covered by indexing its filename or alt text. Conversion completeness and chunk coverage are separate measurements.

For each chunk, call the configured knowledge extraction model with source references and a bounded response allowance. Split further when the configured request budget cannot accommodate the chunk, instructions, context and response. Validate structured output before checkpointing a successful extraction result. Never translate a timeout, malformed response or exhausted token allowance into a valid empty candidate list.

Use chunk identity plus source/conversion/prompt/model settings for durable deduplication. Merge overlapping candidate knowledge with source references to all supporting passages. When a later chunk adds a condition or exception, reconcile affected candidates; unresolved conflicts remain visible review work. Do not discard a later qualification merely because an earlier chunk created the same title.

Retain existing proposal validation, conflict checks and audit recovery. Apply bounded batches within existing operation limits. Record each committed batch before marking its chunk complete. A failed batch leaves the source searchable and enrichment incomplete; retry does not duplicate aliases, pages or log entries. Keep extracted statements linked to their source revision for future lifecycle work.

## Retrieval and model limits

### Source-first search

First index complete existing `raw/*.md` pages directly, without waiting for binary retention, new converters, enrichment jobs or the complete normalized-block pipeline. Use raw-file content hashes and code-point spans for citations. Incrementally reindex changed pages and remove missing pages from the active generation. Later normalized blocks reuse this passage interface; they are not a prerequisite for improving existing libraries. Index every available primary passage before wiki enrichment. Use the bundled Python SQLite runtime and verify FTS5 availability in both installed platforms. Start with local lexical retrieval: FTS5 trigram search for suitable queries, plus a parameterized short-term lookup path for one- and two-character Chinese terms. Implement bounded work and disclose search incompleteness if a configured budget prevents full evaluation. Never silently return no matches because the short-term search path was skipped.

Preserve the existing `NFKC` followed by Unicode `casefold` behavior for both documents and queries. Store original display text and a versioned folded search representation with a mapping from folded code-point spans back to original display spans, including composition and casefold expansion. Quotes use original text, never guessed offsets into folded text. Test PDF Kangxi radicals queried as ordinary Chinese, combining characters and expansions such as ß. FTS5's tokenizer alone does not implement this policy.

Treat model-written search terms as literals: quote each FTS5 term with double quotes and escape embedded double quotes by doubling them, then bind the resulting query as a SQL parameter. Parameter binding alone does not neutralize FTS5 operators. One-/two-character terms use the folded short-term lookup; a capped scan reports incomplete search with continuation rather than a false empty result.

Rank passages using text relevance and explicit title/heading matches, with deterministic tie-breaking. Retrieve wiki concepts as a separate candidate set and combine them with the source passages. Do not include every raw page merely because a concept matched. Deduplicate equivalent passages, diversify by document/section, and allow focused results when the user explicitly selects one document. Keep version and freshness filters in the authorization-aware query.

The first release does not promise semantic paraphrase recall. Record lexical misses on the acceptance corpus; add optional embeddings/reranking only if measured misses justify their storage, model, privacy and packaging costs. Vectors do not replace source retention or coverage accounting.

### Bounded results with continuation

The new document service supports document listing/status, source opening, passage search, passage reading, retry/cancel and existing library-deletion cleanup. Search results contain source/revision IDs, chunk/span locators, exact bounded quotations, conversion warnings, index/enrichment state, and an opaque continuation cursor. Reading a passage can request neighboring spans without rerunning full-document ingestion.

A cursor includes query/filter identity and index generation, is authorized on every use, and fails explicitly after incompatible changes. It cannot be forged into another library's read capability. Model-visible source text, quotations, warnings and tool outcomes must remain reconstructable from normal logged tool results; do not add an unlogged prompt side channel.

Retain response and context budgets. Replace page-prefix clipping with ranked excerpts centered on hits and a continuation reference for the remaining passage. Record returned and omitted spans. If the selected evidence does not cover the question, the model can request more passages; it must distinguish unavailable, not yet processed, not retrieved, and genuinely absent evidence.

Keep `retrieveBundle` and `lookup` signatures and response fields stable for session-controller remotes. Replace the existing `ask_knowledge_retrieve` model tool registration with the passage implementation; update its prompt and skill consumers together instead of registering a competing search tool. Its overlay-owned schema can evolve with every consumer updated. Add a bounded passage-read tool only for continuation. Do not cast new fields into closed official types.

### Proposed configuration

Model route ownership stays with the selected per-vault profile in `.octopus-kb/config.toml`. Extend its validated versioned configuration with the tokenizer policy, context limit and maximum response settings; migrate existing generated DeepSeek profiles without silently changing their route. Resolve the effective profile once per job and snapshot its settings. Missing or incompatible settings pause enrichment visibly. Overlay Config owns upload/storage limits, concurrency, deadlines and automatic-spending thresholds, not a second hidden model route. Provider credentials continue through the existing scoped Host resolution.

| Setting | Initial policy | Exhaustion behavior |
| --- | --- | --- |
| Upload size | Current 20 MiB default | Reject before acceptance |
| Primary chunk target | Up to 1,600 estimated tokens after complete request overhead is deducted | Split mapped spans; never omit a suffix |
| Adjoining context | Up to 200 estimated tokens | Reduce context before primary coverage |
| Model workers | 1 per library, 2 globally | Queue with fairness |
| Automatic retries | 2 for confirmed retryable failures | Uncertain paid attempts require explicit retry |
| Automatic enrichment | Disabled until full-document estimate is displayed and accepted; an owner may configure an automatic-spending threshold | Source indexing remains available without inference approval |
| Per-job allowance | Sized from the entire manifest and approved request/response reservations, not fixed at 250,000/50,000 tokens | Pause before an unapproved request; show remaining work and revised estimate |
| Search payload | At most current compatibility caps and 6,000 conservatively estimated tokens for the complete serialized result | Ranked excerpts plus continuation; never characters/4 |

Use a versioned tokenizer policy for the resolved model route. Prefer a tested matching tokenizer. A byte-based fallback is allowed only for a verified route, with `ceil(UTF8_bytes * safety_factor)` and framing allowance, recorded with its validation limits; it is not a universal tokenizer bound. Unknown policies stop inference. Reserve the maximum output separately and count the actual complete serialized request, including the prompt template, full proposal schema and bounded existing-page context. Do not resend the growing full library on every chunk: select a bounded relevant page summary/reference set, with explicit lookup when reconciliation needs more context.

Before paid work, compute the entire manifest, request count, summed input estimate, summed output reservations, retries allowance and price estimate when validated pricing is available. Display document size, remaining chunks and assumptions; absent pricing show token estimates without inventing a cost. Approval covers that recorded route and allowance only. Re-estimate on route, prompt, schema or document changes. Provider usage replaces estimates for recorded consumption; reserve conservatively before the next call and require approval for additional spend. Source conversion/indexing does not depend on paid enrichment completion.

Acceptance includes 200,000-character Chinese, mixed-language and emoji-heavy documents. Under both exact and verified byte-fallback policies, account for every request and output reserve, demonstrate that the approved allowance covers the entire manifest, and reject a fixed allowance that only covers a prefix. Exercise the old 753-byte template/3,406-byte schema plus growing-library workload; runtime sizes are measured rather than frozen as constants. Completion is conditional on successful approved requests, never promised under an inadequate default budget.

For retrieval, count the entire result serialization, including paths, locators, warnings and continuation. Resolve the consumer's model policy when available; compatibility remotes without a route use a conservative UTF-8-byte transport budget, explicitly labelled as an estimate. Preserve existing response fields. The current 24,000-character ceiling is an additional cap, not evidence of a 6,000-token CJK payload. Reject an over-budget quotation bundle in an independent control.

Session-only attachment handling remains the existing 32,000-code-point inline path; preserve its truncation disclosure. This release adds no 24-hour document cache, document handle or full-reading claim to “仅本会话”. A later scope decision may use a handle inside logged framed text, authorized only by the requesting session's logged user message, but must cover pre-session extraction and direct MD/TXT framing. It needs separate privacy approval and end-to-end tests; neither new official Client settlement fields nor new SessionEventMap members are part of this plan.

## Compatibility and user experience

### Migration and revision policy

Import each existing raw Markdown page as a legacy source revision with `original_unavailable`. Index its full current text and preserve existing wiki pages, hand-written edits, aliases, library IDs and session bindings. Existing wiki pages without reliable source references remain explicitly unattributed; do not infer a link from matching filenames. Never mark the old wiki extraction complete solely because an old ingestion reported applied.

Build the new database/index alongside current files and activate a validated generation atomically. Back up affected metadata before migration, record schema versions, and stop safely on corruption. A failed migration leaves the old library readable and reports migration failure. Unsupported future schema versions fail explicitly; an old binary must not overwrite a newer store. Rollback instructions restore a verified backup or operate read-only, rather than silently downgrading schema.

Identical bytes uploaded again within one library may reuse retained content and results only when converter/chunker/prompt/model settings match. The same filename with different bytes creates a separate import. This release does not introduce document replacement, superseded-revision invalidation, reference-aware purge or automatic removal of derived wiki claims; those require separately specified source attribution semantics. Do not expose misleading replacement/removal controls or claim a removed raw file erases previously generated wiki knowledge.

Keep existing library deletion behavior, extending its confirmed cleanup to retained originals, staging and passage indexes. Stop owned jobs first and prevent late publication. Already logged conversation text remains unchanged; explain this in the existing confirmation. Missing/changed raw pages are excluded or reindexed in source retrieval without claiming retroactive wiki cleanup.
### Visible document status

The document list shows filename, revision, retained-original availability, conversion warnings, searchable passages, and extraction progress. Examples are “Original saved”, “Text searchable; knowledge extraction 18/24 chunks”, and “Partial text: page 7 needs OCR”. Actual desktop copy is Chinese-first through typed English/Chinese dictionaries.

Show separate actions for Open original, View extracted text, View sources, Retry failed stage, Resume paused extraction and Cancel processing. Opening an original uses a validated native-file capability without executing embedded macros or rendering unsanitized HTML. Cross-window state comes from durable Host status, not browser-only upload queues.

A document may be searchable while wiki extraction is paused or unavailable because no model key is configured. Counts represent recorded processing coverage, not a percentage claim of semantic accuracy. A library with partial documents remains usable and visibly partial.

## Implementation sequence

Each task is a reviewable change that must leave CI green. Reproduce desired failing behavior locally, but commit regression tests with their fix; Task 1 commits only passing characterization tests, fixtures and baseline observations. Do not hide required failures with skips. Run focused checks, update owning README/JSDoc and record evidence before a separately authorized scoped commit. Proposed paths below are not placeholder modules to create in advance.

### Task 1: Capture the baseline and acceptance fixtures

**Files:** `tests/fixtures/document-coverage/`, `tests/helpers/document-fixtures.py`, `tests/document-coverage.spec.ts` under the overlay.

Commit self-contained synthetic generators, original fixtures, expected facts and a compact baseline report. Cover beginning/middle/end, late tables, footnotes, exceptions, Chinese radicals, short terms, distractors and mixed/CID PDFs. Separate current-behavior characterization from desired acceptance; preserve known failures in the report until the relevant fix lands with its regression. No scratch `.plans/` link or installed developer dependency is required to reproduce tests.

**Exit:** Green baseline tests and reproducible failures through production callers; no claimed representative accuracy.

### Task 2: Ship full-text retrieval for existing libraries first

**Files:** New `python/documents/search.py`, `python/documents/schema.py`, `python/documents/runtime_check.py`, `src/document-retrieve.ts`, `tests/passage-search.spec.ts`, `tests/sqlite-runtime.spec.ts`; update sidecar wiring, `src/retrieve.ts`, `src/result-bounds.ts`, `src/tools.ts`, retrieval prompt and skill.

Build a versioned, rebuildable passage index directly from full existing raw pages. Implement folded text/offset mapping, literal FTS quoting, short-term search, ranked excerpts, authorized continuation and serialized-result budgeting. Use the conservative byte policy for this first slice; model-specific result counting can follow with Task 6. Batch terms in one command. Keep remote compatibility and replace the existing model search tool. Add frozen SQLite/trigram preflight and package its dependencies for this delivery slice, rather than deferring runtime readiness to retention. Index updates are atomic; corruption/future schemas fail safely with originals unchanged. Bound rebuild work and report incomplete/unavailable search explicitly.

**Exit:** Late facts in existing libraries are reachable without re-upload, model calls, source retention or new converter dependencies. Test radical equivalence, ß/combining offsets, hostile FTS syntax, two-character queries, distractors, missing/changed files, stale/forged/cross-library cursors, interrupted activation and Chinese payload budgets. Quoted display text must match the original raw page.

### Task 3: Add lossless retention and source records

**Files:** New `src/document-types.ts`, `src/documents-service.ts`, `src/source-store.ts`, `python/documents/store.py`, `tests/source-store.spec.ts`, `tests/document-store.spec.ts`; update upload finalization and index ingestion.

Define the overlay service/provider/consumer and source records without changing official service unions. Stream/hash/flush/close immutable originals and register recoverably before acceptance. Extend the existing index schema monotonically. Test byte equality, repeated bytes, same-name different content, crash windows, disk-full, symlinks, corrupt/future schemas and library isolation. On native Windows hold a conflicting handle: bounded retry exhaustion must preserve existing data and refuse acceptance; retry after release succeeds.

**Exit:** Accepted originals survive restart byte-for-byte, or acceptance fails visibly.

### Task 4: Add resumable jobs and owned one-shot execution

**Files:** New `src/document-jobs.ts`, `python/documents/jobs.py`, `tests/document-jobs.spec.ts`; update `src/library-lock.ts`, `src/sidecar.ts`, service lifecycle and existing HMR/sidecar tests.

Implement startup-attempt fencing under the short shared commit lock, deterministic checkpoints, uncertain paid-call handling, bounded scheduling and cancellation. Move owned commands to managed subprocesses with private file-based results and cleaned explicit environments; preserve compatibility adapters. Test a stale orphan across restart, duplicate admission, interrupted publication, invalid result paths, oversized output, missing result files and bounded stdout tails. Exercise cancel/HMR/shutdown with a non-daemon child ignoring graceful termination and verify unrelated processes survive.

**Exit:** No stale publication or silently repeated ambiguous paid work. Native Windows tests verify Job ownership; macOS tests state process-group limits and treat cleanup uncertainty as failure to confirm settlement.

### Task 5: Normalize conversion and select isolated adapters

**Files:** New `src/conversion.ts`, `src/converter-worker.ts`, `src/converters/anydoc.ts`, `python/documents/convert.py`, conversion/PDF tests; update Host build entry, dependency declarations and application-entrypoint classification.

Define blocks, supplied locators and completeness diagnostics. Evaluate each format separately; preserve supported routes and disable untested formats. Run actual AnyDoc only in the named private worker with networking unavailable, validated job files and output bounds. Exercise missing/wrong native modules, worker crash/hang, cancellation, unsupported content and missing notes. Compare the installed/compressed size of AnyDoc and MarkItDown PPTX alternatives before choosing a default. Do not promise an OS memory limit without executed enforcement evidence.

**Exit:** Every enabled format has measured behavior, accepted size and native-platform installed coverage; no hosted fallback.

### Task 6: Plan complete chunks and full-document spending

**Files:** New `python/documents/chunks.py`, `python/documents/token_budget.py`, `tests/chunk-coverage.spec.ts`, `tests/token-budget.spec.ts`, independent span checker; update the owning vault config parser and generated configuration writer.

Implement mapped structural splits, overlap and full manifest verification. Resolve one vault-owned route/tokenizer policy and preflight the complete paid job, including prompt/schema, bounded library context, output and retry reserves. Expose explicit approval before inference. Extend passage indexing to normalized blocks without regressing legacy raw indexing.

**Exit:** Independent controls reject missing/duplicate/stale spans, unknown estimators, exceeded token bounds and inadequate budgets. The 200,000-character CJK workload is fully planned under exact and byte policies; approved reservations cover all planned calls rather than a short prefix.

### Task 7: Enrich all approved chunks through existing proposal validation

**Files:** New `python/documents/enrich.py`, `tests/document-enrichment.spec.ts`; update vendored proposal/apply adapters only as required, recording local vendor changes.

Persist model responses/usage before bounded validated application. Distinguish no-candidate success, malformed response, provider errors, budget pauses and uncertain execution. Select bounded existing-page context, preserve late exceptions and checkpoint audit identities. Every apply checks the startup attempt under the commit lock.

**Exit:** Restart after a committed wiki write does not duplicate it. All eligible chunks succeed before completion; failed/paused enrichment leaves source retrieval available and remaining work visible.

### Task 8: Integrate migration and library cleanup

**Files:** New `python/documents/migrate.py`, migration/lifecycle tests; update existing catalog and library deletion cleanup.

Import legacy raw metadata as original-unavailable, preserving IDs, sessions, hand-authored wiki and unattributed claims. Validate backups, atomic activation, read-only failure and future-schema refusal. Integrate retained originals/index/job cleanup with confirmed library deletion and prevent late commits. No new replace/purge product lifecycle is introduced.

**Exit:** Existing libraries gain full raw retrieval immediately; missing originals are disclosed and library deletion removes newly retained files under its existing authorization.

### Task 9: Mount library progress and spending controls

**Files:** New `src/client/DocumentList.tsx`, `src/client/DocumentStatus.tsx`, mounted UI tests; update overlay registrations, `LibrarySettingsSection.tsx` and typed locales.

Mount original/text/source opening, warnings, durable progress, cancel/retry/resume and full-job estimate/approval. Verify actual Host calls, cross-window state, missing keys, partial PDF, budget changes and cold restart. Preserve existing session-only attachment behavior and truncation copy; add no temporary full-document retention or official Client edits.

**Exit:** Users can distinguish retained/searchable/partially converted/enriched states and approve a stated full-document allowance. Recorded snapshots cover citations, continuation and truthful partial outcomes.

### Task 10: Verify and package each accepted delivery slice

**Files:** New host acceptance tests and `scripts/verify-ask-knowledge-installed-flows.mjs`; update both sidecar builders, desktop bundle verification, runtime collection/plugin pins, Windows workflow and affected documentation/generated records.

Run the acceptance matrix through real ingestion, search/read, jobs and mounted UI. Package DMG and EXE; verify frozen SQLite/FTS and worker native dependency closure after relocation without developer Python/Homebrew/npm. Assert the private worker classification, cleaned environment, literal Unicode search, file-result protocol, cancellation limits and cold restart. Record source revision, artifact hashes, size comparisons, commands, failures/skips and platform uncertainties. Add Required invalid controls to the executed release verifier.

**Exit:** Each advertised slice passes its applicable Required cases in both delivered installers. A missing/failing platform remains a release blocker; search-first delivery need not wait for optional converter promotion.

## Acceptance and release

### Required acceptance matrix

| ID | Required observation | Invalid control that must fail |
| --- | --- | --- |
| AC1 | Original bytes/hash remain identical after restart and retry | Missing/corrupt source object cannot be reported retained |
| AC2 | First, middle, final, table and footnote facts reach search/read | Missing final chunk prevents complete coverage |
| AC3 | Search works before wiki enrichment and after enrichment failure | Missing model key cannot suppress already indexed source text |
| AC4 | Every planned chunk has a durable outcome or visible remaining work | Prefix-only proposal cannot mark extraction complete |
| AC5 | Late exceptions remain attached to earlier general rules | Deduplication cannot erase a conflicting qualification |
| AC6 | Mixed PDF omissions and uncertain extraction are disclosed | Nonempty cover text cannot establish complete conversion |
| AC7 | Extractable Chinese PDF does not automatically trigger cloud OCR | AnyDoc needsOcr cannot authorize external upload |
| AC8 | Retrieval finds late passages despite unrelated matching documents | Unranked raw expansion cannot push the relevant hit out of results |
| AC9 | Bounded search/read can continue to remaining passages | Stale/forged/cross-library cursors are refused |
| AC10 | Cold restart resumes work without duplicate committed effects | An uncertain paid attempt cannot auto-repeat |
| AC11 | Disk/permission/process failures preserve truthful state | Failed publication cannot expose a new active index |
| AC12 | Legacy libraries preserve IDs, sessions and hand-written pages | Missing original binaries cannot be fabricated from Markdown |
| AC13 | Existing library deletion cleans new retained files/index/jobs and blocks late publication | A stale worker cannot recreate a deleted library; removing raw text cannot be advertised as erasing wiki history |
| AC14 | Session-only attachment retention and the 32,000-code-point preview disclosure remain unchanged | A new 24-hour cache or full-reading claim cannot enter this release |
| AC15 | Installed macOS and Windows pass conversion, restart and retrieval flows | Missing native/SQLite capability fails readiness explicitly |
| AC16 | Visible quotations, warnings and continuation are reconstructable from session logs | Hidden injected source text fails the logging check |
| AC17 | Relocated frozen runtimes create and query Chinese/English trigram indexes on macOS and Windows | Missing `_sqlite3`, native dependencies or trigram support fails readiness without disabling ordinary chat |
| AC18 | Native Windows publication tolerates a released transient lock and preserves committed data | Retry exhaustion, open owned handles or delete-before-rename cannot yield a retained/accepted revision |
| AC19 | Cancel/HMR/shutdown settle shipped non-daemon workers within documented platform ownership limits | Ignored signals, observed survivors or deadline expiry cannot be reported as confirmed cleanup; macOS escaped descendants are not promised contained |
| AC20 | Full-document approval and result budgets account for CJK, emoji, schema, framing and output reserves | Inadequate prefix-only allowance, growing unbounded page context or characters/4 cannot authorize completion/inference |
| AC21 | Folded literal retrieval preserves original quotations and short-term recall | Radical/casefold mismatches, incorrect display offsets and FTS operator injection cannot silently pass |

Report source-retention integrity, eligible-span coverage, indexed-span coverage, extraction outcomes, per-question expected-evidence retrieval, unsupported-content diagnostics, usage, latency and storage separately. On deterministic fixtures, AC1 requires byte equality, AC2/AC4 require complete eligible-span accounting, and every labelled acceptance question must retrieve its required evidence. These outcomes do not certify semantic accuracy on arbitrary documents.

Use an owner-authorized, de-identified representative corpus before promoting converter defaults. Include Chinese/English, late qualifications, merged tables, speaker notes, long files and mixed PDFs. Keep private material outside tracked fixtures and report aggregates only. No access to private evidence packs is granted by this plan. Record actual conversion/index/extraction timings, request usage, peak resource measurements and installer deltas; do not extrapolate performance from the small synthetic corpus.

### Verification procedure for implementation

The following commands are planned checks, not commands executed during plan authoring. Add new checks to the top-level verification owner so a missing index, missing original, omitted final span or missing native adapter fails a real executed release check.

```sh
pnpm exec vitest run packages/experimental/desktop-ask-knowledge
pnpm exec tsc -b tsconfig.host.json
pnpm exec tsc -b tsconfig.client.json
pnpm exec tsx scripts/verify-client-ui-i18n.ts
pnpm exec tsx scripts/verify-client-packages.ts
pnpm exec tsx scripts/gen-client-catalog.ts --check
pnpm exec tsx scripts/verify-no-unknown-casts.ts
pnpm exec tsx scripts/verify-upstream-intake.ts
pnpm exec tsx scripts/verify-application-entrypoints.ts
pnpm run test:snapshot -- -t ask-knowledge
pnpm run doc-sync
git diff --check
```

CI must run `pnpm run test:coverage`, the repository coverage acceptance command; focused Vitest runs do not replace it. Record its actual result before release acceptance. Do not run the exhaustive suite for plan-only edits.

Update or add the owned recorded-session scenario before replay; an absent scenario or skipped required case is not a pass. Add the installed-flow script in Task 10 and document its supported macOS/Windows invocation after implementing and exercising it. Run packaging only after source checks pass, then test the produced installers and their installed applications. Follow the repository pre-push skill before any separately authorized push.

### Delivery order

Deliver Tasks 1–2 as the first full-raw retrieval slice, with the applicable Task 10 frozen-runtime/installer checks. Deliver Tasks 3–4 as retention/recovery, Task 5 as individually accepted converters, and Tasks 6–9 as approved complete enrichment and library controls; finish Task 10 across the combined scope. Do not label source indexing as complete wiki extraction or advertise session-only full reading. Source retention alone does not fix retrieval coverage.
## Dev Note

This is an English-only proposal requested by the owner, not current product documentation or evidence of completed implementation. Implementation must update affected maintained README pairs and generated records. Final converter defaults remain conditional on the documented format and installed-platform results; OCR provider selection and optional semantic retrieval are subsequent decisions.
