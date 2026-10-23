/** Independently approved ownership obligations for the selective compatibility intake. */
import type { BackportEntry } from './upstream-intake-registry.ts'

/** Whole-release integration stays at alpha.1 while selected rc.2 changes are adapted. */
export const COMPATIBILITY_BASE_PIN = 'dsh-v0.2.1-alpha.1'

/** Required exact ownership, independent of the records the intake runner validates. */
export const COMPATIBILITY_ITEMS: Readonly<Record<string, readonly string[]>> = {
  C3: [
    'packages/llm/llm-deepseek/src/models.ts',
    'packages/llm/llm-deepseek/tests/adapter.spec.ts',
    'packages/llm/llm-deepseek/tests/runtime.spec.ts',
    'packages/llm/llm-deepseek/README.md',
    'packages/llm/llm-deepseek/README.zh.md',
    'packages/llm/llm-deepseek/README.i18n.yaml',
    'apps/web/tests/flash-default-catalog.e2e.ts', 'tsconfig.host.json', 'apps/web/tsconfig.json',
    'apps/web/tests/expected/flash-default-catalog/picker.expected.md',
  ],
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
    'vendor/cordis/package.json',
    'vendor/cosmokit/package.json',
    'vendor/group/package.json',
    'vendor/hmr/package.json',
    'vendor/include/package.json',
    'vendor/loader/package.json',
    'vendor/logger-console/package.json',
    'vendor/schemastery/package.json',
    'vendor/timer/package.json',
    'vendor/timer/locale/en.json', 'vendor/timer/locale/zh.json', 'pnpm-lock.yaml', 'vendor/README.md',
    'scripts/upstream-compatibility-policy.ts', 'scripts/verify-upstream-intake.ts',
    'scripts/upstream-compatibility-release.spec.ts', 'scripts/verify-upstream-intake.spec.ts',
    'packages/boot/plugin-manager/tests/manager.spec.ts',
    'apps/cli/package.json',
    'packages/boot/app-boot/package.json',
    'packages/boot/hmr/package.json',
    'apps/cli/README.md',
    'apps/cli/README.zh.md',
    'apps/cli/README.i18n.yaml',
    'packages/boot/app-boot/README.md',
    'packages/boot/app-boot/README.zh.md',
    'packages/boot/app-boot/README.i18n.yaml',
    'packages/boot/hmr/README.md',
    'packages/boot/hmr/README.zh.md',
    'packages/boot/hmr/README.i18n.yaml',
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
