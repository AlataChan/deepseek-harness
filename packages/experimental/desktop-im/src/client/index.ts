/** Settings navigation entry for the fork-owned desktop IM integration. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { z } from 'zod'
import { snapshotSchema } from '../schema.ts'
import { ImSettings, type ImSettingsActions } from './ImSettings.tsx'
import { ImNotices, ImToast } from './ImToast.tsx'
import { NS, en, zh, type ImLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'desktop-im': ImLocaleKey }
}
/** Browser services needed by the Settings contribution. */
export const inject = ['slots', 'locale', 'connection', 'uiWorkspace']

/** Register the settings section and shell notification host.
 * @param ctx - Client plugin lifetime; registration disappears on disposal.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'desktop-im: dictionaries')
  const t = ctx.locale.bind(NS)
  const connection = ctx.get('connection') as ConnectionHandle
  const call = async (method: string, args: object, signal?: AbortSignal): Promise<unknown> => {
    const result = await connection.rpc.call('/api', method, { args }, signal)
    if (!result.ok) throw new Error('Desktop IM operation failed')
    return result.value
  }
  const notices = new ImNotices()
  const operate = async (method: string, args: object, success: ImLocaleKey) => {
    try { const row = snapshotSchema.parse(await call(`desktopIm/${method}`, args)); notices.show(success); return row }
    catch (error) { notices.show('failed'); throw error }
  }
  const actions: ImSettingsActions = {
    pickDirectory: async () => {
      try { return await ctx.uiWorkspace.pickDirectory() }
      catch (error) { notices.show('failed'); throw error }
    },
    list: async signal => z.array(snapshotSchema).parse(await call('desktopIm/list', {}, signal)),
    providers: async signal => z.array(z.object({ id: z.string() })).parse(await call('llm/listProviders', {}, signal)).map(row => row.id),
    models: async (provider, signal) => {
      const catalog = z.object({ groups: z.array(z.object({ id: z.string(), models: z.array(z.object({ id: z.string() })) })) })
        .parse(await call('session/modelCatalog', {}, signal))
      return catalog.groups.find(group => group.id === provider)?.models.map(model => model.id) ?? []
    },
    save: async (channel, config, secret) => operate('save', { channel, config, secret }, 'saved'),
    test: async channel => operate('test', { channel }, 'tested'),
    setEnabled: async (channel, enabled) => operate('setEnabled', { channel, enabled }, enabled ? 'enabled' : 'disabled'),
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'desktop-im', order: 12, label: () => t('nav'), locale: NS,
    inject: () => ({ actions }),
  }, ImSettings))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'desktop-im-notices', locale: NS, inject: () => ({ notices }),
  }, ImToast))
}
