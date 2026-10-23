$ErrorActionPreference='Stop'
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Run-BackgroundTracker.ps1'),[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'Invalid background script'}
$fn=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Close-IdleBrowser'},$true)
. ([scriptblock]::Create($fn.Extent.Text))
$state='C:\Protected Tracker\.preview';$BrowserPort=9227
$script:closed=@()
function Log($message) {}
function Get-CimInstance($ClassName,$Filter) {
 @(
  @{ProcessId=1;CommandLine='chrome --user-data-dir="C:\Protected Tracker\.preview\ticketmaster-helper-profile" --remote-debugging-port=9227'},
  @{ProcessId=2;CommandLine='chrome --user-data-dir="C:\Personal" --remote-debugging-port=9227'},
  @{ProcessId=3;CommandLine='chrome --user-data-dir="C:\Protected Tracker\.preview\ticketmaster-helper-profile" --remote-debugging-port=92270'},
  @{ProcessId=4;CommandLine='chrome --user-data-dir="C:\Protected Tracker\.preview\ticketmaster-helper-profile" --remote-debugging-port=9227 --type=renderer'},
  @{ProcessId=5;CommandLine='chrome --user-data-dir="C:\Protected Tracker\.preview\ticketmaster-helper-profile-other" --remote-debugging-port=9227'}
 ) | ForEach-Object {[pscustomobject]$_}
}
function Get-Process($Id,$ErrorAction) {
 $p=[pscustomobject]@{Id=$Id;HasExited=$true}
 $p | Add-Member ScriptMethod CloseMainWindow {$script:closed+=$this.Id;return $true}
 $p | Add-Member ScriptMethod WaitForExit {param($timeout) return !$script:stillRunning}
 return $p
}
Close-IdleBrowser
if($script:closed.Count -ne 1 -or $script:closed[0] -ne 1){throw 'Idle closure selected another profile, port or child process'}
Write-Output 'PASS idle closure selects only the dedicated profile main process and exact debugging port.'
$script:stillRunning=$true
function Invoke-RestMethod($Uri,$TimeoutSec,$MaximumRedirection) {return @{webSocketDebuggerUrl=$script:testEndpoint}}
foreach($url in @('ws://localhost:9227/devtools/browser/test','ws://127.0.0.1:9999/devtools/browser/test','ws://192.168.1.2:9227/devtools/browser/test','file:///private','ws://127.0.0.1:9227/devtools/page/test','ws://127.0.0.1:9227/devtools/browser/test?url=private')){
 $script:testEndpoint=$url
 $rejected=$false
 try{Close-IdleBrowser}catch{if($_.Exception.Message -eq 'Invalid local browser shutdown endpoint'){$rejected=$true}else{throw}}
 if(!$rejected){throw 'Unexpected browser shutdown endpoint accepted'}
}
Write-Output 'PASS shutdown rejects other hosts, ports, protocols, page endpoints and queries before connecting.'
