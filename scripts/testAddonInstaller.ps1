# Test the real offline bundle in disposable directories; never change Adobe installs.
$ErrorActionPreference = 'Stop'
$Repository = Split-Path -Parent $PSScriptRoot
$TestRoot = Join-Path ([IO.Path]::GetTempPath()) ('TypeR-addon-installer-tests-' + [Guid]::NewGuid().ToString('N'))
$Bundle = Join-Path $TestRoot 'bundle'
$Passed = 0
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Write-Text([string]$Path, [string]$Value) {
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force
    [IO.File]::WriteAllText($Path, $Value, (New-Object Text.UTF8Encoding($false)))
}
function Test([string]$Name, [scriptblock]$Action) {
    & $Action
    $script:Passed++
    Write-Host "PASS $Name"
}
function Expect-Failure([scriptblock]$Action, [string]$Pattern) {
    $Message = $null
    try { & $Action } catch { $Message = $_.Exception.Message }
    Assert ($Message -and $Message -like $Pattern) "Expected $Pattern, got: $Message"
}
function Set-Fixture([string]$Name) {
    $script:Fixture = Join-Path $TestRoot $Name
    $script:UxpRoot = Join-Path $Fixture 'Adobe UXP'
    $script:UxpPlugins = Join-Path $UxpRoot 'Plugins\External'
    $script:UxpRegistry = Join-Path $UxpRoot 'PluginsInfo\v1\PS.json'
    $script:PhotoshopRoot = Join-Path $Fixture 'Portable Photoshop'
    $script:PhotoshopRunning = $false
}
function New-OldPlugin([string]$Folder) {
    Write-Text (Join-Path $Folder 'manifest.json') '{"id":"com.scanr.typer","version":"3.0.0","main":"index.html","name":"TypeR","host":{"app":"PS","minVersion":"26.0.0"}}'
    Write-Text (Join-Path $Folder 'host.js') 'previous version'
    Write-Text (Join-Path $Folder 'native\typer-keys-win.json') 'previous EXE payload'
}
function Write-Checksum([string]$File) {
    Write-Text ($File + '.sha256') ((Get-TypeRFileHash $File) + '  TypeR-UXP-addon-win.ccx')
}
function Change-NativeEntry([string]$File, [byte[]]$Bytes) {
    $Archive = [IO.Compression.ZipFile]::Open($File, 'Update')
    try {
        $Archive.GetEntry('win/x64/typer-keys.uxpaddon').Delete()
        if ($null -ne $Bytes) {
            $Entry = $Archive.CreateEntry('win/x64/typer-keys.uxpaddon')
            $Stream = $Entry.Open()
            try { $Stream.Write($Bytes, 0, $Bytes.Length) } finally { $Stream.Dispose() }
        }
    } finally { $Archive.Dispose() }
    Write-Checksum $File
}

