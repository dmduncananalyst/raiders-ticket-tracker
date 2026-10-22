$ErrorActionPreference='Stop'
$installed=Join-Path $env:LOCALAPPDATA 'JD Ticket Tracker'
$owner=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed=@($owner,'S-1-5-18','S-1-5-32-544')
$paths=@($installed,(Join-Path $installed 'tools'),(Join-Path $installed '.preview'),(Join-Path $installed 'private'))
$paths+=@(Get-ChildItem -LiteralPath (Join-Path $installed 'tools') -File | ForEach-Object FullName)
$paths+=@(Get-ChildItem -LiteralPath (Join-Path $installed '.preview') -File | ForEach-Object FullName)
$checks=foreach($path in $paths){
  $acl=Get-Acl -LiteralPath $path
  $bad=@($acl.Access | Where-Object {$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowed})
  if($bad.Count){throw ('Unexpected permission: '+$path)}
  [pscustomobject]@{Path=$path;AllowedIdentitiesOnly=$true}
}
$task=Get-ScheduledTask -TaskName 'JD Ticket Tracker'
if($task.State -ne 'Disabled'){throw 'Task is not disabled'}
if($task.Actions.Arguments -notlike ('*'+$installed+'*') -or $task.Actions.WorkingDirectory -ne $installed){throw 'Task still references repository'}
$remaining=@(Get-ChildItem -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) '.preview') -Directory | Where-Object {Test-Path -LiteralPath (Join-Path $_.FullName 'Local State')})
if($remaining.Count){throw 'Browser profiles remain in repository'}
$scripts=@('Run-BackgroundTracker.vbs','Run-BackgroundTracker.ps1','Start-TicketmasterTest.ps1','Read-TicketmasterTest.ps1','market-reader.js','browser-probe.js','Relay-Request.ps1')
foreach($name in $scripts){
  $sourceHash=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $name)).Hash
  $installedHash=(Get-FileHash -LiteralPath (Join-Path $installed "tools/$name")).Hash
  if($sourceHash -ne $installedHash){throw ('Installed file differs: '+$name)}
}
$report=[pscustomobject]@{Runtime=$installed;TaskState=[string]$task.State;TaskAction=$task.Actions.Arguments;Permissions=$checks;InstalledHashesMatch=$true;RepositoryBrowserProfilesRemaining=$remaining.Count;LocalListeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -in @(4173,4174,9227)} | Select-Object LocalAddress,LocalPort);TinyFishUserCredentialPresent=[bool][Environment]::GetEnvironmentVariable('TINYFISH_API_KEY','User')}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) '.preview/security-repair-windows-results.json') -Encoding UTF8
$report | Select-Object Runtime,TaskState,InstalledHashesMatch,RepositoryBrowserProfilesRemaining,LocalListeners,TinyFishUserCredentialPresent | ConvertTo-Json -Depth 4
