console.log('LONG_TASK_STARTED');
setTimeout(()=>{console.log('LONG_TASK_FINISHED');process.exit(0);},12000);
