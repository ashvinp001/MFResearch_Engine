# Local development server (no Node or Python needed).
# Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 5173] [-Lan]
# Serves this folder at http://localhost:<Port>/ with correct MIME types for ES modules,
# plus GET /api/latest-nav (latest NAV of every fund, read from Supabase with the key in .env).
# -Lan: also answers team members on the same local network (http://<this PC's IP>:<Port>/).
#   Requires share-on-lan.ps1 to have been run once (port reservation + firewall rule, admin).
#   Requests from other computers are accepted only from private network addresses, and they
#   can reach ONLY the website (LAN_ALLOWED) and its /api endpoints — never tests, client CAS
#   files, docs, .env or the data pipeline. Keys stay on this PC.
param([int]$Port = 5173, [switch]$Lan)

# What another computer on the network may open (everything else answers 404 for them).
$LAN_ALLOWED = '^(index\.html|app/.+\.js|design-system/.+\.(js|css)|calculation-engine/.+\.js|assets/[^/]+\.(png|svg|ico)|data/schemes/[a-z]+\.json)$'
function Test-PrivateAddress([System.Net.IPAddress]$ip) {
  if ($ip.IsIPv4MappedToIPv6) { $ip = $ip.MapToIPv4() }
  if ([System.Net.IPAddress]::IsLoopback($ip)) { return $true }
  $b = $ip.GetAddressBytes()
  if ($b.Length -ne 4) { return $false }
  return ($b[0] -eq 10) -or ($b[0] -eq 172 -and $b[1] -ge 16 -and $b[1] -le 31) -or ($b[0] -eq 192 -and $b[1] -eq 168)
}

$root = $PSScriptRoot
$mime = @{
  ".html" = "text/html; charset=utf-8"; ".js" = "text/javascript; charset=utf-8"; ".mjs" = "text/javascript; charset=utf-8"
  ".css" = "text/css; charset=utf-8"; ".json" = "application/json"; ".png" = "image/png"; ".jpg" = "image/jpeg"
  ".svg" = "image/svg+xml"; ".pdf" = "application/pdf"; ".md" = "text/plain; charset=utf-8"; ".ico" = "image/x-icon"
}

# GET /api/latest-nav -> the latest NAV of every fund (nav/latest.json in the private Supabase bucket).
# The key from .env is used here, on the server side only; the browser never sees it. Cached 10 minutes.
$navCache = @{ Bytes = $null; At = [DateTime]::MinValue }
function Read-DotEnv {
  $values = @{}
  $file = Join-Path $root ".env"
  if (Test-Path $file) {
    foreach ($line in Get-Content $file -Encoding UTF8) {
      if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$') { $values[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'") }
    }
  }
  return $values
}
function Get-LatestNav {
  if ($navCache.Bytes -and ((Get-Date) - $navCache.At).TotalMinutes -lt 10) { return $navCache.Bytes }
  $envValues = Read-DotEnv
  $url = "$($envValues['SUPABASE_URL'])".TrimEnd('/'); $key = $envValues['SUPABASE_SERVICE_KEY']
  $bucket = if ($envValues['SUPABASE_BUCKET']) { $envValues['SUPABASE_BUCKET'] } else { 'mf-data' }
  if (-not $url.StartsWith('https://') -or -not $key) { throw "Supabase is not configured in .env" }
  $headers = @{ apikey = $key }
  if (-not $key.StartsWith('sb_')) { $headers['Authorization'] = "Bearer $key" }
  # A unique query string: Supabase's CDN can otherwise serve an earlier copy of the overwritten file.
  $response = Invoke-WebRequest -UseBasicParsing -Uri "$url/storage/v1/object/authenticated/$bucket/nav/latest.json?fresh=$([DateTime]::UtcNow.Ticks)" -Headers $headers -TimeoutSec 30
  $navCache.Bytes = [Text.Encoding]::UTF8.GetBytes($response.Content)
  $navCache.At = Get-Date
  return $navCache.Bytes
}

