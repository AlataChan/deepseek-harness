/** VS Code Extension Development Host integration-suite entry. */

import { runExtensionIntegration } from './extension.test.ts'

/** Run the real extension-host integration assertions. */
export async function run(): Promise<void> {
  await runExtensionIntegration()
}
