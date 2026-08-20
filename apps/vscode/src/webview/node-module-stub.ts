/** Browser stand-in for the vendored Loader's unreachable node:module branch. */

/** Throw if the configured browser Loader ever attempts Node module resolution. */
export const createRequire = (): never => {
  throw new Error('node:module is not available in the VS Code Webview')
}

/** Erased type peer for the vendored Loader import. */
export type LoadHookContext = never
