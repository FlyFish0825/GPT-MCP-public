param([Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$')][string]$GitHubUsername,[string]$ClientId)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\common.ps1"
$owner=Invoke-RestMethod -Uri ('https://api.github.com/users/'+[Uri]::EscapeDataString($GitHubUsername)) -Headers @{'User-Agent'='GPT-MCP-owner-setup';'Accept'='application/vnd.github+json'}
if(-not $owner.id -or [string]$owner.id -notmatch '^[1-9][0-9]*$'){throw 'Could not resolve immutable GitHub user ID'}
  if(-not $ClientId){$ClientId=Read-Host 'OAuth application Client ID (not your account password)'}
  $secure=Read-Host 'OAuth application Client Secret (stored locally only; never send to chat)' -AsSecureString
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try{$clientSecret=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
if(-not $ClientId -or -not $clientSecret){throw 'OAuth application credentials are incomplete'}
$file=Join-Path $Root 'secrets\identity-client.json'
[IO.File]::WriteAllText($file,(@{client_id=$ClientId;client_secret=$clientSecret}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
@{IDENTITY_PROVIDER='github';OWNER_GITHUB_ID=[string]$owner.id}|ConvertTo-Json|Set-Content (Join-Path $Root 'config\identity-public.json') -Encoding UTF8
Write-Output "Identity client saved in restricted secrets folder. GitHub account=$($owner.login), immutable ID=$($owner.id). No secret printed; deployment remains fail closed by default."
