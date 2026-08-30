/** Typed face of `seed-desktop-profile-plugin.mjs` for the Host typecheck. */

export interface PluginPin {
  name: string
  version: string
  source?: 'npm' | 'workspace'
  path?: string
}

export interface PinFile {
  profile: string
  shippedBundles: string[]
  plugins: PluginPin[]
}

export function readPinFile(path?: string): PinFile

export function validatePluginDir(dir: string, expected?: PluginPin): {
  name: string
  version: string
  [key: string]: unknown
}

export function mergeProfileManifest(
  manifest: object,
  plugin: PluginPin,
  options: { firstInstall: boolean },
): {
  dsh: { profile: { bundles: string[] } }
  dependencies: Record<string, string>
  [key: string]: unknown
}

export function installPluginIntoProfile(
  src: string,
  profileDir: string,
  shippedBundles: string[],
): { name: string; version: string; firstInstall: boolean; dest: string }

export function fetchPlugin(
  plugin: PluginPin,
  outDir: string,
  options?: { cacheDir?: string },
): string

export function fetchWorkspacePlugin(plugin: PluginPin, outDir: string): string
