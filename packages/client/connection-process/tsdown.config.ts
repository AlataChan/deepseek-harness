import { clientLibrary, staticLinked } from '../tsdown.client.ts'

const ID = '@deepseek-ai/dsh-client-connection-process'

/** Node Host apply plus browser-safe protocol/codec artifacts. */
export default (inline: { env?: { DSH_BUILD_FACE?: string } }) => [
  ...clientLibrary(ID, ['lib/types/index.js', 'lib/types/invariant.js'])(inline),
  ...staticLinked(ID, ['lib/types/protocol.js', 'lib/types/codec.js'])(inline),
]
