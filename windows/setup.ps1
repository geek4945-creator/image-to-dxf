# Image to DXF (Hard Version 1.5) - Windows setup.
#   * finds Python 3.10+ (py launcher or python on PATH); if missing installs Python 3.12 for the current user
#     with winget, or falls back to the silent python.org installer (per-user, PrependPath)
#   * creates/updates the virtual environment in .\venv and installs requirements.txt
#   * creates Desktop and Start-menu shortcuts (icon.ico) that start run.bat
#   * writes everything to setup.log next to this script
param([switch]$NoPause, [switch]$Pdf, [switch]$NoShortcuts)
$ErrorActionPreference = 'Continue'   # native tools (pip, winget) write warnings to stderr; exit codes are checked instead
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Here
$Log = Join-Path $Here 'setup.log'
try { Start-Transcript -LiteralPath $Log -Force | Out-Null } catch { }

function Say([string]$m) { Write-Host $m }
function Fail([string]$m) {
  Write-Host ''
  Write-Host "ERROR: $m" -ForegroundColor Red
  Write-Host "See `"$Log`" and the Troubleshooting section of WINDOWS-INSTALL.md."
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}

function Test-Py([string[]]$cmd) {
  $global:LASTEXITCODE = 1
  try {
    $exe = $cmd[0]; $args0 = @(); if ($cmd.Length -gt 1) { $args0 = $cmd[1..($cmd.Length - 1)] }
    $out = & $exe @args0 -c "import sys; print('%d.%d' % sys.version_info[:2]); sys.exit(0 if sys.version_info[:2] >= (3, 10) else 1)" 2>$null
    if ($LASTEXITCODE -eq 0 -and $out) { return $true }
  } catch { }
  return $false
}

function Find-Python {
  foreach ($v in '3.12', '3.11', '3.13', '3.10') { if (Test-Py @('py', "-$v")) { return @('py', "-$v") } }
  if (Test-Py @('py', '-3')) { return @('py', '-3') }
  foreach ($c in 'python', 'python3') {
    $g = Get-Command $c -ErrorAction SilentlyContinue
    if ($g -and $g.Source -notlike '*WindowsApps*' -and (Test-Py @($g.Source))) { return @($g.Source) }
  }
  foreach ($p in @("$env:LOCALAPPDATA\Programs\Python\Python312\python.exe", "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
                   "$env:ProgramFiles\Python312\python.exe", "$env:ProgramFiles\Python311\python.exe")) {
    if ((Test-Path -LiteralPath $p) -and (Test-Py @($p))) { return @($p) }
  }
  return $null
}

function Refresh-Path {
  $m = [Environment]::GetEnvironmentVariable('Path', 'Machine'); $u = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$m;$u"
}

function Install-Python {
  Say 'Python 3.10 or newer was not found - installing Python 3.12 for your user account ...'
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Say '  trying winget ...'
    try {
      & winget install --id Python.Python.3.12 -e --scope user --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
      Refresh-Path
      $py = Find-Python; if ($py) { return $py }
    } catch { Say "  winget failed: $($_.Exception.Message)" }
  }
  Say '  downloading the installer from python.org ...'
  $arch = if ([Environment]::Is64BitOperatingSystem) { '-amd64' } else { '' }
  $url = "https://www.python.org/ftp/python/3.12.10/python-3.12.10$arch.exe"
  $exe = Join-Path $env:TEMP 'python-3.12-installer.exe'
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
  } catch { Fail "Could not download Python ($url): $($_.Exception.Message). Install Python 3.12 from python.org (tick 'Add python.exe to PATH') and run setup.bat again." }
  Say '  running the silent installer (per-user, adds Python to PATH) ...'
  $p = Start-Process -FilePath $exe -ArgumentList '/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_launcher=1', 'Include_test=0' -Wait -PassThru
  if ($p.ExitCode -ne 0) { Fail "The Python installer exited with code $($p.ExitCode)." }
  Remove-Item -LiteralPath $exe -ErrorAction SilentlyContinue
  Refresh-Path
  $py = Find-Python
  if (-not $py) { Fail 'Python was installed but cannot be found yet. Close this window, then run setup.bat again.' }
  return $py
}

Say '=============================================================='
Say '  Image to DXF - setup (Hard Version 1.5)'
Say "  Folder: $Here"
Say '=============================================================='

# ---- 1. Python
$py = Find-Python
if (-not $py) { $py = Install-Python }
$pyExe = $py[0]; $pyArgs = @(); if ($py.Length -gt 1) { $pyArgs = $py[1..($py.Length - 1)] }
Say ("Using Python: " + (& $pyExe @pyArgs --version 2>&1))

# ---- 2. virtual environment
$venvPy = Join-Path $Here 'venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPy)) {
  Say 'Creating the virtual environment (venv) ...'
  & $pyExe @pyArgs -m venv (Join-Path $Here 'venv')
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $venvPy)) { Fail 'Could not create the virtual environment.' }
} else { Say 'Existing venv found - updating it.' }

# ---- 3. packages
Say 'Installing components (needs internet, 1-3 minutes) ...'
& $venvPy -m pip install --upgrade pip --disable-pip-version-check
if ($LASTEXITCODE -ne 0) { Fail 'pip could not be upgraded (no internet, proxy or firewall?).' }
& $venvPy -m pip install --disable-pip-version-check -r (Join-Path $Here 'requirements.txt')
if ($LASTEXITCODE -ne 0) { Fail 'Installing requirements.txt failed. With a very new Python, install Python 3.12, delete the venv folder and run setup.bat again.' }
if ($Pdf) {
  & $venvPy -m pip install --disable-pip-version-check -r (Join-Path $Here 'requirements-pdf.txt')
  if ($LASTEXITCODE -ne 0) { Say 'WARNING: optional PDF support could not be installed; images still work.' }
}
& $venvPy -c "import cv2, numpy, flask, ezdxf, shapely, PIL, requests; print('All components loaded OK')"
if ($LASTEXITCODE -ne 0) { Fail 'The components did not load after installing.' }

# ---- 4. shortcuts
if (-not $NoShortcuts) {
  try {
    $ws = New-Object -ComObject WScript.Shell
    $icon = Join-Path $Here 'icon.ico'
    $targets = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Image to DXF'))
    foreach ($dir in $targets) {
      if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
      $lnk = $ws.CreateShortcut((Join-Path $dir 'Image to DXF.lnk'))
      $lnk.TargetPath = Join-Path $Here 'run.bat'
      $lnk.WorkingDirectory = $Here
      if (Test-Path -LiteralPath $icon) { $lnk.IconLocation = "$icon,0" }
      $lnk.Description = 'Image to DXF (Hard Version 1.5)'
      $lnk.Save()
    }
    Say 'Shortcuts created on the Desktop and in the Start menu ("Image to DXF").'
  } catch { Say "WARNING: shortcuts could not be created: $($_.Exception.Message)" }
}

Say ''
Say '=============================================================='
Say '  Setup finished. Start it from the "Image to DXF" shortcut'
Say '  (or double-click run.bat).'
Say '=============================================================='
try { Stop-Transcript | Out-Null } catch { }
exit 0
