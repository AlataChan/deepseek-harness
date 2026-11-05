/** Local comparisons use actual Git and filesystem providers. */
import { access, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { git, harness, repository, testAgent } from './harness.ts'
import { DiffTooLarge, FilterConfigError, forkPoint, localChanges, localDiff, localText } from '../src/local-diff.ts'
const config = { gitCommand: 'git', gitTimeoutMs: 10_000, graceMs: 1_000, maxOutputBytes: 65_536, maxDiffBytes: 65_536, maxUntrackedFiles: 10 }
const signal = new AbortController().signal
let root: string | undefined
let ctx: Context | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  await ctx?.fiber.dispose()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  root = await repository(); ctx = await harness(root)
  const agent = await testAgent(ctx, root)
  return { root, ctx, agent }
}
describe('local diffs', () => {
  it('distinguishes index and working copy, includes untracked files, and preserves status', async () => {
    const f = await fixture()
    await writeFile(join(f.root, 'tracked.txt'), 'staged\n'); await git(f.root, 'add', 'tracked.txt')
    await writeFile(join(f.root, 'tracked.txt'), 'unstaged\n'); await writeFile(join(f.root, 'new.txt'), 'added\n')
    const before = await git(f.root, 'status', '--porcelain')
    const staged = await localDiff(f.ctx, config, f.agent.session, f.root, null, { kind: 'staged' }, signal)
    expect(staged.files[0]?.hunks[0]?.lines).toContain('+staged')
    expect(staged.files.some(file => file.path === 'new.txt')).toBe(false)
    const unstaged = await localDiff(f.ctx, config, f.agent.session, f.root, null, { kind: 'unstaged' }, signal)
    expect(unstaged.files[0]?.hunks[0]?.lines).toContain('-staged')
    expect(unstaged.files[0]?.hunks[0]?.lines).toContain('+unstaged')
    expect(unstaged.files.find(file => file.path === 'new.txt')?.untracked).toBe(true)
    expect(await git(f.root, 'status', '--porcelain')).toBe(before)
  })
  it('bounds all untracked text and metadata together', async () => {
    const f = await fixture()
    for (let index = 0; index < 5; index++) await writeFile(join(f.root, `file-${index}`), 'x'.repeat(500))
    await expect(localDiff(f.ctx, { ...config, maxDiffBytes: 2048 }, f.agent.session, f.root, null, { kind: 'uncommitted' }, signal))
      .rejects.toThrow('Complete local comparison exceeds maxDiffBytes')
  })
  it('rejects traversal and symbolic-link text previews', async () => {
    const f = await fixture(); await symlink(join(f.root, '.git/config'), join(f.root, 'linked'))
    await expect(localText(f.ctx, config, f.agent.session, f.root, { kind: 'uncommitted' }, '../outside', signal)).rejects.toThrow('inside the checkout')
    await expect(localText(f.ctx, config, f.agent.session, f.root, { kind: 'uncommitted' }, 'linked', signal)).rejects.toThrow('symbolic links')
  })
  it('reports binary and oversized untracked content without partial text', async () => {
    const f = await fixture(); await writeFile(join(f.root, 'binary'), Buffer.from([0, 1, 2])); await writeFile(join(f.root, 'large'), 'x'.repeat(4000))
    const diff = await localDiff(f.ctx, { ...config, maxDiffBytes: 1024 }, f.agent.session, f.root, null, { kind: 'uncommitted' }, signal)
    expect(diff.files.find(file => file.path === 'binary')?.binary).toBe(true)
    expect(diff.files.find(file => file.path === 'large')?.oversized).toBe(true)
  })
})

import { decodeText, parseDiff, parseNumstat, untrackedFile } from '../src/diff.ts'
/**
 * A `git diff` patch with a binary change, a pure rename, a quoted path, a path
 * with a space, a non-ASCII path, an empty new file, an addition without a final
 * newline, and a deletion.
 */
