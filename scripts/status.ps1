. "$PSScriptRoot\common.ps1"
$s=Read-State
$ready=$false
try{$ready=(Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8781/ready' -TimeoutSec 3).StatusCode -eq 200}catch{}
$publicEnabled=$null;$publicControl=$null
$publicOrigin=if($env:GPT_MCP_PUBLIC_ORIGIN){$env:GPT_MCP_PUBLIC_ORIGIN.TrimEnd('/')}else{$null}
$publicHttps=if($publicOrigin){$publicOrigin+'/mcp'}else{$null}
try{if(-not $publicOrigin){throw 'GPT_MCP_PUBLIC_ORIGIN is not set'};$health=Invoke-RestMethod -Uri ($publicOrigin+'/healthz') -TimeoutSec 10;if($health.service -eq 'gpt-mcp'){$publicEnabled=[bool]$health.mcp_enabled;$publicControl=[bool]$health.control_enabled}}catch{}
[pscustomobject]@{Running=[bool](Get-OwnedSupervisor);LocalMcp='http://127.0.0.1:8765/mcp';DesktopMcp='http://127.0.0.1:8768/mcp/';PublicHttps=$publicHttps;TunnelReady=$ready;PublicMcpEnabled=$publicEnabled;PublicControlEnabled=$publicControl;PublicAuthentication='Official OAuth Provider; separate mcp:read and explicitly consented mcp:control grants';StateNote='Set GPT_MCP_PUBLIC_ORIGIN for public health checks. Public switches come from live Worker health, null if unavailable.';State=$s} | ConvertTo-Json -Depth 6
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -in 8765,8766,8768,8769,8770,8772,8780,8781} | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json
