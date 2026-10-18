import { describe, expect, it } from 'vitest'
import { verifyReviewedPlanHandoff } from './verify-desktop-reviewed-plan.ts'
const plan = { schemaVersion: 1, repository: 'AlataChan/deepseek-harness', channel: 'stable-windows-x64', version: '1.2.3',
  commit: 'a'.repeat(40), assets: [{ name: 'octopus-1.2.3.exe', bytes: 3, sha256: 'b'.repeat(64) }], channelRevision: null }
describe('original publication approval', () => {
  it('accepts only the exact originally reviewed JSON including its channel revision', () => {
    const reviewed = `${JSON.stringify(plan, null, 2)}\n`
    expect(verifyReviewedPlanHandoff(reviewed, Buffer.from(reviewed))).toEqual(plan)
    expect(() => { verifyReviewedPlanHandoff(undefined, Buffer.from(reviewed)) }).toThrow(/original reviewed/)
    for (const changed of [{ ...plan, channelRevision: 'new remote revision' }, { ...plan, commit: 'c'.repeat(40) }, plan]) {
      expect(() => { verifyReviewedPlanHandoff(reviewed, Buffer.from(JSON.stringify(changed))) }).toThrow(/original reviewed/)
    }
  })
})
