#!/usr/bin/env node
/**
 * JSON CLI for installed Harness and Node discovery.
 * @module @deepseek-ai/dsh-installed-runtime/cli
 */

import {
  resolveInstalledRuntime,
  type CompanionSurface,
  type RuntimeResolverOptions,
} from './index.ts'

interface CliFlags {
  companion?: string
  accepted: string[]
  runtimePath?: string
  nodePath?: string
  path?: string
}

/**
 * Parse the discovery CLI's own flags.
 * @param argv - arguments after the script path.
 * @returns collected flag values.
 */
function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = { accepted: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    const take = (flag: string): string => {
      if (next === undefined || next.startsWith('--')) throw new Error(`${flag} requires a value`)
      i += 1
      return next
    }
    switch (arg) {
      case '--companion':
        flags.companion = take(arg)
        break
      case '--accepted':
        flags.accepted.push(take(arg))
        break
      case '--runtime-path':
        flags.runtimePath = take(arg)
        break
      case '--node-path':
        flags.nodePath = take(arg)
        break
      case '--path':
        flags.path = take(arg)
        break
      default:
        throw new Error(`unrecognized argument: ${String(arg)}`)
    }
  }
  return flags
}

/**
 * Narrow a CLI companion flag to the closed surface set.
 * @param value - raw `--companion` value.
 * @returns whether the value is `vscode` or `desktop`.
 */
function isCompanion(value: string | undefined): value is CompanionSurface {
  return value === 'vscode' || value === 'desktop'
}

/**
 * Resolve one installed runtime and write a single JSON line to stdout.
 * @returns settled after stdout is written and the process exit code is set.
 */
async function main(): Promise<void> {
  try {
    const flags = parseArgs(process.argv.slice(2))
    if (!isCompanion(flags.companion)) throw new Error('--companion must be vscode or desktop')
    if (flags.accepted.length === 0) throw new Error('--accepted is required at least once')
    const options: RuntimeResolverOptions = {}
    if (flags.runtimePath !== undefined) options.runtimePath = flags.runtimePath
    if (flags.nodePath !== undefined) options.nodePath = flags.nodePath
    if (flags.path !== undefined) options.pathValue = flags.path
    const resolved = await resolveInstalledRuntime(options, {
      acceptedPackageNames: flags.accepted,
      companion: flags.companion,
    })
    process.stdout.write(`${JSON.stringify(resolved)}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stdout.write(`${JSON.stringify({ error: message })}\n`)
    process.exitCode = 1
  }
}

void main()
