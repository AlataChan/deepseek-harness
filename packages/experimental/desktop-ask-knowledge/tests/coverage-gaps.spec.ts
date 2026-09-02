/** Remaining catalog, lock, bound, upload, sidecar, retrieve, and unbind paths. */

import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AskKnowledgeError, AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  catalogPath, createCatalogLibrary, listCatalog, readCatalog, removeCatalogLibrary,
  renameCatalogLibrary, requireLibrary, resumeDeleting, touchLastUsed, writeCatalog,
} from '../src/catalog.ts'
import { resolveKnowledgeHome, resolveSidecarHome } from '../src/knowledge-home.ts'
import {
  withCatalogLock, withLibraryLock, withSessionLock, withSessionLocks,
} from '../src/library-lock.ts'
import { boundRetrieveResult, resolveResultBounds } from '../src/result-bounds.ts'
import {
  appendUpload, beginExtractUpload, beginUpload, decodeIngestChunk, disposeUpload,
  EXTRACT_LIBRARY_ID, materializeUpload, parseExtractFilename, parseIngestFilename,
} from '../src/upload-temp.ts'
import {
  resolveKbRoot, resolveSidecarExecutable, runSidecar,
} from '../src/sidecar.ts'
import {
  finishIngestPipeline, pendingAuditCount, readRawFile, recoverIfPending, recoverPendingAudits,
  reproposeAfterApplyFailure, writeTestProposal,
} from '../src/ingest.ts'
import { lookupLibraryTerm, retrieveLibraryBundle } from '../src/retrieve.ts'
import {
  assertNotLiveForPersistence, foldAskKnowledgeBinding, listBoundSessionIds, unbindSession,
} from '../src/unbind.ts'
import { placeLibraryShortcut } from '../src/shortcut.ts'
import { installFakeSidecar, writeFakeSidecarEnv } from './helpers/install-sidecar.ts'
import { resolveResultBounds as retrieveBounds } from '../src/retrieve.ts'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

describe('catalog remaining paths', () => {
  it('rejects invalid JSON, schema, empty name, long name, deleting rename, and missing touch', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-catalog-gap-'))
    await mkdir(join(home, 'knowledge-bases'), { recursive: true })
    await writeFile(catalogPath(home), '{not-json', 'utf8')
    await expect(readCatalog(home)).rejects.toMatchObject({ code: 'library-missing' })
    await writeFile(catalogPath(home), JSON.stringify({ version: 1, libraries: [{ id: 'x' }] }), 'utf8')
    await expect(readCatalog(home)).rejects.toMatchObject({ code: 'library-missing' })
    await writeCatalog(home, { version: 1, libraries: [] })
    await expect(createCatalogLibrary(home, '   ')).rejects.toMatchObject({ code: 'library-missing' })
    await expect(createCatalogLibrary(home, '字'.repeat(65))).rejects.toMatchObject({ code: 'library-missing' })
    const created = await createCatalogLibrary(home, '可删')
    await writeCatalog(home, {
      version: 1,
      libraries: [{
        id: created.id,
        displayName: '可删',
        createdAt: created.createdAt,
        lastUsedAt: created.lastUsedAt,
        vaultRelPath: `libraries/${created.id}`,
        deleting: true,
        missing: false,
      }],
    })
    await expect(renameCatalogLibrary(home, created.id, '新')).rejects.toMatchObject({ code: 'library-deleting' })
    await expect(requireLibrary(home, created.id)).rejects.toMatchObject({ code: 'library-deleting' })
    await expect(renameCatalogLibrary(home, AskKnowledgeLibraryId('missing'), 'x'))
      .rejects.toMatchObject({ code: 'library-missing' })
    await expect(touchLastUsed(home, AskKnowledgeLibraryId('missing')))
      .rejects.toMatchObject({ code: 'library-missing' })
    await resumeDeleting(home)
    expect(await listCatalog(home)).toEqual([])
    await removeCatalogLibrary(home, AskKnowledgeLibraryId('already-gone'))
    const live = await createCatalogLibrary(home, '仍在')
    await resumeDeleting(home)
    expect((await listCatalog(home)).some(row => row.id === live.id)).toBe(true)
    const { rm } = await import('node:fs/promises')
    await rm(join(home, 'knowledge-bases', 'libraries', live.id), { recursive: true, force: true })
    await removeCatalogLibrary(home, live.id)
    expect(await listCatalog(home)).toEqual([])
  })

  it('marks a vanished vault missing and hydrates optional flags', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-missing-vault-'))
    const created = await createCatalogLibrary(home, '失踪')
    const { rm } = await import('node:fs/promises')
    await rm(join(home, 'knowledge-bases', 'libraries', created.id), { recursive: true, force: true })
    const listed = await listCatalog(home)
    expect(listed[0]?.missing).toBe(true)
  })

  it('rejects a vaultRelPath that is not libraries/<id>', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-rel-'))
    await mkdir(join(home, 'knowledge-bases'), { recursive: true })
    const id = AskKnowledgeLibraryId('00000000-0000-0000-0000-000000000002')
    await writeCatalog(home, {
      version: 1,
      libraries: [{
        id,
        displayName: '坏',
        createdAt: '2026-08-31T00:00:00.000Z',
        lastUsedAt: '2026-08-31T00:00:00.000Z',
        vaultRelPath: 'not-libraries/x',
      }],
    })
    await expect(listCatalog(home)).rejects.toMatchObject({ code: 'path-escape' })
    await expect(removeCatalogLibrary(home, id)).rejects.toMatchObject({ code: 'path-escape' })
  })

  it('rejects a vault that is a symlink leaving knowledge-bases/', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-symlink-'))
    const created = await createCatalogLibrary(home, '外链')
    const vault = join(home, 'knowledge-bases', 'libraries', created.id)
    const { rm } = await import('node:fs/promises')
    await rm(vault, { recursive: true, force: true })
    const outside = await mkdtemp(join(tmpdir(), 'ask-knowledge-outside-'))
    await symlink(outside, vault)
    await expect(listCatalog(home)).rejects.toMatchObject({ code: 'path-escape' })
  })

  it('surfaces a catalog that is not a readable file and a failed rename', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-eisdir-'))
    await mkdir(join(home, 'knowledge-bases', 'catalog.json'), { recursive: true })
    await expect(readCatalog(home)).rejects.toMatchObject({ code: 'EISDIR' })
    const writable = await mkdtemp(join(tmpdir(), 'ask-knowledge-rename-fail-'))
    await mkdir(join(writable, 'knowledge-bases'), { recursive: true })
    await mkdir(catalogPath(writable))
    await expect(writeCatalog(writable, { version: 1, libraries: [] })).rejects.toBeTruthy()
  })
})

