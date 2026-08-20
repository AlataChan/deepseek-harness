/** VS Code Webview bootstrap; the only module allowed to acquire the VS Code API. */

import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import {
  createVerifiedBundleLoader,
  installBootGraph,
  installWebviewModuleLoader,
  preloadWebviewBootstrap,
  readWebviewBoot,
  WebviewCarrierPort,
  WebviewIdePort,
  type AcquiredVsCodeApi,
} from './vscode-port.ts'

declare const acquireVsCodeApi: () => AcquiredVsCodeApi

const api = acquireVsCodeApi()
const boot = readWebviewBoot(document)
document.documentElement.lang = boot.locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
installBootGraph(boot.graph)
installWebviewModuleLoader()
const carrier = new WebviewCarrierPort(api, boot.maxLogicalRpcBytes)
const ide = new WebviewIdePort(api)
const root = document.getElementById('root')
if (root === null) throw new Error('VS Code Webview is missing #root')
const loadBundle = createVerifiedBundleLoader(boot.graph)
let entry: AppWebEntry | undefined
let disposed = false
window.addEventListener('unload', () => {
  disposed = true
  carrier.dispose()
  ide.dispose()
  void entry?.dispose()
}, { once: true })
void preloadWebviewBootstrap(boot.graph, loadBundle).then(async () => {
  if (disposed) return
  entry = new AppWebEntry(root, {
    loadBundle,
    configureContext: (ctx) => {
      ctx.reflect.provide('vscodeBridge', carrier)
      ctx.reflect.provide('vscodeIde', ide)
    },
  })
  await entry.run()
}).catch((error: unknown) => {
  if (!disposed) root.textContent = error instanceof Error ? error.message : String(error)
})
