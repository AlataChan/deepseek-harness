/** The launcher limit preserves unmeasured state and admits complete rows. */
import { expect, it } from 'vitest'
import { panelCapacity } from '../src/client/panel-capacity.ts'

it.each([
  { height: 0, previous: 6, expected: 6 },
  { height: 0, previous: 2, expected: 2 },
  { height: 1, previous: 6, expected: 1 },
  { height: 323, previous: 6, expected: 1 },
  { height: 367, previous: 6, expected: 1 },
  { height: 368, previous: 6, expected: 2 },
  { height: 544, previous: 2, expected: 6 },
])('uses $expected launchers for height=$height with previous=$previous', ({ height, previous, expected }) => {
  expect(panelCapacity(height, previous)).toBe(expected)
})
