import { fileURLToPath } from 'node:url'
import { clientLibrary, staticLinked } from '../tsdown.client.ts'

const ID = '@deepseek-ai/dsh-client-connection-desktop'

/** Node Host apply plus a browser-safe transport re-export (no `dsh.client` row). */
export default (inline: { env?: { DSH_BUILD_FACE?: string } }) => [
  ...clientLibrary(ID, ['lib/types/index.js'])(inline).map(config => ({
    ...config,
    plugins: [{
      name: 'desktop-process-emitted-input',
      resolveId(source: string) {
        if (source !== '@deepseek-ai/dsh-client-connection-process') return null
        return fileURLToPath(new URL('../connection-process/lib/types/index.js', import.meta.url))
      },
    }],
  })),
  ...staticLinked(ID, ['lib/types/client/desktop-transport.js'])(inline),
]
