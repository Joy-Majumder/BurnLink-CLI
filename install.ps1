# BurnLink CLI installer — Windows (PowerShell)
# Usage: irm https://burnlink.page/install.ps1 | iex
#
# Detects architecture, downloads the matching release zip from
# GitHub Releases, verifies SHA256, and installs to
# %LOCALAPPDATA%\BurnLink\bin\burnlink.exe (plus adds it to the user
# PATH for future sessions).

$ErrorActionPreference = 'Stop'

$Repo = if ($env:BURNLINK_REPO) { $env:BURNLINK_REPO } else { 'Joy-Majumder/BurnLink-CLI' }
$InstallDir = if ($env:BURNLINK_INSTALL_DIR) { $env:BURNLINK_INSTALL_DIR } else {
  Join-Path $env:LOCALAPPDATA 'BurnLink\bin'
}
$BinName = 'burnlink.exe'

function Log([string]$m) { Write-Host "[burnlink] $m" -ForegroundColor Cyan }
function Fail([string]$m) { Write-Host "[burnlink] $m" -ForegroundColor Red; exit 1 }

# --- 1. detect arch ---------------------------------------------------------
$arch = $env:PROCESSOR_ARCHITECTURE
switch -Regex ($arch) {
  '(AMD64|x64)' { $archTag = 'x64' }
  '(ARM64)'     { $archTag = 'arm64' }
  default       { Fail "Unsupported architecture: $arch" }
}
$platform = 'windows'
$archiveName = "burnlink-${platform}-${archTag}.zip"
Log "detected ${platform}/${archTag}"

# --- 2. fetch latest release ------------------------------------------------
Log 'fetching latest release...'
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'burnlink-installer' }
$tag = $release.tag_name
[string]::IsNullOrEmpty($tag) ? (Fail 'could not determine latest release') : (Log "latest version: $tag")

# --- 3. download + verify ---------------------------------------------------
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

# --- 4. extract + install ---------------------------------------------------
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $InstallDir)
Log "installed -> $InstallDir\$BinName"

# --- 5. PATH ----------------------------------------------------------------
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$InstallDir*") {
  [Environment]::SetEnvironmentVariable('Path', "$userPath;$InstallDir", 'User')
  Log "added $InstallDir to user PATH (restart shell)"
} else {
  Log "$InstallDir already on PATH"
}

Remove-Item -Recurse -Force $tmp
Log "done. run: $BinName --version"