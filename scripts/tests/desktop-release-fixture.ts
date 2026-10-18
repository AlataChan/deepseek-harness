/** Deterministic transport with failure injection and real byte readback. */
import { createHash } from 'node:crypto'
import type { DesktopReleaseTransport, ReleaseAsset } from '../desktop-release-publish.ts'
/** Local transport used by the same publisher as GitHub. */
export class FixtureReleaseTransport implements DesktopReleaseTransport {
  readonly assets = new Map<string, ReleaseAsset>()
  readonly writes: string[] = []
  failAfterWrite: string | undefined
  afterBinaryRead: (() => void) | undefined
  constructor(private readonly commit: string) {}
  sourceCommit(): Promise<string> { return Promise.resolve(this.commit) }
  read(name: string): Promise<ReleaseAsset | undefined> {
    const value = this.assets.get(name)
    if (name.endsWith('.exe') && value !== undefined) this.afterBinaryRead?.()
    return Promise.resolve(value)
  }
  create(name: string, bytes: Uint8Array): Promise<void> {
    if (this.assets.has(name)) return Promise.reject(new Error('Immutable object exists'))
    this.writes.push(name)
    this.assets.set(name, { bytes: Buffer.from(bytes), revision: createHash('sha256').update(bytes).digest('hex') })
    if (this.failAfterWrite === name) return Promise.reject(new Error('injected after write'))
    return Promise.resolve()
  }
  async replaceChannel(name: string, bytes: Uint8Array, revision: string | null): Promise<void> {
    if ((this.assets.get(name)?.revision ?? null) !== revision) throw new Error('Concurrent channel writer')
    this.assets.delete(name)
    await this.create(name, bytes)
  }
}