describe('knowledge home and sidecar home', () => {
  it('rejects a relative sidecar path and accepts an absolute override', () => {
    expect(resolveSidecarHome({ sidecarRuntimePath: '/tmp/sidecar-home' })).toBe('/tmp/sidecar-home')
    expect(resolveSidecarHome({}, { OCTOPUS_SIDECAR_HOME: '/tmp/sidecar-env' })).toBe('/tmp/sidecar-env')
    expect(resolveSidecarHome({ sidecarRuntimePath: '  ' }, { OCTOPUS_SIDECAR_HOME: '/tmp/sidecar-trim' }))
      .toBe('/tmp/sidecar-trim')
    expect(resolveKnowledgeHome({}, { OCTOPUS_APP_DATA: '/tmp/app-data' })).toBe('/tmp/app-data')
    expect(() => resolveSidecarHome({}, {})).toThrow(AskKnowledgeError)
    expect(() => resolveSidecarHome({ sidecarRuntimePath: 'relative' })).toThrow(AskKnowledgeError)
    expect(() => resolveKnowledgeHome({ knowledgeHome: '' }, { OCTOPUS_APP_DATA: 'rel' }))
      .toThrow(AskKnowledgeError)
    expect(() => resolveKnowledgeHome({ knowledgeHome: 'relative' })).toThrow(AskKnowledgeError)
    expect(() => resolveSidecarHome({}, { OCTOPUS_SIDECAR_HOME: '' })).toThrow(AskKnowledgeError)
  })
})

describe('locks', () => {
  it('reenters catalog and session mutexes and acquires several sessions', async () => {
    const seen: string[] = []
    await withCatalogLock('/tmp/a', async () => {
      await withCatalogLock('/tmp/a', async () => {
        seen.push('catalog')
      })
    })
    await withSessionLock('s1', async () => {
      await withSessionLock('s1', async () => {
        seen.push('session')
      })
    })
    await withSessionLocks(['b', 'a', 'a'], async () => {
      seen.push('many')
    })
    await withSessionLocks([], async () => {
      seen.push('none')
    })
    await withLibraryLock('lib', async () => {
      seen.push('lib')
    })
    expect(seen).toEqual(['catalog', 'session', 'many', 'none', 'lib'])
  })
})

