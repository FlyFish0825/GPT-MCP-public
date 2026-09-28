import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {ROOT,writeJSON} from './common.mjs';
const results=[];
async function check(name,fn){try{await fn();results.push({name,status:'PASSED'});console.log('PASSED '+name);}catch(e){results.push({name,status:'FAILED',reason:e.message});console.error('FAILED '+name+': '+e.message);}}
const token=fs.readFileSync(path.join(ROOT,'secrets/remote-origin-token.txt'),'utf8').trim(),url='http://127.0.0.1:8780/mcp';
await check('origin requires separate token',async()=>{for(const authorization of ['', 'Bearer invalid','Bearer '+fs.readFileSync(path.join(ROOT,'secrets/local-token.txt'),'utf8').trim()])assert.equal((await fetch(url,{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:'{}'})).status,401);});
const c=new Client({name:'readonly-origin-acceptance',version:'1'}),t=new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{Authorization:'Bearer '+token}}});
let connected=false;
try{
 await check('readonly origin MCP discovery',async()=>{await c.connect(t);connected=true;const names=(await c.listTools()).tools.map(x=>x.name);assert(names.includes('read_file'));for(const name of ['write_file','start_process','App','Click','Type','Shortcut','Screenshot','set_config_value','get_config','task_submit','task_cancel'])assert(!names.includes(name));});
 if(connected){
  await check('approved public fixture readable',async()=>{const r=await c.callTool({name:'read_file',arguments:{path:path.join(ROOT,'tests/public/mcp-sample.txt')}});assert(!r.isError);assert(JSON.stringify(r).includes('MCP_MODIFIED'));});
  await check('guessed write / shell / config / input calls rejected',async()=>{for(const name of ['write_file','start_process','set_config_value','Click','Type','task_submit'])assert((await c.callTool({name,arguments:{}})).isError);});
  await check('outside path and URL reads denied',async()=>{for(const a of [{path:path.join(ROOT,'tests/mcp-sample.txt')},{path:'http://127.0.0.1:8766/mcp',isUrl:true}])assert((await c.callTool({name:'read_file',arguments:a})).isError);});
  await check('junction cannot escape approved directory',async()=>{const link=path.join(ROOT,'tests/public/acceptance-escape');assert(!fs.existsSync(link));fs.symlinkSync(path.join(ROOT,'tests'),link,'junction');try{assert((await c.callTool({name:'read_file',arguments:{path:path.join(link,'mcp-sample.txt')}})).isError);}finally{fs.unlinkSync(link);}});
 }
}finally{await t.terminateSession().catch(()=>{});await c.close().catch(()=>{});}
const sc=new Client({name:'readonly-environment-acceptance',version:'1'}),st=new StdioClientTransport({command:process.execPath,args:[path.join(ROOT,'gateway/policy-bridge.mjs')],cwd:ROOT,env:{...process.env,GPT_MCP_REMOTE:'1',GPT_MCP_HIGH:'1'},stderr:'pipe'});
await check('remote policy ignores high-permission environment',async()=>{try{await sc.connect(st);const n=(await sc.listTools()).tools.map(x=>x.name);assert(!n.includes('start_process'));assert(!n.includes('write_file'));assert(!n.includes('task_submit'));}finally{await sc.close().catch(()=>{});}});
writeJSON(path.join(ROOT,'tests/readonly-result.json'),{timestamp:new Date().toISOString(),results});if(results.some(x=>x.status==='FAILED'))process.exitCode=1;
