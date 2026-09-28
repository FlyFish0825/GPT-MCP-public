param([switch]$EnableWriteAndExec,[switch]$EnableDesktopControl)
& "$PSScriptRoot\stop.ps1"
& "$PSScriptRoot\start.ps1" -EnableWriteAndExec:$EnableWriteAndExec -EnableDesktopControl:$EnableDesktopControl
