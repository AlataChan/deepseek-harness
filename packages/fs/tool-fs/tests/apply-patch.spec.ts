import { SessionId } from '@deepseek-ai/dsh-session'
import { mountDirectoryFixture, createDirectoryFixtureAgent } from '@deepseek-ai/dsh-working-directory-testkit'
/**
 * Guarded apply_patch over the filesystem seam: observation, sandbox,
 * delete, move, partial commit, and cancellation.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { dirname, join as joinPath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SCHEMA, Type, load } from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'
import type { PtcRunRequest, PtcRunResult } from '@deepseek-ai/dsh-ptc-runtime'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { FsError } from '@deepseek-ai/dsh-fs'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import ToolRuntime, { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import { presentPatchResult } from '../src/apply-patch-presentation.ts'

const repoRoot = joinPath(dirname(fileURLToPath(import.meta.url)), '../../../..')
const compositions = [
  'packages/bundle/base/cordis.patch.yml',
  'packages/bundle/headless/cordis.patch.yml',
  'packages/bundle/desktop-app/cordis.patch.yml',
  'packages/bundle/web-app/presets/standard.patch.yml',
  'packages/experimental/session-decisions/preset.cordis.yml',
]

function patch(...lines: string[]): string {
  return ['*** Begin Patch', ...lines, '*** End Patch'].join('\n')
}

function pluginBlocks(source: string): string[] {
  const lines = source.split('\n')
  const starts = lines.flatMap((line, index) => /^\s*- id:/.test(line) ? [index] : [])
  return starts.map((start, index) => lines.slice(start, starts[index + 1] ?? lines.length).join('\n'))
}

function disablesObservationPolicy(source: string): boolean {
  return pluginBlocks(source).some(block =>
    /^\s*- id:\s*fs-observation-policy\s*$/m.test(block) && /^\s*disabled:\s*true\s*$/m.test(block))
}

function enablesApplyPatch(source: string): boolean {
  return pluginBlocks(source).some(block =>
    /^\s*- id:\s*tool-fs\s*$/m.test(block) && /applyPatch:\s*true\b/.test(block))
}

const compositionSchema = DEFAULT_SCHEMA.extend([
  new Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (data: string) => data }),
])

function collectPlugins(value: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const item of value) collectPlugins(item, found)
    return found
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.id === 'string') found.push(record)
    for (const child of Object.values(record)) collectPlugins(child, found)
  }
  return found
}

/** Resolved composition facts. Schema defaults alone do not prove a shipped file. */
function compositionViolations(source: string): string[] {
  const plugins = collectPlugins(load(source, { schema: compositionSchema }))
  const violations: string[] = []
  for (const plugin of plugins) {
    if (plugin.id === 'fs-observation-policy' && plugin.disabled === true) violations.push('fs-observation-policy disabled')
    if (plugin.id === 'tool-fs') {
      const raw = plugin.config
      const config = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as { applyPatch?: boolean }
        : {}
      if (ToolFs.Config(config).applyPatch !== false) violations.push('applyPatch enabled')
    }
  }
  return violations
}

class LaterText extends LocalFileSystem {
  armed = false
  seen = 0
  later = ''

  override async readText(
    ...args: Parameters<LocalFileSystem['readText']>
  ): ReturnType<LocalFileSystem['readText']> {
    if (!this.armed) return super.readText(...args)
    this.seen += 1
    if (this.seen >= 2 && this.later !== '') return this.later
    return super.readText(...args)
  }
}

class BinaryText extends LocalFileSystem {
  override readText(): Promise<string> {
    return Promise.resolve('a\0b\n')
  }
}

class PublishThenIo extends LocalFileSystem {
  override async writeText(
    ...args: Parameters<LocalFileSystem['writeText']>
  ): ReturnType<LocalFileSystem['writeText']> {
    await super.writeText(...args)
    throw new FsError('disk full', 'FS_IO_ERROR')
  }
}

class StatFailsAfterWrite extends LocalFileSystem {
  fail = false

  override async stat(
    ...args: Parameters<LocalFileSystem['stat']>
  ): ReturnType<LocalFileSystem['stat']> {
    if (this.fail) throw new FsError('stat failed', 'FS_IO_ERROR')
    return super.stat(...args)
  }

  override async writeText(
    ...args: Parameters<LocalFileSystem['writeText']>
  ): ReturnType<LocalFileSystem['writeText']> {
    await super.writeText(...args)
    this.fail = true
    throw new FsError('disk full', 'FS_IO_ERROR')
  }
}

/** In-process PTC runtime that invokes the real registry bindings. */
class PatchRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'fake'
  behavior: (request: PtcRunRequest) => Promise<PtcRunResult> = () => Promise.resolve({ logs: [] })

  resolve(request: PtcRunRequest) {
    return { ...request, cwd: request.cwd ?? dir, timeoutMs: request.timeoutMs ?? 120_000 }
  }

  run(request: PtcRunRequest): Promise<PtcRunResult> {
    return this.behavior(request)
  }
}

