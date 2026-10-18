/** Web fixture contributing a skill for the lifetime of the enabled bundle. */
export const name = 'fixture-skill-bundle'
/** The shipped skill registry owns registration and disposal. */
export const inject = ['skills']

/** Register one discoverable skill through the real registry lifecycle. */
export function apply(ctx) {
  ctx.skills.register({
    name: 'dsh-fixture-switch',
    description: 'Listed only while the fixture bundle is enabled',
    source: 'runtime',
    content: '# Fixture skill\n',
  })
}
