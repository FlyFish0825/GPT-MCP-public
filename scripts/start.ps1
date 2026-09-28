param([switch]$EnableWriteAndExec, [switch]$EnableDesktopControl)
. "$PSScriptRoot\common.ps1"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run MCP as a non-elevated user, not Administrator.' }
if (Get-OwnedSupervisor) { Write-Output 'GPT-MCP is already running. Use restart.ps1 to change permissions.'; exit 0 }
$active = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -in 8765,8766,8768,8769,8770,8772,8780,8781}
if ($active) { throw 'A required port is occupied; existing processes will not be stopped automatically.' }
$cfg = @{enable_write_exec=[bool]$EnableWriteAndExec;enable_desktop_control=[bool]$EnableDesktopControl;public_exposure_enabled=$false}
$cfg | ConvertTo-Json | Set-Content (Join-Path $Root 'config\local.json') -Encoding UTF8
Remove-Item -LiteralPath (Join-Path $Root 'logs\stop.request') -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath $Node -ArgumentList @('"'+(Join-Path $Root 'gateway\supervisor.mjs')+'"') -WorkingDirectory $Root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $Root 'logs\supervisor-stdout.log') -RedirectStandardError (Join-Path $Root 'logs\supervisor-stderr.log')
Start-Sleep -Seconds 3
if (-not (Get-OwnedSupervisor)) { throw 'Supervisor failed; inspect logs.' }
Write-Output "GPT-MCP started. PID=$($p.Id), write/exec=$EnableWriteAndExec, desktop input=$EnableDesktopControl"
