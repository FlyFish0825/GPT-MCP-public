import {AuthorizationError} from '@cloudflare/workers-oauth-provider';
const hex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
const digest=async value=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
function equal(a,b){if(a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}
const fingerprint=request=>digest(JSON.stringify([request.clientId,request.redirectUri,request.responseType,request.resource,request.scope,request.state,request.codeChallenge,request.codeChallengeMethod,request.issuer]));
async function receiptKey(handle){
 if(!/^[A-Za-z0-9_-]{43}$/.test(handle))throw new AuthorizationError('invalid_request',{description:'Invalid consent receipt'});
 return digest(handle);
}
// A read-only browser receipt check in front of the official approveConsent.
// Provider 1.1.0 names its host-only cookie using SHA256(handle); the original
// encrypted transaction and all official binding/state/PKCE checks remain intact.
export async function rememberConsentView(env,handle,request){
 const hash=await receiptKey(handle);
 await env.OAUTH_KV.put('consent-view:'+hash,await fingerprint(request),{expirationTtl:600});
}
export async function verifyConsentReceipt(env,handle,authRequest,request){
 const hash=await receiptKey(handle),name='__Host-oauth-consent-'+hash.slice(0,16);
 const saved=await env.OAUTH_KV.get('consent-view:'+hash);
 if(!saved)throw new AuthorizationError('invalid_request',{description:'This authorization expired or was already used; start again'});
 let bound;
 for(const field of (request.headers.get('Cookie')||'').split(';')){const index=field.indexOf('=');if(index>=0&&field.slice(0,index).trim()===name){bound=field.slice(index+1).trim();break;}}
 if(!bound)throw new AuthorizationError('invalid_request',{description:'This authorization was not started in this browser; start again'});
 if(!equal(hash,bound))throw new AuthorizationError('invalid_request',{description:'This authorization belongs to a different browser session; start again'});
 if(!equal(saved,await fingerprint(authRequest)))throw new AuthorizationError('invalid_request',{description:'Consent view request mismatch'});
}
export async function verifyConsentLifetime(env,handle){
 if(!await env.OAUTH_KV.get('consent-view:'+await receiptKey(handle)))throw new AuthorizationError('invalid_request',{description:'This authorization expired or was already used; start again'});
}
export async function forgetConsentView(env,handle){await env.OAUTH_KV.delete('consent-view:'+await receiptKey(handle));}
