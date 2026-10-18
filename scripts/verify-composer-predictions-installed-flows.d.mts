/** Type declarations for the standalone installed composer verifier. */

/**
 * Validate installed files before product execution.
 * @param target - installed app or resource directory; omission is refused.
 * @returns validated installed metadata consumed by the JavaScript verifier.
 */
export function validateInstalledTarget(target?: string): unknown

/**
 * Select installed runtime and platform system utility directories.
 * @param node - validated absolute path to the installed Node executable.
 * @returns executable search path without inherited developer directories.
 */
export function installedVerificationPath(node: string): string

/**
 * Exercise composer predictions using the installed runtime and synthetic loopback traffic.
 * @param target - installed app or resource directory.
 * @returns number of completed acceptance checks.
 */
export function verifyInstalledPredictions(target: string): Promise<number>
