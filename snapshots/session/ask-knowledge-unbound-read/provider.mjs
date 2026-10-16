/** Select the real overlay entry for the snapshot harness's source or built lane. */
const mode = process.env.DSH_EXAMPLE_MODE ?? 'src'
if (mode !== 'src' && mode !== 'lib') throw new Error(`Unsupported snapshot mode: ${mode}`)
const entry = mode === 'lib' ? 'lib/index.js' : 'src/index.ts'
const { default: DesktopAskKnowledge } = await import(
  new URL(`../../../packages/experimental/desktop-ask-knowledge/${entry}`, import.meta.url).href,
)
export default DesktopAskKnowledge
