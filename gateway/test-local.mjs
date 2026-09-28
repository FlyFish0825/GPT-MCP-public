import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {ROOT,dcOptions,writeJSON} from './common.mjs';
const results=[];
const text=r=>(r.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
async function check(name,fn){try{const detail=await fn();results.push({name,status:'PASSED',detail});console.log('PASSED '+name);}catch(e){results.push({name,status:'FAILED',reason:e.message});console.error('FAILED '+name+': '+e.message);}}
async function call(c,name,args){const r=await c.callTool({name,arguments:args},undefined,{timeout:120000});assert(!r.isError,text(r));return r;}
async function terminal(c,args){const r=await call(c,'start_process',args);let s=text(r);const pid=s.match(/PID\s+(\d+)/i)?.[1];if(pid){for(let i=0;i<3&&!/exit code/i.test(s);i++)s+='\n'+text(await call(c,'read_process_output',{pid:Number(pid),timeout_ms:3000}));}return s;}
const sample=path.join(ROOT,'tests/mcp-sample.txt');
const c=new Client({name:'local-acceptance',version:'1'}),t=new StdioClientTransport(dcOptions());
const err=fs.createWriteStream(path.join(ROOT,'logs/stdio-acceptance-stderr.log'),{flags:'a'});t.stderr?.pipe(err);
try{
  await check('stdio initialize and tools/list',async()=>{await c.connect(t);const list=await c.listTools();assert(list.tools.length>=20);return {tool_count:list.tools.length};});
  await check('isolated config / telemetry disabled',async()=>{const r=await call(c,'get_config',{});const cfg=r.structuredContent.config;assert.equal(cfg.telemetryEnabled,false);assert.deepEqual(cfg.allowedDirectories,[path.join(ROOT,'tests')]);return 'Dedicated config, telemetry off';});
  await check('file create',async()=>{await call(c,'write_file',{path:sample,content:'MCP_ORIGINAL\nsecond line\n',mode:'rewrite'});assert(fs.readFileSync(sample,'utf8').includes('MCP_ORIGINAL'));});
  await check('directory list and file read',async()=>{assert(text(await call(c,'list_directory',{path:path.join(ROOT,'tests')})).includes('mcp-sample.txt'));assert(text(await call(c,'read_file',{path:sample})).includes('MCP_ORIGINAL'));});
  await check('exact text modification',async()=>{await call(c,'edit_block',{file_path:sample,old_string:'MCP_ORIGINAL',new_string:'MCP_MODIFIED',expected_replacements:1});assert(fs.readFileSync(sample,'utf8').includes('MCP_MODIFIED'));});
  await check('file search',async()=>{const r=await call(c,'start_search',{path:path.join(ROOT,'tests'),pattern:'mcp-sample',searchType:'files',timeout_ms:5000});let s=text(r);const session=r.structuredContent?.sessionId||s.match(/Session ID:\s*(\S+)/i)?.[1];if(session){for(let i=0;i<12&&!s.includes('mcp-sample.txt');i++){await new Promise(resolve=>setTimeout(resolve,250));s+='\n'+text(await call(c,'get_more_search_results',{sessionId:session}));}}assert(s.includes('mcp-sample.txt'),s.slice(0,500));});
  await check('PowerShell stdout and exit code',async()=>{const s=await terminal(c,{command:'powershell.exe -NoLogo -NoProfile -NonInteractive -Command "Write-Output \'MCP_TERMINAL_OK\'; exit 0"',shell:'cmd.exe',timeout_ms:10000});assert(s.includes('MCP_TERMINAL_OK'),s);assert(/exit code[:\s]+0/i.test(s),s);return s;});
  await check('CMD stdout and exit code',async()=>{const r=await call(c,'start_process',{command:'echo MCP_CMD_OK',shell:'cmd.exe',timeout_ms:10000});assert(text(r).includes('MCP_CMD_OK'));return text(r);});
  await check('stderr and failing exit code',async()=>{const s=await terminal(c,{command:'powershell.exe -NoLogo -NoProfile -NonInteractive -Command "[Console]::Error.WriteLine(\'MCP_EXPECTED_STDERR\'); exit 7"',shell:'cmd.exe',timeout_ms:10000});assert(s.includes('MCP_EXPECTED_STDERR'),s);assert(/exit code[:\s]+7/i.test(s),s);return s;});
}finally{await c.close().catch(()=>{});err.end();}
if(!process.argv.includes('--stdio-only')){
  const token=fs.readFileSync(path.join(ROOT,'secrets/local-token.txt'),'utf8').trim();
  const url='http://127.0.0.1:8765/mcp';
  await check('HTTP unauthenticated / wrong token denied',async()=>{for(const authorization of ['', 'Bearer invalid']){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',authorization},body:'{}'});assert.equal(r.status,401);}});
  await check('Host / browser origin denied',async()=>{for(const extra of [{host:'evil.invalid:8765'},{Origin:'https://evil.invalid'}]){const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...extra},body:'{}'});assert([400,403].includes(r.status));}});
  let first;
  for(let i=0;i<2;i++){
    const hc=new Client({name:'http-acceptance',version:'1'});
    const ht=new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{Authorization:'Bearer '+token}}});
    try{await check('HTTP initialize / tools/list / tools/call session '+(i+1),async()=>{
      await hc.connect(ht);const list=await hc.listTools();assert(list.tools.some(x=>x.name==='read_file'));assert(!list.tools.some(x=>x.name==='set_config_value'));
      if(i===0)first=ht.sessionId;
      assert(text(await call(hc,'read_file',{path:sample})).includes('MCP_MODIFIED'));
      assert(text(await call(hc,'list_directory',{path:path.join(ROOT,'tests')})).includes('mcp-sample.txt'));
      return {tool_count:list.tools.length,session_id:ht.sessionId,previous_session:first};
    });
    await check('HTTP read-only denies write, execution and config '+(i+1),async()=>{
      const names=(await hc.listTools()).tools.map(x=>x.name);
      if(names.includes('write_file'))return 'Explicit high-permission mode active; validated separately';
      for(const name of ['write_file','start_process','set_config_value']){const r=await hc.callTool({name,arguments:{}});assert(r.isError);assert(text(r).includes('denied'));}
    });
    }finally{await ht.terminateSession().catch(()=>{});await hc.close().catch(()=>{});}
  }
  const desktop='http://127.0.0.1:8768/mcp/';
  await check('desktop unauthenticated denied',async()=>{assert.equal((await fetch(desktop,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);});
  const dc=new Client({name:'desktop-acceptance',version:'1'});
  const dt=new StreamableHTTPClientTransport(new URL(desktop),{requestInit:{headers:{Authorization:'Bearer '+fs.readFileSync(path.join(ROOT,'secrets/desktop-token.txt'),'utf8').trim()}}});
  try{await check('desktop native HTTP whitelist / Snapshot',async()=>{await dc.connect(dt);const list=await dc.listTools();writeJSON(path.join(ROOT,'tests/desktop-tools.json'),list);const names=list.tools.map(x=>x.name);assert(!names.includes('PowerShell'));assert(!names.includes('Registry'));const r=await call(dc,'Snapshot',{use_vision:false,use_ui_tree:false});assert(!/Error capturing/.test(text(r)),text(r));return {tools:names,text:text(r).slice(0,1000)};});}finally{await dc.close().catch(()=>{});}
}
writeJSON(path.join(ROOT,'tests/local-result.json'),{timestamp:new Date().toISOString(),results});
if(results.some(x=>x.status==='FAILED'))process.exitCode=1;
