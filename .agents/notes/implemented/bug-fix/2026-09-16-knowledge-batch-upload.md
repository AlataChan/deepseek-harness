# Agent Note: Knowledge upload queues several files into one library

Status: implemented

English | [中文](2026-09-16-knowledge-batch-upload.zh.md)

## Problem

The knowledge library could only take one document per action, so a user with five documents to file had to repeat upload five times and watch five separate 180s waits. The report read as a missing batch or ordering step.

Three independent limits produced it. The choose-file input carried no `multiple`, so the OS dialog could hand over one file and the picker read `el.files?.[0]`. `finishIngestPipeline` runs inside `withLibraryLock(libraryId, …)`, an in-process mutex keyed by library id, so two ingests into one library cannot overlap and the second waits for the first; that serialization is deliberate, because the pipeline writes the vault and the frozen sidecar's `validate-apply` is not concurrency-safe. And `session/finishAskKnowledgeIngest` carries the only oversized carrier deadline, 180s, because one call runs recover, `ingest-file`, one LLM `propose`, and apply — a per-call budget, so N files cost N sequential budgets.

The ordering the reporter asked for already existed: it is the library lock. What was missing was a queue.

## Decision

The picker accepts several files and ingests them one at a time into the one library, on the client. `multiple` joins the input, `deliver` passes the whole `FileList`, and `ingestBatch` walks it sequentially, awaiting each `finishIngest` before starting the next. The batch stays in one library: the first file creates the draft through the existing cached `ensureDraft`, and every later file joins it.

Each file owns a row that moves through queued, working, added, or failed-with-reason, so a long batch shows progress instead of one global wait. A file that fails does not stop the batch: `ingestOne` returns its reason rather than setting the picker's shared error, the driver records it and continues, and a thrown transport error is caught per file for the same reason. The picker binds and closes only when at least one file landed; a batch where everything failed stays open with each reason visible.

The unsupported-extension screen stays in the driver, before any catalog write, so a file the Host would refuse cannot leave an empty library behind. The only file that names the library is the first successful one, and only while the row is still untitled, so a batch of five names the row once.

Sequential is the whole design, not a first cut. The library lock would serialize concurrent ingests anyway, one LLM `propose` per file is the real cost, and parallel uploads would only add failure modes to a step the user cannot see into.

## Alternatives considered

**A separate document-processing or ordering script.** Rejected: it would duplicate the convert → propose → apply chain, drift from it, and have to re-implement the single-writer lock; it would also lose the credential injection the Host owns for `propose` and bypass the carrier deadline and the picker's per-file failure surface.

**Parallel uploads into one library.** Rejected: `withLibraryLock` serializes them regardless, so the only effect would be more in-flight failures and a rate-limited `propose`.

**Parallel uploads across different libraries.** Rejected: the user files several documents into one library; spreading a batch over libraries is a different feature and needs a target per file.

**A durable queue that survives closing the window.** Rejected for now: it needs new session events, a progress projection, and a job owner, which is a much larger change than the reported defect. The browser queue is documented as dropping what it has not reached.

**Show every failure in the picker's shared error line, as before.** Rejected: one line cannot say which of five files failed. The per-file row carries the reason, and the two existing tests that read the shared line were updated to read the row.

## Consequences

One action now files many documents, and the user can leave: the batch reports itself per file and ends by binding the library once, as long as one file landed. A batch of five still takes about five sequential ingest waits, which the progress rows make visible rather than hiding.

Closing the window drops the files the queue had not reached; they are not recorded anywhere, so the user re-picks them. A failed file leaves the successful ones in place, which is what a partial batch should mean.

`BatchEntry`, `BatchState`, `shouldNameFromStem`, `updateBatchEntry`, and `batchEntryText` stay module-local: the tests drive the picker, and the picker's `/client` surface is unchanged. One arm in `batchEntryText` is unreachable — the driver writes every failed entry with its reason — and carries a `v8 ignore` naming that. Verification is `packages/experimental/desktop-ask-knowledge/tests/library-picker.client.spec.tsx`: several files into one library with a single create and a single rename, the queued/working transition, failure isolation for a returned and a thrown error, an all-failed batch that stays open, and a null file list.
