/** Filesystem authentication for administrator-owned systemd tenant sockets. */
import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

/** Validated deployment coordinates; group membership identifies the ingress process. */
export interface SystemdTenantSocketPolicy {
  readonly socketPath: string
  readonly root: string
  readonly groupId: number
}

/**
 * Refuse replaceable paths, unexpected owners/groups and permissive socket modes.
 * @param policy - Fixed administrator registry entry, never a message-supplied path.
 * @returns Completion only for root-owned canonical ancestors and the exact protected socket.
 */
export async function verifySystemdTenantSocket(policy: SystemdTenantSocketPolicy): Promise<void> {
  const { root, socketPath, groupId } = policy
  if (!isAbsolute(root) || resolve(root) !== root || root === '/' || !Number.isSafeInteger(groupId) || groupId < 0) {
    throw new Error('Systemd IPC requires a canonical protected root and an explicit group')
  }
  const rel = relative(root, socketPath)
  if (!isAbsolute(socketPath) || resolve(socketPath) !== socketPath || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Tenant socket is outside the protected systemd root')
  }
  if (await fs.realpath(socketPath) !== socketPath) throw new Error('Systemd socket ancestors must not contain symlinks')
  for (let path = dirname(socketPath); ; path = dirname(path)) {
    const directory = await fs.lstat(path)
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== 0 || (directory.mode & 0o022) !== 0) {
      throw new Error('Systemd socket directory must be root-owned and protected against replacement')
    }
    if (path === root || !relative(root, path).startsWith('..')) {
      if ((directory.mode & 0o777) !== 0o750 || directory.gid !== groupId) {
        throw new Error('Dedicated systemd socket directories require root:ingress-group mode 0750')
      }
    }
    if (path === '/') break
  }
  const socket = await fs.lstat(socketPath)
  if (!socket.isSocket() || socket.uid !== 0 || socket.gid !== groupId || (socket.mode & 0o777) !== 0o660) {
    throw new Error('Systemd tenant socket requires root:ingress-group ownership and mode 0660')
  }
}
