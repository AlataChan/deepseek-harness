/** Interactive smoke of the emitted assistant navigation and identity components. */
import { Context } from '@deepseek-ai/cordis'
import { useState, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AssistantConversation, AssistantProfile, CreateAssistantConversationOptions } from '@deepseek-ai/dsh-experimental-assistant-registry/types'
import { loadBuiltAssistantPlugin } from './built-character-avatars.client.tsx'
import '../../../../client/ui-theme/src/styles/base.css'

interface Entry {
  component: ComponentType<object>
  inject?: ((sessionId?: SessionId) => object) | undefined
}

/**
 * Mount built Hero, workspace chooser, and identity dock over an isolated service model.
 * @returns async disposer releasing the plugin and React root.
 */
export async function mountBuiltConversationLaunch(): Promise<() => Promise<void>> {
  const built = await loadBuiltAssistantPlugin()
  const dictionary: Readonly<Record<string, string>> = built.zh
  const t = (key: string) => dictionary[key] ?? key
  const ctx = new Context()
  const entries = new Map<string, Entry>()
  const sid = 'workspace-session' as SessionId
  const profile: AssistantProfile = { id: 'assistant-smoke' as AssistantProfile['id'], name: '社区助理',
    responsibility: '社区服务与文案', revision: 1, avatar: 'character:sea-whale', createdAt: 1, updatedAt: 1 }
  const workspace = { workspaceId: 'workspace', title: '示例工作区', path: '/example/project', sessionIds: [sid] }
  let workspaceFirst = false
  let binding: AssistantConversation | undefined
  const operations: string[] = []
  let repaint = () => {}
  ctx.reflect.provide('sessions', { list: { getSnapshot: () => ({ phase: 'ready', ids: workspaceFirst ? [sid] : [], byId: {
    [sid]: { id: sid, blank: true, running: false, cwd: workspace.path, retainedBy: { mainView: 1 } },
  } }) }, create: async () => { operations.push(`create:${sid}`); return sid } })
  const snapshot = { phase: 'ready', items: [workspace] }
  ctx.reflect.provide('workspaces', { list: { getSnapshot: () => snapshot, subscribe: () => () => {} },
    create: async () => workspace })
  let navigation = new AbortController()
  ctx.reflect.provide('layout', { beginNavigation: () => {
    navigation.abort(); navigation = new AbortController(); return navigation.signal
  } })
  ctx.reflect.provide('uiWorkspace', { pickDirectory: async () => null, openSession: (id: SessionId) => {
    operations.push(`open:${id}`); repaint()
  } })
  ctx.reflect.provide('locale', { register: () => () => {}, bind: () => t })
  ctx.reflect.provide('slots', {
    inject: (_name: string, register: () => void) => { register() },
    register: (options: { name: string; id?: string; inject?: Entry['inject'] }, component: Entry['component']) => {
      entries.set(options.id ?? options.name, { component, inject: options.inject })
      return () => { entries.delete(options.id ?? options.name) }
    },
  })
  built.registerUi(ctx, {
    listProfiles: async () => [profile], getProfile: async () => profile, getAvailableModels: async () => [],
    getConversationBySession: async () => binding,
    createConversation: async (id, options?: CreateAssistantConversationOptions) => {
      if (options?.rootSessionId !== sid) throw new Error('Workspace Session identity lost')
      binding = { id: 'conversation' as AssistantConversation['id'], profileId: id, rootSessionId: sid, createdAt: 1, updatedAt: 1 }
      operations.push(`bind:${sid}:${id}`)
      return binding
    },
  })
  const required = (id: string): Entry => {
    const entry = entries.get(id)
    if (!entry) throw new Error(`Built registration missing: ${id}`)
    return entry
  }
  const hero = required('assistants.hero-card')
  const chooser = required('assistants.workspace-choice')
  const identity = required('assistants.identity')
  const Hero = hero.component
  const Chooser = chooser.component
  const Identity = identity.component
  const heroProps = { ...hero.inject?.(), t }
  const chooserProps = { ...chooser.inject?.(), t }
  const identityProps = { ...identity.inject?.(sid), t }
  function Frame() {
    const [, setRevision] = useState(0)
    repaint = () => { setRevision(value => value + 1) }
    return <section className="picker-card" style={{ maxWidth: 680, margin: '24px auto' }}>
      <h2>智能体与工作区选择</h2>
      <button onClick={() => { workspaceFirst = true; operations.push('workspace:selected'); repaint() }}>先选择示例工作区</button>
      <Hero {...heroProps} />
      <Identity {...identityProps} />
      <output data-testid="launch-operations">{operations.join('\n')}</output>
      <Chooser {...chooserProps} />
    </section>
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  root.render(<Frame />)
  return async () => { root.unmount(); container.remove(); await ctx.fiber.dispose() }
}
