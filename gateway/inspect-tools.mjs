import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {dcOptions} from './common.mjs';
import fs from 'node:fs';
const client=new Client({name:'acceptance-inspector',version:'1'});const t=new StdioClientTransport(dcOptions());
await client.connect(t);const list=await client.listTools();fs.writeFileSync('G:/GPT-MCP/tests/tool-schemas.json',JSON.stringify(list,null,2));console.log(JSON.stringify(list.tools.filter(x=>['start_process','start_search','edit_block','read_file','get_more_search_results'].includes(x.name)).map(x=>({name:x.name,inputSchema:x.inputSchema})),null,2));console.log(JSON.stringify(await client.callTool({name:'get_config',arguments:{}}),null,2));await client.close();
