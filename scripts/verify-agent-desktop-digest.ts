/**
 * Check staged agent-desktop assets against PIN.json.
 * `--unsigned` hashes the two binaries. `--signed` refuses that comparison
 * because codesign may change Mach-O bytes. Both modes hash LICENSE and the skill.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

interface DigestRecord {
  readonly bytes: number
  readonly sha256: string
}

/**
 * Hash the staged text assets, and the binaries only when `signed` is false.
 * @param options - plugin root and whether the binaries have been signed.
 * @returns when the requested hashes match.
 * @throws {Error} on a mismatch, or when signed mode would compare Mach-O bytes.
 */
export async function verifyAssets(options: { readonly root: string; readonly signed: boolean }): Promise<void> {
  const pin = await readPin(join(options.root, 'native', 'PIN.json'))
  await expectFile(join(options.root, 'native', 'LICENSE'), pin.license)
  await expectFile(join(options.root, 'native', 'skills', 'agent-desktop', 'SKILL.md'), pin.skill)
  if (options.signed) {
    throw new Error('desktop-operation: refusing to compare signed Mach-O bytes with the unsigned PIN')
  }
  await expectFile(join(options.root, 'native', 'agent-desktop'), pin.binaries['agent-desktop'])
  await expectFile(join(options.root, 'native', 'agent-desktop-macos-helper'), pin.binaries['agent-desktop-macos-helper'])
}

async function readPin(path: string): Promise<{
  license: DigestRecord
  skill: DigestRecord
  binaries: Record<string, DigestRecord>
}> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null) throw new Error('desktop-operation: PIN.json is not an object')
  const license = digestAt(parsed, 'license')
  const skill = digestAt(parsed, 'skill')
  if (!('binaries' in parsed) || typeof parsed.binaries !== 'object' || parsed.binaries === null) {
    throw new Error('desktop-operation: PIN.json is missing binaries')
  }
  return {
    license,
    skill,
    binaries: {
      'agent-desktop': digestAt(parsed.binaries, 'agent-desktop'),
      'agent-desktop-macos-helper': digestAt(parsed.binaries, 'agent-desktop-macos-helper'),
    },
  }
}

function digestAt(record: object, key: string): DigestRecord {
  if (!Object.hasOwn(record, key)) throw new Error(`desktop-operation: PIN.json is missing ${key}`)
  const value: unknown = Object.getOwnPropertyDescriptor(record, key)?.value
  if (typeof value !== 'object' || value === null || !('sha256' in value) || !('bytes' in value)) {
    throw new Error(`desktop-operation: PIN.json ${key} is not a digest`)
  }
  if (typeof value.sha256 !== 'string' || typeof value.bytes !== 'number') {
    throw new Error(`desktop-operation: PIN.json ${key} is not a digest`)
  }
  return { sha256: value.sha256, bytes: value.bytes }
}

async function expectFile(path: string, expected: DigestRecord | undefined): Promise<void> {
  if (expected === undefined) throw new Error(`desktop-operation: missing digest for ${path}`)
  const digest = await sha256(path)
  if (digest !== expected.sha256) throw new Error(`desktop-operation: ${basename(path)} digest mismatch: ${digest}`)
}

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path).on('error', reject).on('data', (chunk) => { hash.update(chunk) }).on('end', () => { resolve(hash.digest('hex')) })
  })
}

function argument(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  const value = process.argv[index + 1]
  if (index < 0 || value === undefined || value.startsWith('--')) return undefined
  return value
}

const entry = process.argv[1]
if (entry !== undefined && (basename(entry) === 'verify-agent-desktop-digest.ts' || basename(entry) === 'verify-agent-desktop-digest.js')) {
  const signed = process.argv.includes('--signed')
  const unsigned = process.argv.includes('--unsigned')
  const root = argument('--root')
  if (root === undefined || signed === unsigned) {
    process.stderr.write('desktop-operation: verify requires --root and exactly one of --unsigned or --signed\n')
    process.exit(1)
  }
  void verifyAssets({ root, signed }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
