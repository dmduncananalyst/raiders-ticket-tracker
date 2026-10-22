param([int]$Port = 4174, [int]$BrowserPort = 9227)
$ErrorActionPreference = 'Stop'
$rootPath = Split-Path -Parent $PSScriptRoot
function Ensure-PricingBrowser {
  $probe=[Net.Sockets.TcpClient]::new()
  try {
    try {$connected=$probe.ConnectAsync('127.0.0.1',$BrowserPort).Wait(750) -and $probe.Connected} catch {$connected=$false}
    if($connected){return}
  } finally {$probe.Dispose()}
  Write-Output 'The dedicated pricing browser stopped; reopening its existing helper profile.'
  & (Join-Path $PSScriptRoot 'Start-TicketmasterTest.ps1') -Port $BrowserPort | Out-Host
  for($attempt=0;$attempt -lt 20;$attempt++){
    Start-Sleep -Milliseconds 250
    $probe=[Net.Sockets.TcpClient]::new()
    try {
      try {if($probe.ConnectAsync('127.0.0.1',$BrowserPort).Wait(500) -and $probe.Connected){return}} catch {}
    } finally {$probe.Dispose()}
  }
  throw 'The dedicated Ticketmaster helper did not start.'
}
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$Port)
$listener.Start()
Write-Output "JD Ticket Tracker with browser helper: http://localhost:$Port/"
Write-Output 'Keep the dedicated Ticketmaster test browser open. Prices are collected only through its normal event pages.'
try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $stream.ReadTimeout = 5000
      $reader = [IO.StreamReader]::new($stream)
      $line = $reader.ReadLine()
      if (!$line) { continue }
      $method,$requestTarget = $line.Split(' ')[0..1]
      $headers = @{}
      while ($line = $reader.ReadLine()) {
        $parts = $line.Split(':',2)
        if ($parts.Count -eq 2) { $headers[$parts[0].ToLowerInvariant()]=$parts[1].Trim() }
      }
      $requestPath = [Uri]::UnescapeDataString($requestTarget.Split('?')[0])
      $code='200 OK';$mime='text/plain; charset=utf-8';$bytes=$null
      $localRequest = $headers['sec-fetch-site'] -ne 'cross-site' -and (!$headers['origin'] -or $headers['origin'] -in @("http://localhost:$Port","http://127.0.0.1:$Port"))
      # A top-level navigation from a file/bookmark may be cross-site. Public
      # static assets allow it; the pricing API still requires a local origin.
      $isApiRequest = $requestPath.StartsWith('/api/')
      if ($headers['host'] -notin @("localhost:$Port","127.0.0.1:$Port") -or $method -ne 'GET' -or ($isApiRequest -and !$localRequest)) {
        $code='403 Forbidden';$bytes=[Text.Encoding]::UTF8.GetBytes('Request not allowed')
      } elseif ($requestPath -match '^/api/prices/(rams|seahawks|chargers|broncos|titans)$') {
        if ($client.Client.Poll(0,[Net.Sockets.SelectMode]::SelectRead) -and $client.Available -eq 0) { continue }
        $game = $Matches[1]
        try {
          $collectorLock=[Threading.Mutex]::new($false,'Local\JDTicketTrackerCollector')
          $collectorLocked=$false
          try {
          $collectorLocked=$collectorLock.WaitOne(15000)
          if(!$collectorLocked){throw 'Collector busy'}
          Ensure-PricingBrowser | Out-Host
          $checkActive={ !($client.Client.Poll(0,[Net.Sockets.SelectMode]::SelectRead) -and $client.Available -eq 0) }
          $quote = & (Join-Path $PSScriptRoot 'Read-TicketmasterTest.ps1') -Port $BrowserPort -ReadMarket -Game $game -CheckActive $checkActive | ConvertFrom-Json
          } finally {if($collectorLocked){$collectorLock.ReleaseMutex()};$collectorLock.Dispose()}
          if ($quote.status -ne 'ready') { throw 'No current verified offer data' }
          $bytes=[Text.Encoding]::UTF8.GetBytes(($quote | ConvertTo-Json -Depth 12 -Compress))
          $mime='application/json; charset=utf-8'
          Write-Output ("Checked {0}: own price {1}; {2} eligible source listings" -f $game,$(if($quote.own){'verified'}else{'unavailable'}),@($quote.listings).Count)
        } catch {
          $code='503 Service Unavailable';$mime='application/json; charset=utf-8'
          $bytes=[Text.Encoding]::UTF8.GetBytes('{"status":"unavailable"}')
          Write-Output "Could not collect current prices for $game. No old price was returned."
          Write-Output ($_.Exception.Message -replace '\s+',' ')
        }
      } else {
        if ($requestPath -eq '/') { $requestPath='/index.html' }
        $filePath=[IO.Path]::GetFullPath((Join-Path $rootPath $requestPath.TrimStart('/')))
        $allowed = $requestPath -cin @('/index.html','/style.css','/core.js','/app.js','/pricing-source.js','/assets/raiders.svg','/assets/rams.svg','/assets/seahawks.svg','/assets/chargers.svg','/assets/broncos.svg','/assets/titans.svg')
        if ($allowed -and [IO.File]::Exists($filePath)) {
          $bytes=[IO.File]::ReadAllBytes($filePath)
          $mime=switch([IO.Path]::GetExtension($filePath)){'.html'{'text/html; charset=utf-8'} '.js'{'text/javascript; charset=utf-8'} '.css'{'text/css; charset=utf-8'} '.svg'{'image/svg+xml'}}
        } else { $code='404 Not Found';$bytes=[Text.Encoding]::UTF8.GetBytes('Not found') }
      }
      $header=[Text.Encoding]::ASCII.GetBytes("HTTP/1.1 $code`r`nContent-Type: $mime`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n")
      $stream.Write($header,0,$header.Length)
      $stream.Write($bytes,0,$bytes.Length)
    } catch { Write-Output 'A local request ended before completion.' }
    finally { $client.Close() }
  }
} finally { $listener.Stop() }
