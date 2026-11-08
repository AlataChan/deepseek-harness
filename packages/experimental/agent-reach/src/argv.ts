/** Encode classified CLI parameter values without choosing routes or executables. */
import type { ParamDefinition } from './catalog.ts'

/**
 * Encode one validated action's values into flags and positional arguments.
 * @param definitions - Parameter declarations selected by the fixed route catalog.
 * @param params - Untrusted caller values for that action.
 * @returns Classified argument strings or a parameter diagnostic.
 */
export function encodeActionParameters(definitions:readonly ParamDefinition[],params:Record<string,unknown>):
  { ok:true;flags:string[];positionals:string[] } | { ok:false;error:string } {
  const flags:string[]=[]
  const positionals:string[]=[]
  for (const paramDef of definitions) {
    const hasValue = Object.prototype.hasOwnProperty.call(params, paramDef.name)
    const val = hasValue ? params[paramDef.name] : paramDef.default

    if (val === undefined || val === null) {
      if (paramDef.required) {
        return { ok: false, error: `Missing required parameter "${paramDef.name}"` }
      }
      continue
    }

    if (paramDef.type === 'number') {
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        return { ok: false, error: `Parameter "${paramDef.name}" must be a finite number, received ${typeof val}` }
      }
      if (paramDef.name === 'limit' && (!Number.isInteger(val) || val < 1 || val > 1000)) {
        return { ok: false, error: `Parameter "${paramDef.name}" must be an integer between 1 and 1000: ${val}` }
      }
      if (paramDef.required) {
        positionals.push(String(val))
      } else {
        flags.push(`--${paramDef.name}`, String(val))
      }
    } else if (paramDef.type === 'boolean') {
      if (typeof val !== 'boolean') {
        return { ok: false, error: `Parameter "${paramDef.name}" must be a boolean, received ${typeof val}` }
      }
      if (paramDef.required) {
        positionals.push(String(val))
      } else if (val) {
        flags.push(`--${paramDef.name}`)
      }
    } else {
      // string
      if (typeof val !== 'string') {
        return { ok: false, error: `Parameter "${paramDef.name}" must be a string, received ${typeof val}` }
      }
      if (paramDef.required) {
        positionals.push(val)
      } else {
        flags.push(`--${paramDef.name}`, val)
      }
    }
  }

  return { ok:true,flags,positionals }
}
