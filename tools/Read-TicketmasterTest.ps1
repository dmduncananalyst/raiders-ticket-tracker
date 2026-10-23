param([int]$Port = 9227, [scriptblock]$CheckActive, [switch]$Screenshot, [switch]$ReadMarket, [ValidateSet('rams','seahawks','chargers','broncos','titans')][string]$Game, [switch]$DescribeControls, [switch]$DescribePriceResources, [switch]$DescribePriceComponent, [switch]$ObservePriceSchema, [switch]$ObserveReloadPriceSchema, [switch]$OpenFilters, [switch]$ApplyFilters, [switch]$SelectSection221, [switch]$HoverOwnSeat, [switch]$HoverComparisonSeat, [switch]$OpenComparisonDetails, [ValidateSet(0,2,4)][int]$Quantity = 0)
$ErrorActionPreference = 'Stop'
$allowedEvents = @('1700646CC3A7C3B1','1700646CC3C7C3F4','1700646CC3D4C40E','1700646CC3B3C3BF','1700646CC3A0C3A4')
$tabs = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 5 -MaximumRedirection 0
$target = $tabs | Where-Object {
  if ($_.type -ne 'page') { return $false }
  $tabUri = [Uri]$_.url
  $eventMatch = [regex]::Match($tabUri.AbsolutePath, '(?:^|/)event/([A-Za-z0-9]+)/?$')
  $tabUri.Host -eq 'www.ticketmaster.com' -and $allowedEvents -ccontains $eventMatch.Groups[1].Value
} | Select-Object -First 1
if (!$target) { throw 'No supported Ticketmaster event tab is open in the separate test browser. Account and checkout tabs are intentionally excluded.' }
$socket = [System.Net.WebSockets.ClientWebSocket]::new()
$cancel = [Threading.CancellationTokenSource]::new($(if($Game){45000}elseif($ObservePriceSchema -or $ObserveReloadPriceSchema){30000}else{10000}))
$script:commandNumber = 0
$script:priceResponses = [Collections.Generic.List[object]]::new()
function Invoke-PageCommand([string]$Method, [hashtable]$Parameters) {
  $script:commandNumber++
  $commandId = $script:commandNumber
  $payload = @{id=$commandId;method=$Method;params=$Parameters} | ConvertTo-Json -Depth 10 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $socket.SendAsync([ArraySegment[byte]]::new($bytes),[System.Net.WebSockets.WebSocketMessageType]::Text,$true,$cancel.Token).GetAwaiter().GetResult() | Out-Null
  do {
    $buffer = New-Object byte[] 65536
    $message = [IO.MemoryStream]::new()
    try {
      do {
        $received = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer),$cancel.Token).GetAwaiter().GetResult()
        $message.Write($buffer,0,$received.Count)
      } until ($received.EndOfMessage)
      $response = [Text.Encoding]::UTF8.GetString($message.ToArray()) | ConvertFrom-Json
      if ($response.method -eq 'Fetch.requestPaused') {
        $requestUri=[Uri]$response.params.request.url
        # The current official event page boots from this versioned static CDN.
        # This grants static assets only, never navigation, APIs or accounts.
        $staticAsset=$requestUri.Host -eq 'uk.tmconst.com' -and $response.params.resourceType -in @('Script','Stylesheet','Font','Image') -and $requestUri.AbsolutePath -match '^/rc-[a-f0-9]+/_next/static/(?:[A-Za-z0-9_/.[\]-]|%5[bBdD])+\.(js|css|woff2?|ttf|svg|png|jpe?g|webp)$'
        $approved=$requestUri.Scheme -eq 'https' -and $requestUri.IsDefaultPort -and !$requestUri.UserInfo -and ($requestUri.Host -in @('www.ticketmaster.com','offeradapter.ticketmaster.com','services.ticketmaster.com','mapsapi.tmol.io','s1.ticketm.net','s2.ticketm.net','s3.ticketm.net') -or $staticAsset)
        if($response.params.resourceType -eq 'Document'){
          $approved=$approved -and $requestUri.Host -eq 'www.ticketmaster.com' -and $requestUri.AbsolutePath -match '^/event/([A-Za-z0-9]+)/?$' -and $allowedEvents -ccontains $Matches[1]
        }
        $script:commandNumber++
        $intercept=@{id=$script:commandNumber;method=$(if($approved){'Fetch.continueRequest'}else{'Fetch.failRequest'});params=@{requestId=$response.params.requestId}}
        if(!$approved){$intercept.params.errorReason='BlockedByClient'}
        $interceptBytes=[Text.Encoding]::UTF8.GetBytes(($intercept | ConvertTo-Json -Depth 5 -Compress))
        $socket.SendAsync([ArraySegment[byte]]::new($interceptBytes),[Net.WebSockets.WebSocketMessageType]::Text,$true,$cancel.Token).GetAwaiter().GetResult() | Out-Null
      }
      if ($response.method -eq 'Network.responseReceived') {
        $resourceUri = [Uri]$response.params.response.url
        # Observe only responses the event page requested itself. No replay,
        # request headers, cookies, login, account, cart or checkout responses.
        if ($resourceUri.Host -in @('offeradapter.ticketmaster.com','services.ticketmaster.com') -and $resourceUri.AbsolutePath -match '^/api/ismds/event/([A-Za-z0-9]+)/(facets|quickpicks)$' -and $allowedEvents -ccontains $Matches[1]) {
          $script:priceResponses.Add(@{requestId=$response.params.requestId;host=$resourceUri.Host;path=$resourceUri.AbsolutePath})
        }
      }
    } finally { $message.Dispose() }
  } until ($response.id -eq $commandId)
  if ($response.error) { throw "Browser command $Method failed: $($response.error.message)" }
  if ($response.result.exceptionDetails) { throw ('The event-page diagnostic failed: '+($response.result.exceptionDetails.exception.description -split "`n")[0]) }
  return $response.result
}
try {
  $debugUri=[Uri]$target.webSocketDebuggerUrl
  if($debugUri.Scheme -ne 'ws' -or $debugUri.Host -ne '127.0.0.1' -or $debugUri.Port -ne $Port -or $debugUri.UserInfo){throw 'Unexpected debugging endpoint'}
  $debugApproved=$true
  $socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl,$cancel.Token).GetAwaiter().GetResult() | Out-Null
  Invoke-PageCommand 'Fetch.enable' @{patterns=@(@{urlPattern='*';requestStage='Request'})} | Out-Null
  if ($Screenshot) {
    $result = Invoke-PageCommand 'Page.captureScreenshot' @{format='png';fromSurface=$false;captureBeyondViewport=$false}
    $imagePath = Join-Path (Split-Path -Parent $PSScriptRoot) '.preview\ticketmaster-event.png'
    [IO.File]::WriteAllBytes($imagePath,[Convert]::FromBase64String($result.data))
    Write-Output $imagePath
    return
  }
  if ($ReadMarket) {
    $reader = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'market-reader.js'))
    $readExpression = "(() => {try {"+$reader+"`nreturn JDMarketReader.read(document,location);} catch(error) {return {status:'reader-error',name:error.name,message:error.message};}})();"
    if ($Game) {
      $eventIds = @{rams='1700646CC3A7C3B1';seahawks='1700646CC3C7C3F4';chargers='1700646CC3D4C40E';broncos='1700646CC3B3C3BF';titans='1700646CC3A0C3A4'}
      $eventId = $eventIds[$Game]
      # A normal full navigation ensures this is a new observation, not a
      # re-timestamped read from an already-open or historically saved page.
      $requestStarted=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      if($CheckActive -and !(& $CheckActive)){throw 'Check abandoned'}
      Invoke-PageCommand 'Page.navigate' @{url="https://www.ticketmaster.com/event/$eventId"} | Out-Null
      for ($attempt=0;$attempt -lt 35;$attempt++) {
        if($CheckActive -and !(& $CheckActive)){throw 'Check abandoned'}
        Start-Sleep -Milliseconds 800
        try {
          $result = Invoke-PageCommand 'Runtime.evaluate' @{expression=$readExpression;returnByValue=$true}
          $current = $result.result.value
          if ($current.status -eq 'blocked') { $current | ConvertTo-Json -Depth 12;return }
          if ($current.status -eq 'ready' -and $current.eventId -ceq $eventId -and $current.checkedAt -ge $requestStarted) {
            $current | Add-Member -NotePropertyName collectionStartedAt -NotePropertyValue $requestStarted -Force
            $current | ConvertTo-Json -Depth 12;return
          }
        } catch {
          if ($cancel.IsCancellationRequested) { throw }
        }
      }
      @{status='unavailable';eventId=$eventId} | ConvertTo-Json -Compress
      return
    }
    $result = Invoke-PageCommand 'Runtime.evaluate' @{expression=$readExpression;returnByValue=$true}
    $result.result.value | ConvertTo-Json -Depth 12
    return
  }
  $probe = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'browser-probe.js'))
  if ($OpenFilters -or $ApplyFilters) {
    $buttonText = 'Filters'
    if ($ApplyFilters) { $buttonText = 'Apply Filters' }
    $result = Invoke-PageCommand 'Runtime.evaluate' @{expression="(() => {const el=[...document.querySelectorAll('button')].find(b=>(b.innerText||'').trim()==='$buttonText');if(!el)return {opened:false};el.click();return {opened:true};})();";returnByValue=$true}
    $result.result.value | ConvertTo-Json -Compress
    return
  }
  if ($ObservePriceSchema -or $ObserveReloadPriceSchema) {
    Invoke-PageCommand 'Network.enable' @{} | Out-Null
    if ($ObserveReloadPriceSchema) {
      Invoke-PageCommand 'Page.reload' @{} | Out-Null
      for ($attempt=0; $attempt -lt 5; $attempt++) {
        Start-Sleep -Seconds 3
        Invoke-PageCommand 'Runtime.evaluate' @{expression='document.readyState';returnByValue=$true} | Out-Null
        if (@($script:priceResponses | Where-Object {$_.path -match '/quickpicks$'}).Count -gt 0) { break }
      }
    } else {
      $changeQuantity = "(() => {const el=document.querySelector('select[aria-label=Quantity]');if(!el)return false;el.value=el.value==='2'?'4':'2';el.dispatchEvent(new Event('change',{bubbles:true}));return true;})();"
      Invoke-PageCommand 'Runtime.evaluate' @{expression=$changeQuantity;returnByValue=$true} | Out-Null
      Invoke-PageCommand 'Runtime.evaluate' @{expression="new Promise(resolve=>setTimeout(()=>resolve(true),2500))";awaitPromise=$true;returnByValue=$true} | Out-Null
    }
    $reports = [Collections.Generic.List[object]]::new()
    function Get-PriceSchema($Value,[string]$Path,[int]$Depth) {
      if ($Depth -gt 8 -or $null -eq $Value) { return }
      if ($Value -is [array]) { foreach ($item in @($Value | Select-Object -First 2)) { Get-PriceSchema $item ($Path+'[]') ($Depth+1) }; return }
      if ($Value -is [pscustomobject]) {
        foreach ($property in $Value.PSObject.Properties) {
          $nextPath = $Path+'.'+$property.Name
          if ($property.Name -match 'price|fee|amount|currency|section|row|seat|listing|offer|face') { $nextPath }
          Get-PriceSchema $property.Value $nextPath ($Depth+1)
        }
      }
    }
    foreach ($resource in @($script:priceResponses.ToArray() | Select-Object -Last 15)) {
      try {
        $body = Invoke-PageCommand 'Network.getResponseBody' @{requestId=$resource.requestId}
        if ($body.base64Encoded -or $body.body.Length -gt 3000000) { continue }
        $parsed = $body.body | ConvertFrom-Json
        $schema = @(Get-PriceSchema $parsed '$' 0 | Sort-Object -Unique | Select-Object -First 100)
        $offers = @($parsed._embedded.offer)
        $matching = @($offers | Where-Object { $_.section -eq '221' -and $_.row -in @('1','2','3','4') })
        $prices = @($matching | ForEach-Object { @{section=$_.section;row=$_.row;seatFrom=$_.seatFrom;seatTo=$_.seatTo;inventoryType=$_.inventoryType;currency=$_.currency;listPrice=$_.listPrice;faceValue=$_.faceValue;noChargesPrice=$_.noChargesPrice;totalPrice=$_.totalPrice;charges=$_.charges;sellableQuantities=$_.sellableQuantities} })
        $reports.Add(@{host=$resource.host;path=$resource.path;schema=$schema;embeddedOfferCount=$offers.Count;section221Prices=$prices;topKeys=@($parsed.PSObject.Properties.Name);facetsCount=@($parsed.facets).Count;facetSample=@($parsed.facets | Select-Object -First 3)})
      } catch { $reports.Add(@{host=$resource.host;path=$resource.path;state='response-not-readable';reason=$_.Exception.Message}) }
    }
    $reports.ToArray() | ConvertTo-Json -Depth 8
    return
  }
  if ($Quantity -ne 0) {
    $expression = "(() => { const el=document.querySelector('select[aria-label=Quantity]'); if(!el||![...el.options].some(o=>o.value==='$Quantity'))return {changed:false}; el.value='$Quantity';el.dispatchEvent(new Event('change',{bubbles:true}));return {changed:true,quantity:el.value};})();"
    $result = Invoke-PageCommand 'Runtime.evaluate' @{expression=$expression;returnByValue=$true}
    $result.result.value | ConvertTo-Json -Compress
    return
  }
  if ($HoverOwnSeat -or $HoverComparisonSeat -or $OpenComparisonDetails) {
    $seatFilter = "s => s.row === '1' && s.seat === '11'"
    if ($HoverComparisonSeat -or $OpenComparisonDetails) { $seatFilter = "s => s.class.includes('is-available') && s.class.includes('is-resale')" }
    $expression = $probe + "`nJDBrowserProbe.describeControls(document, location).seatMap.find($seatFilter);"
    $result = Invoke-PageCommand 'Runtime.evaluate' @{expression=$expression;returnByValue=$true}
    $point = $result.result.value.center
    if (!$point) { throw 'The target seat is not exposed in the current map view. No pointer movement was sent.' }
    Invoke-PageCommand 'Input.dispatchMouseEvent' @{type='mouseMoved';x=$point.x;y=$point.y} | Out-Null
    if ($OpenComparisonDetails) {
      Invoke-PageCommand 'Input.dispatchMouseEvent' @{type='mousePressed';x=$point.x;y=$point.y;button='left';clickCount=1} | Out-Null
      Invoke-PageCommand 'Input.dispatchMouseEvent' @{type='mouseReleased';x=$point.x;y=$point.y;button='left';clickCount=1} | Out-Null
      Write-Output 'Opened the public resale listing details. No checkout action was taken.'
      return
    }
    Write-Output 'Moved the pointer over a seat in the requested section. No ticket was selected or reserved.'
    return
  }
  if ($SelectSection221) {
    $expression = $probe + "`n(() => {const view=JDBrowserProbe.describeControls(document, location);return view.seatMap.length?{alreadyOpen:true}:view.targets.find(t => t.center.x > 0 && t.center.y > 0);})();"
    $result = Invoke-PageCommand 'Runtime.evaluate' @{expression=$expression;returnByValue=$true}
    if ($result.result.value.alreadyOpen) { Write-Output 'Section 221 seats are already exposed; no click was sent.'; return }
    $point = $result.result.value.center
    if (!$point) { throw 'The visible map label 221 was not found. No click was sent.' }
    Invoke-PageCommand 'Input.dispatchMouseEvent' @{type='mouseMoved';x=$point.x;y=$point.y} | Out-Null
    Invoke-PageCommand 'Input.dispatchMouseEvent' @{type='mousePressed';x=$point.x;y=$point.y;button='left';clickCount=1} | Out-Null
    Invoke-PageCommand 'Input.dispatchMouseEvent' @{type='mouseReleased';x=$point.x;y=$point.y;button='left';clickCount=1} | Out-Null
    Write-Output 'Selected the visible Section 221 label on the event map. No ticket was reserved or purchased.'
    return
  }
  $call = 'JDBrowserProbe.inspect(document, location, Date.now());'
  if ($DescribeControls) { $call = 'JDBrowserProbe.describeControls(document, location);' }
  if ($DescribePriceResources) { $call = 'JDBrowserProbe.priceResources(location);' }
  if ($DescribePriceComponent) { $call = 'JDBrowserProbe.priceComponentSchema(document, location);' }
  $result = Invoke-PageCommand 'Runtime.evaluate' @{expression=($probe+"`n"+$call);returnByValue=$true}
  $report = $result.result.value
  if ($null -eq $report) { throw 'No diagnostic returned.' }
  $report | ConvertTo-Json -Depth 10
} finally {
  # A timed-out read must stop navigation and release paused requests too.
  $cleanup=[Threading.CancellationTokenSource]::new(2000)
  $control=[Net.WebSockets.ClientWebSocket]::new()
  try{
    if(!$debugApproved){throw 'No approved debugging endpoint'}
    # ReceiveAsync cancellation can abort the original socket. A fresh control
    # session must acknowledge stopLoading before the read is considered over.
    $control.ConnectAsync($debugUri,$cleanup.Token).GetAwaiter().GetResult() | Out-Null
    $bytes=[Text.Encoding]::UTF8.GetBytes('{"id":1,"method":"Page.stopLoading"}')
    $control.SendAsync([ArraySegment[byte]]::new($bytes),[Net.WebSockets.WebSocketMessageType]::Text,$true,$cleanup.Token).GetAwaiter().GetResult() | Out-Null
    $buffer=New-Object byte[] 65536
    $control.ReceiveAsync([ArraySegment[byte]]::new($buffer),$cleanup.Token).GetAwaiter().GetResult() | Out-Null
  }catch{}finally{$control.Abort();$control.Dispose();$cleanup.Dispose()}
  $cancel.Cancel();$socket.Abort();$socket.Dispose();$cancel.Dispose()
}
