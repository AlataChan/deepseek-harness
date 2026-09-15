/** Non-destructive commerce preset installation. */

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { installCommercePreset, packagedPresetDirectory } from '../src/install.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

describe('commerce preset installer', () => {
  it('creates an absent preset and names only release packages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'commerce-preset-'))
    roots.push(root)
    const target = join(root, 'commerce')
    await expect(installCommercePreset(new Context(), target)).resolves.toBe(true)
    const composition = await readFile(join(target, 'agent.cordis.yml'), 'utf8')
    expect(composition).not.toContain('@deepseek-ai/dsh-experimental-')
    expect(composition).toContain('@deepseek-ai/dsh-agent-tool-presentation')
    expect(composition).toContain('@deepseek-ai/dsh-skill-filesystem')
    expect((await stat(join(target, 'skills'))).isDirectory()).toBe(true)
  })

  it('leaves an edited preset byte-identical', async () => {
    const root = await mkdtemp(join(tmpdir(), 'commerce-preset-existing-'))
    roots.push(root)
    const target = join(root, 'commerce')
    await installCommercePreset(new Context(), target)
    const path = join(target, 'agent.cordis.yml')
    await writeFile(path, 'edited\n')
    await expect(installCommercePreset(new Context(), target)).resolves.toBe(true)
    await expect(readFile(path, 'utf8')).resolves.toBe('edited\n')
    expect(packagedPresetDirectory()).not.toBe(target)
  })
})
