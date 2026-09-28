. "$PSScriptRoot\common.ps1"
& "$PSScriptRoot\stop.ps1"
$taskName='GPT-MCP-Local'
if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){Unregister-ScheduledTask -TaskName $taskName -Confirm:$false}
$startup=Join-Path ([Environment]::GetFolderPath('Startup')) 'GPT-MCP-Local.lnk'
if(Test-Path -LiteralPath $startup){Remove-Item -LiteralPath $startup}
Write-Output 'Autostart removed. Original Codex, OpenCodex and Clash configurations were not changed. Files, credentials and task history are retained in the project directory for recovery.'
