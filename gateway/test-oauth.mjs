import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {ROOT,writeJSON} from './common.mjs';
const origin='https://your-worker.workers.dev',resource=origin+'/mcp',redirect='http://127.0.0.1:8790/callback';
const controlMode=process.argv.includes('--control');const results=[];let originCalls=0,controlOriginCalls=0;
const bundle=path.join(ROOT,'tests/oauth-unit-bundle.mjs');
await build({entryPoints:[path.join(ROOT,controlMode?'tests/oauth-control-entry.mjs':'tests/oauth-worker-entry.mjs')],bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['cloudflare:workers'],outfile:bundle});
const originToken=fs.readFileSync(path.join(ROOT,'secrets/remote-origin-token.txt'),'utf8').trim();
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'oauth-test',modules:true,scriptPath:bundle,compatibilityDate:'2026-09-26',compatibilityFlags:['global_fetch_strictly_public'],kvNamespaces:['OAUTH_KV'],bindings:{OWNER_GITHUB_ID:'42',OWNER_EMAIL:'owner@example.com',IDENTITY_PROVIDER:'github',IDENTITY_CLIENT_ID:'unit-client',IDENTITY_CLIENT_SECRET:'unit-secret',ORIGIN_TOKEN:originToken,MCP_ENABLED:'true',CONTROL_AUTH_ENABLED:controlMode?'true':'false',MCP_CONTROL_ENABLED:controlMode?'true':'false'},serviceBindings:{WINDOWS_MCP:async request=>{originCalls++;if(request.headers.get('X-GPT-MCP-Permission')==='control')controlOriginCalls++;if(request.method==='GET')return new Response(null,{status:405});assert.equal(request.headers.get('Authorization'),'Bearer '+originToken);assert.equal(request.headers.get('Origin'),null);assert.equal(request.headers.get('Cf-Access-Jwt-Assertion'),null);const body=request.method==='POST'?await request.arrayBuffer():undefined;const h=new Headers(request.headers);for(const n of ['host','connection','transfer-encoding','content-length'])h.delete(n);h.set('Host','127.0.0.1:8780');return fetch('http://127.0.0.1:8780/mcp',{method:request.method,headers:h,body,redirect:'manual'}).catch(e=>{throw new Error(e.message+': '+e.cause?.message)});}}}]}));
const run=(p,init={})=>mf.dispatchFetch(p.startsWith('http')?p:origin+p,{...init,redirect:'manual'});
const post=(p,data)=>run(p,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data)});
async function check(name,fn){try{const detail=await fn();results.push({name,status:'PASSED',detail});console.log('PASSED '+name);}catch(e){results.push({name,status:'FAILED',reason:e.message});console.error('FAILED '+name+': '+e.message);}}
const cookies=response=>response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
let clientId;
async function authorize(code='owner',mod={}){
  const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
  const args={response_type:'code',client_id:clientId,redirect_uri:redirect,resource,scope:'mcp:read',state:randomBytes(16).toString('hex'),code_challenge:challenge,code_challenge_method:'S256',...mod};
  const initial=await run('/authorize?'+new URLSearchParams(args));
  const cookieHeader=cookies(initial);
  const page=initial.status===303?await run(initial.headers.get('Location'),{headers:{Cookie:cookieHeader}}):initial;
  return {page,initial,cookieHeader,verifier,args,async finish(){
    assert.equal(page.status,200,'Consent page rejected');
    const html=await page.text(),handle=html.match(/name="handle" value="([^"]+)"/)[1];
    const approved=await run('/authorize',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:origin,Cookie:cookieHeader},body:new URLSearchParams({handle,decision:'approve'})});
    assert.equal(approved.status,200,'Approved consent document rejected');
    const navigation=(await approved.text()).match(/<a href="([^"]+)"/)[1].replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
    const loc=new URL(navigation);
    assert.equal(loc.origin,'https://github.com');assert.equal(loc.searchParams.get('code_challenge_method'),'S256');
    const cb=await run('/callback?'+new URLSearchParams({code,state:loc.searchParams.get('state')}),{headers:{Cookie:cookies(approved)}});
    return cb;
  }};
}
async function grant(code='owner',mod={}){
  const flow=await authorize(code,mod),cb=await flow.finish();assert.equal(cb.status,302,await cb.clone().text());
  const loc=new URL(cb.headers.get('Location'));assert.equal(loc.searchParams.get('state'),flow.args.state);assert.equal(loc.searchParams.get('iss'),origin);
  return {flow,code:loc.searchParams.get('code')};
}
async function exchange(g,changes={}){return post('/token',{grant_type:'authorization_code',client_id:clientId,redirect_uri:redirect,code:g.code,code_verifier:g.flow.verifier,resource,...changes});}
async function tokens(mod={}){const r=await exchange(await grant('owner',mod));assert.equal(r.status,200,await r.clone().text());return r.json();}
try{
 await check('RFC 8414 / RFC 9728 discovery / S256 only',async()=>{const as=await(await run('/.well-known/oauth-authorization-server')).json(),rs=await(await run('/.well-known/oauth-protected-resource/mcp')).json();assert.deepEqual(as.code_challenge_methods_supported,['S256']);assert.equal(as.issuer,origin);assert.equal(rs.resource,resource);assert(as.revocation_endpoint);});
 await check('unauthenticated / forged bearer rejected before origin',async()=>{for(const authorization of ['', 'Bearer forged'])assert.equal((await run('/mcp',{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:'{}'})).status,401);assert.equal(originCalls,0);});
 await check('unapproved DCR redirect rejected',async()=>assert.equal((await run('/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({redirect_uris:['https://evil.invalid/callback'],token_endpoint_auth_method:'none'})})).status,400));
 await check('approved SDK registration',async()=>{const r=await run('/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'<script>bad</script>',redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});assert.equal(r.status,201,await r.clone().text());clientId=(await r.json()).client_id;});
 await check('ChatGPT stable and per-client callbacks preserve opaque state / issuer / PKCE',async()=>{
  for(const callback of ['https://chatgpt.com/connector_platform_oauth_redirect','https://chatgpt.com/connector/oauth/unit-callback']){
   const r=await run('/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'ChatGPT callback contract test',redirect_uris:[callback],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});assert.equal(r.status,201);const id=(await r.json()).client_id;
   const scope=controlMode?'mcp:read mcp:control':'mcp:read',g=await grant('owner',{client_id:id,redirect_uri:callback,state:'opaque +/%&=测试 state',scope});
   const response=await exchange(g,{client_id:id,redirect_uri:callback});assert.equal(response.status,200,'ChatGPT-shaped callback code exchange failed');assert.equal((await response.json()).scope,scope);
  }
 });
 for(const [name,mod] of [['missing PKCE',{code_challenge:''}],['plain PKCE',{code_challenge_method:'plain'}],['write scope',{scope:'mcp:write'}],['wrong audience',{resource:'https://evil.invalid/mcp'}],['wrong redirect',{redirect_uri:'https://evil.invalid/callback'}]])await check(name,async()=>assert.equal((await authorize('owner',mod)).page.status,400));
 await check('consent escaped / anti-framing / browser-bound CSRF',async()=>{const a=await authorize(),html=await a.page.clone().text();assert(!html.includes('<script>'));assert(html.includes('&#60;script&#62;'));assert.equal(a.page.headers.get('X-Frame-Options'),'DENY');const handle=html.match(/name="handle" value="([^"]+)"/)[1];const r=await run('/authorize',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({handle,decision:'approve'})});assert.equal(r.status,400);});
 await check('consent form referrer policy / foreign and null origins denied',async()=>{const a=await authorize();assert.equal(a.page.headers.get('Referrer-Policy'),'same-origin');assert(a.page.headers.get('Content-Security-Policy').includes("form-action 'self' https://github.com http://127.0.0.1:8790/callback"));const html=await a.page.clone().text(),handle=html.match(/name="handle" value="([^"]+)"/)[1];for(const foreign of ['null','https://attacker.invalid','']){const r=await run('/authorize',{method:'POST',headers:{Origin:foreign,Cookie:a.cookieHeader,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({handle,decision:'approve'})});assert.equal(r.status,403);}});
 await check('browser cookie receipt / missing and altered cookies denied',async()=>{
  const a=await authorize();assert.equal(a.initial.status,303);assert.equal(a.page.status,200);
  assert((await a.page.clone().text()).includes('Browser cookie receipt verified'));
  for(const cookie of ['',a.cookieHeader.replace(/=.+$/,'=wrong')]){const r=await run(a.initial.headers.get('Location'),{headers:{Cookie:cookie}});assert.equal(r.status,400);const body=await r.json();assert.equal(body.diagnostic,'browser_binding');assert.equal(body.stage,'consent_cookie_receipt');}
 });
 await check('consent receipt immutable client request / replay denied',async()=>{
  const a=await authorize(),modified=new URL(a.initial.headers.get('Location'));modified.searchParams.set('state','altered');
  assert.equal((await run(modified.href,{headers:{Cookie:a.cookieHeader}})).status,400);
  const callback=await a.finish();assert.equal(callback.status,302);
  assert.equal((await run(a.initial.headers.get('Location'),{headers:{Cookie:a.cookieHeader}})).status,400);
 });
 await check('expired consent distinct from missing browser cookie',async()=>{
  const a=await authorize(),url=new URL(a.initial.headers.get('Location')),handle=url.searchParams.get('consent_receipt');
  const kv=await mf.getKVNamespace('OAUTH_KV');await kv.delete('consent-view:'+createHash('sha256').update(handle).digest('hex'));
  for(const response of [await run(url.href),await run('/authorize',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({handle,decision:'approve'})})]){
   assert.equal(response.status,400);assert.equal((await response.json()).diagnostic,'transaction_expired');
  }
 });
 for(const code of ['stranger','unverified'])await check('verified owner rejects '+code,async()=>{const a=await authorize(code);assert.notEqual((await a.finish()).status,302);});
 await check('GitHub token and user redirects denied without forwarding credentials',async()=>{for(const code of ['redirect-token','redirect-user']){const a=await authorize(code),response=await a.finish();assert.equal(response.status,503);assert.equal((await response.json()).failure,'identity_redirect_refused');}});
 await check('forged upstream callback rejected',async()=>assert.equal((await run('/callback?code=owner&state=forged')).status,400));
 await check('wrong PKCE verifier denied',async()=>{const r=await exchange(await grant(),{code_verifier:randomBytes(32).toString('base64url')});assert.equal(r.status,400);});
 await check('authorization code one-time use',async()=>{const g=await grant(),r=await exchange(g);assert.equal(r.status,200,await r.clone().text());assert.equal((await exchange(g)).status,400);});
 await check('OAuth token / real local MCP initialize, discovery and read',async()=>{
  const tok=await tokens(),c=new Client({name:'oauth-workerd-acceptance',version:'1'}),transport=new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{Authorization:'Bearer '+tok.access_token}},fetch:(url,init)=>run(String(url),init)});
  try{await c.connect(transport);const names=(await c.listTools()).tools.map(x=>x.name);assert(names.includes('read_file'));for(const n of ['write_file','start_process','Click','Type','Screenshot','set_config_value','task_submit'])assert(!names.includes(n));const r=await c.callTool({name:'read_file',arguments:{path:path.join(ROOT,'tests/public/mcp-sample.txt')}});assert(JSON.stringify(r).includes('MCP_MODIFIED'));const denied=await c.callTool({name:'read_file',arguments:{path:path.join(ROOT,'tests/mcp-sample.txt')}});assert(denied.isError);return {tool_count:names.length,identity:'Mock GitHub identity; actual local Desktop Commander through workerd'};}finally{await transport.terminateSession().catch(()=>{});await c.close();}
 });
 await check('modern OAuth forwarding / discovery / tool name mirrors enforced',async()=>{
  const tok=await tokens(),headers={Authorization:'Bearer '+tok.access_token,Accept:'application/json, text/event-stream','Content-Type':'application/json','MCP-Protocol-Version':'2026-07-28'};
  const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:'modern-oauth-acceptance',version:'1'},'io.modelcontextprotocol/clientCapabilities':{}};
  const rpc=(method,params={},name)=>run('/mcp',{method:'POST',headers:{...headers,'Mcp-Method':method,...(name?{'Mcp-Name':name}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{...params,_meta:meta}})});
  const discovery=await rpc('server/discover');assert.equal(discovery.status,200);assert((await discovery.json()).result.supportedVersions.includes('2026-07-28'));
  const list=await rpc('tools/list');assert.equal(list.status,200);assert((await list.json()).result.tools.length>=11);
  const read=await rpc('tools/call',{name:'read_file',arguments:{path:path.join(ROOT,'tests/public/mcp-sample.txt')}},'read_file');assert.equal(read.status,200);assert(JSON.stringify(await read.json()).includes('MCP_MODIFIED'));
  const wrong=await rpc('tools/call',{name:'read_file',arguments:{path:path.join(ROOT,'tests/public/mcp-sample.txt')}},'write_file');assert.equal(wrong.status,400);assert.equal((await wrong.json()).error.code,-32020);
 });
 if(controlMode){
  const scope='mcp:read mcp:control';
  await check('control metadata and explicit high permission consent',async()=>{const m=await(await run('/.well-known/oauth-authorization-server')).json();assert.deepEqual(m.scopes_supported,['mcp:read','mcp:control']);const a=await authorize('owner',{scope}),s=await a.page.text();assert(s.includes('file creation, modification and deletion')&&s.includes('PowerShell/CMD'));});
  await check('control without S256 or owner identity rejected',async()=>{assert.equal((await authorize('owner',{scope,code_challenge:''})).page.status,400);assert.notEqual((await(await authorize('stranger',{scope})).finish()).status,302);});
  await check('old read grant cannot forge control routing',async()=>{const t=await tokens(),before=controlOriginCalls;const c=new Client({name:'forged-control-header-test',version:'1'}),tr=new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{Authorization:'Bearer '+t.access_token,'X-GPT-MCP-Permission':'control'}},fetch:(u,i)=>run(String(u),i)});try{await c.connect(tr);const tools=(await c.listTools()).tools;assert(!tools.some(x=>x.name==='start_process'));for(const name of ['write_file','delete_file','start_process','desktop_Click'])assert((await c.callTool({name,arguments:{}})).isError);assert.equal(controlOriginCalls,before);}finally{await tr.terminateSession().catch(()=>{});await c.close();}});
  await check('existing readonly connection has explicit safe OAuth upgrade challenge',async()=>{const t=await tokens(),before=controlOriginCalls,c=new Client({name:'step-up-test',version:'1'}),tr=new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{Authorization:'Bearer '+t.access_token}},fetch:(u,i)=>run(String(u),i)});try{await c.connect(tr);const tool=(await c.listTools()).tools.find(x=>x.name==='request_control_access');assert(tool);assert.deepEqual(tool._meta.securitySchemes[0].scopes,['mcp:read','mcp:control']);const result=await c.callTool({name:tool.name,arguments:{}});assert(result.isError);assert(result._meta['mcp/www_authenticate'][0].includes('error="insufficient_scope"'));assert.equal(controlOriginCalls,before);}finally{await tr.terminateSession().catch(()=>{});await c.close();}});
  await check('control activation gate closed and wrong owner deny before origin',async()=>{const t=await tokens({scope}),before=originCalls;for(const [gate,status] of [['closed',503],['wrong-owner',403]])assert.equal((await run('/mcp',{headers:{Authorization:'Bearer '+t.access_token,'X-Unit-Gate':gate}})).status,status);assert.equal(originCalls,before);});
  await check('fresh control scope routes to real control tools',async()=>{const t=await tokens({scope});assert.equal(t.scope,scope);const before=controlOriginCalls,c=new Client({name:'control-workerd-acceptance',version:'1'}),tr=new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{Authorization:'Bearer '+t.access_token}},fetch:(u,i)=>run(String(u),i)});try{await c.connect(tr);const names=(await c.listTools()).tools.map(x=>x.name);for(const name of ['write_file','edit_block','delete_file','start_process','desktop_Click','desktop_Type','desktop_Screenshot'])assert(names.includes(name));const read=await c.callTool({name:'read_file',arguments:{path:path.join(ROOT,'tests/mcp-sample.txt')}});assert(!read.isError);assert(controlOriginCalls>before);return {tool_count:names.length,identity:'Mock GitHub owner; real loopback control MCP'};}finally{await tr.terminateSession().catch(()=>{});await c.close();}});
  await check('refresh retains control scope / revoke denies all access',async()=>{const t=await tokens({scope}),r=await post('/token',{grant_type:'refresh_token',client_id:clientId,refresh_token:t.refresh_token,resource});assert.equal(r.status,200);const rotated=await r.json();assert.equal(rotated.scope,scope);assert.equal((await post('/token',{client_id:clientId,token:rotated.refresh_token,token_type_hint:'refresh_token'})).status,200);assert.equal((await run('/mcp',{headers:{Authorization:'Bearer '+rotated.access_token}})).status,401);});
  await check('same-client new control consent revokes old grant instead of elevating it',async()=>{const old=await tokens(),fresh=await tokens({scope});assert.equal((await run('/mcp',{headers:{Authorization:'Bearer '+old.access_token}})).status,401);assert.equal((await post('/token',{grant_type:'refresh_token',client_id:clientId,refresh_token:old.refresh_token,resource})).status,400);assert.equal(fresh.scope,scope);await post('/token',{client_id:clientId,token:fresh.refresh_token,token_type_hint:'refresh_token'});});
 }
 if(!process.argv.includes('--quick'))await check('access token expiration rejects',async()=>{const t=await tokens(),ct=controlMode?await tokens({scope:'mcp:read mcp:control'}):null;await new Promise(r=>setTimeout(r,61000));for(const tok of [t,ct].filter(Boolean))assert.equal((await run('/mcp',{headers:{Authorization:'Bearer '+tok.access_token}})).status,401);});
 await check('refresh rotation / grant revocation',async()=>{const t=await tokens(),r=await post('/token',{grant_type:'refresh_token',client_id:clientId,refresh_token:t.refresh_token,resource});assert.equal(r.status,200,await r.clone().text());const rotated=await r.json();assert(rotated.refresh_token!==t.refresh_token);const revoked=await post('/token',{client_id:clientId,token:rotated.refresh_token,token_type_hint:'refresh_token'});assert.equal(revoked.status,200,await revoked.clone().text());assert.equal((await run('/mcp',{headers:{Authorization:'Bearer '+rotated.access_token}})).status,401);assert.equal((await post('/token',{grant_type:'refresh_token',client_id:clientId,refresh_token:rotated.refresh_token,resource})).status,400);});
}finally{await mf.dispose();const quick=process.argv.includes('--quick'),report={timestamp:new Date().toISOString(),environment:'Local workerd; GitHub identity mocked; local MCP real',expiration_wait_completed:!quick,results};writeJSON(path.join(ROOT,'tests',`${controlMode?'control-oauth':'oauth'}${quick?'-quick':''}-result.json`),report);if(controlMode&&!quick)writeJSON(path.join(ROOT,'tests/oauth-result.json'),report);}
if(results.some(x=>x.status==='FAILED'))process.exitCode=1;