class AbortingFs extends LocalFileSystem {
  writes = 0
  mode: 'commit' | 'abort-after' | 'abort-instead' | 'fail-second' = 'commit'
  controller = new AbortController()

  override async writeText(
    ...args: Parameters<LocalFileSystem['writeText']>
  ): ReturnType<LocalFileSystem['writeText']> {
    this.writes += 1
    if (this.mode === 'abort-instead') throw new FsError('write aborted', 'FS_ABORTED')
    if (this.mode === 'fail-second' && this.writes === 2) throw new FsError('disk full', 'FS_IO_ERROR')
    const result = await super.writeText(...args)
    if (this.mode === 'abort-after') this.controller.abort()
    return result
  }
}

let dir: string
let fiber: Awaited<ReturnType<Context['plugin']>> | undefined

afterEach(async () => {
  await fiber?.dispose()
  fiber = undefined
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
})

async function mount(
  fs: typeof LocalFileSystem = LocalFileSystem,
  options?: { policy?: boolean },
): Promise<{ ctx: Context; session: { header: { cwd: string } } }> {
  dir = await mkdtemp(join(tmpdir(), 'dsh-apply-patch-'))
  const ctx = new Context()
  const session = { header: { cwd: dir } }
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(fs, { cwd: dir })
  if (options?.policy !== false) await ctx.plugin(FsPolicy)
  await mountDirectoryFixture(ctx, dir)
  fiber = await ctx.plugin(ToolFs, { applyPatch: true })
  return { ctx, session }
}

const realActors = new WeakMap<object, ReturnType<typeof createDirectoryFixtureAgent>>()
let actorSequence = 0
function fixtureAgent(ctx: Context, session: object): ReturnType<typeof createDirectoryFixtureAgent> {
  let actor = realActors.get(session)
  if (actor === undefined) {
    actor = createDirectoryFixtureAgent(ctx, SessionId(`patch-${++actorSequence}`), dir)
    realActors.set(session, actor)
  }
  return actor
}

async function call(ctx: Context, session: object, input: string, signal?: AbortSignal) {
  return ctx.tools.execute({
    signal: signal ?? new AbortController().signal,
    callId: ToolCallId(`call-${Math.random().toString(16).slice(2)}`),
    name: 'apply_patch',
    arguments: { input },
    agent: await fixtureAgent(ctx, session),
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('apply_patch activation', () => {
  it('stays unregistered unless the composition sets applyPatch', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-apply-patch-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: dir })
    await mountDirectoryFixture(ctx, dir)
    fiber = await ctx.plugin(ToolFs)
    expect(ctx.tools.get('apply_patch')).toBeUndefined()
    await fiber.dispose()
    await mountDirectoryFixture(ctx, dir)
    fiber = await ctx.plugin(ToolFs, { applyPatch: false })
    expect(ctx.tools.get('apply_patch')).toBeUndefined()
  })

  it('fails when a composition disables observation policy or turns apply_patch on by default', () => {
    const copied = [
      '- id: fs-observation-policy',
      '  name: x',
      '  disabled: true',
      '- id: tool-fs',
      '  config:',
      '    applyPatch: true',
    ].join('\n')
    expect(disablesObservationPolicy(copied)).toBe(true)
    expect(enablesApplyPatch(copied)).toBe(true)
    for (const relative of compositions) {
      const source = readFileSync(joinPath(repoRoot, relative), 'utf8')
      expect(disablesObservationPolicy(source), relative).toBe(false)
      expect(enablesApplyPatch(source), relative).toBe(false)
      expect(compositionViolations(source), relative).toEqual([])
    }
  })

  it('rejects a nested composition that disables observation and enables apply_patch', () => {
    const imported = [
      'preset:',
      '  plugins:',
      '    - id: fs-observation-policy',
      '      disabled: true',
      '    - id: tool-fs',
      '      config:',
      '        applyPatch: true',
    ].join('\n')
    expect(compositionViolations(imported)).toEqual(['fs-observation-policy disabled', 'applyPatch enabled'])
    expect(ToolFs.Config({}).applyPatch).toBe(false)
  })
})

