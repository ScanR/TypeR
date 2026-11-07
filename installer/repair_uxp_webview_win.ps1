# TypeR's version-locked WebView storage repair. Never patch an unknown binary.
# Inspect is read-only. Auto is called ONLY after the plugin observes UXP's
# missing-storage refusal; it requests UAC and waits for a normal Photoshop exit.
[CmdletBinding()]
param(
    [ValidateSet('Inspect', 'Apply', 'Restore', 'Auto')][string]$Action = 'Inspect',
    [string]$PhotoshopPath = 'C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe',
    [string]$ReportPath,
    [switch]$WaitForExit,
    [ValidateRange(1, 86400)][int]$WaitSeconds = 86400,
    [switch]$Retry
)

$ErrorActionPreference = 'Stop'
$OriginalHash = 'cded92ca1e7563126e1433ecbca50cb9a8e141f48a15d1a4c6739c44f8d9f714'
$PatchedHash = 'c2974a41e0a479fb588308f500e6548870fa758115b3f5c16beb523ebec78440'
$PatchOffset = 37673245
$BeforeHex = '4889742428ff1570c48e0185c07507ff1566df8e01cc837c242000742a48897c2430c744243804000000488d4c'
$AfterHex = 'c744244874797065c744244c722d6f66c7442450666c696e66c7442454650048c74424580d000000e9d6feffff'

