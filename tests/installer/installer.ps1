# Regression tests for public/install.ps1 on Windows, under the PowerShell that runs this file
# (Windows PowerShell 5.1 or pwsh 7). Each scenario runs the installer in a child process the
# way participants and agents do (irm | iex, or a scriptblock with -Yes), with USERPROFILE set to
# a throwaway folder and npm's prefix pointed inside it. Never touches the real profile.
#
#   $env:SITE = "http://localhost:3399"; powershell -NoProfile -File tests\installer\installer.ps1
param([string]$Site = $env:SITE)
$ErrorActionPreference = "Stop"
if (-not $Site) { throw "Set SITE (or -Site) to a server that serves public/." }
$Site = $Site.TrimEnd("/")
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo = Resolve-Path (Join-Path $Here "..\..")
$Exe = (Get-Process -Id $PID).Path
$Version = ((Get-Content (Join-Path $Repo "public\install.ps1")) | Where-Object { $_ -match '^\$KanehackVersion = "(.*)"' } | Select-Object -First 1) -replace '^\$KanehackVersion = "(.*)"', '$1'
$Work = Join-Path ([IO.Path]::GetTempPath()) ("kh-ps-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $Work | Out-Null
$OrigPath = $env:PATH
$script:N = 0; $script:Fails = 0

function Check($name, [bool]$cond, $log) {
  $script:N++
  if ($cond) { Write-Host "ok $($script:N) - $name" }
  else {
    $script:Fails++
    Write-Host "not ok $($script:N) - $name"
    if ($log -and (Test-Path $log)) { Get-Content $log -Tail 40 | ForEach-Object { Write-Host "  # $_" } }
  }
}
function Fresh($name) {
  $script:H = Join-Path $Work $name
  New-Item -ItemType Directory -Force -Path $script:H | Out-Null
  $script:Npm = Join-Path $script:H "npm-global"
  $script:Log = Join-Path $Work "$name.log"
  $env:PATH = $OrigPath
}
# Run installer code in a child PowerShell with the test home. Returns the exit code.
function RunPS($code, [switch]$Interactive) {
  # The child's stderr must not become a terminating error here (Windows PowerShell 5.1).
  $ErrorActionPreference = "Continue"
  $saved = @{ USERPROFILE = $env:USERPROFILE; HOME = $env:HOME; NPM_CONFIG_PREFIX = $env:NPM_CONFIG_PREFIX; KANEHACK_SITE = $env:KANEHACK_SITE; CODEX_HOME = $env:CODEX_HOME; KANEHACK_NO_KANE = $env:KANEHACK_NO_KANE }
  # No real Kane CLI install in these scenarios.
  $env:KANEHACK_NO_KANE = "1"
  # KANEHACK_SITE so `irm | iex` runs talk to the test server, never production.
  $env:USERPROFILE = $script:H; $env:HOME = $script:H; $env:NPM_CONFIG_PREFIX = $script:Npm; $env:KANEHACK_SITE = $Site
  # Codex on Windows finds ~ through the OS profile folder (dirs::home_dir), not USERPROFILE, so the
  # test home is given to it as CODEX_HOME. (For a real user the two are the same folder.)
  $env:CODEX_HOME = Join-Path $script:H ".codex"
  try {
    $psArgs = @("-NoProfile")
    if (-not $Interactive) { $psArgs += "-NonInteractive" }
    $psArgs += @("-Command", $code)
    & $Exe @psArgs *> $script:Log
    return $LASTEXITCODE
  } finally { foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) } }
}
function LogHas($pattern) { [bool](Select-String -Path $script:Log -Pattern $pattern -SimpleMatch -Quiet) }
function KhVersion { $e = Join-Path $script:H ".kanehack\cli\node_modules\kanehack\bin\kanehack.mjs"; if (Test-Path $e) { (& node $e version) } }
$Sb = "& ([scriptblock]::Create((Invoke-RestMethod '$Site/install.ps1')))"

Write-Host "# install.ps1 $Version under $($PSVersionTable.PSEdition) $($PSVersionTable.PSVersion), site $Site, work $Work"

