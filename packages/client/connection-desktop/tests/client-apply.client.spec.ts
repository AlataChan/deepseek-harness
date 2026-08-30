import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('the desktop connection package', () => {
  it('does not publish a dsh.client face; the WebView uses official client-connection', () => {
    const manifest = JSON.parse(readFileSync(
      fileURLToPath(new URL('../package.json', import.meta.url)),
      'utf8',
    )) as { dsh?: { client?: unknown } }
    expect(manifest.dsh?.client).toBeUndefined()
  })
})
