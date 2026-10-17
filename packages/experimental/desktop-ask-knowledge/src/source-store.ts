/**
 * Lossless source storage and immutable revision management.
 * Handles staging, SHA-256 calculation, atomic Windows-safe publication,
 * and integrity verification.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/source-store
 */

import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readdir, realpath, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'
import type { AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'
import { assertVaultDir, requireLibrary } from './catalog.ts'
import { DocumentId, RevisionId } from './document-types.ts'
import type { DocumentRecord, SourceRevisionRecord } from './document-types.ts'
import type { AskKnowledgeHomeConfig } from './knowledge-home.ts'
import { withLibraryLock } from './library-lock.ts'
import { runSidecar } from './sidecar.ts'

/** Reject links in every component before opening a source-owned file. */
async function assertSourcePath(vault: string, target: string): Promise<void> {
  assertPathWithin(vault, target)
  let current = vault
  for (const part of relative(vault, target).split(sep)) {
    current = join(current, part)
    const entry = await lstat(current)
    if (entry.isSymbolicLink()) throw new AskKnowledgeError('path-escape', 'source path contains a symbolic link')
  }
  const canonical = await realpath(target)
  assertPathWithin(await realpath(vault), canonical)
}

/** Assert lexical containment independently of the current filesystem. */
function assertPathWithin(baseDir: string, targetPath: string): void {
  const rel = relative(resolve(baseDir), resolve(targetPath))
  if (isAbsolute(rel) || rel === '' || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new AskKnowledgeError('path-escape', 'source path escapes its library')
  }
}

/** Restrict replay cleanup to one staging attempt directory. */
function assertStagedPath(vault: string, path: string): void {
  const root = join(vault, '.octopus-kb', 'staging')
  assertPathWithin(root, path)
  const parts = relative(root, path).split(sep)
  if (parts.length !== 2 || parts[1] !== 'original') throw new AskKnowledgeError('path-escape', 'invalid staged source path')
}

/** Flush file contents before publication and always release the descriptor. */
async function durableWrite(path: string, content: string): Promise<void> {
  const file = await open(path, 'wx', 0o600)
  try { await file.writeFile(content); await file.sync() } finally { await file.close() }
}

/** Flush directory entries on platforms that support directory fsync. */
async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const directory = await open(path, 'r')
  try { await directory.sync() } finally { await directory.close() }
}

/** Read through a no-follow descriptor after checking all ancestors. */
async function readObject(vault: string, path: string): Promise<Buffer> {
  await assertSourcePath(vault, path)
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    if (!(await file.stat()).isFile()) throw new AskKnowledgeError('path-escape', 'source object is not a regular file')
    return await file.readFile()
  } finally { await file.close() }
}

/** Replay durable publication intents before allowing additional source operations. */
async function recoverRegistrations(
  config: AskKnowledgeHomeConfig,
  vault: string,
  libraryId: AskKnowledgeLibraryId,
  signal?: AbortSignal,
): Promise<void> {
  const root = join(vault, '.octopus-kb', 'sources')
  let entries
  try {
    await assertSourcePath(vault, root)
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    const files = await readdir(dir)
    if (!files.includes('registration.json') || files.includes('registered')) continue
    const data: unknown = JSON.parse((await readObject(vault, join(dir, 'registration.json'))).toString('utf8'))
    if (typeof data !== 'object' || data === null || !('documentId' in data) || !('libraryId' in data) || data.libraryId !== libraryId ||
        !('filename' in data) || typeof data.filename !== 'string' || !('sha256' in data) || typeof data.sha256 !== 'string' ||
        !('byteLength' in data) || typeof data.byteLength !== 'number' || typeof data.documentId !== 'string') {
      throw new AskKnowledgeError('ingest-failed', 'invalid pending source registration')
    }
    const object = join(dir, 'original')
    if (!files.includes('original')) {
      if (!('stagedPath' in data) || typeof data.stagedPath !== 'string') throw new AskKnowledgeError('ingest-failed', 'pending source bytes unavailable')
      assertStagedPath(vault, data.stagedPath)
      const staged = await readObject(vault, data.stagedPath)
      if (staged.length !== data.byteLength || createHash('sha256').update(staged).digest('hex') !== data.sha256) throw new AskKnowledgeError('ingest-failed', 'pending staged source integrity mismatch')
      await link(data.stagedPath, object)
      await syncDirectory(dir)
    }
    if (`rev-${createHash('sha256').update(`${data.documentId}:${data.sha256}`).digest('hex').slice(0, 16)}` !== entry.name) {
      throw new AskKnowledgeError('ingest-failed', 'pending source revision identity mismatch')
    }
    const bytes = await readObject(vault, object)
    if (bytes.length !== data.byteLength || createHash('sha256').update(bytes).digest('hex') !== data.sha256) {
      throw new AskKnowledgeError('ingest-failed', 'pending source integrity mismatch')
    }
    const result = await runSidecar(config, { command: 'register-source-revision', vault, libraryId,
      documentId: data.documentId, filename: data.filename, sha256: data.sha256, byteLength: data.byteLength,
      objectPath: `.octopus-kb/sources/${entry.name}/original` }, { signal })
    if (result.ok !== true) throw new AskKnowledgeError('ingest-failed', 'pending source registration failed')
    await durableWrite(join(dir, 'registered'), 'registered\n')
    await syncDirectory(dir)
    if ('stagedPath' in data && typeof data.stagedPath === 'string') {
      assertStagedPath(vault, data.stagedPath)
      await rm(dirname(data.stagedPath), { recursive: true, force: true })
    }
  }
}

