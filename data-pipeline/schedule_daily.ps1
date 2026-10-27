# Registers (or updates) the Windows scheduled task that runs the daily update every morning at 07:00.
# Usage:  powershell -ExecutionPolicy Bypass -File data-pipeline\schedule_daily.ps1 [-Time 07:00] [-Remove]
# Runs as the current user (no admin rights needed). If the PC is off or asleep at 07:00, the task runs
# as soon as it is available again; a second copy never starts while one is running; it retries twice.
param([string]$Time = "07:00", [switch]$Remove)
$name = "Prosperr NAV daily update"

if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  "Removed '$name'."
  return
}

$script = Join-Path $PSScriptRoot "run_daily.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
  -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 30) -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RunOnlyIfNetworkAvailable
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
  -Description "Prosperr: AMFI fund lists and daily NAVs into Supabase (data-pipeline/daily_update.py)." -Force | Out-Null
$task = Get-ScheduledTask -TaskName $name
"Scheduled '$name' daily at $Time (state: $($task.State)). Next run: $((Get-ScheduledTaskInfo -TaskName $name).NextRunTime)"
