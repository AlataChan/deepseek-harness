/** Product marks persisted through the Host settings document. */
export const BRAND_MARK_IDS = ['original', 'abstract', 'cartoon'] as const
/** Approved product mark identity, independent of assistant avatars. */
export type BrandMarkId = typeof BRAND_MARK_IDS[number]
/** User preference shared by the Host schema and Client settings form. */
export interface BrandSettings {
  /** Selected offline product mark. */
  brandMark: BrandMarkId
}