describe('result bounds leftover', () => {
  it('defaults invalid caps and truncates on the token ceiling', () => {
    expect(resolveResultBounds()).toEqual({ maxItems: 12, maxChars: 24_000, maxTokens: 6000 })
    expect(resolveResultBounds({ maxItems: 0, maxChars: Number.NaN, maxTokens: -1 })).toEqual({
      maxItems: 12,
      maxChars: 24_000,
      maxTokens: 6000,
    })
    const bounded = boundRetrieveResult(
      [{ path: 'a', title: 'a', reason: '', text: 'abcd', kind: 'raw' }],
      [{ ruleId: 'w', message: 'warn' }],
      { maxItems: 12, maxChars: 24_000, maxTokens: 0 },
    )
    expect(bounded.items).toEqual([])
    expect(bounded.warnings.some(item => item.ruleId === 'result-truncated')).toBe(true)
    expect(retrieveBounds({ maxItems: 2 }).maxItems).toBe(2)
  })
})

describe('upload leftover', () => {
  it('rejects unsafe names, bad base64, and an assembled-file overflow', async () => {
    expect(() => parseIngestFilename('/abs.md')).toThrow(AskKnowledgeError)
    expect(() => parseIngestFilename('../x.md')).toThrow(AskKnowledgeError)
    expect(() => parseIngestFilename('x\0.md')).toThrow(AskKnowledgeError)
    expect(() => parseIngestFilename('..')).toThrow(AskKnowledgeError)
    expect(() => parseIngestFilename('noext')).toThrow(AskKnowledgeError)
    expect(() => parseIngestFilename('.')).toThrow(AskKnowledgeError)
    expect(() => parseIngestFilename('legacy.xls')).toThrow(AskKnowledgeError)
    expect(parseIngestFilename('制度.pdf')).toEqual({ basename: '制度.pdf', extension: '.pdf' })
    expect(parseIngestFilename('表.xlsx')).toEqual({ basename: '表.xlsx', extension: '.xlsx' })
    expect(parseIngestFilename('制度.docx')).toEqual({ basename: '制度.docx', extension: '.docx' })
    expect(parseExtractFilename('会话.md')).toEqual({ basename: '会话.md', extension: '.md' })
    expect(() => parseExtractFilename('表.xlsx')).toThrow(AskKnowledgeError)
    expect(() => decodeIngestChunk('YQ==')).not.toThrow()
    expect(() => decodeIngestChunk('YQ')).toThrow(AskKnowledgeError)
    expect(() => decodeIngestChunk(1)).toThrow(AskKnowledgeError)
    expect(() => decodeIngestChunk('@@@@')).toThrow(AskKnowledgeError)
    expect(() => decodeIngestChunk('A===')).toThrow(AskKnowledgeError)
    expect(() => decodeIngestChunk('YR==')).toThrow(AskKnowledgeError)
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-upload-'))
    const extractUpload = await beginExtractUpload(home, '会话.md')
    expect(extractUpload.libraryId).toBe(EXTRACT_LIBRARY_ID)
    expect(extractUpload.filename).toBe('会话.md')
    await disposeUpload(extractUpload)
    const upload = await beginUpload(home, AskKnowledgeLibraryId('lib'), 'ok.md')
    expect(() => appendUpload(upload, Buffer.from('too-big'), 1)).toThrow(AskKnowledgeError)
    appendUpload(upload, Buffer.from('# hi\n'), 1024)
    expect(await materializeUpload(upload)).toBe(upload.path)
    expect(await readFile(upload.path, 'utf8')).toBe('# hi\n')
    await disposeUpload(upload)
  })
})

