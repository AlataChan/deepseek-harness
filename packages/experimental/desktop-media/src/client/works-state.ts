/**
 * Shared open flag for the Works button and overlay.
 * @module @deepseek-ai/dsh-experimental-desktop-media/client/works-state
 */

type Listener = () => void

let open = false
const listeners = new Set<Listener>()

/**
 * Whether the Works overlay is open.
 * @returns current open flag.
 */
export function worksOpen(): boolean {
  return open
}

/**
 * Open or close the Works overlay.
 * @param next - next open flag.
 */
export function setWorksOpen(next: boolean): void {
  if (open === next) return
  open = next
  for (const listener of listeners) listener()
}

/**
 * Subscribe to Works open-flag changes.
 * @param listener - called after the flag changes.
 * @returns disposer.
 */
export function subscribeWorks(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
