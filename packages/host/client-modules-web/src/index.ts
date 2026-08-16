/**
 * @deepseek-ai/dsh-host-client-modules-web — Web transport adapter for the
 * transport-neutral Client Plugin registry. It serves discovered bundles and
 * source maps under `/plugins`, then injects the current boot graph before the
 * browser shell runs.
 * @module @deepseek-ai/dsh-host-client-modules-web
 */

import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ClientBootEntry, ClientBootGraph } from '@deepseek-ai/dsh-client-modules'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'client-modules-web'

/** Services adapted onto the Web transport. */
export const inject = ['clientModules', 'webServer']

/** Bootstrap package whose ordinary client bundle supplies the module-system implementation. */
const CLIENT_MODULES_ID = '@deepseek-ai/dsh-client-modules'

/** Dynamic package whose ordinary client bundle must be registered before plugin boot starts. */
const CLIENT_RUNTIME_ID = '@deepseek-ai/dsh-client-runtime'

/** Ordinary dynamic bundles the HTML parser executes before the Vite shell. */
const PARSER_PRELOAD_IDS = [CLIENT_MODULES_ID, CLIENT_RUNTIME_ID] as const

/** Escape a graph URL before placing it in a quoted HTML attribute. */
function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/**
 * Inject the Web boot protocol before the shell bundle runs.
 * @param html - index document source.
 * @param graph - composed Client Plugin graph.
 * @returns the document with the registration queue, bootstrap preloads, and graph.
 */
export function injectBootManifest(html: string, graph: ClientBootGraph): string {
  const json = JSON.stringify(graph).replaceAll('<', '\\u003c')
  const bootstrapId = JSON.stringify(CLIENT_MODULES_ID)
  const queue = `<script>(()=>{
const pendingQueue=[]
window.__ModuleLoader__={
  mode:"queue",
  pendingQueue,
  load(registration){pendingQueue.push(registration)},
  create(options){
    if(this.mode!=="queue")throw new Error("client-modules: window.__ModuleLoader__.create called after module-system boot")
    const index=pendingQueue.findIndex(registration=>registration.id===${bootstrapId})
    const registration=pendingQueue[index]
    if(registration===undefined)throw new Error("client-modules: HTML did not preload ${CLIENT_MODULES_ID}/client.js")
    pendingQueue.splice(index,1)
    const exports=registration.factory(specifier=>{
      throw new Error('client-modules: ${CLIENT_MODULES_ID}/client.js requested external "'+specifier+'" before the module system existed')
    })
    if(typeof exports!=="object"||exports===null||typeof exports.createClientModuleSystem!=="function"||typeof exports.apply!=="function"){
      throw new Error("client-modules: ${CLIENT_MODULES_ID}/client.js did not export the bootstrap module face")
    }
    return exports.createClientModuleSystem(this,{id:registration.id,exports},options)
  }
}
})()</script>`
  const preload = PARSER_PRELOAD_IDS.map(id => graph.entries.find(entry => entry.id === id))
    .filter((entry): entry is ClientBootEntry => entry !== undefined)
    .map(entry => `<script src="${escapeHtmlAttribute(entry.url)}"></script>`)
    .join('')
  const script = `${queue}${preload}<script>window.__DSH_BOOT__ = ${json}</script>`
  const head = html.indexOf('<head>')
  if (head !== -1) return `${html.slice(0, head + 6)}${script}${html.slice(head + 6)}`
  // Headless fixture pages may lack <head>; prepending keeps the read-before-shell ordering.
  return `${script}${html}`
}

/** Find the registered artifact behind one route id. */
function bundlePath(ctx: Context, id: string, sourceMap: boolean): string | undefined {
  const record = ctx.clientModules.bundleRecords().find(candidate => candidate.entry.id === id)
  return record === undefined ? undefined : `${record.clientPath}${sourceMap ? '.map' : ''}`
}

/** Serve one Client Plugin artifact request. */
async function serveBundle(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end()
    return
  }
  /* v8 ignore next -- `node:http` always sets `url` on server requests. */
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  // The id may contain a scope slash. Anything else under /plugins (including
  // /plugins/events when the HMR row is absent) is an unknown resource.
  const prefix = '/plugins/'
  const mapSuffix = '/client.js.map'
  const bundleSuffix = '/client.js'
  const sourceMap = pathname.startsWith(prefix) && pathname.endsWith(mapSuffix)
  const suffix = sourceMap ? mapSuffix : bundleSuffix
  const path = pathname.startsWith(prefix) && pathname.endsWith(suffix)
    ? bundlePath(ctx, pathname.slice(prefix.length, -suffix.length), sourceMap)
    : undefined
  if (path === undefined) {
    res.writeHead(404)
    res.end()
    return
  }
  try {
    const body = await readFile(path)
    res.writeHead(200, {
      'content-type': sourceMap ? 'application/json; charset=utf-8' : 'text/javascript; charset=utf-8',
      'cache-control': 'no-cache',
    })
    res.end(body)
  } catch {
    // Registered but unreadable: loud 404 beats a silent SPA-fallback HTML page.
    res.writeHead(404)
    res.end()
  }
}

/**
 * Adapt Client Plugin discovery onto the Web server.
 * @param ctx - plugin context carrying the registry and Web server.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: '/plugins',
      handler: (req, res) => serveBundle(ctx, req, res),
    }),
    'client-modules-web: bundle route',
  )
  ctx.effect(
    () => ctx.webServer.tapIndex(html => injectBootManifest(html, ctx.clientModules.graph())),
    'client-modules-web: boot manifest injection',
  )
}
