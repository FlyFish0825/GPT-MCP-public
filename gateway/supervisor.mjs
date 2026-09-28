import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {ROOT,readJSON,writeJSON,appendLog} from './common.mjs';
const pidFile=path.join(ROOT,'logs/supervisor.json');
if(fs.existsSync(pidFile)){const old=readJSON(pidFile);try{process.kill(old.pid,0);console.error('Supervisor already running');process.exit(2);}catch{}}
const cfg=readJSON(path.join(ROOT,'config/local.json'));
const controlEnabled=fs.existsSync(path.join(ROOT,'config/public-control.json'))&&readJSON(path.join(ROOT,'config/public-control.json')).enabled===true;
// ChatGPT can spend longer than five minutes reasoning between MCP calls.
// Keep the Streamable HTTP session alive for one hour so an idle reasoning
// period does not look like a lost connector. The session is still removed
// when the client sends DELETE or when the service is stopped.
const mcpSessionTimeout='3600000';
const owned=new Map();let stopping=false;
let tunnelUnhealthySince=0;
let tunnelRestartInProgress=false;
const command=`"${process.execPath}" "${path.join(ROOT,'gateway/policy-bridge.mjs')}"`;
const definitions=[
  {name:'gateway',command:process.execPath,args:['--require',path.join(ROOT,'gateway/loopback.cjs'),path.join(ROOT,'gateway/node_modules/supergateway/dist/index.js'),'--stdio',command,'--outputTransport','streamableHttp','--stateful','--sessionTimeout',mcpSessionTimeout,'--port','8766','--streamableHttpPath','/mcp','--logLevel','none'],env:{GPT_MCP_HIGH:cfg.enable_write_exec?'1':'0'}},
  {name:'auth',command:process.execPath,args:[path.join(ROOT,'gateway/auth-proxy.mjs')]},
  {name:'remote-gateway',command:process.execPath,args:['--require',path.join(ROOT,'gateway/loopback.cjs'),path.join(ROOT,'gateway/node_modules/supergateway/dist/index.js'),'--stdio',command,'--outputTransport','streamableHttp','--stateful','--sessionTimeout',mcpSessionTimeout,'--port','8770','--streamableHttpPath','/mcp','--logLevel','none'],env:{GPT_MCP_HIGH:'0',GPT_MCP_REMOTE:'1'}},
  {name:'remote-auth',command:process.execPath,args:[path.join(ROOT,'gateway/auth-proxy.mjs')],env:{GPT_MCP_FRONT_PORT:'8780',GPT_MCP_BACK_PORT:'8770',GPT_MCP_TOKEN_FILE:'remote-origin-token.txt',GPT_MCP_CONTROL_ROUTE:controlEnabled?'1':'0'}},
  {name:'desktop',command:path.join(ROOT,'runtime/windows-mcp/Scripts/python.exe'),args:['-m','windows_mcp','serve','--config',path.join(ROOT,'config/windows-mcp.toml'),'--transport','streamable-http','--host','127.0.0.1','--port','8768','--stateless-http','--tools',cfg.enable_desktop_control?'Snapshot,Screenshot,App,Click,Move,Type,Scroll,Shortcut,Drag,Wait':'Snapshot,Screenshot'],env:{ANONYMIZED_TELEMETRY:'false',WINDOWS_MCP_AUTH_KEY:fs.readFileSync(path.join(ROOT,'secrets/desktop-token.txt'),'utf8').trim(),WINDOWS_MCP_SCREENSHOT_SCALE:'0.5'}}
];
if(controlEnabled){
 definitions.push({name:'control-gateway',command:process.execPath,args:['--require',path.join(ROOT,'gateway/loopback.cjs'),path.join(ROOT,'gateway/node_modules/supergateway/dist/index.js'),'--stdio',command,'--outputTransport','streamableHttp','--stateful','--sessionTimeout',mcpSessionTimeout,'--port','8772','--streamableHttpPath','/mcp','--logLevel','none'],env:{GPT_MCP_REMOTE:'1',GPT_MCP_CONTROL:'1',GPT_MCP_HIGH:'1'}});
 definitions.push({name:'desktop-control',command:path.join(ROOT,'runtime/windows-mcp/Scripts/python.exe'),args:['-m','windows_mcp','serve','--config',path.join(ROOT,'config/windows-mcp.toml'),'--transport','streamable-http','--host','127.0.0.1','--port','8769','--stateless-http','--tools','Snapshot,Screenshot,App,Click,Move,Type,Scroll,Shortcut,Drag,Wait'],env:{ANONYMIZED_TELEMETRY:'false',WINDOWS_MCP_AUTH_KEY:fs.readFileSync(path.join(ROOT,'secrets/desktop-token.txt'),'utf8').trim(),WINDOWS_MCP_SCREENSHOT_SCALE:'0.5'}});
}
if(fs.existsSync(path.join(ROOT,'secrets/tunnel-token.txt')))definitions.push({name:'tunnel',command:path.join(ROOT,'runtime/cloudflared/cloudflared.exe'),args:['tunnel','--no-autoupdate','--protocol','quic','--edge-ip-version','4','--metrics','127.0.0.1:8781','run','--token-file',path.join(ROOT,'secrets/tunnel-token.txt')],env:{HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:''}});
function log(msg){appendLog(path.join(ROOT,'logs/supervisor.log'),new Date().toISOString()+' '+msg+'\n');}
function save(){writeJSON(pidFile,{pid:process.pid,started,mode:cfg,children:Object.fromEntries([...owned].map(([n,c])=>[n,c.pid]))});}
const started=new Date().toISOString();
function launch(spec,failures=0){
  if(stopping)return;
  const p=path.join(ROOT,'logs',spec.name+'.log');
  const child=spawn(spec.command,spec.args,{cwd:ROOT,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,...spec.env}});
  child.stdout.on('data',data=>appendLog(p,data));child.stderr.on('data',data=>appendLog(p,data));
  owned.set(spec.name,child);save();log(`${spec.name} started pid=${child.pid}`);
  const born=Date.now();let exited=false;
  const exit=code=>{if(exited)return;exited=true;owned.delete(spec.name);save();if(stopping)return;const n=Date.now()-born>60000?0:failures+1;const delay=Math.min(60000,2000*2**Math.min(n,5));log(`${spec.name} exited code=${code}, retry in ${delay}ms`);setTimeout(()=>launch(spec,n),delay);};
  child.on('error',e=>{log(`${spec.name} failed: ${e.message}`);exit('spawn-error');});child.on('exit',exit);
}
save();for(const spec of definitions)launch(spec);
async function monitorTunnel(){
  if(stopping||tunnelRestartInProgress)return;
  const child=owned.get('tunnel');
  if(!child||!child.pid){tunnelUnhealthySince=0;return;}
  let healthy=false;
  try{const r=await fetch('http://127.0.0.1:8781/ready',{signal:AbortSignal.timeout(2500)});healthy=r.status===200;}catch{}
  if(healthy){tunnelUnhealthySince=0;return;}
  if(!tunnelUnhealthySince)tunnelUnhealthySince=Date.now();
  if(Date.now()-tunnelUnhealthySince<15000)return;
  tunnelRestartInProgress=true;
  log('tunnel health check failed for 15s; restarting tunnel child');
  try{child.kill();}catch{}
  setTimeout(()=>{tunnelRestartInProgress=false;tunnelUnhealthySince=0;},5000);
}
const timer=setInterval(()=>{if(fs.existsSync(path.join(ROOT,'logs/stop.request')))shutdown();},500);
const tunnelHealthTimer=setInterval(()=>{monitorTunnel().catch(()=>{});},15000);
function shutdown(){if(stopping)return;stopping=true;clearInterval(timer);clearInterval(tunnelHealthTimer);log('Stopping owned services; detached tasks are preserved');for(const child of owned.values())child.kill();setTimeout(()=>{fs.rmSync(pidFile,{force:true});fs.rmSync(path.join(ROOT,'logs/stop.request'),{force:true});process.exit(0);},2000);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
