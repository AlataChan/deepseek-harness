/** Fake sqlite3 executable for load-probe and storage-failure tests. */

import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Write a Node script that prints `version`, refuses the three safe-mode probes
 * unless `unsafeProbe` names one to accept, and fails every other invocation.
 * @param dir - owned directory that receives the executable.
 * @param version - text printed for `-version`.
 * @param unsafeProbe - probe statement fragment the fake accepts, if any.
 * @returns absolute executable path.
 */
export async function writeFakeSqlite(dir: string, version: string, unsafeProbe?: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const executable = join(dir, 'sqlite3')
  const body = `#!${process.execPath}
const { writeFileSync } = require('node:fs')
const args = process.argv.slice(2)
if (args[0] === '-version') {
  process.stdout.write(${JSON.stringify(`${version} 2026-01-01\n`)})
  process.exit(0)
}
const sql = args.at(-1) ?? ''
const unsafeProbe = ${JSON.stringify(unsafeProbe)}
if (unsafeProbe !== undefined && sql.includes(unsafeProbe)) {
  if (unsafeProbe === 'writefile') {
    const match = /writefile\\('([^']+)'/iu.exec(sql)
    if (match !== null) writeFileSync(match[1], 'x')
  }
  process.exit(0)
}
if (sql.includes('readfile')) process.stderr.write('cannot use the readfile() function in safe mode\\n')
else if (sql.includes('writefile')) process.stderr.write('cannot use the writefile() function in safe mode\\n')
else if (sql.includes('ATTACH')) process.stderr.write('cannot run ATTACH in safe mode\\n')
process.exit(1)
`
  await writeFile(executable, body)
  await chmod(executable, 0o755)
  return executable
}
