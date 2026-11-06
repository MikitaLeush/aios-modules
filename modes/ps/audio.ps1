# AIOS modes: set the default playback device (substring match on its name) and/or the volume.
# Prints exactly one JSON line: {"ok":true,"output":"...","volume":40} or {"ok":false,"error":"..."}.
# Values arrive as parameters, never as script text.
param([string]$Output = '', [int]$Volume = -1)
$ErrorActionPreference = 'Stop'
# Node reads stdout as UTF-8; PowerShell 5.1 would write the console code page and garble device names.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function Done($o) { $o | ConvertTo-Json -Compress; exit 0 }
try { Import-Module AudioDeviceCmdlets -ErrorAction Stop } catch { Done @{ ok = $false; error = 'needs AudioDeviceCmdlets (Install-Module AudioDeviceCmdlets -Scope CurrentUser)' } }
$res = @{ ok = $true }
try {
  if ($Output) {
    $d = Get-AudioDevice -List | Where-Object { $_.Type -eq 'Playback' -and $_.Name.IndexOf($Output, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1
    if (-not $d) { Done @{ ok = $false; error = "device not found: $Output" } }
    Set-AudioDevice -ID $d.ID | Out-Null
    $res.output = $d.Name
  }
  if ($Volume -ge 0) {
    Set-AudioDevice -PlaybackVolume $Volume | Out-Null
    $res.volume = $Volume
  }
} catch { Done @{ ok = $false; error = $_.Exception.Message } }
Done $res
