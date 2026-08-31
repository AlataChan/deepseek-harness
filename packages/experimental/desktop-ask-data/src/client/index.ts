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
import { AskDataChip } from './AskDataChip.tsx'
import type { AskDataChipInjected } from './AskDataChip.tsx'
import { DataSourcePage } from './DataSourcePage.tsx'
import type { DataSourcePageRemotes, ListedPreview } from './DataSourcePage.tsx'
import { en, zh, type AskDataKey } from './locales.ts'

export type { AskDataChipInjected, AskDataChipProps } from './AskDataChip.tsx'
export type { DataSourcePageProps, ListedPreview, ListedSource } from './DataSourcePage.tsx'
export type { AskDataKey } from './locales.ts'
export { encodeAskDataBytes, readFileBytes } from './bytes.ts'
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

/** Services required by the ask-data occupant. */
export const inject = ['slots', 'remote', 'remote.session', 'locale']

/**
 * Register the 问数 chip. The gate occupant is registered only while open.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'desktop-ask-data: dictionaries')
  ctx.inject(['conversation', 'sessions', 'agentPresetSeat'], (scope: ClientContext) => {
    const seat = scope.get('agentPresetSeat') as AgentPresetSeatFace
    let gateDispose: (() => void) | undefined
    let previousPreset = 'standard'
    let lastNonAskPreset = 'standard'

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
        createAdvanced: request => session.create({
          ...request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId },
          agentPreset: 'data-agent',
        }),
      }
    }

    const currentSession = () => {
      const state = scope.sessions.list.getSnapshot()
      return state.current === undefined ? undefined : state.byId[state.current]
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
          openSession: (sessionId: string) => void
          currentBlankSessionId?: string
          workspaceId?: string
        } => {
          const current = currentSession()
          return {
            ...remotes(),
            ...current?.blank === true ? { currentBlankSessionId: current.id } : {},
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
            openSession: (sessionId) => { scope.sessions.open(SessionId(sessionId)) },
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
      const binding = session?.projectionValues?.askDataBinding
      if (
        preset === 'data-agent'
        && session?.blank === true
        && (binding === undefined || binding === null)
        && gateDispose === undefined
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
