$ErrorActionPreference='Stop'
$source=Split-Path -Parent $PSScriptRoot
$destination=Join-Path $env:LOCALAPPDATA 'JD Ticket Tracker'
$expected=[IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'AppData/Local/JD Ticket Tracker'))
if([IO.Path]::GetFullPath($destination) -ne $expected -or $destination -like '*OneDrive*'){throw 'Unexpected installation path'}
$owner=[Security.Principal.WindowsIdentity]::GetCurrent().User
if([Security.Principal.WindowsIdentity]::GetCurrent().Name -notmatch '\\Owner$'){throw 'Install as Owner only'}
if((Get-ScheduledTask -TaskName 'JD Ticket Tracker').State -ne 'Disabled'){throw 'Task must remain disabled before migration'}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
# Only this dedicated installation receives a protected ACL. No parent or
# sandbox ACLs are changed. Do not grant sandbox identities read/write access.
$acl=[Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true,$false)
foreach($sid in @($owner.Value,'S-1-5-18','S-1-5-32-544')){
  $rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.AddAccessRule($rule)
}
[IO.Directory]::SetAccessControl($destination,$acl)
foreach($folder in @('tools','.preview','private')){New-Item -ItemType Directory -Path (Join-Path $destination $folder) -Force | Out-Null}
foreach($name in @('Run-BackgroundTracker.vbs','Run-BackgroundTracker.ps1','Start-TicketmasterTest.ps1','Read-TicketmasterTest.ps1','market-reader.js','browser-probe.js','Relay-Request.ps1')){
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $destination "tools/$name") -Force
}
foreach($name in @('background-config.json','hosting-secrets.json','phone-url.txt')){
  $from=Join-Path $source ".preview/$name"
  if(Test-Path -LiteralPath $from){Move-Item -LiteralPath $from -Destination (Join-Path $destination ".preview/$name") -Force}
}
# Move all stored automation/test profiles and private evidence outside sync.
# Only exact children of .preview may be moved.
$preview=[IO.Path]::GetFullPath((Join-Path $source '.preview'))
foreach($entry in Get-ChildItem -LiteralPath $preview -Force){
  if((Test-Path -LiteralPath (Join-Path $entry.FullName 'Local State')) -or $entry.Name -match 'profile|^qa-|^live-tracker-test-|^helper-unit-tests$|phone|ticketmaster|tinyfish|\.log$|^hosting-secrets|^background'){
    if($entry.FullName -ne (Join-Path $preview $entry.Name)){throw 'Unexpected private path'}
    $target=Join-Path $destination ('private/'+$entry.Name)
    if($entry.PSIsContainer){
      & robocopy.exe $entry.FullName $target /E /MOVE /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
      if($LASTEXITCODE -gt 7){throw 'Private profile migration incomplete'}
    }else{Move-Item -LiteralPath $entry.FullName -Destination $target -Force}
  }
}
# Preserve the dedicated helper profile at the installed runtime's expected path.
$profile=Join-Path $destination 'private/ticketmaster-helper-profile'
if(Test-Path -LiteralPath $profile){
  & robocopy.exe $profile (Join-Path $destination '.preview/ticketmaster-helper-profile') /E /MOVE /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if($LASTEXITCODE -gt 7){throw 'Dedicated profile migration incomplete'}
}
$launcher=Join-Path $env:SystemRoot 'System32/wscript.exe'
$action=New-ScheduledTaskAction -Execute $launcher -Argument ('//B //Nologo "'+(Join-Path $destination 'tools/Run-BackgroundTracker.vbs')+'"') -WorkingDirectory $destination
Set-ScheduledTask -TaskName 'JD Ticket Tracker' -Action $action | Out-Null
Disable-ScheduledTask -TaskName 'JD Ticket Tracker' | Out-Null
$task=Get-ScheduledTask -TaskName 'JD Ticket Tracker'
if($task.State -ne 'Disabled'){throw 'Task unexpectedly enabled'}
# Reset children to inherit only the already-protected installation ACL.
& icacls.exe (Join-Path $destination '*') /reset /T /Q | Out-Null
if($LASTEXITCODE -ne 0){throw 'Private file permission reset incomplete'}
[pscustomobject]@{InstalledRuntime=$destination;TaskState=$task.State;Action=$task.Actions.Arguments;AllowedSids=@((Get-Acl -LiteralPath $destination).Access.IdentityReference.Value)} | ConvertTo-Json -Depth 4
