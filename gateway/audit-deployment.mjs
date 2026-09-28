import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT,readJSON,writeJSON} from './common.mjs';
const credentials=[];
for(const name of ['local-token.txt','desktop-token.txt','remote-origin-token.txt','tunnel-token.txt'])credentials.push(fs.readFileSync(path.join(ROOT,'secrets',name),'utf8').trim());
const identity=readJSON(path.join(ROOT,'secrets/identity-client.json'));credentials.push(identity.client_secret);
for(const name of ['sdk-oauth.json','sdk-control-oauth.json']){const sdkPath=path.join(ROOT,'secrets',name);if(fs.existsSync(sdkPath)){const sdk=readJSON(sdkPath);credentials.push(sdk.tokens?.access_token,sdk.tokens?.refresh_token,sdk.client?.client_secret);}}
const values=credentials.filter(x=>typeof x==='string'&&x.length>=16),hits=[];
function walk(dir){if(!fs.existsSync(dir))return;for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.wrangler','oauth-build','worker-build'].includes(entry.name))continue;const file=path.join(dir,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory())walk(file);else if(/\.(mjs|cjs|json|jsonc|md|ps1|toml|txt|log)$/i.test(file)&&fs.statSync(file).size<30*1024*1024){const content=fs.readFileSync(file,'utf8');if(values.some(value=>content.includes(value)))hits.push(path.relative(ROOT,file));}}}
for(const dir of ['gateway','config','scripts','docs','tests','.codex','logs','secrets/xdg/.wrangler/logs'])walk(path.join(ROOT,dir));
const lock=readJSON(path.join(ROOT,'gateway/package-lock.json')),dependencies=Object.fromEntries(Object.keys(lock.packages[''].dependencies).map(n=>[n,lock.packages['node_modules/'+n]?.version]));
const sha=file=>createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');
writeJSON(path.join(ROOT,'docs/component-manifest.json'),{timestamp:new Date().toISOString(),dependencies,package_lock_sha256:sha('gateway/package-lock.json'),cloudflared_sha256:sha('runtime/cloudflared/cloudflared.exe')});
writeJSON(path.join(ROOT,'docs/credential-scan.json'),{timestamp:new Date().toISOString(),method:'Exact matching against current protected credentials; values never emitted',matching_files:hits});
console.log(JSON.stringify({credential_matching_files:hits,component_manifest_written:true}));
if(hits.length)process.exitCode=1;
