/** Lightweight desktop Agent-Reach payload validation. */
/**
 * Validate manifests, size and absence of eagerly bundled runtimes.
 * @param directory - Installed plugin directory.
 * @returns Inspected payload size and file count.
 */
export declare function verifyReachPayload(directory: string): { bytes: number; files: number }
