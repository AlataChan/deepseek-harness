/** Refuse a publication handoff that differs from the user's original reviewed JSON. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validatePublicationPlan, type DesktopPublicationPlan } from './desktop-release-publish.ts'

/**
 * Compare the immutable handoff bytes with the explicit workflow input before any write.
 * @param reviewed - original reviewed JSON input.
 * @param handoff - downloaded qualification handoff bytes.
 * @returns validated reviewed publication plan.
 */
export function verifyReviewedPlanHandoff(reviewed: string | undefined, handoff: Uint8Array): DesktopPublicationPlan {
  if (!reviewed || !Buffer.from(reviewed, 'utf8').equals(Buffer.from(handoff))) throw new Error('Qualification handoff differs from the original reviewed plan JSON')
  return validatePublicationPlan(JSON.parse(reviewed))
}
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  if (!file) throw new Error('Expected qualification handoff path')
  verifyReviewedPlanHandoff(process.env.DSH_REVIEWED_PLAN, readFileSync(file))
}
