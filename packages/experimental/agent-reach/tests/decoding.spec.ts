/** Malformed catalog and CLI envelopes are rejected before they become model-visible facts. */
import { expect,it } from 'vitest'
import raw from '../runtime-contract.json' with { type:'json' }
import { decodeRuntimeContract,buildSafeArgv,validateConfig } from '../src/catalog.ts'
import { decodeUpstreamWire,parseUpstreamJson,scrubUrl } from '../src/result.ts'
const param={ name:'target',help:'Input',required:true,type:'string' }
const backend={ name:'native',sideEffects:[] }
const action=(params:unknown=[param],backends:unknown=[backend])=>({ name:'read',help:'Read',params,backends })
const channel=(actions:unknown=[action()])=>({ name:'test',description:'Fixture',level:'default',actions })
for(const [name,value] of [
  ['null catalog',null],['invalid upstream',{ ...raw,upstream:{ schemaVersion:2 } }],['missing channels',{ ...raw,channels:null }],
  ['null channel',{ ...raw,channels:[null] }],['invalid channel',{ ...raw,channels:[{}] }],
  ['invalid actions',{ ...raw,channels:[channel(null)] }],['null action',{ ...raw,channels:[channel([null])] }],
  ['invalid action',{ ...raw,channels:[channel([{}])] }],['missing parameters',{ ...raw,channels:[channel([action(null)])] }],
  ['null parameter',{ ...raw,channels:[channel([action([null])])] }],['invalid parameter',{ ...raw,channels:[channel([action([{}])])] }],
  ['missing backends',{ ...raw,channels:[channel([action([],null)])] }],['null backend',{ ...raw,channels:[channel([action([],[null])])] }],
  ['invalid backend',{ ...raw,channels:[channel([action([],[{}])])] }],
  ['unknown effects',{ ...raw,channels:[channel([action([],[{ name:'native',sideEffects:['unclassified'] }])])] }],
] as const){it(`rejects ${name}`,()=>{expect(()=>decodeRuntimeContract(value)).toThrow()})}
const envelope={ schema_version:1,ok:true,channel:'web',action:'read',items:[],meta:{ elapsed_ms:1,attempts:[] } }
for(const [name,patch] of [
  ['schema',{ schema_version:'1' }],['success status',{ ok:'true' }],['channel',{ channel:12 }],['action',{ action:12 }],
  ['backend',{ backend:12 }],['items',{ items:{} }],['missing items',{ items:null }],['missing meta',{ meta:null }],
  ['attempt list',{ meta:{ attempts:'bad' } }],['attempt primitive',{ meta:{ attempts:[null] } }],
  ['attempt field',{ meta:{ attempts:[{ backend:12 }] } }],['access object',{ meta:{ access:[] } }],
  ['access mode',{ meta:{ access:{ mode:'admin' } } }],['access completeness',{ meta:{ access:{ completeness_verified:'yes' } } }],
  ['elapsed time',{ meta:{ elapsed_ms:-1 } }],['completeness',{ meta:{ completeness_verified:'yes' } }],
  ['error object',{ error:[] }],['error fields',{ error:{ code:12,message:'bad' } }],
] as const){it(`rejects malformed wire ${name}`,()=>{expect(()=>decodeUpstreamWire({ ...envelope,...patch })).toThrow()})}
it('rejects invalid JSON and retains bounded scrubbed diagnostics',()=>{
  const result=parseUpstreamJson('{not-json','Cookie: secret=value','web','read',100)
  expect(result.error?.code).toBe('MALFORMED_OUTPUT')
  expect(JSON.stringify(result)).not.toContain('secret=value')
  expect(scrubUrl('not a URL token=private')).not.toContain('private')
})
it('retains valid attempt summaries and observed native scope without leaking extra payloads',()=>{
  const result=parseUpstreamJson(JSON.stringify({ ...envelope,meta:{ elapsed_ms:2,attempts:[{},'first',{ backend:'native',status:'done',result:'OK',error:'',elapsed_ms:2,raw:'private' }],access:{ mode:'native',completeness_verified:true } } }),'','web','read')
  expect(result.accessScope).toBe('native')
  expect(result.meta.attempts).toEqual(['first','backend=native status=done result=OK error= elapsed=2ms'])
  expect(JSON.stringify(result)).not.toContain('private')
})
for(const key of ['queryTimeoutMs','setupTimeoutMs','maxConcurrentQueries','maxStdoutBytes','maxStderrBytes','maxOutputChars','maxItems','terminateGraceMs']){
  it(`rejects out-of-range ${key}`,()=>{expect(validateConfig({ [key]:-1 }).valid).toBe(false)})
}
it('never treats leading-option user text as CLI flags',()=>{
  const result=buildSafeArgv({ channel:'youtube',action:'read',params:{ target:'--help' } })
  expect(result).toEqual({ ok:true,argv:['youtube','read','--','--help'] })
  expect(buildSafeArgv({ channel:'youtube',action:'search',params:{ query:'x',limit:0 } }).ok).toBe(false)
  expect(buildSafeArgv({ channel:'youtube',action:'search',params:{ query:'x',limit:1.2 } }).ok).toBe(false)
})

it('does not tell the model to call a hidden installer',async()=>{
  const { reachGuidance }=await import('../src/guidance.ts')
  expect(reachGuidance(true)).toContain('reach_setup')
  expect(reachGuidance(false)).not.toContain('reach_setup')
  expect(reachGuidance(false)).toContain('administrator-managed')
})
