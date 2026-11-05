/** Unsigned bytes must match PIN.json. Signed mode refuses a Mach-O comparison. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyAssets } from './verify-agent-desktop-digest.ts'

describe('verify agent-desktop digest', () => {
  it('accepts matching unsigned bytes and rejects a one-byte binary change', async () => {
    const root = await fixture({ binary: 'agent-desktop-bytes' })
    await verifyAssets({ root, signed: false })
    await writeFile(join(root, 'native', 'agent-desktop'), 'agent-desktop-bytes!')
    await expect(verifyAssets({ root, signed: false })).rejects.toThrow(/agent-desktop digest mismatch/)
    await rm(root, { recursive: true })
  })

  it('checks LICENSE and the skill, then refuses to compare Mach-O bytes', async () => {
    const root = await fixture({ binary: 'agent-desktop-bytes' })
    await expect(verifyAssets({ root, signed: true })).rejects.toThrow(/refusing to compare signed Mach-O/)
    await writeFile(join(root, 'native', 'LICENSE'), 'not-the-license')
    await expect(verifyAssets({ root, signed: true })).rejects.toThrow(/LICENSE digest mismatch/)
    await rm(root, { recursive: true })
  })
})

async function fixture(input: { binary: string }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ad01-verify-'))
  const native = join(root, 'native', 'skills', 'agent-desktop')
  await mkdir(native, { recursive: true })
  const license = 'license-bytes'
  const skill = 'skill-bytes'
  const helper = 'helper-bytes'
  await writeFile(join(root, 'native', 'LICENSE'), license)
  await writeFile(join(root, 'native', 'skills', 'agent-desktop', 'SKILL.md'), skill)
  await writeFile(join(root, 'native', 'agent-desktop'), input.binary)
  await writeFile(join(root, 'native', 'agent-desktop-macos-helper'), helper)
  await writeFile(join(root, 'native', 'PIN.json'), JSON.stringify({
    license: digest(license),
    skill: digest(skill),
    binaries: {
      'agent-desktop': digest(input.binary),
      'agent-desktop-macos-helper': digest(helper),
    },
  }))
  return root
}

function digest(text: string): { bytes: number; sha256: string } {
  return { bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') }
}
