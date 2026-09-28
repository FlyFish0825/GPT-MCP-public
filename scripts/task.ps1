param([ValidateSet('submit','status','log','cancel','recipes')][string]$Action='recipes',[string]$Recipe,[string]$Key,[string]$TaskId)
. "$PSScriptRoot\common.ps1"
& $Node (Join-Path $Root 'gateway\task-cli.mjs') $Action $Recipe $Key $TaskId
if($LASTEXITCODE -ne 0){throw 'Task command failed.'}
