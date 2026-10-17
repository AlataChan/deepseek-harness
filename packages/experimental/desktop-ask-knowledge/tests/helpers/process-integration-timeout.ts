/** Process integration waits for owned child exit and honors larger coverage-lane budgets. */
export const PROCESS_INTEGRATION_TIMEOUT = Math.max(
  30_000,
  Number(process.env.DSH_COVERAGE_TEST_TIMEOUT_MS ?? 30_000),
)
