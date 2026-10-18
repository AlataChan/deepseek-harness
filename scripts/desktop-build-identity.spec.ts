import { describe, expect, it } from 'vitest'
import { validateDesktopBuildIdentity } from './desktop-build-identity.ts'

describe('desktop build identity', () => {
  it('retains runtime version and exact source commit independently of the shell version', () => {
    expect(validateDesktopBuildIdentity({ version: '0.2.1-fork.1', commit: 'a'.repeat(40) }))
      .toEqual({ version: '0.2.1-fork.1', commit: 'a'.repeat(40) })
  })

  it.each([null, {}, { version: '', commit: 'a'.repeat(40) }, { version: '1', commit: 'short' },
    { version: '1', commit: 'A'.repeat(40) }])('refuses incomplete build identities: %j', (value) => {
    expect(() => validateDesktopBuildIdentity(value)).toThrow('desktop build identity')
  })
})
