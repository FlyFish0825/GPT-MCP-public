. "$PSScriptRoot\common.ps1"
$dst=Join-Path $Root ('backups\deployment-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $dst | Out-Null
foreach($d in @('config','scripts','docs','tasks\state','.codex')) { $src=Join-Path $Root $d; if(Test-Path -LiteralPath $src){$target=Join-Path $dst $d;New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null;Copy-Item -LiteralPath $src -Destination $target -Recurse} }
$gatewayTarget=Join-Path $dst 'gateway'
New-Item -ItemType Directory -Path $gatewayTarget | Out-Null
Get-ChildItem -LiteralPath (Join-Path $Root 'gateway') -File | Copy-Item -Destination $gatewayTarget
$workerTarget=Join-Path $gatewayTarget 'cloudflare'
New-Item -ItemType Directory -Path $workerTarget | Out-Null
foreach($name in @('worker.mjs','identity.mjs','browser-binding.mjs','wrangler.jsonc')){Copy-Item -LiteralPath (Join-Path $Root ('gateway\cloudflare\'+$name)) -Destination $workerTarget}
foreach($name in @('README.md','.gitignore')){Copy-Item -LiteralPath (Join-Path $Root $name) -Destination $dst}
$fixtureTarget=Join-Path $dst 'tests'
New-Item -ItemType Directory -Path $fixtureTarget | Out-Null
foreach($name in @('desktop-window.ps1','oauth-worker-entry.mjs','oauth-control-entry.mjs')){Copy-Item -LiteralPath (Join-Path $Root ('tests\'+$name)) -Destination $fixtureTarget}
Write-Output $dst
