/** Public-service preset install repairs a stale composition and adds missing packaged files. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { compositionNeedsRepair, installNgoPreset } from '../src/install.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

const NEW_SKILL = join('skills', 'env-ngo-audio-minutes')

describe('installNgoPreset', () => {
  it('replaces a composition that still names the removed workflow package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ngo-preset-'))
    roots.push(root)
    const target = join(root, 'env-ngo-project-assistant')
    await installNgoPreset(new Context(), target)
    const path = join(target, 'agent.cordis.yml')
    await writeFile(path, "- id: workflow-worker-thread\n  name: '@deepseek-ai/dsh-workflow-worker-thread'\n")
    expect(compositionNeedsRepair(await readFile(path, 'utf8'))).toBe(true)
    await expect(installNgoPreset(new Context(), target)).resolves.toBe(true)
    const repaired = await readFile(path, 'utf8')
    expect(repaired).toContain('prefix:')
    expect(repaired).not.toContain('workflow-worker-thread')
  })

  it('leaves a healthy composition byte-identical', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ngo-preset-keep-'))
    roots.push(root)
    const target = join(root, 'env-ngo-project-assistant')
    await installNgoPreset(new Context(), target)
    const path = join(target, 'agent.cordis.yml')
    const healthy = 'prefix: kept\n'
    await writeFile(path, healthy)
    await expect(installNgoPreset(new Context(), target)).resolves.toBe(true)
    await expect(readFile(path, 'utf8')).resolves.toBe(healthy)
  })

  it('adds the packaged skill directory an older preset is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ngo-preset-skill-'))
    roots.push(root)
    const target = join(root, 'env-ngo-project-assistant')
    await installNgoPreset(new Context(), target)
    const skill = join(target, NEW_SKILL, 'SKILL.md')
    const template = join(target, NEW_SKILL, 'assets', 'minutes_template.md')
    await rm(join(target, NEW_SKILL), { recursive: true, force: true })
    await expect(readFile(skill, 'utf8')).rejects.toThrow()
    await expect(installNgoPreset(new Context(), target)).resolves.toBe(true)
    await expect(readFile(skill, 'utf8')).resolves.toContain('name: env-ngo-audio-minutes')
    await expect(readFile(template, 'utf8')).resolves.toContain('录音转纪要输出模板')
  })

  it('leaves a modified file untouched while filling a deleted sibling', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ngo-preset-edit-'))
    roots.push(root)
    const target = join(root, 'env-ngo-project-assistant')
    await installNgoPreset(new Context(), target)
    const skill = join(target, NEW_SKILL, 'SKILL.md')
    const template = join(target, NEW_SKILL, 'assets', 'minutes_template.md')
    const edited = 'user-edited skill body\n'
    await writeFile(skill, edited)
    await rm(template)
    await expect(installNgoPreset(new Context(), target)).resolves.toBe(true)
    await expect(readFile(skill, 'utf8')).resolves.toBe(edited)
    await expect(readFile(template, 'utf8')).resolves.toContain('录音转纪要输出模板')
  })

  it('keeps the preset usable when a refresh cannot walk a blocked directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ngo-preset-blocked-'))
    roots.push(root)
    const target = join(root, 'env-ngo-project-assistant')
    await installNgoPreset(new Context(), target)
    await rm(join(target, 'skills'), { recursive: true, force: true })
    await writeFile(join(target, 'skills'), 'not a directory\n')
    await expect(installNgoPreset(new Context(), target)).resolves.toBe(true)
    await expect(readFile(join(target, 'skills'), 'utf8')).resolves.toBe('not a directory\n')
  })
})
