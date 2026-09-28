param([switch]$Login,[switch]$LoginOnly,[switch]$ProbeOnly,[switch]$Revoke,[switch]$RecoverTunnel)
. "$PSScriptRoot\common.ps1"
# Set HTTP_PROXY/HTTPS_PROXY in the environment when a local proxy is required.
$env:NO_PROXY='127.0.0.1,localhost'
$arguments=@('--use-env-proxy',(Join-Path $Root 'gateway\test-remote.mjs'))
if($Login){$arguments+='--login'}
if($LoginOnly){$arguments+='--login-only'}
if($ProbeOnly){$arguments+='--probe-only'}
if($Revoke){$arguments+='--revoke'}
if($RecoverTunnel){$arguments+='--recover-tunnel'}
& $Node @arguments
exit $LASTEXITCODE
