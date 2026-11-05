/** Parsers for the porcelain output of the read-only Git commands the panel runs. */

/**
 * Read the first line that `git rev-parse` prints for a directory query such as `--show-toplevel`.
 * @param output - stdout of the command.
 * @returns the directory.
 * @throws when the output is empty.
 */
export function parseTopLevel(output: string): string {
  const [root = ''] = output.split(/\r?\n/)
  if (root.length === 0) throw new Error('git rev-parse printed no directory')
  return root
}

/**
 * Read the first line of a one-name output such as `git symbolic-ref --short HEAD`.
 * @param output - stdout of the command.
 * @returns the name, or null when the command printed none.
 */
export function parseName(output: string): string | null {
  const [name = ''] = output.split(/\r?\n/)
  return name.length === 0 ? null : name
}

/**
 * Order worktree base branches: the checked-out branch first, then the other
 * listed branches in listed order.
 * @param current - checked-out branch, or null when HEAD is detached.
 * @param output - stdout of `git for-each-ref --format=%(refname:lstrip=2) refs/heads/`.
 * @param limit - most names to return.
 * @returns distinct branch names, at most `limit`.
 */
export function baseBranches(current: string | null, output: string, limit: number): string[] {
  const listed = output.split(/\r?\n/).filter(name => name.length > 0 && name !== current)
  return (current === null ? listed : [current, ...listed]).slice(0, limit)
}
