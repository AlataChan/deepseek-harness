# 问知识接缝

[English](ask-knowledge.md) | 中文

由 [`@deepseek-ai/dsh-host-ask-knowledge`](../../packages/host/ask-knowledge/README.zh.md) 拥有的文档库接缝。它拥有库目录、入库句柄、检索,以及把某个库挂到会话上的 Session 绑定。检索基于词项,并合并查询、标题与正文。

来源：[`packages/host/ask-knowledge/src/index.ts`](../../packages/host/ask-knowledge/src/index.ts)

## 持久事件

每个绑定都是 log-only：消费方通过该包的 Session 投影重建当前绑定，而不是回放 payload。

- `ask-knowledge/bound`
- `ask-knowledge/unbound`

`ask-knowledge/*` 域属于本接缝。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxaskknowledge--askknowledge-abstract-seam"></a>

### `ctx.askKnowledge` — `AskKnowledge` (abstract seam)

Abstract library catalog, ingest, attach, and retrieve. Subclass, implement the methods, and load the subclass as a plugin — it registers as `ctx.askKnowledge`. The class itself is not a mounted plugin.

```ts cordis-catalog
/**
 * List catalog rows. Does not run recover.
 * @param signal - caller lifetime; abort stops the listing.
 * @returns catalog rows, `missing` when the vault directory vanished.
 */
abstract listLibraries(signal?: AbortSignal): Promise<AskKnowledgeLibrary[]>

/**
 * Create an empty vault and catalog row. Does not attach a session.
 * @param request - display name and optional workspace for a shortcut.
 * @param signal - caller lifetime; abort stops the create.
 * @returns the new catalog row.
 */
abstract createLibrary( request: { displayName: string; workspaceId?: WorkspaceId }, signal?: AbortSignal, ): Promise<AskKnowledgeLibrary>

/**
 * Rename a catalog row. Does not rename the vault directory id.
 * @param request - library id and new display name.
 * @param signal - caller lifetime; abort stops the rename.
 * @returns the updated row.
 */
abstract renameLibrary( request: { libraryId: AskKnowledgeLibraryId; displayName: string }, signal?: AbortSignal, ): Promise<AskKnowledgeLibrary>

/**
 * Mark the row `deleting`, unbind live and cold sessions, delete the vault,
 * then drop the catalog row. Holds catalog for the whole transaction.
 * @param request - library id.
 * @param signal - caller lifetime; abort stops the remove.
 */
abstract removeLibrary( request: { libraryId: AskKnowledgeLibraryId }, signal?: AbortSignal, ): Promise<void>

/**
 * Bind an existing Session to a library. Recovers pending audits first.
 * @param request - library and session identities.
 * @param signal - caller lifetime; abort stops the attach.
 * @returns a lease whose `rollback` undoes this attach in-process.
 */
abstract attach( request: { libraryId: AskKnowledgeLibraryId; sessionId: SessionId }, signal?: AbortSignal, ): Promise<AskKnowledgeAttachLease>

/**
 * Clear the bind on an existing Session.
 * @param request - session identity.
 * @param signal - caller lifetime; abort stops the detach.
 */
abstract detach(request: { sessionId: SessionId }, signal?: AbortSignal): Promise<void>

/**
 * Open an ingest upload. Does not take the library lock.
 * @param request - library and original filename.
 * @param signal - caller lifetime; abort stops the begin.
 * @returns a handle used by {@link appendIngestChunk} and {@link finishIngest}.
 */
abstract beginIngest( request: { libraryId: AskKnowledgeLibraryId; filename: string }, signal?: AbortSignal, ): Promise<AskKnowledgeIngestHandle>

/**
 * Append one base64 chunk. Decoded size must be ≤ 160KiB.
 * @param request - handle and canonical base64 bytes.
 * @param signal - caller lifetime; abort stops the append.
 */
abstract appendIngestChunk( request: { handle: AskKnowledgeIngestHandle; bytes: string }, signal?: AbortSignal, ): Promise<void>

/**
 * Assemble chunks, take the library lock, and run ingest → propose → apply.
 * @param request - handle and optional raw reuse path.
 * @param signal - caller lifetime; abort stops the finish.
 * @returns applied, deferred, or failed ingest status.
 */
abstract finishIngest( request: { handle: AskKnowledgeIngestHandle; reuseRawPath?: string }, signal?: AbortSignal, ): Promise<AskKnowledgeIngestResult>

/**
 * Open a session-only extract upload. Does not require a library.
 * @param request - original filename.
 * @param signal - caller lifetime; abort stops the begin.
 * @returns a handle used by {@link appendExtractChunk} and {@link finishExtract}.
 */
abstract beginExtract( request: { filename: string }, signal?: AbortSignal, ): Promise<AskKnowledgeIngestHandle>

/**
 * Append one base64 chunk to a session-only extract upload.
 * @param request - handle and canonical base64 bytes.
 * @param signal - caller lifetime; abort stops the append.
 */
abstract appendExtractChunk( request: { handle: AskKnowledgeIngestHandle; bytes: string }, signal?: AbortSignal, ): Promise<void>

/**
 * Assemble chunks, convert to text, and delete the temp file. Does not write catalog or vault.
 * @param request - handle.
 * @param signal - caller lifetime; abort stops the finish.
 * @returns extracted text, truncated when longer than {@link ASK_KNOWLEDGE_EXTRACT_MAX_CHARS}.
 */
abstract finishExtract( request: { handle: AskKnowledgeIngestHandle }, signal?: AbortSignal, ): Promise<AskKnowledgeExtractResult>

/**
 * Recover pending audits for one library and return its status.
 * @param request - library id.
 * @param signal - caller lifetime; abort stops the status read.
 * @returns catalog row plus pending audit count.
 */
abstract libraryStatus( request: { libraryId: AskKnowledgeLibraryId }, signal?: AbortSignal, ): Promise<AskKnowledgeStatus>

/**
 * Retrieve pages for already-validated terms and load bodies.
 * @param request - library and terms.
 * @param signal - caller lifetime; abort stops the retrieve.
 * @returns a bounded bundle. Empty pre-trim concept+entity+raw is `no-hit`.
 */
abstract retrieveBundle( request: { libraryId: AskKnowledgeLibraryId; terms: string[] }, signal?: AbortSignal, ): Promise<AskKnowledgeBundle>

/**
 * Look up one term and attach sidecar body when a canonical path exists.
 * @param request - library and term.
 * @param signal - caller lifetime; abort stops the lookup.
 * @returns lookup fields plus optional text.
 */
abstract lookup( request: { libraryId: AskKnowledgeLibraryId; term: string }, signal?: AbortSignal, ): Promise<AskKnowledgeLookup>

/**
 * Place or refresh the workspace-folder symlink. Failure does not roll back create.
 * @param request - library and workspace.
 * @param signal - caller lifetime; abort stops the write.
 * @returns whether the shortcut was written.
 */
abstract placeShortcut( request: { libraryId: AskKnowledgeLibraryId; workspaceId: WorkspaceId }, signal?: AbortSignal, ): Promise<{ ok: boolean; path?: string; reason?: string }>

/**
 * Reveal the vault in the host file manager.
 * @param request - library id.
 * @param signal - caller lifetime; abort stops the reveal.
 */
abstract revealLibrary( request: { libraryId: AskKnowledgeLibraryId }, signal?: AbortSignal, ): Promise<void>
```

Types: [SessionId](core.zh.md) · [WorkspaceId](workspace.zh.md)

Source: [`packages/host/ask-knowledge/src/index.ts`](../../packages/host/ask-knowledge/src/index.ts)
<!-- END GENERATED cordis-surface -->
