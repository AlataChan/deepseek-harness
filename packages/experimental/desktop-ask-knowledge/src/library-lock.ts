/**
 * Catalog, per-session, and per-library async mutexes. Callers must acquire
 * catalog, then session mutexes, then library — never the reverse.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/library-lock
 */

import { AsyncLocalStorage } from 'node:async_hooks'

type Release = () => void

function createMutex(): { acquire: () => Promise<Release> } {
  let tail = Promise.resolve()
  return {
    acquire: () => {
      let release!: Release
      const next = new Promise<void>((resolve) => {
        release = resolve
      })
      const wait = tail
      tail = next
      return wait.then(() => release)
    },
  }
}

const catalogMutexes = new Map<string, ReturnType<typeof createMutex>>()
const libraryMutexes = new Map<string, ReturnType<typeof createMutex>>()
const sessionMutexes = new Map<string, ReturnType<typeof createMutex>>()
const catalogAls = new AsyncLocalStorage<ReadonlySet<string>>()
const sessionAls = new AsyncLocalStorage<ReadonlySet<string>>()

function mutexFor(map: Map<string, ReturnType<typeof createMutex>>, key: string) {
  let mutex = map.get(key)
  if (mutex === undefined) {
    mutex = createMutex()
    map.set(key, mutex)
  }
  return mutex
}

/**
 * Run `fn` while holding the catalog mutex for one knowledge home.
 * @param home - resolved app-data directory; each home has its own mutex.
 * @param fn - exclusive catalog work.
 * @returns the work result.
 */
export async function withCatalogLock<T>(home: string, fn: () => Promise<T>): Promise<T> {
  if (catalogAls.getStore()?.has(home) === true) return fn()
  const release = await mutexFor(catalogMutexes, home).acquire()
  const owned = new Set(catalogAls.getStore())
  owned.add(home)
  try {
    return await catalogAls.run(owned, fn)
  } finally {
    release()
  }
}

/**
 * Run `fn` while holding one library mutex. Must not be called while this
 * stack still needs to acquire a session mutex.
 * @param libraryId - catalog id.
 * @param fn - exclusive vault work.
 * @returns the work result.
 */
export async function withLibraryLock<T>(libraryId: string, fn: () => Promise<T>): Promise<T> {
  const release = await mutexFor(libraryMutexes, libraryId).acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}

/**
 * Hold catalog, then one library, then run `fn`. Release library first.
 * @param home - resolved app-data directory.
 * @param libraryId - catalog id.
 * @param fn - work that mutates both catalog and vault.
 * @returns the work result.
 */
export async function withCatalogThenLibrary<T>(
  home: string,
  libraryId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return await withCatalogLock(home, () => withLibraryLock(libraryId, fn))
}

/**
 * Run `fn` while holding one session mutex. Same-stack reentry is allowed.
 * @param sessionId - Session identity.
 * @param fn - exclusive session work.
 * @returns the work result.
 */
export async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  if (sessionAls.getStore()?.has(sessionId) === true) return fn()
  let mutex = sessionMutexes.get(sessionId)
  if (mutex === undefined) {
    mutex = createMutex()
    sessionMutexes.set(sessionId, mutex)
  }
  const release = await mutex.acquire()
  const owned = new Set(sessionAls.getStore())
  owned.add(sessionId)
  try {
    return await sessionAls.run(owned, fn)
  } finally {
    release()
  }
}

/**
 * Acquire every session mutex in sorted id order, then run `fn`.
 * @param sessionIds - Session identities.
 * @param fn - work that already holds catalog and needs those sessions.
 * @returns the work result.
 */
export async function withSessionLocks<T>(
  sessionIds: readonly string[],
  fn: () => Promise<T>,
): Promise<T> {
  const unique = [...new Set(sessionIds)].toSorted()
  const run = async (index: number): Promise<T> => {
    const sessionId = unique[index]
    if (sessionId === undefined) return fn()
    return withSessionLock(sessionId, () => run(index + 1))
  }
  return run(0)
}
