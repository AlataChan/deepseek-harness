/** GitHub release adapter. Supported channel writers must share workflow concurrency. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { DesktopReleaseTransport, ReleaseAsset } from './desktop-release-publish.ts'
import type { DesktopRunEvidence } from './verify-desktop-release.ts'
import { validateReleaseManifest, type DesktopReleaseManifest } from './desktop-release-manifest.ts'

/** HTTP injection point used for recorded adapter controls. */
export type ReleaseFetch = typeof fetch
/** Parse a GitHub JSON object at the network boundary. @param value - decoded JSON. @returns object fields. */
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Malformed GitHub object')
  return value as Record<string, unknown>
}
/** Read a required string at the GitHub boundary. @param value - field value. @returns nonempty string. */
function string(value: unknown): string {
  if (typeof value !== 'string' || value === '') throw new Error('Malformed GitHub string')
  return value
}
/** Read a required integer at the GitHub boundary. @param value - field value. @returns positive integer. */
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error('Malformed GitHub integer')
  return value
}
/** Immutable release assets and a dedicated channel release asset on the fork. */
export class GitHubDesktopReleaseTransport implements DesktopReleaseTransport {
  private readonly base = 'https://api.github.com/repos/AlataChan/deepseek-harness'
  constructor(private readonly tag: string, private readonly channel: string, private readonly token: string,
    private readonly request: ReleaseFetch = fetch) {
    if (!/^desktop-v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(tag) || !/^[a-z][a-z0-9-]{0,30}$/.test(channel)) throw new Error('Invalid release tag or channel')
    if (!token) throw new Error('GitHub token is required')
  }
  /**
 * Perform an authenticated API request; never print request headers.
 * @param url - fixed GitHub API URL.
 * @param init - request arguments.
 * @returns successful response.
 */
  private async api(url: string, init: RequestInit = {}): Promise<Response> {
    if (!url.startsWith(`${this.base}/`) && !url.startsWith('https://uploads.github.com/repos/AlataChan/deepseek-harness/')) throw new Error('Non-fork publication endpoint refused')
    const response = await this.request(url, { ...init, headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', ...Object.fromEntries(new Headers(init.headers).entries()) }, signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`GitHub request failed: HTTP ${response.status}`)
    return response
  }
  private async releaseId(channel: boolean): Promise<number> {
    const tag = channel ? `desktop-channel-${this.channel}` : this.tag
    const value = object(await (await this.api(`${this.base}/releases/tags/${encodeURIComponent(tag)}`)).json())
    return integer(value.id)
  }
  async sourceCommit(): Promise<string> {
    let value = object(await (await this.api(`${this.base}/git/ref/tags/${encodeURIComponent(this.tag)}`)).json())
    let target = object(value.object)
    for (let depth = 0; target.type === 'tag' && depth < 5; depth += 1) {
      value = object(await (await this.api(`${this.base}/git/tags/${string(target.sha)}`)).json())
      target = object(value.object)
    }
    if (target.type !== 'commit' || !/^[a-f0-9]{40}$/.test(string(target.sha))) throw new Error('Release tag does not resolve to one commit')
    return string(target.sha)
  }
  private async asset(name: string): Promise<Record<string, unknown> | undefined> {
    const release = await this.releaseId(name.startsWith('channel-'))
    const matches: Record<string, unknown>[] = []
    for (let page = 1; ; page += 1) {
      const values: unknown = await (await this.api(`${this.base}/releases/${release}/assets?per_page=100&page=${page}`)).json()
      if (!Array.isArray(values)) throw new Error('Malformed asset list')
      for (const value of values) { const a = object(value); if (a.name === name) matches.push(a) }
      if (values.length < 100) break
      if (page >= 100) throw new Error('Unbounded release asset list')
    }
    if (matches.length > 1) throw new Error('Ambiguous duplicate GitHub asset names')
    return matches[0]
  }
  async read(name: string): Promise<ReleaseAsset | undefined> {
    const asset = await this.asset(name)
    if (asset === undefined) return undefined
    if (asset.state !== 'uploaded') throw new Error('Release asset upload is incomplete')
    const response = await this.api(`${this.base}/releases/assets/${integer(asset.id)}`, { headers: { Accept: 'application/octet-stream' } })
    const bytes = new Uint8Array(await response.arrayBuffer())
    return { bytes, revision: `${integer(asset.id)}:${string(asset.updated_at)}:${createHash('sha256').update(bytes).digest('hex')}` }
  }
  async create(name: string, bytes: Uint8Array): Promise<void> {
    const release = await this.releaseId(name.startsWith('channel-'))
    const response = await this.api(`https://uploads.github.com/repos/AlataChan/deepseek-harness/releases/${release}/assets?name=${encodeURIComponent(name)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from(bytes) })
    if (object(await response.json()).state !== 'uploaded') throw new Error('Release asset upload is incomplete')
  }
  async replaceChannel(name: string, bytes: Uint8Array, revision: string | null): Promise<void> {
    if (name !== `channel-${this.channel}.json`) throw new Error('Only the channel record may be replaced')
    const before = await this.read(name)
    if ((before?.revision ?? null) !== revision) throw new Error('Channel revision changed before replacement')
    if (before !== undefined) {
      const id = before.revision.split(':')[0]
      if (!id || !/^[0-9]+$/.test(id)) throw new Error('Invalid remote revision')
      await this.api(`${this.base}/releases/assets/${id}`, { method: 'DELETE' })
    }
    // GitHub has no conditional asset replacement. Workflow concurrency owns serialization;
    // an interruption after deletion requires explicit re-planning before another write.
    await this.create(name, bytes)
    const after = await this.read(name)
    if (after === undefined || !Buffer.from(after.bytes).equals(Buffer.from(bytes))) throw new Error('Channel replacement has an ambiguous outcome; re-plan')
  }
  /**
 * Verify the binary in the exact GitHub workflow archive, including GitHub's independent archive digest.
 * @param manifest - producer identity to compare with the archive and packed installer.
 */
  async verifyArtifactArchive(manifest: DesktopReleaseManifest): Promise<void> {
    const workflow = manifest.workflow
    if (workflow === undefined) throw new Error('Missing workflow artifact identity')
    const response = object(await (await this.api(`${this.base}/actions/runs/${workflow.runId}/artifacts?per_page=100&name=${encodeURIComponent(workflow.artifactName)}`)).json())
    if (!Array.isArray(response.artifacts) || response.artifacts.length !== 1 || response.total_count !== 1) throw new Error('Ambiguous workflow artifact')
    const artifact = object(response.artifacts[0])
    const run = object(artifact.workflow_run)
    if (artifact.expired !== false || run.head_sha !== manifest.release.commit || run.id !== workflow.runId
      || typeof artifact.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest)) throw new Error('Workflow archive does not qualify')
    const bytes = new Uint8Array(await (await this.api(`${this.base}/actions/artifacts/${integer(artifact.id)}/zip`)).arrayBuffer())
    if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== artifact.digest) throw new Error('Downloaded workflow archive digest mismatch')
    const dir = mkdtempSync(join(tmpdir(), 'octopus-release-archive-'))
    const zip = join(dir, 'artifact.zip')
    try {
      writeFileSync(zip, bytes, { flag: 'wx', mode: 0o600 })
      if (process.platform !== 'win32') {
        const listing = spawnSync('/usr/bin/unzip', ['-Z1', zip], { encoding: 'utf8', timeout: 30_000 })
        if (listing.status !== 0 || listing.stdout.split('\n').filter(name => name === manifest.artifact.name).length !== 1
          || listing.stdout.split('\n').filter(name => name === `${manifest.artifact.name}.release.json`).length !== 1) {
          throw new Error('Ambiguous installer entries in workflow archive')
        }
      }
      const result = process.platform === 'win32'
        ? spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
          "Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead($env:DSH_VERIFY_ZIP); try { $entries=@($z.Entries | Where-Object FullName -eq $env:DSH_VERIFY_ENTRY); if($entries.Count -ne 1){throw 'Ambiguous packed installer'}; $s=$entries[0].Open(); try { $h=[Security.Cryptography.SHA256]::Create(); $hex=[Convert]::ToHexString($h.ComputeHash($s)).ToLowerInvariant(); Write-Output ($entries[0].Length.ToString()+':'+$hex) } finally {$s.Dispose()} } finally {$z.Dispose()}"],
        { encoding: 'utf8', timeout: 120_000, env: { ...process.env, DSH_VERIFY_ZIP: zip, DSH_VERIFY_ENTRY: manifest.artifact.name } })
        : spawnSync('/usr/bin/unzip', ['-p', zip, manifest.artifact.name], { timeout: 120_000, maxBuffer: 512 * 1024 * 1024 })
      if (result.error !== undefined || result.status !== 0) throw new Error('Cannot verify installer inside workflow archive')
      const observed = typeof result.stdout === 'string' ? result.stdout.trim()
        : `${result.stdout.length}:${createHash('sha256').update(result.stdout).digest('hex')}`
      if (observed !== `${manifest.artifact.bytes}:${manifest.artifact.sha256}`) throw new Error('Local installer differs from actual GitHub workflow artifact')
      const producerName = `${manifest.artifact.name}.release.json`
      const producer = process.platform === 'win32'
        ? spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
          "Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead($env:DSH_VERIFY_ZIP); try { $entries=@($z.Entries | Where-Object FullName -eq $env:DSH_VERIFY_ENTRY); if($entries.Count -ne 1 -or $entries[0].Length -gt 1048576){throw 'Missing or ambiguous producer manifest'}; $r=[IO.StreamReader]::new($entries[0].Open()); try {Write-Output $r.ReadToEnd()} finally {$r.Dispose()} } finally {$z.Dispose()}"],
        { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
          env: { ...process.env, DSH_VERIFY_ZIP: zip, DSH_VERIFY_ENTRY: producerName } })
        : spawnSync('/usr/bin/unzip', ['-p', zip, producerName], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 })
      if (producer.error !== undefined || producer.status !== 0) throw new Error('Cannot verify archived producer manifest')
      const archived = validateReleaseManifest(JSON.parse(producer.stdout))
      if (JSON.stringify(archived) !== JSON.stringify(validateReleaseManifest(manifest))) {
        throw new Error('Archived producer manifest differs from the claimed source/run/attempt or artifact qualification')
      }

    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
  /**
   * Require the same publication workflow's read-only native qualification job to have completed.
   * @param runId - current publication run.
   * @param attempt - current publication attempt.
   * @param commit - workflow source commit checked out by the publisher.
   */
  async assertReadOnlyQualification(runId: number, attempt: number, commit: string): Promise<void> {
    const run = object(await (await this.api(`${this.base}/actions/runs/${runId}/attempts/${attempt}`)).json())
    const repo = object(run.repository)
    if (repo.full_name !== 'AlataChan/deepseek-harness' || run.head_sha !== commit || run.run_attempt !== attempt
      || !['master', 'release'].includes(string(run.head_branch))
      || run.path !== '.github/workflows/desktop-publish.yml') throw new Error('Publication qualification workflow identity differs')
    const value = object(await (await this.api(`${this.base}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`)).json())
    if (!Array.isArray(value.jobs) || value.jobs.length !== value.total_count) throw new Error('Incomplete qualification job evidence')
    const jobs = value.jobs.map(object).filter(job => job.name === 'qualify-and-plan')
    const qualification = jobs[0]
    if (jobs.length !== 1 || qualification === undefined || qualification.conclusion !== 'success') throw new Error('Read-only native qualification did not succeed')
    const steps: unknown = qualification.steps
    if (!Array.isArray(steps) || !steps.some((step: unknown) => {
      const s = object(step)
      return s.name === 'Qualify downloaded artifact and execute explicit operation' && s.conclusion === 'success'
    })) throw new Error('Native installed qualification step did not succeed')
  }
  /**
 * Read CI execution and installed-verification steps directly from GitHub.
 * @param manifest - exact producer execution.
 * @returns independently observed evidence.
 */
  async runEvidence(manifest: DesktopReleaseManifest): Promise<DesktopRunEvidence> {
    const identity = manifest.workflow
    if (identity === undefined) throw new Error('CI identity is required')
    const run = object(await (await this.api(`${this.base}/actions/runs/${identity.runId}/attempts/${identity.attempt}`)).json())
    const repo = object(run.repository)
    const jobsResponse = object(await (await this.api(`${this.base}/actions/runs/${identity.runId}/attempts/${identity.attempt}/jobs?per_page=100`)).json())
    if (!Array.isArray(jobsResponse.jobs) || jobsResponse.jobs.length === 0 || jobsResponse.jobs.length !== jobsResponse.total_count) throw new Error('Incomplete CI jobs evidence')
    const jobs = jobsResponse.jobs.map(object)
    const installedVerified = jobs.some((job) => {
      const steps: unknown = job.steps
      if (!Array.isArray(steps)) return false
      const names = manifest.target === 'windows-x64'
        ? ['Run the Windows readiness gate', 'Verify installed Ask Knowledge public flows with a legacy code page', 'Verify native Windows installer upgrade recovery', 'Verify publication refuses unqualified candidates before execution']
        : ['Verify mounted desktop bundle']
      return names.every(name => steps.some((step: unknown) => { const s = object(step); return s.name === name && s.conclusion === 'success' }))
    })
    return { repository: string(repo.full_name), ref: `refs/heads/${string(run.head_branch)}`, commit: string(run.head_sha), runId: integer(run.id),
      attempt: integer(run.run_attempt), workflow: string(run.path), status: string(run.status), conclusion: string(run.conclusion),
      jobs: jobs.map(job => ({ name: string(job.name), conclusion: string(job.conclusion) })), installedVerified }
  }
}
