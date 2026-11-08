/** Explicit real-network qualification; authentication and session routes stay disabled. */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { afterEach,beforeEach,expect,it } from 'vitest'
import { AgentReachRunner } from '../src/runner.ts'
const home=process.env.AGENT_REACH_INSTALLED_HOME
const enabled=process.env.AGENT_REACH_LIVE_READ==='1' && home!==undefined
let ctx:Context
let runner:AgentReachRunner
let accountHome:string
let savedHome:string|undefined
let savedProxy:string|undefined
beforeEach(async()=>{
  if(!enabled)return
  accountHome=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reach-public-account-')))
  savedHome=process.env.HOME
  savedProxy=process.env.HTTPS_PROXY
  process.env.HOME=accountHome
  if(process.env.AGENT_REACH_TEST_PROXY_URL) process.env.HTTPS_PROXY=process.env.AGENT_REACH_TEST_PROXY_URL
  ctx=new Context()
  await ctx.plugin(LocalSubprocessRuntime).await()
  runner=new AgentReachRunner(ctx,{}, { dshHome:home })
})
afterEach(async()=>{
  if(!enabled)return
  await ctx.fiber.dispose()
  if(savedHome===undefined)delete process.env.HOME;else process.env.HOME=savedHome
  if(savedProxy===undefined)delete process.env.HTTPS_PROXY;else process.env.HTTPS_PROXY=savedProxy
  await fs.rm(accountHome,{ recursive:true,force:true })
})
function resultText(value:unknown):string{return JSON.stringify(value).slice(0,1600)}
it.skipIf(!enabled)('qualifies live V2EX hot discovery and topic reading with a clean account home',async()=>{
  const hot=await runner.query({ channel:'v2ex',action:'hot',params:{ limit:1 },timeoutMs:30000 })
  expect(hot.ok,resultText(hot)).toBe(true)
  const target=hot.items[0]?.url
  expect(target,resultText(hot)).toMatch(/^https:\/\//)
  const read=await runner.query({ channel:'v2ex',action:'read',params:{ target },timeoutMs:30000 })
  expect(read.ok,resultText(read)).toBe(true)
  expect(read.items.length).toBeGreaterThan(0)
},65000)
it.skipIf(!enabled)('qualifies live Bilibili native metadata reading without importing browser credentials',async()=>{
  const result=await runner.query({ channel:'bilibili',action:'read',backend:'bili-cli',params:{ target:'BV1GJ411x7h7' },timeoutMs:30000 })
  expect(result.ok,resultText(result)).toBe(true)
  expect(result.items.length).toBeGreaterThan(0)
},35000)
it.skipIf(!enabled)('qualifies actual YouTube subtitle content with a clean account home',async()=>{
  const result=await runner.query({ channel:'youtube',action:'subtitle',backend:'yt-dlp',params:{ target:'https://www.youtube.com/watch?v=iG9CE55wbtY',lang:'en' },timeoutMs:30000 })
  expect(result.ok,resultText(result)).toBe(true)
  expect(result.items.some(item=>(item.text?.length??0)>100),resultText(result)).toBe(true)
},35000)
