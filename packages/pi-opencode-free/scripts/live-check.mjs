import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=await fs.mkdtemp(join(tmpdir(),'pi-opencode-live-'));
const extension=fileURLToPath(new URL('../src/index.ts',import.meta.url));
const fixtureExtension=fileURLToPath(new URL('./live-fixture.ts',import.meta.url));
const id=process.argv[2]??'mimo-v2.6-flash-free';
const noTools=process.argv.includes('--no-tools');
const log=root+'/acceptance-'+id+(noTools?'-no-tools':'')+'.jsonl';
await fs.writeFile(log,'');
await fs.mkdir(root+'/fixture/.pi',{recursive:true});
await fs.writeFile(root+'/fixture/probe.txt','fixture-token-7b42\n');
await fs.writeFile(root+'/fixture/.pi/settings.json',JSON.stringify({compaction:{enabled:false,reserveTokens:4096,keepRecentTokens:0},retry:{enabled:false,maxRetries:0,provider:{maxRetries:0,timeoutMs:45000}}}));
const args=['--no-extensions','--no-skills','--no-prompt-templates','--no-themes','--no-context-files','--approve','--no-session',
 '-e',extension,'-e',fixtureExtension,
 '--system-prompt','You are validating a Pi provider in a disposable fixture. Follow the user instructions precisely.',
 '--mode','rpc','--thinking','off'];
if(noTools)args.push('--no-tools');
const child=spawn(process.env.PI_BIN??'pi',args,{cwd:root+'/fixture',env:{...process.env,PI_OPENCODE_FREE_CACHE:root+'/acceptance-cache.json',PROBE_LOG:log,PROBE_NO_TOOLS:noTools?'1':'0'}});
const closed=new Promise(r=>child.on('close',r));let buffer='',error='',counter=0;
const pending=new Map();const listeners=[];
child.stderr.on('data',b=>error+=b);
child.stdout.on('data',b=>{buffer+=b;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let e;try{e=JSON.parse(line)}catch{continue}
 if(e.type==='response'&&pending.has(e.id)){pending.get(e.id)(e);pending.delete(e.id);}
 for(const l of [...listeners])if(l.type===e.type){listeners.splice(listeners.indexOf(l),1);l.resolve(e);}
}});
function event(type){return new Promise(resolve=>listeners.push({type,resolve}));}
function command(type,extra={}){const id=String(++counter);const p=new Promise(r=>pending.set(id,r));child.stdin.write(JSON.stringify({id,type,...extra})+'\n');return p;}
const timer=setTimeout(()=>{child.kill('SIGTERM');for(const resolve of pending.values())resolve({success:false,error:'timeout'});for(const l of listeners)l.resolve({error:'timeout'});},150000);
const result={model:id,noTools};
try {
 const models=await command('get_available_models');
 result.available=models.data?.models?.filter(m=>m.provider==='opencode-free').map(m=>m.id);
 assert(result.available.includes(id));
 assert.equal((await command('set_model',{provider:'opencode-free',modelId:id})).success,true);
 let settled=event('agent_settled');
 assert.equal((await command('prompt',{message:noTools?'Reply with exactly NO_TOOLS_OK. Do not use tools.':'Use read to read probe.txt, then call probe_echo with its exact token. Reply with exactly the result returned by probe_echo. Only use these two tools.'})).success,true);
 await settled;
 result.answer=(await command('get_last_assistant_text')).data?.text;
 assert.equal(result.answer,noTools?'NO_TOOLS_OK':'HOOK_CONFIRMED:fixture-token-7b42');
 if(!noTools){
  const compact=await command('compact',{customInstructions:'Summarize the fixture test in under 100 words.'});
  result.compact={success:compact.success,error:compact.error,hasSummary:!!compact.data?.summary};
  assert.equal(compact.success,true);
  result.compactionEntry=(await command('get_entries')).data?.entries?.some(e=>e.type==='compaction');
  assert.equal(result.compactionEntry,true);
  const branch=await command('prompt',{message:'/research-branch'});
  result.branch={success:branch.success,error:branch.error};
  assert.equal(branch.success,true);
  result.branchSummaryEntry=(await command('get_entries')).data?.entries?.some(e=>e.type==='branch_summary');
  assert.equal(result.branchSummaryEntry,true);
 }
 result.success=true;
} catch(e){result.success=false;result.error=e.stack;}
child.stdin.end();const endTimer=setTimeout(()=>child.kill('SIGTERM'),2000);
result.exitCode=await closed;clearTimeout(endTimer);clearTimeout(timer);
result.stderr=error;
result.hooks=(await fs.readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
await fs.writeFile(log+'.result.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
console.log('Evidence: '+log+'.result.json');
if(!result.success)process.exitCode=1;
