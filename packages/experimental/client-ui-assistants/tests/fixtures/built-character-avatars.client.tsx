/** Browser smoke for the emitted plugin factory, its actual React peers and injected CSS. */
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { createRoot } from 'react-dom/client'
import type { TeamCreationModalProps } from '../../src/client/TeamCreationModal.tsx'
import type { AssistantLocaleKey } from '../../src/client/locales.ts'

interface BuiltExports {
  TeamCreationModal: React.ComponentType<TeamCreationModalProps>
  zh: Record<AssistantLocaleKey, string>
  registerUi: typeof import('../../src/client/mount.ts').registerUi
}

/**
 * Load the emitted plugin against its actual React peers without connecting to a Host.
 * @returns the plugin exports.
 */
export async function loadBuiltAssistantPlugin(): Promise<BuiltExports> {
  const previous = Object.getOwnPropertyDescriptor(window, '__ModuleLoader__')
  const peers: Readonly<Record<string, unknown>> = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    '@deepseek-ai/dsh-client-ui-primitives': primitives,
  }
  let built: BuiltExports | undefined
  Object.defineProperty(window, '__ModuleLoader__', {
    configurable: true,
    value: { load: (descriptor: { factory: (require: (id: string) => unknown) => BuiltExports }) => {
      built = descriptor.factory((id) => {
        const peer = peers[id]
        if (peer === undefined) throw new Error(`Unexpected built fixture dependency: ${id}`)
        return peer
      })
    } },
  })
  const script = document.createElement('script')
  try {
    await new Promise<void>((resolve, reject) => {
      script.onload = () => { resolve() }
      script.onerror = () => { reject(new Error('Failed to load emitted avatar bundle')) }
      script.src = '/packages/experimental/client-ui-assistants/lib/client.js'
      document.head.appendChild(script)
    })
  } finally {
    script.remove()
    if (previous) Object.defineProperty(window, '__ModuleLoader__', previous)
    else Reflect.deleteProperty(window, '__ModuleLoader__')
  }
  if (!built) throw new Error('Emitted plugin did not register its factory')
  return built
}

/**
 * Mount the emitted TeamCreationModal with no Host connection or persisted profiles.
 * @returns Disposer for the isolated React root and its mount container.
 */
export async function mountBuiltCharacterAvatars(): Promise<() => void> {
  const { TeamCreationModal, zh } = await loadBuiltAssistantPlugin()
  const dictionary: Readonly<Record<string, string>> = zh
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const dispose = () => { root.unmount(); container.remove() }
  root.render(<TeamCreationModal isOpen profiles={[]} onClose={dispose} onCreateTeam={async () => {}}
    t={key => dictionary[key] ?? key} />)
  return dispose
}