# ---------- Team password (other computers only; this PC is never asked) ----------
# SITE_PASSWORD in .env. A correct password gives a random session cookie (HttpOnly, SameSite=Strict,
# 12 hours). 5 wrong tries from one address within 10 minutes block it for the rest of that window.
$SESSION_HOURS = 12
$MAX_FAILURES = 5
$FAILURE_WINDOW_MINUTES = 10
$sessions = @{}   # token -> expiry
$failures = @{}   # client address -> [DateTime] of recent wrong tries
$loginPage = Join-Path $root "login.html"
function Get-Sha256([string]$text) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)) } finally { $sha.Dispose() }
}
function Test-SamePassword([string]$given, [string]$expected) {
  $a = Get-Sha256 $given; $b = Get-Sha256 $expected; $diff = 0
  for ($i = 0; $i -lt $a.Length; $i++) { $diff = $diff -bor ($a[$i] -bxor $b[$i]) }   # constant time
  return $diff -eq 0
}
function New-SessionToken {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}
function Test-Session($request) {
  $cookie = $request.Cookies["pw_session"]
  if (-not $cookie -or -not $sessions.ContainsKey($cookie.Value)) { return $false }
  if ($sessions[$cookie.Value] -lt (Get-Date)) { $sessions.Remove($cookie.Value); return $false }
  return $true
}
function Write-Text($response, [int]$status, [string]$contentType, [string]$text) {
  $response.StatusCode = $status
  $response.ContentType = $contentType
  $response.Headers.Add("Cache-Control", "no-store")
  $bytes = [Text.Encoding]::UTF8.GetBytes($text)
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
}

# The server keeps itself running: if the listener itself fails (e.g. the network drops or Wi-Fi reconnects), the
# reason is logged and a new listener starts after a short pause. Logs: %LOCALAPPDATA%\Prosperr\logs\serve.log
$serveLog = Join-Path $env:LOCALAPPDATA "Prosperr\logs\serve.log"
New-Item -ItemType Directory -Force (Split-Path $serveLog) | Out-Null
function Write-ServeLog([string]$text) {
  try { "$(Get-Date -Format s) $text" | Out-File -FilePath $serveLog -Append -Encoding utf8 } catch {}
}
Write-ServeLog "started (port $Port$(if ($Lan) { ', LAN' }), pid $PID)"

