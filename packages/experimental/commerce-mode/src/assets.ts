/** Packaged commerce-mode sample asset access across source and built layouts. */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** Packaged fictional sample filenames. */
export type SampleFilename = 'products.csv' | 'orders.csv' | 'inventory.csv'

/**
 * Read one fictional sample beside the source or built entry directory.
 * @param filename - fixed packaged sample filename.
 * @returns sample bytes.
 */
export function readPackagedSample(filename: SampleFilename): Promise<Buffer> {
  return readFile(fileURLToPath(new URL(`../samples/${filename}`, import.meta.url)))
}
