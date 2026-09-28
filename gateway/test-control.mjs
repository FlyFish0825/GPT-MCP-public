import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {ROOT,readJSON,writeJSON} from './common.mjs';
import {FileOAuthProvider,browserLogin,RESOURCE} from './oauth-session.mjs';
const remote=process.argv.includes('--public'),login=process.argv.includes('--login-only'),results=[];
const fixture=path.join(ROOT,'tests/control-fixtures',randomUUID());
const provider=new FileOAuthProvider({control:true});
if(login){
 provider.invalidateCredentials('tokens');await browserLogin(provider);
 assert.equal(provider.tokens().scope,'mcp:read mcp:control','Control scope was not granted');
 writeJSON(path.join(ROOT,'tests/control-login-result.json'),{timestamp:new Date().toISOString(),status:'PASSED',scope:provider.tokens().scope,owner_github_id:readJSON(path.join(ROOT,'config/identity-public.json')).OWNER_GITHUB_ID,identity_config_sha256:createHash('sha256').update(fs.readFileSync(path.join(ROOT,'secrets/identity-client.json'))).digest('hex')});
 console.log('PASSED real owner control consent / PKCE code exchange. No credentials printed.');process.exit(0);
}
const c=new Client({name:'owner-control-acceptance',version:'1'});
const t=new StreamableHTTPClientTransport(new URL(remote?RESOURCE:'http://127.0.0.1:8780/mcp'),remote?{authProvider:provider}:{requestInit:{headers:{Authorization:'Bearer '+fs.readFileSync(path.join(ROOT,'secrets/remote-origin-token.txt'),'utf8').trim(),'X-GPT-MCP-Permission':'control'}}});
const text=r=>(r.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
async function call(name,args){const r=await c.callTool({name,arguments:args},undefined,{timeout:120000});assert(!r.isError,'Tool returned an error: '+name);return r;}
async function check(name,fn){try{const detail=await fn();results.push({name,status:'PASSED',detail});console.log('PASSED '+name);}catch(e){results.push({name,status:'FAILED',reason:e.message});console.error('FAILED '+name+': '+e.message);}}
async function terminal(command){let s=text(await call('start_process',{command,shell:'cmd.exe',timeout_ms:10000}));const pid=s.match(/PID\s+(\d+)/i)?.[1];if(pid)for(let i=0;i<3&&!/exit code/i.test(s);i++)s+='\n'+text(await call('read_process_output',{pid:Number(pid),timeout_ms:3000}));return s;}
const dir=path.join(ROOT,'tests/control',randomUUID()),file=path.join(dir,'canary.txt');
fs.mkdirSync(fixture,{recursive:true});
const windowProcess=spawn('powershell.exe',['-NoProfile','-File',path.join(ROOT,'tests/desktop-window.ps1'),'-FixtureDirectory',fixture],{windowsHide:true,stdio:'ignore'});
for(let n=0;n<50&&!fs.existsSync(path.join(fixture,'desktop-window-points.json'));n++)await new Promise(r=>setTimeout(r,200));
try{
 await c.connect(t);
 await check('owner control discovery and schemas',async()=>{const tools=(await c.listTools()).tools;for(const name of ['read_file','list_directory','write_file','edit_block','delete_file','start_process','desktop_Click','desktop_Type','desktop_Screenshot'])assert(tools.some(x=>x.name===name),'Missing '+name);for(const tool of tools){assert(tool.description&&tool.inputSchema.type==='object');assert.equal(typeof tool.annotations.readOnlyHint,'boolean');}return {tool_count:tools.length};});
 await check('create directory and file outside old public folder',async()=>{await call('create_directory',{path:dir});await call('write_file',{path:file,content:'MCP_CONTROL_ORIGINAL\n',mode:'rewrite'});assert.equal(fs.readFileSync(file,'utf8'),'MCP_CONTROL_ORIGINAL\n');});
 await check('modify and read actual file',async()=>{await call('edit_block',{file_path:file,old_string:'MCP_CONTROL_ORIGINAL',new_string:'MCP_CONTROL_MODIFIED',expected_replacements:1});assert(text(await call('read_file',{path:file})).includes('MCP_CONTROL_MODIFIED'));});
 await check('delete only test file / recursive directory delete refused',async()=>{await call('delete_file',{path:file});assert(!fs.existsSync(file));const r=await c.callTool({name:'delete_file',arguments:{path:dir}});assert(r.isError);assert(fs.existsSync(dir));});
 await check('PowerShell real stdout and exit zero',async()=>{const s=await terminal('powershell.exe -NoLogo -NoProfile -NonInteractive -Command "Write-Output \'MCP_CONTROL_PS_OK\'; exit 0"');assert(s.includes('MCP_CONTROL_PS_OK'));assert(/exit code[:\s]+0/i.test(s));});
 await check('CMD real stdout',async()=>{assert((await terminal('echo MCP_CONTROL_CMD_OK')).includes('MCP_CONTROL_CMD_OK'));});
 await check('stderr and exit seven',async()=>{const s=await terminal('powershell.exe -NoLogo -NoProfile -NonInteractive -Command "[Console]::Error.WriteLine(\'MCP_CONTROL_STDERR\'); exit 7"');assert(s.includes('MCP_CONTROL_STDERR'));assert(/exit code[:\s]+7/i.test(s));});
 const points=readJSON(path.join(fixture,'desktop-window-points.json'));
 await check('inspect dedicated desktop test window',async()=>{const switched=text(await call('desktop_App',{mode:'switch',name:points.title}));assert(!/not found|error|failed/i.test(switched),'Test window switch failed');const r=await call('desktop_Snapshot',{use_vision:true,use_ui_tree:true,use_annotation:false});const s=text(r);assert(s.includes(points.title));assert(s.includes('Test mouse click')&&s.includes('GPT-MCP test input'),'Exact test controls were not observed; desktop input skipped');const img=r.content.find(x=>x.type==='image');if(img)fs.writeFileSync(path.join(ROOT,'tests/control-before.png'),Buffer.from(img.data,'base64'));});
 if(results.at(-1).status==='PASSED'){
  await check('mouse click changes test window marker',async()=>{await call('desktop_Click',{loc:points.button,button:'left',clicks:1});await new Promise(r=>setTimeout(r,400));assert.equal(fs.readFileSync(path.join(fixture,'desktop-click.txt'),'utf8'),'MCP_CLICK_OK');});
  await check('keyboard types only into test window',async()=>{await call('desktop_Type',{loc:points.input,text:'MCP_KEYBOARD_OK',clear:true,press_enter:false});await new Promise(r=>setTimeout(r,400));assert.equal(fs.readFileSync(path.join(fixture,'desktop-input.txt'),'utf8'),'MCP_KEYBOARD_OK');});
 }
 await check('actual screenshot returned',async()=>{const r=await call('desktop_Screenshot',{use_annotation:false}),img=r.content.find(x=>x.type==='image');assert(img);const bytes=Buffer.from(img.data,'base64');fs.writeFileSync(path.join(ROOT,'tests',remote?'control-public-screen.png':'control-local-screen.png'),bytes);return {mimeType:img.mimeType,bytes:bytes.length};});
}finally{await t.terminateSession().catch(()=>{});await c.close().catch(()=>{});fs.writeFileSync(path.join(fixture,'desktop-window-stop'),'stop');writeJSON(path.join(ROOT,'tests',remote?'control-public-result.json':'control-local-result.json'),{timestamp:new Date().toISOString(),transport:remote?'Public Worker OAuth → VPC → Tunnel → control gateway':'Loopback origin-token control route',results});}
if(results.some(x=>x.status==='FAILED'))process.exitCode=1;
