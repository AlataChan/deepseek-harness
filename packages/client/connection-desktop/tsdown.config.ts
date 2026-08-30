import { clientLibrary, staticLinked } from '../tsdown.client.ts'

const ID = '@deepseek-ai/dsh-client-connection-desktop'

/** Node Host apply plus a browser-safe transport re-export (no `dsh.client` row). */
export default (inline: { env?: { DSH_BUILD_FACE?: string } }) => [
  ...clientLibrary(ID, ['lib/types/index.js', 'lib/types/invariant.js'])(inline),
  ...staticLinked(ID, ['lib/types/client/desktop-transport.js'])(inline),
]
