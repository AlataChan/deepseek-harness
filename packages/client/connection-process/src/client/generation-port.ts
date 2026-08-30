/**
 * Neutral runtime-generation reset port for {@link ProcessApiClient}.
 * @module @deepseek-ai/dsh-client-connection-process/client
 */

/** Shell-owned generation lifecycle used to reset transient carrier state. */
export interface GenerationPort {
  /**
   * Subscribe to generation-state transitions.
   * @param listener - receives the new generation state string.
   * @returns disposer for this subscription.
   */
  subscribeReset(listener: (state: string) => void): () => void
}
