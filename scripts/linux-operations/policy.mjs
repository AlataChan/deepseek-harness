/** Root-owned deployment policy and strict requests for the Linux operations broker. */
import { readFileSync, realpathSync, statSync } from 'node:fs'

/** Reject unrecognized fields at the JSON request boundary. */
export function fields(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object')
  if (Object.keys(value).some(key => ![...required, ...optional].includes(key))) throw new Error('Unknown field')
  if (required.some(key => !Object.hasOwn(value, key))) throw new Error('Missing field')
  return value
}

/** Validate finite deployment limits and fixed administrator-owned target maps. */
export function validatePolicy(value) {
  fields(value, ['socket', 'state', 'ingressDatabase', 'bindingKey', 'operatorId', 'tenantId', 'services',
    'containers', 'wechatRoot', 'wechatConfig', 'wechatRecipientAlias', 'limits'])
  for (const key of ['socket', 'state', 'ingressDatabase', 'wechatRoot', 'wechatConfig']) {
    if (typeof value[key] !== 'string' || !value[key].startsWith('/')) throw new Error('Expected absolute deployment path')
  }
  const binding = JSON.parse(value.bindingKey)
  if (!Array.isArray(binding) || binding.length !== 5 || binding[0] !== 'feishu') throw new Error('Invalid binding')
  for (const key of ['operatorId', 'tenantId', 'wechatRecipientAlias']) {
    if (typeof value[key] !== 'string' || !value[key].trim()) throw new Error('Missing identity')
  }
  for (const unit of Object.values(value.services)) {
    if (typeof unit !== 'string' || !/^[a-zA-Z0-9_.@-]+\.service$/.test(unit)) throw new Error('Invalid unit')
  }
  if (!Array.isArray(value.containers) || value.containers.some(name => !/^[a-zA-Z0-9_-]+$/.test(name))) throw new Error('Invalid container')
  fields(value.limits, ['logLines', 'previewSeconds', 'workerPollSeconds', 'maxTextBytes', 'commandSeconds'])
  const bounds = { logLines: [10, 200], previewSeconds: [60, 1800], workerPollSeconds: [2, 30], maxTextBytes: [64, 4096], commandSeconds: [5, 60] }
  for (const [key, [low, high]] of Object.entries(bounds)) {
    if (!Number.isSafeInteger(value.limits[key]) || value.limits[key] < low || value.limits[key] > high) throw new Error(`Invalid limit ${key}`)
  }
  return value
}

/** Load policy only from its root-owned, non-symlinked private directory. */
export function readPolicy(path) {
  if (realpathSync(path) !== path) throw new Error('Policy symlink refused')
  const metadata = statSync(path)
  if (metadata.uid !== 0 || (metadata.mode & 0o022)) throw new Error('Policy must be root owned and not writable by others')
  return validatePolicy(JSON.parse(readFileSync(path, 'utf8')))
}
