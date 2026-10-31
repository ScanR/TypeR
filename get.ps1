# One command install of TypeR on Windows:
#   irm https://raw.githubusercontent.com/ScanR/TypeR/master/get.ps1 | iex
# Downloads the latest release, checks it and starts its installer.
# ASCII only: "irm | iex" and Windows PowerShell 5.1 can misread other characters.
# No "exit" here: under "iex" it would close the user's window.
& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $Release = if ($env:TYPER_RELEASE_URL) { $env:TYPER_RELEASE_URL } else { 'https://github.com/ScanR/TypeR/releases/latest/download' }
    $Work = Join-Path ([IO.Path]::GetTempPath()) ('TypeR-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $Work | Out-Null
    try {
        Write-Host 'Downloading TypeR...'
        $Zip = Join-Path $Work 'TypeR.zip'
        Invoke-WebRequest -UseBasicParsing -Uri "$Release/TypeR.zip" -OutFile $Zip
        # Older releases have no checksum file
        $Expected = $null
        try {
            $Checksum = Join-Path $Work 'TypeR.zip.sha256'
            Invoke-WebRequest -UseBasicParsing -Uri "$Release/TypeR.zip.sha256" -OutFile $Checksum
            $Expected = ([IO.File]::ReadAllText($Checksum) -split '\s+')[0]
        } catch {}
        if ($Expected) {
            $Stream = [IO.File]::OpenRead($Zip)
            $Algorithm = [Security.Cryptography.SHA256]::Create()
            try { $Actual = [BitConverter]::ToString($Algorithm.ComputeHash($Stream)).Replace('-', '').ToLowerInvariant() }
            finally { $Algorithm.Dispose(); $Stream.Dispose() }
            if ($Actual -ne $Expected.ToLowerInvariant()) { throw 'The download of TypeR is damaged: run this command again.' }
        }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $Package = Join-Path $Work 'package'
        [IO.Compression.ZipFile]::ExtractToDirectory($Zip, $Package)
        # A separate process: the installer ends with "exit", and it gets a
        # console of its own instead of the pipe of "irm | iex"
        $Shell = (Get-Process -Id $PID).Path
        & $Shell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Package 'installer\install.ps1')
    } catch {
        Write-Host $_.Exception.Message -ForegroundColor Red
    } finally {
        Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
    }
}
