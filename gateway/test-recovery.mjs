import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {ROOT,readJSON,writeJSON} from './common.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const token=fs.readFileSync(path.join(ROOT,'secrets/local-token.txt'),'utf8').trim();
const results=[];const key='recovery-'+Date.now();
async function connect(){const c=new Client({name:'recovery-acceptance',version:'1'});const t=new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8765/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}}});await c.connect(t);return {c,t};}
async function tool(c,name,a){const r=await c.callTool({name,arguments:a});assert(!r.isError,JSON.stringify(r));return JSON.parse(r.content.find(x=>x.type==='text').text);}
async function check(name,fn){try{const detail=await fn();results.push({name,status:'PASSED',detail});console.log('PASSED '+name);}catch(e){results.push({name,status:'FAILED',reason:e.message});console.error('FAILED '+name+': '+e.message);}}
let conn,id;
await check('authorized HTTP start detached task',async()=>{conn=await connect();const names=(await conn.c.listTools()).tools.map(x=>x.name);assert(names.includes('task_submit'));const m=await tool(conn.c,'task_submit',{recipe:'long-test',idempotency_key:key});id=m.task_id;await conn.c.close();await sleep(1500);return {task_id:id};});
await check('task survives client disconnect and gateway crash',async()=>{
  const state=readJSON(path.join(ROOT,'logs/supervisor.json'));const old=state.children.gateway;
  process.kill(old);await sleep(6500);
  const next=readJSON(path.join(ROOT,'logs/supervisor.json'));assert(next.children.gateway&&next.children.gateway!==old);
  conn=await connect();const m=await tool(conn.c,'task_status',{task_id:id});assert(['RUNNING','SUCCEEDED'].includes(m.status));return {gateway_before:old,gateway_after:next.children.gateway,task:m};
});
await check('retry idempotency / persistent task result',async()=>{
  const again=await tool(conn.c,'task_submit',{recipe:'long-test',idempotency_key:key});assert.equal(again.task_id,id);
  await sleep(7000);const m=await tool(conn.c,'task_status',{task_id:id});assert.equal(m.status,'SUCCEEDED');assert.equal(m.exit_code,0);
  const log=await tool(conn.c,'task_log',{task_id:id});assert.equal(log.text.split('LONG_TASK_STARTED').length-1,1);assert(log.text.includes('LONG_TASK_FINISHED'));return {task:m,log};
});
for(const recipe of ['cmake-configure','cmake-build'])await check('persistent '+recipe,async()=>{const m=await tool(conn.c,'task_submit',{recipe,idempotency_key:key+'-'+recipe});let done;for(let i=0;i<20;i++){await sleep(300);done=await tool(conn.c,'task_status',{task_id:m.task_id});if(!['PENDING','RUNNING'].includes(done.status))break;}const log=await tool(conn.c,'task_log',{task_id:m.task_id});assert.equal(done.status,'SUCCEEDED',log.text);assert.equal(done.exit_code,0);if(recipe==='cmake-build')assert(log.text.includes('MCP_CMAKE_BUILD_OK'));return {task:done,log};});
await check('task cancellation',async()=>{const m=await tool(conn.c,'task_submit',{recipe:'long-test',idempotency_key:key+'-cancel'});await sleep(500);await tool(conn.c,'task_cancel',{task_id:m.task_id});await sleep(2000);const done=await tool(conn.c,'task_status',{task_id:m.task_id});assert.equal(done.status,'CANCELLED');return done;});
await check('auth process crash / independent restart',async()=>{const before=readJSON(path.join(ROOT,'logs/supervisor.json'));process.kill(before.children.auth);await sleep(6000);const after=readJSON(path.join(ROOT,'logs/supervisor.json'));assert(after.children.auth!==before.children.auth);assert.equal(after.children.desktop,before.children.desktop);await conn.c.close();conn=await connect();assert((await conn.c.listTools()).tools.length>0);return {before:before.children.auth,after:after.children.auth};});
await check('local calls independent of unavailable HTTP proxy',async()=>{process.env.HTTP_PROXY='http://127.0.0.1:1';process.env.HTTPS_PROXY='http://127.0.0.1:1';assert((await conn.c.listTools()).tools.length>0);return 'Only test-process environment was changed; Clash and global proxy were untouched';});
if(conn)await conn.c.close().catch(()=>{});
writeJSON(path.join(ROOT,'tests/recovery-result.json'),{timestamp:new Date().toISOString(),results});if(results.some(x=>x.status==='FAILED'))process.exitCode=1;
