import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {ROOT,readJSON,writeJSON} from './common.mjs';
const c=new Client({name:'desktop-acceptance-input',version:'1'}),results=[];
async function call(name,args){const r=await c.callTool({name,arguments:args});assert(!r.isError,JSON.stringify(r));return r;}
async function check(name,fn){try{const detail=await fn();results.push({name,status:'PASSED',detail});console.log('PASSED '+name);}catch(e){results.push({name,status:'FAILED',reason:e.message});console.error('FAILED '+name+': '+e.message);}}
try{
 await c.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8768/mcp/'),{requestInit:{headers:{Authorization:'Bearer '+fs.readFileSync(path.join(ROOT,'secrets/desktop-token.txt'),'utf8').trim()}}}));
 const point=readJSON(path.join(ROOT,'tests/desktop-window-points.json'));
 await check('window list and active window',async()=>{
  await call('App',{mode:'switch',name:point.title});
  const r=await call('Snapshot',{use_vision:true,use_ui_tree:true,use_annotation:false});
  const t=r.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');assert(t.includes(point.title));
  const img=r.content.find(x=>x.type==='image');assert(img);fs.writeFileSync(path.join(ROOT,'tests/desktop-test-before.png'),Buffer.from(img.data,'base64'));
  return {window:point.title,mimeType:img.mimeType};
 });
 if(results[0].status==='PASSED'){
  await check('mouse click in dedicated test window',async()=>{await call('Click',{loc:point.button,button:'left',clicks:1});await new Promise(r=>setTimeout(r,400));assert.equal(fs.readFileSync(path.join(ROOT,'tests/desktop-click.txt'),'utf8'),'MCP_CLICK_OK');});
  await check('keyboard text in dedicated test window',async()=>{await call('Type',{loc:point.input,text:'MCP_KEYBOARD_OK',clear:true,press_enter:false});await new Promise(r=>setTimeout(r,400));assert.equal(fs.readFileSync(path.join(ROOT,'tests/desktop-input.txt'),'utf8'),'MCP_KEYBOARD_OK');});
 }
 await check('native Screenshot image returned',async()=>{const r=await call('Screenshot',{use_annotation:false});const img=r.content.find(x=>x.type==='image');assert(img);fs.writeFileSync(path.join(ROOT,'tests/desktop-test-after.png'),Buffer.from(img.data,'base64'));return {bytes:Buffer.from(img.data,'base64').length,mimeType:img.mimeType};});
}finally{await c.close().catch(()=>{});fs.writeFileSync(path.join(ROOT,'tests/desktop-window-stop'),'stop');writeJSON(path.join(ROOT,'tests/desktop-result.json'),{timestamp:new Date().toISOString(),results});}
if(results.some(x=>x.status==='FAILED'))process.exitCode=1;
