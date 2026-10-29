/** Source-launch test fixture holding one POSIX writer lease until process death. */
import { ImWriterLease } from '../../src/writer-lease.ts'
const directory = process.argv[2]
if (!directory) throw new Error('Missing fixture directory')
const lease = await ImWriterLease.acquire(directory)
process.stdout.write('holding\n')
process.stdin.resume()
process.stdin.once('end', () => { void lease.release().then(() => { process.exitCode = 0 }) })
