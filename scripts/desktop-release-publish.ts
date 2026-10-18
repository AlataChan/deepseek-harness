/** Resumable immutable desktop publication; channel replacement requires a serialized writer. */
import { createHash } from 'node:crypto'

/** An observed asset revision includes the remote asset identity and actual content. */
export interface ReleaseAsset { bytes: Uint8Array; revision: string }
/** GitHub and fixture transports implement identical publication decisions. */
export interface DesktopReleaseTransport {
  sourceCommit(): Promise<string>
  read(name: string): Promise<ReleaseAsset | undefined>
  create(name: string, bytes: Uint8Array): Promise<void>
  replaceChannel(name: string, bytes: Uint8Array, observedRevision: string | null): Promise<void>
}
/** Reviewed immutable destinations and expected channel revision, persisted before writes. */
export interface DesktopPublicationPlan {
  schemaVersion: 1
  repository: string
  channel: string
  version: string
  commit: string
  assets: { name: string; bytes: number; sha256: string }[]
  channelRevision: string | null
}
/** Read-only planning inputs. */
export type DesktopPublicationInput = Omit<DesktopPublicationPlan, 'schemaVersion' | 'channelRevision'>
/** In-memory payload associated with one reviewed immutable name. */
export interface DesktopPublicationBytes { name: string; bytes: Uint8Array }
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const channelName = (plan: DesktopPublicationInput): string => `channel-${plan.channel}.json`
const channelBytes = (plan: DesktopPublicationInput): Uint8Array => Buffer.from(`${JSON.stringify({ schemaVersion: 1, repository: plan.repository,
  version: plan.version, commit: plan.commit, assets: plan.assets })}\n`)

/** Refuse unsafe names and non-fork destinations at the persisted plan parser. @param value - JSON plan. @returns parsed plan. */
export function validatePublicationPlan(value: unknown): DesktopPublicationPlan {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid publication plan')
  const v = value as Record<string, unknown>
  if (v.schemaVersion !== 1 || v.repository !== 'AlataChan/deepseek-harness' || typeof v.commit !== 'string' || !/^[a-f0-9]{40}$/.test(v.commit)
    || typeof v.channel !== 'string' || !/^[a-z][a-z0-9-]{0,30}$/.test(v.channel)
    || typeof v.version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(v.version)
    || (v.channelRevision !== null && typeof v.channelRevision !== 'string') || !Array.isArray(v.assets) || v.assets.length === 0) throw new Error('Invalid publication identity')
  const assets = v.assets.map((a: unknown) => {
    if (typeof a !== 'object' || a === null) throw new Error('Invalid asset')
    const item = a as Record<string, unknown>
    if (typeof item.name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(item.name) || !item.name.includes(String(v.version))
      || item.name.startsWith('channel-') || typeof item.bytes !== 'number' || !Number.isSafeInteger(item.bytes) || item.bytes <= 0
      || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Invalid immutable asset')
    return { name: item.name, bytes: item.bytes, sha256: item.sha256 }
  })
  if (new Set(assets.map(a => a.name)).size !== assets.length) throw new Error('Duplicate asset names')
  return { schemaVersion: 1, repository: v.repository, channel: v.channel, version: v.version, commit: v.commit,
    assets, channelRevision: v.channelRevision }
}
/**
 * Observe remote state without creating assets, tags or metadata.
 * @param input - immutable publication identity.
 * @param remote - read-capable transport.
 * @returns reviewable plan.
 */
export async function planPublication(input: DesktopPublicationInput, remote: DesktopReleaseTransport): Promise<DesktopPublicationPlan> {
  const channel = await remote.read(channelName(input))
  const plan = validatePublicationPlan({ ...input, schemaVersion: 1, channelRevision: channel?.revision ?? null })
  if (await remote.sourceCommit() !== plan.commit) throw new Error('Release tag does not name the planned source commit')
  return plan
}
/**
 * Verify all advertised bytes; read-only and independent of upload success responses.
 * @param plan - reviewed plan.
 * @param remote - remote observations.
 */
export async function verifyPublication(plan: DesktopPublicationPlan, remote: DesktopReleaseTransport): Promise<void> {
  if (await remote.sourceCommit() !== plan.commit) throw new Error('Release tag moved')
  for (const item of plan.assets) {
    const actual = await remote.read(item.name)
    if (actual === undefined || actual.bytes.length !== item.bytes || hash(actual.bytes) !== item.sha256) throw new Error(`Remote asset differs: ${item.name}`)
  }
  const channel = await remote.read(channelName(plan))
  if (channel === undefined || hash(channel.bytes) !== hash(channelBytes(plan))) throw new Error('Channel has not advanced to this verified release')
}
/**
 * Publish immutable objects before one channel record; all writes require fresh qualification.
 * @param rawPlan - persisted plan.
 * @param assets - local artifact bytes.
 * @param remote - serialized transport.
 * @param qualify - independent native signatures and CI evidence, called before any write.
 */
export async function publishDesktopRelease(
  rawPlan: DesktopPublicationPlan,
  assets: DesktopPublicationBytes[],
  remote: DesktopReleaseTransport,
  qualify: () => Promise<void>,
): Promise<void> {
  const plan = validatePublicationPlan(rawPlan)
  await qualify()
  if (await remote.sourceCommit() !== plan.commit) throw new Error('Release source commit changed')
  const expectedChannel = channelBytes(plan)
  const initial = await remote.read(channelName(plan))
  if (initial !== undefined && hash(initial.bytes) === hash(expectedChannel)) {
    await verifyPublication(plan, remote)
    return
  }
  if ((initial?.revision ?? null) !== plan.channelRevision) throw new Error('Remote channel changed since planning')
  if (assets.length !== plan.assets.length) throw new Error('Ambiguous local artifact set')
  for (const item of plan.assets) {
    const local = assets.filter(a => a.name === item.name)
    const bytes = local[0]?.bytes
    if (local.length !== 1 || bytes === undefined || bytes.length !== item.bytes || hash(bytes) !== item.sha256) throw new Error(`Local artifact mismatch: ${item.name}`)
    const existing = await remote.read(item.name)
    if (existing !== undefined && (existing.bytes.length !== item.bytes || hash(existing.bytes) !== item.sha256)) throw new Error(`Immutable asset conflict: ${item.name}`)
    if (existing === undefined) await remote.create(item.name, bytes)
    const verified = await remote.read(item.name)
    if (verified === undefined || verified.bytes.length !== item.bytes || hash(verified.bytes) !== item.sha256) throw new Error(`Uploaded bytes failed readback: ${item.name}`)
  }
  if (await remote.sourceCommit() !== plan.commit) throw new Error('Release source commit changed after upload')
  const before = await remote.read(channelName(plan))
  if ((before?.revision ?? null) !== plan.channelRevision) throw new Error('Remote channel changed during publication')
  await remote.replaceChannel(channelName(plan), expectedChannel, plan.channelRevision)
  await verifyPublication(plan, remote)
}
