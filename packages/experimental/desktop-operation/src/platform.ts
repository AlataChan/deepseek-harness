/**
 * Supported host for the pinned agent-desktop binary.
 * @module @deepseek-ai/dsh-experimental-desktop-operation/platform
 */

/**
 * Whether this process tuple can spawn the pinned binary.
 * @param platform - `process.platform` or a test tuple.
 * @param arch - `process.arch` or a test tuple.
 * @returns true only for macOS Apple Silicon.
 */
export function isDesktopOperationPlatform(platform: NodeJS.Platform, arch: string): boolean {
  return platform === 'darwin' && arch === 'arm64'
}
