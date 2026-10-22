$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$build=Join-Path $root '.preview/free-site'
$public=Join-Path $build 'public'
New-Item -ItemType Directory -Path (Join-Path $public 'assets') -Force | Out-Null
foreach($name in @('index.html','style.css','core.js','app.js','pricing-source.js')) {
  Copy-Item -LiteralPath (Join-Path $root $name) -Destination (Join-Path $public $name) -Force
}
foreach($team in @('raiders','rams','seahawks','chargers','broncos','titans')) {
  Copy-Item -LiteralPath (Join-Path $root "assets/$team.svg") -Destination (Join-Path $public "assets/$team.svg") -Force
}
$config=@{
  name='jd-ticket-tracker';main='../../hosted/worker.js';compatibility_date='2026-10-22';workers_dev=$true;preview_urls=$false
  assets=@{directory='./public';binding='ASSETS';run_worker_first=$true}
  durable_objects=@{bindings=@(@{name='RELAY';class_name='JDRelay'})}
  migrations=@(@{tag='v1';new_sqlite_classes=@('JDRelay')})
}
$config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $build 'wrangler.json') -Encoding UTF8
Write-Output 'Prepared the public page and private relay. No browser profiles or local configuration are included.'