try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $null = New-Item -ItemType Directory -Path $TestRoot
    [IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $Repository 'Releases\TypeR-Addon-Windows.zip'), $Bundle)
    $ScriptDir = $Bundle
    $Interactive = $false
    $msg_close = 'Photoshop must be closed.'
    foreach ($Script in @('install.ps1', 'install_addon.ps1')) {
        $Tokens = $null; $Errors = $null
        $Ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $Bundle ('installer\' + $Script)), [ref]$Tokens, [ref]$Errors)
        Assert (-not $Errors.Count) ($Errors | Out-String)
        foreach ($Node in $Ast.FindAll({ param($N) $N -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
            . ([scriptblock]::Create($Node.Extent.Text))
        }
    }
    # Replace only discovery boundaries. The extraction, registration, backup,
    # swapping and verification functions above come from the shipped bundle.
    function Get-TypeRPhotoshops { return @([PSCustomObject]@{ Name = 'Photoshop'; Version = '27.11'; Path = $script:PhotoshopRoot }) }
    function Get-Process { [CmdletBinding()] param([string]$Name); if ($script:PhotoshopRunning) { [PSCustomObject]@{ Name = 'Photoshop' } } }
    $PackagePath = Join-Path $Bundle 'TypeR-UXP-addon-win.ccx'
    $Manifest = Assert-TypeRAddonPackage $PackagePath ($PackagePath + '.sha256')
    $Folder = $Manifest.id + '_' + $Manifest.version
    $Reference = Join-Path $TestRoot 'reference'
    $Payload = Expand-TypeRPackage $PackagePath $Reference
    $NativeHash = Get-TypeRFileHash (Join-Path $Reference 'win\x64\typer-keys.uxpaddon')

    Test 'Extracted launcher targets the bundled offline addon installer' {
        $Launcher = [IO.File]::ReadAllText((Join-Path $Bundle 'Installer-TypeR-Addon.cmd'))
        Assert ($Launcher.Contains('installer\install_addon.ps1')) 'Wrong installer launched'
        Assert (-not ($Launcher -match 'https?://|UnifiedPluginInstaller')) 'Online installer dependency'
        Assert ($Payload.Inventory.Count -gt 40) 'Incomplete actual payload'
    }
    Test 'Bundled wrapper and full installer run successfully without Creative Cloud' {
        $LauncherRoot = Join-Path $TestRoot 'launcher'
        $Helper = Join-Path $Repository 'scripts\helpers\runAddonInstallerFixture.ps1'
        & powershell -NoProfile -ExecutionPolicy Bypass -File $Helper -BundleRoot $Bundle -FixtureRoot $LauncherRoot
        Assert ($LASTEXITCODE -eq 0) 'Bundled installer returned a failure'
        $Target = Join-Path $LauncherRoot ('Adobe UXP\Plugins\External\' + $Folder)
        Assert-TypeRInstalledFiles $Target $Payload.Inventory
    }
    Test 'Fresh offline install registers manifest v6 and preserves all native bytes' {
        Set-Fixture 'fresh'
        Write-Text $UxpRegistry '{"schema":7,"plugins":[{"pluginId":"other.plugin","extra":[1,2]}]}'
        $Data = Join-Path $Fixture 'TypeR\UXP\settings.json'
        Write-Text $Data '{"keep":"my settings"}'
        Install-TypeRPluginManually $PackagePath
        $Target = Join-Path $UxpPlugins $Folder
        Assert-TypeRInstalledFiles $Target $Payload.Inventory
        Assert ((Get-TypeRFileHash (Join-Path $Target 'win\x64\typer-keys.uxpaddon')) -eq $NativeHash) 'Native DLL changed'
        Assert (-not (Test-Path -LiteralPath (Join-Path $Target 'native'))) 'EXE reader was installed'
        $Registry = Get-Content -Raw -LiteralPath $UxpRegistry | ConvertFrom-Json
        Assert ($Registry.schema -eq 7 -and $Registry.plugins.Count -eq 2 -and $Registry.plugins[0].extra.Count -eq 2) 'Other plugins changed'
        Assert ($Registry.plugins[1].path -ceq ('$localPlugins\External\' + $Folder)) 'Invalid local registration'
        Assert ((Get-Content -Raw -LiteralPath $Data) -eq '{"keep":"my settings"}') 'User settings changed'
    }
    Test 'Upgrade retires the external EXE payload and retains a backup' {
        Set-Fixture 'upgrade'
        $Old = Join-Path $UxpPlugins 'com.scanr.typer_3.0.0'
        New-OldPlugin $Old
        Write-Text $UxpRegistry '{"plugins":[{"pluginId":"com.scanr.typer","path":"$localPlugins/External/com.scanr.typer_3.0.0"}]}'
        Install-TypeRPluginManually $PackagePath
        Assert-TypeRInstalledFiles (Join-Path $UxpPlugins $Folder) $Payload.Inventory
        Assert (-not (Test-Path -LiteralPath $Old)) 'Old plugin still active'
        $History = Get-ChildItem -LiteralPath (Join-Path $UxpRoot '.typer-installer') -Filter '*.json' | Select-Object -First 1
        $Record = Get-Content -Raw -LiteralPath $History.FullName | ConvertFrom-Json
        $Backup = @($Record.Operations | Where-Object { $_.Target -eq $Old })[0].Backup
        Assert ((Get-Content -Raw -LiteralPath (Join-Path $Backup 'host.js')) -eq 'previous version') 'Old version backup missing'
    }
    Test 'Custom Photoshop Plug-ins copy is updated without an external duplicate' {
        Set-Fixture 'direct'
        $Direct = Join-Path $PhotoshopRoot 'Plug-ins\TypeR'
        New-OldPlugin $Direct
        Install-TypeRPluginManually $PackagePath
        Assert-TypeRInstalledFiles $Direct $Payload.Inventory
        Assert (-not (Test-Path -LiteralPath (Join-Path $Direct 'native'))) 'Old native reader survived'
        Assert (-not (Test-Path -LiteralPath (Join-Path $UxpPlugins $Folder))) 'Unnecessary duplicate plugin'
    }
    Test 'Open Photoshop prevents installation' {
        Set-Fixture 'running'
        $script:PhotoshopRunning = $true
        Expect-Failure { Install-TypeRPluginManually $PackagePath } '*Photoshop must be closed*'
        Assert (-not (Test-Path -LiteralPath $UxpRoot)) 'Changed files while Photoshop is running'
    }
    Test 'Changed payload is rejected before installation' {
        $Bad = Join-Path $TestRoot 'changed.ccx'
        Copy-Item -LiteralPath $PackagePath -Destination $Bad
        [IO.File]::AppendAllText($Bad, 'changed')
        Expect-Failure { Assert-TypeRAddonPackage $Bad ($PackagePath + '.sha256') } '*damaged or changed*'
    }
    Test 'Missing addon cannot pass a valid archive checksum' {
        $Bad = Join-Path $TestRoot 'missing.ccx'
        Copy-Item -LiteralPath $PackagePath -Destination $Bad
        Change-NativeEntry $Bad $null
        Expect-Failure { Assert-TypeRAddonPackage $Bad ($Bad + '.sha256') } '*Missing or invalid native*'
    }
    Test 'Wrong native binary format is rejected' {
        $Bad = Join-Path $TestRoot 'invalid.ccx'
        Copy-Item -LiteralPath $PackagePath -Destination $Bad
        Change-NativeEntry $Bad (New-Object byte[] 64)
        Expect-Failure { Assert-TypeRAddonPackage $Bad ($Bad + '.sha256') } '*AMD64 Windows DLL*'
    }
    Test 'Incomplete extracted bundle is rejected' {
        Expect-Failure { Assert-TypeRAddonPackage (Join-Path $TestRoot 'absent.ccx') ($PackagePath + '.sha256') } '*Archive incomplete*'
    }
    Write-Host "$Passed offline addon installer tests passed (file installation; Photoshop runtime not exercised)."
} finally {
    $Full = [IO.Path]::GetFullPath($TestRoot)
    $Temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $Full.StartsWith($Temp, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $Full) -notlike 'TypeR-addon-installer-tests-*') { throw 'Unsafe fixture cleanup path' }
    if (Test-Path -LiteralPath $Full) { Remove-Item -LiteralPath $Full -Recurse -Force }
}
