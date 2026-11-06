# Starts the Prosperr website server (Node.js: server/index.js). Same usage as before:
#   powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 5173]
# Serves http://localhost:<Port>/ (this PC only) and its /api endpoints (data from the Python pipeline, keys from .env).
param([int]$Port = 5173)

function Find-Node {
  $onPath = Get-Command node -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\node.exe"),
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  $winget = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
  if (Test-Path $winget) {
    $found = Get-ChildItem $winget -Directory -Filter "OpenJS.NodeJS*" | ForEach-Object { Get-ChildItem $_.FullName -Recurse -Filter node.exe -ErrorAction SilentlyContinue } | Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  return $null
}

$node = Find-Node
if (-not $node) {
  Write-Host "Node.js is not installed. Install it with:  winget install OpenJS.NodeJS.LTS"
  exit 1
}
$serverArgs = @((Join-Path $PSScriptRoot "server\index.js"), "--port=$Port")
Set-Location $PSScriptRoot
& $node @serverArgs
exit $LASTEXITCODE
