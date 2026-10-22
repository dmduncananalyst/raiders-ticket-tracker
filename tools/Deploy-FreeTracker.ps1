param([string]$RelayUrl)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$runtime=Join-Path $root '.preview/runtime/node-v24.22.1-win-x64'
$env:PATH=$runtime+';'+$env:PATH
$env:npm_config_cache=Join-Path $root '.preview/npm-cache'
$env:WRANGLER_SEND_METRICS='false'
$node=Join-Path $runtime 'node.exe'
$npx=Join-Path $runtime 'node_modules/npm/bin/npx-cli.js'
$config=Join-Path $root '.preview/free-site/wrangler.json'
& (Join-Path $PSScriptRoot 'Prepare-FreeSite.ps1')
# Ordinary deployment must preserve Cloudflare secrets. Never replay saved keys.
$ErrorActionPreference='Continue'
try{$output=& $node $npx -y wrangler@latest deploy --config $config 2>&1;$exitCode=$LASTEXITCODE}
finally{$ErrorActionPreference='Stop'}
$output | ForEach-Object {Write-Output $_}
if($exitCode -ne 0){throw 'Cloudflare deployment did not complete.'}
if(!$RelayUrl){
  $match=[regex]::Match(($output|Out-String),'https://jd-ticket-tracker\.[a-zA-Z0-9-]+\.workers\.dev')
  if(!$match.Success){throw 'Deployment succeeded but its address could not be determined.'}
  $RelayUrl=$match.Value+'/'
}
$uri=[Uri]$RelayUrl
if($uri.Scheme -ne 'https' -or !$uri.Host.EndsWith('.workers.dev') -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment){throw 'Invalid deployment address'}
Write-Output 'Deployment complete. Existing viewing and publishing credentials were preserved.'
