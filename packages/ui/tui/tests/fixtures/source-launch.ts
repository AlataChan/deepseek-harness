import { createElement } from 'react'
import { renderToString } from 'ink'
import { TuiApp } from '../../src/render/app.tsx'
import { createInitialState } from '../../src/state/reducer.ts'
import { createTuiStore } from '../../src/state/store.ts'

const store = createTuiStore(createInitialState({ columns: 80 }))
process.stdout.write(renderToString(createElement(TuiApp, { store })))
