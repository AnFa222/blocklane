$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $project 'package.json') -Raw | ConvertFrom-Json).version
$portable = Join-Path $project "dist\Blocklane-$version-win32-x64"
$output = Join-Path $project 'dist\installer'
$staging = Join-Path $project 'dist\installer-staging'
if (!(Test-Path (Join-Path $portable 'Blocklane.exe'))) { throw "Portable build missing. Run: node scripts/package.js --release" }
New-Item -ItemType Directory -Force -Path $output, $staging | Out-Null
$stale = Get-ChildItem $staging -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -notin @('') }
if ($stale) { $stale | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue }
$install = @"
`$ErrorActionPreference = 'Stop'
`$version = '$version'
try {
`$zip = Join-Path `$env:TEMP "Blocklane-`$version.zip"
`$url = "https://github.com/AnFa222/blocklane/releases/download/v`$version/Blocklane-`$version-win32-x64.zip"
Invoke-WebRequest -Uri `$url -OutFile `$zip -UseBasicParsing
`$destination = Join-Path `$env:LOCALAPPDATA 'Blocklane'
if (Test-Path `$destination) { Remove-Item -Recurse -Force `$destination }
New-Item -ItemType Directory -Force -Path `$destination | Out-Null
Expand-Archive -LiteralPath `$zip -DestinationPath `$destination -Force
Remove-Item -Force `$zip -ErrorAction SilentlyContinue
`$exe = Join-Path `$destination 'Blocklane.exe'
`$shell = New-Object -ComObject WScript.Shell
`$shortcut = `$shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Blocklane.lnk'))
`$shortcut.TargetPath = `$exe
`$shortcut.WorkingDirectory = `$destination
`$shortcut.Save()
Start-Process -FilePath `$exe -WorkingDirectory `$destination
} catch {
  Write-Host "Blocklane installation failed: `$(`$_.Exception.Message)" -ForegroundColor Red
  Write-Host "The installer needs the portable ZIP attached to the GitHub v`$version release."
  Read-Host 'Press Enter to close'
  exit 1
}
"@
Set-Content (Join-Path $staging 'install.ps1') $install -Encoding UTF8
Set-Content (Join-Path $staging 'install.cmd') "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0install.ps1`"" -Encoding ASCII
$target = Join-Path $output 'blocklane-build.exe'
$final = Join-Path $output "Blocklane-$version-Setup.exe"
$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
HidePrompt=1
UseLongFileName=1
InsideCompressed=1
TargetName=$target
FriendlyName=Blocklane $version
AppLaunched=install.cmd
PostInstallCmd=<None>
SourceFiles=SourceFiles
[SourceFiles]
SourceFiles0=$staging
[SourceFiles0]
%FILE0%=
%FILE1%=
[Strings]
FILE0="install.ps1"
FILE1="install.cmd"
"@
$sedPath = Join-Path $staging 'installer.sed'
Set-Content $sedPath $sed -Encoding ASCII
Get-ChildItem $output -Filter '~*' -Force -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Remove-Item $target, $final -Force -ErrorAction SilentlyContinue
Push-Location $staging
& iexpress.exe /N /Q installer.sed
Pop-Location
for ($i = 0; $i -lt 60 -and !(Test-Path $target); $i += 1) { Start-Sleep -Seconds 1 }
if (!(Test-Path $target)) { throw 'IExpress did not create the installer.' }
Move-Item $target $final -Force
Write-Output "Installer: $final"
