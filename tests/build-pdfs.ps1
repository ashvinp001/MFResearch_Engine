# Renders tests/pdf-fixtures/*.html into real PDF files using headless Edge.
# Usage: powershell -ExecutionPolicy Bypass -File tests\build-pdfs.ps1   (server must be running)
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$dir = Join-Path $PSScriptRoot "pdf-fixtures"
foreach ($name in "cams", "nsdl", "cdsl") {
  $out = Join-Path $dir "$name.pdf"
  Start-Process -FilePath $edge -Wait -ArgumentList "--headless=new", "--disable-gpu", "--no-first-run",
    "--user-data-dir=$env:TEMP\edge-pdf-profile", "--no-pdf-header-footer", "--print-to-pdf=$out",
    "http://localhost:5173/tests/pdf-fixtures/$name.html"
  Write-Host "$name.pdf $((Get-Item $out).Length) bytes"
}