const PATCH = [
  'diff --git a/bin.dat b/bin.dat',
  'index bdc955b..8352675 100644',
  'Binary files a/bin.dat and b/bin.dat differ',
  'diff --git a/old.txt b/new.txt',
  'similarity index 100%',
  'rename from old.txt',
  'rename to new.txt',
  'diff --git "a/quo\\"te.txt" "b/quo\\"te.txt"',
  'index bca70f3..9e1ab28 100644',
  '--- "a/quo\\"te.txt"',
  '+++ "b/quo\\"te.txt"',
  '@@ -1 +1,2 @@',
  ' q',
  '+z',
  'diff --git a/with space.txt b/with space.txt',
  'index de98044..7be73ce 100644',
  '--- a/with space.txt\t',
  '+++ b/with space.txt\t',
  '@@ -1,3 +1,3 @@',
  ' a',
  '-b',
  '+B',
  ' c',
  'diff --git a/中文.md b/中文.md',
  'index 587be6b..975fbec 100644',
  '--- a/中文.md',
  '+++ b/中文.md',
  '@@ -1 +1 @@',
  '-x',
  '+y',
  'diff --git a/empty.txt b/empty.txt',
  'new file mode 100644',
  'index 0000000..e69de29',
  'diff --git a/nonl.txt b/nonl.txt',
  'new file mode 100644',
  'index 0000000..20cbb4d',
  '--- /dev/null',
  '+++ b/nonl.txt',
  '@@ -0,0 +1 @@',
  '+no newline',
  '\\ No newline at end of file',
  'diff --git a/gone.txt b/gone.txt',
  'deleted file mode 100644',
  'index 9e1ab28..0000000',
  '--- a/gone.txt',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-q',
  '-z',
  '',
].join('\n')

describe('parseDiff', () => {
  it('maps every section of a Git patch to a file with its status, counts, and hunks', () => {
    expect(parseDiff(PATCH).map(({ path, previousPath, status, binary, untracked, additions, deletions }) =>
      [path, previousPath, status, binary, untracked, additions, deletions])).toEqual([
      ['bin.dat', null, 'modified', true, false, 0, 0],
      ['new.txt', 'old.txt', 'renamed', false, false, 0, 0],
      ['quo"te.txt', null, 'modified', false, false, 1, 0],
      ['with space.txt', null, 'modified', false, false, 1, 1],
      ['中文.md', null, 'modified', false, false, 1, 1],
      ['empty.txt', null, 'added', false, false, 0, 0],
      ['nonl.txt', null, 'added', false, false, 1, 0],
      ['gone.txt', null, 'deleted', false, false, 0, 2],
    ])
  })

  it('keeps the ranges and patch lines of each hunk, with an empty range starting at the line it comes before', () => {
    const files = parseDiff(PATCH)
    expect(files[3]?.hunks).toEqual([{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [' a', '-b', '+B', ' c'] }])
    expect(files[6]?.hunks).toEqual([{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: ['+no newline', '\\ No newline at end of file'] }])
    expect(files[7]?.hunks).toEqual([{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 0, lines: ['-q', '-z'] }])
  })

  it('takes paths without a prefix as they are and skips a section without a path', () => {
    expect(parseDiff('--- old\n+++ new\n@@ -1 +1 @@\n-a\n+b\n').map(file => [file.path, file.status])).toEqual([['new', 'modified']])
    expect(parseDiff('')).toEqual([])
  })
})

describe('untrackedFile', () => {
  it.each([
    ['a final newline', 'one\ntwo\n', ['+one', '+two']],
    ['no final newline', 'one\ntwo', ['+one', '+two', '\\ No newline at end of file']],
    ['carriage returns', 'one\r\ntwo\r\n', ['+one\r', '+two\r']],
  ])('adds every line of a text file with %s', (_label, text, lines) => {
    expect(untrackedFile('notes/new.md', new TextEncoder().encode(text))).toEqual({
      path: 'notes/new.md', previousPath: null, status: 'added', binary: false, oversized: false, untracked: true, additions: 2, deletions: 0,
      hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 2, lines }],
    })
  })

  it('describes an empty file without a hunk', () => {
    expect(untrackedFile('empty', new Uint8Array())).toMatchObject({ binary: false, additions: 0, hunks: [] })
  })

  it.each([
    ['a NUL byte', Uint8Array.from([0x61, 0x00, 0x62])],
    ['bytes that are not UTF-8', Uint8Array.from([0xff, 0xfe, 0x61])],
  ])('describes content with %s as binary', (_label, bytes) => {
    expect(untrackedFile('blob', bytes)).toMatchObject({ binary: true, additions: 0, hunks: [] })
  })

  it('looks for a NUL byte only among the first 8000 bytes, as Git does', () => {
    const late = new Uint8Array(8001).fill(0x61)
    late[8000] = 0
    expect(decodeText(late)).toBe(`${'a'.repeat(8000)}\0`)
  })
})

