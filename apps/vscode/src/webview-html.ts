/** Strict VS Code Webview document and inert bootstrap metadata. */

import type { ClientBootGraph } from '@deepseek-ai/dsh-client-modules/client'

/** Validated facts consumed before the Webview Client graph boots. */
export interface WebviewBoot {
  /** Graph whose bundle URLs already point at the verified cache. */
  graph: ClientBootGraph
  /** VS Code display locale. */
  locale: string
  /** Companion-announced logical RPC capacity. */
  maxLogicalRpcBytes: number
}

/** Inputs that remain under extension-host control. */
export interface WebviewHtmlOptions {
  /** Initial boot facts encoded as inert base64 metadata. */
  boot: WebviewBoot
  /** Per-Webview CSP source supplied by VS Code. */
  cspSource: string
  /** External Vite-built bootstrap URI. */
  scriptUri: string
  /** External Vite-built shell stylesheet URI. */
  styleUri?: string
  /** Localized document title. */
  title: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** Map the VS Code display locale to the two shipped Client locale ids. */
export function normalizeVsCodeLocale(locale: string): 'zh' | 'en' {
  return locale.trim().toLowerCase().split('-')[0] === 'zh' ? 'zh' : 'en'
}

/**
 * Create a Webview document with no executable inline content.
 * Client plugin styles are injected at runtime, so style-src permits inline
 * style while script-src remains external-only and eval-free.
 * @param options - CSP source, external entry URI, localized title, and boot facts.
 * @returns complete HTML document.
 */
export function createWebviewHtml(options: WebviewHtmlOptions): string {
  const boot = Buffer.from(JSON.stringify(options.boot), 'utf8').toString('base64')
  const csp = [
    "default-src 'none'",
    `img-src ${options.cspSource} data: https:`,
    `font-src ${options.cspSource}`,
    `style-src ${options.cspSource} 'unsafe-inline'`,
    `script-src ${options.cspSource}`,
    "connect-src 'none'",
  ].join('; ')
  return '<!doctype html>\n'
    + `<html lang="${normalizeVsCodeLocale(options.boot.locale)}">\n`
    + '<head>\n'
    + '  <meta charset="UTF-8">\n'
    + '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    + `  <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">\n`
    + `  <meta name="dsh-vscode-boot" content="${boot}">\n`
    + `  <title>${escapeHtml(options.title)}</title>\n`
    + (options.styleUri === undefined ? '' : `  <link rel="stylesheet" href="${escapeAttribute(options.styleUri)}">\n`)
    + '</head>\n'
    + '<body>\n'
    + '  <div id="root"></div>\n'
    + `  <script type="module" src="${escapeAttribute(options.scriptUri)}"></script>\n`
    + '</body>\n'
    + '</html>\n'
}

/**
 * Decode the inert boot metadata from a generated document for boundary tests.
 * @param html - output from {@link createWebviewHtml}.
 * @returns the decoded boot facts.
 */
export function decodeWebviewBoot(html: string): WebviewBoot {
  const match = /<meta name="dsh-vscode-boot" content="([A-Za-z0-9+/=]+)">/.exec(html)
  if (match?.[1] === undefined) throw new Error('VS Code Webview boot metadata is missing')
  return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')) as WebviewBoot
}
