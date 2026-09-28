param([switch]$LoginOnly,[switch]$Public)
. "$PSScriptRoot\common.ps1"
# Set HTTP_PROXY/HTTPS_PROXY in the environment when a local proxy is required.
$env:NO_PROXY='127.0.0.1,localhost'
$arguments=@('--use-env-proxy',(Join-Path $Root 'gateway\test-control.mjs'))
if($LoginOnly){$arguments+='--login-only'}
if($Public){$arguments+='--public'}
& $Node @arguments
exit $LASTEXITCODE