function Get-Hash([string]$Path) {
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Convert-Hex([string]$Hex) {
    [byte[]]$Bytes = for ($i = 0; $i -lt $Hex.Length; $i += 2) { [Convert]::ToByte($Hex.Substring($i, 2), 16) }
    return ,$Bytes
}
function Assert-PhotoshopClosed {
    if (Get-Process -Name Photoshop -ErrorAction SilentlyContinue) {
        throw 'Close Photoshop before applying or restoring the experiment. No documents are closed automatically.'
    }
}
function Write-RepairStatus([string]$Status, [string]$Detail = '') {
    if (-not $ReportPath) { return }
    $ReportDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($ReportPath))
    [IO.Directory]::CreateDirectory($ReportDirectory) | Out-Null
    $Receipt = @{ status = $Status; detail = $Detail; photoshop = $PhotoshopPath; repair = $PatchedHash; time = [DateTime]::UtcNow.ToString('o') }
    $ReceiptStage = $ReportPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllText($ReceiptStage, ($Receipt | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
        if (Test-Path -LiteralPath $ReportPath) { [IO.File]::Replace($ReceiptStage, $ReportPath, [NullString]::Value) }
        else { [IO.File]::Move($ReceiptStage, $ReportPath) }
    } finally { if (Test-Path -LiteralPath $ReceiptStage) { Remove-Item -LiteralPath $ReceiptStage -Force } }
}
function Quote-RepairArgument([string]$Value) { "'" + $Value.Replace("'", "''") + "'" }
function Show-AutomaticRepairFailure {
    $Message = if ([Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName -eq 'fr') {
        "La reparation de Photoshop n'a pas pu se terminer. Vous pouvez relancer Photoshop : TypeR utilisera son interface de secours. Contactez le support TypeR avec le fichier status.json de la reparation."
    } else {
        'The Photoshop repair could not finish. You can open Photoshop again: TypeR will use its fallback interface. Contact TypeR support with the repair status.json file.'
    }
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show($Message, 'TypeR - Photoshop WebView', 'OK', 'Information', 'Button1', 'DefaultDesktopOnly') | Out-Null
}

function Start-AutomaticRepair {
    # One coordinator per Windows user and Photoshop path, across plugin reloads.
    $Hasher = [Security.Cryptography.SHA256]::Create()
    try { $PathHash = [BitConverter]::ToString($Hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($PhotoshopPath.ToLowerInvariant()))).Replace('-', '') }
    finally { $Hasher.Dispose() }
    $Mutex = [Threading.Mutex]::new($false, ('Local\TypeR-WebView-Repair-' + $PathHash))
    $Acquired = $false
    try {
        try { $Acquired = $Mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $Acquired = $true }
        if (-not $Acquired) { return }
        if ($State -eq 'experimental-applied') { Write-RepairStatus 'applied'; return }
        if ($State -ne 'original-supported') { Write-RepairStatus 'unsupported'; return }
        if (Test-Path -LiteralPath $DisabledPath) { Write-RepairStatus 'disabled'; return }
        if (-not $Retry -and $ReportPath -and (Test-Path -LiteralPath $ReportPath)) {
            try { $Previous = [IO.File]::ReadAllText($ReportPath) | ConvertFrom-Json } catch { $Previous = $null }
            if ($Previous -and $Previous.photoshop -eq $PhotoshopPath -and $Previous.repair -eq $PatchedHash -and
                $Previous.status -in @('declined', 'failed', 'timed-out')) { return }
        }
        Write-RepairStatus 'preparing'
        $French = [Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName -eq 'fr'
        $Notice = if ($French) {
            "TypeR a detecte un probleme de Photoshop qui empeche son interface de s'afficher normalement.`n`nLa reparation va demander l'autorisation administrateur de Windows. Ensuite, enregistrez votre travail, fermez toutes les fenetres Photoshop et attendez la confirmation avant de le relancer.`n`nTypeR reste utilisable en attendant. Aucun document ne sera ferme automatiquement."
        } else {
            "TypeR detected a Photoshop issue that prevents its interface from displaying normally.`n`nThe repair will request Windows administrator permission. Then save your work, close all Photoshop windows and wait for confirmation before opening it again.`n`nTypeR remains usable meanwhile. No documents will be closed automatically."
        }
        Add-Type -AssemblyName System.Windows.Forms
        [Windows.Forms.MessageBox]::Show($Notice, 'TypeR - Photoshop WebView', 'OK', 'Information', 'Button1', 'DefaultDesktopOnly') | Out-Null
        $ThisScript = $PSCommandPath
        $ScriptHash = Get-Hash $ThisScript
        $Command = '$ErrorActionPreference = ''Stop''; if ((Get-FileHash -LiteralPath ' + (Quote-RepairArgument $ThisScript) + ').Hash -ne ' + (Quote-RepairArgument $ScriptHash) + ') { throw ''Repair script changed'' }; & ' +
            (Quote-RepairArgument $ThisScript) + ' -Action Apply -WaitForExit -WaitSeconds ' + $WaitSeconds +
            ' -PhotoshopPath ' + (Quote-RepairArgument $PhotoshopPath)
        if ($ReportPath) { $Command += ' -ReportPath ' + (Quote-RepairArgument $ReportPath) }
        $Command += '; if ($?) { Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.MessageBox]::Show(' +
            (Quote-RepairArgument $(if ($French) { 'La reparation est terminee. Vous pouvez relancer Photoshop.' } else { 'Repair completed. You can open Photoshop again.' })) +
            ', ''TypeR'', ''OK'', ''Information'', ''Button1'', ''DefaultDesktopOnly'') | Out-Null }'
        $Encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Command))
        try {
            $Worker = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $Encoded) -Verb RunAs -WindowStyle Hidden -PassThru
        } catch {
            if ($_.Exception.NativeErrorCode -eq 1223 -or $_.Exception.InnerException.NativeErrorCode -eq 1223) { Write-RepairStatus 'declined' }
            else { Write-RepairStatus 'failed' $_.Exception.Message; Show-AutomaticRepairFailure }
            return
        }
        $Worker.WaitForExit()
        if ((Get-Hash $DllPath) -eq $PatchedHash) { Write-RepairStatus 'applied' }
        else { Write-RepairStatus 'failed' ('Repair worker exited without the expected DLL: ' + $Worker.ExitCode); Show-AutomaticRepairFailure }
    } catch { Write-RepairStatus 'failed' $_.Exception.Message; Show-AutomaticRepairFailure }
    finally { if ($Acquired) { $Mutex.ReleaseMutex() }; $Mutex.Dispose() }
}

$PhotoshopPath = [IO.Path]::GetFullPath($PhotoshopPath)
if (-not (Test-Path -LiteralPath $PhotoshopPath -PathType Leaf)) { throw "Photoshop not found: $PhotoshopPath" }
$DllPath = Join-Path (Split-Path -Parent $PhotoshopPath) 'dynamic-torqnative.dll'
$BackupPath = $DllPath + '.typer-original-' + $OriginalHash + '.bak'
$DisabledPath = $DllPath + '.typer-repair-disabled'
$CurrentHash = Get-Hash $DllPath
$State = if ($CurrentHash -eq $OriginalHash) { 'original-supported' } elseif ($CurrentHash -eq $PatchedHash) { 'experimental-applied' } else { 'unsupported' }
if ($Action -eq 'Inspect') {
    [pscustomobject]@{ state = $State; dll = $DllPath; sha256 = $CurrentHash; backup = $BackupPath; backupExists = (Test-Path -LiteralPath $BackupPath -PathType Leaf); automaticRepairDisabled = (Test-Path -LiteralPath $DisabledPath) }
    return
}
if ($Action -eq 'Auto') { Start-AutomaticRepair; return }
if ($State -eq 'unsupported') { throw 'Unsupported DLL hash. This experiment supports only the tested binary, not every UXP 9.3 or Photoshop 27.9 installation. Nothing changed.' }
if ($WaitForExit) {
    Write-RepairStatus 'waiting-for-photoshop'
    $Deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
    while (Get-Process -Name Photoshop -ErrorAction SilentlyContinue) {
        if ([DateTime]::UtcNow -ge $Deadline) { Write-RepairStatus 'timed-out'; throw 'Photoshop stayed open; DLL unchanged.' }
        Start-Sleep -Seconds 1
    }
}
Assert-PhotoshopClosed

