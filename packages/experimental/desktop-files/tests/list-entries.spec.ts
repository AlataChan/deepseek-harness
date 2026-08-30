/** Listing fence, junk skip, symlink kinds, bound, and abort. */

import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorkspaceEntriesError } from '@deepseek-ai/dsh-host-workspace-entries'
import {
  fullyQualified, isInsideRoot, listEntries,
} from '../src/list-entries.ts'

function stage(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'dsh-desktop-files-')))
}

describe('isInsideRoot', () => {
  it('accepts the root and a descendant, and refuses a parent walk', () => {
    expect(isInsideRoot('/proj', '/proj', path.posix)).toBe(true)
    expect(isInsideRoot('/proj', '/proj/src', path.posix)).toBe(true)
    expect(isInsideRoot('/proj', '/proj/../other', path.posix)).toBe(false)
  })

  it('refuses a Windows cross-drive relative that is an absolute path', () => {
    expect(isInsideRoot('C:\\proj', 'D:\\other', path.win32)).toBe(false)
    expect(isInsideRoot('C:\\proj', 'C:\\proj\\src', path.win32)).toBe(true)
  })
})

describe('fullyQualified', () => {
  it('rejects a relative path on POSIX and a drive-less Windows form', () => {
    expect(fullyQualified('src', 'linux')).toBe(false)
    expect(fullyQualified('/proj', 'linux')).toBe(true)
    expect(fullyQualified('\\foo', 'win32')).toBe(false)
    expect(fullyQualified('C:\\proj', 'win32')).toBe(true)
  })
})

describe('listEntries', () => {
  it('lists files and directories, marks dotfiles hidden, and skips junk names', async () => {
    const root = stage()
    writeFileSync(join(root, 'a.ts'), 'x')
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, '.env'), 'k=v')
    mkdirSync(join(root, 'node_modules'))
    mkdirSync(join(root, '.git'))
    mkdirSync(join(root, 'dist'))
    mkdirSync(join(root, 'coverage'))
    const listing = await listEntries({ root })
    expect(listing.root).toBe(root)
    expect(listing.path).toBe(root)
    expect(listing.truncated).toBe(false)
    expect(listing.entries.map(row => row.name)).toEqual(['.env', 'a.ts', 'src'])
    expect(listing.entries.find(row => row.name === '.env')).toMatchObject({
      hidden: true, kind: 'file', symlink: false,
    })
    expect(listing.entries.find(row => row.name === 'src')).toMatchObject({
      hidden: false, kind: 'directory', path: join(root, 'src'),
    })
  })

  it('classifies directory, file, and dangling symlinks', async () => {
    const root = stage()
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'a.ts'), 'x')
    symlinkSync(join(root, 'src'), join(root, 'src-link'))
    symlinkSync(join(root, 'a.ts'), join(root, 'a-link'))
    symlinkSync(join(root, 'missing'), join(root, 'gone'))
    const listing = await listEntries({ root })
    expect(listing.entries.find(row => row.name === 'src-link')).toMatchObject({
      kind: 'directory', symlink: true,
    })
    expect(listing.entries.find(row => row.name === 'a-link')).toMatchObject({
      kind: 'file', symlink: true,
    })
    expect(listing.entries.find(row => row.name === 'gone')).toMatchObject({
      kind: 'broken-symlink', symlink: true,
    })
  })

  it('refuses a relative root or path', async () => {
    await expect(listEntries({ root: 'proj' })).rejects.toMatchObject({
      code: 'entries-unreadable', path: 'proj',
    })
    const root = stage()
    await expect(listEntries({ root, path: 'src' })).rejects.toBeInstanceOf(WorkspaceEntriesError)
    await expect(listEntries({ root, path: 'src' })).rejects.toMatchObject({
      code: 'entries-unreadable', path: 'src',
    })
  })

  it('refuses a lexical walk out of root', async () => {
    const root = stage()
    const outside = join(root, '..', 'other-not-used')
    await expect(listEntries({ root, path: join(root, '..') })).rejects.toMatchObject({
      code: 'entries-outside-root',
      root,
    })
    await expect(listEntries({ root, path: outside })).rejects.toMatchObject({
      code: 'entries-outside-root',
    })
  })

  it('refuses a directory symlink whose realpath leaves the root and does not list the outside tree', async () => {
    const base = stage()
    const root = join(base, 'proj')
    const outside = join(base, 'outside')
    mkdirSync(root)
    mkdirSync(outside)
    writeFileSync(join(outside, 'secret.txt'), 'nope')
    symlinkSync(outside, join(root, 'escape'))
    const listing = await listEntries({ root })
    expect(listing.entries.find(row => row.name === 'escape')).toMatchObject({
      kind: 'directory', symlink: true, path: join(root, 'escape'),
    })
    await expect(listEntries({ root, path: join(root, 'escape') })).rejects.toMatchObject({
      code: 'entries-outside-root',
      path: join(root, 'escape'),
      root,
    })
  })

  it('treats a dangling symlink list target as unreadable', async () => {
    const root = stage()
    symlinkSync(join(root, 'missing'), join(root, 'gone'))
    await expect(listEntries({ root, path: join(root, 'gone') })).rejects.toMatchObject({
      code: 'entries-unreadable',
      path: join(root, 'gone'),
    })
  })

  it('truncates a complete result at the configured bound', async () => {
    const root = stage()
    for (let i = 0; i < 5; i += 1) writeFileSync(join(root, `f${String(i)}`), '')
    const listing = await listEntries({ root }, undefined, { maxEntries: 3 })
    expect(listing.entries).toHaveLength(3)
    expect(listing.truncated).toBe(true)
    expect(listing.entries.map(row => row.name)).toEqual(['f0', 'f1', 'f2'])
  })

  it('truncates at the default 1000-row bound', async () => {
    const root = stage()
    for (let i = 0; i < 1001; i += 1) writeFileSync(join(root, `n${String(i).padStart(4, '0')}`), '')
    const listing = await listEntries({ root })
    expect(listing.entries).toHaveLength(1000)
    expect(listing.truncated).toBe(true)
  })

  it('aborts an in-flight listing', async () => {
    const root = stage()
    const abort = new AbortController()
    abort.abort()
    await expect(listEntries({ root }, abort.signal)).rejects.toThrow()
  })
})
