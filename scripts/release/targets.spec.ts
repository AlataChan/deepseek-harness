/** Publication-target identity projection. */

import { describe, expect, it } from 'vitest'
import { releaseFamily, type ReleaseMember } from './families.ts'
import { resolvePublicationTarget } from './targets.ts'

/**
 * Create a release member for target tests.
 * @param name - source package name.
 * @returns A minimal release member.
 */
function member(name: string): ReleaseMember {
  return {
    directory: `packages/test/${name.slice(name.lastIndexOf('/') + 1)}`,
    name,
    version: '0.1.1-rc.4',
    manifest: { name, version: '0.1.1-rc.4' },
  }
}

const dshMembers = [
  member('@deepseek-ai/dsh'),
  member('@deepseek-ai/dsh-alpha'),
  member('@deepseek-ai/dsh-alpha-long'),
]

describe('release publication targets', () => {
  it('defaults to official source identities', () => {
    const target = resolvePublicationTarget(undefined, releaseFamily('dsh'), dshMembers)

    expect(target.id).toBe('official')
    expect(target.projectMember(dshMembers[1]!).name).toBe('@deepseek-ai/dsh-alpha')
    expect(target.projectReference('@deepseek-ai/dsh-alpha/invariant')).toBe('@deepseek-ai/dsh-alpha/invariant')
    expect(target.installedEntry).toEqual({ packageName: '@deepseek-ai/dsh', binPath: 'lib/bin.js' })
  })

  it('projects known dsh members and subpaths without mutating source members', () => {
    const target = resolvePublicationTarget('alatastudio', releaseFamily('dsh'), dshMembers)
    const projected = target.projectMember(dshMembers[1]!)

    expect(target.id).toBe('alatastudio')
    expect(projected.name).toBe('@alatastudio/dsh-alpha')
    expect(projected).not.toBe(dshMembers[1])
    expect(dshMembers[1]!.name).toBe('@deepseek-ai/dsh-alpha')
    expect(target.projectReference('@deepseek-ai/dsh')).toBe('@alatastudio/dsh')
    expect(target.projectReference('@deepseek-ai/dsh-alpha-long/invariant'))
      .toBe('@alatastudio/dsh-alpha-long/invariant')
    expect(target.installedEntry).toEqual({ packageName: '@alatastudio/dsh', binPath: 'lib/bin.js' })
  })

  it('does not treat external or unknown package names as projectable', () => {
    const target = resolvePublicationTarget('alatastudio', releaseFamily('dsh'), dshMembers)

    expect(target.projectReference('@deepseek-ai/cordis')).toBeUndefined()
    expect(target.projectReference('@deepseek-ai/dsh-unknown')).toBeUndefined()
  })

  it('rejects unknown targets and target-family mismatches', () => {
    const vendorMembers = [member('@deepseek-ai/cordis')]

    expect(() => resolvePublicationTarget('personal', releaseFamily('dsh'), dshMembers))
      .toThrow(/unknown publication target personal/)
    expect(() => resolvePublicationTarget('alatastudio', releaseFamily('vendor'), vendorMembers))
      .toThrow(/target alatastudio.*family dsh/)
  })
})
