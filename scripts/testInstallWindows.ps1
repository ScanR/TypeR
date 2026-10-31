# Run with Windows PowerShell 5.1: powershell -NoProfile -File scripts/testInstallWindows.ps1
# All writes stay inside one disposable fixture tree. No Adobe files are changed.
$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $PSScriptRoot
$Tokens = $null; $ParseErrors = $null
$Ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $ScriptDir 'installer\install.ps1'), [ref]$Tokens, [ref]$ParseErrors)
if ($ParseErrors.Count) { throw ($ParseErrors | Out-String) }
foreach ($Node in $Ast.FindAll({ param($N) $N -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    . ([scriptblock]::Create($Node.Extent.Text))
}
$TestRoot = Join-Path ([IO.Path]::GetTempPath()) ('TypeR-installer-tests-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $TestRoot
$Interactive = $false
$msg_close = 'Photoshop must be closed.'
$script:CaseNumber = 0
$script:Passed = 0
$OriginalVerifier = ${function:Assert-TypeRInstalledFiles}
$OriginalSave = ${function:Save-TypeRTransaction}
function Assert-TypeRInstalledFiles([string]$Root, $Inventory) {
    & $OriginalVerifier $Root $Inventory
    if ($Root -eq $script:FailVerification) { throw 'Injected post-install verification failure' }
}
function Save-TypeRTransaction($Transaction, [string]$Journal) {
    if ($script:FailCommit -and $Transaction.State -eq 'committed') { throw 'Injected journal write failure' }
    & $OriginalSave $Transaction $Journal
}
function Get-TypeRPhotoshops { return $script:FixturePhotoshops }
function Get-Process {
    [CmdletBinding()] param([string]$Name)
    if ($script:PhotoshopRunning) { [PSCustomObject]@{ Name = 'Photoshop' } }
}
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Expect-Failure([scriptblock]$Action, [string]$Pattern) {
    $Message = $null
    try { & $Action } catch { $Message = $_.Exception.Message }
    Assert ($null -ne $Message) 'Expected an error, but the action succeeded.'
    Assert ($Message -like $Pattern) "Unexpected error: $Message (expected $Pattern)"
}
function Write-Text([string]$Path, [string]$Value) {
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force
    [IO.File]::WriteAllText($Path, $Value, (New-Object Text.UTF8Encoding($false)))
}
function New-Plugin([string]$Root, [string]$Version = '3.0.0', [string]$Code = 'old') {
    Write-Text (Join-Path $Root 'manifest.json') ('{"id":"com.scanr.typer","version":"' + $Version + '","name":"TypeR","manifestVersion":5,"main":"index.html","host":{"app":"PS","minVersion":"26.0.0"}}')
    Write-Text (Join-Path $Root 'host.js') $Code
    Write-Text (Join-Path $Root 'index.html') '<html>TypeR</html>'
}
function New-Fixture {
    $script:CaseNumber++
    $script:Fixture = Join-Path $TestRoot ([string]$script:CaseNumber)
    $script:UxpRoot = Join-Path $Fixture 'Adobe UXP'
    $script:UxpPlugins = Join-Path $UxpRoot 'Plugins\External'
    $script:UxpRegistry = Join-Path $UxpRoot 'PluginsInfo\v1\PS.json'
    $script:FixturePhotoshops = @([PSCustomObject]@{ Name = 'Photoshop'; Version = '27.0'; Path = (Join-Path $Fixture 'Photoshop') })
    $script:PhotoshopRunning = $false
    $script:FailVerification = $null
    $script:FailCommit = $false
    $script:Direct = Join-Path $FixturePhotoshops[0].Path 'Plug-ins\TypeR'
    $script:Canonical = Join-Path $UxpPlugins 'com.scanr.typer_3.0.0'
    $script:Source = Join-Path $Fixture 'source'
    New-Plugin $Source '3.0.0' 'new code'
    $script:PackagePath = Join-Path $Fixture 'TypeR.ccx'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($Source, $PackagePath)
}
function Test([string]$Name, [scriptblock]$Action) {
    New-Fixture
    & $Action
    $script:Passed++
    Write-Host "PASS $Name"
}
function Invoke-UpdaterFixture([bool]$Installed, [bool]$LegacyInstalled, [string]$FailEdition = '', [bool]$IncludePackage = $true) {
    $Updater = Join-Path $Fixture 'updater'
    $Release = Join-Path $Fixture 'release'
    $null = New-Item -ItemType Directory -Path $Updater, $Release
    Copy-Item -LiteralPath (Join-Path $ScriptDir 'installer\update_typer_win.cmd') -Destination $Updater
    Write-Text (Join-Path $Updater 'TypeR-UXP.ccx') 'stale package next to updater'
    Write-Text (Join-Path $Release 'CSXS\manifest.xml') '<ExtensionManifest><Extension Id="typer" Version="3.0.0" /></ExtensionManifest>'
    foreach ($Folder in 'app', 'icons', 'locale') { Write-Text (Join-Path $Release ($Folder + '\fixture')) 'fixture' }
    if ($IncludePackage) { Copy-Item -LiteralPath $PackagePath -Destination (Join-Path $Release 'TypeR-UXP.ccx') }
    $ReleaseZip = Join-Path $Fixture 'release.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($Release, $ReleaseZip)
    $Cep = Join-Path $Fixture 'cep'
    if ($LegacyInstalled) { Write-Text (Join-Path $Cep 'CSXS\manifest.xml') 'old legacy' }
    $Calls = Join-Path $Fixture 'calls.jsonl'
    # Stub only the installation boundary; execute the real batch updater,
    # archive extraction, edition selection, package selection and exit handling.
    Write-Text (Join-Path $Updater 'install.ps1') @'
param([switch]$Silent, [switch]$Uxp, [switch]$Legacy, [Parameter(Position = 0)][string]$Package)
if ($env:TYPER_INSTALL_PROBE -eq 'installed') {
    if ($env:TYPER_TEST_UPDATER_INSTALLED -eq '1') { 'installed=uxp' }
    exit 0
}
if ($env:TYPER_INSTALL_PROBE) { throw 'Silent updater unexpectedly opened a menu.' }
$Edition = if ($Uxp) { 'uxp' } else { 'legacy' }
$Hash = if ($Package) { (Get-FileHash -LiteralPath $Package -Algorithm SHA256).Hash } else { $null }
$Record = @{ Edition = $Edition; Package = $Package; Hash = $Hash; Source = $env:TYPER_INSTALL_SOURCE }
Add-Content -LiteralPath $env:TYPER_TEST_UPDATER_CALLS -Value (ConvertTo-Json $Record -Compress)
if ($env:TYPER_TEST_UPDATER_FAIL -eq $Edition) { 'INJECTED UPDATE FAILURE'; exit 7 }
'INSTALLED ' + $Edition
exit 0
'@
    $Environment = @{
        TYPER_TEST_UPDATER_INSTALLED = $(if ($Installed) { '1' } else { '0' })
        TYPER_TEST_UPDATER_FAIL = $FailEdition; TYPER_TEST_UPDATER_CALLS = $Calls
        TYPER_UPDATE_ARCHIVE = $ReleaseZip; TYPER_UPDATE_TARGET = $Cep
        TYPER_UXP_ROOT = $UxpRoot; TYPER_INSTALL_PROBE = $null
    }
    $Before = @{}
    foreach ($Name in $Environment.Keys) { $Before[$Name] = [Environment]::GetEnvironmentVariable($Name); [Environment]::SetEnvironmentVariable($Name, $Environment[$Name]) }
    try {
        $Output = @(& $env:ComSpec /d /c ('call "' + (Join-Path $Updater 'update_typer_win.cmd') + '" --silent')) -join "`n"
        $Code = $LASTEXITCODE
        $Records = @()
        if (Test-Path -LiteralPath $Calls) { $Records = @(Get-Content -LiteralPath $Calls | ForEach-Object { $_ | ConvertFrom-Json }) }
        return [PSCustomObject]@{ ExitCode = $Code; Calls = $Records; Output = $Output }
    } finally {
        foreach ($Name in $Before.Keys) { [Environment]::SetEnvironmentVariable($Name, $Before[$Name]) }
    }
}
try {
    Test 'Recommendation remains available when Photoshop detection fails (develop fix)' {
        function Get-TypeRPhotoshops { throw 'Detection unavailable' }
        Update-TypeRRecommendation
        Assert ($script:Recommended -eq '' -and $script:PhotoshopList -eq '') 'Detection error prevented menu fallback'
    }
    Test 'Updater discovery includes direct copies and ignores incomplete external stages' {
        New-Plugin $Direct
        New-Plugin (Join-Path $UxpPlugins 'com.scanr.typer_3.0.0.installing')
        $Paths = @(Get-TypeRInstalledPluginPaths)
        Assert ($Paths.Count -eq 1 -and $Paths[0] -eq $Direct) 'Wrong installed plugin detection'
    }
    Test 'Standalone updater updates installed UXP without adding Legacy (develop fix)' {
        $Result = Invoke-UpdaterFixture $true $false
        Assert ($Result.ExitCode -eq 0) $Result.Output
        Assert ($Result.Calls.Count -eq 1 -and $Result.Calls[0].Edition -eq 'uxp') 'Updater selected Legacy'
        Assert ($Result.Calls[0].Hash -eq (Get-FileHash -LiteralPath $PackagePath).Hash) 'Updater installed stale neighboring package'
    }
    Test 'Standalone updater updates both installed editions' {
        $Result = Invoke-UpdaterFixture $true $true
        Assert ($Result.ExitCode -eq 0) $Result.Output
        Assert (($Result.Calls.Edition -join ',') -eq 'legacy,uxp') 'Updater missed an installed edition'
    }
    Test 'Silent standalone updater preserves Legacy choice when UXP is absent' {
        $Result = Invoke-UpdaterFixture $false $true
        Assert ($Result.ExitCode -eq 0) $Result.Output
        Assert ($Result.Calls.Count -eq 1 -and $Result.Calls[0].Edition -eq 'legacy') 'Silent updater unexpectedly switched editions'
    }
    Test 'Standalone updater propagates install failure instead of reporting success' {
        $Result = Invoke-UpdaterFixture $true $false 'uxp'
        Assert ($Result.ExitCode -eq 7) 'Updater masked failing exit code'
        Assert ($Result.Output -notmatch 'INSTALLED uxp') 'Updater claimed success'
    }
    Test 'Older release without CCX uses installer download fallback, never stale neighbor' {
        $Result = Invoke-UpdaterFixture $true $false '' $false
        Assert ($Result.ExitCode -eq 0) $Result.Output
        Assert (-not $Result.Calls[0].Package -and $Result.Calls[0].Source -ne (Join-Path $Fixture 'updater')) 'Wrong missing-package fallback'
    }
    Test 'Fresh external install preserves other plugins and registry properties' {
        $Other = '{"schema":7,"plugins":[{"pluginId":"other","path":"other-path","extra":[1,2]}]}'
        Write-Text $UxpRegistry $Other
        Install-TypeRPluginManually $PackagePath
        Assert ((Get-Content -LiteralPath (Join-Path $Canonical 'host.js') -Raw) -eq 'new code') 'Missing new plugin'
        $Registry = Get-Content -LiteralPath $UxpRegistry -Raw | ConvertFrom-Json
        Assert ($Registry.schema -eq 7 -and $Registry.plugins.Count -eq 2 -and $Registry.plugins[0].extra.Count -eq 2) 'Other registry content changed'
        Assert ($Registry.plugins[1].versionString -eq '3.0.0') 'Version not registered'
    }
    Test 'Same-version direct update replaces code, removes stale files, keeps backup' {
        New-Plugin $Direct
        Write-Text (Join-Path $Direct 'obsolete.js') 'stale'
        Install-TypeRPluginManually $PackagePath
        Assert ((Get-Content -LiteralPath (Join-Path $Direct 'host.js') -Raw) -eq 'new code') 'Old code was not replaced'
        Assert (-not (Test-Path -LiteralPath (Join-Path $Direct 'obsolete.js'))) 'Stale file survived'
        Assert (-not (Test-Path -LiteralPath $Canonical)) 'Created duplicate external install'
        $History = Get-ChildItem -LiteralPath (Join-Path $UxpRoot '.typer-installer') -Filter '*.json' | Select-Object -First 1
        $Record = Get-Content -LiteralPath $History.FullName -Raw | ConvertFrom-Json
        Assert ((Get-Content -LiteralPath (Join-Path $Record.Operations[0].Backup 'host.js') -Raw) -eq 'old') 'Backup missing'
    }
    Test 'All direct copies including nested vendor folders are updated' {
        New-Plugin $Direct
        $Nested = Join-Path $FixturePhotoshops[0].Path 'Plug-ins\Vendor\Other name'
        New-Plugin $Nested
        $SecondHost = Join-Path $Fixture 'Photoshop Beta'
        $script:FixturePhotoshops += [PSCustomObject]@{ Name = 'Beta'; Version = '28.0'; Path = $SecondHost }
        $Second = Join-Path $SecondHost 'Plug-ins\TypeR'
        New-Plugin $Second
        Install-TypeRPluginManually $PackagePath
        foreach ($Path in $Direct, $Nested, $Second) { Assert ((Get-Content -LiteralPath (Join-Path $Path 'host.js') -Raw) -eq 'new code') "Missed $Path" }
        Assert (-not @(Get-ChildItem -LiteralPath (Join-Path $FixturePhotoshops[0].Path 'Plug-ins') -Recurse -Directory -Filter '.typer-install-*').Count) 'Backup inside plugin search path'
    }
    Test 'Old external copies are retired and registry duplicates removed' {
        $Old = Join-Path $UxpPlugins 'arbitrary-folder-name'
        New-Plugin $Old '2.9.0'
        Write-Text $UxpRegistry '{"plugins":[{"pluginId":"com.scanr.typer","path":"$localPlugins/External/arbitrary-folder-name"},{"pluginId":"com.scanr.typer","path":"$localPlugins/External/missing"}]}'
        New-Plugin $Direct
        Install-TypeRPluginManually $PackagePath
        Assert (-not (Test-Path -LiteralPath $Old)) 'Old external copy still active'
        $Registry = Get-Content -LiteralPath $UxpRegistry -Raw | ConvertFrom-Json
        Assert (@($Registry.plugins).Count -eq 1) 'Duplicate registration'
        Assert (Test-Path -LiteralPath (Join-Path $Canonical 'host.js')) 'Canonical copy missing'
        Assert ((Get-Content -LiteralPath (Join-Path $Direct 'host.js') -Raw) -eq 'new code') 'Direct copy stale'
    }
    Test 'Bad registry stops before replacing existing files' {
        New-Plugin $Direct
        Write-Text $UxpRegistry '{broken'
        Expect-Failure { Install-TypeRPluginManually $PackagePath } '*'
        Assert ((Get-Content -LiteralPath (Join-Path $Direct 'host.js') -Raw) -eq 'old') 'Old code lost'
        Assert ((Get-Content -LiteralPath $UxpRegistry -Raw) -eq '{broken') 'Broken registry overwritten'
    }
    Test 'Verification failure restores every direct copy' {
        New-Plugin $Direct
        $Second = Join-Path $FixturePhotoshops[0].Path 'Plug-ins\TypeR-second'
        New-Plugin $Second '3.0.0' 'old second'
        $script:FailVerification = $Second
        Expect-Failure { Install-TypeRPluginManually $PackagePath } '*Injected post-install*'
        Assert ((Get-Content -LiteralPath (Join-Path $Direct 'host.js') -Raw) -eq 'old') 'First copy not restored'
        Assert ((Get-Content -LiteralPath (Join-Path $Second 'host.js') -Raw) -eq 'old second') 'Second copy not restored'
        Assert (-not (Test-Path -LiteralPath (Join-Path $UxpRoot '.typer-installer\pending.json'))) 'Recovery journal not cleared'
    }
    Test 'Registry write followed by commit failure restores registry bytes and plugin' {
        New-Plugin $Canonical
        $Before = '{"unknown":true,"plugins":[{"pluginId":"com.scanr.typer","path":"$localPlugins/External/com.scanr.typer_3.0.0"}]}' + "`r`n"
        Write-Text $UxpRegistry $Before
        $script:FailCommit = $true
        Expect-Failure { Install-TypeRPluginManually $PackagePath } '*Injected journal write*'
        Assert ((Get-Content -LiteralPath $UxpRegistry -Raw) -ceq $Before) 'Registry bytes changed'
        Assert ((Get-Content -LiteralPath (Join-Path $Canonical 'host.js') -Raw) -eq 'old') 'External copy not restored'
    }
    Test 'Fresh install commit failure removes new registration and new plugin' {
        $script:FailCommit = $true
        Expect-Failure { Install-TypeRPluginManually $PackagePath } '*Injected journal write*'
        Assert (-not (Test-Path -LiteralPath $Canonical)) 'Failed fresh plugin remains'
        Assert (-not (Test-Path -LiteralPath $UxpRegistry)) 'Failed fresh registry remains'
    }
    Test 'Read-only registry failure restores plugin without rewriting unchanged registry' {
        New-Plugin $Canonical
        $Before = '{"plugins":[{"pluginId":"com.scanr.typer","path":"$localPlugins/External/com.scanr.typer_3.0.0"}]}'
        Write-Text $UxpRegistry $Before
        [IO.File]::SetAttributes($UxpRegistry, [IO.FileAttributes]::ReadOnly)
        try {
            Expect-Failure { Install-TypeRPluginManually $PackagePath } '*'
            Assert ((Get-Content -LiteralPath (Join-Path $Canonical 'host.js') -Raw) -eq 'old') 'Plugin not restored after registry access error'
            Assert ((Get-Content -LiteralPath $UxpRegistry -Raw) -ceq $Before) 'Read-only registry changed'
            Assert (-not (Test-Path -LiteralPath (Join-Path $UxpRoot '.typer-installer\pending.json'))) 'Spurious incomplete recovery'
        } finally { [IO.File]::SetAttributes($UxpRegistry, [IO.FileAttributes]::Normal) }
    }
    Test 'Locked plugin file causes a safe error and restores already replaced copies' {
        New-Plugin $Direct
        $Second = Join-Path $FixturePhotoshops[0].Path 'Plug-ins\TypeR-second'
        New-Plugin $Second '3.0.0' 'old second'
        $Lock = [IO.File]::Open((Join-Path $Second 'host.js'), 'Open', 'Read', 'None')
        try { Expect-Failure { Install-TypeRPluginManually $PackagePath } '*' } finally { $Lock.Dispose() }
        Assert ((Get-Content -LiteralPath (Join-Path $Direct 'host.js') -Raw) -eq 'old') 'First copy not restored after file lock'
        Assert ((Get-Content -LiteralPath (Join-Path $Second 'host.js') -Raw) -eq 'old second') 'Locked copy changed'
    }
    Test 'Empty registry is restored as an existing empty file' {
        Write-Text $UxpRegistry ''
        $script:FailCommit = $true
        Expect-Failure { Install-TypeRPluginManually $PackagePath } '*Injected journal write*'
        Assert ((Test-Path -LiteralPath $UxpRegistry) -and (Get-Item -LiteralPath $UxpRegistry).Length -eq 0) 'Empty original registry lost'
    }
    Test 'Concurrent installer lock prevents changes' {
        $Control = Join-Path $UxpRoot '.typer-installer'
        $null = New-Item -ItemType Directory -Path $Control -Force
        $Lock = [IO.File]::Open((Join-Path $Control 'install.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
        try { Expect-Failure { Install-TypeRPluginManually $PackagePath } '*Another TypeR installation*' } finally { $Lock.Dispose() }
        Assert (-not (Test-Path -LiteralPath $Canonical)) 'Plugin changed under lock'
    }
    Test 'Open Photoshop blocks installation before writing installer state' {
        $script:PhotoshopRunning = $true
        Expect-Failure { Install-TypeRPluginManually $PackagePath } '*Photoshop must be closed*'
        Assert (-not (Test-Path -LiteralPath $UxpRoot)) 'Wrote state while Photoshop open'
    }
    Test 'Incompatible Photoshop rejects UXP' {
        $script:FixturePhotoshops[0].Version = '25.0'
        Expect-Failure { Install-TypeRPluginManually $PackagePath } '*No compatible Photoshop*'
        Assert (-not (Test-Path -LiteralPath $Canonical)) 'Incompatible plugin installed'
    }
    Test 'Photoshop 26.0 meets a 26.0.0 minimum version' {
        $script:FixturePhotoshops[0].Version = '26.0'
        Install-TypeRPluginManually $PackagePath
        Assert (Test-Path -LiteralPath (Join-Path $Canonical 'host.js')) 'Equivalent version was rejected'
    }
    Test 'Unrelated plugin at target is preserved' {
        New-Plugin $Canonical
        $File = Join-Path $Canonical 'manifest.json'
        Write-Text $File ((Get-Content -LiteralPath $File -Raw).Replace('com.scanr.typer', 'another.plugin'))
        Expect-Failure { Install-TypeRPluginManually $PackagePath } '*belongs to another plugin*'
        Assert ((Get-Content -LiteralPath $File -Raw) -match 'another.plugin') 'Unrelated plugin lost'
    }
    Test 'Archive path traversal is rejected before extraction' {
        $Zip = [IO.Compression.ZipFile]::Open($PackagePath, 'Update')
        try { $null = $Zip.CreateEntry('../escape.txt') } finally { $Zip.Dispose() }
        Expect-Failure { Install-TypeRPluginManually $PackagePath } '*Unsafe*package path*'
        Assert (-not (Test-Path -LiteralPath (Join-Path $Fixture 'escape.txt'))) 'Archive escaped'
    }
    Test 'Case-insensitive archive collisions are rejected' {
        $Zip = [IO.Compression.ZipFile]::Open($PackagePath, 'Update')
        try { $null = $Zip.CreateEntry('HOST.js') } finally { $Zip.Dispose() }
        Expect-Failure { Install-TypeRPluginManually $PackagePath } '*duplicate package path*'
    }
    Test 'Incomplete package cannot replace old plugin' {
        New-Plugin $Direct
        $Zip = [IO.Compression.ZipFile]::Open($PackagePath, 'Update')
        try { $Zip.GetEntry('host.js').Delete() } finally { $Zip.Dispose() }
        Expect-Failure { Install-TypeRPluginManually $PackagePath } '*Incomplete TypeR package*'
        Assert ((Get-Content -LiteralPath (Join-Path $Direct 'host.js') -Raw) -eq 'old') 'Old plugin changed'
    }
    Test 'Interrupted swap is recovered from durable journal on next launch' {
        New-Plugin $Direct
        $Control = Join-Path $UxpRoot '.typer-installer'
        $null = New-Item -ItemType Directory -Path $Control -Force
        $Id = [Guid]::NewGuid().ToString('N')
        $Workspace = Get-TypeRWorkspace $Direct $Id
        $null = New-Item -ItemType Directory -Path $Workspace
        $Operation = [PSCustomObject]@{ Index = 0; Target = $Direct; Workspace = $Workspace; Backup = (Join-Path $Workspace 'backup-0'); Stage = (Join-Path $Workspace 'stage-0'); HadTarget = $true; Pending = $true; Retire = $false }
        $Before = '{"plugins":[],"retained":42}'
        Write-Text $UxpRegistry $Before
        $After = '{"plugins":[]}'
        $Record = [PSCustomObject]@{ Id = $Id; State = 'preparing'; Operations = @($Operation); RegistryPath = $UxpRegistry; RegistryBefore = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Before)); RegistryAfter = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($After)); RegistryExisted = $true; RegistryPending = $true }
        Save-TypeRTransaction $Record (Join-Path $Control 'pending.json')
        [IO.Directory]::Move($Direct, $Operation.Backup)
        New-Plugin $Direct '3.0.0' 'interrupted code'
        Write-Text $UxpRegistry $After
        Write-Text $PackagePath 'bad zip'
        Expect-Failure { Install-TypeRPluginManually $PackagePath } '*'
        Assert ((Get-Content -LiteralPath (Join-Path $Direct 'host.js') -Raw) -eq 'old') 'Interrupted swap not recovered'
        Assert ((Get-Content -LiteralPath $UxpRegistry -Raw) -ceq $Before) 'Interrupted registry not recovered'
        Assert (-not (Test-Path -LiteralPath (Join-Path $Control 'pending.json'))) 'Recovery journal left behind'
    }
    $RealPackage = Join-Path $ScriptDir 'Releases\TypeR-UXP.ccx'
    if (Test-Path -LiteralPath $RealPackage) {
      Test 'Real distributed CCX extracts and verifies all packaged files' {
        $Root = Join-Path $Fixture 'real-package'
        $Payload = Expand-TypeRPackage $RealPackage $Root
        Assert-TypeRInstalledFiles $Root $Payload.Inventory
        Assert ($Payload.Inventory.Count -gt 40) 'Real package not fully checked'
      }
    } else {
        Write-Host 'SKIP real CCX verification: run npm run package:uxp to generate the release artifact.'
    }
    Write-Host "$Passed tests passed."
} finally {
    $Full = [IO.Path]::GetFullPath($TestRoot)
    $TempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $Full.StartsWith($TempRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $Full) -notlike 'TypeR-installer-tests-*') { throw 'Unsafe test cleanup path' }
    Remove-Item -LiteralPath $Full -Recurse -Force
}
