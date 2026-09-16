/** Non-destructive commerce preset installation. */

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { installCommercePreset, packagedPresetDirectory } from '../src/install.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))))

describe('commerce preset installer', () => {
  it('creates an absent preset with its four attributed skills and names only release packages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'commerce-preset-'))
    roots.push(root)
    const target = join(root, 'commerce')
    await expect(installCommercePreset(new Context(), target)).resolves.toBe(true)
    const composition = await readFile(join(target, 'agent.cordis.yml'), 'utf8')
    expect(composition).not.toContain('@deepseek-ai/dsh-experimental-')
    expect(composition).toContain('@deepseek-ai/dsh-agent-tool-presentation')
    expect(composition).toContain('@deepseek-ai/dsh-skill-filesystem')
    const skills = (await readdir(join(target, 'skills'))).sort()
    expect(skills).toEqual([
      'commerce-inventory-pricing',
      'commerce-listing-copy',
      'commerce-marketing-campaigns',
      'commerce-sales-analysis',
    ])
    for (const skill of skills) {
      const text = await readFile(join(target, 'skills', skill, 'SKILL.md'), 'utf8')
      expect(text.match(/^---\nname: (.+)\ndescription: .+\n---\n/u)?.[1]).toBe(skill)
      expect(text).toContain('Claude Commerce Agents (Apache License 2.0)')
    }
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
