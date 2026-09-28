import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {dcOptions} from './common.mjs';
const c=new Client({name:'terminal-diagnostic',version:'1'});await c.connect(new StdioClientTransport(dcOptions()));
for(const command of ["Write-Output 'MCP_TERMINAL_OK'; exit 0","[Console]::Error.WriteLine('MCP_EXPECTED_STDERR'); exit 7"]){const r=await c.callTool({name:'start_process',arguments:{command,timeout_ms:10000}});console.log(JSON.stringify(r,null,2));const s=r.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');const pid=s.match(/(?:PID|process)[:\s]+(\d+)/i)?.[1];if(pid)console.log(JSON.stringify(await c.callTool({name:'read_process_output',arguments:{pid:Number(pid),timeout_ms:15000}}),null,2));}
await c.close();
