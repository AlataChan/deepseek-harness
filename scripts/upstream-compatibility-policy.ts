/** Independently approved ownership obligations for the selective compatibility intake. */
import type { BackportEntry } from './upstream-intake-registry.ts'

/** Whole-release integration stays at alpha.1 while selected rc.2 changes are adapted. */
export const COMPATIBILITY_BASE_PIN = 'dsh-v0.2.1-alpha.1'

/** Required exact ownership, independent of the records the intake runner validates. */
export const COMPATIBILITY_ITEMS: Readonly<Record<string, readonly string[]>> = {
  C2: [
    'packages/client/ui-model-selection/src/client/slots.ts',
    'packages/client/ui-model-selection/src/client/ModelSelect.tsx',
    'packages/client/ui-model-selection/src/client/index.ts',
    'packages/client/ui-model-selection/tests/model-select.client.spec.tsx',
    'packages/client/ui-model-selection/tests/browser-plugin.client.spec.ts',
    'packages/client/ui-model-selection/README.md',
    'packages/client/ui-model-selection/README.zh.md',
    'packages/client/ui-model-selection/README.i18n.yaml',
    'docs/subsystems/slots.md',
    'docs/subsystems/slots.zh.md',
    'docs/subsystems/slots.i18n.yaml',
    'packages/extensions/cordis-client-runner/src/client/slot-catalog.ts',
    'packages/client/ui-slots/src/index.ts',
    'packages/client/ui-renderer/src/client/scoped-slots.tsx',
    'packages/client/ui-renderer/tests/inline-slots.client.spec.tsx',
    'packages/client/ui-slots/README.md',
    'packages/client/ui-slots/README.zh.md',
    'packages/client/ui-slots/README.i18n.yaml',
    'packages/client/ui-renderer/README.md',
    'packages/client/ui-renderer/README.zh.md',
    'packages/client/ui-renderer/README.i18n.yaml',
    'apps/web/tests/default-model.e2e.ts',
    'apps/web/tests/model-menu-observer.e2e.ts',
  ],
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
