// Small policy adapter using the official SDK; upstream MCP remains unmodified.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {Server as ModernServer} from '@modelcontextprotocol/server';
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, dcOptions, textResult, appendLog } from './common.mjs';
import { submitTask, getTask, taskLog, cancelTask, recipes } from './task-manager.mjs';
import {publicToolMetadata,publicToolResult} from './public-tool-metadata.mjs';
const remote=process.env.GPT_MCP_REMOTE==='1';
const control=remote&&process.env.GPT_MCP_CONTROL==='1'&&readControlEnabled();
function readControlEnabled(){try{return JSON.parse(fs.readFileSync(path.join(ROOT,'config/public-control.json'),'utf8')).enabled===true;}catch{return false;}}
const high = (!remote||control) && process.env.GPT_MCP_HIGH === '1';
const allowed = new Set(['read_file', 'read_multiple_files', 'list_directory', 'get_file_info', 'start_search', 'get_more_search_results', 'stop_search', 'list_searches']);
if (high) for (const name of ['write_file','edit_block','create_directory','move_file','start_process','read_process_output','interact_with_process','force_terminate','list_sessions','list_processes','kill_process']) allowed.add(name);
const client = new Client({ name: 'gpt-mcp-policy', version: '1.0.0' });
const upstream = new StdioClientTransport(dcOptions());
upstream.stderr?.on('data',data=>appendLog(path.join(ROOT,'logs/dc-stderr.log'),data));
await client.connect(upstream);
const list = await client.listTools();
const tools = list.tools.filter(t => allowed.has(t.name));
let desktop;const desktopTools=[];
if(control){
 desktop=new Client({name:'owner-desktop-control',version:'1'});
 await desktop.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8769/mcp/'),{requestInit:{headers:{Authorization:'Bearer '+fs.readFileSync(path.join(ROOT,'secrets/desktop-token.txt'),'utf8').trim()}}}));
 const inventory=await desktop.listTools();for(const t of inventory.tools)if(['Snapshot','Screenshot','App','Click','Move','Type','Scroll','Shortcut','Drag','Wait'].includes(t.name))desktopTools.push({...t,name:'desktop_'+t.name});
 tools.push({name:'delete_file',description:'Delete one explicitly named file. Does not recursively delete directories.',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}});
}
const taskTools = [
  {name:'task_status',description:'Read persistent task state and exit code by task_id.',inputSchema:{type:'object',properties:{task_id:{type:'string'}},required:['task_id']}},
  {name:'task_log',description:'Read at most 64 KiB of persistent task output.',inputSchema:{type:'object',properties:{task_id:{type:'string'}},required:['task_id']}},
  {name:'task_recipes',description:'List locally configured executable task recipes. Arguments cannot be replaced remotely.',inputSchema:{type:'object',properties:{}}},
];
if (high) taskTools.push(
  {name:'task_submit',description:'Start a locally approved recipe. Reusing idempotency_key returns the same task; never repeats it.',inputSchema:{type:'object',properties:{recipe:{type:'string'},idempotency_key:{type:'string'}},required:['recipe','idempotency_key']}},
  {name:'task_cancel',description:'Cancel a running task and its subprocesses.',inputSchema:{type:'object',properties:{task_id:{type:'string'}},required:['task_id']}}
);
if(remote&&readControlEnabled())taskTools.push({name:'request_control_access',description:'Request fresh owner consent for file modifications, PowerShell/CMD and desktop control. Does not execute any command or change a file.',inputSchema:{type:'object',properties:{},additionalProperties:false}});
const PublicServer=remote?ModernServer:Server;
const server = new PublicServer({ name: high ? 'my-windows-pc-authorized' : 'my-windows-pc-readonly', version:remote?'1.1.0':'1.0.0' }, { capabilities:{tools:{}},...(remote?{supportedProtocolVersions:['2026-07-28','2025-11-25','2025-06-18','2025-03-26','2024-11-05'],instructions:control?'Owner-authorized Windows control: file changes, commands and desktop input run as the current non-elevated Windows user. Use absolute file paths, exact user targets and inspect desktop state before input. Destructive tools require explicit user intent. Never expose credentials in outputs.':'Read-only access to <PROJECT_ROOT>\\tests\\public and existing local task status. Use absolute Windows file paths. No URL reads, writes, command execution, screenshots or desktop input. Tools return data without a UI resource.'}:{}) });
server.setRequestHandler(remote?'tools/list':ListToolsRequestSchema, async () => ({ tools:remote?[...tools,...taskTools,...desktopTools].map(t=>publicToolMetadata(t,control)):[...tools,...taskTools] }));
server.setRequestHandler(remote?'tools/call':CallToolRequestSchema, async req => {
  const {name,arguments:a={}} = req.params;
  try {
    if(remote&&name==='request_control_access'&&readControlEnabled())return control?textResult({control_authorized:true,next:'Refresh the existing ChatGPT connection tools, then start a new conversation.'}):{isError:true,content:[{type:'text',text:'Fresh owner OAuth consent for mcp:read mcp:control is required. Current read-only authorization cannot modify files, run commands or control the desktop.'}],_meta:{'mcp/www_authenticate':['Bearer resource_metadata="https://your-worker.workers.dev/.well-known/oauth-protected-resource/mcp", scope="mcp:read mcp:control", error="insufficient_scope", error_description="Fresh owner consent is required for Windows control"']}};
    if(control&&name==='delete_file'){
      if(typeof a.path!=='string'||!path.isAbsolute(a.path))throw new Error('An absolute file path is required');
      const target=path.resolve(a.path);const entry=fs.lstatSync(target);if(entry.isDirectory())throw new Error('Recursive directory deletion is not supported');
      fs.unlinkSync(target);return textResult({deleted:true,path:target});
    }
    if(control&&desktopTools.some(t=>t.name===name))return publicToolResult(await desktop.callTool({name:name.slice(8),arguments:a},undefined,{timeout:120000}));
    if (name === 'task_status') return textResult(getTask(a.task_id));
    if (name === 'task_log') return textResult(taskLog(a.task_id));
    if (name === 'task_recipes') return textResult(Object.keys(recipes()));
    if (high && name === 'task_submit') return textResult(submitTask(a.recipe,a.idempotency_key));
    if (high && name === 'task_cancel') return textResult(await cancelTask(a.task_id));
    if (!allowed.has(name)) throw new Error('Tool denied by local policy');
    if(remote&&(a.isUrl===true||[a.path,...(Array.isArray(a.paths)?a.paths:[])].some(p=>typeof p==='string'&&/^[a-z][a-z0-9+.-]*:\/\//i.test(p))))throw new Error('Remote URL reads are denied; only the approved local folder is available');
    const result=await client.callTool({name,arguments:a}, undefined, {timeout:120000});
    return remote?publicToolResult(result):result;
  } catch (e) { return {isError:true,content:[{type:'text',text:e.message}]}; }
});
// The SDK entry selects a 2025 handshake or a 2026 per-request envelope from
// the first message. Bare connect() keeps the legacy codec and cannot discover.
const publicHandle=remote?serveStdio(()=>server):null;
if(!remote)await server.connect(new StdioServerTransport());
let closing = false;
async function close() { if(closing)return;closing=true;await publicHandle?.close().catch(()=>{});await desktop?.close().catch(()=>{});await client.close().catch(()=>{});process.exit(0); }
process.stdin.on('end',close);
process.on('SIGTERM',close);process.on('SIGINT',close);
