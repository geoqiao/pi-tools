import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
const log = (value: unknown) => appendFileSync(process.env.PROBE_LOG!, JSON.stringify(value)+'\n');
export default function(pi: any) {
  pi.on('session_start',()=>{if(process.env.PROBE_NO_TOOLS==='1')pi.setActiveTools([]);});
  pi.registerTool({name:'probe_echo',label:'Probe echo',description:'Echo the exact fixture token.',
    parameters:{type:'object',properties:{text:{type:'string'}},required:['text']},
    async execute(_:string,params:{text:string}){log({type:'execute',name:'probe_echo'});return {content:[{type:'text',text:params.text}],details:{}};}
  });
  pi.on('tool_call',(e:any)=> {
    log({type:'tool_call',name:e.toolName});
    if(!['read','probe_echo'].includes(e.toolName))return {block:true,reason:'Fixture only',terminate:true};
    if(e.toolName==='read'&&resolve(e.input.path)!==resolve('probe.txt'))return {block:true,reason:'Fixture only',terminate:true};
  });
  pi.on('tool_result',(e:any)=>{log({type:'tool_result',name:e.toolName,isError:e.isError});if(e.toolName==='probe_echo')return {content:[{type:'text',text:'HOOK_CONFIRMED:'+e.input.text}]};});
  pi.on('before_provider_request',(e:any,ctx:any)=>{
    const messages=e.payload.messages??e.payload.input??[];
    const system=messages.find((m:any)=>m.role==='system'||m.role==='developer');
    const content=typeof system?.content==='string'?system.content:system?.content?.[0]?.text;
    log({type:'request',model:e.model?.id,roles:messages.map((m:any)=>m.role??m.type),systemMatches:content===ctx.getSystemPrompt(),toolChoice:e.payload.tool_choice,tools:e.payload.tools?.map((t:any)=>t.function?.name??t.name)});
  });
  pi.on('after_provider_response',(e:any)=>log({type:'response',status:e.status}));
  pi.registerCommand('research-branch',{handler:async (_:string,ctx:any)=>{
    const target=ctx.sessionManager.getEntries().find((e:any)=>e.type==='message'&&e.message.role==='user');
    if(!target)throw new Error('No target');
    const result=await ctx.navigateTree(target.id,{summarize:true,customInstructions:'Keep the summary under 80 words.'});
    log({type:'branch',...result});
  }});
}
