import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { planPublication, publishDesktopRelease, verifyPublication } from './desktop-release-publish.ts'
import { FixtureReleaseTransport } from './tests/desktop-release-fixture.ts'
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const asset = { name: 'octopus-1.2.3-windows-x64.exe', bytes: Buffer.from('signed binary') }
const input = { repository: 'AlataChan/deepseek-harness', channel: 'stable', version: '1.2.3', commit: 'a'.repeat(40),
  assets: [{ name: asset.name, bytes: asset.bytes.length, sha256: digest(asset.bytes) }] }
const qualify = async (): Promise<void> => {}
describe('resumable desktop publication', () => {
  it('plans without writes and only advances the channel after readback', async () => {
    const transport = new FixtureReleaseTransport(input.commit)
    const plan = await planPublication(input, transport)
    expect(transport.writes).toEqual([])
    await publishDesktopRelease(plan, [asset], transport, qualify)
    expect(transport.writes).toEqual([asset.name, 'channel-stable.json'])
    await expect(verifyPublication(plan, transport)).resolves.toBeUndefined()
  })
  it('preserves uploaded binaries and resumes after a transport failure', async () => {
    const transport = new FixtureReleaseTransport(input.commit)
    const plan = await planPublication(input, transport)
    transport.failAfterWrite = asset.name
    await expect(publishDesktopRelease(plan, [asset], transport, qualify)).rejects.toThrow('injected')
    expect(transport.assets.has('channel-stable.json')).toBe(false)
    transport.failAfterWrite = undefined
    await publishDesktopRelease(plan, [asset], transport, qualify)
    expect(transport.writes.filter(name => name === asset.name)).toHaveLength(1)
  })
  it('refuses immutable conflicts, changed channels and unsigned inputs without advertising', async () => {
    const transport = new FixtureReleaseTransport(input.commit)
    const plan = await planPublication(input, transport)
    transport.assets.set(asset.name, { bytes: Buffer.from('different'), revision: 'other' })
    await expect(publishDesktopRelease(plan, [asset], transport, qualify)).rejects.toThrow(/conflict/)
    transport.assets.delete(asset.name)
    transport.assets.set('channel-stable.json', { bytes: Buffer.from('{}'), revision: 'new-writer' })
    await expect(publishDesktopRelease(plan, [asset], transport, qualify)).rejects.toThrow(/channel/)
    expect(transport.writes).toEqual([])
    transport.assets.clear()
    await expect(publishDesktopRelease(plan, [asset], transport, async () => { throw new Error('unsigned') })).rejects.toThrow('unsigned')
    expect(transport.writes).toEqual([])
  })
  it('rechecks the channel after binary verification and refuses a concurrent publisher', async () => {
    const transport = new FixtureReleaseTransport(input.commit)
    const plan = await planPublication(input, transport)
    transport.afterBinaryRead = () => transport.assets.set('channel-stable.json', { bytes: Buffer.from('{}'), revision: 'raced' })
    await expect(publishDesktopRelease(plan, [asset], transport, qualify)).rejects.toThrow(/channel/)
    expect(transport.writes).toEqual([asset.name])
  })
})

it('reconciles a lost response after the channel write without repeating any write', async () => {
  const transport = new FixtureReleaseTransport(input.commit)
  const plan = await planPublication(input, transport)
  transport.failAfterWrite = 'channel-stable.json'
  await expect(publishDesktopRelease(plan, [asset], transport, qualify)).rejects.toThrow('injected')
  transport.failAfterWrite = undefined
  await publishDesktopRelease(plan, [asset], transport, qualify)
  expect(transport.writes).toEqual([asset.name, 'channel-stable.json'])
})
it('refuses moved tags and tampered local bytes before writing', async () => {
  const transport = new FixtureReleaseTransport(input.commit)
  const plan = await planPublication(input, transport)
  await expect(publishDesktopRelease(plan, [{ ...asset, bytes: Buffer.from('tampered') }], transport, qualify)).rejects.toThrow(/mismatch/)
  const moved = new FixtureReleaseTransport('b'.repeat(40))
  await expect(publishDesktopRelease(plan, [asset], moved, qualify)).rejects.toThrow(/source commit/)
  expect(transport.writes).toEqual([])
  expect(moved.writes).toEqual([])
})
