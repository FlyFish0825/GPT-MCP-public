import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {ListToolsResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {Client as ModernClient,StreamableHTTPClientTransport as ModernClientTransport} from '@modelcontextprotocol/client';
import Ajv from 'ajv';
import {ROOT,writeJSON} from './common.mjs';
import {FileOAuthProvider,browserLogin,RESOURCE} from './oauth-session.mjs';
const local=process.argv.includes('--local'),control=process.argv.includes('--control'),results=[];
let provider;
if(!local){provider=new FileOAuthProvider({control});if(process.argv.includes('--login'))await browserLogin(provider);if(!provider.tokens()?.access_token)throw new Error('A fresh SDK browser login is required; no ChatGPT credentials are accessed.');}
const target=local?'http://127.0.0.1:8780/mcp':RESOURCE;
const authorization=()=> 'Bearer '+(local?fs.readFileSync(path.join(ROOT,'secrets/remote-origin-token.txt'),'utf8').trim():provider.tokens().access_token);
const records=[];
const tracedFetch=async(url,init)=>{
 const start=Date.now(),h=new Headers(init?.headers);let rpc;
 try{rpc=JSON.parse(init?.body||'null');}catch{}
 const r=await fetch(url,{...init,...(local&&control?{headers:{...Object.fromEntries(h),'X-GPT-MCP-Permission':'control'}}:{}),signal:AbortSignal.timeout(30000)});
 records.push({method:init?.method||'GET',rpc_method:['initialize','notifications/initialized','server/discover','tools/list','tools/call'].includes(rpc?.method)?rpc.method:'other',protocol_version:h.get('mcp-protocol-version'),method_header_present:h.has('mcp-method'),name_header_present:h.has('mcp-name'),session_sent:h.has('mcp-session-id'),status:r.status,content_type:r.headers.get('content-type'),session_received:r.headers.has('mcp-session-id'),elapsed_ms:Date.now()-start});return r;
};
async function check(name,fn){try{const detail=await fn();results.push({name,status:'PASSED',detail});console.log('PASSED '+name);}catch(e){const diagnostic={error_type:e.name,error_code:typeof e.code==='number'?e.code:undefined,cause_type:e.cause?.name,mentions_parse:/parse|schema|validation/i.test(e.message||''),mentions_version:/version/i.test(e.message||''),mentions_capability:/capability|capabilities/i.test(e.message||'')};results.push({name,status:'FAILED',...diagnostic});console.log('FAILED '+name+' '+JSON.stringify(diagnostic));}}
await check('official SDK initialize / initialized / tools list / schemas / read and deny',async()=>{
 const client=new Client({name:'discovery-diagnostic',version:'1'}),transport=new StreamableHTTPClientTransport(new URL(target),{...(local?{requestInit:{headers:{Authorization:authorization()}}}:{authProvider:provider}),fetch:tracedFetch});
 try{await client.connect(transport);const list=await client.listTools();ListToolsResultSchema.parse(list);writeJSON(path.join(ROOT,local?'tests/discovery-tools-before.json':'tests/discovery-tools-public.json'),list);
 const ajv=new Ajv({strict:false});
 for(const t of list.tools){assert(/^[a-zA-Z0-9_-]{1,64}$/.test(t.name));assert(t.description?.trim());assert(t.description.length<512);assert.equal(t.inputSchema.type,'object');assert(ajv.validateSchema(t.inputSchema));ajv.compile(t.inputSchema);assert(!t._meta?.['openai/outputTemplate']);assert(!t._meta?.['ui/resourceUri']);if(!control){assert.equal(t.annotations?.openWorldHint,false);assert.equal(t.annotations?.destructiveHint,false);}for(const [k,v] of Object.entries(t.annotations||{}))if(k.endsWith('Hint'))assert.equal(typeof v,'boolean');}
 assert(list.tools.some(t=>t.name==='read_file'));assert(list.tools.some(t=>t.name==='list_directory'));
 const read=await client.callTool({name:'read_file',arguments:{path:path.join(ROOT,'tests/public/mcp-sample.txt')}});assert(!read.isError);assert(JSON.stringify(read).includes('MCP_MODIFIED'));
 if(!control){assert((await client.callTool({name:'read_file',arguments:{path:path.join(ROOT,'tests/mcp-sample.txt')}})).isError);for(const name of ['write_file','start_process','Click','task_submit'])assert((await client.callTool({name,arguments:{}})).isError);}else{assert(list.tools.some(t=>t.name==='start_process'));assert(list.tools.some(t=>t.name==='desktop_Click'));}
 return {negotiated:client.getServerVersion(),tools:list.tools.map(t=>({name:t.name,description_length:t.description.length,annotations:t.annotations,input_schema_type:t.inputSchema.type})),marker:'MCP_MODIFIED'};
 }finally{await transport.terminateSession().catch(()=>{});await client.close().catch(()=>{});}
});
await check('official SDK 2 / 2026-07-28 discovery / tools / read and deny',async()=>{
 const client=new ModernClient({name:'modern-discovery-diagnostic',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}}),transport=new ModernClientTransport(new URL(target),{requestInit:{headers:{Authorization:authorization()}},fetch:tracedFetch});
 try{await client.connect(transport);const list=await client.listTools();assert(list.tools.length>=(control?35:11));assert(list.tools.some(t=>t.name==='read_file'));const read=await client.callTool({name:'read_file',arguments:{path:path.join(ROOT,'tests/public/mcp-sample.txt')}});assert(!read.isError);assert(JSON.stringify(read).includes('MCP_MODIFIED'));if(!control){assert((await client.callTool({name:'read_file',arguments:{path:path.join(ROOT,'tests/mcp-sample.txt')}})).isError);assert((await client.callTool({name:'write_file',arguments:{}})).isError);}else{assert(list.tools.some(t=>t.name==='delete_file'));assert(list.tools.some(t=>t.name==='desktop_Screenshot'));}return {version:'2026-07-28',tool_count:list.tools.length,marker:'MCP_MODIFIED'};}finally{await client.close().catch(()=>{});}
});
await check('modern header/body mismatch remains rejected',async()=>{
 const body={jsonrpc:'2.0',id:1,method:'tools/list',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:'modern-discovery-diagnostic',version:'1'},'io.modelcontextprotocol/clientCapabilities':{}}}};
 const r=await tracedFetch(target,{method:'POST',headers:{Authorization:authorization(),Accept:'application/json, text/event-stream','Content-Type':'application/json','MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call'},body:JSON.stringify(body)});assert.equal(r.status,400);assert.equal((await r.json()).error.code,-32020);
});
for(const version of ['2025-03-26','2025-06-18','2025-11-25'])await check('raw HTTP handshake '+version,async()=>{
 let session;const headers={Authorization:authorization(),Accept:'application/json, text/event-stream','Content-Type':'application/json'};
 async function rpc(body){const r=await tracedFetch(target,{method:'POST',headers,body:JSON.stringify(body)});const text=await r.text();let data;if(r.headers.get('content-type')?.includes('text/event-stream')){const line=text.split(/\r?\n/).find(l=>l.startsWith('data:'));if(line)data=JSON.parse(line.slice(5));}else if(text)data=JSON.parse(text);return {r,data};}
 try{const init=await rpc({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:version,capabilities:{},clientInfo:{name:'raw-discovery-diagnostic',version:'1'}}});assert.equal(init.r.status,200);assert(!init.data.error);session=init.r.headers.get('mcp-session-id');if(session)headers['Mcp-Session-Id']=session;headers['MCP-Protocol-Version']=init.data.result.protocolVersion;
 const note=await rpc({jsonrpc:'2.0',method:'notifications/initialized'});assert.equal(note.r.status,202);
 const list=await rpc({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});assert.equal(list.r.status,200);assert.equal(list.data.jsonrpc,'2.0');assert.equal(list.data.id,2);ListToolsResultSchema.parse(list.data.result);
 return {negotiated_version:init.data.result.protocolVersion,session_present:!!session,tool_count:list.data.result.tools.length};
 }finally{if(session)await tracedFetch(target,{method:'DELETE',headers}).catch(()=>{});}
});
writeJSON(path.join(ROOT,control?'tests/control-protocol-result.json':local?'tests/discovery-local-result.json':'tests/discovery-public-result.json'),{timestamp:new Date().toISOString(),results,http:records});if(results.some(r=>r.status!=='PASSED'))process.exitCode=1;
