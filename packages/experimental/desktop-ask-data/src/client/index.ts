/**
 * Browser half of 问数: hero chip plus a root-scope data-source gate.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-host-ask-data/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { AskDataChip } from './AskDataChip.tsx'
import type { AskDataChipInjected } from './AskDataChip.tsx'
import { DataSourcePage } from './DataSourcePage.tsx'
import { OctopusBrandName } from './OctopusBrandName.tsx'
import { OctopusHeroHeadline } from './OctopusHeroHeadline.tsx'
import { OctopusMark } from './OctopusMark.tsx'
import { WorkspaceFolderRow } from './WorkspaceFolderRow.tsx'
import type { DataSourcePageRemotes, ListedPreview } from './DataSourcePage.tsx'
import './chrome.css'
import { en, zh, type AskDataKey } from './locales.ts'

export type { AskDataChipInjected, AskDataChipProps } from './AskDataChip.tsx'
export type { DataSourcePageProps, ListedPreview, ListedSource } from './DataSourcePage.tsx'
export type { OctopusMarkProps } from './OctopusMark.tsx'
export { OctopusMark } from './OctopusMark.tsx'
export { OctopusBrandName } from './OctopusBrandName.tsx'
export type { OctopusHeroHeadlineProps } from './OctopusHeroHeadline.tsx'
export { OctopusHeroHeadline } from './OctopusHeroHeadline.tsx'
export type { WorkspaceFolderRowProps } from './WorkspaceFolderRow.tsx'
export { WorkspaceFolderRow } from './WorkspaceFolderRow.tsx'
export type { AskDataKey } from './locales.ts'
export { encodeAskDataBytes, readFileBytes } from './bytes.ts'
export {
  ASK_DATA_TEMPLATE_CSV, ASK_DATA_TEMPLATE_FILENAME, offerAskDataTemplate,
  type AskDataTemplateOffer,
} from './template.ts'
export { LIMIT_LOCALES, LIMIT_SURFACE_KEYS, limitSurface, requiredLimitIds } from './limits-copy.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Ask-data overlay copy. */
    'desktop-ask-data': AskDataKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'desktop-ask-data'

/** Conversation-scoped seat used to hold/apply the data-agent preset. */
interface AgentPresetSeatFace {
  stage(id: string, opts?: { hold?: boolean; introduce?: boolean }): void
  select(id: string): Promise<string | undefined>
  clearStage(): void
}

/** One row from `sessions.list` as read by the ask-data occupant. */
interface ListedSession {
  id: string
  blank?: boolean
  projectionValues?: {
    agentPreset?: string
    askDataBinding?: unknown
  }
}

/**
 * Whether this session would otherwise auto-open the data-source page.
 * @param session - current list row.
 * @returns true for a blank unbound data-agent session.
 */
function isUnboundBlankDataAgent(session: ListedSession | undefined): session is ListedSession {
  if (session?.blank !== true) return false
  if (session.projectionValues?.agentPreset !== 'data-agent') return false
  return boundSourceId(session) === undefined
}

/**
 * Source id already bound on this list row, if any.
 * @param session - current list row.
 * @returns the bound source id, or undefined when unbound.
 */
function boundSourceId(session: ListedSession | undefined): string | undefined {
  const binding = session?.projectionValues?.askDataBinding
  if (typeof binding !== 'object' || binding === null) return undefined
  if (!('sourceId' in binding)) return undefined
  const { sourceId } = binding
  return typeof sourceId === 'string' ? sourceId : undefined
}

/**
 * Whether commit may reuse this Session instead of creating one.
 * @param session - current list row.
 * @returns true for a blank Session with no ask-data bind.
 */
function isReusableBlankSession(session: ListedSession | undefined): session is ListedSession {
  if (session?.blank !== true) return false
  return boundSourceId(session) === undefined
}

/** Services required by the ask-data occupant. */
export const inject = ['slots', 'remote', 'remote.session', 'locale']

