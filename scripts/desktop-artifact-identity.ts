/** Read the identity embedded by the complete build before assembling desktop artifacts. */
import { desktopBuildIdentity, validateDesktopBuildIdentity, type DesktopBuildIdentity, type DesktopSourceState } from './desktop-build-identity.ts'
import { readClientBuildRecord, repositoryGitDirty } from './client-build-environment.ts'

/** Supported desktop packaging policies. */
export type DesktopBuildMode = 'internal' | 'public'

/** One completed build identity and the source state observed for its artifact. */
export interface DesktopArtifactIdentity {
  /** Runtime version and full source commit shared by the Host and Client. */
  readonly release: DesktopBuildIdentity
  /** Flags that distinguish modified internal builds from public candidates. */
  readonly sourceState: DesktopSourceState
}

/**
 * Resolve the build-mode environment before reading artifact identity.
 * @param mode - optional deployment setting; omitted means internal testing.
 * @returns the supported internal or public policy.
 */
export function resolveDesktopBuildMode(mode: string | undefined): DesktopBuildMode {
  if (mode === undefined) return 'internal'
  if (mode !== 'internal' && mode !== 'public') throw new Error('desktop build mode must be internal or public')
  return mode
}

/**
 * Require unchanged Client artifacts and the same source commit; public builds require clean source.
 * @param root - checkout containing the completed root build record.
 * @param mode - resolved internal or public source policy.
 * @returns the recorded release and source modification flags for the installer.
 */
export function desktopArtifactIdentity(root: string, mode: DesktopBuildMode): DesktopArtifactIdentity {
  const modifiedAtPackaging = repositoryGitDirty(root)
  if (modifiedAtPackaging === undefined) throw new Error('desktop packaging requires Git source metadata')
  if (mode === 'public' && modifiedAtPackaging) throw new Error('desktop packaging requires a clean Git checkout')
  const { environment } = readClientBuildRecord(root)
  const modifiedAtBuild = environment.DSH_CLIENT_GIT_DIRTY === 'true'
  if (mode === 'public' && modifiedAtBuild) throw new Error('desktop packaging refuses a dirty source build')
  const recorded = validateDesktopBuildIdentity({
    version: environment.DSH_CLIENT_RELEASE_VERSION,
    commit: environment.DSH_CLIENT_RELEASE_COMMIT,
  })
  const current = desktopBuildIdentity(root)
  if (recorded.version !== current.version || recorded.commit !== current.commit) {
    throw new Error('desktop packaging source differs from the completed build; rebuild before packaging')
  }
  return { release: recorded, sourceState: { modifiedAtBuild, modifiedAtPackaging } }
}