describe('parseNumstat', () => {
  it('reads counts, binary files, and renames whose paths follow in separate fields', () => {
    const output = ['3\t1\tsrc/a.ts', '-\t-\tlogo.png', '0\t0\t', 'old name.txt', 'new\tname.txt', '12\t0\tdocs/中文.md', ''].join('\0')
    expect(parseNumstat(output)).toEqual([
      { path: 'src/a.ts', additions: 3, deletions: 1, binary: false },
      { path: 'logo.png', additions: 0, deletions: 0, binary: true },
      { path: 'new\tname.txt', additions: 0, deletions: 0, binary: false },
      { path: 'docs/中文.md', additions: 12, deletions: 0, binary: false },
    ])
    expect(parseNumstat('')).toEqual([])
  })

  it('ends the list at a rename record that the output limit cut off', () => {
    expect(parseNumstat(['1\t1\ta.ts', '0\t0\t', 'old.txt'].join('\0'))).toEqual([{ path: 'a.ts', additions: 1, deletions: 1, binary: false }])
  })
})

import { parseTopLevel, parseName, baseBranches } from '../src/parse.ts'
describe('parseTopLevel', () => {
  it('reads the first line', () => {
    expect(parseTopLevel('/work/repo\n')).toBe('/work/repo')
    expect(parseTopLevel('C:/work/repo\r\n')).toBe('C:/work/repo')
    expect(parseTopLevel('/work/repo/.git\nignored\n')).toBe('/work/repo/.git')
  })

  it('rejects empty output', () => {
    expect(() => parseTopLevel('')).toThrow('git rev-parse printed no directory')
    expect(() => parseTopLevel('\n')).toThrow('git rev-parse printed no directory')
  })
})

describe('parseName', () => {
  it('reads the first line', () => {
    expect(parseName('main\n')).toBe('main')
    expect(parseName('origin/feat/x\r\nignored\n')).toBe('origin/feat/x')
  })

  it('reads no name from empty output', () => {
    expect(parseName('')).toBeNull()
    expect(parseName('\n')).toBeNull()
  })
})

describe('baseBranches', () => {
  it('puts the checked-out branch first without repeating it', () => {
    expect(baseBranches('feat', 'main\nfeat\nfix\n', 10)).toEqual(['feat', 'main', 'fix'])
  })

  it('keeps the checked-out branch when the listing omits it', () => {
    expect(baseBranches('old', 'main\nfeat\n', 2)).toEqual(['old', 'main'])
    expect(baseBranches('main', '', 50)).toEqual(['main'])
  })

  it('lists the branches of a detached HEAD in listed order', () => {
    expect(baseBranches(null, 'main\r\nfeat\r\n', 10)).toEqual(['main', 'feat'])
    expect(baseBranches(null, '', 10)).toEqual([])
  })

  it('returns at most `limit` names and skips empty lines', () => {
    expect(baseBranches('main', '\nmain\n\nfeat\nfix\n', 2)).toEqual(['main', 'feat'])
    expect(baseBranches(null, 'main\nfeat\nfix\n', 1)).toEqual(['main'])
  })
})


import { inspectCheckout, listBranches, hasBranch } from '../src/git.ts'

it('compares only a recorded local worktree base and reports local branches without a remote', async () => {
  const f = await fixture()
  const created = await f.ctx.worktrees.create(f.agent, { name: 'local-base' })
  await writeFile(join(created.path, 'tracked.txt'), 'committed\n')
  await git(created.path, 'add', 'tracked.txt')
  await git(created.path, 'commit', '-m', 'local change')
  const inspection = await inspectCheckout(f.ctx, config, f.agent.session, created.path, signal)
  if (inspection === undefined) throw new Error('Expected worktree inspection')
  const recorded = { ...created, from: null }
  const fork = forkPoint(inspection, recorded)
  expect(fork?.commit).toBe(created.baseCommit)
  const diff = await localDiff(f.ctx, config, f.agent.session, created.path, fork, { kind: 'branch' }, signal)
  expect(diff.base).toBe(created.baseCommit.slice(0, 7))
  expect(diff.files[0]?.hunks[0]?.lines).toContain('+committed')
  await writeFile(join(created.path, 'untracked.txt'), 'local\n')
  const summary = await localChanges(f.ctx, config, f.agent.session, inspection, recorded, signal)
  expect(summary?.files[0]?.additions).toBe(1)
  expect(summary?.files.find(file => file.path === 'untracked.txt')?.additions).toBe(1)
  expect(await localChanges(f.ctx, config, f.agent.session, inspection, null, signal)).toBeNull()
  const branches = await listBranches(f.ctx, config, f.agent.session, created.path, 10, signal)
  expect(branches.current).toBe('local-base')
  expect(branches.branches).toContain('main')
  expect(await hasBranch(f.ctx, config, f.agent.session, f.root, 'main', signal)).toBe(true)
  expect(await hasBranch(f.ctx, config, f.agent.session, f.root, 'missing', signal)).toBe(false)
})

