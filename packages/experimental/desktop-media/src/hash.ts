/**
 * SHA-256 of a managed media file.
 * @module @deepseek-ai/dsh-experimental-desktop-media/hash
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

/**
 * Hex SHA-256 of one file.
 * @param path - absolute file path.
 * @returns lowercase hex digest.
 */
export async function sha256File(path: string): Promise<string> {
  const bytes = await readFile(path)
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Hex SHA-256 of already-read bytes.
 * @param bytes - file bytes.
 * @returns lowercase hex digest.
 */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