if ($Action -eq 'Apply' -and $State -eq 'experimental-applied') {
    if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf) -or (Get-Hash $BackupPath) -ne $OriginalHash) { throw 'Experiment is applied, but the verified original backup is missing.' }
    Write-Output 'Experiment already applied; verified original backup available.'
    if (Test-Path -LiteralPath $DisabledPath) { Remove-Item -LiteralPath $DisabledPath -Force }
    return
}
if ($Action -eq 'Restore' -and $State -eq 'original-supported') {
    [IO.File]::WriteAllText($DisabledPath, 'Automatic TypeR WebView repair disabled by Restore. Explicit Apply re-enables it.')
    Write-Output 'Original DLL already in place.'
    return
}

# The cold branch of WebViewManager initialization normally waits for a user hash.
# When that stack-local std::string is empty, give ONLY that copy the storage name
# "typer-offline", then resume the existing locked storage constructor path.
# The user provider, licensing, createWebView null check and nonempty-hash path
# are untouched. The scope is Photoshop's WebView manager, including other plugins.
$StagePath = $DllPath + '.typer-stage-' + [Guid]::NewGuid().ToString('N')
try {
    if ($Action -eq 'Apply') {
        if (Test-Path -LiteralPath $BackupPath) {
            if ((Get-Hash $BackupPath) -ne $OriginalHash) { throw 'Existing backup has the wrong hash; refusing to overwrite it.' }
        } else {
            [IO.File]::Copy($DllPath, $BackupPath, $false)
            if ((Get-Hash $BackupPath) -ne $OriginalHash) { throw 'Backup verification failed; DLL unchanged.' }
        }
        $Bytes = [IO.File]::ReadAllBytes($DllPath)
        $Before = Convert-Hex $BeforeHex
        $After = Convert-Hex $AfterHex
        for ($i = 0; $i -lt $Before.Length; $i++) {
            if ($Bytes[$PatchOffset + $i] -ne $Before[$i]) { throw 'Original bytes do not match; DLL unchanged.' }
        }
        [Array]::Copy($After, 0, $Bytes, $PatchOffset, $After.Length)
        [IO.File]::WriteAllBytes($StagePath, $Bytes)
        $ExpectedHash = $PatchedHash
    } else {
        if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf) -or (Get-Hash $BackupPath) -ne $OriginalHash) { throw 'Verified original backup required for restore.' }
        [IO.File]::Copy($BackupPath, $StagePath, $false)
        $ExpectedHash = $OriginalHash
    }
    if ((Get-Hash $StagePath) -ne $ExpectedHash) { throw 'Staged DLL verification failed; installed DLL unchanged.' }
    Assert-PhotoshopClosed
    if ((Get-Hash $DllPath) -ne $CurrentHash) { throw 'Installed DLL changed during preparation; refusing replacement.' }
    [IO.File]::Replace($StagePath, $DllPath, [NullString]::Value)
    if ((Get-Hash $DllPath) -ne $ExpectedHash) { throw 'Installed DLL verification failed. Preserve the backup for recovery.' }
    if ($Action -eq 'Restore') {
        [IO.File]::WriteAllText($DisabledPath, 'Automatic TypeR WebView repair disabled by Restore. Explicit Apply re-enables it.')
    } elseif (Test-Path -LiteralPath $DisabledPath) { Remove-Item -LiteralPath $DisabledPath -Force }
    Write-Output "$Action succeeded. SHA256: $ExpectedHash"
    Write-Output "Original backup: $BackupPath"
    Write-RepairStatus $(if ($Action -eq 'Apply') { 'applied' } else { 'restored' })
} finally {
    if (Test-Path -LiteralPath $StagePath) { Remove-Item -LiteralPath $StagePath -Force }
}
