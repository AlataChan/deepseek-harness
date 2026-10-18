/** Redirect only the fixed Codex command while preserving the mounted process owner. */
import { fileURLToPath } from 'node:url'

/** Fixture plugin identity. */
export const name = 'codex-partial-answer-subprocess'
/** The real process owner remains mounted and supplies lifecycle operations. */
export const inject = ['subprocess']

/** Install and restore the exact subprocess seam intercepted by the scenario. */
export function apply(ctx) {
  ctx.effect(() => {
    const owner = ctx.subprocess
    const prior = Object.getOwnPropertyDescriptor(owner, 'spawn')
    const original = owner.spawn
    const redirected = (spec) => {
      const [node, wrapper, command, stdio] = spec.argv
      if (node !== process.execPath || typeof wrapper !== 'string'
        || !wrapper.replaceAll('\\', '/').endsWith('/@openai/codex/bin/codex.js')
        || command !== 'app-server' || stdio !== '--stdio' || spec.argv.length !== 4) {
        throw new Error('codex-partial-answer: unexpected subprocess command')
      }
      return original.call(owner, {
        ...spec,
        argv: [process.execPath, fileURLToPath(new URL('./app-server-fixture.mjs', import.meta.url))],
      })
    }
    Object.defineProperty(owner, 'spawn', { configurable: true, writable: true, value: redirected })
    return () => {
      if (Object.getOwnPropertyDescriptor(owner, 'spawn')?.value !== redirected) {
        throw new Error('codex-partial-answer: subprocess fixture ownership changed')
      }
      if (prior === undefined) Reflect.deleteProperty(owner, 'spawn')
      else Object.defineProperty(owner, 'spawn', prior)
    }
  })
}
