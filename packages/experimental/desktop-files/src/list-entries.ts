/**
 * One-level workspace listing fenced to a Host-owned project root.
 * Copied scan helpers (fully-qualified, abort race, bounded insert) match
 * directory-picker-browse so the fence and the bound stay the same shape.
 */

import { lstat, opendir, realpath, stat } from 'node:fs/promises'
import path, { posix, win32 } from 'node:path'
import {
  WorkspaceEntriesError,
} from '@deepseek-ai/dsh-host-workspace-entries'
import type {
  WorkspaceEntriesListing, WorkspaceEntriesListRequest, WorkspaceEntry,
} from '@deepseek-ai/dsh-host-workspace-entries'

/** Directory names omitted from every listing level. */
export const JUNK_DIRECTORY_NAMES = new Set(['node_modules', '.git', 'dist', 'coverage'])

/** Path helpers used by the lexical fence (inject `path.win32` in tests). */
export interface PathApi {
  resolve(...parts: string[]): string
  relative(from: string, to: string): string
  isAbsolute(target: string): boolean
  readonly sep: string
}

/**
 * True when the path names one fixed filesystem location regardless of
 * process state: POSIX-absolute on POSIX; on Windows only drive-qualified
 * (`C:\…`) or complete UNC (`\\server\share…`) forms.
 * @param candidate - candidate path.
 * @param platform - replaces `process.platform` for deterministic tests.
 * @returns whether the path is fully qualified on the platform.
 */
export function fullyQualified(candidate: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32'
    ? win32.isAbsolute(candidate) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(candidate)
    : posix.isAbsolute(candidate)
}

/**
 * Lexical containment of `target` inside `root` after `resolve`.
 * Rejects `..`, a `..` prefix, and an absolute `relative` (Windows
 * cross-drive `relative` returns an absolute path, not `..`).
 * @param root - resolved project root.
 * @param target - resolved list path.
 * @param pathApi - path helpers; defaults to this process's `node:path`.
 * @returns whether `target` is `root` or a descendant.
 */
export function isInsideRoot(root: string, target: string, pathApi: PathApi = path): boolean {
  const rootR = pathApi.resolve(root)
  const pathR = pathApi.resolve(target)
  const rel = pathApi.relative(rootR, pathR)
  if (rel === '') return true
  if (rel === '..') return false
  if (rel.startsWith(`..${pathApi.sep}`)) return false
  if (pathApi.isAbsolute(rel)) return false
  return true
}

/** One streamed listing candidate: the dirent name, nothing else retained. */
export interface ListingCandidate {
  /** Base name within the streamed level. */
  name: string
}

/**
 * Insert a streamed candidate into the name-sorted bounded window, evicting
 * the name-largest candidate when the window exceeds `keep`.
 * @param window - the name-ascending window, mutated in place.
 * @param candidate - the streamed candidate to place.
 * @param keep - the window bound.
 * @returns true when an eviction happened.
 */
export function boundedInsert(window: ListingCandidate[], candidate: ListingCandidate, keep: number): boolean {
  // oxlint-disable-next-line typescript/no-non-null-assertion -- a full window (length === keep >= 1) has a tail
  if (window.length === keep && candidate.name.localeCompare(window[window.length - 1]!.name) >= 0) return true
  let lo = 0
  let hi = window.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the loop condition
    if (candidate.name.localeCompare(window[mid]!.name) < 0) hi = mid
    else lo = mid + 1
  }
  window.splice(lo, 0, candidate)
  if (window.length <= keep) return false
  window.pop()
  return true
}

/**
 * Await `operation`, but reject with the signal's reason the moment it aborts.
 * @param operation - the in-flight filesystem step.
 * @param signal - caller lifetime; absent means plain awaiting.
 * @returns the operation's value.
 */
export function raceAbort<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return operation
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      operation.catch(() => {
        // Abandoned read: its handle is being closed by the aborting caller.
      })
      reject(asError(signal.reason))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (reason: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(asError(reason))
      },
    )
  })
}

/** Complete-result bound of one listing level. */
export interface ListEntriesConfig {
  /** At most this many child rows (hidden rows included); a cut level is `truncated`. */
  maxEntries: number
}