it('uses the empty tree for an unborn branch and reads staged text without filesystem ambiguity', async () => {
  const f = await fixture()
  await git(f.root, 'checkout', '--orphan', 'unborn')
  await git(f.root, 'rm', '-rf', '.')
  await writeFile(join(f.root, 'unborn.txt'), 'first\n')
  await git(f.root, 'add', 'unborn.txt')
  const inspection = await inspectCheckout(f.ctx, config, f.agent.session, f.root, signal)
  expect(inspection?.checkout.commit).toBeNull()
  const diff = await localDiff(f.ctx, config, f.agent.session, f.root, null, { kind: 'staged' }, signal)
  expect(diff.files[0]?.path).toBe('unborn.txt')
  expect(await localText(f.ctx, config, f.agent.session, f.root, { kind: 'staged' }, 'unborn.txt', signal)).toBe('first\n')
  await writeFile(join(f.root, 'binary.bin'), Buffer.from([0, 255]))
  await git(f.root, 'add', 'binary.bin')
  await expect(localText(f.ctx, config, f.agent.session, f.root, { kind: 'staged' }, 'binary.bin', signal)).rejects.toThrow('is binary')
  await git(f.root, 'commit', '-m', 'initial unborn')
  await git(f.root, 'checkout', '--detach', 'HEAD')
  expect((await inspectCheckout(f.ctx, config, f.agent.session, f.root, signal))?.checkout.branch).toBeNull()
})

it('disables configured executable filters without modifying the checkout or Git config', async () => {
  const f = await fixture()
  const marker = join(f.root, 'executed-filter')
  const command = `touch '${marker}'`
  await git(f.root, 'config', 'filter.fixture.clean', command)
  await git(f.root, 'config', 'filter.fixture.required', 'true')
  await writeFile(join(f.root, '.gitattributes'), 'tracked.txt filter=fixture\n')
  await writeFile(join(f.root, 'tracked.txt'), 'unfiltered\n')
  const diff = await localDiff(f.ctx, config, f.agent.session, f.root, null, { kind: 'unstaged' }, signal)
  expect(diff.files[0]?.hunks[0]?.lines).toContain('+unfiltered')
  await expect(access(marker)).rejects.toThrow()
  expect(await git(f.root, 'config', 'filter.fixture.clean')).toBe(command)
})

it('reports omitted untracked entries, oversized tracked patches and outside-checkout links', async () => {
  const f = await fixture()
  await writeFile(join(f.root, 'one'), 'one')
  await writeFile(join(f.root, 'two'), 'two')
  const diff = await localDiff(f.ctx, { ...config, maxUntrackedFiles: 1 }, f.agent.session, f.root, null, { kind: 'unstaged' }, signal)
  expect(diff.omitted).toBe(1)
  await writeFile(join(f.root, 'tracked.txt'), 'large'.repeat(100))
  await expect(localDiff(f.ctx, { ...config, maxDiffBytes: 128 }, f.agent.session, f.root, null, { kind: 'staged' }, signal))
    .resolves.toEqual({ base: null, files: [], omitted: 0 })
  await expect(localDiff(f.ctx, { ...config, maxDiffBytes: 128 }, f.agent.session, f.root, null, { kind: 'unstaged' }, signal))
    .rejects.toBeInstanceOf(DiffTooLarge)
  const outside = join(f.root, 'outside-parent')
  await mkdir(outside)
  await symlink(outside, join(f.root, 'link-parent'))
  await writeFile(join(outside, 'file'), 'linked')
  await expect(localText(f.ctx, config, f.agent.session, f.root, { kind: 'uncommitted' }, 'link-parent/file', signal))
    .resolves.toBe('linked')
  await symlink(tmpdir(), join(f.root, 'escape'))
  await expect(localText(f.ctx, config, f.agent.session, f.root, { kind: 'uncommitted' }, 'escape/missing', signal))
    .rejects.toThrow('inside the checkout')
})

