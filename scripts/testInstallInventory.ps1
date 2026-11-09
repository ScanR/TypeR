# Exercise the real CEP validation, staging and installation on disposable files.
# Works with Windows PowerShell 5.1 and PowerShell 7 on macOS/Linux.
$ErrorActionPreference = 'Stop'
$Installer = Join-Path (Split-Path -Parent $PSScriptRoot) 'installer/install.ps1'
$Source = Get-Content -LiteralPath $Installer -Raw
$Tokens = $null; $ParseErrors = $null
$Ast = [Management.Automation.Language.Parser]::ParseFile($Installer, [ref]$Tokens, [ref]$ParseErrors)
if ($ParseErrors.Count) { throw ($ParseErrors | Out-String) }
$HashFunction = $Ast.Find({ param($Node) $Node -is [Management.Automation.Language.FunctionDefinitionAst] -and $Node.Name -eq 'Get-TypeRFileHash' }, $false)
if (-not $HashFunction) { throw 'Missing file hash function' }
. ([scriptblock]::Create($HashFunction.Extent.Text))
$Start = $Source.IndexOf('$Folders = @(''app'', ''CSXS'', ''icons'', ''locale'')')
$End = $Source.IndexOf('# --- 7. Fin ---', $Start)
if ($Start -lt 0 -or $End -le $Start) { throw 'Missing CEP installation block' }
$Install = [scriptblock]::Create($Source.Substring($Start, $End - $Start))
$TestRoot = Join-Path ([IO.Path]::GetTempPath()) ('typer-inventory-tests-' + [Guid]::NewGuid().ToString('N'))
$env:TYPER_INSTALL_VALIDATE_ONLY = $null
$env:TYPER_INSTALL_SKIP_DEBUG = '1'

function Write-Text([string]$Path, [string]$Text) {
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}
function Assert-TypeRPhotoshopClosed {
    # Simulate a source file changing after preflight, before it is copied.
    if ($Tamper) { Write-Text (Join-Path $ScriptDir 'app/index.html') 'changed after validation' }
}
function Test-Inventory([string]$Name, [string]$Variant, [string]$ExpectedError = '') {
    $ScriptDir = Join-Path $TestRoot ($Name + '/source')
    $CepTarget = Join-Path $TestRoot ($Name + '/installed')
    $Files = @('app/index.html', 'app/index.js', 'app/modern.html', 'app/legacy.html', 'app/modern.index.js', 'app/legacy.index.js', 'app/modern.css', 'app/legacy.css', 'app/host.jsx', 'CSXS/manifest.xml', 'locale/messages.properties', 'icons/iconNormal.png')
    foreach ($File in $Files) { Write-Text (Join-Path $ScriptDir $File) ('fixture ' + $File) }
    Write-Text (Join-Path $ScriptDir 'CSXS/manifest.xml') '<ExtensionManifest ExtensionBundleId="com.scanr.typer" ExtensionBundleVersion="3.0.2"><ExtensionList><Extension Id="typer" Version="3.0.2" /></ExtensionList></ExtensionManifest>'
    $Lines = @($Files | ForEach-Object { (Get-TypeRFileHash (Join-Path $ScriptDir $_)) + '  ' + $_ })
    $Text = ($Lines -join "`n") + "`n"
    switch ($Variant) {
        'blank' { $Text = "`n" + ($Lines -join "`n`n") + "`n`n" }
        'spaces' { $Text = (($Lines | ForEach-Object { $_ + " `t" }) -join "`n") + "`n" }
        'bom-crlf' { $Text = [string][char]0xFEFF + ($Lines -join "`r`n") + "`r`n" }
        'mixed' { $Text = [string][char]0xFEFF + "`r`n `t`r`n" + (($Lines | ForEach-Object { $_ + '  ' }) -join "`r`n`r`n") + "`r`n" }
        'duplicate' { $Text += $Lines[0] + "`n" }
        'checksum' { $Text = ('0' * 64) + $Text.Substring(64) }
        'unsafe' { $Text += ('0' * 64) + "  app/../outside`n" }
    }
    Write-Text (Join-Path $ScriptDir 'app/package.sha256') $Text
    Write-Text (Join-Path $CepTarget 'app/index.html') 'old installation'
    $Tamper = $Variant -eq 'tamper'
    $Failure = ''
    try { . $Install } catch { $Failure = $_.Exception.Message }
    if ($ExpectedError) {
        if ($Failure -notlike $ExpectedError) { throw "${Name}: expected '$ExpectedError', got '$Failure'" }
        if ([IO.File]::ReadAllText((Join-Path $CepTarget 'app/index.html')) -ne 'old installation') { throw "${Name}: existing installation was modified" }
    } else {
        if ($Failure) { throw "${Name}: $Failure" }
        foreach ($File in $Files) {
            if ((Get-TypeRFileHash (Join-Path $CepTarget $File)) -ne (Get-TypeRFileHash (Join-Path $ScriptDir $File))) { throw "${Name}: installed file differs: $File" }
        }
    }
    if (Get-ChildItem -LiteralPath $CepTarget -Filter '.typer-install-*' -Directory) { throw "${Name}: staging was not cleaned up" }
    Write-Host "PASS inventory $Name"
}
try {
    Test-Inventory 'normal' 'normal'
    Test-Inventory 'blank-lines' 'blank'
    Test-Inventory 'trailing-whitespace' 'spaces'
    Test-Inventory 'bom-and-crlf' 'bom-crlf'
    Test-Inventory 'combined-formatting' 'mixed'
    Test-Inventory 'duplicate-entry' 'duplicate' '*Unsafe or duplicate package path*'
    Test-Inventory 'invalid-checksum' 'checksum' '*Checksum mismatch*'
    Test-Inventory 'unsafe-path' 'unsafe' '*Unsafe or duplicate package path*'
    Test-Inventory 'changed-after-validation' 'tamper' '*Staged package verification failed*'
} finally {
    if (Test-Path -LiteralPath $TestRoot) { Remove-Item -LiteralPath $TestRoot -Recurse -Force }
}
