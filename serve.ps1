param([int]$Port = 4173)
$rootPath = $PSScriptRoot
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Output "JD Ticket Tracker: http://localhost:$Port"
try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream)
      $requestLine = $reader.ReadLine()
      if (!$requestLine) { continue }
      $headers=@{}
      while($line=$reader.ReadLine()){
        $parts=$line.Split(':',2)
        if($parts.Count -eq 2){$headers[$parts[0].ToLowerInvariant()]=$parts[1].Trim()}
      }
      $requestPath = [Uri]::UnescapeDataString(($requestLine.Split(' ')[1]).Split('?')[0])
      if ($requestPath -eq '/') { $requestPath = '/index.html' }
      $filePath = [IO.Path]::GetFullPath((Join-Path $rootPath $requestPath.TrimStart('/')))
        $allowed = $requestLine.StartsWith('GET ') -and $headers['host'] -in @("localhost:$Port","127.0.0.1:$Port") -and $requestPath -cin @('/index.html','/style.css','/core.js','/app.js','/pricing-source.js','/assets/raiders.svg','/assets/rams.svg','/assets/seahawks.svg','/assets/chargers.svg','/assets/broncos.svg','/assets/titans.svg')
      if ($allowed -and [IO.File]::Exists($filePath)) {
        $bytes = [IO.File]::ReadAllBytes($filePath)
        $mime = switch ([IO.Path]::GetExtension($filePath)) { '.html' {'text/html; charset=utf-8'} '.css' {'text/css'} '.js' {'text/javascript'} '.svg' {'image/svg+xml'} default {'text/plain'} }
        $code = '200 OK'
      } else { $bytes = [Text.Encoding]::UTF8.GetBytes('Not found'); $mime = 'text/plain'; $code = '404 Not Found' }
      $header = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 $code`r`nContent-Type: $mime`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n")
      $stream.Write($header, 0, $header.Length)
      $stream.Write($bytes, 0, $bytes.Length)
    } finally { $client.Close() }
  }
} finally { $listener.Stop() }
