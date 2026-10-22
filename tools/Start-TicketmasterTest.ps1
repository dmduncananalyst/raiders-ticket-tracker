param([int]$Port = 9227, [switch]$KeepRunning, [switch]$Minimized)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$browserProfile = Join-Path $projectRoot '.preview\ticketmaster-helper-profile'
$portProbe = [Net.Sockets.TcpClient]::new()
try {
  $connection = $portProbe.ConnectAsync('127.0.0.1',$Port)
  if ($connection.Wait(500) -and $portProbe.Connected) { throw "Port $Port is already in use. Leave the existing test browser open and run Read-TicketmasterTest.ps1." }
} catch [AggregateException] {
  # Connection refused is expected when no test browser is running.
} finally { $portProbe.Dispose() }
$browserPaths = @('C:\Program Files\Google\Chrome\Application\chrome.exe', 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe')
$browserExe = $browserPaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$browserExe) { throw 'Chrome or Edge was not found.' }
New-Item -ItemType Directory -Path $browserProfile -Force | Out-Null
$launchArgs = @("--user-data-dir=`"$browserProfile`"", "--remote-debugging-port=$Port", '--remote-debugging-address=127.0.0.1', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--new-window', 'https://www.ticketmaster.com/event/1700646CC3A7C3B1')
# A visible window is required for the user's normal Ticketmaster interaction.
$windowStyle=if($Minimized){'Minimized'}else{'Normal'}
$browserProcess = Start-Process -FilePath $browserExe -ArgumentList $launchArgs -WindowStyle $windowStyle -PassThru
Write-Output 'Opened the Rams event in a separate test browser. No existing browser profile was accessed.'
Write-Output 'Use Ticketmaster normally in that window. Do not enter credentials into the tracker.'
if ($KeepRunning) { $browserProcess.WaitForExit() }