describe('sidecar leftover', () => {
  it('resolves nested executables, kb roots, timeout, and bad stdout', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-sidecar-gap-'))
    await expect(() => resolveSidecarExecutable(home)).toThrow(AskKnowledgeError)
    const nestedDir = join(home, 'octopus-kb-sidecar')
    await mkdir(nestedDir, { recursive: true })
    await writeFile(join(nestedDir, 'octopus-kb-sidecar'), '#!/bin/sh\n', 'utf8')
    await chmod(join(nestedDir, 'octopus-kb-sidecar'), 0o755)
    expect(resolveSidecarExecutable(home)).toBe(join(nestedDir, 'octopus-kb-sidecar'))
    const previousRoot = process.env.OCTOPUS_KB_ROOT
    process.env.OCTOPUS_KB_ROOT = '/tmp/kb-root-abs'
    expect(resolveKbRoot(home)).toBe('/tmp/kb-root-abs')
    if (previousRoot === undefined) delete process.env.OCTOPUS_KB_ROOT
    else process.env.OCTOPUS_KB_ROOT = previousRoot
    const withPrompts = await mkdtemp(join(tmpdir(), 'ask-knowledge-prompts-'))
    await mkdir(join(withPrompts, 'prompts'), { recursive: true })
    await writeFile(join(withPrompts, 'prompts', 'propose.md'), 'x', 'utf8')
    expect(resolveKbRoot(withPrompts)).toBe(withPrompts)
    const timeoutHome = await mkdtemp(join(tmpdir(), 'ask-knowledge-timeout-'))
    await installFakeSidecar(timeoutHome)
    await expect(runSidecar({ sidecarRuntimePath: timeoutHome }, { command: 'self-test' }, {
      timeoutMs: 20,
      env: { ASK_KNOWLEDGE_FAKE_HOLD_MS: '5000' },
    })).rejects.toMatchObject({ code: 'ingest-failed' })
  })

  it('rejects non-object and failed sidecar JSON', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-sidecar-json-'))
    await mkdir(home, { recursive: true })
    const script = join(home, 'octopus-kb-sidecar')
    await writeFile(script, `#!/usr/bin/env node
const mode = process.env.ASK_KNOWLEDGE_FAKE_STDOUT ?? 'object'
if (mode === 'empty') process.exit(0)
if (mode === 'text') { process.stdout.write('not-json\\n'); process.exit(0) }
if (mode === 'array') { process.stdout.write('[1]\\n'); process.exit(0) }
if (mode === 'null') { process.stdout.write('null\\n'); process.exit(0) }
if (mode === 'num') { process.stdout.write('1\\n'); process.exit(0) }
if (mode === 'fail-no-error') { process.stdout.write(JSON.stringify({ ok: false }) + '\\n'); process.exit(1) }
process.stdout.write(JSON.stringify({ ok: false, error: 'boom' }) + '\\n')
process.exit(1)
`, 'utf8')
    await chmod(script, 0o755)
    await expect(runSidecar({ sidecarRuntimePath: home }, { command: 'x' }, {
      env: { ASK_KNOWLEDGE_FAKE_STDOUT: 'empty' },
    })).rejects.toMatchObject({ code: 'ingest-failed' })
    await expect(runSidecar({ sidecarRuntimePath: home }, { command: 'x' }, {
      env: { ASK_KNOWLEDGE_FAKE_STDOUT: 'text' },
    })).rejects.toMatchObject({ code: 'ingest-failed' })
    await expect(runSidecar({ sidecarRuntimePath: home }, { command: 'x' }, {
      env: { ASK_KNOWLEDGE_FAKE_STDOUT: 'array' },
    })).rejects.toMatchObject({ code: 'ingest-failed' })
    await expect(runSidecar({ sidecarRuntimePath: home }, { command: 'x' }, {
      env: { ASK_KNOWLEDGE_FAKE_STDOUT: 'null' },
    })).rejects.toMatchObject({ code: 'ingest-failed' })
    await expect(runSidecar({ sidecarRuntimePath: home }, { command: 'x' }, {
      env: { ASK_KNOWLEDGE_FAKE_STDOUT: 'num' },
    })).rejects.toMatchObject({ code: 'ingest-failed' })
    await expect(runSidecar({ sidecarRuntimePath: home }, { command: 'x' }, {
      env: { ASK_KNOWLEDGE_FAKE_STDOUT: 'fail-no-error' },
    })).rejects.toMatchObject({ code: 'ingest-failed' })
    await expect(runSidecar({ sidecarRuntimePath: home }, { command: 'x' }, {
      env: { ASK_KNOWLEDGE_FAKE_STDOUT: 'fail', MISSING: undefined },
    })).rejects.toMatchObject({ code: 'ingest-failed' })
  })
})

