// Test entry only. Production wrangler.jsonc never imports this file.
import {createWorker} from '../gateway/cloudflare/worker.mjs';
export const upstreamFetch=async(url,init)=>{
  if(init.redirect!=='manual')throw new TypeError('Unsupported identity redirect mode');
  if(url==='https://github.com/login/oauth/access_token'){
    const code=new URLSearchParams(init.body).get('code');
    if(code==='redirect-token')return new Response(null,{status:302,headers:{Location:'https://attacker.invalid/token'}});
    return Response.json({access_token:code});
  }
  const token=new Headers(init.headers).get('Authorization').slice(7);
  if(token==='revoked')return new Response('',{status:401});
  if(token==='redirect-user')return new Response(null,{status:302,headers:{Location:'https://attacker.invalid/user'}});
  if(url==='https://api.github.com/user')return Response.json({id:token==='stranger'?43:(token==='unverified'?null:42)});
  if(url==='https://api.github.com/user/emails')return Response.json([{email:token==='stranger'?'stranger@example.com':'owner@example.com',verified:token!=='unverified'}]);
  throw new Error('Unexpected identity URL');
};
export default createWorker({upstreamFetch,accessTokenTTL:60,onUnexpectedError:e=>{if(!(e.name==='AuthorizationError'||e.name==='OAuthError'))console.error(e.stack)}});
