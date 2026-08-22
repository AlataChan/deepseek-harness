/**
 * Pack one release family's whole publish set into a single directory, in
 * publish order, and record that order for the publish step.
 *
 * The pack step is the release boundary: it runs without credentials, produces
 * every tarball from one commit, and hands the publish step exactly those bytes
 * ([rationale](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { releaseFamily, tarballName, type ReleaseFamily, type ReleaseMember } from './families.ts'
import { isEntry, run } from './process.ts'
import { projectExtractedPackage } from './projection.ts'
import { resolvePublicationTarget, type ResolvedPublicationTarget } from './targets.ts'
import { assertSafeTarballPaths, packedIdentity, PUBLISH_ORDER_FILE, tarballFiles } from './tarball.ts'

/** Where pack output lands when `--out` is omitted. */
const DEFAULT_OUTPUT = 'dist/npm'

/**
 * Pack one member and check what its tarball carries.
 * @param family - the release family being packed.
 * @param member - the member to pack.
 * @param destination - absolute output directory.
 * @returns The tarball filename.
 */
function packOfficialMember(family: ReleaseFamily, member: ReleaseMember, destination: string): string {
  run('pnpm', ['--dir', member.directory, 'pack', '--pack-destination', destination])

  const filename = tarballName(member)
  const tarball = join(destination, filename)
  if (!existsSync(tarball)) throw new Error(`${member.name} produced no tarball at ${tarball}`)
  const files = tarballFiles(tarball)
  assertSafeTarballPaths(files)
  family.validatePayload(member, files)
  const identity = packedIdentity(tarball)
  if (identity.name !== member.name || identity.version !== member.version) {
    throw new Error(
      `${tarball} declares ${identity.name}@${identity.version}, expected ${member.name}@${member.version}`,
    )
  }
  return filename
}

/**
 * Pack one member through its normal lifecycle, then project and repack its exact payload.
 * @param family - source release family.
 * @param member - source member to pack.
 * @param target - resolved publication target.
 * @param destination - absolute final output directory.
 * @returns The projected tarball filename.
 */
function packProjectedMember(
  family: ReleaseFamily,
  member: ReleaseMember,
  target: ResolvedPublicationTarget,
  destination: string,
): string {
  const staging = mkdtempSync(join(tmpdir(), 'dsh-release-pack-'))
  const sourceOutput = join(staging, 'source')
  const extracted = join(staging, 'extracted')
  mkdirSync(sourceOutput)
  mkdirSync(extracted)
  const projectedMember = target.projectMember(member)
  const finalFilename = tarballName(projectedMember)
  const finalTarball = join(destination, finalFilename)
  try {
    run('pnpm', ['--dir', member.directory, 'pack', '--pack-destination', sourceOutput])
    const sourceTarball = join(sourceOutput, tarballName(member))
    if (!existsSync(sourceTarball)) throw new Error(`${member.name} produced no tarball at ${sourceTarball}`)
    assertSafeTarballPaths(tarballFiles(sourceTarball))
    run('tar', ['-xzf', sourceTarball, '-C', extracted])

    const packageRoot = join(extracted, 'package')
    if (!existsSync(packageRoot)) throw new Error(`${sourceTarball} has no package/ payload`)
    projectExtractedPackage(packageRoot, target)
    run('pnpm', ['--dir', packageRoot, 'pack', '--pack-destination', destination])

    if (!existsSync(finalTarball)) {
      throw new Error(`${projectedMember.name} produced no tarball at ${finalTarball}`)
    }
    const files = tarballFiles(finalTarball)
    assertSafeTarballPaths(files)
    family.validatePayload(projectedMember, files)
    const identity = packedIdentity(finalTarball)
    if (identity.name !== projectedMember.name || identity.version !== projectedMember.version) {
      throw new Error(
        `${finalTarball} declares ${identity.name}@${identity.version},`
        + ` expected ${projectedMember.name}@${projectedMember.version}`,
      )
    }
    return finalFilename
  } catch (error) {
    rmSync(finalTarball, { force: true })
    throw error
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/**
 * Pack a release-family inventory and write its complete publication order.
 * @param family - source release family.
 * @param members - complete source family inventory.
 * @param target - resolved publication target for those members.
 * @param destination - absolute final output directory.
 */
export function packReleaseMembers(
  family: ReleaseFamily,
  members: readonly ReleaseMember[],
  target: ResolvedPublicationTarget,
  destination: string,
): void {
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })

  const order: string[] = []
  for (const member of family.publishOrder(members).order) {
    const filename = target.id === 'official'
      ? packOfficialMember(family, member, destination)
      : packProjectedMember(family, member, target, destination)
    order.push(filename)
  }
  writeFileSync(join(destination, PUBLISH_ORDER_FILE), `${order.join('\n')}\n`)
}

/** Pack the family named by `--family` into `--out`. */
function main(): void {
  const { values } = parseArgs({
    options: {
      family: { type: 'string' },
      out: { type: 'string' },
      target: { type: 'string' },
    },
    allowPositionals: false,
  })
  if (values.family === undefined) {
    throw new Error('usage: pack.ts --family <dsh|vendor> [--target <official|alatastudio>] [--out dist/npm]')
  }

  const family = releaseFamily(values.family)
  const root = process.cwd()
  const destination = resolve(root, values.out ?? DEFAULT_OUTPUT)
  const members = family.members(root)
  const target = resolvePublicationTarget(values.target, family, members)
  family.verifyBuildArtifacts(root)
  family.verifyVersions(members)

  packReleaseMembers(family, members, target, destination)

  console.log(
    `release pack: family ${family.id}, target ${target.id},`
    + ` ${String(members.length)} tarball(s) in ${values.out ?? DEFAULT_OUTPUT}`,
  )
}

if (isEntry(import.meta.url)) main()
