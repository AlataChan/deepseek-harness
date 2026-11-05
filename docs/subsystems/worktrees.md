# Local worktrees and review

English | [中文](worktrees.zh.md)

The optional local review composition creates and restores retained Git worktrees within existing Session permissions. A requested checkout is prepared before the first model step; failed held creation waits for retry or withdrawal. Restoration does not change execution cwd. One Changes tab displays bounded local diffs. Standing teammates remain shared-workspace agents and receive no checkout or additional rights.

Service reference: [worktrees](../../packages/experimental/worktree/README.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxforgepanel--forgepanelcontroller"></a>

### `ctx.forgePanel` — `ForgePanelController`

Owns local worktree requests and serialized Agent maintenance, without remote publication.

```ts cordis-catalog
/**
 * Read a bounded local diff without external diff helpers.
 * @param session - Session to inspect.
 * @param scope - Local comparison to read.
 * @param signal - Cancellation.
 * @returns bounded local comparison.
 */
@Remote async localDiff(session: Session, scope: ForgeLocalScope, signal: AbortSignal): Promise<ForgeLocalDiff>

/**
 * Read the current text of a checkout-relative file.
 * @param session - Session to inspect.
 * @param scope - Local comparison.
 * @param path - Checkout-relative file.
 * @param signal - Cancellation.
 * @returns current file text.
 */
@Remote async localText(session: Session, scope: ForgeLocalScope, path: string, signal: AbortSignal): Promise<string>

/**
 * Record a request consumed before the first model step.
 * @param session - Session before its first turn.
 * @param from - Local base ref, or null for HEAD.
 * @param signal - Cancellation before recording.
 * @returns after the operation is recorded or completed.
 */
@Remote requestWorktree(session: Session, from: string | null, signal: AbortSignal): void

/**
 * Withdraw a request and release its waiting message.
 * @param session - Session with an open request.
 * @param signal - Cancellation before recording.
 * @returns after the operation is recorded or completed.
 */
@Remote cancelWorktree(session: Session, signal: AbortSignal): void

/**
 * Abort a held attempt while retaining its request for retry.
 * @param session - Session whose held attempt stops.
 * @param signal - Cancellation of the control request.
 * @returns after the operation is recorded or completed.
 */
@Remote stopCreation(session: Session, signal: AbortSignal): void

/**
 * Retry a held creation with a fresh name.
 * @param session - Session waiting after a failed or stopped creation.
 * @param signal - Cancellation of the control request.
 * @returns after the operation is recorded or completed.
 */
@Remote retryWorktree(session: Session, signal: AbortSignal): void

/**
 * Restore a removed checkout without changing the execution directory.
 * @param session - Session retaining the missing checkout.
 * @param signal - Cancels restoration.
 * @returns after the operation is recorded or completed.
 */
@Remote async restoreWorktree(session: Session, signal: AbortSignal): Promise<void>

/**
 * Return to the immutable original project without removing the checkout.
 * @param session - Session retaining the original project identity.
 * @param signal - Cancels directory validation.
 * @returns after the operation is recorded or completed.
 */
@Remote async continueInProject(session: Session, signal: AbortSignal): Promise<void>

/**
 * Follow one Session only while the caller retains its stream.
 * @param session - original Session identity.
 * @param signal - ends the subscription.
 * @returns local checkout states in publication order.
 */
@Remote({ mode: 'stream' }) async *follow(session: Session, signal: AbortSignal): AsyncIterable<ForgePanelState>
```

Types: [Session](session.md)

Source: [`packages/experimental/client-ui-forge/src/index.ts`](../../packages/experimental/client-ui-forge/src/index.ts)

<a id="ctxworktrees--worktreeservice"></a>

### `ctx.worktrees` — `WorktreeService`

Creates retained Git worktrees under the mounted filesystem and sandbox providers.

```ts cordis-catalog
/**
 * Create a fresh branch and checkout at a pinned local revision, then enter it.
 * Existing branches or checkout paths fail. Uncommitted files stay in the source checkout.
 * Checkout disables configured clean, smudge, and process filters without changing Git config.
 * Repository-local replacement refs still apply; baseCommit reports the resolved object name.
 * The new checkout becomes current only after Git setup succeeds. Failures may retain newly
 * allocated Git/filesystem artifacts; no branch or checkout is removed automatically.
 * @param agent - caller whose current directory selects the source repository and file policy.
 * @param request - optional new name and local revision; defaults are generated name and HEAD.
 * @param signal - cancellation of lookup, creation, and working-directory publication.
 * @param onPhase - receives each stage before it begins; it must not throw.
 * @returns canonical checkout path, branch name, pinned commit, and source repository root.
 */
async create( agent: Agent, request: CreateWorktreeRequest = {}, signal?: AbortSignal, onPhase?: (phase: CreateWorktreePhase) => void, ): Promise<CreatedWorktree>

/**
 * Check out a removed worktree again at its recorded directory: its branch
 * when the branch still exists, otherwise a new branch of the same name at
 * `baseCommit`. Only the missing target's unlocked registration is removed, and an
 * existing directory fails. Changes that were never committed are not
 * recovered. Checkout disables configured clean, smudge, and process filters,
 * as creation does. The calling Session's working directory does not change.
 * Failures may retain newly allocated Git/filesystem artifacts.
 * @param agent - caller whose sandbox policy confines the commands.
 * @param request - recorded directory, branch, base commit, and source repository root.
 * @param signal - cancellation of the restoration.
 * @param onPhase - receives each stage before it begins; it must not throw.
 * @returns the directory and whether the branch was created again.
 */
async restore( agent: Agent, request: RestoreWorktreeRequest, signal?: AbortSignal, onPhase?: (phase: CreateWorktreePhase) => void, ): Promise<RestoredWorktree>
```

Types: [Agent](core.md)

Source: [`packages/experimental/worktree/src/index.ts`](../../packages/experimental/worktree/src/index.ts)
<!-- END GENERATED cordis-surface -->
