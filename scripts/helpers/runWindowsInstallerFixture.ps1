# Native Legacy installation fixtures must not depend on a real Photoshop
# process. Only this test runner replaces the close guard; production has no
# bypass. Both input and output must belong to the release-safety sandbox.
$ErrorActionPreference = 'Stop'
$Source = [IO.Path]::GetFullPath($env:TYPER_INSTALL_SOURCE)
$Target = [IO.Path]::GetFullPath($env:TYPER_INSTALL_TARGET)
$Sandbox = Split-Path -Parent $Source
$Temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
if (-not $Sandbox.StartsWith($Temp, [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path -Leaf $Sandbox) -notlike 'typer-release-safety-*' -or
    $Source -ne (Join-Path $Sandbox 'source') -or $Target -ne (Join-Path $Sandbox 'target') -or
    $env:TYPER_INSTALL_SKIP_DEBUG -ne '1') { throw 'Refusing a non-isolated installer fixture.' }
$Installer = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'installer\install.ps1'
$Tokens = $null; $Errors = $null
$Ast = [Management.Automation.Language.Parser]::ParseFile($Installer, [ref]$Tokens, [ref]$Errors)
if ($Errors.Count) { throw ($Errors | Out-String) }
$Guard = $Ast.Find({ param($Node) $Node -is [Management.Automation.Language.FunctionDefinitionAst] -and $Node.Name -eq 'Assert-TypeRPhotoshopClosed' }, $true)
if (-not $Guard) { throw 'Installer close guard not found.' }
$Text = [IO.File]::ReadAllText($Installer)
$Text = $Text.Remove($Guard.Extent.StartOffset, $Guard.Extent.EndOffset - $Guard.Extent.StartOffset).Insert($Guard.Extent.StartOffset, 'function Assert-TypeRPhotoshopClosed {}')
& ([scriptblock]::Create($Text)) -Silent -Legacy
