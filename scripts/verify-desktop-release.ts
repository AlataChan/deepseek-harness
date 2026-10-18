/** Independent artifact, CI execution and native signature qualification. */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { artifactDigest, payloadDigest, validateReleaseManifest, type DesktopReleaseManifest } from './desktop-release-manifest.ts'

/** Observations fetched from the CI service, not copied from a producer's manifest. */
export interface DesktopRunEvidence {
  repository: string
  ref: string
  commit: string
  runId: number
  attempt: number
  workflow: string
  status: string
  conclusion: string
  jobs: { name: string; conclusion: string }[]
  installedVerified: boolean
}
/**
 * Refuse mismatched or incomplete CI executions.
 * @param manifest - artifact producer record.
 * @param run - independent run observations.
 * @param target - required platform.
 */
export function assertRunEvidence(manifest: DesktopReleaseManifest, run: DesktopRunEvidence, target: DesktopReleaseManifest['target']): void {
  const w = manifest.workflow
  const approvedWorkflow = target === 'windows-x64' ? '.github/workflows/desktop-windows.yml' : '.github/workflows/desktop-macos.yml'
  if (w === undefined || !['refs/heads/master', 'refs/heads/release'].includes(run.ref)
    || run.workflow !== approvedWorkflow || run.repository !== 'AlataChan/deepseek-harness' || manifest.target !== target || run.repository !== manifest.repository || run.ref !== manifest.ref
    || run.commit !== manifest.release.commit || run.commit !== w.commit || run.runId !== w.runId || run.attempt !== w.attempt
    || run.workflow !== w.path || run.status !== 'completed' || run.conclusion !== 'success'
    || run.jobs.length === 0 || run.jobs.some(job => job.conclusion !== 'success') || !run.installedVerified) {
    throw new Error('CI execution does not qualify this exact desktop artifact')
  }
}
/**
 * Refuse missing public signing prerequisites before an expensive build.
 * @param mode - internal or public.
 * @param target - platform.
 * @param env - build environment.
 */
export function assertPublicPreflight(mode: DesktopReleaseManifest['mode'], target: DesktopReleaseManifest['target'], env: NodeJS.ProcessEnv): void {
  if (mode === 'internal') return
  const required = target === 'windows-x64'
    ? ['DSH_WINDOWS_CERTIFICATE_THUMBPRINT', 'DSH_WINDOWS_PUBLISHER']
    : ['DSH_MAC_SIGNING_IDENTITY', 'DSH_MAC_TEAM_ID', 'DSH_NOTARY_PROFILE']
  for (const key of required) if (!env[key]?.trim()) throw new Error(`Public build requires ${key}`)
}

/**
 * Execute one native verifier, refusing unavailable tools and unsuccessful exits.
 * @param command - executable.
 * @param args - argument vector.
 * @returns stdout.
 */
function native(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000 })
  if (result.error !== undefined || result.status !== 0) throw new Error(`Native verification failed: ${command}: ${result.error?.message ?? result.stderr}`)
  return result.stdout
}
/**
 * Verify native signing credentials exist before packaging.
 * @param mode - build qualification.
 * @param target - platform.
 * @param env - configured credential identifiers.
 */
export function verifySigningPrerequisites(mode: DesktopReleaseManifest['mode'], target: DesktopReleaseManifest['target'], env = process.env): void {
  assertPublicPreflight(mode, target, env)
  if (mode === 'internal') return
  if (target === 'windows-x64') {
    if (process.platform !== 'win32') throw new Error('Windows signing requires native Windows')
    const script = "$c=Get-Item ('Cert:\\CurrentUser\\My\\'+$env:DSH_WINDOWS_CERTIFICATE_THUMBPRINT) -ErrorAction Stop; if(-not $c.HasPrivateKey -or $c.Subject -ne $env:DSH_WINDOWS_PUBLISHER -or $c.NotAfter -lt (Get-Date)){throw 'Missing usable publisher private key'}"
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { env, encoding: 'utf8', timeout: 30_000 })
    if (result.error !== undefined || result.status !== 0) throw new Error('Public signing certificate/private key is unavailable')
  } else {
    if (process.platform !== 'darwin') throw new Error('macOS signing requires native macOS')
    const identities = native('security', ['find-identity', '-v', '-p', 'codesigning'])
    if (!identities.includes(String(env.DSH_MAC_SIGNING_IDENTITY)) || !identities.includes(String(env.DSH_MAC_TEAM_ID))) throw new Error('Developer ID private key is unavailable')
    native('xcrun', ['notarytool', 'history', '--keychain-profile', String(env.DSH_NOTARY_PROFILE), '--output-format', 'json'])
  }
}

/**
 * Verify signatures against OS trust and a configured publisher, never a JSON boolean.
 * @param manifest - target and mode.
 * @param artifact - final installer.
 * @param payload - app root on macOS or main executable on Windows.
 * @param env - expected publisher configuration.
 */
