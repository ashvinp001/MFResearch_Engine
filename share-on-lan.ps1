# One-time setup so team members on the same Wi-Fi / office network can open the website from this PC.
# Usage (asks for administrator approval once):
#   powershell -ExecutionPolicy Bypass -File share-on-lan.ps1            # allow
#   powershell -ExecutionPolicy Bypass -File share-on-lan.ps1 -Remove    # undo both changes
# It does two things, both limited to port 5173:
#   1. Reserves http://+:5173/ for the current Windows user, so serve.ps1 -Lan can listen without admin.
#   2. Adds a Windows Firewall rule that lets ONLY devices on this PC's local subnet reach TCP 5173.
# Then start the site with:  powershell -ExecutionPolicy Bypass -File serve.ps1 -Lan
param([int]$Port = 5173, [switch]$Remove)

$ruleName = "Prosperr website (LAN, port $Port)"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"", "-Port", $Port)
  if ($Remove) { $argList += "-Remove" }
  $process = Start-Process powershell -Verb RunAs -ArgumentList $argList -Wait -PassThru
  exit $process.ExitCode
}

$user = "$env:USERDOMAIN\$env:USERNAME"
netsh http delete urlacl url=http://+:$Port/ | Out-Null
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if ($Remove) {
  "Removed the port reservation and the firewall rule for port $Port."
  exit 0
}
netsh http add urlacl url=http://+:$Port/ user="$user" | Out-Null
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port `
  -RemoteAddress LocalSubnet -Profile Any -Description "Prosperr local website for team members on the same network (serve.ps1 -Lan)." | Out-Null
"Port $Port reserved for $user; firewall allows only the local subnet. Start the site with: serve.ps1 -Lan"
exit 0
