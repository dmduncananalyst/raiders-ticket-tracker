param([int]$PreviewPort=4174,[switch]$OpenFile)
$ErrorActionPreference='Stop'
$rootPath=Split-Path -Parent $PSScriptRoot
$profilePath=Join-Path $rootPath ('.preview\live-tracker-test-'+[Guid]::NewGuid().ToString('N'))
$browserPath='C:\Program Files\Google\Chrome\Application\chrome.exe'
$startUrl="http://localhost:$PreviewPort/tools/live-check.html?visual=1"
if($OpenFile){$startUrl=([Uri](Join-Path $rootPath 'index.html')).AbsoluteUri}
$browser=Start-Process -FilePath $browserPath -ArgumentList @('--headless','--disable-gpu','--no-first-run',"--user-data-dir=`"$profilePath`"",'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--window-size=500,1000',$startUrl) -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $rootPath '.preview\live-browser-errors.log')
$socket=[Net.WebSockets.ClientWebSocket]::new()
$cancel=[Threading.CancellationTokenSource]::new(180000)
try {
  $target=$null
  for($attempt=0;$attempt -lt 20;$attempt++){
    Start-Sleep -Milliseconds 300
    try{$portFile=Join-Path $profilePath 'DevToolsActivePort';if(!(Test-Path -LiteralPath $portFile)){continue};$debugPort=[int](Get-Content -LiteralPath $portFile -TotalCount 1);$tabs=Invoke-RestMethod "http://127.0.0.1:$debugPort/json/list" -TimeoutSec 2;$target=$tabs|Where-Object {$_.type -eq 'page' -and ($_.url -like "http://localhost:$PreviewPort/tools/live-check.html*" -or ($OpenFile -and $_.url -eq "http://localhost:$PreviewPort/"))}|Select-Object -First 1;if($target){break}}catch{if($attempt -eq 19){Write-Output $_.Exception.Message}}
  }
  if(!$target){throw 'Local preview test browser did not start'}
  $socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl,$cancel.Token).GetAwaiter().GetResult()|Out-Null
  function Invoke-LocalCommand($Method,$Parameters){
    $payload=@{id=1;method=$Method;params=$Parameters}|ConvertTo-Json -Depth 8 -Compress
    $bytes=[Text.Encoding]::UTF8.GetBytes($payload)
    $socket.SendAsync([ArraySegment[byte]]::new($bytes),[Net.WebSockets.WebSocketMessageType]::Text,$true,$cancel.Token).GetAwaiter().GetResult()|Out-Null
    do{
      $buffer=New-Object byte[] 65536;$message=[IO.MemoryStream]::new()
      try{do{$received=$socket.ReceiveAsync([ArraySegment[byte]]::new($buffer),$cancel.Token).GetAwaiter().GetResult();$message.Write($buffer,0,$received.Count)}until($received.EndOfMessage);$response=[Text.Encoding]::UTF8.GetString($message.ToArray())|ConvertFrom-Json}finally{$message.Dispose()}
    }until($response.id -eq 1)
    if($response.error -or $response.result.exceptionDetails){throw 'Local browser check failed'}
    return $response.result
  }
  $checkExpression="({done:document.title==='DONE live tracker check',text:document.getElementById('results')?.textContent})"
  if($OpenFile){
    Invoke-LocalCommand 'Emulation.setDeviceMetricsOverride' @{width=390;height=844;deviceScaleFactor=1;mobile=$true}|Out-Null
    $checkExpression="(() => {const cards=[...document.querySelectorAll('.game')];return {done:cards.length===5&&cards.every(c=>!c.querySelector('[data-own]').textContent.includes('Checking')),text:JSON.stringify({url:location.href,phoneWidth:innerWidth,noHorizontalOverflow:document.documentElement.scrollWidth===innerWidth,results:cards.map(c=>({game:c.id,own:c.querySelector('[data-own]').textContent,decision:c.querySelector('[data-decision]').textContent}))},null,2)};})()"
  }
  for($attempt=0;$attempt -lt 160;$attempt++){
    Start-Sleep -Seconds 1
    $result=Invoke-LocalCommand 'Runtime.evaluate' @{expression=$checkExpression;returnByValue=$true}
    if($OpenFile -and $attempt -eq 20){Write-Output $result.result.value.text}
    if($result.result.value.done){
      $report=$result.result.value.text
      [IO.File]::WriteAllText((Join-Path $rootPath '.preview\live-check-result.json'),$report)
      Write-Output $report
      $image=Invoke-LocalCommand 'Page.captureScreenshot' @{format='png'}
      [IO.File]::WriteAllBytes((Join-Path $rootPath '.preview\live-phone.png'),[Convert]::FromBase64String($image.data))
      return
    }
  }
  Write-Output $result.result.value.text
  throw 'Live tracker did not finish checking within the test limit'
}finally{
  $socket.Dispose();$cancel.Dispose()
  # Stop only the separate local-preview test process launched by this script.
  if(!$browser.HasExited){Stop-Process -Id $browser.Id -ErrorAction SilentlyContinue}
}
