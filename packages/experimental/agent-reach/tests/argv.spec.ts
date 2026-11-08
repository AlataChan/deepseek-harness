/** Classified parameter encoding is independent of platform route permission. */
import { expect,it } from 'vitest'
import { encodeActionParameters } from '../src/argv.ts'
import type { ParamDefinition } from '../src/catalog.ts'
function parameter(type:ParamDefinition['type'],required:boolean,name='value'):ParamDefinition{return { name,type,required,help:'Fixture' }}
it('keeps positional strings behind the route separator and classifies optional flags',()=>{
  expect(encodeActionParameters([parameter('string',true)],{ value:'--help' })).toEqual({ ok:true,flags:[],positionals:['--help'] })
  expect(encodeActionParameters([parameter('number',true)],{ value:12 })).toEqual({ ok:true,flags:[],positionals:['12'] })
  expect(encodeActionParameters([parameter('boolean',true)],{ value:false })).toEqual({ ok:true,flags:[],positionals:['false'] })
  expect(encodeActionParameters([parameter('boolean',false)],{ value:false })).toEqual({ ok:true,flags:[],positionals:[] })
  expect(encodeActionParameters([parameter('boolean',false)],{ value:true })).toEqual({ ok:true,flags:['--value'],positionals:[] })
  expect(encodeActionParameters([parameter('string',false)],{ value:'en' })).toEqual({ ok:true,flags:['--value','en'],positionals:[] })
  expect(encodeActionParameters([parameter('number',false)],{ value:3 })).toEqual({ ok:true,flags:['--value','3'],positionals:[] })
})
it('uses declared defaults while distinguishing absent and explicit null values',()=>{
  expect(encodeActionParameters([{ ...parameter('string',false),default:'en' }],{})).toEqual({ ok:true,flags:['--value','en'],positionals:[] })
  expect(encodeActionParameters([parameter('string',false)],{})).toEqual({ ok:true,flags:[],positionals:[] })
  expect(encodeActionParameters([parameter('string',true)],{ value:null }).ok).toBe(false)
  expect(encodeActionParameters([parameter('string',false)],{ value:null })).toEqual({ ok:true,flags:[],positionals:[] })
})
it('rejects invalid primitive values and out-of-range result counts',()=>{
  for(const value of [true,NaN,Infinity,'12'])expect(encodeActionParameters([parameter('number',true)],{ value }).ok).toBe(false)
  expect(encodeActionParameters([parameter('boolean',false)],{ value:'true' }).ok).toBe(false)
  expect(encodeActionParameters([parameter('string',false)],{ value:12 }).ok).toBe(false)
  for(const limit of [0,1001,1.2])expect(encodeActionParameters([parameter('number',false,'limit')],{ limit }).ok).toBe(false)
  expect(encodeActionParameters([parameter('number',false,'limit')],{ limit:2 }).ok).toBe(true)
})
