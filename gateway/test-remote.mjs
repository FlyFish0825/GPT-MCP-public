import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {FileOAuthProvider,browserLogin,RESOURCE} from './oauth-session.mjs';
import {ROOT,readJSON,writeJSON} from './common.mjs';
import {submitTask,getTask,taskLog} from './task-manager.mjs';
const origin=new URL(RESOURCE).origin,results=[];
async function check(name,fn){try{const detail=await fn();results.push({name,status:'PASSED',detail});console.log('PASSED '+name);}catch(e){results.push({name,status:'FAILED',reason:e.message.replace(/(?:Bearer\s+)?[A-Za-z0-9_-]{64,}/g,'[redacted]')});console.error('FAILED '+name);}}
async function connect(provider){const c=new Client({name:'public-acceptance',version:'1'}),t=new StreamableHTTPClientTransport(new URL(RESOURCE),{authProvider:provider});await c.connect(t);return {c,t};}
await check('public HTTPS / OAuth challenge rejects unauthorized',async()=>{for(const authorization of ['', 'Bearer invalid']){const r=await fetch(RESOURCE,{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:'{}'});assert.equal(r.status,401);assert(r.headers.get('WWW-Authenticate')?.includes('oauth-protected-resource'));}});
await check('public OAuth metadata / S256 / read-only audience',async()=>{const a=await(await fetch(origin+'/.well-known/oauth-authorization-server')).json(),r=await(await fetch(origin+'/.well-known/oauth-protected-resource/mcp')).json();assert.equal(a.issuer,origin);assert.deepEqual(a.code_challenge_methods_supported,['S256']);assert.equal(r.resource,RESOURCE);assert(r.scopes_supported.includes('mcp:read'));assert(a.revocation_endpoint);return {issuer:a.issuer,resource:r.resource,scope:r.scopes_supported};});
const provider=new FileOAuthProvider();
if(process.argv.includes('--login')||process.argv.includes('--login-only')){
 await check('real GitHub owner OAuth / SDK code exchange',async()=>{const health=await(await fetch(origin+'/healthz')).json();assert(health.identity_ready,'GitHub OAuth App has not been configured');provider.invalidateCredentials('tokens');await browserLogin(provider);assert.equal(provider.tokens().scope,'mcp:read');assert.equal(provider.tokens().expires_in,900);return {owner_github_id:readJSON(path.join(ROOT,'config/identity-public.json')).OWNER_GITHUB_ID,identity_configured_at:fs.statSync(path.join(ROOT,'secrets/identity-client.json')).mtime.toISOString(),identity_config_sha256:createHash('sha256').update(fs.readFileSync(path.join(ROOT,'secrets/identity-client.json'))).digest('hex'),access_token_ttl:900};});
 writeJSON(path.join(ROOT,'tests/remote-login-result.json'),{timestamp:new Date().toISOString(),results});
}
if(!process.argv.includes('--probe-only')&&!process.argv.includes('--login-only')&&provider.tokens()?.access_token){
 let conn;
 try{
  await check('public MCP initialize / tools discovery',async()=>{conn=await connect(provider);const names=(await conn.c.listTools()).tools.map(x=>x.name);assert(names.includes('read_file'));for(const n of ['write_file','start_process','Click','Type','Screenshot','set_config_value','task_submit'])assert(!names.includes(n));return {tools:names};});
  if(conn){
   await check('real public read_file and list_directory',async()=>{const r=await conn.c.callTool({name:'read_file',arguments:{path:path.join(ROOT,'tests/public/mcp-sample.txt')}});assert(!r.isError);assert(JSON.stringify(r).includes('MCP_MODIFIED'));const dir=await conn.c.callTool({name:'list_directory',arguments:{path:path.join(ROOT,'tests/public')}});assert(!dir.isError);return {file:'tests/public/mcp-sample.txt',marker:'MCP_MODIFIED'};});
   await check('public denied writes / shell / desktop / outside files',async()=>{for(const name of ['write_file','start_process','set_config_value','Click','task_submit'])assert((await conn.c.callTool({name,arguments:{}})).isError);assert((await conn.c.callTool({name:'read_file',arguments:{path:path.join(ROOT,'tests/mcp-sample.txt')}})).isError);});
   await check('public client disconnect and fresh MCP session',async()=>{await conn.t.terminateSession();await conn.c.close();conn=await connect(provider);const r=await conn.c.callTool({name:'read_file',arguments:{path:path.join(ROOT,'tests/public/mcp-sample.txt')}});assert(!r.isError);});
   if(process.argv.includes('--recover-tunnel'))await check('real Tunnel process outage / public reconnect / detached task survives',async()=>{
    const job=submitTask('long-test','public-tunnel-recovery-'+Date.now());
    const previous=readJSON(path.join(ROOT,'logs/supervisor.json')).children.tunnel;
    assert(Number.isInteger(previous)&&previous>0);process.kill(previous);
    let replacement;for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,2000));const pid=readJSON(path.join(ROOT,'logs/supervisor.json')).children.tunnel;if(pid&&pid!==previous){const ready=await fetch('http://127.0.0.1:8781/ready',{signal:AbortSignal.timeout(2000)}).catch(()=>null);if(ready?.ok){replacement=pid;break;}}}
    assert(replacement,'Tunnel did not recover within 60 seconds');
    await conn.c.close();conn=await connect(provider);
    assert(!(await conn.c.callTool({name:'read_file',arguments:{path:path.join(ROOT,'tests/public/mcp-sample.txt')}})).isError);
    let completed;for(let i=0;i<20;i++){completed=getTask(job.task_id);if(!['PENDING','RUNNING'].includes(completed.status))break;await new Promise(r=>setTimeout(r,1000));}
    assert.equal(completed.status,'SUCCEEDED');assert.equal(completed.exit_code,0);assert.equal(taskLog(job.task_id).text.split('LONG_TASK_STARTED').length-1,1);
    return {tunnel_before:previous,tunnel_after:replacement,task_id:job.task_id,task_status:completed.status};
   });
  }
 }finally{if(conn){await conn.t.terminateSession().catch(()=>{});await conn.c.close().catch(()=>{});}}
 if(process.argv.includes('--revoke'))await check('real public refresh-grant revocation rejects access and refresh',async()=>{
  const token=provider.tokens(),client=provider.clientInformation();
  const parameters={client_id:client.client_id,token:token.refresh_token,token_type_hint:'refresh_token'};
  if(client.client_secret)parameters.client_secret=client.client_secret;
  const r=await fetch(origin+'/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(parameters)});assert.equal(r.status,200);
  let denied=false;for(let i=0;i<10;i++){const probe=await fetch(RESOURCE,{method:'POST',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},body:'{}'});if(probe.status===401){denied=true;break;}await new Promise(r=>setTimeout(r,10000));}
  assert(denied,'Revocation did not propagate within 100 seconds');
  const refresh={grant_type:'refresh_token',client_id:client.client_id,refresh_token:token.refresh_token,resource:RESOURCE};if(client.client_secret)refresh.client_secret=client.client_secret;
  assert.equal((await fetch(origin+'/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(refresh)})).status,400);provider.invalidateCredentials('tokens');
 });
}else if(!process.argv.includes('--probe-only')&&!process.argv.includes('--login-only'))results.push({name:'public authenticated MCP tools',status:'NOT_TESTED',reason:'Owner browser OAuth login is required; no substitute credentials are accepted'});
writeJSON(path.join(ROOT,process.argv.includes('--probe-only')?'tests/remote-probe-result.json':'tests/remote-result.json'),{timestamp:new Date().toISOString(),results});if(results.some(x=>x.status!=='PASSED'))process.exitCode=1;
