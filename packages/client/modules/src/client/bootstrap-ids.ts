/** Bootstrap bundle identities shared by every Client surface adapter. */

import type { ClientModuleLoaderTarget } from './manifest.ts'
import type { ClientModuleSystem } from './system.ts'

/** Bundle whose factory constructs the Client module system. */
export const CLIENT_MODULES_ID = '@deepseek-ai/dsh-client-modules'

/** Dynamic runtime bundle required before the shell creates Client entries. */
export const CLIENT_RUNTIME_ID = '@deepseek-ai/dsh-client-runtime'

/** Client bundle rows every surface executes before its shell entry. */
export const PARSER_PRELOAD_IDS = [CLIENT_MODULES_ID, CLIENT_RUNTIME_ID] as const

/**
 * Create the registration queue that every Client surface installs before its bootstrap bundles run.
 * @returns a queue facade that materializes the parser-preloaded module-system bundle on `create()`.
 */
export function createClientModuleLoaderFacade(): ClientModuleLoaderTarget {
  const pendingQueue: ClientModuleLoaderTarget['pendingQueue'] = []
  const target: ClientModuleLoaderTarget = {
    mode: 'queue',
    pendingQueue,
    load(registration) { pendingQueue.push(registration) },
    create(options): ClientModuleSystem {
      if (target.mode !== 'queue') {
        throw new Error('client-modules: window.__ModuleLoader__.create called after module-system boot')
      }
      const index = pendingQueue.findIndex(registration => registration.id === CLIENT_MODULES_ID)
      const registration = pendingQueue[index]
      if (registration === undefined) {
        throw new Error(`client-modules: surface did not preload ${CLIENT_MODULES_ID}/client.js`)
      }
      pendingQueue.splice(index, 1)
      const exports: unknown = registration.factory((specifier) => {
        throw new Error(`${CLIENT_MODULES_ID}/client.js requested external "${specifier}" before the module system existed`)
      })
      if (typeof exports !== 'object' || exports === null) {
        throw new Error(`${CLIENT_MODULES_ID}/client.js did not export the bootstrap module face`)
      }
      const face = exports as Record<string, unknown>
      const create = face.createClientModuleSystem
      if (typeof face.apply !== 'function' || typeof create !== 'function') {
        throw new Error(`${CLIENT_MODULES_ID}/client.js did not export the bootstrap module face`)
      }
      return (create as (
        registrationTarget: ClientModuleLoaderTarget,
        bootstrapModule: { id: string; exports: Record<string, unknown> },
        createOptions: typeof options,
      ) => ClientModuleSystem)(target, { id: registration.id, exports: face }, options)
    },
  }
  return target
}
