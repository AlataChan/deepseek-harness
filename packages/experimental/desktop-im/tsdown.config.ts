import { isBuiltin } from 'node:module'
import { isAbsolute, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clientBundle } from '../../client/tsdown.client.ts'

const inline = /^@deepseek-ai\/dsh-(?:experimental-im-(?:feishu|dingtalk)|storage-domain|storage-sqlite)(\/|$)/

export default clientBundle('@deepseek-ai/dsh-experimental-desktop-im', ['lib/types/index.js'], {
  hostPhase: true,
  lib: {
    // Consume tsc output so parallel workspace bundling cannot read stale sibling bundles.
    alias: {
      '@deepseek-ai/dsh-experimental-im-feishu/desktop': fileURLToPath(new URL('../im-feishu/lib/types/desktop.js', import.meta.url)),
      '@deepseek-ai/dsh-experimental-im-dingtalk': fileURLToPath(new URL('../im-dingtalk/lib/types/index.js', import.meta.url)),
      '@deepseek-ai/dsh-storage-domain': fileURLToPath(new URL('../../storage/storage-domain/lib/types/index.js', import.meta.url)),
      '@deepseek-ai/dsh-storage-sqlite': fileURLToPath(new URL('../../storage/storage-sqlite/lib/types/index.js', import.meta.url)),
    },
    deps: {
    alwaysBundle: inline,
    neverBundle: (id: string) => !isBuiltin(id) && !id.startsWith('.') && !isAbsolute(id) && !win32.isAbsolute(id) && !inline.test(id),
  } },
})
