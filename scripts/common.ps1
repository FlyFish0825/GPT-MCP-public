$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Node = 'C:\Program Files\nodejs\node.exe'
function Read-State {
    $statePath = Join-Path $Root 'logs\supervisor.json'
    try { return [IO.File]::ReadAllText($statePath) | ConvertFrom-Json } catch [IO.FileNotFoundException] { return $null } catch [IO.DirectoryNotFoundException] { return $null }
    return $null
}
function Get-OwnedSupervisor {
    $s = Read-State
    if ($s) {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId = $($s.pid)" -ErrorAction SilentlyContinue
        if ($p -and $p.CommandLine -like "*$Root\gateway\supervisor.mjs*") { return $p }
    }
    return $null
}
