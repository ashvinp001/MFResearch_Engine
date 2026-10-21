# Full-page screenshot of a local page after async rendering, via Edge DevTools protocol.
# Usage: powershell -File tests\screenshot.ps1 -Url http://localhost:5173/ -Out shot.png [-Width 1366] [-Wait 6]
#        add -Pdf to save the page's PRINT output (A4) instead; -Eval runs JavaScript first.
param([string]$Url, [string]$Out, [int]$Width = 1366, [int]$Wait = 6, [switch]$Pdf, [string]$Eval = "")

$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$port = 9444
$start = Get-Date
Start-Process -FilePath $edge -ArgumentList "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
  "--user-data-dir=$env:TEMP\edge-shot-profile", "--remote-debugging-port=$port", "--window-size=$Width,900", $Url
Start-Sleep -Seconds $Wait

try {
  $target = (Invoke-RestMethod "http://localhost:$port/json") | Where-Object { $_.type -eq "page" } | Select-Object -First 1
  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  $ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(30)
  $ws.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()

  $script:id = 0
  function Send($method, $params) {
    $script:id++
    $json = @{ id = $script:id; method = $method; params = $params } | ConvertTo-Json -Depth 6 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $ws.SendAsync([ArraySegment[byte]]::new($bytes), "Text", $true, [Threading.CancellationToken]::None).Wait()
    $buffer = New-Object byte[] 1048576
    while ($true) {
      $ms = New-Object IO.MemoryStream
      do {
        $result = $ws.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None).Result
        $ms.Write($buffer, 0, $result.Count)
      } while (-not $result.EndOfMessage)
      $message = [Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json
      if ($message.id -eq $script:id) { return $message.result }
    }
  }

  if ($Eval) { Send "Runtime.evaluate" @{ expression = $Eval; awaitPromise = $true } | Out-Null; Start-Sleep -Milliseconds 500 }
  if ($Pdf) {
    $printed = Send "Page.printToPDF" @{ printBackground = $true; preferCSSPageSize = $true }
    [IO.File]::WriteAllBytes($Out, [Convert]::FromBase64String($printed.data))
    Write-Host "saved $Out (PDF)"
    return
  }
  $metrics = Send "Page.getLayoutMetrics" @{}
  $height = [int][Math]::Ceiling($metrics.cssContentSize.height)
  Send "Emulation.setDeviceMetricsOverride" @{ width = $Width; height = $height; deviceScaleFactor = 1; mobile = $false } | Out-Null
  Start-Sleep -Milliseconds 800
  $shot = Send "Page.captureScreenshot" @{ format = "png"; captureBeyondViewport = $true }
  [IO.File]::WriteAllBytes($Out, [Convert]::FromBase64String($shot.data))
  Write-Host "saved $Out ($Width x $height)"
} finally {
  Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -ge $start } | Stop-Process -Force -ErrorAction SilentlyContinue
}
