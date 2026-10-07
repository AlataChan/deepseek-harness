# Ask-Data Seam

English | [中文](ask-data.zh.md)

The relational-data seam owned by [`@deepseek-ai/dsh-host-ask-data`](../../packages/host/ask-data/README.md). It lists configured sources, imports a spreadsheet into one, and binds a source to a Session. The Session Controller exposes it through its `askData` remotes; the desktop overlay consumes it through the [data-agent Session flow](../../packages/experimental/desktop-ask-data/README.md).

Source: [`packages/host/ask-data/src/index.ts`](../../packages/host/ask-data/src/index.ts)

## Durable events

Each binding is log-only: consumers reconstruct the current binding through the package's Session projection rather than replaying the payload.

- `ask-data/bound`

The scope `ask-data/*` belongs to this seam.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxaskdata--askdata-abstract-seam"></a>

### `ctx.askData` — `AskData` (abstract seam)

Abstract data-source listing, import, and session bind. Subclass, implement the four methods, and load the subclass as a plugin — it registers as `ctx.askData`. The class itself is not a mounted plugin.

```ts cordis-catalog
/**
 * List overlay-managed sources plus unmatched data-agent connections.
 * @param signal - caller lifetime; abort stops the listing.
 * @returns listed sources, `missing` set when a managed sqlite vanished.
 */
abstract listSources(signal?: AbortSignal): Promise<AskDataSource[]>

/**
 * Import one `.xlsx` / `.csv` into a managed sqlite and manifest row.
 * Does not apply a preset or open a session. `connectionRef` stays absent.
 * @param request - filename, decoded bytes, optional replace target.
 * @param signal - caller lifetime; abort stops the import.
 * @returns preview read from the written sqlite.
 */
abstract importSpreadsheet( request: AskDataImportSpreadsheetRequest, signal?: AbortSignal, ): Promise<AskDataImportPreview>

/**
 * Copy the packaged sample sqlite into the manifest. Does not need host
 * `sqlite3`. Does not apply a preset or open a session.
 * @param signal - caller lifetime; abort stops the copy.
 * @returns preview read from the copied sqlite.
 */
abstract importSample(signal?: AbortSignal): Promise<AskDataImportPreview>

/**
 * Register or reuse the readonly data-agent profile, write overlay
 * `connectionRef`, and persist the session binding. The Session must
 * already exist. Idempotent for the same `{ sourceId, sessionId }`.
 * @param request - source and session identities.
 * @param signal - caller lifetime; abort stops the bind.
 * @returns a lease whose `rollback` undoes this bind in-process.
 */
abstract bind(request: AskDataBindRequest, signal?: AbortSignal): Promise<AskDataBindLease>
```

Source: [`packages/host/ask-data/src/index.ts`](../../packages/host/ask-data/src/index.ts)
<!-- END GENERATED cordis-surface -->
