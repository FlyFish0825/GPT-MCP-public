import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {auth} from '@modelcontextprotocol/sdk/client/auth.js';
import {ROOT,readJSON,writeJSON} from './common.mjs';
export const RESOURCE='https://your-worker.workers.dev/mcp';
export class FileOAuthProvider{
 constructor({control=false}={}){this.control=control;this.file=path.join(ROOT,control?'secrets/sdk-control-oauth.json':'secrets/sdk-oauth.json');this.data=fs.existsSync(this.file)?readJSON(this.file):{};}
 get redirectUrl(){return 'http://127.0.0.1:8790/callback';}
 get clientMetadata(){return {client_name:this.control?'GPT-MCP owner control acceptance':'GPT-MCP official SDK acceptance',redirect_uris:[this.redirectUrl],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none',scope:this.control?'mcp:read mcp:control':'mcp:read'};}
 save(){writeJSON(this.file,this.data);}
 clientInformation(){return this.data.client;}
 saveClientInformation(value){this.data.client=value;this.save();}
 tokens(){return this.data.tokens;}
 saveTokens(value){this.data.tokens=value;this.data.token_saved_at=Date.now();this.save();}
 state(){this.data.state=randomBytes(32).toString('base64url');this.save();return this.data.state;}
 saveCodeVerifier(value){this.data.verifier=value;this.save();}
 codeVerifier(){if(!this.data.verifier)throw new Error('PKCE verifier is missing');return this.data.verifier;}
 redirectToAuthorization(url){if(url.origin!=='https://your-worker.workers.dev'||url.pathname!=='/authorize')throw new Error('Unexpected authorization origin');if(!this.openLoginPage)throw new Error('Fresh browser login server is required');this.openLoginPage(url);}
 invalidateCredentials(scope){if(scope==='all')this.data={};else if(scope==='client')delete this.data.client;else if(scope==='tokens')delete this.data.tokens;else if(scope==='verifier')delete this.data.verifier;this.save();}
}
export async function browserLogin(provider){
 let resolveCode,rejectCode,consumed=false,authorizationUrl,started=false;
 provider.openLoginPage=url=>{
  if(authorizationUrl)throw new Error('A second authorization URL in the same run is refused');
  authorizationUrl=url.href;
  const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler','http://127.0.0.1:8790/start'],{windowsHide:true,stdio:'ignore',detached:true});child.unref();
  console.log('Fresh OAuth opened at http://127.0.0.1:8790/start. Continue in that same browser window and profile; do not reuse older login tabs.');
 };
 const codePromise=new Promise((resolve,reject)=>{resolveCode=resolve;rejectCode=reject;});
 // Avoid an unhandled rejection if discovery fails before the browser step.
 codePromise.catch(()=>{});
 const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1:8790');
  if(req.method==='GET'&&req.headers.host==='127.0.0.1:8790'&&u.pathname==='/status'&&!u.search){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({login_started:started,callback_received:consumed}));return;}
  if(req.method==='GET'&&req.headers.host==='127.0.0.1:8790'&&u.pathname==='/start'&&!u.search){
   if(!authorizationUrl||started){res.writeHead(409,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('This login entry has already been used or is not ready. Start one fresh login; do not reuse this page.');return;}
   started=true;res.writeHead(303,{Location:authorizationUrl,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();return;
  }
  if(req.method!=='GET'||req.headers.host!=='127.0.0.1:8790'||u.pathname!=='/callback'||consumed||!provider.data.state||u.searchParams.get('state')!==provider.data.state){res.writeHead(400);res.end('Invalid OAuth callback.');return;}
  consumed=true;delete provider.data.state;provider.save();
  if(u.searchParams.get('error')||!u.searchParams.get('code')){res.writeHead(403);res.end('Authorization was declined.');rejectCode(new Error('Browser authorization declined'));return;}
  const iss=u.searchParams.get('iss');if(iss!=='https://your-worker.workers.dev'){res.writeHead(400);res.end('OAuth issuer mismatch.');rejectCode(new Error('OAuth issuer mismatch'));return;}
  res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end('Authorization received. Return to Codex; credentials are kept locally.');resolveCode(u.searchParams.get('code'));
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(8790,'127.0.0.1',resolve);});
 const timer=setTimeout(()=>rejectCode(new Error('Browser authorization timed out after 10 minutes')),600000);
 try{
  let result=await auth(provider,{serverUrl:RESOURCE,scope:provider.clientMetadata.scope});
  if(result==='REDIRECT'){const code=await codePromise;result=await auth(provider,{serverUrl:RESOURCE,authorizationCode:code,scope:provider.clientMetadata.scope});}
  if(result!=='AUTHORIZED'||!provider.tokens()?.access_token)throw new Error('OAuth login did not complete');
 }finally{clearTimeout(timer);provider.openLoginPage=undefined;server.close();}
}
