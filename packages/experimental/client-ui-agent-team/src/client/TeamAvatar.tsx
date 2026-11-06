/** Offline member portraits derived from durable identity, without stored images or requests. */

import type { TeamMemberView } from '@deepseek-ai/dsh-experimental-agent-team/client'
import css from './TeamAction.module.css'

/**
 * Resolve a repeatable portrait seed; names and roster order never affect identity.
 * @param id - Durable member Session identifier.
 * @param role - Lead uses the same recognizable portrait in every team.
 * @returns An unsigned portrait seed.
 */
export function memberAvatarSeed(id: string, role: TeamMemberView['role']): number {
  let seed = 2166136261
  for (const character of role === 'lead' ? 'octopus-team-lead' : id) {
    seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0
  }
  return seed
}

/**
 * Render a lightweight decorative portrait beside the member's visible name.
 * @param props.member - Member whose durable identity selects the portrait.
 * @returns An inline SVG with no external assets or image-loading failure path.
 */
export function TeamAvatar({ member }: { member: Pick<TeamMemberView, 'id' | 'role'> }) {
  const seed = memberAvatarSeed(member.id, member.role)
  const hue = seed % 360
  const hair = ['M18 31V25C18 8 47 8 47 27L43 32V23L27 20L22 33Z', 'M15 39V26C15 7 49 7 49 27V43L42 40V25L24 23V40Z', 'M18 30C10 10 40 7 48 20L45 30L41 24L24 23L21 32Z', 'M17 32V24C17 8 49 8 48 28L43 34V23C35 28 29 18 22 24V33Z'][(seed >>> 8) % 4]
  return (
    <svg viewBox="0 0 64 64" className={css.avatar} aria-hidden="true" data-avatar-seed={seed}>
      <rect width="64" height="64" rx="22" fill={`hsl(${hue} 40% 90%)`} />
      <path d="M8 64V59C8 45 56 45 56 59V64Z" fill={`hsl(${hue} 35% 39%)`} />
      <path d="M26 39H38V49L32 54L26 49Z" fill="var(--team-avatar-skin)" />
      <path d="M18 26C18 9 47 9 47 27V32C47 51 18 51 18 32Z" fill="var(--team-avatar-skin)" />
      <path d={hair} fill="var(--team-avatar-hair)" />
      <path d="M24 32H26M38 32H40" stroke="var(--team-avatar-hair)" strokeWidth="2" strokeLinecap="round" />
      <path d="M29 39Q32 42 36 38" fill="none" stroke="var(--team-avatar-mouth)" strokeWidth="1.5" strokeLinecap="round" />
      {(member.role === 'lead' || (seed & 4096) !== 0) && <g fill="none" stroke="var(--team-avatar-hair)" strokeWidth="1.3"><rect x="20" y="28" width="10" height="8" rx="3" /><rect x="34" y="28" width="10" height="8" rx="3" /><path d="M30 31H34" /></g>}
    </svg>
  )
}