describe('retrieve leftover', () => {
  it('skips junk items, maps warnings, and no-hits lookup without a body', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ask-knowledge-retrieve-gap-'))
    const sidecarHome = join(root, 'sidecar')
    await installFakeSidecar(sidecarHome)
    await writeFakeSidecarEnv(sidecarHome, {
      ASK_KNOWLEDGE_FAKE_RETRIEVE_JSON: JSON.stringify({
        items: [
          'skip',
          { path: 'wiki/a.md', title: 1, reason: 1, text: 1, kind: 'other' },
          { path: 'wiki/a.md', title: 'dup' },
          { path: 'wiki/b.md', kind: 'concept', title: 'B', reason: 'r', text: 'body' },
        ],
        warnings: [{ code: 'w1', message: 'm1' }, { code: 'w2' }, 'skip'],
      }),
      ASK_KNOWLEDGE_FAKE_LOOKUP_JSON: JSON.stringify({}),
    })
    const created = await createCatalogLibrary(root, '检索')
    const bounds = resolveResultBounds({ maxItems: 12 })
    const bundle = await retrieveLibraryBundle(
      { sidecarRuntimePath: sidecarHome },
      root,
      created.id,
      ['报销'],
      bounds,
    )
    expect(bundle.items.map(item => item.path)).toEqual(['wiki/a.md', 'wiki/b.md'])
    expect(bundle.items[0]?.kind).toBe('raw')
    expect(bundle.warnings.some(item => item.ruleId === 'w1')).toBe(true)
    await writeFakeSidecarEnv(sidecarHome, {})
    await expect(retrieveLibraryBundle(
      { sidecarRuntimePath: sidecarHome },
      root,
      created.id,
      ['没有这个词'],
      bounds,
    )).rejects.toMatchObject({ code: 'no-hit' })
    await writeFakeSidecarEnv(sidecarHome, { ASK_KNOWLEDGE_FAKE_RETRIEVE_JSON: JSON.stringify({}) })
    await expect(retrieveLibraryBundle(
      { sidecarRuntimePath: sidecarHome },
      root,
      created.id,
      ['报销'],
      bounds,
    )).rejects.toMatchObject({ code: 'no-hit' })
    await writeFakeSidecarEnv(sidecarHome, { ASK_KNOWLEDGE_FAKE_LOOKUP_JSON: JSON.stringify({}) })
    await expect(lookupLibraryTerm(
      { sidecarRuntimePath: sidecarHome },
      root,
      created.id,
      '报销',
      bounds,
    )).rejects.toMatchObject({ code: 'no-hit' })
    await writeFakeSidecarEnv(sidecarHome, {
      ASK_KNOWLEDGE_FAKE_LOOKUP_JSON: JSON.stringify({ text: 'only-body' }),
    })
    const looked = await lookupLibraryTerm(
      { sidecarRuntimePath: sidecarHome },
      root,
      created.id,
      '报销',
      bounds,
    )
    expect(looked.text).toBe('only-body')
    await writeFakeSidecarEnv(sidecarHome, {
      ASK_KNOWLEDGE_FAKE_LOOKUP_JSON: JSON.stringify({ canonicalPath: 'wiki/a.md', text: '正文' }),
    })
    const withPath = await lookupLibraryTerm(
      { sidecarRuntimePath: sidecarHome },
      root,
      created.id,
      '报销',
      bounds,
    )
    expect(withPath.canonicalPath).toBe('wiki/a.md')
    await writeFakeSidecarEnv(sidecarHome, {
      ASK_KNOWLEDGE_FAKE_LOOKUP_JSON: JSON.stringify({ canonicalPath: 'wiki/a.md', text: 'clipped' }),
    })
    const clipped = await lookupLibraryTerm(
      { sidecarRuntimePath: sidecarHome },
      root,
      created.id,
      '报销',
      { maxItems: 12, maxChars: 24_000, maxTokens: 0 },
    )
    expect(clipped.canonicalPath).toBe('wiki/a.md')
    expect(clipped.text).toBeUndefined()
    await writeFakeSidecarEnv(sidecarHome, {
      ASK_KNOWLEDGE_FAKE_RETRIEVE_JSON: JSON.stringify({ items: 1 }),
    })
    await expect(retrieveLibraryBundle(
      { sidecarRuntimePath: sidecarHome },
      root,
      created.id,
      ['报销'],
      bounds,
    )).rejects.toMatchObject({ code: 'no-hit' })
  })
})