# 1. irm | iex with no terminal and no -Yes: nothing installed, the exact -Yes command printed.
Fresh "no-tty"
$rc = RunPS "irm '$Site/install.ps1' | iex"
Check "no-tty: exit 0" ($rc -eq 0) $Log
Check "no-tty: nothing installed" (-not (Test-Path (Join-Path $H ".kanehack")) -and -not (Test-Path (Join-Path $H ".agents"))) $Log
Check "no-tty: prints the -Yes command" (LogHas "install.ps1))) -Yes -Site $Site") $Log
Check "no-tty: no prompt left waiting" (-not (LogHas "[y/N]:")) $Log

# 2. Scriptblock with -Yes, npm's prefix on PATH and writable: install, shim there, plain next steps.
Fresh "yes"
New-Item -ItemType Directory -Force -Path $Npm | Out-Null
$env:PATH = "$Npm;$OrigPath"
$rc = RunPS "$Sb -Yes -Site '$Site'"
Check "yes: exit 0" ($rc -eq 0) $Log
Check "yes: kanehack $Version installed (sha256 verified)" ((KhVersion) -eq $Version -and (LogHas "sha256 verified")) $Log
Check "yes: the hack-os skill in .agents\skills (where Codex reads it), marked with this version" ((@(Get-ChildItem (Join-Path $H ".agents\skills") -Directory -Filter "hack-*").Count -eq 2) -and (Test-Path (Join-Path $H ".agents\skills\hack-os\SKILL.md")) -and ((Get-Content (Join-Path $H ".agents\skills\hack-os\.bundle-version") -Raw).Trim() -eq $Version)) $Log
Check "yes: the hack-gtm skill next to it" ((Get-Content (Join-Path $H ".agents\skills\hack-gtm\SKILL.md") -Raw) -match "(?m)^name: hack-gtm") $Log
Check "yes: kanehack.cmd + sh shim in npm's prefix" ((Test-Path (Join-Path $Npm "kanehack.cmd")) -and (Test-Path (Join-Path $Npm "kanehack"))) $Log
Check "yes: the next step is `$hack-os in a Codex session" ((LogHas 'Next: start a Codex session and enter $hack-os') -and -not (LogHas 'Next, in this terminal')) $Log
Check "yes: -Site saved as kanehack's server" ((Get-Content (Join-Path $H ".kanehack\config.json") -Raw) -match [regex]::Escape($Site)) $Log
Check "yes: user PATH not touched" (-not (LogHas "added (this window and new ones)")) $Log
$v = & cmd /c "set USERPROFILE=$H&& kanehack version"
Check "yes: ``kanehack`` runs from cmd/PowerShell via PATH" ($v -eq $Version) $Log
$bash = "C:\Program Files\Git\bin\bash.exe"
if (Test-Path $bash) {
  # Git Bash turns the Windows PATH (which has the npm prefix) into a POSIX one by itself.
  $v = & $bash -c "kanehack version"
  Check "yes: ``kanehack`` runs from Git Bash" ($v -eq $Version) $Log
} else { Write-Host "# skip Git Bash: not installed" }
$rc = RunPS "$Sb -Yes -Site '$Site'"
Check "re-run: idempotent (already installed, already a command, skills current)" ($rc -eq 0 -and (LogHas "already installed") -and (LogHas ("kanehack " + [char]0x2192)) -and -not (LogHas "y (-Yes)")) $Log
Set-Content -Path (Join-Path $Work "installed-home.txt") -Value $H

# 3. KANEHACK_YES=1 with irm | iex, npm prefix not on PATH: the user PATH offer (auto-yes) instead.
Fresh "env-yes"
$savedUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$rc = RunPS "`$env:KANEHACK_YES = '1'; `$env:KANEHACK_NO_SKILLS = '1'; irm '$Site/install.ps1' | iex"
[Environment]::SetEnvironmentVariable("Path", $savedUserPath, "User")
Check "env KANEHACK_YES: installed, skills skipped, user PATH offered (and restored by the test)" ($rc -eq 0 -and (KhVersion) -eq $Version -and (LogHas "skipped (-NoSkills)") -and (LogHas "added (this window and new ones)")) $Log

