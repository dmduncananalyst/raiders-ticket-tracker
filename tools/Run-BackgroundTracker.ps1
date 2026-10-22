param([int]$BrowserPort=9227)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Relay-Request.ps1')
$root=Split-Path -Parent $PSScriptRoot
if([IO.Path]::GetFullPath($root) -ne [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'JD Ticket Tracker'))){throw 'Background execution requires the protected local installation'}
$state=Join-Path $root '.preview'
$configPath=Join-Path $state 'background-config.json'
$log=Join-Path $state 'background.log'
$mutex=[Threading.Mutex]::new($false,'Local\JDTicketTrackerBackground')
if(!$mutex.WaitOne(0)){exit}
function Log([string]$message){Add-Content -LiteralPath $log -Value ((Get-Date -Format o)+' '+$message)}
function Ensure-Browser {
  try{
    $version=Invoke-RestMethod -Uri "http://127.0.0.1:$BrowserPort/json/version" -TimeoutSec 2 -MaximumRedirection 0
    if($version.webSocketDebuggerUrl){return}
  }catch{}
  Log 'Opening the dedicated Ticketmaster browser.'
  & (Join-Path $PSScriptRoot 'Start-TicketmasterTest.ps1') -Port $BrowserPort -Minimized | Out-Null
  Start-Sleep -Seconds 5
}
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class JDStayAwake { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags); }'
$null=[JDStayAwake]::SetThreadExecutionState(2147483649)
Log 'Background program started.'
try{
  while($true){
    try{
      if(!(Test-Path -LiteralPath $configPath)){Start-Sleep -Seconds 5;continue}
      $config=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
      $relay=[Uri]$config.relayUrl
      if($relay.Scheme -ne 'https' -or !$relay.Host.EndsWith('.workers.dev') -or $relay.AbsolutePath -ne '/' -or $relay.UserInfo -or $relay.Query){throw 'Invalid relay address'}
      $secure=ConvertTo-SecureString $config.publishKey
      $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      try{$key=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
      $headers=@{Authorization="Bearer $key"}
      $reply=Invoke-RelayRequest -Uri ($relay.AbsoluteUri+'publisher/jobs') -Headers $headers
      if(!$reply.job){Start-Sleep -Seconds 5;continue}
      $job=$reply.job
      if($job.game -notin @('rams','seahawks','chargers','broncos','titans') -or $job.id -notmatch '^[\w-]{16,80}$'){throw 'Invalid job'}
      $lock=[Threading.Mutex]::new($false,'Local\JDTicketTrackerCollector')
      $locked=$false
      try{
        $locked=$lock.WaitOne(60000)
        if(!$locked){throw 'Collector busy'}
        $quote=@{status='unavailable'}
        $checkActive=New-JobActivityCheck -Uri ($relay.AbsoluteUri+'publisher/active/'+$job.id) -Headers $headers
        for($attempt=0;$attempt -lt 2;$attempt++){
          # A quiet reader is healthy without Chrome. Open/recover the browser
          # only while this authenticated, validated job is still active.
          if(!(& $checkActive)){break}
          Ensure-Browser
          try{$quote=& (Join-Path $PSScriptRoot 'Read-TicketmasterTest.ps1') -Port $BrowserPort -ReadMarket -Game $job.game -CheckActive $checkActive | ConvertFrom-Json}catch{$quote=@{status='unavailable'}}
          if($quote.status -eq 'ready' -or !(& $checkActive) -or $attempt -eq 1){break}
          Log ("Retrying the normal event page for {0}." -f $job.game)
          Start-Sleep -Seconds 2
        }
      }catch{$quote=@{status='unavailable'}}finally{if($locked){$lock.ReleaseMutex()};$lock.Dispose()}
      $body=@{quote=$quote}|ConvertTo-Json -Depth 12 -Compress
      Invoke-RelayRequest -Uri ($relay.AbsoluteUri+'publisher/results/'+$job.id) -Method Post -Headers $headers -Body $body | Out-Null
      Log ("Completed {0}: {1}" -f $job.game,$quote.status)
    }catch{Log 'Check could not complete; no old price was sent.';Start-Sleep -Seconds 10}
    finally{$key=$null;$headers=$null}
  }
}finally{
  $null=[JDStayAwake]::SetThreadExecutionState(2147483648)
  $mutex.ReleaseMutex();$mutex.Dispose()
}