describe('unbind leftover', () => {
  it('folds junk binds, lists live then cold, and refuses persistence on a live id', async () => {
    expect(foldAskKnowledgeBinding([
      { type: 'ask-knowledge/bound', data: null },
      { type: 'ask-knowledge/bound', data: { libraryId: 1 } },
      { type: 'ask-knowledge/bound', data: { libraryId: 'a', displayName: 'A' } },
      { type: 'ask-knowledge/unbound', data: { libraryId: 'a' } },
    ])).toBeNull()
    const ctx = new Context()
    const live = {
      id: SessionId('live'),
      events: [{ type: 'ask-knowledge/bound', data: { libraryId: 'lib', displayName: 'L' } }],
      append: vi.fn(),
    }
    ctx.provide('sessions', {
      list: () => [live],
      get: (id: string) => id === live.id ? live : undefined,
    })
    ctx.provide('sessionProjections', { stateOf: () => ({ libraryId: 'lib', displayName: 'L' }) })
    ctx.provide('sessionPersistence', {
      list: async () => [{ id: SessionId('cold') }, { id: live.id }],
      load: async () => ({
        events: [{ type: 'ask-knowledge/bound', data: { libraryId: 'lib', displayName: 'L' } }],
      }),
      append: vi.fn(),
    })
    const ids = await listBoundSessionIds(ctx, AskKnowledgeLibraryId('lib'))
    expect(ids).toContain(live.id)
    expect(ids).toContain(SessionId('cold'))
    await unbindSession(ctx, live.id, AskKnowledgeLibraryId('lib'))
    expect(live.append).toHaveBeenCalled()
    expect(() => assertNotLiveForPersistence(ctx, live.id)).toThrow(AskKnowledgeError)
    expect(() => assertNotLiveForPersistence(new Context(), SessionId('cold'))).not.toThrow()
    const empty = new Context()
    expect(await listBoundSessionIds(empty, AskKnowledgeLibraryId('lib'))).toEqual([])
    await unbindSession(empty, SessionId('gone'), AskKnowledgeLibraryId('lib'))
    const folded = new Context()
    const other = {
      id: SessionId('other'),
      events: [{ type: 'ask-knowledge/bound', data: { libraryId: 'other', displayName: 'O' } }],
      append: vi.fn(),
    }
    folded.provide('sessions', {
      list: () => [other],
      get: (id: string) => id === other.id ? other : undefined,
    })
    folded.provide('sessionPersistence', {
      list: async () => [{ id: other.id }, { id: SessionId('fold-cold') }, { id: SessionId('other-cold') }],
      load: async (id: string) => ({
        events: [{
          type: 'ask-knowledge/bound',
          data: id === 'other-cold'
            ? { libraryId: 'other', displayName: 'O' }
            : { libraryId: 'lib', displayName: 'L' },
        }],
      }),
      append: vi.fn(),
    })
    const foldedIds = await listBoundSessionIds(folded, AskKnowledgeLibraryId('lib'))
    expect(foldedIds).toContain(SessionId('fold-cold'))
    expect(foldedIds).not.toContain(other.id)
    expect(foldedIds).not.toContain(SessionId('other-cold'))
  })

  it('appends through persistence when the id stays cold through re-checks', async () => {
    const ctx = new Context()
    const append = vi.fn()
    ctx.provide('sessionPersistence', {
      list: async () => [],
      load: async () => ({ events: [] }),
      append,
    })
    await unbindSession(ctx, SessionId('cold'), AskKnowledgeLibraryId('lib'))
    expect(append).toHaveBeenCalled()
    const sequenced = new Context()
    const appendSeq = vi.fn()
    sequenced.provide('sessionPersistence', {
      list: async () => [],
      load: async () => ({ events: [{ type: 'session/title', seq: 3, data: { title: 'x' } }] }),
      append: appendSeq,
    })
    await unbindSession(sequenced, SessionId('seq'), AskKnowledgeLibraryId('lib'))
    expect(appendSeq).toHaveBeenCalledWith(SessionId('seq'), [
      expect.objectContaining({ type: 'ask-knowledge/unbound', seq: 4 }),
    ])
  })

  it('switches a raced live session onto Session.append', async () => {
    const ctx = new Context()
    const live = { id: SessionId('race'), append: vi.fn(), events: [] }
    let reads = 0
    ctx.provide('sessions', {
      get: () => {
        reads += 1
        return reads === 1 ? undefined : live
      },
      list: () => [],
    })
    ctx.provide('sessionPersistence', {
      list: async () => [{ id: live.id }],
      load: async () => ({ events: [] }),
      append: vi.fn(),
    })
    await unbindSession(ctx, live.id, AskKnowledgeLibraryId('lib'))
    expect(live.append).toHaveBeenCalled()
    const late = new Context()
    let lateReads = 0
    late.provide('sessions', {
      get: () => {
        lateReads += 1
        return lateReads < 3 ? undefined : live
      },
      list: () => [],
    })
    late.provide('sessionPersistence', {
      list: async () => [{ id: live.id }],
      load: async () => ({ events: [] }),
      append: vi.fn(),
    })
    await unbindSession(late, live.id, AskKnowledgeLibraryId('lib'))
    expect(live.append).toHaveBeenCalledTimes(2)
  })
})

describe('shortcut leftover', () => {
  it('writes a workspace symlink and reports a missing workspace', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-shortcut-'))
    const workspace = await mkdtemp(join(tmpdir(), 'ask-knowledge-ws-'))
    await writeCatalog(home, {
      version: 1,
      libraries: [],
    })
    const slash = await createCatalogLibrary(home, '斜杠')
    await writeCatalog(home, {
      version: 1,
      libraries: [{
        id: slash.id,
        displayName: '   ',
        createdAt: slash.createdAt,
        lastUsedAt: slash.lastUsedAt,
        vaultRelPath: `libraries/${slash.id}`,
      }],
    })
    const created = await createCatalogLibrary(home, ' /库名/ ')
    const ctx = new Context()
    ctx.provide('workspaceRegistry', {
      get: (id: string) => id === 'ws' ? { path: workspace } : undefined,
    })
    const slashPlaced = await placeLibraryShortcut(ctx, home, slash.id, 'ws' as never)
    expect(slashPlaced.ok).toBe(true)
    expect(slashPlaced.path?.endsWith('library')).toBe(true)
    const missing = await placeLibraryShortcut(ctx, home, created.id, 'nope' as never)
    expect(missing).toEqual({ ok: false, reason: 'workspace-missing' })
    const placed = await placeLibraryShortcut(ctx, home, created.id, 'ws' as never)
    expect(placed.ok).toBe(true)
    expect(placed.path).toContain('知识库')
    const again = await placeLibraryShortcut(ctx, home, created.id, 'ws' as never)
    expect(again.ok).toBe(false)
    expect(again.reason).toBeDefined()
  })
})

