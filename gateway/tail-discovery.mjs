// Keep only allowlisted diagnostic records, never raw Wrangler event metadata.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT,appendLog} from './common.mjs';
const record=path.join(ROOT,'logs/discovery-worker.jsonl'),oauthRecord=path.join(ROOT,'logs/oauth-worker.jsonl');
const workerName=process.env.CLOUDFLARE_WORKER_NAME;if(!workerName)throw new Error('Set CLOUDFLARE_WORKER_NAME before tailing a deployed Worker');
const child=spawn(process.execPath,[path.join(ROOT,'gateway/node_modules/wrangler/bin/wrangler.js'),'tail',workerName,'--format','json'],{cwd:ROOT,windowsHide:true,env:{...process.env,XDG_CONFIG_HOME:path.join(ROOT,'secrets/xdg'),WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
let buffer='';const keys=['http_method','rpc_method','client_class','protocol_version','session_present','method_header_present','name_header_present','bearer_present','accept_json','accept_sse','content_json','status','stage','permission_profile','response_json','response_sse','session_returned','elapsed_ms','failure'];
const oauthKeys=['phase','http_method','cookie_header_present','state_present','pkce_present','pkce_s256','consent_receipt_present','control_requested','redirect_class','identity_code_present','upstream_state_present','upstream_error_present','grant_type','client_assertion_present','code_present','verifier_present','resource_matches','token_scope_explicit','token_scope_control','form_unreadable','status','failure','callback_code_present','callback_state_present','callback_issuer_present','callback_issuer_matches','callback_error_present','redirect_unreadable'];
child.stdout.on('data',chunk=>{
 buffer+=chunk.toString();
 // Wrangler emits pretty printed JSON objects. Parse complete balanced objects
 // using a string-aware scanner without ever writing or echoing raw events.
 while(true){const start=buffer.indexOf('{');if(start<0){buffer=buffer.slice(-100);return;}let depth=0,quoted=false,escape=false,end=-1;
 for(let i=start;i<buffer.length;i++){const c=buffer[i];if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;}else if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){end=i+1;break;}}
 if(end<0){buffer=buffer.slice(start);if(buffer.length>4*1024*1024)buffer='';return;}let event;try{event=JSON.parse(buffer.slice(start,end));}catch{}buffer=buffer.slice(end);
 for(const log of event?.logs||[])for(const message of log.message||[]){if(typeof message!=='string')continue;const oauth=message.startsWith('OAUTH_DIAGNOSTIC ');if(!oauth&&!message.startsWith('MCP_DIAGNOSTIC '))continue;
 try{const data=JSON.parse(message.slice(oauth?17:15)),safe={timestamp:new Date(event.eventTimestamp||Date.now()).toISOString()};for(const key of oauth?oauthKeys:keys)if(data[key]!==undefined)safe[key]=data[key];appendLog(oauth?oauthRecord:record,JSON.stringify(safe)+'\n');console.log(JSON.stringify(safe));}catch{}}
 }
});
child.stderr.on('data',()=>{});
child.on('exit',code=>{console.log('Diagnostic tail exited, code='+code);process.exitCode=code||0;});
process.on('SIGINT',()=>child.kill());
console.log('Waiting for sanitized MCP request records; raw event metadata is discarded.');
