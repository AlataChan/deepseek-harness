/** Independently approved ownership obligations for the selective compatibility intake. */
import type { BackportEntry } from './upstream-intake-registry.ts'

/** Whole-release integration stays at alpha.1 while selected rc.2 changes are adapted. */
export const COMPATIBILITY_BASE_PIN = 'dsh-v0.2.1-alpha.1'

/** Required exact ownership, independent of the records the intake runner validates. */
export const COMPATIBILITY_ITEMS: Readonly<Record<string, readonly string[]>> = {
  C1: [
    ...['cordis', 'cosmokit', 'group', 'hmr', 'include', 'loader', 'logger-console', 'schemastery', 'timer']
      .map(name => `vendor/${name}/package.json`),
    'vendor/timer/locale/en.json', 'vendor/timer/locale/zh.json', 'pnpm-lock.yaml', 'vendor/README.md',
    'scripts/upstream-compatibility-policy.ts', 'scripts/verify-upstream-intake.ts',
    'scripts/upstream-compatibility-release.spec.ts', 'scripts/verify-upstream-intake.spec.ts',
    'packages/boot/plugin-manager/tests/manager.spec.ts',
  ],
}

/**
 * Validate approved compatibility ownership and the retained release pin.
 * @param entries - selected backport records from the live registry.
 * @param wholeReleasePin - whole-release baseline from the live registry.
 * @returns missing item/path records and unauthorized pin changes.
 */
export function compatibilityOwnershipViolations(entries: readonly BackportEntry[], wholeReleasePin: string): string[] {
  const failures: string[] = []
  if (wholeReleasePin !== COMPATIBILITY_BASE_PIN) {
    failures.push(`compatibility intake: whole-release pin must remain ${COMPATIBILITY_BASE_PIN}`)
  }
  for (const [id, paths] of Object.entries(COMPATIBILITY_ITEMS)) {
    const entry = entries.find(candidate => candidate.id === id)
    if (!entry) {
      failures.push(`${id}: required compatibility backport is missing`)
      continue
    }
    for (const path of paths) {
      if (!entry.paths.includes(path)) failures.push(`${id}: missing compatibility ownership for ${path}`)
    }
  }
  return failures
}
