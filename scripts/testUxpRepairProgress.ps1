# Exercise the actual save/close coordinator with fake processes, never Photoshop.
$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot '../installer/repair_uxp_webview_win.ps1'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($sourcePath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Repair script does not parse' }
foreach ($name in @('Get-RepairProgress', 'Initialize-RepairWindowTypes', 'Get-RepairWindowIcon', 'New-RepairProgressWindow', 'Update-RepairProgressWindow', 'Save-AndCloseRepairPhotoshop', 'Get-RepairPhotoshopProcesses', 'Get-RepairNotice', 'New-RepairConsentWindow', 'Restart-RepairPhotoshop')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "Missing function: $name" }
    . ([scriptblock]::Create($definition.Extent.Text))
}
function Assert-Test($condition, $message) { if (-not $condition) { throw $message } }
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('typer-repair-progress-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
$ReportPath = Join-Path $testRoot 'status.json'
$SessionId = 'test-session'
$WaitSeconds = 1
$PhotoshopPath = 'C:\Test\Photoshop.exe'
$script:events = @()
$script:answer = 'saved'
$script:answerSession = $SessionId
$script:closeSucceeds = $true
$script:process = [pscustomobject]@{ Path = $PhotoshopPath; HasExited = $false }
$script:process | Add-Member ScriptMethod Refresh {}
$script:process | Add-Member ScriptMethod CloseMainWindow {
    $script:events += 'close'
    $this.HasExited = $script:closeSucceeds
    return $script:closeSucceeds
}
function Get-Process { param($Name, $ErrorAction) if (-not $script:process.HasExited) { $script:process }; [pscustomobject]@{ Path = 'C:\Other\Photoshop.exe' } }
$script:launches = @()
$script:launchFails = $false
function Start-Process {
    param($FilePath, $WorkingDirectory, $WindowStyle, [switch]$PassThru)
    $script:launches += $FilePath
    Assert-Test ($FilePath -eq $PhotoshopPath -and $WindowStyle -eq 'Normal') 'Restart must launch the target Photoshop visibly'
    if ($script:launchFails) { throw 'Restart unavailable' }
    return [pscustomobject]@{ Id = 321 }
}
function Write-RepairStatus($status, $detail) {
    $script:events += $status
    if ($status -eq 'saving-documents') {
        [IO.File]::WriteAllText($ReportPath + '.' + $SessionId + '.response.json', (@{session=$script:answerSession; status=$script:answer; detail='save cancelled'} | ConvertTo-Json))
    }
}
function Expect-Failure([scriptblock]$operation, $pattern) {
    $caught = $false
    try { & $operation } catch { $caught = $true; Assert-Test ($_.Exception.Message -match $pattern) $_.Exception.Message }
    Assert-Test $caught 'Expected failure'
}
try {
    Save-AndCloseRepairPhotoshop
    Assert-Test (($script:events -join ',') -eq 'saving-documents,closing-photoshop,close') 'Close must follow the save acknowledgement'
    $script:events = @(); $script:process.HasExited = $false; $script:answer = 'failed'
    Expect-Failure { Save-AndCloseRepairPhotoshop } 'save cancelled'
    Assert-Test ($script:events -notcontains 'close') 'Save failure closed Photoshop'
    $script:events = @(); $script:answer = 'saved'; $script:answerSession = 'old-session'
    Expect-Failure { Save-AndCloseRepairPhotoshop } 'Save not confirmed'
    Assert-Test ($script:events -notcontains 'close') 'A stale acknowledgement closed Photoshop'
    $script:events = @(); $script:answerSession = $SessionId; $script:closeSucceeds = $false
    Expect-Failure { Save-AndCloseRepairPhotoshop } 'could not close normally'
    Assert-Test (-not $script:process.HasExited) 'Normal close failure must not kill Photoshop'
    $script:events = @(); $script:process.HasExited = $true
    $result = Restart-RepairPhotoshop
    Assert-Test ($result.status -eq 'completed' -and $script:launches.Count -eq 1) 'Verified repair should restart Photoshop'
    Assert-Test (($script:events -join ',') -eq 'restarting,completed') 'Restart status must be visible'
    $script:process.HasExited = $false
    $result = Restart-RepairPhotoshop
    Assert-Test ($result.status -eq 'completed' -and $script:launches.Count -eq 1) 'Do not start another copy of an already reopened Photoshop'
    $script:process.HasExited = $true; $script:launchFails = $true; $script:events = @()
    $result = Restart-RepairPhotoshop
    Assert-Test ($result.status -eq 'restart-failed' -and $result.detail -eq 'Restart unavailable') 'Keep repair success separate from restart failure'
    $window = New-RepairProgressWindow
    try {
        $expectedIcon = [Drawing.Icon]::new((Join-Path $PSScriptRoot '../icons/typer.ico'))
        $actualBytes = [IO.MemoryStream]::new(); $expectedBytes = [IO.MemoryStream]::new()
        try {
            $window.Form.Icon.Save($actualBytes); $expectedIcon.Save($expectedBytes)
            Assert-Test ([Convert]::ToBase64String($actualBytes.ToArray()) -eq [Convert]::ToBase64String($expectedBytes.ToArray())) 'Repair must use the TypeR icon'
        } finally { $expectedIcon.Dispose(); $actualBytes.Dispose(); $expectedBytes.Dispose() }
        Assert-Test (-not $window.Progress.Finished) 'Progress must animate while duration is unknown'
        foreach ($state in @('preparing', 'saving-documents', 'closing-photoshop', 'waiting-for-photoshop', 'backing-up', 'repairing', 'verifying', 'restarting')) {
            Update-RepairProgressWindow $window $state
            Assert-Test ($window.Label.Text.Length -gt 12) "Missing progress text: $state"
        }
        Update-RepairProgressWindow $window 'completed' -Finished
        Assert-Test ($window.Progress.Successful -and $window.Progress.Finished -and $window.Progress.Stage -eq 5) 'Success must complete every stage'
        Update-RepairProgressWindow $window 'restart-failed' -Finished
        Assert-Test (-not $window.Progress.Successful -and $window.Progress.Stage -eq 4) 'A restart failure must keep completed repair stages without marking restart complete'
        Update-RepairProgressWindow $window 'failed' 'disk full' -Finished
        Assert-Test (-not $window.Progress.Successful -and $window.Label.Text.Contains('disk full')) 'Failure must be visible and never show complete'
        $french = Get-RepairProgress 'applied' $true
        Assert-Test ($french.Text.Contains([string][char]0xE9)) 'French accents were lost'
        $bytes = [IO.File]::ReadAllBytes($sourcePath)
        Assert-Test ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) 'Windows PowerShell needs the UTF-8 BOM for French messages'
    } finally { $window.Form.Dispose() }
    $consentWindow = New-RepairConsentWindow $true
    try {
        Assert-Test ($consentWindow.Button.DialogResult -eq 'OK' -and $consentWindow.Form.CancelButton.DialogResult -eq 'Cancel') 'Consent must offer explicit repair and cancellation'
        Assert-Test ((Get-RepairNotice $false $true).Contains('restart Photoshop automatically')) 'Notice must explain automatic restart'
        Assert-Test ((Get-RepairNotice $false $false).Contains('Save your documents and close Photoshop')) 'Standalone repair must keep the manual save instruction'
        # Verify the actual click path, without showing a window on the user desktop.
        $consentWindow.Form.StartPosition = 'Manual'
        $consentWindow.Form.Location = New-Object Drawing.Point(-10000, -10000)
        $consentWindow.Form.ShowInTaskbar = $false
        $consentWindow.Form.Add_Shown({ param($sender, $eventArgs) $sender.Controls | Where-Object { $_ -is [Windows.Forms.Button] -and $_.DialogResult -eq 'OK' } | ForEach-Object { $_.PerformClick() } })
        Assert-Test ($consentWindow.Form.ShowDialog() -eq 'OK') 'Repair button must return consent rather than closing as Cancel'
    } finally { $consentWindow.Form.Dispose() }
    Write-Output 'PASS: save acknowledgement, cancellation, normal close, restart success/failure, modern progress, consent and French encoding.'
} finally {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $allowed = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolved) -match '^typer-repair-progress-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
