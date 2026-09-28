param([switch]$EnablePublicReadOnly,[switch]$PreparePublicControl,[switch]$EnablePublicControl)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\common.ps1"
# Set HTTP_PROXY/HTTPS_PROXY in the environment when a local proxy is required.
$env:XDG_CONFIG_HOME=Join-Path $Root 'secrets\xdg'
$env:WRANGLER_SEND_METRICS='false'
$cli=Join-Path $Root 'gateway\node_modules\wrangler\bin\wrangler.js'
$cfg=Join-Path $Root 'gateway\cloudflare\wrangler.jsonc'
$identityPath=Join-Path $Root 'secrets\identity-client.json'
$rotationPath=Join-Path $Root 'config\secret-rotation-confirmation.json'
if($PreparePublicControl -or $EnablePublicControl){$EnablePublicReadOnly=$true}
if(Test-Path -LiteralPath $identityPath){
  if(-not(Test-Path -LiteralPath $rotationPath)){throw 'Credential disposition must be recorded before identity credential upload.'}
  $rotation=Get-Content -Raw -Encoding UTF8 $rotationPath|ConvertFrom-Json
  $configuredAt=(Get-Item -LiteralPath $identityPath).LastWriteTimeUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  if(($rotation.old_secret_revoked -ne $true -and $rotation.user_authorized_retention -ne $true) -or $rotation.identity_configured_at -ne $configuredAt){throw 'Current credential disposition has not been confirmed.'}
}
$arguments=@($cli,'deploy','--config',$cfg)
$public=Join-Path $Root 'config\identity-public.json'
if(Test-Path -LiteralPath $public){
  $vars=Get-Content -Raw -Encoding UTF8 $public | ConvertFrom-Json
  foreach($property in $vars.PSObject.Properties){$arguments+=@('--var',($property.Name+':'+$property.Value))}
}
if($EnablePublicReadOnly){
  $acceptance=Join-Path $Root 'tests\oauth-result.json'
  if(-not(Test-Path $acceptance)){throw 'Run the OAuth security acceptance first.'}
  $report=Get-Content -Raw -Encoding UTF8 $acceptance|ConvertFrom-Json
  if(@($report.results|Where-Object {$_.status -ne 'PASSED'}).Count -gt 0 -or -not($report.results.name -contains 'access token expiration rejects')){throw 'Full OAuth security acceptance must pass, including expiration.'}
  if(-not(Test-Path (Join-Path $Root 'secrets\identity-client.json'))){throw 'Identity provider registration is incomplete.'}
  $readOnlyReport=Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'tests\readonly-result.json')|ConvertFrom-Json
  if(@($readOnlyReport.results).Count -lt 7 -or @($readOnlyReport.results|Where-Object {$_.status -ne 'PASSED'}).Count){throw 'Public origin read-only security acceptance must pass.'}
  $loginReport=Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'tests\remote-login-result.json')|ConvertFrom-Json
  $login=@($loginReport.results|Where-Object {$_.name -eq 'real GitHub owner OAuth / SDK code exchange' -and $_.status -eq 'PASSED'})
  if(@($loginReport.results|Where-Object {$_.status -ne 'PASSED'}).Count -or $login.Count -ne 1){throw 'Real owner GitHub OAuth login must pass before public MCP is enabled.'}
  $configuredAt=(Get-Item -LiteralPath (Join-Path $Root 'secrets\identity-client.json')).LastWriteTimeUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $timeDifference=[math]::Abs(([datetime]::Parse($login[0].detail.identity_configured_at).ToUniversalTime()-(Get-Item -LiteralPath $identityPath).LastWriteTimeUtc).TotalMilliseconds)
  $sameCredential=$timeDifference -le 1
  if($login[0].detail.identity_config_sha256){$sameCredential=$login[0].detail.identity_config_sha256 -eq (Get-FileHash -LiteralPath $identityPath -Algorithm SHA256).Hash.ToLowerInvariant()}
  if($login[0].detail.owner_github_id -ne $vars.OWNER_GITHUB_ID -or -not $sameCredential){throw 'Identity configuration changed after acceptance. Repeat real login.'}
  $rotation=Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'config\secret-rotation-confirmation.json')|ConvertFrom-Json
  if($rotation.old_secret_revoked -ne $true -and $rotation.user_authorized_retention -ne $true){throw 'Current credential disposition has not been confirmed.'}
  $arguments+=@('--var','MCP_ENABLED:true')
}
if($PreparePublicControl -or $EnablePublicControl){
 $controlConfig=Get-Content -LiteralPath (Join-Path $Root 'config\public-control.json') -Raw -Encoding UTF8|ConvertFrom-Json
 if($controlConfig.enabled -ne $true -or $controlConfig.owner_github_id -ne $vars.OWNER_GITHUB_ID){throw 'Explicit owner control authorization is missing'}
 foreach($reportName in @('control-local-result','control-oauth-result')){
  $controlReport=Get-Content -LiteralPath (Join-Path $Root ('tests\'+$reportName+'.json')) -Raw -Encoding UTF8|ConvertFrom-Json
  if(@($controlReport.results).Count -lt 5 -or @($controlReport.results|Where-Object {$_.status -ne 'PASSED'}).Count){throw 'Owner control security acceptance must pass before offering control scope'}
 }
 $arguments+=@('--var','CONTROL_AUTH_ENABLED:true')
 if($EnablePublicControl){
  $controlLogin=Get-Content -LiteralPath (Join-Path $Root 'tests\control-login-result.json') -Raw -Encoding UTF8|ConvertFrom-Json
  if($controlLogin.status -ne 'PASSED' -or $controlLogin.owner_github_id -ne $vars.OWNER_GITHUB_ID -or $controlLogin.scope -ne 'mcp:read mcp:control' -or $controlLogin.identity_config_sha256 -ne (Get-FileHash -LiteralPath $identityPath -Algorithm SHA256).Hash.ToLowerInvariant()){throw 'Fresh real owner control OAuth consent must pass before public control activation'}
  $arguments+=@('--var','MCP_CONTROL_ENABLED:true')
 }
}
& $Node @arguments
if($LASTEXITCODE -ne 0){throw 'Worker deployment failed'}
$bundle=Join-Path $Root 'secrets\worker-upload.json'
$data=@{ORIGIN_TOKEN=([IO.File]::ReadAllText((Join-Path $Root 'secrets\remote-origin-token.txt')).Trim())}
$identityPath=Join-Path $Root 'secrets\identity-client.json'
if(Test-Path -LiteralPath $identityPath){
  $identity=Get-Content -Raw -Encoding UTF8 $identityPath|ConvertFrom-Json
  if(-not $identity.client_id -or -not $identity.client_secret){throw 'Identity client is incomplete'}
  $data.IDENTITY_CLIENT_ID=$identity.client_id
  $data.IDENTITY_CLIENT_SECRET=$identity.client_secret
}
[IO.File]::WriteAllText($bundle,($data|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
try{& $Node $cli secret bulk $bundle --config $cfg;if($LASTEXITCODE -ne 0){throw 'Worker secret upload failed'}}finally{Remove-Item -LiteralPath $bundle -Force}
Write-Output "Worker deployed with official OAuth Provider; public read-only enabled=$EnablePublicReadOnly. All authentication failures deny access."
Write-Output "Control OAuth offered=$($PreparePublicControl -or $EnablePublicControl); public owner control enabled=$EnablePublicControl. Existing read-only grants are not elevated."
