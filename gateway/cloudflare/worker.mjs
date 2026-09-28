import {OAuthProvider,AuthorizationError,OAuthError} from '@cloudflare/workers-oauth-provider';
import {loginStart,loginFinish,refreshIdentity,identityConfigured} from './identity.mjs';
import {rememberConsentView,verifyConsentReceipt,verifyConsentLifetime,forgetConsentView} from './browser-binding.mjs';
export const ORIGIN='https://your-worker.workers.dev', RESOURCE=ORIGIN+'/mcp';
const json=(status,error)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});
const escape=value=>String(value).replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const RPC_METHODS=new Set(['initialize','notifications/initialized','server/discover','tools/list','tools/call','resources/list','resources/templates/list','resources/read','prompts/list','skills/list','ping']);
function redirectClass(value){try{const u=new URL(value);if(u.origin==='https://chatgpt.com'&&u.pathname==='/connector_platform_oauth_redirect')return 'chatgpt_stable';if(u.origin==='https://chatgpt.com'&&/^\/connector\/oauth\/[a-zA-Z0-9_-]+$/.test(u.pathname))return 'chatgpt_per_client';if(['127.0.0.1','localhost'].includes(u.hostname))return 'local_sdk';}catch{}return 'other';}
async function oauthTrace(request){
 const u=new URL(request.url);if(!['/authorize','/callback','/token','/register'].includes(u.pathname))return null;
 const record={phase:u.pathname.slice(1),http_method:request.method,cookie_header_present:request.headers.has('Cookie')};
 if(u.pathname==='/authorize'&&request.method==='GET'){
  const scope=(u.searchParams.get('scope')||'').split(' ').filter(Boolean);
  Object.assign(record,{state_present:!!u.searchParams.get('state'),pkce_present:!!u.searchParams.get('code_challenge'),pkce_s256:u.searchParams.get('code_challenge_method')==='S256',consent_receipt_present:u.searchParams.has('consent_receipt'),control_requested:scope.includes('mcp:control'),redirect_class:redirectClass(u.searchParams.get('redirect_uri'))});
 }
 if(u.pathname==='/callback')Object.assign(record,{identity_code_present:!!u.searchParams.get('code'),upstream_state_present:!!u.searchParams.get('state'),upstream_error_present:u.searchParams.has('error')});
 if(u.pathname==='/token'&&request.method==='POST')try{const form=new URLSearchParams(new TextDecoder().decode(await limitedBody(request.clone(),16384))),grant=form.get('grant_type');Object.assign(record,{grant_type:['authorization_code','refresh_token'].includes(grant)?grant:'other',client_assertion_present:form.has('client_assertion'),code_present:form.has('code'),verifier_present:form.has('code_verifier'),resource_matches:form.get('resource')===RESOURCE,token_scope_explicit:form.has('scope'),token_scope_control:(form.get('scope')||'').split(' ').includes('mcp:control')});}catch{record.form_unreadable=true;}
 return record;
}
function logOAuth(trace,response,failure){
 if(!trace)return;const record={...trace,status:response?.status||503,...(failure?{failure}:{})};
 const location=response?.headers.get('Location');if(location&&trace.phase==='callback')try{const u=new URL(location);Object.assign(record,{redirect_class:redirectClass(location),callback_code_present:!!u.searchParams.get('code'),callback_state_present:!!u.searchParams.get('state'),callback_issuer_present:u.searchParams.has('iss'),callback_issuer_matches:u.searchParams.get('iss')===ORIGIN,callback_error_present:u.searchParams.has('error')});}catch{record.redirect_unreadable=true;}
 console.log('OAUTH_DIAGNOSTIC '+JSON.stringify(record));
}
async function discoveryTrace(request){
  const h=request.headers;let message;
  if(request.method==='POST')try{message=JSON.parse(new TextDecoder().decode(await limitedBody(request.clone())));}catch{}
  const version=h.get('mcp-protocol-version')||message?.params?.protocolVersion;
  const name=message?.params?.clientInfo?.name||message?.params?._meta?.['io.modelcontextprotocol/clientInfo']?.name;
  const client_class=['discovery-diagnostic','raw-discovery-diagnostic','public-acceptance'].includes(name)?'project_sdk':/chatgpt|openai/i.test(typeof name==='string'?name:'')?'openai_named_client':'other';
  return {http_method:request.method,rpc_method:RPC_METHODS.has(message?.method)?message.method:'other',client_class,protocol_version:/^\d{4}-\d{2}-\d{2}$/.test(version)?version:null,session_present:h.has('mcp-session-id'),method_header_present:h.has('mcp-method'),name_header_present:h.has('mcp-name'),bearer_present:/^Bearer /i.test(h.get('authorization')||''),accept_json:(h.get('accept')||'').includes('application/json'),accept_sse:(h.get('accept')||'').includes('text/event-stream'),content_json:(h.get('content-type')||'').includes('application/json')};
}
function failureCode(error){
  const text=String(error?.message||'');
  for(const [fragment,code] of [['KV PUT','kv_write'],['KV GET','kv_read'],['KV DELETE','kv_delete'],['expired','transaction_expired'],['not started in this browser','browser_binding'],['different browser','browser_binding'],['Illegal invocation','runtime_invocation'],['scope','scope_policy'],['Only the approved','request_policy']])if(text.includes(fragment))return code;
  return ['TypeError','RangeError','DataError','NotSupportedError','AuthorizationError','OAuthError'].includes(error?.name)?error.name:'authorization_failure';
}
export function allowedRedirect(value){
  try{const u=new URL(value);if(u.username||u.password||u.hash)return false;
    if(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname))return u.port==='8790'&&u.pathname==='/callback'&&!u.search;
    return u.origin==='https://chatgpt.com'&&(/^\/connector\/oauth\/[a-zA-Z0-9_-]+$/.test(u.pathname)||u.pathname==='/connector_platform_oauth_redirect')&&!u.search;
  }catch{return false;}
}
function validateRequest(r,env){
  const read=r.scope.length===1&&r.scope[0]==='mcp:read';
  const control=env.CONTROL_AUTH_ENABLED==='true'&&r.scope.length===2&&r.scope.includes('mcp:read')&&r.scope.includes('mcp:control');
  if(!allowedRedirect(r.redirectUri)||r.resource!==RESOURCE||r.responseType!=='code'||r.codeChallengeMethod!=='S256'||!r.codeChallenge||!read&&!control)throw new AuthorizationError('invalid_request',{description:'Only the approved callback, S256 PKCE and explicitly enabled MCP scopes are allowed'});
}
async function limitedBody(request,max=2*1024*1024){
  if(!request.body)return undefined;
  const reader=request.body.getReader(),chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new Error('Body limit');}chunks.push(value);}
  const all=new Uint8Array(size);let offset=0;for(const v of chunks){all.set(v,offset);offset+=v.length;}return all;
}
export function createWorker(options={}){
  const upstreamFetch=options.upstreamFetch||fetch;
  const protectedApi={async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname!=='/mcp'||u.search)return json(404,'Not found');
    if(!['POST','GET','DELETE'].includes(request.method))return json(405,'Method not allowed');
    const control=ctx.auth?.scope?.includes('mcp:control')&&ctx.props?.control===true&&ctx.props?.readOnly===false;
    if(!env.OWNER_GITHUB_ID||ctx.props?.userId!=='github-'+env.OWNER_GITHUB_ID||!ctx.auth?.scope?.includes('mcp:read')||!control&&ctx.props?.readOnly!==true)return json(403,'Owner MCP authorization required');
    if(env.MCP_ENABLED!=='true'||!env.ORIGIN_TOKEN)return json(503,'MCP security acceptance is pending');
    if(control&&env.MCP_CONTROL_ENABLED!=='true')return json(503,'Public control security acceptance is pending');
    const headers=new Headers({Authorization:'Bearer '+env.ORIGIN_TOKEN,Host:'127.0.0.1:8780'});
    if(control)headers.set('X-GPT-MCP-Permission','control');
    for(const name of ['accept','content-type','mcp-session-id','mcp-protocol-version','mcp-method','mcp-name','last-event-id']){const v=request.headers.get(name);if(v)headers.set(name,v);}
    // Forward only protocol-defined argument mirrors, never arbitrary client
    // headers. The gateway validates mirrors against the authenticated body.
    for(const [name,value] of request.headers)if(/^mcp-param-[a-z0-9_-]+$/.test(name))headers.set(name,value);
    let body;try{body=request.method==='POST'?await limitedBody(request):undefined;}catch{return json(413,'Request too large');}
    try{
      const r=await env.WINDOWS_MCP.fetch('http://127.0.0.1:8780/mcp',{method:request.method,headers,body,redirect:'manual'});
      const output=new Headers({'Cache-Control':'no-store','X-GPT-MCP-Stage':'origin','X-GPT-MCP-Permission-Profile':control?'control':'read'});for(const n of ['content-type','mcp-session-id','mcp-protocol-version','allow']){const v=r.headers.get(n);if(v)output.set(n,v);}
      if((r.headers.get('content-type')||'').includes('text/event-stream'))output.set('X-Accel-Buffering','no');
      return new Response(r.body,{status:r.status,headers:output});
    }catch{return json(503,'Windows MCP unavailable');}
  }};
  const interactive={async fetch(request,env){
    const u=new URL(request.url),oauth=env.OAUTH_PROVIDER;
    if(u.pathname==='/healthz')return Response.json({service:'gpt-mcp',authentication:'OAuth 2.1',permissions:env.MCP_CONTROL_ENABLED==='true'?'owner-control; old read-only grants stay read-only':'read-only',identity_ready:identityConfigured(env),mcp_enabled:env.MCP_ENABLED==='true',control_auth_enabled:env.CONTROL_AUTH_ENABLED==='true',control_enabled:env.MCP_CONTROL_ENABLED==='true'},{headers:{'Cache-Control':'no-store'}});
    if(!['/authorize','/callback'].includes(u.pathname))return json(404,'Not found');
    if(!identityConfigured(env))return json(503,'Identity login configuration is incomplete');
    if(u.pathname==='/authorize'&&request.method==='GET'){
      const r=await oauth.parseAuthRequest(request);validateRequest(r,env);
      const client=await oauth.lookupClient(r.clientId);if(!client)return json(400,'Unknown client');
      const receipt=u.searchParams.get('consent_receipt');
      if(!receipt){
        const consent=await oauth.beginConsent(r);await rememberConsentView(env,consent.handle,r);
        const next=new URL(request.url);next.searchParams.set('consent_receipt',consent.handle);
        consent.headers.set('Location',next.href);consent.headers.set('Referrer-Policy','no-referrer');
        return new Response(null,{status:303,headers:consent.headers});
      }
      await verifyConsentReceipt(env,receipt,r,request);
      const consent={handle:receipt},h=new Headers({'Cache-Control':'no-store','X-Frame-Options':'DENY'});
      h.set('Content-Type','text/html; charset=utf-8');h.set('Content-Security-Policy',`default-src 'none'; form-action 'self' https://github.com ${r.redirectUri}; frame-ancestors 'none'; base-uri 'none'`);h.set('Referrer-Policy','same-origin');
      const local=new URL(r.redirectUri).protocol==='http:';
      const publisher=r.clientId.startsWith('https://')?new URL(r.clientId).hostname:'Self-registered client (name is unverified)';
      const control=r.scope.includes('mcp:control');
      const permissionText=control?'Scope: mcp:read mcp:control. This grants file creation, modification and deletion, PowerShell/CMD execution, screenshots, mouse and keyboard control as the current Windows user. Commands can access user files and the network. Only approve your own client.':'Scope: mcp:read. Access is limited to the test folder and task status. No file writes, terminal, screen capture, mouse or keyboard control.';
      const html=`<!doctype html><html lang="en"><meta charset="utf-8"><title>My Windows PC authorization</title><h1>Authorize My Windows PC ${control?'owner control':'read-only access'}</h1><p>Browser cookie receipt verified. Complete this login in this same window and browser profile within 10 minutes.</p><p>Client: <strong>${escape(client.clientName||r.clientId)}</strong></p><p>Publisher: ${escape(publisher)}</p><p>Return URL: <strong>${escape(r.redirectUri)}</strong></p><p>${permissionText}</p>${local?'<p>This grants access to a local app. Continue only if you just started this login.</p>':''}<form method="post" action="/authorize"><input type="hidden" name="handle" value="${escape(consent.handle)}"><button name="decision" value="approve">Continue to ${escape(env.IDENTITY_PROVIDER)} login</button><button name="decision" value="deny">Deny</button></form></html>`;
      return new Response(html,{headers:h});
    }
    if(u.pathname==='/authorize'&&request.method==='POST'){
      if(request.headers.get('Origin')!==ORIGIN)return json(403,'Invalid consent origin');
      const form=await new Request(request.url,{method:'POST',headers:request.headers,body:await limitedBody(request,16384)}).formData();
      const handle=String(form.get('handle')||'');
      await verifyConsentLifetime(env,handle);
      if(form.get('decision')!=='approve'){const denied=await oauth.denyConsent(request,handle);await forgetConsentView(env,handle);return new Response(null,{status:302,headers:denied.headers});}
      const approved=await oauth.approveConsent(request,handle);validateRequest(approved.request,env);
      await forgetConsentView(env,handle);
      // Commit the HttpOnly upstream cookie on a document response before starting
      // a fresh top-level GET navigation. A POST -> GitHub -> callback redirect
      // chain can suppress SameSite=Lax cookies in browsers.
      const headers=await loginStart(env,oauth,approved.request,approved.headers);
      const destination=headers.get('Location');headers.delete('Location');
      headers.set('Content-Type','text/html; charset=utf-8');
      headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      headers.set('X-Frame-Options','DENY');
      return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escape(destination)}"><title>Continue GitHub sign-in</title><h1>Continue GitHub sign-in</h1><p>Continue in this same browser window and profile.</p><p><a href="${escape(destination)}" rel="noreferrer">Continue to GitHub</a></p></html>`,{headers});
    }
    if(u.pathname==='/callback'&&request.method==='GET'){
      const flow=await oauth.finishUpstream(request);validateRequest(flow.request,env);
      if(u.searchParams.has('error'))return json(403,'Identity login was declined');
      const code=u.searchParams.get('code');if(!code)return json(400,'Missing identity code');
      const identity=await loginFinish(env,flow.data,code,upstreamFetch);
      const control=flow.request.scope.includes('mcp:control');
      const {redirectTo}=await oauth.completeAuthorization({request:flow.request,userId:identity.userId,metadata:{clientName:control?'My Windows PC owner control':'My Windows PC read-only'},scope:flow.request.scope,props:{...identity,readOnly:!control,...(control?{control:true}:{})}});
      // Fail closed if a provider change ever loses the validated client's state
      // or issuer. Do not generate replacement state or change the callback URL.
      const responseUrl=new URL(redirectTo);
      if(responseUrl.searchParams.get('state')!==(flow.request.state||null)||responseUrl.searchParams.get('iss')!==ORIGIN||!responseUrl.searchParams.get('code'))throw new OAuthError('server_error',{description:'Authorization response integrity failed'});
      flow.headers.set('Location',redirectTo);flow.headers.set('Referrer-Policy','no-referrer');
      return new Response(null,{status:302,headers:flow.headers});
    }
    return json(405,'Method not allowed');
  }};
  const providers=new WeakMap();
  function getProvider(env){
  if(providers.has(env))return providers.get(env);
  const provider=new OAuthProvider({
    apiRoute:'/mcp',apiHandler:protectedApi,defaultHandler:interactive,
    authorizeEndpoint:ORIGIN+'/authorize',tokenEndpoint:ORIGIN+'/token',clientRegistrationEndpoint:ORIGIN+'/register',
    accessTokenTTL:options.accessTokenTTL||900,refreshTokenTTL:86400,clientRegistrationTTL:86400*30,
    allowImplicitFlow:false,allowPlainPKCE:false,allowTokenExchangeGrant:false,
    scopesSupported:env.CONTROL_AUTH_ENABLED==='true'?['mcp:read','mcp:control']:['mcp:read'],clientIdMetadataDocumentEnabled:true,
    onError:()=>{},
    resourceMetadata:{resource:RESOURCE,authorization_servers:[ORIGIN],scopes_supported:env.CONTROL_AUTH_ENABLED==='true'?['mcp:read','mcp:control']:['mcp:read'],resource_name:'My Windows PC'},
    clientRegistrationCallback:({clientMetadata:m})=>Array.isArray(m.redirect_uris)&&m.redirect_uris.length>0&&m.redirect_uris.every(allowedRedirect)?undefined:{description:'Only ChatGPT and the approved local SDK callback are supported'},
    tokenExchangeCallback:async({grantType,props})=>{
      if(!env.OWNER_GITHUB_ID||props?.userId!=='github-'+env.OWNER_GITHUB_ID||props?.readOnly!==true&&!(env.CONTROL_AUTH_ENABLED==='true'&&props?.control===true&&props?.readOnly===false))throw new OAuthError('invalid_grant',{description:'Identity policy changed'});
      if(grantType==='refresh_token')return {newProps:await refreshIdentity(env,props,upstreamFetch)};
    }
  });
  providers.set(env,provider);return provider;
  }
  return {async fetch(request,env,ctx){
    if(new URL(request.url).origin!==ORIGIN)return json(403,'Invalid host');
    const isMcp=new URL(request.url).pathname==='/mcp',started=Date.now();
    const trace=isMcp?await discoveryTrace(request):null;
    const authTrace=await oauthTrace(request);
    try{const response=await getProvider(env).fetch(request,env,ctx);
      logOAuth(authTrace,response);
      if(trace)console.log('MCP_DIAGNOSTIC '+JSON.stringify({...trace,status:response.status,stage:response.headers.get('X-GPT-MCP-Stage')||'oauth_or_policy',permission_profile:response.headers.get('X-GPT-MCP-Permission-Profile')||'none',response_json:(response.headers.get('content-type')||'').includes('application/json'),response_sse:(response.headers.get('content-type')||'').includes('text/event-stream'),session_returned:response.headers.has('mcp-session-id'),elapsed_ms:Date.now()-started}));
      return response;
    }catch(e){
      logOAuth(authTrace,null,failureCode(e));
      if(trace)console.log('MCP_DIAGNOSTIC '+JSON.stringify({...trace,status:503,stage:'worker_exception',failure:failureCode(e),elapsed_ms:Date.now()-started}));
      options.onUnexpectedError?.(e);
      const diagnostic=failureCode(e),pathname=new URL(request.url).pathname;
      const stage=pathname==='/callback'?'github_callback':pathname==='/authorize'&&request.method==='POST'?'consent_submission':pathname==='/authorize'&&new URL(request.url).searchParams.has('consent_receipt')?'consent_cookie_receipt':'authorization';
      const binding_reason=diagnostic==='browser_binding'?(String(e.message).includes('not started')?'missing_cookie':'cookie_mismatch'):undefined;
      return Response.json({error:'Authorization request failed; access denied',diagnostic,stage,operation:e.oauthOperation,failure:e.oauthFailure,provider_error:e.oauthProviderError,binding_reason,cookie_header_present:diagnostic==='browser_binding'?request.headers.has('Cookie'):undefined},{status:e instanceof AuthorizationError?400:503,headers:{'Cache-Control':'no-store'}});
    }
  }};
}
export default createWorker();