# 4. A different kanehack on PATH: left alone.
Fresh "conflict"
$other = Join-Path $H "other"; New-Item -ItemType Directory -Force -Path $other, $Npm | Out-Null
Set-Content -Path (Join-Path $other "kanehack.cmd") -Value "@echo not-ours" -Encoding ASCII
$env:PATH = "$other;$Npm;$OrigPath"
$rc = RunPS "$Sb -Yes -NoSkills -Site '$Site'"
Check "conflict: warned, other kanehack untouched, no shim, full path" ($rc -eq 0 -and (LogHas "another kanehack is on PATH") -and ((Get-Content (Join-Path $other "kanehack.cmd")) -eq "@echo not-ours") -and -not (Test-Path (Join-Path $Npm "kanehack.cmd")) -and (LogHas '& "') -and -not (LogHas "added (this window")) $Log

# 5. -NoPath.
Fresh "nopath"
New-Item -ItemType Directory -Force -Path $Npm | Out-Null
$env:PATH = "$Npm;$OrigPath"
$rc = RunPS "$Sb -Yes -NoPath -NoSkills -Site '$Site'"
Check "-NoPath: installed, no shim, no PATH change" ($rc -eq 0 -and (KhVersion) -eq $Version -and -not (Test-Path (Join-Path $Npm "kanehack.cmd")) -and -not (LogHas "added (this window")) $Log

