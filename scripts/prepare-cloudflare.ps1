$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"
$credentialPath=Join-Path $Root 'secrets\xdg\.wrangler\config\default.toml'
$raw=Get-Content -LiteralPath $credentialPath -Raw
$match=[regex]::Match($raw,'(?m)^oauth_token\s*=\s*"([^"]+)"')
if(-not $match.Success){throw 'Wrangler OAuth credential is missing. Run browser login first.'}
$headers=@{Authorization='Bearer '+$match.Groups[1].Value}
$account=$env:CLOUDFLARE_ACCOUNT_ID
if(-not $account){throw 'Set CLOUDFLARE_ACCOUNT_ID before preparing Cloudflare deployment.'}
$base="https://api.cloudflare.com/client/v4/accounts/$account"
$tunnelId=$env:CLOUDFLARE_TUNNEL_ID
if(-not $tunnelId){throw 'Set CLOUDFLARE_TUNNEL_ID before preparing Cloudflare deployment.'}
$workerName=$env:CLOUDFLARE_WORKER_NAME
if(-not $workerName){throw 'Set CLOUDFLARE_WORKER_NAME before preparing Cloudflare deployment.'}
$token=Invoke-RestMethod -Uri "$base/cfd_tunnel/$tunnelId/token" -Headers $headers
if(-not $token.success){throw 'Tunnel credential retrieval failed'}
[IO.File]::WriteAllText((Join-Path $Root 'secrets\tunnel-token.txt'),$token.result,(New-Object Text.UTF8Encoding($false)))
$backup=Join-Path $Root 'backups\worker-before'
New-Item -ItemType Directory -Force -Path $backup | Out-Null
if(-not (Test-Path -LiteralPath (Join-Path $backup 'content.bin'))){
  Invoke-WebRequest -UseBasicParsing -Uri "$base/workers/scripts/${workerName}/content/v2" -Headers $headers -OutFile (Join-Path $backup 'content.bin') | Out-Null
  $settings=Invoke-RestMethod -Uri "$base/workers/scripts/${workerName}/settings" -Headers $headers
  $settings | ConvertTo-Json -Depth 30 | Set-Content (Join-Path $backup 'settings.json') -Encoding UTF8
}
Write-Output 'Tunnel credential stored in restricted secrets folder; original Worker backed up. No credential printed.'
