/** Typed face of `seed-desktop-profile-plugin.mjs` for the Host typecheck. */

export interface PluginPin {
  name: string
  version: string
  source?: 'npm' | 'workspace'
  path?: string
  defaultEnabled?: boolean
}

export interface PinFile {
  profile: string
  shippedBundles: string[]
  plugins: PluginPin[]
}

export const RETIRED_DESKTOP_BUNDLES: Readonly<Record<string, string>>

export const STRIP_DESKTOP_BUNDLES: readonly string[]

export function isLegacyDshContextSpec(spec: string | undefined | null): boolean

export function readInstalledPackageVersion(profileDir?: string, packageName?: string): string | null

export function readPinFile(path?: string): PinFile

export function healDesktopProfileManifest(
  manifest: object,
  options?: { profileDir?: string; installedVersion?: string | null },
): {
  dsh: { profile: { bundles: string[] } }
  dependencies?: Record<string, string>
  [key: string]: unknown
}

export function validatePluginDir(dir: string, expected?: PluginPin): {
  name: string
  version: string
  [key: string]: unknown
}

export function exportPluginsManifest(pin: PinFile, outDir: string): {
  schemaVersion: number
  plugins: Record<string, { version: string; defaultEnabled: boolean }>
}

export function mergeProfileManifest(
  manifest: object,
  plugin: PluginPin,
  options?: { firstInstall?: boolean; defaultEnabled?: boolean },
): {
  dsh: { profile: { bundles: string[] } }
  dependencies: Record<string, string>
  [key: string]: unknown
}

export function installPluginIntoProfile(
  src: string,
  profileDir: string,
  shippedBundles: string[],
  options?: { defaultEnabled?: boolean },
): { name: string; version: string; firstInstall: boolean; dest: string }

export function fetchPlugin(
  plugin: PluginPin,
  outDir: string,
  options?: { cacheDir?: string },
): string

export function fetchWorkspacePlugin(plugin: PluginPin, outDir: string): string

export function productionInstallDependencies(
  deps?: Record<string, string>,
): Record<string, string>

export function isSeedPayloadPath(
  relativePath: string,
  options?: { includeModules?: boolean },
): boolean

export function pruneSeedModuleBins(dir: string): void
