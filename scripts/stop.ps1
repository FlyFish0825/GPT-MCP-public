. "$PSScriptRoot\common.ps1"
$p = Get-OwnedSupervisor
if (-not $p) { Write-Output 'GPT-MCP is already stopped.'; exit 0 }
Set-Content (Join-Path $Root 'logs\stop.request') 'stop'
for ($i=0;$i -lt 20;$i++) { Start-Sleep -Milliseconds 500; if (-not (Get-OwnedSupervisor)) { Write-Output 'GPT-MCP stopped; detached tasks continue.'; exit 0 } }
throw 'Graceful stop timed out; inspect logs before stopping any process.'