export function verifyNativeSignatures(manifest: DesktopReleaseManifest, artifact: string, payload: string, env = process.env): void {
  if (manifest.mode === 'internal') return
  if (manifest.target === 'windows-x64') {
    if (process.platform !== 'win32') throw new Error('Public Windows qualification requires native Windows')
    if (!env.DSH_WINDOWS_PUBLISHER) throw new Error('Expected Windows publisher is required')
    for (const path of [artifact, payload]) {
      const script = "$s=Get-AuthenticodeSignature -LiteralPath $env:DSH_VERIFY_FILE; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -ne $env:DSH_WINDOWS_PUBLISHER){throw 'Untrusted or wrong Authenticode publisher'}"
      const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 120_000, env: { ...env, DSH_VERIFY_FILE: resolve(path) } })
      if (result.error !== undefined || result.status !== 0) throw new Error(`Authenticode verification failed: ${result.stderr}`)
    }
  } else {
    if (!env.DSH_MAC_TEAM_ID) throw new Error('Expected macOS team identity is required')
    if (process.platform !== 'darwin') throw new Error('Public macOS qualification requires native macOS')
    native('codesign', ['--verify', '--deep', '--strict', payload])
    native('codesign', ['--verify', '-R', `anchor apple generic and certificate leaf[subject.OU] = "${env.DSH_MAC_TEAM_ID}"`, payload])
    native('spctl', ['--assess', '--type', 'execute', '--verbose=2', payload])
    native('xcrun', ['stapler', 'validate', artifact])
    native('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', artifact])
  }
}
/**
 * Verify a downloaded installer before any code from its payload executes.
 * @param manifest - validated public artifact record.
 * @param artifact - downloaded installer file.
 * @param env - expected native publisher.
 */
export function verifyDownloadedArtifact(manifest: DesktopReleaseManifest, artifact: string, env = process.env): void {
  if (manifest.mode !== 'public') throw new Error('Internal artifacts cannot enter public qualification')
  const actual = artifactDigest(artifact)
  if (actual.name !== manifest.artifact.name || actual.bytes !== manifest.artifact.bytes || actual.sha256 !== manifest.artifact.sha256) {
    throw new Error('Downloaded installer differs from its manifest')
  }
  if (manifest.target === 'windows-x64') {
    verifyNativeSignatures(manifest, artifact, artifact, env)
  } else {
    if (process.platform !== 'darwin' || !env.DSH_MAC_TEAM_ID) throw new Error('Native macOS publisher verification is required')
    native('codesign', ['--verify', '--strict', artifact])
    native('codesign', ['--verify', '-R', `anchor apple generic and certificate leaf[subject.OU] = "${env.DSH_MAC_TEAM_ID}"`, artifact])
    native('xcrun', ['stapler', 'validate', artifact])
    native('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', artifact])
  }
}
/**
 * Recompute artifact and installed tree hashes.
 * @param manifest - expected identities.
 * @param artifact - final installer path.
 * @param payload - installed tree used by installed controls.
 */
export function assertArtifactBytes(manifest: DesktopReleaseManifest, artifact: string, payload: string): void {
  const buildInfo: unknown = JSON.parse(readFileSync(resolve(payload, 'build-info.json'), 'utf8'))
  if (typeof buildInfo !== 'object' || buildInfo === null || !('release' in buildInfo)
    || typeof buildInfo.release !== 'object' || buildInfo.release === null
    || !('version' in buildInfo.release) || !('commit' in buildInfo.release)
    || buildInfo.release.version !== manifest.release.version || buildInfo.release.commit !== manifest.release.commit) {
    throw new Error('Installed payload release identity differs from the artifact manifest')
  }
  if (!('sourceState' in buildInfo) || typeof buildInfo.sourceState !== 'object' || buildInfo.sourceState === null
    || !('modifiedAtBuild' in buildInfo.sourceState) || !('modifiedAtPackaging' in buildInfo.sourceState)
    || buildInfo.sourceState.modifiedAtBuild !== manifest.sourceState.modifiedAtBuild
    || buildInfo.sourceState.modifiedAtPackaging !== manifest.sourceState.modifiedAtPackaging) {
    throw new Error('Installed source modification flags differ from the artifact manifest')
  }
  const actual = artifactDigest(artifact)
  if (actual.name !== manifest.artifact.name || actual.bytes !== manifest.artifact.bytes || actual.sha256 !== manifest.artifact.sha256
    || payloadDigest(payload) !== manifest.payloadSha256) throw new Error('Artifact or installed payload bytes differ from the manifest')
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, manifestPath, artifact, payload, signaturePayload] = process.argv.slice(2)
  if (command === 'preflight' || command === 'config-preflight') {
    const mode = manifestPath
    if (mode !== 'internal' && mode !== 'public') throw new Error('Expected internal or public mode')
    if (artifact !== 'windows-x64' && artifact !== 'macos-arm64' && artifact !== 'macos-x64') throw new Error('Expected desktop target')
    if (command === 'config-preflight') assertPublicPreflight(mode, artifact, process.env)
    else verifySigningPrerequisites(mode, artifact, process.env)
  } else if (command === 'verify' && manifestPath && artifact && payload) {
    const manifest = validateReleaseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
    assertArtifactBytes(manifest, artifact, payload)
    if (manifest.mode === 'public' && !signaturePayload) throw new Error('Public verification requires an explicit signed app/executable path')
    verifyNativeSignatures(manifest, artifact, signaturePayload ?? payload)
    console.log(`${basename(artifact)}: bytes and ${manifest.mode} native qualification verified`)
  } else throw new Error('Usage: verify-desktop-release.ts preflight|config-preflight <internal|public> <target> | verify <manifest> <artifact> <installed-payload> <signed-app-or-executable>')
}