/**
 * Store an uploaded binary file as an immutable source revision.
 * @param config - sidecar home config.
 * @param knowledgeHome - app-data directory.
 * @param libraryId - catalog id.
 * @param filename - original filename.
 * @param content - uploaded binary content.
 * @param documentId - optional stable document id (generates new one if omitted).
 * @param signal - caller lifetime.
 * @returns stored document and revision records.
 */
export async function storeSourceOriginal(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  filename: string,
  content: Uint8Array | AsyncIterable<Uint8Array>,
  documentId?: DocumentId,
  signal?: AbortSignal,
): Promise<{
  readonly document: DocumentRecord
  readonly revision: SourceRevisionRecord
  readonly objectPath: string
}> {
  signal?.throwIfAborted()
  const docId = documentId ?? DocumentId(`doc-${randomUUID()}`)
  return await withLibraryLock(libraryId, async () => {
    signal?.throwIfAborted()
    const row = await requireLibrary(knowledgeHome, libraryId)
    const vault = await assertVaultDir(knowledgeHome, row)
    await recoverRegistrations(config, vault, libraryId, signal)
    const stagingDir = join(vault, '.octopus-kb', 'staging', randomUUID())
    const sourcesDir = join(vault, '.octopus-kb', 'sources')
    await mkdir(stagingDir, { recursive: true, mode: 0o700 })
    await mkdir(sourcesDir, { recursive: true, mode: 0o700 })
    await assertSourcePath(vault, stagingDir)
    await assertSourcePath(vault, sourcesDir)
    await syncDirectory(vault)
    await syncDirectory(join(vault, '.octopus-kb'))
    const tempFile = join(stagingDir, 'original')
    let sha256Hash: string
    let byteLength = 0
    try {
      const hash = createHash('sha256')
      const file = await open(tempFile, 'wx', 0o600)
      try {
        const chunks = content instanceof Uint8Array ? [content] : content
        for await (const chunk of chunks) {
          signal?.throwIfAborted()
          hash.update(chunk); byteLength += chunk.byteLength
          await file.writeFile(chunk)
        }
        await file.sync()
      } finally { await file.close() }
      sha256Hash = hash.digest('hex')
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true })
      throw error
    }
    const revHash = createHash('sha256').update(`${docId}:${sha256Hash}`).digest('hex').slice(0, 16)
    const revId = RevisionId(`rev-${revHash}`)
    const relObjectPath = `.octopus-kb/sources/${revId}/original`
    const targetFile = join(vault, relObjectPath)
    assertPathWithin(sourcesDir, targetFile)
    const targetDir = dirname(targetFile)
    await mkdir(targetDir, { recursive: true, mode: 0o700 })
    await assertSourcePath(vault, targetDir)
    const registration = { command: 'register-source-revision', vault, documentId: docId, libraryId,
      filename, sha256: sha256Hash, byteLength, objectPath: relObjectPath, stagedPath: tempFile }
    try {
      // The intent precedes object publication so a crash never leaves an unidentifiable object.
      try { await durableWrite(join(targetDir, 'registration.json'), JSON.stringify(registration)) } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
        const prior: unknown = JSON.parse((await readObject(vault, join(targetDir, 'registration.json'))).toString('utf8'))
        if (typeof prior !== 'object' || prior === null || !('documentId' in prior) || prior.documentId !== docId ||
            !('libraryId' in prior) || prior.libraryId !== libraryId || !('sha256' in prior) || prior.sha256 !== sha256Hash ||
            !('byteLength' in prior) || prior.byteLength !== byteLength) {
          throw new AskKnowledgeError('ingest-failed', 'immutable source registration identity mismatch')
        }
      }
      await syncDirectory(targetDir)
      try { await link(tempFile, targetFile) } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      }
      const written = await readObject(vault, targetFile)
      if (written.length !== byteLength || createHash('sha256').update(written).digest('hex') !== sha256Hash) {
        throw new AskKnowledgeError('ingest-failed', 'immutable source identity mismatch')
      }
      await syncDirectory(targetDir)
      await syncDirectory(sourcesDir)
    } catch (error) {
      // Keep staged bytes named by the durable intent for the next recovery pass.
      throw error
    }
    await rm(stagingDir, { recursive: true, force: true })

    // Register revision in SQLite via sidecar
    const res = await runSidecar(config, {
      command: 'register-source-revision',
      vault,
      documentId: docId,
      libraryId,
      filename,
      sha256: sha256Hash,
      byteLength,
      objectPath: relObjectPath,
    }, { signal })

    if (res.ok !== true) {
      throw new AskKnowledgeError('ingest-failed', String(res.error ?? 'failed to register revision in db'))
    }

    try { await durableWrite(join(targetDir, 'registered'), 'registered\n') } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    }
    await syncDirectory(targetDir)
    return {
      document: res.document as DocumentRecord,
      revision: res.revision as SourceRevisionRecord,
      objectPath: relObjectPath,
    }
  })
}

