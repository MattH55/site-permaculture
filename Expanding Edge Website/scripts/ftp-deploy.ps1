# Expanding Edge — FTPS deploy
#
# IMPORTANT: This FTP account is chrooted to the domain web root.
# Upload to ftp://host/path  (relative to chroot), NOT /home/prossswh/...
# Full absolute paths create a nested home/ folder and the live site never sees them.
#
# Uses --ftp-ssl-control (control TLS only). Full --ssl-reqd data TLS hits 451 on this host.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/ftp-deploy.ps1

$ErrorActionPreference = 'Continue'
$FTP_HOST = 'ftp.prosperapolarplunge.com'
$FTP_USER = 'DeLeeuw@makealbertagreatagain.live'
$FTP_PASS = 'VUlovelovelove69'
# Chroot web root — empty prefix means ftp://host/<relative-path>
$REMOTE_PREFIX = ''

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
$localPublic = (Resolve-Path 'public').Path

function Upload-File([string]$Local, [string]$RemoteUrl) {
  $null = & curl.exe -sS -k --ftp-ssl-control --ftp-pasv --ftp-create-dirs `
    --connect-timeout 40 --max-time 180 `
    -T $Local $RemoteUrl --user "${FTP_USER}:${FTP_PASS}" 2>&1
  return $LASTEXITCODE
}

Write-Host "FTPS deploy (chroot web root) -> ftp://${FTP_HOST}/"
$files = @(Get-ChildItem -Path $localPublic -Recurse -File)
Write-Host "Files: $($files.Count)"

$fail = New-Object System.Collections.ArrayList
$ok = 0
$i = 0
foreach ($f in $files) {
  $i++
  $rel = $f.FullName.Substring($localPublic.Length).TrimStart('\').Replace('\', '/')
  $url = "ftp://${FTP_HOST}/${rel}"
  $code = Upload-File $f.FullName $url
  if ($code -eq 0) {
    $ok++
  } else {
    [void]$fail.Add(@{ Rel = $rel; Local = $f.FullName; Url = $url })
    Write-Host "[FAIL] $rel (exit $code)"
  }
  if ($i % 20 -eq 0) { Write-Host "  ... $i/$($files.Count) (ok=$ok fail=$($fail.Count))" }
  Start-Sleep -Milliseconds 40
}

Write-Host "Pass 1: ok=$ok fails=$($fail.Count)"

for ($pass = 1; $pass -le 3 -and $fail.Count -gt 0; $pass++) {
  Write-Host "Retry pass $pass ($($fail.Count) files)..."
  $still = New-Object System.Collections.ArrayList
  foreach ($item in @($fail)) {
    Start-Sleep -Milliseconds (150 * $pass)
    $code = Upload-File $item.Local $item.Url
    if ($code -eq 0) {
      $ok++
      Write-Host "  recovered $($item.Rel)"
    } else {
      [void]$still.Add($item)
      Write-Host "  still fail $($item.Rel)"
    }
  }
  $fail = $still
}

Write-Host ""
Write-Host "DONE ok=$ok remaining_fails=$($fail.Count)"
if ($fail.Count -gt 0) {
  Write-Host "Still failed:"
  foreach ($item in $fail) { Write-Host "  $($item.Rel)" }
  exit 1
}

Write-Host "Verifying live site..."
$title = & curl.exe -sS --max-time 20 "https://makealbertagreatagain.live/?deploycheck=1" 2>&1 | Select-String -Pattern '<title>[^<]+' | Select-Object -First 1
Write-Host $title
$res = & curl.exe -sS -o NUL -w "%{http_code} %{size_download}" --max-time 20 "https://makealbertagreatagain.live/resources/" 2>&1
Write-Host "resources/ -> $res"
exit 0
