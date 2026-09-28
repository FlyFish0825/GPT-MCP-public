import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {ROOT,readJSON,writeJSON} from './common.mjs';
const state=path.join(ROOT,'tasks/state');
export const recipes=()=>readJSON(path.join(ROOT,'config/task-recipes.json'));
function dir(id){if(!/^[a-f0-9]{32}$/.test(id||''))throw new Error('Invalid task_id');return path.join(state,id);}
export function getTask(id){
  const p=path.join(dir(id),'metadata.json');const m=readJSON(p);
  if(['PENDING','RUNNING'].includes(m.status)&&Date.now()-Date.parse(m.heartbeat||m.created)>15000){
    m.status='FAILED';m.reason='Worker stopped or system restarted; task is never replayed automatically';m.finished=new Date().toISOString();writeJSON(p,m);
  }
  return m;
}
export function submitTask(recipe,key){
  if(typeof key!=='string'||key.length<1||key.length>200)throw new Error('Invalid idempotency_key');
  const spec=recipes()[recipe];if(!spec)throw new Error('Unknown locally approved recipe');
  const id=createHash('sha256').update(key).digest('hex').slice(0,32);const d=dir(id);
  fs.mkdirSync(state,{recursive:true});
  try{fs.mkdirSync(d);}catch(e){if(e.code!=='EEXIST')throw e;const m=getTask(id);if(m.recipe!==recipe)throw new Error('Idempotency key already bound to another recipe');return m;}
  const m={task_id:id,recipe,status:'PENDING',created:new Date().toISOString(),exit_code:null};
  writeJSON(path.join(d,'metadata.json'),m);
  writeJSON(path.join(d,'recipe.json'),spec);
  try {
    const child=spawn(process.execPath,[path.join(ROOT,'gateway/task-worker.mjs'),id],{detached:true,windowsHide:true,stdio:'ignore',cwd:ROOT});
    child.on('error',e=>{writeJSON(path.join(d,'metadata.json'),{...m,status:'FAILED',reason:e.message});});child.unref();
  }catch(e){m.status='FAILED';m.reason=e.message;writeJSON(path.join(d,'metadata.json'),m);}
  return m;
}
export function taskLog(id){const p=path.join(dir(id),'output.log');if(!fs.existsSync(p))return {text:'',truncated:false};const fd=fs.openSync(p,'r');try{const size=fs.fstatSync(fd).size;const b=Buffer.alloc(Math.min(size,65536));fs.readSync(fd,b,0,b.length,Math.max(0,size-b.length));return {text:b.toString('utf8'),truncated:size>b.length,bytes:size};}finally{fs.closeSync(fd);}}
export async function cancelTask(id){const m=getTask(id);if(['PENDING','RUNNING'].includes(m.status))fs.writeFileSync(path.join(dir(id),'cancel'),'cancel');return {...m,cancellation_requested:true};}
