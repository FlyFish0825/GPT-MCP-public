import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {timingSafeEqual} from 'node:crypto';
import {ROOT} from './common.mjs';
const port=Number(process.env.GPT_MCP_FRONT_PORT||8765);
const backend=Number(process.env.GPT_MCP_BACK_PORT||8766);
const tokenFile=process.env.GPT_MCP_TOKEN_FILE||'local-token.txt';
const expected = Buffer.from('Bearer '+fs.readFileSync(path.join(ROOT,'secrets',tokenFile),'utf8').trim());
const server = http.createServer((req,res) => {
  const deny = (code,msg) => {res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:msg}));};
  if (![ `127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)) return deny(403,'Invalid Host');
  if (req.headers.origin) return deny(403,'Browser origins are disabled');
  const token=Buffer.from(req.headers.authorization||'');
  if(token.length!==expected.length || !timingSafeEqual(token,expected)) {res.setHeader('WWW-Authenticate','Bearer realm="local-only"');return deny(401,'Authentication required');}
  if(req.url!=='/mcp')return deny(404,'Not found');
  if(!['POST','GET','DELETE'].includes(req.method))return deny(405,'Method not allowed');
  const control=port===8780&&process.env.GPT_MCP_CONTROL_ROUTE==='1'&&req.headers['x-gpt-mcp-permission']==='control';
  const target=control?8772:backend;
  const headers={...req.headers,host:`127.0.0.1:${target}`};delete headers.authorization;delete headers['x-gpt-mcp-permission'];
  const upstream=http.request({host:'127.0.0.1',port:target,path:'/mcp',method:req.method,headers}, r=>{
    const h={...r.headers};delete h['access-control-allow-origin'];res.writeHead(r.statusCode,h);r.pipe(res);
    res.on('close',()=>r.destroy());
  });
  upstream.on('error',()=>{if(!res.headersSent)deny(503,'MCP backend unavailable');else res.destroy();});
  upstream.setTimeout(125000,()=>upstream.destroy());
  let bytes=0;req.on('data',data=>{bytes+=data.length;if(bytes>2*1024*1024){upstream.destroy();req.destroy();}});
  req.pipe(upstream);
});
server.requestTimeout=130000;
server.listen(port,'127.0.0.1',()=>console.log(`Authenticated MCP listening on 127.0.0.1:${port}`));
