// Read only grant lifecycle metadata. Never print identifiers, encrypted props,
// authorization codes, wrapped keys, client secrets or token contents.
import {spawn} from 'node:child_process';
import path from 'node:path';
import {ROOT,writeJSON} from './common.mjs';
const cli=path.join(ROOT,'gateway/node_modules/wrangler/bin/wrangler.js'),namespace=process.env.CLOUDFLARE_KV_NAMESPACE_ID;if(!namespace)throw new Error('Set CLOUDFLARE_KV_NAMESPACE_ID before reading remote grant metadata');
async function kv(args){return new Promise((resolve,reject)=>{let stdout='';const c=spawn(process.execPath,[cli,'kv','key',...args,'--namespace-id',namespace,'--remote'],{cwd:ROOT,windowsHide:true,env:{...process.env,XDG_CONFIG_HOME:path.join(ROOT,'secrets/xdg'),WRANGLER_SEND_METRICS:'false',NO_COLOR:'1'},stdio:['ignore','pipe','ignore']});c.stdout.on('data',x=>stdout+=x);c.once('error',()=>reject(new Error('KV diagnostic process could not start')));c.once('exit',code=>{if(code!==0)return reject(new Error('KV lifecycle metadata read failed'));try{resolve(JSON.parse(stdout.trim()));}catch{reject(new Error('KV lifecycle metadata response format was unexpected'));}});});}
const keys=await kv(['list','--prefix','grant:']);
const grants=[];
for(const key of keys.slice(-20)){
 const g=await kv(['get',key.name]);
 let clientClass=g.clientId?.startsWith('https://chatgpt.com/oauth/')?'chatgpt_cimd':'dcr_other';
 if(clientClass==='dcr_other')try{const client=await kv(['get','client:'+g.clientId]);if(/GPT-MCP.*acceptance/i.test(client.clientName||''))clientClass='project_sdk';else if(/chatgpt|openai/i.test(client.clientName||''))clientClass='chatgpt_dcr';}catch{}
 const tokenKeys=await kv(['list','--prefix',`token:${g.userId}:${g.id}:`]);const tokenScopes=[];
 for(const tokenKey of tokenKeys.slice(0,5)){const data=await kv(['get',tokenKey.name]);tokenScopes.push({scope:Array.isArray(data.scope)?data.scope.filter(s=>['mcp:read','mcp:control'].includes(s)):[],resource_matches:data.audience==='https://your-worker.workers.dev/mcp'});}
 grants.push({created_at:new Date(g.createdAt*1000).toISOString(),client_class:clientClass,scope:Array.isArray(g.scope)?g.scope.filter(s=>['mcp:read','mcp:control'].includes(s)):[],authorization_code_pending:!!g.authCodeWrappedKey,refresh_issued:!!g.refreshTokenId,access_token_count:tokenKeys.length,token_metadata:tokenScopes,owner_matches:!!process.env.GPT_MCP_OWNER_USER_ID&&g.userId===process.env.GPT_MCP_OWNER_USER_ID});
}
grants.sort((a,b)=>b.created_at.localeCompare(a.created_at));
const report={timestamp:new Date().toISOString(),grant_key_count:keys.length,inspected:grants.length,grants};
writeJSON(path.join(ROOT,'tests/oauth-grant-lifecycle.json'),report);console.log(JSON.stringify(report,null,2));