# 6. Upgrade from 0.1.0.
Fresh "upgrade"
New-Item -ItemType Directory -Force -Path (Join-Path $H ".kanehack\cli"), (Join-Path $H ".kanehack\bin") | Out-Null
& npm install --silent --no-audit --no-fund --prefix (Join-Path $H ".kanehack\cli") (Join-Path $Repo "public\kanehack-0.1.0.tgz") *> $null
Set-Content -Path (Join-Path $H ".kanehack\bin\kanehack.cmd") -Value "@echo off`r`nnode `"$(Join-Path $H '.kanehack\cli\node_modules\kanehack\bin\kanehack.mjs')`" %*" -Encoding ASCII
$before = KhVersion
$rc = RunPS "$Sb -Yes -NoSkills -Site '$Site'"
Check "upgrade: 0.1.0 -> $Version" ($before -eq "0.1.0" -and $rc -eq 0 -and (KhVersion) -eq $Version -and (LogHas "Upgrade the kanehack helper")) $Log

# 6a. Upgrade over the 0.1.x skills: the 12 marked folders go, your own hack-foo stays.
Fresh "upgrade-skills"
$sk = Join-Path $H ".agents\skills"
foreach ($s in "onboard", "doctor", "team", "idea", "harness", "verify", "progress", "help", "demo", "showcase", "gtm", "submit") {
  New-Item -ItemType Directory -Force -Path (Join-Path $sk "hack-$s") | Out-Null
  Set-Content -Path (Join-Path $sk "hack-$s\SKILL.md") -Value "old" -Encoding ASCII
}
Set-Content -Path (Join-Path $sk "hack-onboard\.bundle-version") -Value "0.1.0" -Encoding ASCII
Set-Content -Path (Join-Path $sk "hack-gtm\stale.md") -Value "stale" -Encoding ASCII
New-Item -ItemType Directory -Force -Path (Join-Path $sk "hack-foo") | Out-Null
Set-Content -Path (Join-Path $sk "hack-foo\SKILL.md") -Value "mine" -Encoding ASCII
$rc = RunPS "$Sb -Yes -NoPath -Site '$Site'"
$left = (@(Get-ChildItem $sk -Directory -Filter "hack-*" | ForEach-Object { $_.Name } | Sort-Object)) -join " "
Check "upgrade: the 12 bundled hack-* folders removed, your own hack-foo kept ($left)" ($rc -eq 0 -and $left -eq "hack-foo hack-gtm hack-os" -and ((Get-Content (Join-Path $sk "hack-foo\SKILL.md") -Raw).Trim() -eq "mine")) $Log
Check "upgrade: hack-gtm is the new one, nothing left from the old copy" (((Get-Content (Join-Path $sk "hack-gtm\SKILL.md") -Raw) -match "(?m)^name: hack-gtm") -and -not (Test-Path (Join-Path $sk "hack-gtm\stale.md"))) $Log

# 6b. Codex: an existing .codex with its own config and the 0.1.2 skill copies. -Yes connects it
# (no token in config.toml, backup made, other servers kept), removes the duplicate skills, and a
# re-run changes nothing. With CODEX_BIN_DIR (the real @openai/codex, kept off the default PATH)
# Codex itself must read the entry and list each skill once.
Fresh "codex"
$cxd = Join-Path $H ".codex"
New-Item -ItemType Directory -Force -Path $Npm, (Join-Path $cxd "skills\hack-onboard"), (Join-Path $cxd "skills\hack-verify"), (Join-Path $cxd "skills\my-own-skill") | Out-Null
[IO.File]::WriteAllText((Join-Path $cxd "config.toml"), "[mcp_servers.other]`ncommand = `"echo`"`n")
Set-Content -Path (Join-Path $cxd "skills\hack-onboard\.bundle-version") -Value "0.1.2" -Encoding ASCII
foreach ($s in "hack-onboard", "hack-verify", "my-own-skill") { Set-Content -Path (Join-Path $cxd "skills\$s\SKILL.md") -Value "old" -Encoding ASCII }
$env:PATH = (@($Npm, $env:CODEX_BIN_DIR, $OrigPath) | Where-Object { $_ }) -join ";"
$rc = RunPS "$Sb -Yes -Site '$Site'"
$cfgText = Get-Content (Join-Path $cxd "config.toml") -Raw
Check "codex: exit 0, asked and connected" ($rc -eq 0 -and (LogHas "Connect Codex to the event server") -and (LogHas "Codex -> kane-hack-event")) $Log
Check "codex: config.toml has kane-hack-event with the helper, the other server, no token" (($cfgText -match '(?m)^\[mcp_servers\.kane-hack-event\]') -and $cfgText.Contains("url = `"$Site/mcp`"") -and ($cfgText -match 'http_headers_helper = .*mcp-headers') -and ($cfgText -match '(?m)^\[mcp_servers\.other\]') -and ($cfgText -notmatch 'khk_')) $Log
Check "codex: config.toml backed up first" (@(Get-ChildItem $cxd -Filter "config.toml.kanehack-*.bak").Count -eq 1) $Log
Check "codex: hack-os and hack-gtm in .agents\skills, the 0.1.2 copies removed, other skills kept" ((@(Get-ChildItem (Join-Path $H ".agents\skills") -Directory -Filter "hack-*").Count -eq 2) -and -not (Test-Path (Join-Path $cxd "skills\hack-onboard")) -and -not (Test-Path (Join-Path $cxd "skills\hack-verify")) -and (Test-Path (Join-Path $cxd "skills\my-own-skill\SKILL.md"))) $Log
if ($env:CODEX_BIN_DIR) {
  $saved = @{ USERPROFILE = $env:USERPROFILE; HOME = $env:HOME; CODEX_HOME = $env:CODEX_HOME }
  $env:USERPROFILE = $H; $env:HOME = $H; $env:CODEX_HOME = $cxd
  $emptyCwd = Join-Path $Work "empty-cwd"; New-Item -ItemType Directory -Force -Path $emptyCwd | Out-Null
  Push-Location $emptyCwd
  $profileSkills = Join-Path $saved.USERPROFILE ".agents\skills"
  $copied = @()
  if ($env:CI) {
    New-Item -ItemType Directory -Force -Path $profileSkills | Out-Null
    foreach ($d in Get-ChildItem (Join-Path $H ".agents\skills") -Directory -Filter "hack-*") { if (-not (Test-Path (Join-Path $profileSkills $d.Name))) { Copy-Item -Recurse $d.FullName $profileSkills; $copied += Join-Path $profileSkills $d.Name } }
  }
  try {
    $g = (& node (Join-Path $Here "codex-probe.mjs") get) | ConvertFrom-Json
    $k = (& node (Join-Path $Here "codex-probe.mjs") skills) | ConvertFrom-Json
  } finally { Pop-Location; foreach ($envName in $saved.Keys) { [Environment]::SetEnvironmentVariable($envName, $saved[$envName]) }; foreach ($c in $copied) { Remove-Item -Recurse -Force $c } }
  Check "codex: codex mcp get kane-hack-event reads it (url, helper)" ($g.code -eq 0 -and $g.json.transport.url -eq "$Site/mcp" -and $g.json.transport.http_headers_helper) $Log
  $names = @($k.hack.PSObject.Properties)
  Check "codex: Codex lists hack-os and hack-gtm once each (roots: $($k.roots -join ', '))" ($names.Count -eq 2 -and $k.hack."hack-os" -eq 1 -and $k.hack."hack-gtm" -eq 1) $Log
} else { Write-Host "# skip codex binary checks: CODEX_BIN_DIR not set" }
$before = $cfgText
$rc = RunPS "$Sb -Yes -Site '$Site'"
Check "codex re-run: already connected, no question, config unchanged, no new backup" ($rc -eq 0 -and (LogHas "already connected") -and -not (LogHas "y (-Yes)") -and ((Get-Content (Join-Path $cxd "config.toml") -Raw) -eq $before) -and @(Get-ChildItem $cxd -Filter "*.bak").Count -eq 1) $Log
Fresh "no-agents"
New-Item -ItemType Directory -Force -Path (Join-Path $H ".codex") | Out-Null
[IO.File]::WriteAllText((Join-Path $H ".codex\config.toml"), "model = `"x`"`n")
$rc = RunPS "$Sb -Yes -NoAgents -NoSkills -Site '$Site'"
Check "-NoAgents: Codex config untouched, not asked" ($rc -eq 0 -and ((Get-Content (Join-Path $H ".codex\config.toml") -Raw) -eq "model = `"x`"`n") -and -not (LogHas "Connect Codex")) $Log

# 7. Tampered tarball: non-zero exit, nothing installed, and `irm | iex` doesn't kill the host.
$T = Join-Path $Work "tampered"; New-Item -ItemType Directory -Force -Path $T | Out-Null
Copy-Item (Join-Path $Repo "public\install.ps1"), (Join-Path $Repo "public\kanehack-$Version.tgz"), (Join-Path $Repo "public\hack-skills-$Version.tgz") $T
Add-Content -Path (Join-Path $T "hack-skills-$Version.tgz") -Value "x"
$mock = Start-Process -FilePath node -ArgumentList @("`"$(Join-Path $Here 'mock-server.mjs')`"", "--port", "3388", "--public", "`"$T`"") -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
Fresh "tamper"
New-Item -ItemType Directory -Force -Path $Npm | Out-Null
$env:PATH = "$Npm;$OrigPath"
$rc = RunPS "& ([scriptblock]::Create((irm 'http://localhost:3388/install.ps1'))) -Yes -Site 'http://localhost:3388'"
Check "tampered skills tarball: non-zero exit, checksum mismatch, nothing installed" ($rc -ne 0 -and (LogHas "checksum mismatch") -and (LogHas "Nothing was installed") -and -not (Test-Path (Join-Path $H ".kanehack\bin")) -and -not (Test-Path (Join-Path $H ".agents\skills\hack-os"))) $Log
Fresh "tamper-iex"
$rc = RunPS "`$env:KANEHACK_YES = '1'; `$env:KANEHACK_SITE = 'http://localhost:3388'; try { irm 'http://localhost:3388/install.ps1' | iex } catch { Write-Host ('caught: ' + `$_) }; Write-Host 'host-still-alive'; exit 0"
Check "tampered + irm | iex (KANEHACK_YES): error is catchable, the host keeps running" ((LogHas "host-still-alive") -and (LogHas "caught:")) $Log
Stop-Process -Id $mock.Id -Force -ErrorAction SilentlyContinue

# 8. No node on PATH.
Fresh "no-node"
$nodeDir = Split-Path (Get-Command node).Source -Parent
$env:PATH = (($OrigPath -split ";") | Where-Object { $_ -and ($_.TrimEnd("\") -ine $nodeDir.TrimEnd("\")) -and -not (Test-Path (Join-Path $_ "node.exe")) }) -join ";"
$rc = RunPS "$Sb -Yes -Site '$Site'"
$env:PATH = $OrigPath
Check "no node: exit 0, node missing, kanehack not installed" ($rc -eq 0 -and (LogHas "Install Node (with npm) first") -and -not (Test-Path (Join-Path $H ".kanehack\bin"))) $Log

Write-Host "1..$($script:N)"
Write-Host "# $($script:N - $script:Fails)/$($script:N) passed (install.ps1 under $($PSVersionTable.PSEdition) $($PSVersionTable.PSVersion))"
if (-not $env:KEEP_INSTALLED) { Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue }
if ($script:Fails) { exit 1 } else { exit 0 }
