import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
export function writeJSON(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}
export function dcOptions() {
  const remote=process.env.GPT_MCP_REMOTE==='1';
  const control=remote&&process.env.GPT_MCP_CONTROL==='1'&&readJSON(path.join(ROOT,'config/public-control.json')).enabled===true;
  const dcHome=path.join(ROOT,control?'runtime/dc-control-home':remote?'runtime/dc-remote-home':'runtime/dc-home');
  const cfg=readJSON(path.join(dcHome,'.claude-server-commander/config.json'));
  if(cfg.telemetryEnabled!==false||JSON.stringify(cfg.allowedDirectories)!==JSON.stringify(control?[]:[path.join(ROOT,remote?'tests/public':'tests')]))throw new Error('Dedicated Desktop Commander safety configuration is invalid; refusing startup');
  return { command: process.execPath, args: ['--require', path.join(ROOT, 'gateway/dc-home.cjs'), path.join(ROOT, 'gateway/node_modules/@wonderwhy-er/desktop-commander/dist/index.js'), '--no-onboarding'],
    cwd: ROOT, stderr: 'pipe', env: { ...process.env, GPT_MCP_DC_HOME: dcHome, DO_NOT_TRACK: '1', ANONYMIZED_TELEMETRY: 'false' } };
}
export function appendLog(file,data,limit=10*1024*1024){
  const bytes=Buffer.isBuffer(data)?data:Buffer.from(data);
  if(fs.existsSync(file)&&fs.statSync(file).size+bytes.length>limit){fs.rmSync(file+'.1',{force:true});fs.renameSync(file,file+'.1');}
  fs.appendFileSync(file,bytes.length>limit?bytes.subarray(bytes.length-limit):bytes);
}
export const textResult = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
