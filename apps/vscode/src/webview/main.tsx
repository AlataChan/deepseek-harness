/** VS Code Webview bootstrap; the only module allowed to acquire the VS Code API. */

import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import {
  createVerifiedBundleLoader,
  installBootGraph,
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
const carrier = new WebviewCarrierPort(api, boot.maxLogicalRpcBytes)
const ide = new WebviewIdePort(api)
const root = document.getElementById('root')
if (root === null) throw new Error('VS Code Webview is missing #root')
const entry = new AppWebEntry(root, {
  loadBundle: createVerifiedBundleLoader(boot.graph),
  configureContext: (ctx) => {
    ctx.reflect.provide('vscodeBridge', carrier)
    ctx.reflect.provide('vscodeIde', ide)
  },
})
window.addEventListener('unload', () => { carrier.dispose(); ide.dispose(); entry.dispose() }, { once: true })
void entry.run().catch((error: unknown) => {
  root.textContent = error instanceof Error ? error.message : String(error)
})
