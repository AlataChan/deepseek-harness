/** Test-only client for the descriptor/UID probe; no application or model code. */
import { createConnection } from 'node:net'
import { createInterface } from 'node:readline'
const [path, mode, expectedUid] = process.argv.slice(2)
if (!path || !['deny', 'hold', 'second'].includes(mode)) throw new Error('Invalid probe invocation')
const socket = createConnection(path)
const timer = setTimeout(() => { socket.destroy(); throw new Error('Socket probe timed out') }, 10000)
socket.on('error', error => {
  clearTimeout(timer)
  if (mode === 'deny' && error.code === 'EACCES') console.log('denied:EACCES')
  else { console.error('Unexpected socket error:', error.code); process.exitCode = 1 }
})
socket.on('connect', () => {
  if (mode === 'deny') {
    clearTimeout(timer)
    socket.destroy()
    throw new Error('An unauthorized UID connected')
  }
})
let identity
let pong = false
const lines = createInterface({ input: socket })
lines.on('error', error => {
  // readline forwards the socket error already handled by the client above.
  if (!(mode === 'deny' && error.code === 'EACCES')) process.exitCode = 1
})
lines.on('line', line => {
  if (line.startsWith('identity:')) {
    if (mode === 'second') throw new Error('A second runtime instance was admitted')
    const [, uid, pid] = line.split(':')
    if (uid !== expectedUid) throw new Error('Runtime UID mismatch')
    identity = { uid: Number(uid), pid: Number(pid) }
    socket.write('ping\n')
  } else if (line === 'pong') {
    pong = true
    socket.write('child\n')
  } else if (line.startsWith('child:') && identity && pong) {
    clearTimeout(timer)
    console.log(JSON.stringify({ ...identity, childPid: Number(line.slice('child:'.length)) }))
    process.stdin.resume()
    process.stdin.once('end', () => { socket.end() })
  } else throw new Error('Malformed descriptor probe response')
})
socket.on('close', () => {
  clearTimeout(timer)
  lines.close()
  if (mode === 'hold' && !identity) process.exitCode = 1
  if (mode === 'second') console.log('second:refused')
})
