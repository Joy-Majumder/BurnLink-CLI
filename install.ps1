# BurnLink CLI installer — Windows (PowerShell)
#
# Usage:
#   irm https://burnlink.page/install.ps1 | iex
#
# Strategy (in order):
#   1. If npm + node are on PATH → `npm i -g burnlink` (cleanest install).
#   2. Otherwise, fall back to fetching the matching release zip from
#      GitHub Releases, verifying SHA256, and installing to
#      %LOCALAPPDATA%\BurnLink\bin\burnlink.exe (plus adds it to the user
#      PATH for future sessions).
#
# Overrides (env vars):
#   $env:BURNLINK_REPO        GitHub repo (default: paperfrogs-hq/BurnLink-CLI)
#   $env:BURNLINK_INSTALL_DIR Override install location
#   $env:BURNLINK_NO_NPM      "1" to skip npm even if available
#   $env:BURNLINK_CHANNEL     npm tag: latest | dev | next (default: latest)

$ErrorActionPreference = 'Stop'

$Repo = if ($env:BURNLINK_REPO) { $env:BURNLINK_REPO } else { 'paperfrogs-hq/BurnLink-CLI' }
$InstallDir = if ($env:BURNLINK_INSTALL_DIR) { $env:BURNLINK_INSTALL_DIR } else {
  Join-Path $env:LOCALAPPDATA 'BurnLink\bin'
}
$BinName = 'burnlink.exe'
$Channel = if ($env:BURNLINK_CHANNEL) { $env:BURNLINK_CHANNEL } else { 'latest' }

function Log([string]$m)  { Write-Host "[burnlink] $m" -ForegroundColor Cyan }
function Fail([string]$m) { Write-Host "[burnlink] $m" -ForegroundColor Red; exit 1 }

# --- path 1: npm ------------------------------------------------------------
function Have-Npm {
  $null = $null
  $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  return [bool]$npmCmd -and [bool]$nodeCmd
}

if ($env:BURNLINK_NO_NPM -ne '1' -and (Have-Npm)) {
  Log "npm + node detected -> using 'npm install -g burnlink@$Channel'"
  Log "(set BURNLINK_NO_NPM=1 to force the zip install)"
  npm install -g "burnlink@$Channel" --silent
  Log "done. run: $BinName --version"
  exit 0
}

# --- path 2: zip ------------------------------------------------------------
$arch = $env:PROCESSOR_ARCHITECTURE
switch -Regex ($arch) {
  '(AMD64|x64)' { $archTag = 'x64' }
  '(ARM64)'     { $archTag = 'arm64' }
  default       { Fail "Unsupported architecture: $arch" }
}
$platform = 'windows'
$archiveName = "burnlink-${platform}-${archTag}.zip"
Log "detected ${platform}/${archTag} (npm not found, using zip)"
Log "install Node.js for a cleaner experience: https://nodejs.org"

Log 'fetching latest release...'
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'burnlink-installer' }
$tag = $release.tag_name
[string]::IsNullOrEmpty($tag) ? (Fail 'could not determine latest release') : (Log "latest version: $tag")

$tmp = Join-Path $env:TEMP ("burnlink-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$baseUrl = "https://github.com/$Repo/releases/download/$tag"
$archivePath = Join-Path $tmp $archiveName
Log "downloading $archiveName..."
Invoke-WebRequest -Uri "$baseUrl/$archiveName" -OutFile $archivePath -UseBasicParsing

$shaUrl = "$baseUrl/SHA256SUMS"
try {
  $shaPath = Join-Path $tmp 'SHA256SUMS'
  Invoke-WebRequest -Uri $shaUrl -OutFile $shaPath -UseBasicParsing -ErrorAction Stop
  $expected = (Select-String -Path $shaPath -Pattern (" {0}$" -f [regex]::Escape($archiveName)) | ForEach-Object { ($_.Line -split ' ')[0] })
  if ($expected) {
    $actual = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLower()
    if ($expected -ne $actual) { Fail "checksum mismatch (expected $expected, got $actual)" }
    Log 'checksum verified'
  } else {
    Log "WARNING: $archiveName not in SHA256SUMS, skipping verification"
  }
} catch {
  Log 'WARNING: SHA256SUMS not available, skipping verification'
}

if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $InstallDir)
Log "installed -> $InstallDir\$BinName"

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$InstallDir*") {
  [Environment]::SetEnvironmentVariable('Path', "$userPath;$InstallDir", 'User')
  Log "added $InstallDir to user PATH (restart shell)"
} else {
  Log "$InstallDir already on PATH"
}

Remove-Item -Recurse -Force $tmp
Log "done. run: $BinName --version"
