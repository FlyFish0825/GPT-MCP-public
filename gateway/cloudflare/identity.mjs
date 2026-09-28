import {OAuthError} from '@cloudflare/workers-oauth-provider';
const callback='https://your-worker.workers.dev/callback';
export function identityConfigured(env){return env.IDENTITY_PROVIDER==='github'&&!!env.IDENTITY_CLIENT_ID&&!!env.IDENTITY_CLIENT_SECRET&&/^[1-9][0-9]*$/.test(env.OWNER_GITHUB_ID||'');}
const b64=v=>btoa(String.fromCharCode(...new Uint8Array(v))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function s256(text){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));}
export async function loginStart(env,oauth,request,headers){
  const verifier=b64(crypto.getRandomValues(new Uint8Array(32)));
  const flow=await oauth.beginUpstream(request,{data:{verifier,provider:'github'},headers});
  const u=new URL('https://github.com/login/oauth/authorize');
  for(const [k,v]of Object.entries({client_id:env.IDENTITY_CLIENT_ID,redirect_uri:callback,state:flow.state,code_challenge:await s256(verifier),code_challenge_method:'S256',scope:'read:user',response_type:'code',allow_signup:'false'}))u.searchParams.set(k,v);
  flow.headers.set('Location',u.href);flow.headers.set('Referrer-Policy','no-referrer');return flow.headers;
}
async function jsonFetch(fetcher,url,init){
 const operation=url==='https://github.com/login/oauth/access_token'?'github_code_exchange':'github_user_lookup';
 let r;
 try{r=await fetcher(url,{...init,redirect:'manual',signal:AbortSignal.timeout(15000)});}catch(error){
  const reason=String(error?.message||'').toLowerCase();
  error.oauthOperation=operation;error.oauthFailure=reason.includes('redirect')?'redirect_refused':reason.includes('this')||reason.includes('invocation')?'fetch_binding':reason.includes('fetch')||reason.includes('network')?'fetch_transport':'runtime_type';throw error;
 }
 if(r.status>=300&&r.status<400){const error=new OAuthError('temporarily_unavailable',{description:'Identity redirects are not allowed'});error.oauthOperation=operation;error.oauthFailure='identity_redirect_refused';throw error;}
 if(!r.ok)throw new OAuthError(r.status===401?'invalid_grant':'temporarily_unavailable',{description:'Identity service refused request'});
 try{return await r.json();}catch(error){error.oauthOperation=operation;error.oauthFailure='identity_response_format';throw error;}
}
async function githubIdentity(env,token,fetcher){
  const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','User-Agent':'GPT-MCP-owner-auth','X-GitHub-Api-Version':'2022-11-28'};
  const user=await jsonFetch(fetcher,'https://api.github.com/user',{headers});
  if(!Number.isSafeInteger(user.id)||String(user.id)!==env.OWNER_GITHUB_ID)throw new OAuthError('invalid_grant',{description:'The immutable owner GitHub ID is required'});
  return {userId:'github-'+user.id,upstreamToken:token,provider:'github'};
}
export async function loginFinish(env,data,code,fetcher){
  if(data?.provider!==env.IDENTITY_PROVIDER||!data.verifier)throw new OAuthError('invalid_grant',{description:'Identity flow mismatch'});
  const body=new URLSearchParams({client_id:env.IDENTITY_CLIENT_ID,client_secret:env.IDENTITY_CLIENT_SECRET,redirect_uri:callback,code,code_verifier:data.verifier,grant_type:'authorization_code'});
  const token=await jsonFetch(fetcher,'https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded','User-Agent':'GPT-MCP-owner-auth'},body});
  if(token.error||!token.access_token){const error=new OAuthError('invalid_grant',{description:'Identity code exchange failed'});error.oauthOperation='github_code_exchange';error.oauthFailure='identity_code_rejected';error.oauthProviderError=['bad_verification_code','incorrect_client_credentials','redirect_uri_mismatch'].includes(token.error)?token.error:'identity_rejected';throw error;}
  return githubIdentity(env,token.access_token,fetcher);
}
export async function refreshIdentity(env,props,fetcher){
  if(props.provider!==env.IDENTITY_PROVIDER)throw new OAuthError('invalid_grant',{description:'Identity provider changed'});
  const identity=await githubIdentity(env,props.upstreamToken,fetcher);if(identity.userId!==props.userId)throw new OAuthError('invalid_grant');return {...props,...identity};
}
