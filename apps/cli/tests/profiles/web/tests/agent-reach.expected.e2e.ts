/** Packed bundle installation and offline first-use through the shipped Web profile. */
import { spawn } from 'node:child_process'
import { mkdtemp,mkdir,writeFile,rm,readdir,copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect,it } from 'vitest'
const repo=fileURLToPath(new URL('../../../../../../',import.meta.url))
it.skipIf(!process.env.AGENT_REACH_PACKED_PLUGIN)('mounts packed Agent-Reach in a real profile with no external runtime or download',async (test)=>{
  const directory=await mkdtemp(join(tmpdir(),'reach-packed-profile-'))
  test.onTestFinished(()=>rm(directory,{ recursive:true,force:true }))
  const workspace=join(directory,'workspace')
  await mkdir(workspace)
  const home=join(directory,'home')
  const env={ ...process.env,DSH_HOME:home,DSH_AGENTS_HOME:join(directory,'agents'),DEEPSEEK_API_KEY:'keyless-no-model-calls',DSH_TELEMETRY_DISABLED:'1' }
  const launch=(args:string[],ipc=false)=>{
    const child=spawn(process.env.AGENT_REACH_NODE ?? process.execPath,[process.env.AGENT_REACH_DSH_BIN ?? join(repo,'apps/cli/lib/bin.js'),...args],{ cwd:workspace,env,stdio:ipc?['ignore','pipe','pipe','ipc']:['ignore','pipe','pipe'] })
    let output=''
    for(const stream of [child.stdout,child.stderr]) stream?.on('data',(chunk)=>{output=(output+String(chunk)).slice(-30000)})
    const done=new Promise<number|null>((resolve,reject)=>{child.once('close',resolve);child.once('error',reject)})
    test.onTestFinished(async()=>{
      if(child.exitCode===null && child.signalCode===null) child.kill('SIGTERM')
      const deadline=setTimeout(()=>{if(child.exitCode===null && child.signalCode===null)child.kill('SIGKILL')},5000)
      try{await done}finally{clearTimeout(deadline)}
    })
    return { child,done,output:()=>output }
  }
  const archive=join(directory,'plugin.tgz')
  await copyFile(process.env.AGENT_REACH_PACKED_PLUGIN!,archive)
  const install=launch(['plugin','--profile','web','add',archive])
  expect(await install.done,install.output()).toBe(0)
  const patch=join(directory,'probe.patch.yml')
  await writeFile(patch,JSON.stringify([{ insert:[{ id:'reach-smoke',name:new URL('./fixtures/agent-reach.mjs',import.meta.url).href }] }]))
  const host=launch(['--profile','web','--patch',patch,'--port','0','--no-open'],true)
  try {
    await expect.poll(()=>{if(host.child.exitCode!==null)throw new Error(host.output());return host.output().includes('dsh web: http://')},{ timeout:60000 }).toBe(true)
  }catch(error){throw new Error(String(error)+'\n'+host.output())}
  const received=new Promise<unknown>((resolve,reject)=>{
    const timeout=setTimeout(()=>{reject(new Error('Profile probe timed out\n'+host.output()))},10000)
    test.onTestFinished(()=>{ clearTimeout(timeout) })
    host.child.once('message',(value:unknown)=>{
      clearTimeout(timeout)
      if(typeof value==='object'&&value!==null&&'error' in value) reject(new Error(String(value.error)))
      else resolve(value)
    })
  })
  host.child.send('inspect')
  const observation: unknown = await received
  expect(observation).toHaveProperty('result.tools',expect.arrayContaining(['reach_channels','reach_status','reach_query','reach_setup']))
  expect(observation).toMatchObject({ result:{
    status:{ value:{ ok:false,error:{ code:'NEED_SETUP' } } },blocked:{ value:{ ok:false,error:{ code:'SESSION_ROUTE_FORBIDDEN' } } },
    preview:{ value:{ ok:true,status:'planned' } },spawns:0 } })
  expect(await readdir(home)).not.toContain('runtimes')
  host.child.kill('SIGTERM')
  await host.done
},120000)