while ($true) {
$listener = New-Object System.Net.HttpListener
try {
  $listener.Prefixes.Add($(if ($Lan) { "http://+:$Port/" } else { "http://localhost:$Port/" }))
  try { $listener.Start() } catch {
    # The port is taken (usually: the site is already running) or not reserved — a restart would not help.
    Write-ServeLog "could not start on port ${Port}: $($_.Exception.Message) - exiting"
    Write-Host "Could not start on port ${Port}: $($_.Exception.Message)"
    exit 1
  }
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $response = $context.Response
    try {
      $remote = $context.Request.RemoteEndPoint.Address
      $isLocalPc = [System.Net.IPAddress]::IsLoopback($(if ($remote.IsIPv4MappedToIPv6) { $remote.MapToIPv4() } else { $remote }))
      if (-not $isLocalPc -and -not (Test-PrivateAddress $remote)) {
        $response.StatusCode = 403
        $bytes = [Text.Encoding]::UTF8.GetBytes("Forbidden")
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        continue
      }
      # Team password: another computer must sign in before it can open anything but the sign-in page.
      if (-not $isLocalPc) {
        $path = $context.Request.Url.AbsolutePath
        $password = (Read-DotEnv)['SITE_PASSWORD']
        if (-not $password) { Write-Text $response 503 "text/plain; charset=utf-8" "Team access is not set up (SITE_PASSWORD missing in .env)."; continue }
        if ($context.Request.HttpMethod -eq "POST" -and $path -eq "/__login") {
          $client = $remote.ToString()
          $cutoff = (Get-Date).AddMinutes(-$FAILURE_WINDOW_MINUTES)
          $recent = @($failures[$client] | Where-Object { $_ -gt $cutoff })
          if ($recent.Count -ge $MAX_FAILURES) { Write-Text $response 429 "application/json" '{"ok":false,"error":"too many attempts"}'; continue }
          $reader = New-Object IO.StreamReader($context.Request.InputStream, [Text.Encoding]::UTF8)
          $body = $reader.ReadToEnd()
          $given = ""
          if ($body.Length -le 2048) { try { $given = [string](($body | ConvertFrom-Json).password) } catch { $given = "" } }
          if ($given -and (Test-SamePassword $given $password)) {
            $token = New-SessionToken
            $sessions[$token] = (Get-Date).AddHours($SESSION_HOURS)
            $failures.Remove($client)
            $response.Headers.Add("Set-Cookie", "pw_session=$token; Path=/; HttpOnly; SameSite=Strict; Max-Age=$($SESSION_HOURS * 3600)")
            Write-Text $response 200 "application/json" '{"ok":true}'
          } else {
            $failures[$client] = @($recent) + (Get-Date)
            Start-Sleep -Milliseconds 800   # slows down guessing
            Write-Text $response 401 "application/json" '{"ok":false}'
          }
          continue
        }
        if (-not (Test-Session $context.Request)) {
          if ($path -match '^/assets/prosperr-(logo|icon)\.png$') {
            # the logo on the sign-in page — falls through to the normal file response below
          } elseif ($context.Request.HttpMethod -eq "GET" -and ($path -eq "/" -or $path -eq "/index.html")) {
            Write-Text $response 200 "text/html; charset=utf-8" ([IO.File]::ReadAllText($loginPage, [Text.Encoding]::UTF8)); continue
          } else {
            Write-Text $response 401 "text/plain; charset=utf-8" "Sign in first."; continue
          }
        }
      }
      # Dev-only (this PC only): test pages POST their result text here so headless runs can read it.
      if ($isLocalPc -and $context.Request.HttpMethod -eq "POST" -and $context.Request.Url.AbsolutePath -eq "/__test-results") {
        $reader = New-Object IO.StreamReader($context.Request.InputStream, [Text.Encoding]::UTF8)
        [IO.File]::WriteAllText((Join-Path $root "tests\last-results.txt"), $reader.ReadToEnd(), [Text.Encoding]::UTF8)
        $bytes = [Text.Encoding]::UTF8.GetBytes("ok")
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        continue
      }
      # GET /api/nav-history?codes=122639,100119[&years=10] -> daily NAVs (last 5 years, or 1-20 years) of those
      # schemes, via data-pipeline/nav_api.py (which reads Supabase with the key from .env). Codes are digits only.
      if ($context.Request.HttpMethod -eq "GET" -and $context.Request.Url.AbsolutePath -eq "/api/nav-history") {
        $response.ContentType = "application/json"
        $response.Headers.Add("Cache-Control", "no-store")
        $codes = "$($context.Request.QueryString['codes'])"
        $years = "$($context.Request.QueryString['years'])"
        if ($codes -notmatch '^\d{1,7}(,\d{1,7}){0,79}$' -or ($years -and $years -notmatch '^([1-9]|1\d|20)$')) {
          $response.StatusCode = 400
          $bytes = [Text.Encoding]::UTF8.GetBytes('{"error":"codes must be a comma-separated list of scheme codes"}')
        } else {
          try {
            $python = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
            $env:PYTHONIOENCODING = "utf-8"
            $yearsArg = @(); if ($years) { $yearsArg = @("--years=$years") }
            $json = & $python -I (Join-Path $root "data-pipeline\nav_api.py") @($yearsArg + ($codes -split ',')) 2>$null | Out-String
            if ($LASTEXITCODE -ne 0 -or -not $json.Trim()) { throw "nav_api failed" }
            $bytes = [Text.Encoding]::UTF8.GetBytes($json.Trim())
          } catch {
            $response.StatusCode = 503
            $bytes = [Text.Encoding]::UTF8.GetBytes('{"error":"NAV history is not available right now"}')
          }
        }
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        continue
      }
      # GET /api/benchmark-history?codes=OB48,AUB3[&years=10] -> daily benchmark prices (last 5 years, or 1-20 years)
      # from the benchmark bucket, via data-pipeline/benchmark_api.py. Pulse benchmark codes, and our own (SBGOLD, SBGS,
      # SB<pulse code> — data-pipeline/benchmark_blends.py).
      if ($context.Request.HttpMethod -eq "GET" -and $context.Request.Url.AbsolutePath -eq "/api/benchmark-history") {
        $response.ContentType = "application/json"
        $response.Headers.Add("Cache-Control", "no-store")
        $codes = "$($context.Request.QueryString['codes'])"
        $years = "$($context.Request.QueryString['years'])"
        $code = '((OB|OHB|AB|AHB|AUB)\d{1,5}|SB(GOLD|GS|(OB|OHB|AB|AHB|AUB)\d{1,5}))'
        if ($codes -notmatch "^$code(,$code){0,79}$" -or ($years -and $years -notmatch '^([1-9]|1\d|20)$')) {
          $response.StatusCode = 400
          $bytes = [Text.Encoding]::UTF8.GetBytes('{"error":"codes must be a comma-separated list of benchmark codes"}')
        } else {
          try {
            $python = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
            $yearsArg = @(); if ($years) { $yearsArg = @("--years=$years") }
            $json = & $python -I (Join-Path $root "data-pipeline\benchmark_api.py") @($yearsArg + ($codes -split ',')) 2>$null | Out-String
            if ($LASTEXITCODE -ne 0 -or -not $json.Trim()) { throw "benchmark_api failed" }
            $bytes = [Text.Encoding]::UTF8.GetBytes($json.Trim())
          } catch {
            $response.StatusCode = 503
            $bytes = [Text.Encoding]::UTF8.GetBytes('{"error":"Benchmark history is not available right now"}')
          }
        }
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        continue
      }
      # GET /api/peer-stats?codes=122639,100119 -> each fund's peer-group figures (returns vs category median,
      # ranks, consistency, risk) for the Invest / Hold / Sell logic, via data-pipeline/peer_stats_api.py.
      # GET /api/fund-metadata?codes=… -> AUM, inception, manager per scheme (PulseDB, stored daily) via
      # data-pipeline/fund_metadata_api.py. Up to 400 scheme codes.
      if ($context.Request.HttpMethod -eq "GET" -and $context.Request.Url.AbsolutePath -eq "/api/fund-metadata") {
        $response.ContentType = "application/json"
        $response.Headers.Add("Cache-Control", "no-store")
        $codes = "$($context.Request.QueryString['codes'])"
        if ($codes -notmatch '^\d{1,7}(,\d{1,7}){0,399}$') {
          $response.StatusCode = 400
          $bytes = [Text.Encoding]::UTF8.GetBytes('{"error":"codes must be a comma-separated list of scheme codes"}')
        } else {
          try {
            $python = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
            $json = & $python -I (Join-Path $root "data-pipeline\fund_metadata_api.py") @($codes -split ',') 2>$null | Out-String
            if ($LASTEXITCODE -ne 0 -or -not $json.Trim()) { throw "fund_metadata_api failed" }
            $bytes = [Text.Encoding]::UTF8.GetBytes($json.Trim())
          } catch {
            $response.StatusCode = 503
            $bytes = [Text.Encoding]::UTF8.GetBytes('{"error":"Fund details are not available right now"}')
          }
        }
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        continue
      }
      # /api/scorecard-settings -> the Fund Scorecard's weights and conditions (data-pipeline/scorecard_settings.py).
      # GET: anyone; the reply says whether this visitor may edit and whether an edit password is set.
      # POST (save), POST /verify (password check) and POST /password (create / change the edit password): this PC (the
      # owner) only - others get 403. Saving and changing need the password; creating is possible only while none is set.
      $settingsPath = $context.Request.Url.AbsolutePath
      if ($settingsPath -in @("/api/scorecard-settings", "/api/scorecard-settings/verify", "/api/scorecard-settings/password")) {
        $response.ContentType = "application/json"
        $response.Headers.Add("Cache-Control", "no-store")
        $python = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
        $script = Join-Path $root "data-pipeline\scorecard_settings.py"
        $canEdit = if ($isLocalPc) { "true" } else { "false" }
        try {
          if ($context.Request.HttpMethod -eq "GET" -and $settingsPath -eq "/api/scorecard-settings") {
            $json = (& $python -I $script get "--can-edit=$canEdit" 2>$null | Out-String).Trim()
            if ($LASTEXITCODE -ne 0 -or -not $json) { throw "scorecard_settings get failed" }
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
          } elseif ($context.Request.HttpMethod -eq "POST" -and $isLocalPc -and $context.Request.ContentLength64 -le 4096) {
            $reader = New-Object IO.StreamReader($context.Request.InputStream, [Text.Encoding]::UTF8)
            $body = $reader.ReadToEnd()
            $OutputEncoding = New-Object Text.UTF8Encoding $false   # UTF-8 without a byte-order mark
            $command = switch ($settingsPath) { "/api/scorecard-settings/verify" { "verify" } "/api/scorecard-settings/password" { "password" } default { "set" } }
            $json = ($body | & $python -I $script $command 2>$null | Out-String).Trim()
            if (-not $json) { throw "scorecard_settings $command failed" }
            if ($LASTEXITCODE -ne 0) { $response.StatusCode = 400 }
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
          } else {
            $response.StatusCode = 403
            $bytes = [Text.Encoding]::UTF8.GetBytes('{"error":"Only the owner can change the scorecard settings"}')
          }
        } catch {
          $response.StatusCode = 503
          $bytes = [Text.Encoding]::UTF8.GetBytes('{"error":"Scorecard settings are not available right now"}')
        }
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        continue
      }
      if ($context.Request.HttpMethod -eq "GET" -and $context.Request.Url.AbsolutePath -eq "/api/peer-stats") {
        $response.ContentType = "application/json"
        $response.Headers.Add("Cache-Control", "no-store")
        $codes = "$($context.Request.QueryString['codes'])"
        if ($codes -notmatch '^\d{1,7}(,\d{1,7}){0,79}$') {
          $response.StatusCode = 400
          $bytes = [Text.Encoding]::UTF8.GetBytes('{"error":"codes must be a comma-separated list of scheme codes"}')
        } else {
          try {
            $python = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
            $json = & $python -I (Join-Path $root "data-pipeline\peer_stats_api.py") @($codes -split ',') 2>$null | Out-String
            if ($LASTEXITCODE -ne 0 -or -not $json.Trim()) { throw "peer_stats_api failed" }
            $bytes = [Text.Encoding]::UTF8.GetBytes($json.Trim())
          } catch {
            $response.StatusCode = 503
            $bytes = [Text.Encoding]::UTF8.GetBytes('{"error":"Peer statistics are not available right now"}')
          }
        }
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        continue
      }
      # GET /api/fund-holdings?isins=INF…,INF… -> each fund's latest holdings (PulseDB, cached in Supabase) via
      # data-pipeline/holdings_api.py. ISINs only (IN + 9 letters/digits + check digit).
      if ($context.Request.HttpMethod -eq "GET" -and $context.Request.Url.AbsolutePath -eq "/api/fund-holdings") {
        $response.ContentType = "application/json"
        $response.Headers.Add("Cache-Control", "no-store")
        $isins = "$($context.Request.QueryString['isins'])".ToUpper()
        if ($isins -notmatch '^IN[A-Z0-9]{9}[0-9](,IN[A-Z0-9]{9}[0-9]){0,79}$') {
          $response.StatusCode = 400
          $bytes = [Text.Encoding]::UTF8.GetBytes('{"error":"isins must be a comma-separated list of ISINs"}')
        } else {
          try {
            $python = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
            $json = & $python -I (Join-Path $root "data-pipeline\holdings_api.py") @($isins -split ',') 2>$null | Out-String
            if ($LASTEXITCODE -ne 0 -or -not $json.Trim()) { throw "holdings_api failed" }
            $bytes = [Text.Encoding]::UTF8.GetBytes($json.Trim())
          } catch {
            $response.StatusCode = 503
            $bytes = [Text.Encoding]::UTF8.GetBytes('{"error":"Fund holdings are not available right now"}')
          }
        }
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        continue
      }
      if ($context.Request.HttpMethod -eq "GET" -and $context.Request.Url.AbsolutePath -eq "/api/latest-nav") {
        $response.ContentType = "application/json"
        $response.Headers.Add("Cache-Control", "no-store")
        try { $bytes = Get-LatestNav }
        catch {
          $response.StatusCode = 503
          $bytes = [Text.Encoding]::UTF8.GetBytes('{"error":"Latest NAVs are not available right now"}')
        }
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        continue
      }
      $relative =[Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart("/"))
      if ($relative -eq "") { $relative = "index.html" }
      $path = [IO.Path]::GetFullPath((Join-Path $root $relative))
      if (Test-Path $path -PathType Container) { $path = Join-Path $path "index.html" }

      # Never serve credentials or non-website files: dot-files (.env, .git), the data pipeline, CLAUDE.md.
      $private = $relative -match '(^|[\\/])\.' -or $relative -match '^(data-pipeline[\\/]|CLAUDE\.md$)'
      # Team members on the network see only the website itself.
      if (-not $isLocalPc -and ($relative -replace '\\', '/') -notmatch $LAN_ALLOWED) { $private = $true }
      if ($private -or -not $path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $path -PathType Leaf)) {
        $response.StatusCode = 404
        $bytes = [Text.Encoding]::UTF8.GetBytes("Not found")
      } else {
        $ext = [IO.Path]::GetExtension($path).ToLower()
        $response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
        $response.Headers.Add("Cache-Control", "no-store")
        $bytes = [IO.File]::ReadAllBytes($path)
      }
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
      try { $response.StatusCode = 500 } catch {}
    } finally {
      # A browser that disconnects mid-response must never stop the server.
      try { $response.Close() } catch {}
    }
  }
} catch {
  Write-ServeLog "listener stopped: $($_.Exception.Message) - restarting in 3 s"
} finally {
  try { $listener.Close() } catch {}
}
Start-Sleep -Seconds 3
}
