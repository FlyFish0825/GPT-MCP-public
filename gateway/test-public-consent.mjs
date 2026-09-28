import assert from 'node:assert/strict';
import {auth} from '@modelcontextprotocol/sdk/client/auth.js';
import {FileOAuthProvider,RESOURCE} from './oauth-session.mjs';
import path from 'node:path';
import {ROOT,writeJSON} from './common.mjs';
const provider=new FileOAuthProvider();
provider.tokens=()=>undefined;
provider.state=()=> 'public-consent-acceptance';
provider.saveCodeVerifier=()=>{};
let target;
provider.redirectToAuthorization=url=>{target=url;};
assert.equal(await auth(provider,{serverUrl:RESOURCE}),'REDIRECT');
const initial=await fetch(target,{redirect:'manual'});
assert.equal(initial.status,303,'Initial cookie delivery must use a same-origin redirect');
const cookie=initial.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
const page=await fetch(initial.headers.get('Location'),{redirect:'manual',headers:{Cookie:cookie}});
assert.equal(page.status,200);
for(const supplied of ['',cookie.replace(/=.+$/,'=wrong')]){
 const blocked=await fetch(initial.headers.get('Location'),{redirect:'manual',headers:{Cookie:supplied}});
 assert.equal(blocked.status,400);const error=await blocked.json();assert.equal(error.diagnostic,'browser_binding');assert.equal(error.stage,'consent_cookie_receipt');
}
const html=await page.text(),handle=html.match(/name="handle" value="([^"]+)"/)[1];
const result=await fetch(new URL('/authorize',RESOURCE),{method:'POST',redirect:'manual',headers:{Origin:new URL(RESOURCE).origin,Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({handle,decision:'approve'})});
assert.equal(result.status,200,'Consent must commit upstream cookie on a document response');
const approvedHtml=await result.text();
const location=approvedHtml.match(/<a href="([^"]+)"/)[1].replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
const cookieMetadata=response=>response.headers.getSetCookie().map(value=>{
 const fields=value.split(';').map(x=>x.trim()),get=name=>fields.find(x=>x.toLowerCase().startsWith(name.toLowerCase()+'='))?.slice(name.length+1);
 return {role:fields[0].startsWith('__Host-oauth-consent-')?'consent':fields[0].startsWith('__Host-oauth-upstream-')?'upstream':'unknown',secure:fields.includes('Secure'),http_only:fields.includes('HttpOnly'),same_site:get('SameSite'),path:get('Path'),domain_present:get('Domain')!==undefined,max_age:Number(get('Max-Age')),combined_cookie_header:/,\s*__Host-/.test(value)};
});
const report={timestamp:new Date().toISOString(),status:result.status,environment:'Real public Worker, controlled HTTP cookie jar; not a user browser',consent_cookie_receipt_verified:html.includes('Browser cookie receipt verified'),missing_and_altered_cookies_rejected:true,referrer_policy:page.headers.get('Referrer-Policy'),destination:new URL(location).origin+new URL(location).pathname,consent_cookies:cookieMetadata(initial),redirect_cookies:cookieMetadata(result)};
assert.equal(report.consent_cookies.length,1);assert.equal(report.redirect_cookies.length,2);
for(const attributes of [...report.consent_cookies,...report.redirect_cookies]){
 assert(attributes.secure&&attributes.http_only&&!attributes.domain_present&&!attributes.combined_cookie_header);assert.equal(attributes.same_site,'Lax');assert.equal(attributes.path,'/');assert([0,600].includes(attributes.max_age));
}
console.log(JSON.stringify(report));
assert.equal(new URL(location).origin,'https://github.com');
if(process.argv.includes('--binding-check')||process.argv.includes('--native-identity-check')){
 const callback=new URL('/callback',RESOURCE);callback.searchParams.set('state',new URL(location).searchParams.get('state'));
 if(process.argv.includes('--native-identity-check'))callback.searchParams.set('code','invalid-transport-probe');
 const response=await fetch(callback,{redirect:'manual',headers:{Cookie:result.headers.getSetCookie().filter(v=>!v.includes('Max-Age=0')).map(v=>v.split(';')[0]).join('; ')}});
 const body=await response.json();
 console.log(JSON.stringify({upstream_callback_binding_probe:response.status,result:body}));
 if(process.argv.includes('--native-identity-check')){assert.equal(body.diagnostic,'OAuthError','Native GitHub transport must reach a controlled invalid-code response');assert.equal(body.failure,'identity_code_rejected');assert.equal(body.provider_error,'bad_verification_code');const health=await(await fetch(new URL('/healthz',RESOURCE))).json();assert.equal(health.mcp_enabled,false);writeJSON(path.join(ROOT,'tests/identity-transport-result.json'),{timestamp:new Date().toISOString(),results:[{name:'real Worker native GitHub code exchange transport / invalid code rejected',status:'PASSED',detail:{failure:body.failure,provider_error:body.provider_error}}],public_mcp_disabled:true});process.exit(0);}
 assert.equal(body.error,'Missing identity code');
 report.upstream_binding_verified_without_identity_code=true;
 const replay=await fetch(callback,{redirect:'manual',headers:{Cookie:result.headers.getSetCookie().filter(v=>!v.includes('Max-Age=0')).map(v=>v.split(';')[0]).join('; ')}});
 assert.equal(replay.status,400);assert.equal((await replay.json()).diagnostic,'transaction_expired');report.upstream_state_replay_rejected=true;
}
const health=await(await fetch(new URL('/healthz',RESOURCE))).json();assert.equal(health.mcp_enabled,false);report.public_mcp_disabled=true;
writeJSON(path.join(ROOT,'tests/browser-binding-result.json'),report);
