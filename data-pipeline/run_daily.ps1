# Runs the fund NAV update, the benchmark update, then the peer statistics, once, with a log (Windows Task
# Scheduler, 07:00). Logs: %LOCALAPPDATA%\Prosperr\logs\daily-YYYY-MM-DD.log (last 60 kept). Exit code: 0 only
# when every step succeeded.
$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $PSScriptRoot
$python = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
$logDir = Join-Path $env:LOCALAPPDATA "Prosperr\logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("daily-{0:yyyy-MM-dd}.log" -f (Get-Date))

$env:PYTHONIOENCODING = "utf-8"
Set-Location $project
# Python's error output must land in the log, not stop this script (with "Stop", Windows PowerShell 5.1
# turns any stderr line of a program into a terminating error, so the log and later steps were lost).
$ErrorActionPreference = "Continue"
# Keep the PC from going to sleep on its own while the job runs (23-Oct-2026: an idle sleep mid-run stopped the
# peer-statistics step). Released automatically when this script ends. Closing the lid still sleeps the PC; the
# next run then completes the day (every step is idempotent).
try {
  Add-Type -Namespace Prosperr -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);' -ErrorAction Stop
  [void][Prosperr.Power]::SetThreadExecutionState([uint32]"0x80000001")   # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
} catch {
  "WARNING could not keep the PC awake: $($_.Exception.Message)" | Out-File -FilePath $log -Append -Encoding utf8
}
"=== $(Get-Date -Format s) daily update ===" | Out-File -FilePath $log -Append -Encoding utf8
& $python -u (Join-Path $PSScriptRoot "daily_update.py") 2>&1 | ForEach-Object { "$_" } | Out-File -FilePath $log -Append -Encoding utf8
$code = $LASTEXITCODE
# Benchmark data (own bucket): mapping refresh + new benchmark prices from PulseDB.
"=== $(Get-Date -Format s) benchmark update ===" | Out-File -FilePath $log -Append -Encoding utf8
& $python -u (Join-Path $PSScriptRoot "benchmark_daily.py") 2>&1 | ForEach-Object { "$_" } | Out-File -FilePath $log -Append -Encoding utf8
if ($LASTEXITCODE -ne 0) { $code = $LASTEXITCODE }
# Peer statistics for the Invest / Hold / Sell logic, from the NAVs now stored (also after a partial update:
# the stored data is consistent either way).
"=== $(Get-Date -Format s) peer statistics ===" | Out-File -FilePath $log -Append -Encoding utf8
& $python -u (Join-Path $PSScriptRoot "peer_stats.py") 2>&1 | ForEach-Object { "$_" } | Out-File -FilePath $log -Append -Encoding utf8
if ($LASTEXITCODE -ne 0) { $code = $LASTEXITCODE }
"=== $(Get-Date -Format s) finished, exit code $code ===" | Out-File -FilePath $log -Append -Encoding utf8

Get-ChildItem $logDir -Filter "daily-*.log" | Sort-Object Name -Descending | Select-Object -Skip 60 | Remove-Item -Force
exit $code