/**
 * Read the immutable original binary file for a source revision.
 * @param config - sidecar home config.
 * @param knowledgeHome - app-data directory.
 * @param libraryId - catalog id.
 * @param revisionId - source revision id.
 * @param signal - caller lifetime.
 * @returns original file bytes and metadata.
 */
export async function readSourceOriginal(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  revisionId: RevisionId,
  signal?: AbortSignal,
): Promise<{
  readonly bytes: Uint8Array
  readonly revision: SourceRevisionRecord
  readonly absPath: string
}> {
  return await withLibraryLock(libraryId, async () => {
    signal?.throwIfAborted()
    const row = await requireLibrary(knowledgeHome, libraryId)
    const vault = await assertVaultDir(knowledgeHome, row)

    await recoverRegistrations(config, vault, libraryId, signal)
    const revRes = await runSidecar(config, {
      command: 'get-source-revision',
      vault,
      revisionId,
    }, { signal })

    const revision = revRes.revision as SourceRevisionRecord | null
    if (!revision || revision.libraryId !== libraryId) {
      throw new AskKnowledgeError('ingest-failed', `revision ${revisionId} not found in library ${libraryId}`)
    }

    const absPath = join(vault, revision.objectPath)
    assertPathWithin(join(vault, '.octopus-kb', 'sources'), absPath)

    try {
      const bytes = new Uint8Array(await readObject(vault, absPath))
      const actualHash = createHash('sha256').update(bytes).digest('hex')
      if (actualHash !== revision.sha256 || bytes.byteLength !== revision.byteLength) {
        throw new AskKnowledgeError('ingest-failed', `stored source hash mismatch for revision ${revisionId}`)
      }
      return { bytes, revision, absPath }
    } catch (err) {
      if (err instanceof AskKnowledgeError) throw err
      throw new AskKnowledgeError('ingest-failed', `unable to read source file at ${absPath}`)
    }
  })
}

/**
 * Verify integrity of a stored source revision.
 * @param config - sidecar home config.
 * @param knowledgeHome - app-data directory.
 * @param libraryId - catalog id.
 * @param revisionId - revision id to verify.
 * @param signal - caller lifetime.
 * @returns whether source bytes are authentic and intact.
 */
export async function verifySourceRevision(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  revisionId: RevisionId,
  signal?: AbortSignal,
): Promise<boolean> {
  return await withLibraryLock(libraryId, async () => {
    signal?.throwIfAborted()
    const row = await requireLibrary(knowledgeHome, libraryId)
    const vault = await assertVaultDir(knowledgeHome, row)

    const res = await runSidecar(config, {
      command: 'verify-source-integrity',
      vault,
      revisionId,
    }, { signal })

    return res.ok === true && res.status === 'retained'
  })
}

/**
 * Recover source objects published before their metadata commit.
 * @param config - sidecar configuration.
 * @param knowledgeHome - catalog home directory.
 * @param libraryId - library whose pending intents are replayed.
 * @param signal - caller lifetime.
 */
export async function recoverSourceRegistrations(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  signal?: AbortSignal,
): Promise<void> {
  await withLibraryLock(libraryId, async () => {
    const row = await requireLibrary(knowledgeHome, libraryId)
    const vault = await assertVaultDir(knowledgeHome, row)
    await recoverRegistrations(config, vault, libraryId, signal)
  })
}
