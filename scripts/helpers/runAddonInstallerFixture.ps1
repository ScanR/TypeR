param([Parameter(Mandatory=$true)][string]$BundleRoot, [Parameter(Mandatory=$true)][string]$FixtureRoot)
$ErrorActionPreference = 'Stop'
$FixtureRoot = [IO.Path]::GetFullPath($FixtureRoot)
$TemporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
if (-not $FixtureRoot.StartsWith($TemporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $FixtureRoot.Substring($TemporaryRoot.Length) -notmatch '^TypeR-addon-installer-tests-[a-f0-9]{32}\\launcher$') {
    throw 'Installer fixture must be inside the temporary test tree.'
}
$env:TYPER_INSTALL_SOURCE = $BundleRoot
$env:TYPER_UXP_ROOT = Join-Path $FixtureRoot 'Adobe UXP'
$env:TYPER_INSTALL_TARGET = Join-Path $FixtureRoot 'CEP'
$env:TYPER_PHOTOSHOP_VERSIONS = 'Photoshop=27.11'
# The application gate is the only process boundary simulated in this child.
function global:Get-Process { [CmdletBinding()] param([string]$Name); return @() }
& (Join-Path $BundleRoot 'installer\install_addon.ps1') -Silent
exit $LASTEXITCODE