describe('apply_patch commits', () => {
  it('creates a file and updates another only after it was read', async () => {
    const { ctx, session } = await mount()
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    const created = await call(ctx, session, patch('*** Add File: created.txt', '+fresh'))
    expect(created.isError).toBe(false)
    expect(await readFile(join(dir, 'created.txt'), 'utf8')).toBe('fresh\n')
    expect(text(created)).toContain('Success. Updated the following files:')
    expect(text(created)).toContain('A ')

    const unread = await call(ctx, session, patch('*** Update File: notes.txt', '@@', '-hello', '+hi'))
    expect(unread.isError).toBe(true)
    expect(unread.error).toMatchObject({ info: { code: 'FS_NOT_OBSERVED' } })
    expect(text(unread)).toContain('file has not been read')
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('hello\n')
  })

  it('rejects a syntax error, a missing file, a mismatched hunk, and a stale read without writing', async () => {
    const { ctx, session } = await mount()
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    const syntax = await call(ctx, session, 'not a patch')
    expect(syntax.isError).toBe(true)
    expect(syntax.error).toMatchObject({ info: { code: 'PATCH_SYNTAX' } })

    const missing = await call(ctx, session, patch('*** Update File: absent.txt', '@@', '-x', '+y'))
    expect(missing.isError).toBe(true)
    expect(missing.error).toMatchObject({ info: { code: 'FS_NOT_OBSERVED' } })

    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read'),
      name: 'read',
      arguments: { file_path: 'notes.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    const mismatch = await call(ctx, session, patch('*** Update File: notes.txt', '@@', '-goodbye', '+hi'))
    expect(mismatch.isError).toBe(true)
    expect(mismatch.error).toMatchObject({ info: { code: 'FS_PATCH_MISMATCH' } })
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('hello\n')

    await writeFile(join(dir, 'notes.txt'), 'changed\n')
    const stale = await call(ctx, session, patch('*** Update File: notes.txt', '@@', '-hello', '+hi'))
    expect(stale.isError).toBe(true)
    expect(stale.error).toMatchObject({ info: { code: 'FS_STALE_VERSION' } })
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('changed\n')
  })

  it('applies an observed update and presents the applied diff', async () => {
    const { ctx, session } = await mount()
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read-notes'),
      name: 'read',
      arguments: { file_path: 'notes.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    const updated = await call(ctx, session, patch('*** Update File: notes.txt', '@@', '-hello', '+hi'))
    expect(updated.isError).toBe(false)
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('hi\n')
    expect(text(updated)).toContain('M ')
    const view = ctx.tools.get('apply_patch')?.presentCall?.({ input: patch('*** Update File: notes.txt', '@@', '-hi', '+yo') })
    expect(view).toMatchObject({ card: 'diff', locations: [{ path: 'notes.txt' }] })
    const applied = ctx.tools.get('apply_patch')?.presentResult?.({ input: '' }, updated)
    expect(applied).toMatchObject({ card: 'diff', title: 'Apply patch' })
  })

  it('keeps the first write when a later write fails and does not retry it', async () => {
    const { ctx, session } = await mount(AbortingFs)
    const fs = ctx.fs as AbortingFs
    fs.mode = 'fail-second'
    const partial = await call(ctx, session, patch(
      '*** Add File: kept.txt', '+one',
      '*** Add File: dropped.txt', '+two',
    ))
    expect(partial.isError).toBe(false)
    expect(text(partial)).toContain('Patch stopped after 1 of 2 operations.')
    expect(text(partial)).toContain('Failed:')
    expect(await readFile(join(dir, 'kept.txt'), 'utf8')).toBe('one\n')
    await expect(readFile(join(dir, 'dropped.txt'), 'utf8')).rejects.toThrow()
    expect(fs.writes).toBe(2)
  })

  it('refuses symlink delete and move, an unread delete, and a move onto the same file', async () => {
    const { ctx, session } = await mount()
    await writeFile(join(dir, 'real.txt'), 'hello\n')
    await symlink('real.txt', join(dir, 'link.txt'))
    await mkdir(join(dir, 'folder'))
    await symlink('folder', join(dir, 'folder-link'))
    const linked = await call(ctx, session, patch('*** Delete File: link.txt'))
    expect(linked.isError).toBe(true)
    expect(linked.error).toMatchObject({ info: { code: 'PATCH_SYMLINK_SOURCE' } })
    const linkedDir = await call(ctx, session, patch('*** Delete File: folder-link'))
    expect(linkedDir.isError).toBe(true)
    expect(linkedDir.error).toMatchObject({ info: { code: 'PATCH_SYMLINK_SOURCE' } })
    expect(await readFile(join(dir, 'real.txt'), 'utf8')).toBe('hello\n')

    const movedLink = await call(ctx, session, patch(
      '*** Update File: link.txt', '*** Move to: other.txt', '@@', '-hello', '+hi',
    ))
    expect(movedLink.isError).toBe(true)
    expect(movedLink.error).toMatchObject({ info: { code: 'PATCH_SYMLINK_SOURCE' } })

    const unread = await call(ctx, session, patch('*** Delete File: real.txt'))
    expect(unread.isError).toBe(true)
    expect(unread.error).toMatchObject({ info: { code: 'FS_NOT_OBSERVED' } })
    expect(await readFile(join(dir, 'real.txt'), 'utf8')).toBe('hello\n')

    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read-real-link'),
      name: 'read',
      arguments: { file_path: 'real.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    await writeFile(join(dir, 'dest.txt'), 'dest\n')
    await symlink('dest.txt', join(dir, 'dest-link'))
    const ontoLink = await call(ctx, session, patch(
      '*** Update File: real.txt', '*** Move to: dest-link', '@@', '-hello', '+hi',
    ))
    expect(ontoLink.isError).toBe(true)
    expect(ontoLink.error).toMatchObject({ info: { code: 'PATCH_SYMLINK_SOURCE' } })
    expect(await readFile(join(dir, 'dest.txt'), 'utf8')).toBe('dest\n')
    expect(await readFile(join(dir, 'real.txt'), 'utf8')).toBe('hello\n')
    await writeFile(join(dir, 'add-real.txt'), 'add\n')
    await symlink('add-real.txt', join(dir, 'add-link'))
    const addLink = await call(ctx, session, patch('*** Add File: add-link', '+nope'))
    expect(addLink.isError).toBe(true)
    expect(addLink.error).toMatchObject({ info: { code: 'PATCH_SYMLINK_SOURCE' } })
    expect(await readFile(join(dir, 'add-real.txt'), 'utf8')).toBe('add\n')

    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read-real'),
      name: 'read',
      arguments: { file_path: 'real.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    const same = await call(ctx, session, patch(
      '*** Update File: real.txt', '*** Move to: real.txt', '@@', '-hello', '+hi',
    ))
    expect(same.isError).toBe(true)
    expect(same.error).toMatchObject({ info: { code: 'FS_SAME_TARGET' } })
    expect(await readFile(join(dir, 'real.txt'), 'utf8')).toBe('hello\n')
  })

  it('keeps CRLF endings when a hunk updates or moves a CRLF file', async () => {
    const { ctx, session } = await mount()
    await writeFile(join(dir, 'notes.txt'), 'hello\r\n')
    await writeFile(join(dir, 'move.txt'), 'move me\r\n')
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read-crlf'),
      name: 'read',
      arguments: { file_path: 'notes.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read-crlf-move'),
      name: 'read',
      arguments: { file_path: 'move.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    const updated = await call(ctx, session, patch('*** Update File: notes.txt', '@@', '-hello', '+hi'))
    expect(updated.isError).toBe(false)
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('hi\r\n')
    const moved = await call(ctx, session, patch(
      '*** Update File: move.txt', '*** Move to: moved.txt', '@@', '-move me', '+moved',
    ))
    expect(moved.isError).toBe(false)
    expect(await readFile(join(dir, 'moved.txt'), 'utf8')).toBe('moved\r\n')
  })

  it('rejects a binary update and an unmatched hunk before writing', async () => {
    const { ctx, session } = await mount()
    await writeFile(join(dir, 'bin.txt'), 'a\0b\n')
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read-bin'),
      name: 'read',
      arguments: { file_path: 'bin.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read-notes-mismatch'),
      name: 'read',
      arguments: { file_path: 'notes.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    const binary = await call(ctx, session, patch('*** Update File: bin.txt', '@@', '-a', '+b'))
    expect(binary.isError).toBe(true)
    expect(binary.error).toMatchObject({ info: { code: 'FS_NOT_OBSERVED' } })
    const mismatch = await call(ctx, session, patch('*** Update File: notes.txt', '@@', '-missing', '+x'))
    expect(mismatch.isError).toBe(true)
    expect(mismatch.error).toMatchObject({ info: { code: 'FS_PATCH_MISMATCH' } })
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('hello\n')
  })

  it('states patch guidance only while apply_patch is visible', async () => {
    const { ctx } = await mount()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Prefer apply_patch')
    const key = {}
    let scope!: ReturnType<typeof createScope>
    await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, key) },
      { inject: ['tools', 'systemPrompt'] }))
    scope.ctx.tools.restrict({ deny: ['apply_patch'] })
    try {
      expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: key }))).not.toContain('Prefer apply_patch')
    } finally {
      await scope.dispose()
    }
  })

  it('deletes an observed file and moves another to a new path', async () => {
    const { ctx, session } = await mount()
    await writeFile(join(dir, 'real.txt'), 'hello\n')
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read-delete'),
      name: 'read',
      arguments: { file_path: 'real.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read-move'),
      name: 'read',
      arguments: { file_path: 'notes.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    const removed = await call(ctx, session, patch('*** Delete File: real.txt'))
    expect(removed.isError).toBe(false)
    expect(text(removed)).toContain('D ')
    await expect(readFile(join(dir, 'real.txt'), 'utf8')).rejects.toThrow()
    const removedView = ctx.tools.get('apply_patch')?.presentResult?.({ input: '' }, removed)
    expect(removedView).toMatchObject({ card: 'diff', diffs: [{ oldText: 'hello\n', newText: '' }] })

    const moved = await call(ctx, session, patch(
      '*** Update File: notes.txt', '*** Move to: other.txt', '@@', '-hello', '+hi',
    ))
    expect(moved.isError).toBe(false)
    expect(await readFile(join(dir, 'other.txt'), 'utf8')).toBe('hi\n')
    await expect(readFile(join(dir, 'notes.txt'), 'utf8')).rejects.toThrow()
  })

  it('refuses a move onto an unread existing file and changes neither file', async () => {
    const { ctx, session } = await mount()
    await writeFile(join(dir, 'real.txt'), 'hello\n')
    await writeFile(join(dir, 'other.txt'), 'kept\n')
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read-conflict'),
      name: 'read',
      arguments: { file_path: 'real.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    const conflict = await call(ctx, session, patch(
      '*** Update File: real.txt', '*** Move to: other.txt', '@@', '-hello', '+hi',
    ))
    expect(conflict.isError).toBe(true)
    expect(conflict.error).toMatchObject({ info: { code: 'FS_NOT_OBSERVED' } })
    expect(await readFile(join(dir, 'real.txt'), 'utf8')).toBe('hello\n')
    expect(await readFile(join(dir, 'other.txt'), 'utf8')).toBe('kept\n')
  })

  it('keeps a published move destination when source removal fails', async () => {
    const { ctx, session } = await mount()
    await writeFile(join(dir, 'real.txt'), 'hello\n')
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read-partial'),
      name: 'read',
      arguments: { file_path: 'real.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    const local = ctx.fs as LocalFileSystem
    local.internals.removeFile = async () => {
      throw new FsError('cannot delete "real.txt": disk', 'FS_IO_ERROR')
    }
    const moved = await call(ctx, session, patch(
      '*** Update File: real.txt', '*** Move to: other.txt', '@@', '-hello', '+hi',
    ))
    expect(moved.isError).toBe(false)
    expect(text(moved)).toContain('was written; source')
    expect(text(moved)).toContain('real.txt remains')
    expect(await readFile(join(dir, 'other.txt'), 'utf8')).toBe('hi\n')
    expect(await readFile(join(dir, 'real.txt'), 'utf8')).toBe('hello\n')
  })

  it('reports an aborted delete as unknown and leaves the file', async () => {
    const { ctx, session } = await mount(class extends LocalFileSystem {
      override async deleteFile(): Promise<never> {
        throw new FsError('delete aborted', 'FS_ABORTED')
      }
    })
    await writeFile(join(dir, 'real.txt'), 'hello\n')
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read-abort-delete'),
      name: 'read',
      arguments: { file_path: 'real.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    const aborted = await call(ctx, session, patch('*** Delete File: real.txt'))
    expect(aborted.isError).toBe(false)
    expect(text(aborted)).toContain('Outcome unknown:')
    expect(text(aborted)).toContain('re-read the affected files before retrying')
    expect(await readFile(join(dir, 'real.txt'), 'utf8')).toBe('hello\n')
  })

  it('reports a missing file after a read recorded it and the file was removed', async () => {
    const { ctx, session } = await mount()
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read-gone'),
      name: 'read',
      arguments: { file_path: 'notes.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    await unlink(join(dir, 'notes.txt'))
    const missing = await call(ctx, session, patch('*** Update File: notes.txt', '@@', '-hello', '+hi'))
    expect(missing.isError).toBe(true)
    expect(missing.error).toMatchObject({ info: { code: 'FS_NOT_FOUND' } })
  })

  it('stops after the first write when the call is cancelled and does not retry an aborted write', async () => {
    const { ctx, session } = await mount(AbortingFs)
    const fs = ctx.fs as AbortingFs
    fs.mode = 'abort-after'
    const cancelled = await call(ctx, session, patch(
      '*** Add File: first.txt', '+one',
      '*** Add File: second.txt', '+two',
    ), fs.controller.signal)
    expect(cancelled.isError).toBe(true)
    expect(cancelled.error).toMatchObject({ info: { code: 'ABORTED' } })
    expect(text(cancelled)).toContain('tool call aborted')
    expect(text(cancelled)).toContain('first.txt')
    expect(text(cancelled)).toContain('Not executed:')
    expect(text(cancelled)).not.toContain('Success.')
    expect(cancelled.meta).toMatchObject({
      stopped: true,
      diffs: [expect.objectContaining({ oldText: null, newText: 'one\n' })],
    })
    expect(presentPatchResult(cancelled)?.title).toBe('Apply patch (stopped)')
    expect(await readFile(join(dir, 'first.txt'), 'utf8')).toBe('one\n')
    await expect(readFile(join(dir, 'second.txt'), 'utf8')).rejects.toThrow()
    expect(fs.writes).toBe(1)

    fs.mode = 'abort-instead'
    fs.writes = 0
    const unknown = await call(ctx, session, patch('*** Add File: third.txt', '+three'), new AbortController().signal)
    expect(unknown.isError).toBe(false)
    expect(text(unknown)).toContain('Outcome unknown:')
    expect(text(unknown)).toContain('re-read the affected files before retrying')
    await expect(readFile(join(dir, 'third.txt'), 'utf8')).rejects.toThrow()
    expect(fs.writes).toBe(1)
  })

  it('keeps applied diff metadata when a PTC apply_patch is cancelled', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-apply-patch-'))
    const ctx = new Context()
    const dispatched: {
      type: string
      payload: {
        isError?: boolean
        error?: { code?: string }
        meta?: JsonValue
        content?: ContentBlock[]
      }
    }[] = []
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'ptc' })
    await ctx.plugin(PatchRuntime)
    await ctx.plugin(AbortingFs, { cwd: dir })
    await ctx.plugin(FsPolicy)
    await mountDirectoryFixture(ctx, process.cwd())
    fiber = await ctx.plugin(ToolFs, { applyPatch: true })
    const fs = ctx.fs as AbortingFs
    fs.mode = 'abort-after'
    const runtime = ctx.ptcRuntime as PatchRuntime
    runtime.behavior = async (request) => {
      const apply = request.bindings[0]?.functions.apply_patch
      if (apply === undefined) throw new Error('apply_patch was not bound')
      await apply({
        input: patch('*** Add File: first.txt', '+one', '*** Add File: second.txt', '+two'),
      })
      return { logs: [] }
    }
    const agent = await createDirectoryFixtureAgent(ctx, SessionId('ptc-cancel'), dir)
    ctx.on('session/event', (session, event) => {
      if (session !== agent.session || event.type !== 'tool/ptc-dispatch') return
      dispatched.push({ type: event.type, payload: event.data })
    })
    const outer = await ctx.tools.execute({
      signal: fs.controller.signal,
      callId: ToolCallId('call-ptc-cancel'),
      name: RUN_CODE_NAME,
      arguments: { code: 'await tools.apply_patch({ input })', description: 'Apply a patch' },
      agent: agent,
    })
    const settled = dispatched.find(event => event.type === 'tool/ptc-dispatch' && event.payload.meta !== undefined)
    expect(settled?.payload.isError).toBe(true)
    expect(settled?.payload.error?.code).toBe('ABORTED')
    expect(settled?.payload.meta).toMatchObject({
      stopped: true,
      diffs: [expect.objectContaining({ oldText: null, newText: 'one\n' })],
    })
    const body = settled?.payload.content?.flatMap(block => block.type === 'text' ? [block.text] : []).join('') ?? ''
    expect(body).toContain('tool call aborted')
    expect(body).not.toContain('Success.')
    if (settled === undefined) throw new Error('expected the cancelled PTC dispatch')
    const meta = settled.payload.meta
    expect(meta).toBeDefined()
    if (meta === undefined) throw new Error('expected applied diff metadata')
    expect(presentPatchResult({
      content: settled.payload.content ?? [],
      isError: true,
      meta,
    })?.title).toBe('Apply patch (stopped)')
    expect(outer.isError).toBe(true)
    expect(text(outer)).not.toContain('Success.')
    expect(await readFile(join(dir, 'first.txt'), 'utf8')).toBe('one\n')
    await expect(readFile(join(dir, 'second.txt'), 'utf8')).rejects.toThrow()
  })

  it('maps a read-only sandbox denial and leaves the file absent', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-apply-patch-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SandboxPolicyService, { mode: 'read-only', workspaceRoot: dir })
    await ctx.plugin(SandboxedFileSystem, { cwd: dir })
    await ctx.plugin(FsPolicy)
    await mountDirectoryFixture(ctx, process.cwd())
    fiber = await ctx.plugin(ToolFs, { applyPatch: true })
    const denied = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-sandbox'),
      name: 'apply_patch',
      arguments: { input: patch(
        '*** Add File: blocked.txt', '+no',
        '*** Add File: later.txt', '+later',
      ) },
    })
    expect(denied.isError).toBe(true)
    expect(denied.error).toMatchObject({ info: { code: 'FS_SANDBOX_DENIED' } })
    expect(text(denied)).toContain('[sandbox: file access denied under read-only mode]')
    await expect(readFile(join(dir, 'blocked.txt'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(dir, 'later.txt'), 'utf8')).rejects.toThrow()
  })

  it('accepts an empty patch and reports that nothing ran', async () => {
    const { ctx, session } = await mount()
    const empty = await call(ctx, session, patch())
    expect(empty.isError).toBe(false)
    expect(text(empty)).toBe('Success. No operations in patch.')
  })

  it('moves onto a destination created earlier in the same patch', async () => {
    const { ctx, session } = await mount()
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read-move-dest'),
      name: 'read',
      arguments: { file_path: 'notes.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    const moved = await call(ctx, session, patch(
      '*** Add File: dest.txt', '+one',
      '*** Update File: notes.txt', '*** Move to: dest.txt', '@@', '-hello', '+hi',
    ))
    expect(moved.isError).toBe(false)
    expect(await readFile(join(dir, 'dest.txt'), 'utf8')).toBe('hi\n')
    await expect(readFile(join(dir, 'notes.txt'), 'utf8')).rejects.toThrow()
  })

  it('applies a second edit of the same file from the simulated text', async () => {
    const { ctx, session } = await mount()
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read-twice'),
      name: 'read',
      arguments: { file_path: 'notes.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    const updated = await call(ctx, session, patch(
      '*** Update File: notes.txt', '@@', '-hello', '+hi',
      '*** Update File: notes.txt', '@@', '-hi', '+hey',
    ))
    expect(updated.isError).toBe(false)
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('hey\n')
  })

  it('refuses a directory before writing when no observation policy is mounted', async () => {
    const { ctx, session } = await mount(LocalFileSystem, { policy: false })
    await mkdir(join(dir, 'folder'))
    const directory = await call(ctx, session, patch('*** Delete File: folder'))
    expect(directory.isError).toBe(true)
    expect(directory.error).toMatchObject({ info: { code: 'FS_NOT_REGULAR_FILE' } })
  })

  it('refuses two paths whose parent is a file before writing', async () => {
    const { ctx, session } = await mount()
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    const nested = await call(ctx, session, patch(
      '*** Add File: notes.txt/a.txt', '+a',
      '*** Add File: notes.txt/b.txt', '+b',
    ))
    expect(nested.isError).toBe(true)
    expect(nested.error).toMatchObject({ info: { code: 'FS_NOT_FOUND' } })
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('hello\n')
  })

  it('refuses a move onto a destination that changed or disappeared after it was read', async () => {
    const { ctx, session } = await mount()
    await writeFile(join(dir, 'real.txt'), 'hello\n')
    await writeFile(join(dir, 'other.txt'), 'kept\n')
    await writeFile(join(dir, 'gone.txt'), 'bye\n')
    for (const file of ['real.txt', 'other.txt', 'gone.txt']) {
      await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId(`call-read-${file}`),
        name: 'read',
        arguments: { file_path: file },
        agent: await fixtureAgent(ctx, session),
      })
    }
    await writeFile(join(dir, 'other.txt'), 'changed\n')
    const stale = await call(ctx, session, patch(
      '*** Update File: real.txt', '*** Move to: other.txt', '@@', '-hello', '+hi',
    ))
    expect(stale.isError).toBe(true)
    expect(stale.error).toMatchObject({ info: { code: 'FS_STALE_VERSION' } })
    expect(await readFile(join(dir, 'real.txt'), 'utf8')).toBe('hello\n')
    expect(await readFile(join(dir, 'other.txt'), 'utf8')).toBe('changed\n')
    await unlink(join(dir, 'gone.txt'))
    const missing = await call(ctx, session, patch(
      '*** Update File: real.txt', '*** Move to: gone.txt', '@@', '-hello', '+hi',
    ))
    expect(missing.isError).toBe(true)
    expect(missing.error).toMatchObject({ info: { code: 'FS_STALE_VERSION' } })
    expect(await readFile(join(dir, 'real.txt'), 'utf8')).toBe('hello\n')
  })

  it('truncates a long unmatched hunk in the model diagnostic', async () => {
    const { ctx, session } = await mount()
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read-long'),
      name: 'read',
      arguments: { file_path: 'notes.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    const line = 'a'.repeat(90)
    const mismatch = await call(ctx, session, patch('*** Update File: notes.txt', '@@', `-${line}`, '+b'))
    expect(mismatch.isError).toBe(true)
    expect(mismatch.error).toMatchObject({ info: { code: 'FS_PATCH_MISMATCH' } })
    expect(text(mismatch)).toContain('…')
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('hello\n')
  })

  it('moves a file without hunks and checks a symlink path when the call has no session cwd', async () => {
    const { ctx, session } = await mount()
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    await symlink(join(dir, 'notes.txt'), join(dir, 'link.txt'))
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read-move-plain'),
      name: 'read',
      arguments: { file_path: 'notes.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    const moved = await call(ctx, session, patch(
      '*** Update File: notes.txt', '*** Move to: other.txt', '@@', '-hello', '+hello',
    ))
    expect(moved.isError).toBe(false)
    expect(await readFile(join(dir, 'other.txt'), 'utf8')).toBe('hello\n')
    const unscoped = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-no-session'),
      name: 'apply_patch',
      arguments: { input: patch('*** Delete File: link.txt') },
    })
    expect(unscoped.isError).toBe(true)
    expect(unscoped.error).toMatchObject({ info: { code: 'PATCH_SYMLINK_SOURCE' } })
  })

  it('applies an update and an add without observation policy, and refuses binary text', async () => {
    const { ctx, session } = await mount(LocalFileSystem, { policy: false })
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    const updated = await call(ctx, session, patch(
      '*** Update File: notes.txt', '@@', '-hello', '+hi',
      '*** Add File: created.txt', '+new',
      '*** Update File: created.txt', '*** Move to: moved.txt', '@@', '-new', '+new',
    ))
    expect(updated.isError).toBe(false)
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('hi\n')
    expect(await readFile(join(dir, 'moved.txt'), 'utf8')).toBe('new\n')
  })

  it('refuses binary text returned by a provider that does not reject it itself', async () => {
    const { ctx, session } = await mount(BinaryText, { policy: false })
    await writeFile(join(dir, 'bin.txt'), 'hello\n')
    const binary = await call(ctx, session, patch('*** Update File: bin.txt', '@@', '-hello', '+hi'))
    expect(binary.isError).toBe(true)
    expect(binary.error).toMatchObject({ info: { code: 'FS_NOT_TEXT' } })
  })

  it('reports binary text and a changed file discovered after preflight', async () => {
    const { ctx, session } = await mount(LaterText)
    const fs = ctx.fs as LaterText
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    await writeFile(join(dir, 'move.txt'), 'move me\n')
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read-later-notes'),
      name: 'read',
      arguments: { file_path: 'notes.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    fs.armed = true
    fs.later = 'a\0b'
    const binary = await call(ctx, session, patch('*** Update File: notes.txt', '@@', '-hello', '+hi'))
    expect(binary.isError).toBe(true)
    expect(binary.error).toMatchObject({ info: { code: 'FS_NOT_TEXT' } })
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('hello\n')
    fs.seen = 0
    fs.later = 'goodbye\n'
    const updateMismatch = await call(ctx, session, patch('*** Update File: notes.txt', '@@', '-hello', '+hi'))
    expect(updateMismatch.isError).toBe(true)
    expect(updateMismatch.error).toMatchObject({ info: { code: 'FS_PATCH_MISMATCH' } })
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('hello\n')

    fs.armed = false
    fs.seen = 0
    fs.later = ''
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-read-later-move'),
      name: 'read',
      arguments: { file_path: 'move.txt' },
      agent: await fixtureAgent(ctx, session),
    })
    fs.armed = true
    fs.later = 'a\0b'
    fs.seen = 0
    const movedBinary = await call(ctx, session, patch(
      '*** Update File: move.txt', '*** Move to: moved.txt', '@@', '-move me', '+moved',
    ))
    expect(movedBinary.isError).toBe(true)
    expect(movedBinary.error).toMatchObject({ info: { code: 'FS_NOT_TEXT' } })
    expect(await readFile(join(dir, 'move.txt'), 'utf8')).toBe('move me\n')

    fs.seen = 0
    fs.later = 'goodbye\n'
    const mismatch = await call(ctx, session, patch(
      '*** Update File: move.txt', '*** Move to: moved.txt', '@@', '-move me', '+moved',
    ))
    expect(mismatch.isError).toBe(true)
    expect(mismatch.error).toMatchObject({ info: { code: 'FS_PATCH_MISMATCH' } })
    await expect(readFile(join(dir, 'moved.txt'), 'utf8')).rejects.toThrow()
  })

  it('names a published file as unknown when the provider then reports an IO failure', async () => {
    const { ctx, session } = await mount(PublishThenIo)
    const published = await call(ctx, session, patch('*** Add File: made.txt', '+made'))
    expect(published.isError).toBe(false)
    expect(text(published)).toContain('Outcome unknown:')
    expect(text(published)).toContain('re-read the affected files before retrying')
    expect(text(published)).not.toContain('Success.')
    expect(await readFile(join(dir, 'made.txt'), 'utf8')).toBe('made\n')
  })

  it('names the effect unknown when freshness cannot be rechecked after an IO failure', async () => {
    const { ctx, session } = await mount(StatFailsAfterWrite)
    const published = await call(ctx, session, patch('*** Add File: made.txt', '+made'))
    expect(published.isError).toBe(false)
    expect(text(published)).toContain('Outcome unknown:')
    expect(await readFile(join(dir, 'made.txt'), 'utf8')).toBe('made\n')
  })
})
