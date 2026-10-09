/** Public-service preset install repairs a composition this runtime cannot mount. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { compositionNeedsRepair, installNgoPreset } from '../src/install.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

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
})
