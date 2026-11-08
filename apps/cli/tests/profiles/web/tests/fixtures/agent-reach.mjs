/** Keyless real-profile assertions; no model request or dependency installer runs. */
export const inject = ['agents','agentPresets','tools','subprocess']
export function apply(ctx) {
  const receive = () => {
    void inspect().then(result=>process.send({result}),error=>process.send({error:String(error.stack ?? error)}))
  }
  ctx.effect(()=>{process.on('message',receive);return ()=>process.off('message',receive)})
  async function inspect() {
    if (!ctx.get('agentReach')) throw new Error('Packed Agent-Reach provider did not activate')
    const handle = await ctx.agents.create({sessionId:'reach-packed-smoke',cwd:process.cwd(),
      setup:scope=>ctx.agentPresets.mount(scope,'standard').then(()=>undefined)})
    let spawns=0
    const original = ctx.subprocess.spawn.bind(ctx.subprocess)
    ctx.subprocess.spawn = spec=>{spawns++;return original(spec)}
    const agent=handle.agent
    agent.session.append('turn/start',{turn:1})
    const execute=(name,args)=>ctx.tools.execute({name,arguments:args,agent,callId:name,signal:new AbortController().signal})
    try {
      const tools=ctx.tools.schemas(agent).map(tool=>tool.name)
      const channels=await execute('reach_channels',{})
      const status=await execute('reach_status',{})
      const blocked=await execute('reach_query',{channel:'bilibili',action:'subtitle',params:{target:'BV1GJ411x7h7'}})
      const preview=await execute('reach_setup',{channel:'v2ex',action:'hot',planOnly:true})
      return {tools,channels,status,blocked,preview,spawns}
    } finally {
      ctx.subprocess.spawn=original
      agent.session.append('turn/end',{turn:1,reason:{kind:'completed'}})
      await handle.dispose()
    }
  }
}
