param([string]$CasesPath)
$ErrorActionPreference = 'Stop'
$repairScript = Join-Path $PSScriptRoot '../installer/repair_uxp_webview_win.ps1'
$cases = [IO.File]::ReadAllText($CasesPath) | ConvertFrom-Json
foreach ($case in $cases) {
    $dll = Join-Path (Split-Path -Parent $case.exe) 'dynamic-torqnative.dll'
    $before = (Get-FileHash -LiteralPath $dll).Hash
    $result = & $repairScript -PhotoshopPath $case.exe
    if (($result.state -eq 'original-supported') -ne $case.supported) {
        throw ($case.name + ': unexpected recognition ' + ($result | ConvertTo-Json -Compress))
    }
    if ($case.supported) {
        if ($result.profile -ne 'adaptive-storage-layout-v1') { throw 'Expected structural recognition' }
    } else {
        $failed = $false
        try { & $repairScript -PhotoshopPath $case.exe -Action Apply | Out-Null }
        catch { $failed = $true }
        if (-not $failed) { throw ($case.name + ': unsafe Apply accepted') }
    }
    if ((Get-FileHash -LiteralPath $dll).Hash -ne $before) { throw ($case.name + ': DLL was modified') }
    if (@(Get-ChildItem -LiteralPath (Split-Path -Parent $case.exe) -Filter '*.bak').Count) { throw 'Read-only recognition wrote a backup' }
    Write-Output ('PASS: adaptive recognition ' + $case.name)
}
