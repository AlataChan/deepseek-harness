/**
 * Browser half of commerce-mode: the 电商助手 new-session chip and its source
 * gate, plus tool cards for staged, discarded, and exported commerce changes.
 * Cards derive from each call's logged arguments and result metadata; the
 * ledger line reads the `commerceSession` projection.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the conversation hero and gate slot declarations.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the keyed `tool.call.toolview` slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
// Type-only: the Session Remote namespace carrying the commerce remotes.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { CommerceChangeRow } from './CommerceChangeRow.tsx'
import { CommerceChip, type CommerceChipInjected } from './CommerceChip.tsx'
import { CommercePage, type CommercePageProps, type CommercePageRemotes } from './CommercePage.tsx'
import { en, NS, zh, type CommerceKey } from './locales.ts'
import { COMMERCE_CARD_TOOL_NAMES } from './models.ts'

export type { CommerceKey } from './locales.ts'
export type {
  CommerceListedPreview, CommerceListedSource, CommercePageProps, CommercePageRemotes, CommerceTableKind,
} from './CommercePage.tsx'
export { CommerceChip } from './CommerceChip.tsx'
export { CommercePage } from './CommercePage.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Commerce tool card and source gate copy. */
    'commerce-mode': CommerceKey
  }
}

/** Preset a commerce session runs on. */
const COMMERCE_PRESET = 'commerce'

/* jscpd:ignore-start -- parallel to desktop-ask-data's client wiring: sibling overlay plugins
   declare the same host faces and gate closures locally because a client bundle
   may not value-import another plugin's ./client */
/** Conversation-scoped seat used to hold and apply the commerce preset. */
interface CommercePresetSeat {
  stage(id: string, opts?: { hold?: boolean; introduce?: boolean }): void
  select(id: string): Promise<string | undefined>
  clearStage(): void
}

/** One row from `sessions.list` as read by the commerce occupant. */
interface ListedSession {
  id: string
  blank?: boolean
  projectionValues?: {
    agentPreset?: string
    commerceBinding?: unknown
  }
}
/* jscpd:ignore-end */

/**
 * Whether this session would otherwise sit on the commerce preset with no source.
 * @param session - current list row.
 * @returns true for a blank commerce session without a binding.
 */
function isUnboundBlankCommerce(session: ListedSession | undefined): session is ListedSession {
  if (session?.blank !== true) return false
  if (session.projectionValues?.agentPreset !== COMMERCE_PRESET) return false
  return session.projectionValues.commerceBinding == null
}

/** Required services: the slot registry, the Session Remote, and the locale registry. */
export const inject = ['slots', 'remote', 'remote.session', 'locale']

/**
 * Register the commerce dictionaries, the tool cards, and the 电商助手 chip
 * with its source gate.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'commerce-mode: dictionaries')
  for (const key of COMMERCE_CARD_TOOL_NAMES) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
      { name: 'tool.call.toolview', key, locale: NS },
      CommerceChangeRow,
    ))
  }

  ctx.inject(['conversation', 'sessions', 'agentPresetSeat'], (scope: ClientContext) => {
    const seat = scope.get('agentPresetSeat') as CommercePresetSeat
    let gateDispose: (() => void) | undefined
    let previousPreset = 'standard'
    let lastNonCommercePreset = 'standard'

    /* jscpd:ignore-start -- parallel to desktop-ask-data's client wiring: sibling overlay plugins
   declare the same host faces and gate closures locally because a client bundle
   may not value-import another plugin's ./client */
    const currentSession = (): ListedSession | undefined => {
      const state = scope.sessions.list.getSnapshot() as {
        current?: string
        byId: Record<string, ListedSession>
      }
      return state.current === undefined ? undefined : state.byId[state.current]
    }
    /* jscpd:ignore-end */

    const remotes = (): CommercePageRemotes => {
      const session = scope.remote.session as unknown as {
        listCommerceSources: CommercePageRemotes['listSources']
        listCommercePlatforms: CommercePageRemotes['listPlatforms']
        importCommerceSpreadsheet: CommercePageRemotes['importSpreadsheet']
        importCommerceSample: CommercePageRemotes['importSample']
        commitCommerce: CommercePageRemotes['commit']
      }
      return {
        listSources: signal => session.listCommerceSources(signal),
        listPlatforms: () => session.listCommercePlatforms(),
        importSpreadsheet: (request, signal) => session.importCommerceSpreadsheet(request, signal),
        importSample: signal => session.importCommerceSample(signal),
        commit: (request, signal) => session.commitCommerce(request, signal),
      }
    }

    const closeGate = (): void => {
      gateDispose?.()
      gateDispose = undefined
    }

    const registerGate = (): void => {
      if (gateDispose !== undefined) return
      gateDispose = scope.slots.register({
        name: 'conversation.commerce.gate',
        locale: NS,
        inject: (): CommercePageRemotes & Omit<CommercePageProps, keyof CommercePageRemotes | 't'> => {
          /* jscpd:ignore-start -- parallel to desktop-ask-data's client wiring: sibling overlay plugins
   declare the same host faces and gate closures locally because a client bundle
   may not value-import another plugin's ./client */
          const current = currentSession()
          return {
            ...remotes(),
            ...isUnboundBlankCommerce(current) ? { currentBlankSessionId: current.id } : {},
            cancel: async () => {
              const refusal = await seat.select(previousPreset)
              if (refusal !== undefined) return
              seat.clearStage()
              closeGate()
            },
            onCommitted: (sessionId) => {
              seat.clearStage()
              closeGate()
              scope.sessions.open(SessionId(sessionId))
            },
            /* jscpd:ignore-end */
          }
        },
      }, CommercePage)
    }

    const openFromChip = (): void => {
      previousPreset = lastNonCommercePreset
      seat.stage(COMMERCE_PRESET, { hold: true })
      registerGate()
    }

    const stopList = scope.sessions.list.subscribe(() => {
      const session = currentSession()
      const preset = session?.projectionValues?.agentPreset
      if (typeof preset === 'string' && preset !== COMMERCE_PRESET) lastNonCommercePreset = preset
      if (isUnboundBlankCommerce(session) && gateDispose === undefined) {
        previousPreset = lastNonCommercePreset
        registerGate()
      }
    })

    const chip = scope.slots.register({
      name: 'conversation.hero.commerce',
      locale: NS,
      inject: (): CommerceChipInjected => ({ openGate: openFromChip }),
    }, CommerceChip)

    return () => {
      stopList()
      closeGate()
      chip()
    }
  })
}
