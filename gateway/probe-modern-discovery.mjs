import fs from 'node:fs';
import path from 'node:path';
import {ROOT,writeJSON} from './common.mjs';
import {FileOAuthProvider,RESOURCE} from './oauth-session.mjs';
const provider=new FileOAuthProvider(),records=[];
for(const [label,url,token] of [['origin','http://127.0.0.1:8780/mcp',fs.readFileSync(path.join(ROOT,'secrets/remote-origin-token.txt'),'utf8').trim()],['public',RESOURCE,provider.tokens()?.access_token]]){
 if(!token)throw new Error('SDK login required');
 for(const method of ['server/discover','tools/list']){
 const body={jsonrpc:'2.0',id:1,method,params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:'modern-discovery-diagnostic',version:'1'},'io.modelcontextprotocol/clientCapabilities':{}}}};
 const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':method},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 const text=await r.text();let data;try{data=JSON.parse(text);}catch{const line=text.split(/\r?\n/).find(l=>l.startsWith('data:'));if(line)try{data=JSON.parse(line.slice(5));}catch{}}
 const safe={target:label,method,status:r.status,content_type:r.headers.get('content-type'),jsonrpc_error_code:data?.error?.code,header_mismatch:typeof data?.error?.message==='string'&&data.error.message.includes('mcp-method'),tool_count:data?.result?.tools?.length};records.push(safe);console.log(JSON.stringify(safe));
 }
}
writeJSON(path.join(ROOT,'tests/modern-discovery-probe.json'),{timestamp:new Date().toISOString(),records});
