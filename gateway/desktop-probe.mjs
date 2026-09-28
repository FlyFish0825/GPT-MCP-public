import fs from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {ROOT,writeJSON} from './common.mjs';
const c=new Client({name:'desktop-probe',version:'1'});
try{
 await c.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8768/mcp/'),{requestInit:{headers:{Authorization:'Bearer '+fs.readFileSync(path.join(ROOT,'secrets/desktop-token.txt'),'utf8').trim()}}}));
 const list=await c.listTools();writeJSON(path.join(ROOT,'tests/desktop-tools-control.json'),list);
 console.log(list.tools.map(t=>({name:t.name,input:t.inputSchema})));
 const snapshot=await c.callTool({name:'Snapshot',arguments:{use_vision:true,use_ui_tree:true,use_annotation:false}});
 const img=snapshot.content?.find(x=>x.type==='image');
 if(img){fs.writeFileSync(path.join(ROOT,'tests/desktop-screenshot.png'),Buffer.from(img.data,'base64'));console.log('Screenshot image received: '+img.mimeType);}
 console.log((snapshot.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n').slice(0,1600));
}finally{await c.close();}