import { chmod } from 'node:fs/promises'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
it('reads a real checkout under the original read-only sandbox policy', async () => {
  const f = await fixture()
  setSandboxMode(f.agent.session, 'read-only')
  const inspection = await inspectCheckout(f.ctx, config, f.agent.session, f.root, signal)
  expect(inspection?.checkout.root).toBe(f.root)
  expect(inspection?.checkout.branch).toBe('main')
})

it('distinguishes a non-checkout, an unsafe checkout refusal and a signal-terminated query', async () => {
  const f = await fixture()
  expect(await inspectCheckout(f.ctx, config, f.agent.session, tmpdir(), signal)).toBeUndefined()
  const command = join(f.root, 'query-wrapper')
  await writeFile(command, '#!/bin/sh\nprintf "fatal: unsafe repository\\n" >&2\nexit 128\n')
  await chmod(command, 0o700)
  await expect(inspectCheckout(f.ctx, { ...config, gitCommand: command }, f.agent.session, f.root, signal))
    .rejects.toThrow('git rev-parse failed: fatal: unsafe repository')
  await writeFile(command, '#!/bin/sh\nkill -TERM $$\n')
  await expect(inspectCheckout(f.ctx, { ...config, gitCommand: command }, f.agent.session, f.root, signal))
    .rejects.toThrow('SIGTERM): no diagnostic')
})

it('refuses incomplete filter configuration before running a comparison', async () => {
  const f = await fixture()
  await git(f.root, 'config', `filter.${'long'.repeat(60)}.clean`, 'cat')
  await expect(localDiff(f.ctx, { ...config, maxDiffBytes: 128 }, f.agent.session, f.root, null, { kind: 'unstaged' }, signal))
    .rejects.toBeInstanceOf(FilterConfigError)
})

it('skips a file removed after listing and aborts another read before returning any comparison', async () => {
  const f = await fixture()
  await writeFile(join(f.root, 'gone.txt'), 'gone')
  const inspect = f.ctx.fs.lstat.bind(f.ctx.fs)
  const deletion = vi.spyOn(f.ctx.fs, 'lstat').mockImplementation(async (path, options, operation) => {
    const info = await inspect(path, options, operation)
    if (path === 'gone.txt') await rm(join(f.root, 'gone.txt'))
    return info
  })
  expect((await localDiff(f.ctx, config, f.agent.session, f.root, null, { kind: 'unstaged' }, signal)).files).toEqual([])
  deletion.mockRestore()
  await writeFile(join(f.root, 'abort.txt'), 'abort')
  const control = new AbortController()
  vi.spyOn(f.ctx.fs, 'lstat').mockImplementation(async (path, options, operation) => {
    const info = await inspect(path, options, operation)
    if (path === 'abort.txt') control.abort(new Error('comparison cancelled after inspection'))
    return info
  })
  await expect(localDiff(f.ctx, config, f.agent.session, f.root, null, { kind: 'unstaged' }, control.signal))
    .rejects.toThrow('comparison cancelled after inspection')
})

it('rejects process-supplied traversal paths and preserves failures of a Git file listing', async () => {
  const f = await fixture()
  const command = join(f.root, 'listing-wrapper')
  await writeFile(command, '#!/bin/sh\ncase "$*" in\n*"ls-files"*) printf "../outside\\000";;\n*) exec git "$@";;\nesac\n')
  await chmod(command, 0o700)
  await expect(localDiff(f.ctx, { ...config, gitCommand: command }, f.agent.session, f.root, null, { kind: 'unstaged' }, signal))
    .rejects.toThrow('file must stay inside the checkout')
  await writeFile(command, '#!/bin/sh\ncase "$*" in\n*"ls-files"*) printf "listing failed\\n" >&2; exit 7;;\n*) exec git "$@";;\nesac\n')
  await expect(localDiff(f.ctx, { ...config, gitCommand: command }, f.agent.session, f.root, null, { kind: 'unstaged' }, signal))
    .rejects.toThrow('git untracked failed (7): listing failed')
  await expect(localText(f.ctx, config, f.agent.session, f.root, { kind: 'staged' }, 'absent.txt', signal))
    .rejects.toThrow('git show failed (128)')
  await expect(localText(f.ctx, config, f.agent.session, f.root, { kind: 'uncommitted' }, '', signal))
    .rejects.toThrow('not a path inside the checkout')
})