/**
 * Register the 问数 chip, brand chrome, headline, and workspace-folder
 * settings row. The gate occupant is registered only while open.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'desktop-ask-data: dictionaries')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.register({ name: 'sidebar.brand.mark' }, OctopusMark))
  ctx.slots.inject('sidebar.brand.name', () =>
    ctx.slots.register({ name: 'sidebar.brand.name' }, OctopusBrandName))
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark' }, OctopusMark))
  ctx.slots.inject('conversation.hero.headline', () =>
    ctx.slots.register({ name: 'conversation.hero.headline', locale: NS }, OctopusHeroHeadline))
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-workspace-folder',
    order: 5,
    locale: NS,
  }, WorkspaceFolderRow))
  ctx.inject(['conversation', 'sessions', 'agentPresetSeat'], (scope: ClientContext) => {
    const seat = scope.get('agentPresetSeat') as AgentPresetSeatFace
    let gateDispose: (() => void) | undefined
    let previousPreset = 'standard'
    let lastNonAskPreset = 'standard'
    const advancedEscapeIds = new Set<string>()

    const currentSession = (): ListedSession | undefined => {
      const state = scope.sessions.list.getSnapshot() as {
        current?: string
        byId: Record<string, ListedSession>
      }
      return state.current === undefined ? undefined : state.byId[state.current]
    }

    const remotes = (): DataSourcePageRemotes => {
      const session = scope.remote.session as unknown as {
        listAskDataSources: (signal?: AbortSignal) => ReturnType<DataSourcePageRemotes['listSources']>
        importAskDataSpreadsheet: DataSourcePageRemotes['importSpreadsheet']
        importAskDataSample: DataSourcePageRemotes['importSample']
        commitAskData: DataSourcePageRemotes['commit']
        create: (request: { workspaceId?: string; agentPreset?: string }) => ReturnType<DataSourcePageRemotes['createAdvanced']>
      }
      return {
        listSources: signal => session.listAskDataSources(signal),
        importSpreadsheet: (request, signal) => session.importAskDataSpreadsheet(request, signal),
        importSample: signal => session.importAskDataSample(signal),
        commit: (request, signal) => session.commitAskData(request, signal),
        createAdvanced: (request) => {
          const current = currentSession()
          if (isUnboundBlankDataAgent(current)) {
            return Promise.resolve({ ok: true, value: { sessionId: current.id } })
          }
          return session.create({
            ...request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId },
            agentPreset: 'data-agent',
          })
        },
      }
    }

    const closeGate = (): void => {
      gateDispose?.()
      gateDispose = undefined
    }

    const registerGate = (): void => {
      if (gateDispose !== undefined) return
      gateDispose = scope.slots.register({
        name: 'conversation.askData.gate',
        locale: NS,
        inject: (): DataSourcePageRemotes & {
          cancel: () => Promise<void>
          onCommitted: (sessionId: string) => void
          onAdvanced: (sessionId: string) => void
          currentBlankSessionId?: string
          currentBound?: { sessionId: string; sourceId: string }
          workspaceId?: string
        } => {
          const current = currentSession()
          const boundId = boundSourceId(current)
          return {
            ...remotes(),
            ...isReusableBlankSession(current) ? { currentBlankSessionId: current.id } : {},
            ...current !== undefined && boundId !== undefined
              ? { currentBound: { sessionId: current.id, sourceId: boundId } }
              : {},
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
            onAdvanced: (sessionId) => {
              advancedEscapeIds.add(sessionId)
              seat.clearStage()
              closeGate()
              scope.sessions.open(SessionId(sessionId))
            },
          }
        },
      }, DataSourcePage)
    }

    const openFromChip = (): void => {
      previousPreset = lastNonAskPreset
      seat.stage('data-agent', { hold: true })
      registerGate()
    }

    const stopList = scope.sessions.list.subscribe(() => {
      const session = currentSession()
      const preset = session?.projectionValues?.agentPreset
      if (typeof preset === 'string' && preset !== 'data-agent') lastNonAskPreset = preset
      if (
        isUnboundBlankDataAgent(session)
        && gateDispose === undefined
        && !advancedEscapeIds.has(session.id)
      ) {
        previousPreset = lastNonAskPreset
        registerGate()
      }
    })

    const chip = scope.slots.register({
      name: 'conversation.hero.askData',
      locale: NS,
      inject: (): AskDataChipInjected => ({ openGate: openFromChip }),
    }, AskDataChip)

    return () => {
      stopList()
      closeGate()
      chip()
    }
  })
}

export type { ListedPreview as AskDataListedPreview }
