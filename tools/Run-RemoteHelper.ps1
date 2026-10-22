param([Parameter(Mandatory=$true)][string]$RelayUrl,[int]$BrowserPort=9227)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Relay-Request.ps1')
$relay=[Uri]$RelayUrl
if($relay.Scheme -ne 'https' -or !$relay.Host.EndsWith('.workers.dev') -or $relay.UserInfo -or $relay.AbsolutePath -ne '/' -or $relay.Query){throw 'Use the HTTPS root URL of your reviewed Cloudflare relay.'}
$publishKey=$env:JD_PUBLISH_KEY
if(!$publishKey){
  $secret=Read-Host 'Relay publishing key (not your Ticketmaster password)' -AsSecureString
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  try{$publishKey=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
}
if($publishKey -notmatch '^[A-Za-z0-9_-]{32,128}$'){throw 'The relay publishing key is not valid.'}
$headers=@{Authorization="Bearer $publishKey"}
Write-Output 'Helper running. Keep the dedicated Ticketmaster browser open and this computer awake.'
try{
  while($true){
    try{
      $reply=Invoke-RelayRequest -Uri ($relay.GetLeftPart([UriPartial]::Authority)+'/publisher/jobs') -Headers $headers
      $job=$reply.job
      if(!$job){Start-Sleep -Seconds 5;continue}
      if($job.game -notin @('rams','seahawks','chargers','broncos','titans') -or $job.id -notmatch '^[\w-]{16,80}$'){throw 'Unexpected relay job'}
      $checkActive=New-JobActivityCheck -Uri ($relay.GetLeftPart([UriPartial]::Authority)+'/publisher/active/'+$job.id) -Headers $headers
      try{$quote=& (Join-Path $PSScriptRoot 'Read-TicketmasterTest.ps1') -Port $BrowserPort -ReadMarket -Game $job.game -CheckActive $checkActive | ConvertFrom-Json}catch{$quote=@{status='unavailable'}}
      $body=@{quote=$quote}|ConvertTo-Json -Depth 12 -Compress
      Invoke-RelayRequest -Uri ($relay.GetLeftPart([UriPartial]::Authority)+'/publisher/results/'+$job.id) -Method Post -Headers $headers -Body $body | Out-Null
      Write-Output ("Finished the requested check for {0}." -f $job.game)
    }catch{Write-Output 'The helper could not complete a check. No old price was sent.';Start-Sleep -Seconds 10}
  }
}finally{$publishKey=$null;$headers=$null}
