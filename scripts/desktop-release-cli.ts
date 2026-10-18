/** Explicit desktop manifest creation, qualification, planning and publication commands. */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { desktopArtifactIdentity, resolveDesktopBuildMode } from './desktop-artifact-identity.ts'
import { artifactDigest, desktopShellVersion, payloadDigest, validateReleaseManifest } from './desktop-release-manifest.ts'
import { assertArtifactBytes, assertRunEvidence, verifyNativeSignatures, verifyDownloadedArtifact } from './verify-desktop-release.ts'
import { GitHubDesktopReleaseTransport } from './desktop-release-github.ts'
import { planPublication, publishDesktopRelease, validatePublicationPlan, verifyPublication, qualifyReviewedPlan } from './desktop-release-publish.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [command, ...args] = process.argv.slice(2)
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
const save = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'w', mode: 0o600 })
}
const envInt = (key: string): number => {
  const value = Number(process.env[key])
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer`)
  return value
}
if (command === 'identity') {
  const path = args[0]
  if (!path) throw new Error('identity <build-info-path>')
  const { release, sourceState } = desktopArtifactIdentity(root, resolveDesktopBuildMode(args[1]))
  let existing: unknown = {}
  try { existing = read(path) } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) throw new Error('Invalid build info')
  save(path, { ...existing, release, sourceState, runtimeVersion: release.version })
} else if (command === 'manifest') {
  const [artifact, payload, target, mode, out, signaturePayload] = args
  if (!artifact || !payload || !out) throw new Error('manifest <artifact> <payload-root> <target> <internal|public> <output>')
  const { release, sourceState } = desktopArtifactIdentity(root, resolveDesktopBuildMode(mode))
  const workflow = process.env.GITHUB_RUN_ID === undefined ? undefined : {
    path: process.env.DSH_BUILD_WORKFLOW, commit: process.env.GITHUB_SHA, runId: envInt('GITHUB_RUN_ID'), attempt: envInt('GITHUB_RUN_ATTEMPT'), artifactName: process.env.DSH_BUILD_ARTIFACT_NAME,
  }
  const manifest = validateReleaseManifest({ schemaVersion: 1, mode, repository: process.env.GITHUB_REPOSITORY ?? 'AlataChan/deepseek-harness',
    sourceState, ref: process.env.GITHUB_REF ?? 'local', release, shellVersion: desktopShellVersion(root), target, payloadSha256: payloadDigest(payload), artifact: artifactDigest(artifact), workflow })
  assertArtifactBytes(manifest, artifact, payload)
  if (manifest.mode === 'public' && !signaturePayload) throw new Error('Explicit signed app/executable path is required')
  verifyNativeSignatures(manifest, artifact, signaturePayload ?? payload)
  save(out, manifest)
  console.log(`Created ${out}`)
} else if (command === 'inspect-download') {
  if (!args[0]) throw new Error('Manifest path is required')
  const manifest = validateReleaseManifest(read(args[0]))
  if (manifest.mode !== 'public') throw new Error('Internal artifacts cannot enter public qualification')
  console.log(JSON.stringify(manifest))
} else if (command === 'qualify-download') {
  const [manifestPath, artifact, expectedCommit, expectedRun, expectedAttempt, expectedTarget] = args
  if (!manifestPath || !artifact) throw new Error('qualify-download requires manifest, artifact and selected source identity')
  const manifest = validateReleaseManifest(read(manifestPath))
  if (manifest.release.commit !== expectedCommit || String(manifest.workflow?.runId) !== expectedRun
    || String(manifest.workflow?.attempt) !== expectedAttempt || manifest.target !== expectedTarget) {
    throw new Error('Downloaded manifest differs from explicitly selected source/run/attempt/target')
  }
  verifyDownloadedArtifact(manifest, artifact)
  const remote = new GitHubDesktopReleaseTransport(`desktop-v${manifest.release.version}`, `qualification-${manifest.target}`, process.env.GH_TOKEN ?? '')
  assertRunEvidence(manifest, await remote.runEvidence(manifest), manifest.target)
  await remote.verifyArtifactArchive(manifest)
  console.log('Downloaded candidate qualified before execution')
} else if (command === 'publish-qualified') {
  const [manifestPath, artifact, planPath, channel] = args
  if (!manifestPath || !artifact || !planPath || !channel) throw new Error('publish-qualified requires manifest, artifact, plan and channel')
  const manifest = validateReleaseManifest(read(manifestPath))
  if (!channel.endsWith(manifest.target)) throw new Error('Publication channel must include target')
  const plan = validatePublicationPlan(read(planPath))
  if (plan.commit !== manifest.release.commit || plan.version !== manifest.release.version || plan.channel !== channel
    || JSON.stringify(plan.assets) !== JSON.stringify([manifest.artifact])) throw new Error('Plan differs from qualified artifact')
  const remote = new GitHubDesktopReleaseTransport(`desktop-v${manifest.release.version}`, channel, process.env.GH_TOKEN ?? '')
  const qualify = async (): Promise<void> => {
    verifyDownloadedArtifact(manifest, artifact)
    assertRunEvidence(manifest, await remote.runEvidence(manifest), manifest.target)
    await remote.verifyArtifactArchive(manifest)
    await remote.assertReadOnlyQualification(envInt('GITHUB_RUN_ID'), envInt('GITHUB_RUN_ATTEMPT'), process.env.GITHUB_SHA ?? '')
  }
  if (process.env.DSH_CONFIRM_PUBLISH !== `${manifest.repository}:${channel}:${manifest.release.commit}`) throw new Error('Explicit publication identity is required')
  await publishDesktopRelease(plan, [{ name: manifest.artifact.name, bytes: readFileSync(artifact) }], remote, qualify)
} else if (command === 'plan' || command === 'verify' || command === 'publish' || command === 'qualify-plan') {
  const [manifestPath, artifact, payload, planPath, channel, signaturePayload] = args
  if (!manifestPath || !artifact || !payload || !planPath || !channel) throw new Error(`${command} <manifest> <artifact> <payload-root> <plan> <channel>`)
  const manifest = validateReleaseManifest(read(manifestPath))
  if (!signaturePayload) throw new Error('Explicit signed app/executable path is required')
  if (manifest.mode !== 'public') throw new Error('Internal artifacts cannot be published')
  if (!channel.endsWith(manifest.target)) throw new Error('Publication channel must include target to preserve other platform records')
  const remote = new GitHubDesktopReleaseTransport(`desktop-v${manifest.release.version}`, channel, process.env.GH_TOKEN ?? '')
  const qualify = async (): Promise<void> => {
    assertArtifactBytes(manifest, artifact, payload)
    verifyNativeSignatures(manifest, artifact, signaturePayload)
    assertRunEvidence(manifest, await remote.runEvidence(manifest), manifest.target)
    await remote.verifyArtifactArchive(manifest)
  }
  await qualify()
  if (command === 'plan') {
    const plan = await planPublication({
      repository: manifest.repository, channel, version: manifest.release.version, commit: manifest.release.commit,
      assets: [manifest.artifact] }, remote)
    save(planPath, plan)
    console.log(JSON.stringify(plan, null, 2))
  } else {
    const plan = validatePublicationPlan(read(planPath))
    if (plan.commit !== manifest.release.commit || plan.version !== manifest.release.version || plan.channel !== channel
      || JSON.stringify(plan.assets) !== JSON.stringify([manifest.artifact])) throw new Error('Plan differs from qualified artifact')
    if (command === 'qualify-plan') {
      await qualifyReviewedPlan(plan, remote)
      console.log('Exact reviewed plan qualified without publication')
    } else if (command === 'verify') await verifyPublication(plan, remote)
    else {
      if (process.env.DSH_CONFIRM_PUBLISH !== `${manifest.repository}:${channel}:${manifest.release.commit}`) throw new Error('Explicit DSH_CONFIRM_PUBLISH identity is required')
      await publishDesktopRelease(plan, [{ name: manifest.artifact.name, bytes: readFileSync(artifact) }], remote, qualify)
    }
  }
} else throw new Error('Expected manifest, plan, verify or publish')