const DEFAULT_CONFIG: ListEntriesConfig = { maxEntries: 1000 }

/**
 * List one directory level inside `request.root`.
 * @param request - Host-derived root and optional fully-qualified list path.
 * @param signal - caller/connection lifetime; abort stops the scan.
 * @param config - complete-result bound; defaults to 1000.
 * @returns the level's listing.
 */
export async function listEntries(
  request: WorkspaceEntriesListRequest,
  signal?: AbortSignal,
  config: ListEntriesConfig = DEFAULT_CONFIG,
): Promise<WorkspaceEntriesListing> {
  if (!fullyQualified(request.root)) {
    throw new WorkspaceEntriesError(
      'entries-unreadable',
      request.root,
      `cannot list "${request.root}": root is not a fully qualified path`,
    )
  }
  if (request.path !== undefined && !fullyQualified(request.path)) {
    throw new WorkspaceEntriesError(
      'entries-unreadable',
      request.path,
      `cannot list "${request.path}": not a fully qualified path`,
    )
  }
  const rootR = path.resolve(request.root)
  const pathR = path.resolve(request.path ?? request.root)
  if (!isInsideRoot(rootR, pathR)) {
    throw new WorkspaceEntriesError(
      'entries-outside-root',
      pathR,
      `${pathR} is outside ${rootR}`,
      rootR,
    )
  }
  let realRoot: string
  try {
    realRoot = await raceAbort(realpath(rootR), signal)
  } catch (error: unknown) {
    signal?.throwIfAborted()
    throw new WorkspaceEntriesError(
      'entries-unreadable',
      rootR,
      `cannot list "${rootR}": ${messageOf(error)}`,
    )
  }
  let realPath: string
  try {
    realPath = await raceAbort(realpath(pathR), signal)
  } catch (error: unknown) {
    signal?.throwIfAborted()
    throw new WorkspaceEntriesError(
      'entries-unreadable',
      pathR,
      `cannot list "${pathR}": ${messageOf(error)}`,
    )
  }
  if (!isInsideRoot(realRoot, realPath)) {
    throw new WorkspaceEntriesError(
      'entries-outside-root',
      pathR,
      `${pathR} is outside ${rootR}`,
      rootR,
    )
  }
  const keep = config.maxEntries
  const window: ListingCandidate[] = []
  let truncated = false
  const opening = opendir(realPath)
  const level = await raceAbort(opening, signal).catch((error: unknown) => {
    void opening.then(dir => dir.close().catch(swallowCloseFailure), () => {
      // Already rejected: raceAbort surfaced or swallowed it.
    })
    throw error
  })
  try {
    for (;;) {
      const dirent = await raceAbort(level.read(), signal)
      if (dirent === null) break
      if (JUNK_DIRECTORY_NAMES.has(dirent.name)) continue
      if (boundedInsert(window, { name: dirent.name }, keep)) truncated = true
    }
  } finally {
    const closing = level.close()
    if (signal?.aborted) {
      closing.catch(swallowCloseFailure)
    } else {
      await closing
    }
  }
  const entries: WorkspaceEntry[] = []
  for (const candidate of window) {
    entries.push(await rowOf(pathR, candidate.name, signal))
  }
  return { path: pathR, root: rootR, entries, truncated }
}

async function rowOf(parent: string, name: string, signal: AbortSignal | undefined): Promise<WorkspaceEntry> {
  const rowPath = path.join(parent, name)
  const info = await raceAbort(lstat(rowPath), signal)
  let kind: WorkspaceEntry['kind'] = info.isDirectory() ? 'directory' : 'file'
  const symlink = info.isSymbolicLink()
  if (symlink) {
    try {
      const target = await raceAbort(stat(rowPath), signal)
      kind = target.isDirectory() ? 'directory' : 'file'
    } catch (_error: unknown) {
      if (signal?.aborted) throw asError(signal.reason)
      kind = 'broken-symlink'
    }
  }
  return { name, path: rowPath, kind, hidden: name.startsWith('.'), symlink }
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/* v8 ignore start -- a close failure of an abandoned handle has no consumer. */
function swallowCloseFailure(): void {}
/* v8 ignore stop */
