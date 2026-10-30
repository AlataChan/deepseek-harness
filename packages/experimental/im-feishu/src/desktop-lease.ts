/** Cross-platform single-writer ownership for the single-user desktop adapter. */
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Separate SQLite transaction held for the complete delivery database lifetime. */
export class DesktopImLease {
  private released = false
  private constructor(private readonly database: DatabaseSync) {}

  /**
   * Refuse a concurrent desktop writer before opening delivery storage.
   * @param directory - Desktop-owned private state directory, already created.
   * @returns Lease refusing concurrent desktop owners; process death releases its database locks.
   */
  static acquire(directory: string): DesktopImLease {
    const database = new DatabaseSync(join(directory, 'ownership.sqlite'))
    try {
      // No application tables or records: SQLite owns only the process-lifetime lock.
      database.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;')
      return new DesktopImLease(database)
    } catch (error) { database.close(); throw error }
  }

  /** Close the transaction and database once; never unlink a live ownership file. */
  release(): void {
    if (this.released) return
    this.database.close()
    this.released = true
  }
}
