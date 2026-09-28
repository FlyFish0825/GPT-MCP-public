param([switch]$StdioOnly)
. "$PSScriptRoot\common.ps1"
if($StdioOnly){ & $Node (Join-Path $Root 'gateway\test-local.mjs') '--stdio-only' }else{ & $Node (Join-Path $Root 'gateway\test-local.mjs') }
if($LASTEXITCODE -ne 0){throw 'MCP acceptance failed; see tests/local-result.json.'}
