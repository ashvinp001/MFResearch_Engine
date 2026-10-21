# Local development server (no Node or Python needed).
# Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 5173]
# Serves this folder at http://localhost:<Port>/ with correct MIME types for ES modules.
param([int]$Port = 5173)

$root = $PSScriptRoot
$mime = @{
  ".html" = "text/html; charset=utf-8"; ".js" = "text/javascript; charset=utf-8"; ".mjs" = "text/javascript; charset=utf-8"
  ".css" = "text/css; charset=utf-8"; ".json" = "application/json"; ".png" = "image/png"; ".jpg" = "image/jpeg"
  ".svg" = "image/svg+xml"; ".pdf" = "application/pdf"; ".md" = "text/plain; charset=utf-8"; ".ico" = "image/x-icon"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $response = $context.Response
    try {
      # Dev-only: test pages POST their result text here so headless runs can read it.
      if ($context.Request.HttpMethod -eq "POST" -and $context.Request.Url.AbsolutePath -eq "/__test-results") {
        $reader = New-Object IO.StreamReader($context.Request.InputStream, [Text.Encoding]::UTF8)
        [IO.File]::WriteAllText((Join-Path $root "tests\last-results.txt"), $reader.ReadToEnd(), [Text.Encoding]::UTF8)
        $bytes = [Text.Encoding]::UTF8.GetBytes("ok")
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        continue
      }
      $relative =[Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart("/"))
      if ($relative -eq "") { $relative = "index.html" }
      $path = [IO.Path]::GetFullPath((Join-Path $root $relative))
      if (Test-Path $path -PathType Container) { $path = Join-Path $path "index.html" }

      if (-not $path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $path -PathType Leaf)) {
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
} finally {
  $listener.Stop()
}
