/** Sign every embedded Mach-O file before sealing the enclosing application. */
import { closeSync, lstatSync, openSync, readSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * Find native code by file header, including extensionless helpers and universal binaries.
 * @param root - physical application contents directory.
 * @returns native regular files, without following framework aliases.
 */
export function machOFiles(root: string): string[] {
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name)
      const stat = lstatSync(path)
      if (stat.isDirectory()) visit(path)
      else if (stat.isFile()) {
        const fd = openSync(path, 'r')
        const header = Buffer.alloc(8)
        let size: number
        try { size = readSync(fd, header, 0, 8, 0) } finally { closeSync(fd) }
        if (size < 4) continue
        const magic = header.readUInt32BE(0)
        const thin = [0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe].includes(magic)
        const universal = [0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic)
        const count = size === 8 ? ([0xbebafeca, 0xbfbafeca].includes(magic) ? header.readUInt32LE(4) : header.readUInt32BE(4)) : 0
        if (thin || (universal && count > 0 && count <= 32)) files.push(path)
      }
    }
  }
  visit(root)
  return files
}

/**
 * Find nested code bundles in signing order without following aliases.
 * @param root - physical contents directory.
 * @returns inner bundles before their containers.
 */
export function nestedCodeBundles(root: string): string[] {
  const bundles: string[] = []
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name)
      if (!lstatSync(path).isDirectory()) continue
      visit(path)
      if (/\.(app|framework|xpc|appex)$/.test(name)) bundles.push(path)
    }
  }
  visit(root)
  return bundles
}

/**
 * Prepare all embedded native code for readiness without importing signing credentials.
 * The downloaded Node executable retains its verified signature until public signing.
 * @param app - assembled application directory.
 */
export function prepareDesktopMachO(app: string): void {
  const node = join(app, 'Contents/Resources/resources/node')
  const verifiedNode = spawnSync('/usr/bin/codesign', ['--verify', '--strict', node], { encoding: 'utf8' })
  if (verifiedNode.status !== 0) throw new Error(`Cannot verify downloaded Node: ${verifiedNode.stderr}`)
  const contents = join(app, 'Contents')
  for (const path of [...machOFiles(contents), ...nestedCodeBundles(contents)]) {
    if (path === node) continue
    const signed = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', path], { encoding: 'utf8' })
    if (signed.status !== 0) throw new Error(`Cannot prepare native code: ${path}: ${signed.stderr}`)
    const verified = spawnSync('/usr/bin/codesign', ['--verify', '--strict', path], { encoding: 'utf8' })
    if (verified.status !== 0) throw new Error(`Cannot verify prepared native code: ${path}: ${verified.stderr}`)
  }
}

/**
 * Sign native leaves with hardened runtime and verify the expected Developer ID team.
 * @param app - assembled application directory.
 * @param identity - explicitly selected Developer ID identity.
 * @param team - expected Developer ID team.
 * @param entitlements - entitlements for the embedded Node runtime.
 */
export function signDesktopMachO(app: string, identity: string, team: string, entitlements: string): void {
  if (!identity || !team) throw new Error('Developer ID identity and team are required')
  const node = join(app, 'Contents/Resources/resources/node')
  const contents = join(app, 'Contents')
  for (const path of [...machOFiles(contents), ...nestedCodeBundles(contents)]) {
    const args = ['--force', '--sign', identity, '--options', 'runtime', '--timestamp']
    if (path === node) args.push('--entitlements', entitlements)
    const signed = spawnSync('/usr/bin/codesign', [...args, path], { encoding: 'utf8' })
    if (signed.status !== 0) throw new Error(`Signing native code failed: ${path}: ${signed.stderr}`)
    const verified = spawnSync('/usr/bin/codesign', ['--verify', '--strict', path], { encoding: 'utf8' })
    const detail = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', path], { encoding: 'utf8' })
    if (verified.status !== 0 || detail.status !== 0 || !detail.stderr.split('\n').includes(`TeamIdentifier=${team}`)
      || !/flags=.*runtime/.test(detail.stderr) || !/^Timestamp=/m.test(detail.stderr)) {
      throw new Error(`Native code lacks the required Developer ID, runtime or timestamp: ${path}`)
    }
  }
}
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [app, identity, team, entitlements] = process.argv.slice(2)
  if (app === '--prepare' && identity) prepareDesktopMachO(identity)
  else {
    if (!app || !identity || !team || !entitlements) throw new Error('Expected app, identity, team and Node entitlements')
    signDesktopMachO(app, identity, team, entitlements)
  }
}
