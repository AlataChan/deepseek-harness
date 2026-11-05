/** Sidebar launcher capacity from the measured column height. */

/**
 * Retain the previous capacity until the column has a positive measured height.
 * @param height - current column client height.
 * @param previous - capacity retained during unavailable layout.
 * @returns at least one launcher for positive height, otherwise the previous capacity.
 */
export function panelCapacity(height: number, previous: number): number {
  return height > 0 ? Math.max(1, Math.floor((height - 280) / 44)) : previous
}
