// Isolated workerd test entry. No production deployment imports this file.
import {createWorker} from '../gateway/cloudflare/worker.mjs';
import {upstreamFetch} from './oauth-worker-entry.mjs';
const worker=createWorker({upstreamFetch,accessTokenTTL:60});
export default {fetch(request,env,ctx){
 const gate=request.headers.get('X-Unit-Gate');
 if(gate==='closed')env={...env,MCP_CONTROL_ENABLED:'false'};
 if(gate==='scope-disabled')env={...env,CONTROL_AUTH_ENABLED:'false'};
 if(gate==='wrong-owner')env={...env,OWNER_GITHUB_ID:'43'};
 return worker.fetch(request,env,ctx);
}};
