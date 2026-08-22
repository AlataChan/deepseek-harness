/** Publication targets that project release-family package identities. */

import type { InstalledEntry, ReleaseFamily, ReleaseMember } from './families.ts'

/** A source package name and the name one publication target emits. */
interface PackageNameProjection {
  /** Package name used by the source release family. */
  readonly source: string
  /** Package name written into the published artifact. */
  readonly target: string
}

/** One resolved publication target for a concrete release family. */
export interface ResolvedPublicationTarget {
  /** Command-line target identifier. */
  readonly id: 'official' | 'alatastudio'
  /** Known family package names ordered longest first. */
  readonly projections: readonly PackageNameProjection[]
  /** Executable entry after identity projection, when the family has one. */
  readonly installedEntry: InstalledEntry | undefined
  /**
   * Project one release member without changing the source member.
   * @param member - source release member.
   * @returns A member carrying the target package name.
   */
  projectMember(member: ReleaseMember): ReleaseMember
  /**
   * Project a known package name or package subpath.
   * @param reference - package name or subpath reference.
   * @returns The projected reference, or undefined when it does not name a family member.
   */
  projectReference(reference: string): string | undefined
}

/** Publication target identifiers accepted by release commands. */
const TARGET_IDS = ['official', 'alatastudio'] as const

/** Publication target identifiers accepted by release commands. */
type PublicationTargetId = typeof TARGET_IDS[number]

/**
 * Check whether a command-line value names a supported publication target.
 * @param value - command-line target value.
 * @returns Whether the value is a publication target identifier.
 */
function isPublicationTargetId(value: string): value is PublicationTargetId {
  return TARGET_IDS.some(id => id === value)
}

/**
 * Convert a source DSH package name to its AlataStudio publication name.
 * @param name - source package name.
 * @returns The projected package name.
 */
function alatastudioName(name: string): string {
  if (name === '@deepseek-ai/dsh') return '@alatastudio/dsh'
  if (name.startsWith('@deepseek-ai/dsh-')) return `@alatastudio/${name.slice('@deepseek-ai/'.length)}`
  throw new Error(`target alatastudio cannot project non-DSH package ${name}`)
}

/**
 * Resolve a publication target against one complete release-family inventory.
 * @param requested - command-line target identifier, or undefined for the official target.
 * @param family - source release family.
 * @param members - every source member in the family.
 * @returns The target-specific identity projector.
 */
export function resolvePublicationTarget(
  requested: string | undefined,
  family: ReleaseFamily,
  members: readonly ReleaseMember[],
): ResolvedPublicationTarget {
  const id = requested ?? 'official'
  if (!isPublicationTargetId(id)) {
    throw new Error(`unknown publication target ${id}; expected one of ${TARGET_IDS.join(', ')}`)
  }
  if (id === 'alatastudio' && family.id !== 'dsh') {
    throw new Error('publication target alatastudio is valid only for family dsh')
  }

  const projections = members.map(member => ({
    source: member.name,
    target: id === 'alatastudio' ? alatastudioName(member.name) : member.name,
  })).sort((left, right) => right.source.length - left.source.length || left.source.localeCompare(right.source))
  const bySource = new Map(projections.map(entry => [entry.source, entry.target]))
  const targets = new Set(projections.map(entry => entry.target))
  if (targets.size !== projections.length) throw new Error(`publication target ${id} produces a package-name collision`)

  const projectReference = (reference: string): string | undefined => {
    for (const projection of projections) {
      if (reference === projection.source) return projection.target
      if (reference.startsWith(`${projection.source}/`)) {
        return `${projection.target}${reference.slice(projection.source.length)}`
      }
    }
    return undefined
  }
  const sourceEntry = family.sourceInstalledEntry
  const installedEntry = sourceEntry === undefined
    ? undefined
    : { ...sourceEntry, packageName: projectReference(sourceEntry.packageName) ?? sourceEntry.packageName }

  return {
    id,
    projections,
    installedEntry,
    projectMember(member) {
      const name = bySource.get(member.name)
      if (name === undefined) throw new Error(`${member.name} is not a member of release family ${family.id}`)
      return { ...member, name }
    },
    projectReference,
  }
}
