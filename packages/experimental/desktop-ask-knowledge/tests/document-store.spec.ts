/**
 * Tests for documents SQLite store:
 * - Monotonic schema creation and migration guards
 * - Future and corrupt schema refusal
 * - Persistence across connection restarts
 * - Library isolation in documents and revisions
 * - Python-level integrity verification
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DocumentRecord, SourceRevisionRecord } from '../src/document-types.ts'
import { runSidecar } from '../src/sidecar.ts'
import { installPythonSidecar } from './helpers/install-sidecar.ts'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function setupTestVault() {
  const root = await mkdtemp(join(tmpdir(), 'ak-doc-store-test-'))
  const sidecarHome = join(root, 'sidecar')
  const vaultDir = join(root, 'vault')

  await mkdir(sidecarHome, { recursive: true })
  await mkdir(vaultDir, { recursive: true })
  await installPythonSidecar(sidecarHome)

  cleanups.push(async () => {
    await rm(root, { recursive: true, force: true })
  })

  return { root, sidecarHome, vaultDir }
}

describe('documents SQLite store and schema', () => {
  it('registers documents and revisions, and persists them across restarts', async () => {
    const { sidecarHome, vaultDir } = await setupTestVault()
    const config = { sidecarRuntimePath: sidecarHome }

    const regRes = await runSidecar(config, {
      command: 'register-source-revision',
      vault: vaultDir,
      documentId: 'doc-101',
      libraryId: 'lib-alpha',
      filename: 'guidelines.pdf',
      sha256: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
      byteLength: 4096,
      objectPath: '.octopus-kb/sources/rev-1/original',
      mimeType: 'application/pdf',
    })

    expect(regRes.ok).toBe(true)
    const doc = regRes.document as DocumentRecord
    const rev = regRes.revision as SourceRevisionRecord
    expect(doc.id).toBe('doc-101')
    expect(doc.status).toBe('retained')
    expect(rev.byteLength).toBe(4096)

    // Query back via get-document
    const getDocRes = await runSidecar(config, {
      command: 'get-document',
      vault: vaultDir,
      documentId: 'doc-101',
    })

    expect(getDocRes.ok).toBe(true)
    const getDoc = getDocRes.document as DocumentRecord
    expect(getDoc.displayFilename).toBe('guidelines.pdf')
    expect(getDoc.libraryId).toBe('lib-alpha')

    // Query back via get-source-revision
    const getRevRes = await runSidecar(config, {
      command: 'get-source-revision',
      vault: vaultDir,
      revisionId: rev.revisionId,
    })

    expect(getRevRes.ok).toBe(true)
    const getRev = getRevRes.revision as SourceRevisionRecord
    expect(getRev.documentId).toBe('doc-101')
    expect(getRev.mimeType).toBe('application/pdf')
  })

  it('strictly isolates documents by library ID', async () => {
    const { sidecarHome, vaultDir } = await setupTestVault()
    const config = { sidecarRuntimePath: sidecarHome }

    await runSidecar(config, {
      command: 'register-source-revision',
      vault: vaultDir,
      documentId: 'doc-alpha',
      libraryId: 'lib-alpha',
      filename: 'alpha-only.md',
      sha256: '1111111111111111111111111111111111111111111111111111111111111111',
      byteLength: 100,
      objectPath: '.octopus-kb/sources/rev-alpha/original',
    })

    await runSidecar(config, {
      command: 'register-source-revision',
      vault: vaultDir,
      documentId: 'doc-beta',
      libraryId: 'lib-beta',
      filename: 'beta-only.md',
      sha256: '2222222222222222222222222222222222222222222222222222222222222222',
      byteLength: 200,
      objectPath: '.octopus-kb/sources/rev-beta/original',
    })

    const alphaList = await runSidecar(config, {
      command: 'list-documents',
      vault: vaultDir,
      libraryId: 'lib-alpha',
    })
    const alphaDocs = alphaList.documents as DocumentRecord[]
    expect(alphaDocs.length).toBe(1)
    expect(alphaDocs[0]?.id).toBe('doc-alpha')

    const betaList = await runSidecar(config, {
      command: 'list-documents',
      vault: vaultDir,
      libraryId: 'lib-beta',
    })
    const betaDocs = betaList.documents as DocumentRecord[]
    expect(betaDocs.length).toBe(1)
    expect(betaDocs[0]?.id).toBe('doc-beta')
  })

  it('refuses unsupported future schema versions safely', async () => {
    const { sidecarHome, vaultDir } = await setupTestVault()
    const config = { sidecarRuntimePath: sidecarHome }

    // First initialize schema normally
    const initRes = await runSidecar(config, {
      command: 'register-source-revision',
      vault: vaultDir,
      documentId: 'doc-base',
      libraryId: 'lib-1',
      filename: 'base.md',
      sha256: '3333333333333333333333333333333333333333333333333333333333333333',
      byteLength: 50,
      objectPath: '.octopus-kb/sources/rev-base/original',
    })
    expect(initRes.ok).toBe(true)

    // Now artificially tamper schema_version to a future version (999) using sqlite via python
    const dbPath = join(vaultDir, '.octopus-kb', 'documents.sqlite')
    const tamperScript = [
      'import sqlite3',
      `con = sqlite3.connect(r'${dbPath}')`,
      "con.execute('UPDATE schema_info SET value = ? WHERE key = ?', ('999', 'schema_version'))",
      'con.commit()',
      'con.close()',
    ].join('\n')
    const { execFileSync } = await import('node:child_process')
    execFileSync('python3', ['-c', tamperScript])

    // Attempting to register another document must fail explicitly due to future schema
    await expect(
      runSidecar(config, {
        command: 'register-source-revision',
        vault: vaultDir,
        documentId: 'doc-future',
        libraryId: 'lib-1',
        filename: 'future.md',
        sha256: '4444444444444444444444444444444444444444444444444444444444444444',
        byteLength: 50,
        objectPath: '.octopus-kb/sources/rev-future/original',
      }),
    ).rejects.toThrow('unsupported future schema version')
  })

  it('refuses corrupt schema versions safely', async () => {
    const { sidecarHome, vaultDir } = await setupTestVault()
    const config = { sidecarRuntimePath: sidecarHome }

    await runSidecar(config, {
      command: 'register-source-revision',
      vault: vaultDir,
      documentId: 'doc-base2',
      libraryId: 'lib-1',
      filename: 'base2.md',
      sha256: '5555555555555555555555555555555555555555555555555555555555555555',
      byteLength: 50,
      objectPath: '.octopus-kb/sources/rev-base2/original',
    })

    // Corrupt schema_version to non-numeric
    const dbPath = join(vaultDir, '.octopus-kb', 'documents.sqlite')
    const corruptScript = [
      'import sqlite3',
      `con = sqlite3.connect(r'${dbPath}')`,
      "con.execute('UPDATE schema_info SET value = ? WHERE key = ?', ('invalid_not_a_number', 'schema_version'))",
      'con.commit()',
      'con.close()',
    ].join('\n')
    const { execFileSync } = await import('node:child_process')
    execFileSync('python3', ['-c', corruptScript])

    await expect(
      runSidecar(config, {
        command: 'register-source-revision',
        vault: vaultDir,
        documentId: 'doc-corrupt',
        libraryId: 'lib-1',
        filename: 'corrupt.md',
        sha256: '6666666666666666666666666666666666666666666666666666666666666666',
        byteLength: 50,
        objectPath: '.octopus-kb/sources/rev-corrupt/original',
      }),
    ).rejects.toThrow('corrupt schema version')
  })
})