describe('ingest leftover helpers', () => {
  it('counts inbox rows, recovers object and string ids, and re-proposes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ask-knowledge-ingest-gap-'))
    const sidecarHome = join(root, 'sidecar')
    await installFakeSidecar(sidecarHome)
    const created = await createCatalogLibrary(root, 'inbox')
    const vault = join(root, 'knowledge-bases', 'libraries', created.id)
    await writeFakeSidecarEnv(sidecarHome, {
      ASK_KNOWLEDGE_FAKE_INBOX: JSON.stringify(['p1', { proposal_id: 'p2' }, { id: 'p3' }, {}, 1]),
    })
    const ctx = new Context()
    ctx.provide('credentials', {
      resolve: async () => ({ value: 'sk-test-not-real' }),
    })
    expect(await pendingAuditCount({ sidecarRuntimePath: sidecarHome }, vault)).toBe(5)
    await writeFakeSidecarEnv(sidecarHome, {
      ASK_KNOWLEDGE_FAKE_INBOX: JSON.stringify(['p1']),
      ASK_KNOWLEDGE_FAKE_INBOX_BARE: '1',
    })
    expect(await pendingAuditCount({ sidecarRuntimePath: sidecarHome }, vault)).toBe(0)
    await writeFakeSidecarEnv(sidecarHome, { ASK_KNOWLEDGE_FAKE_INBOX_NO_ITEMS: '1' })
    await recoverPendingAudits(ctx, { sidecarRuntimePath: sidecarHome }, vault)
    await writeFakeSidecarEnv(sidecarHome, {
      ASK_KNOWLEDGE_FAKE_INBOX: JSON.stringify(['p1', { proposal_id: 'p2' }, { id: 'p3' }, {}, 1]),
    })
    await recoverPendingAudits(ctx, { sidecarRuntimePath: sidecarHome }, vault)
    await recoverIfPending(ctx, { sidecarRuntimePath: sidecarHome }, vault, 'p1')
    await writeFakeSidecarEnv(sidecarHome, { ASK_KNOWLEDGE_FAKE_INBOX: 'not-json' })
    expect(await pendingAuditCount({ sidecarRuntimePath: sidecarHome }, '/no-such-vault')).toBe(0)
    await writeFakeSidecarEnv(sidecarHome, { ASK_KNOWLEDGE_FAKE_PROPOSAL_ID: 'prop-new' })
    const next = await reproposeAfterApplyFailure(
      ctx,
      { sidecarRuntimePath: sidecarHome },
      vault,
      'raw/missing.md',
      'prop-old',
    )
    expect(next).toBe('prop-new')
    await writeFakeSidecarEnv(sidecarHome, { ASK_KNOWLEDGE_FAKE_PROPOSAL_ID: 'prop-old' })
    await expect(reproposeAfterApplyFailure(
      ctx,
      { sidecarRuntimePath: sidecarHome },
      vault,
      'raw/missing.md',
      'prop-old',
    )).rejects.toMatchObject({ code: 'ingest-failed' })
    await writeFakeSidecarEnv(sidecarHome, { ASK_KNOWLEDGE_FAKE_PROPOSE_NO_ID: '1' })
    await expect(reproposeAfterApplyFailure(
      ctx,
      { sidecarRuntimePath: sidecarHome },
      vault,
      'raw/sample.md',
      'prop-old',
    )).rejects.toMatchObject({ code: 'ingest-failed' })
    await expect(finishIngestPipeline(ctx, { sidecarRuntimePath: sidecarHome }, root, {
      libraryId: created.id,
      tempPath: join(root, 'nope.md'),
      reuseRawPath: '../escape.md',
    })).rejects.toMatchObject({ code: 'path-escape' })
    await writeFile(join(root, 'sample.md'), '# sample\n', 'utf8')
    await writeFakeSidecarEnv(sidecarHome, { ASK_KNOWLEDGE_FAKE_INGEST_NO_RAW: '1' })
    await expect(finishIngestPipeline(ctx, { sidecarRuntimePath: sidecarHome }, root, {
      libraryId: created.id,
      tempPath: join(root, 'sample.md'),
      onStage: () => {},
    })).rejects.toMatchObject({ code: 'ingest-failed' })
    await writeFakeSidecarEnv(sidecarHome, { ASK_KNOWLEDGE_FAKE_INGEST_EXTRA: '1' })
    await expect(finishIngestPipeline(ctx, { sidecarRuntimePath: sidecarHome }, root, {
      libraryId: created.id,
      tempPath: join(root, 'sample.md'),
    })).rejects.toMatchObject({ code: 'ingest-failed' })
    await writeFakeSidecarEnv(sidecarHome, { ASK_KNOWLEDGE_FAKE_PROPOSE_NO_ID: '1' })
    const noId = await finishIngestPipeline(ctx, { sidecarRuntimePath: sidecarHome }, root, {
      libraryId: created.id,
      tempPath: join(root, 'sample.md'),
      reuseRawPath: 'raw/sample.md',
    })
    expect(noId).toMatchObject({
      status: 'failed',
      error: '整理词条没有产出可写入的提案。',
    })
    const rel = await writeTestProposal(vault, 'fixture', { id: 'fixture' })
    expect(rel).toContain('fixture.json')
    await mkdir(join(vault, 'raw'), { recursive: true })
    await writeFile(join(vault, 'raw', 'sample.md'), '# sample\n', 'utf8')
    expect(await readRawFile(vault, 'raw/sample.md')).toContain('sample')
    const bare = new Context()
    await expect(finishIngestPipeline(bare, { sidecarRuntimePath: sidecarHome }, root, {
      libraryId: created.id,
      tempPath: join(root, 'sample.md'),
      reuseRawPath: 'raw/sample.md',
    })).rejects.toMatchObject({ code: 'credentials-missing' })
    await expect(finishIngestPipeline(ctx, { sidecarRuntimePath: sidecarHome }, root, {
      libraryId: created.id,
      tempPath: join(root, 'sample.md'),
      reuseRawPath: 'raw/foo\0.md',
    })).rejects.toMatchObject({ code: 'path-escape' })
    await writeFakeSidecarEnv(sidecarHome, { ASK_KNOWLEDGE_FAKE_PROPOSE_CAMEL: '1' })
    const stages: string[] = []
    const applied = await finishIngestPipeline(ctx, { sidecarRuntimePath: sidecarHome }, root, {
      libraryId: created.id,
      tempPath: join(root, 'sample.md'),
      reuseRawPath: 'raw/sample.md',
      onStage: (stage) => { stages.push(stage) },
    })
    expect(applied.status).toBe('applied')
    expect(stages).toEqual(['proposing', 'applying'])
    await writeFakeSidecarEnv(sidecarHome, { ASK_KNOWLEDGE_FAKE_APPLY: 'deferred-snake' })
    const snake = await finishIngestPipeline(ctx, { sidecarRuntimePath: sidecarHome }, root, {
      libraryId: created.id,
      tempPath: join(root, 'sample.md'),
      reuseRawPath: 'raw/sample.md',
    })
    expect(snake.status).toBe('deferred')
    await writeFakeSidecarEnv(sidecarHome, { ASK_KNOWLEDGE_FAKE_APPLY: 'deferred-camel' })
    const camelApply = await finishIngestPipeline(ctx, { sidecarRuntimePath: sidecarHome }, root, {
      libraryId: created.id,
      tempPath: join(root, 'sample.md'),
      reuseRawPath: 'raw/sample.md',
    })
    expect(camelApply).toMatchObject({ status: 'deferred', deferredCount: 2 })
    await writeFakeSidecarEnv(sidecarHome, { ASK_KNOWLEDGE_FAKE_APPLY: 'deferred-empty' })
    const emptyDeferred = await finishIngestPipeline(ctx, { sidecarRuntimePath: sidecarHome }, root, {
      libraryId: created.id,
      tempPath: join(root, 'sample.md'),
      reuseRawPath: 'raw/sample.md',
    })
    expect(emptyDeferred.status).toBe('deferred')
    await writeFakeSidecarEnv(sidecarHome, {
      ASK_KNOWLEDGE_FAKE_PROPOSE_CAMEL: '1',
      ASK_KNOWLEDGE_FAKE_PROPOSAL_ID: 'prop-camel',
    })
    const camel = await reproposeAfterApplyFailure(
      ctx,
      { sidecarRuntimePath: sidecarHome },
      vault,
      'raw/sample.md',
      'prop-old',
    )
    expect(camel).toBe('prop-camel')
  })
})
