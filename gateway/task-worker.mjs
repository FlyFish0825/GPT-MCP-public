import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {ROOT,readJSON,writeJSON} from './common.mjs';
const id=process.argv[2];if(!/^[a-f0-9]{32}$/.test(id||''))process.exit(2);
const d=path.join(ROOT,'tasks/state',id),p=path.join(d,'metadata.json');
let m=readJSON(p),spec=readJSON(path.join(d,'recipe.json'));
if(m.status!=='PENDING')process.exit(3);
m={...m,status:'RUNNING',worker_pid:process.pid,started:new Date().toISOString(),heartbeat:new Date().toISOString()};writeJSON(p,m);
let bytes=0,reason=null;const fd=fs.openSync(path.join(d,'output.log'),'a');
function output(buf){if(bytes>=10*1024*1024)return;const slice=buf.subarray(0,10*1024*1024-bytes);fs.writeSync(fd,slice);bytes+=slice.length;}
const child=spawn(spec.command,spec.args,{cwd:spec.cwd||ROOT,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
m.child_pid=child.pid;writeJSON(p,m);
child.stdout.on('data',output);child.stderr.on('data',output);
function terminate(why){if(reason)return;reason=why;if(child.pid)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}
const heartbeat=setInterval(()=>{m.heartbeat=new Date().toISOString();writeJSON(p,m);if(fs.existsSync(path.join(d,'cancel')))terminate('CANCELLED');},1000);
const timeout=setTimeout(()=>terminate('TIMEOUT'),Math.min(spec.timeout_seconds||3600,86400)*1000);
function finish(code,error){clearInterval(heartbeat);clearTimeout(timeout);fs.closeSync(fd);m.status=reason==='CANCELLED'?'CANCELLED':(code===0&&!reason&&!error?'SUCCEEDED':'FAILED');m.exit_code=code;m.reason=error?.message||reason;m.finished=new Date().toISOString();m.log_truncated=bytes>=10*1024*1024;writeJSON(p,m);}
let done=false;child.on('error',e=>{if(!done){done=true;finish(null,e);}});child.on('close',code=>{if(!done){done=true;finish(code);}});
