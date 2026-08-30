/**
 * Reject Function constructors, direct eval, and remaining Node `process`
 * access in built desktop WebView JavaScript assets.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const FUNCTION_CONSTRUCTOR = /\bnew\s+Function\s*\(/
const DIRECT_EVAL = /\beval\s*\(/
const PROCESS_GLOBAL = /\bprocess\s*(?:\.|\[)/

/**
 * Recursively list files under `root`.
 * @param root - directory to walk.
 * @returns absolute file paths.
 */
function listFiles(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

/**
 * Scan built WebView JavaScript for CSP-forbidden constructs.
 * @param distDir - Vite output directory, usually `apps/desktop/dist`.
 * @returns one error string per violating file, naming the file.
 */
export function verifyDesktopWebviewAssets(distDir: string): string[] {
  let stat
  try {
    stat = statSync(distDir)
  } catch {
    return [`desktop WebView dist is missing: ${distDir}`]
  }
  if (!stat.isDirectory()) return [`desktop WebView dist is not a directory: ${distDir}`]
  const errors: string[] = []
  for (const file of listFiles(distDir).filter(path => path.endsWith('.js'))) {
    const source = readFileSync(file, 'utf8')
    const rel = relative(distDir, file)
    if (FUNCTION_CONSTRUCTOR.test(source) || DIRECT_EVAL.test(source)) {
      errors.push(`${rel}: WebView script contains CSP-forbidden dynamic code`)
    }
    if (PROCESS_GLOBAL.test(source)) {
      errors.push(`${rel}: WebView script contains the Node process global`)
    }
  }
  return errors
}

/**
 * Verify one dist directory and throw when any asset is rejected.
 * @param distDir - Vite output directory.
 */
export function assertDesktopWebviewAssets(distDir: string): void {
  const errors = verifyDesktopWebviewAssets(distDir)
  if (errors.length > 0) throw new Error(errors.join('\n'))
}

if (import.meta.main) {
  const dist = process.argv[2] ?? join(process.cwd(), 'apps/desktop/dist')
  assertDesktopWebviewAssets(dist)
  console.log(`verify-desktop-webview: verified ${dist}`)
}
