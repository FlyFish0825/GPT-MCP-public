import {submitTask,getTask,taskLog,cancelTask,recipes} from './task-manager.mjs';
const [action,recipe,key,id]=process.argv.slice(2);
try{let result;switch(action){case 'submit':result=submitTask(recipe,key);break;case 'status':result=getTask(id);break;case 'log':result=taskLog(id);break;case 'cancel':result=await cancelTask(id);break;default:result=recipes();}console.log(JSON.stringify(result,null,2));}catch(e){console.error(e.message);process.exitCode=1;}
