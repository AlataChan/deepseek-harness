/** The desktop-files patch keeps handshake behind a live sessionController. */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../cordis.patch.yml'),
  'utf8',
)

describe('desktop-files connection-desktop patch', () => {
  it('injects sessionController so session/control cannot open before the service exists', () => {
    expect(patch).toMatch(/id:\s*connection-desktop/)
    expect(patch).toMatch(/inject:\s*\[[^\]]*sessionController[^\]]*\]/)
    expect(patch).toContain('workspaceRoot: !!js ctx.desktopStartup.workspaceRoot')
  })
})
