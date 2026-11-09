# Exercise the real patch/restore script on disposable copies, never Photoshop.
param([string]$OriginalDll, [string]$ProfileId = 'photoshop-27.9-win-x64', [switch]$Adaptive, [int]$AdaptiveOffset = -1)
$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('typer-native-storage-test-' + [Guid]::NewGuid().ToString('N'))
$testScript = Join-Path $PSScriptRoot '../installer/repair_uxp_webview_win.ps1'
$testSource = [IO.File]::ReadAllText($testScript)
# Single-quoted regex: PowerShell must not expand the catalog variable.
$testCatalogPattern = '(?s)\$RepairProfiles = @\x27\r?\n(.*?)\r?\n\x27@ \| ConvertFrom-Json'
$testMatch = [regex]::Match($testSource, $testCatalogPattern)
if (-not $testMatch.Success) { throw 'Repair profile catalog missing' }
$testProfiles = @($testMatch.Groups[1].Value | ConvertFrom-Json)
$testProfile = $testProfiles | Where-Object { $_.id -eq $ProfileId } | Select-Object -First 1
if (-not $testProfile) { throw 'Unknown test profile' }
$testOriginalHash = $testProfile.originalHash
$testPatchedHash = $testProfile.patchedHash
New-Item -ItemType Directory -Path $testRoot | Out-Null
if ($Adaptive) {
    if (-not $OriginalDll) { throw 'Adaptive tests require a PE fixture or an original DLL.' }
    # Change an unused DOS header byte in a disposable copy, forcing recognition
    # without a catalog hash. Never change the supplied original.
    $testBytes = [IO.File]::ReadAllBytes([IO.Path]::GetFullPath($OriginalDll))
    $testBytes[32] = $testBytes[32] -bxor 1
    $OriginalDll = Join-Path $testRoot 'fixture-original.dll'
    [IO.File]::WriteAllBytes($OriginalDll, $testBytes)
    $testOriginalHash = (Get-FileHash -LiteralPath $OriginalDll).Hash.ToLowerInvariant()
    $testOffset = if ($AdaptiveOffset -ge 0) { $AdaptiveOffset } else { $testProfile.offset }
    for ($i = 0; $i -lt $testProfile.after.Length; $i += 2) { $testBytes[$testOffset + $i / 2] = [Convert]::ToByte($testProfile.after.Substring($i, 2), 16) }
    $testHashAlgorithm = [Security.Cryptography.SHA256]::Create()
    try { $testPatchedHash = [BitConverter]::ToString($testHashAlgorithm.ComputeHash($testBytes)).Replace('-', '').ToLowerInvariant() }
    finally { $testHashAlgorithm.Dispose() }
    $ProfileId = 'adaptive-storage-layout-v1'
}
if (-not $OriginalDll) {
    # Exercise the unchanged installer logic on synthetic bytes, for each profile.
    $testBytes = New-Object byte[] 4096
    for ($i = 0; $i -lt $testProfile.before.Length; $i += 2) { $testBytes[256 + $i / 2] = [Convert]::ToByte($testProfile.before.Substring($i, 2), 16) }
    $OriginalDll = Join-Path $testRoot 'fixture-original.dll'
    [IO.File]::WriteAllBytes($OriginalDll, $testBytes)
    $testProfile.originalHash = (Get-FileHash -LiteralPath $OriginalDll).Hash.ToLowerInvariant()
    for ($i = 0; $i -lt $testProfile.after.Length; $i += 2) { $testBytes[256 + $i / 2] = [Convert]::ToByte($testProfile.after.Substring($i, 2), 16) }
    $testHashAlgorithm = [Security.Cryptography.SHA256]::Create()
    try { $testProfile.patchedHash = [BitConverter]::ToString($testHashAlgorithm.ComputeHash($testBytes)).Replace('-', '').ToLowerInvariant() }
    finally { $testHashAlgorithm.Dispose() }
    $testProfile.offset = 256
    $testProfile.size = 4096
    $testSource = $testSource.Replace($testMatch.Groups[1].Value, (ConvertTo-Json -InputObject $testProfiles -Depth 5))
    $testScript = Join-Path $testRoot 'repair.ps1'
    [IO.File]::WriteAllText($testScript, $testSource)
    $testOriginalHash = $testProfile.originalHash
    $testPatchedHash = $testProfile.patchedHash
}
if ((Get-FileHash -LiteralPath $OriginalDll).Hash.ToLowerInvariant() -ne $testOriginalHash) { throw 'Supply the supported ORIGINAL DLL (or its verified backup).' }
$testExe = Join-Path $testRoot 'Photoshop.exe'
$testDll = Join-Path $testRoot 'dynamic-torqnative.dll'
$testBackup = $testDll + '.typer-original-' + $testOriginalHash + '.bak'
[IO.File]::WriteAllText($testExe, 'Not an executable; test fixture only.')
[IO.File]::Copy([IO.Path]::GetFullPath($OriginalDll), $testDll)
$global:TypeRNativeStorageTestRunning = $false
# Only simulate the process guard inside this test process.
function Get-Process { param($Name, $ErrorAction) if ($global:TypeRNativeStorageTestRunning) { [pscustomobject]@{ Id = 123 } } }
function Assert-Test($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Test-DllHash { (Get-FileHash -LiteralPath $testDll).Hash.ToLowerInvariant() }
function Expect-Failure([scriptblock]$Operation, [string]$Pattern) {
    $testCaught = $false
    try { & $Operation | Out-Null } catch {
        $testCaught = $true
        Assert-Test ($_.Exception.Message -match $Pattern) ('Unexpected error: ' + $_.Exception.Message)
    }
    Assert-Test $testCaught 'Expected the operation to fail'
}
try {
    $testInspection = & $testScript -PhotoshopPath $testExe
    Assert-Test ($testInspection.state -eq 'original-supported') 'Inspect did not recognize original'
    Assert-Test ($testInspection.profile -eq $ProfileId) 'Inspect selected the wrong profile'
    Assert-Test (-not (Test-Path -LiteralPath $testBackup)) 'Inspect wrote a backup'
    $global:TypeRNativeStorageTestRunning = $true
    Expect-Failure { & $testScript -Action Apply -PhotoshopPath $testExe } 'Close Photoshop'
    Assert-Test ((Test-DllHash) -eq $testOriginalHash) 'Running guard changed DLL'
    $global:TypeRNativeStorageTestRunning = $false

    & $testScript -Action Apply -PhotoshopPath $testExe | Out-Null
    Assert-Test ((Test-DllHash) -eq $testPatchedHash) 'Apply produced wrong bytes'
    Assert-Test ((Get-FileHash -LiteralPath $testBackup).Hash.ToLowerInvariant() -eq $testOriginalHash) 'Backup was not exact'
    & $testScript -Action Apply -PhotoshopPath $testExe | Out-Null
    Assert-Test ((Test-DllHash) -eq $testPatchedHash) 'Apply is not idempotent'
    $testReport = Join-Path $testRoot 'status.json'
    & $testScript -Action Auto -PhotoshopPath $testExe -ReportPath $testReport | Out-Null
    Assert-Test ((Get-Content -LiteralPath $testReport -Raw | ConvertFrom-Json).status -eq 'applied') 'Auto did not recognize the installed repair'

    [IO.File]::Move($testBackup, $testBackup + '.held')
    Expect-Failure { & $testScript -Action Restore -PhotoshopPath $testExe } 'backup|Unsupported DLL hash'
    Expect-Failure { & $testScript -Action Apply -PhotoshopPath $testExe } 'backup|Unsupported DLL hash'
    Assert-Test ((Test-DllHash) -eq $testPatchedHash) 'Missing-backup failure changed DLL'
    [IO.File]::WriteAllText($testBackup, 'corrupted backup')
    Expect-Failure { & $testScript -Action Restore -PhotoshopPath $testExe } 'backup|Unsupported DLL hash'
    [IO.File]::Delete($testBackup)
    [IO.File]::Move($testBackup + '.held', $testBackup)

    & $testScript -Action Restore -PhotoshopPath $testExe | Out-Null
    Assert-Test ((Test-DllHash) -eq $testOriginalHash) 'Restore was not byte-identical'
    & $testScript -Action Restore -PhotoshopPath $testExe | Out-Null
    Assert-Test ((Test-DllHash) -eq $testOriginalHash) 'Restore is not idempotent'
    & $testScript -Action Auto -PhotoshopPath $testExe -ReportPath $testReport | Out-Null
    Assert-Test ((Get-Content -LiteralPath $testReport -Raw | ConvertFrom-Json).status -eq 'disabled') 'Restore must prevent automatic reapplication'
    [IO.File]::Delete($testDll + '.typer-repair-disabled')
    [IO.File]::WriteAllText($testReport, (@{status='declined'; photoshop=$testExe; repair=$testPatchedHash} | ConvertTo-Json))
    & $testScript -Action Auto -PhotoshopPath $testExe -ReportPath $testReport | Out-Null
    Assert-Test ((Test-DllHash) -eq $testOriginalHash) 'Auto retried a declined request'
    $global:TypeRNativeStorageTestRunning = $true
    Expect-Failure { & $testScript -Action Apply -WaitForExit -WaitSeconds 1 -PhotoshopPath $testExe -ReportPath $testReport } 'stayed open'
    Assert-Test ((Get-Content -LiteralPath $testReport -Raw | ConvertFrom-Json).status -eq 'timed-out') 'Waiting did not report its timeout'
    Assert-Test ((Test-DllHash) -eq $testOriginalHash) 'Waiting modified a running installation'
    $global:TypeRNativeStorageTestRunning = $false
    [IO.File]::WriteAllText($testBackup, 'corrupted backup')
    Expect-Failure { & $testScript -Action Apply -PhotoshopPath $testExe } 'backup'
    Assert-Test ((Test-DllHash) -eq $testOriginalHash) 'Corrupt-backup failure changed DLL'

    [IO.File]::WriteAllText($testDll, 'unknown build')
    $testUnknownHash = Test-DllHash
    Assert-Test ((& $testScript -PhotoshopPath $testExe).state -eq 'unsupported') 'Unknown build not identified'
    & $testScript -Action Auto -PhotoshopPath $testExe -ReportPath $testReport | Out-Null
    Assert-Test ((Get-Content -LiteralPath $testReport -Raw | ConvertFrom-Json).status -eq 'unsupported') 'Auto did not skip an unsupported build'
    Expect-Failure { & $testScript -Action Apply -PhotoshopPath $testExe } 'Unsupported DLL hash'
    Expect-Failure { & $testScript -Action Restore -PhotoshopPath $testExe } 'Unsupported DLL hash'
    Assert-Test ((Test-DllHash) -eq $testUnknownHash) 'Unknown build was modified'
    Assert-Test (@(Get-ChildItem -LiteralPath $testRoot -Filter '*.typer-stage-*').Count -eq 0) 'Staged file leaked'
    Write-Output 'PASS: inspect, process guard, apply, exact backup, idempotence, missing/corrupt backup, exact restore, unknown-build rejection, stage cleanup.'
} finally {
    # All contents were created by this test; validate the absolute directory before deletion.
    $testResolved = [IO.Path]::GetFullPath($testRoot)
    $testTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if ($testResolved.StartsWith($testTempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $testResolved) -match '^typer-native-storage-test-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $testResolved -Recurse -Force
    }
}
