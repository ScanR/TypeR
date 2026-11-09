# TypeR's WebView storage repair: exact hashes or a fully recognized x64 layout.
# Inspect is read-only. Auto is called ONLY after the plugin observes UXP's
# missing-storage refusal; it requests UAC, saves through the host and requests a normal exit.
[CmdletBinding()]
param(
    [ValidateSet('Inspect', 'Apply', 'Restore', 'Auto')][string]$Action = 'Inspect',
    [string]$PhotoshopPath = 'C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe',
    [string]$ReportPath,
    [ValidatePattern('^[a-z0-9-]{1,80}$')][string]$SessionId,
    [switch]$WaitForExit,
    [ValidateRange(1, 86400)][int]$WaitSeconds = 86400,
    [switch]$Retry
)

$ErrorActionPreference = 'Stop'
# Exact binaries supplied for analysis; version strings alone never authorize a write.
$RepairProfiles = @'
[
  {
    "id": "photoshop-27.7-win-x64",
    "uxp": "9.3.0",
    "originalHash": "2a57cb50444945b9d3a7f05b5ee40970930e31dd80e5de132a026e1068b7cded",
    "patchedHash": "5dedd8c31986a87e18b29aac41d51fd70264bbba1762383e1a0bfcd6365acc22",
    "size": 60509168,
    "offset": 37673245,
    "before": "4889742428ff1570c48e0185c07507ff1566df8e01cc837c242000742a48897c2430c744243804000000488d4c",
    "after": "c744244874797065c744244c722d6f66c7442450666c696e66c7442454650048c74424580d000000e9d6feffff",
    "functionRva": 37675984,
    "functionOffset": 37672912,
    "functionSize": 640,
    "functionHash": "74356c4f093c1d50f9d3a5d08ca1ea94eeb1cecbdb23d137c8e81f0514542dd6"
  },
  {
    "id": "photoshop-27.9-win-x64",
    "uxp": "9.3.0",
    "originalHash": "cded92ca1e7563126e1433ecbca50cb9a8e141f48a15d1a4c6739c44f8d9f714",
    "patchedHash": "c2974a41e0a479fb588308f500e6548870fa758115b3f5c16beb523ebec78440",
    "size": 60509168,
    "offset": 37673245,
    "before": "4889742428ff1570c48e0185c07507ff1566df8e01cc837c242000742a48897c2430c744243804000000488d4c",
    "after": "c744244874797065c744244c722d6f66c7442450666c696e66c7442454650048c74424580d000000e9d6feffff",
    "functionRva": 37675984,
    "functionOffset": 37672912,
    "functionSize": 640,
    "functionHash": "74356c4f093c1d50f9d3a5d08ca1ea94eeb1cecbdb23d137c8e81f0514542dd6"
  },
  {
    "id": "photoshop-27.10-win-x64",
    "uxp": "9.4.1",
    "originalHash": "45c7e9b7c4512f2322bbc7ba7c5efb1786a51f666977ce2da511d9ce6473ca2a",
    "patchedHash": "951afe306f43e8849532ac5d28d19e01e91121f1dc775b0bc7a63d36fcb01aef",
    "size": 89971184,
    "offset": 61662589,
    "before": "4889742428ff159006e30185c07507ff152e27e301cc837c242000742a48897c2430c744243804000000488d4c",
    "after": "c744244874797065c744244c722d6f66c7442450666c696e66c7442454650048c74424580d000000e9d6feffff",
    "functionRva": 61665328,
    "functionOffset": 61662256,
    "functionSize": 640,
    "functionHash": "27a6096dc9c8459b47f8a3c2d388287a9a79a3d8e1fa935c27d3492db7af37f0"
  }
]
'@ | ConvertFrom-Json

function Get-Hash([string]$Path) {
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Convert-Hex([string]$Hex) {
    [byte[]]$Bytes = for ($i = 0; $i -lt $Hex.Length; $i += 2) { [Convert]::ToByte($Hex.Substring($i, 2), 16) }
    return ,$Bytes
}
$StorageLayouts = @'
[
  {
    "name": "storage-initializer",
    "bytes": "48895c24104889742418574883ec70488b05000000004833c44889442468488bf1e800000000488b10488d4c2448e80000000090488d7e104533c94c8d44242033d2488bcf48395424580f84fd000000ff150000000085c07507ff1500000000cc837c2420000f842801000048897c2430c744243804000000b950000000e80000000048894424284885c07412488d542448488bc8e800000000488bd8eb0233db488d4e50488d442440483bc8740a488bd3e800000000eb644885db745f488d4b20e800000000488b53184883fa10722c488b0b48ffc24881fa0010000072184883c2274c8b41f8492bc8488d41f84883f81f7751498bc8e80000000048c743100000000048c743180f000000c60300ba50000000488bcbe800000000488bcee800000000488bcee800000000904533c033d2488bcfff150000000085c00f84b5000000eb4eff1500000000904889742428ff150000000085c07507ff1500000000cc837c242000742a48897c2430c744243804000000488d4c2428e800000000904533c033d2488bcfff150000000085c0745f488b5424604883fa10723548ffc2488b4c2448488bc14881fa00100000721c4883c227488b49f8482bc14883c0f84883f81f7607ff1500000000cce800000000488b4c24684833cce8000000004c8d5c2470498b5b18498b7320498be35fc3e80000000090e800000000cc",
    "relocations": [
      {"offset": 18, "kind": "data", "next": 22},
      {"offset": 34, "kind": "call", "next": 38},
      {"offset": 47, "kind": "call", "next": 51},
      {"offset": 82, "kind": "iat", "next": 86, "name": "InitOnceBeginInitialize"},
      {"offset": 92, "kind": "iat", "next": 96, "name": "abort"},
      {"offset": 127, "kind": "call", "next": 131},
      {"offset": 150, "kind": "call", "next": 154},
      {"offset": 179, "kind": "call", "next": 183},
      {"offset": 195, "kind": "call", "next": 199},
      {"offset": 249, "kind": "call", "next": 253},
      {"offset": 281, "kind": "call", "next": 285},
      {"offset": 289, "kind": "call", "next": 293},
      {"offset": 297, "kind": "call", "next": 301},
      {"offset": 312, "kind": "iat", "next": 316, "name": "InitOnceComplete"},
      {"offset": 328, "kind": "iat", "next": 332, "name": "_invalid_parameter_noinfo_noreturn"},
      {"offset": 340, "kind": "iat", "next": 344, "name": "InitOnceBeginInitialize"},
      {"offset": 350, "kind": "iat", "next": 354, "name": "abort"},
      {"offset": 381, "kind": "call", "next": 385},
      {"offset": 396, "kind": "iat", "next": 400, "name": "InitOnceComplete"},
      {"offset": 458, "kind": "iat", "next": 462, "name": "_invalid_parameter_noinfo_noreturn"},
      {"offset": 464, "kind": "call", "next": 468},
      {"offset": 477, "kind": "call", "next": 481},
      {"offset": 500, "kind": "call", "next": 504},
      {"offset": 506, "kind": "call", "next": 510}
    ]
  },
  {
    "name": "storage-constructor",
    "bytes": "48895c24185556574883ec70488b05000000004833c44889442468488bf148894c2420e80000000090488d7e200f57c00f110733ed48896f1048c747180700000066892f488d4e40e800000000e800000000488b180f57c00f114424280f57c9f30f7f4c2438448d4507488d1500000000488d4c2428e800000000904c8d4c24284533c0488d542448488bcbe800000000488bd8483bf87467488b57184883fa087231488b0f488d1455020000004881fa0010000072184883c2274c8b41f8492bc8488d41f84883f81f776d498bc8e80000000048896f1048c747180700000066892f0f10030f11070f104b100f114f1048896b1048c743180700000066892b488b5424604883fa08723a488d145502000000488b4c2448488bc14881fa00100000721c4883c227488b49f8482bc14883c0f84883f81f7607ff1500000000cce800000000660f6f0500000000f30f7f44245866896c2448488b5424404883fa08723b488d145502000000488b4c2428488bc14881fa00100000721c4883c227488b49f8482bc14883c0f84883f81f7607ff1500000000cce80000000090488bc6488b4c24684833cce800000000488b9c24a00000004883c4705f5e5dc3",
    "relocations": [
      {"offset": 15, "kind": "data", "next": 19},
      {"offset": 36, "kind": "call", "next": 40},
      {"offset": 73, "kind": "call", "next": 77},
      {"offset": 78, "kind": "call", "next": 82},
      {"offset": 109, "kind": "data", "next": 113, "literalHex": "57006500620056006900650077000000"},
      {"offset": 119, "kind": "call", "next": 123},
      {"offset": 141, "kind": "call", "next": 145},
      {"offset": 208, "kind": "call", "next": 212},
      {"offset": 315, "kind": "iat", "next": 319, "name": "_invalid_parameter_noinfo_noreturn"},
      {"offset": 321, "kind": "call", "next": 325},
      {"offset": 329, "kind": "data", "next": 333},
      {"offset": 403, "kind": "iat", "next": 407, "name": "_invalid_parameter_noinfo_noreturn"},
      {"offset": 409, "kind": "call", "next": 413},
      {"offset": 426, "kind": "call", "next": 430}
    ]
  },
  {
    "name": "string-copy",
    "bytes": "48895c2408488974241048897c241841564883ec2033c00f57c00f1101488941104c8bf248894118488bd948837a1810488b721072034c8b3248bfffffffffffffff7f483bf7777548c741180f0000004883fe10730d48897110410f10060f1101eb41488bc64883c80f483bc7770fb916000000488bf8483bc1480f42f9488d5701488bcbe8000000004c8d4601488903498bd648897310488bc848897b18e800000000488b742438488bc3488b5c2430488b7c24404883c420415ec3e800000000cc",
    "relocations": [
      {"offset": 134, "kind": "call", "next": 138},
      {"offset": 160, "kind": "call", "next": 164},
      {"offset": 190, "kind": "call", "next": 194}
    ]
  },
  {
    "name": "user-info-provider",
    "bytes": "405356574883ec2033f68b0d0000000065488b042558000000ba9c020000488b0cc88b040a3905000000007f49488d05000000004883c4205f5e5bc3488d47104889050000000048893d00000000488d0d00000000e80000000090488d0d00000000e800000000488d05000000004883c4205f5e5bc3488d0d00000000e800000000833d00000000ff75a2b998000000e800000000488bf848894424404885c074780f57c00f1100c7400801000000c7400c01000000488d0500000000488907488d471048894424480f11004889701048c740180f000000c60000488d582048895c245048893348897308b958000000e80000000048890048894008488903897310c6431400488d4b18ba02010000e80000000090e922ffffff488bfee91affffffcc",
    "relocations": [
      {"offset": 12, "kind": "data", "next": 16},
      {"offset": 39, "kind": "data", "next": 43},
      {"offset": 48, "kind": "data", "next": 52},
      {"offset": 67, "kind": "data", "next": 71},
      {"offset": 74, "kind": "data", "next": 78},
      {"offset": 81, "kind": "data", "next": 85},
      {"offset": 86, "kind": "call", "next": 90},
      {"offset": 94, "kind": "data", "next": 98},
      {"offset": 99, "kind": "call", "next": 103},
      {"offset": 106, "kind": "data", "next": 110},
      {"offset": 121, "kind": "data", "next": 125},
      {"offset": 126, "kind": "call", "next": 130},
      {"offset": 132, "kind": "data", "next": 137},
      {"offset": 145, "kind": "call", "next": 149},
      {"offset": 185, "kind": "data", "next": 189},
      {"offset": 241, "kind": "call", "next": 245},
      {"offset": 272, "kind": "call", "next": 276}
    ]
  }
]
'@ | ConvertFrom-Json

# Relocation-tolerant recognition of four complete reviewed x64 functions.
# Every opcode, stack offset, size and internal branch is exact. Only linker
# displacements vary; their destinations, imports and relationships are checked.
function Get-BytesHash([byte[]]$Bytes) {
    $Hasher = [Security.Cryptography.SHA256]::Create()
    try { [BitConverter]::ToString($Hasher.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $Hasher.Dispose() }
}
function Read-U32([byte[]]$Bytes, [long]$Offset) {
    if ($Offset -lt 0 -or $Offset + 4 -gt $Bytes.LongLength) { throw 'Truncated PE' }
    [BitConverter]::ToUInt32($Bytes, [int]$Offset)
}
function New-RepairImage([byte[]]$Bytes) {
    if ($Bytes.Length -lt 256 -or $Bytes[0] -ne 77 -or $Bytes[1] -ne 90) { throw 'Not a PE image' }
    $Pe = Read-U32 $Bytes 60
    if ((Read-U32 $Bytes $Pe) -ne 17744 -or [BitConverter]::ToUInt16($Bytes, $Pe + 4) -ne 34404) { throw 'Not an x64 PE' }
    $Count = [BitConverter]::ToUInt16($Bytes, $Pe + 6)
    $OptionalSize = [BitConverter]::ToUInt16($Bytes, $Pe + 20)
    $Optional = $Pe + 24
    if ($Count -lt 1 -or $Count -gt 96 -or $OptionalSize -lt 144 -or [BitConverter]::ToUInt16($Bytes, $Optional) -ne 523) { throw 'Unsupported PE headers' }
    if (([BitConverter]::ToUInt16($Bytes, $Pe + 22) -band 8192) -eq 0) { throw 'Not a DLL' }
    if ((Read-U32 $Bytes ($Optional + 108)) -lt 4) { throw 'Missing PE directories' }
    $Sections = @()
    for ($Index = 0; $Index -lt $Count; $Index++) {
        $Header = $Optional + $OptionalSize + $Index * 40
        $Section = @{ rva = [long](Read-U32 $Bytes ($Header + 12)); virtualSize = [long](Read-U32 $Bytes ($Header + 8)); size = [long](Read-U32 $Bytes ($Header + 16)); offset = [long](Read-U32 $Bytes ($Header + 20)); flags = (Read-U32 $Bytes ($Header + 36)) }
        if ($Section.offset + $Section.size -gt $Bytes.LongLength -or $Section.rva + [Math]::Max($Section.size, $Section.virtualSize) -gt 4294967296) { throw 'Invalid PE section' }
        $Sections += $Section
    }
    return @{ bytes = $Bytes; sections = $Sections; imports = (Read-U32 $Bytes ($Optional + 120)); importSize = (Read-U32 $Bytes ($Optional + 124)); exceptions = (Read-U32 $Bytes ($Optional + 136)); exceptionSize = (Read-U32 $Bytes ($Optional + 140)); importCache = @{} }
}
function Resolve-RepairRva($Image, [long]$Rva, [int]$Length = 1, [switch]$Executable, [switch]$Virtual) {
    $Matches = @($Image.sections | Where-Object { $Rva -ge $_.rva -and $Rva + $Length -le $_.rva + $(if ($Virtual) { [Math]::Max($_.size, $_.virtualSize) } else { $_.size }) })
    if ($Length -lt 1 -or $Matches.Count -ne 1 -or ($Executable -and ($Matches[0].flags -band 536870912) -eq 0)) { throw 'Invalid code/data RVA' }
    return [int]($Matches[0].offset + $Rva - $Matches[0].rva)
}
function Get-RepairImport($Image, [long]$Slot) {
    if ($Image.importCache.ContainsKey($Slot)) { return $Image.importCache[$Slot] }
    $null = Resolve-RepairRva $Image $Slot 8
    $Start = Resolve-RepairRva $Image $Image.imports $Image.importSize
    for ($At = $Start; $At + 20 -le $Start + $Image.importSize; $At += 20) {
        $Lookup = Read-U32 $Image.bytes $At
        $First = Read-U32 $Image.bytes ($At + 16)
        if (-not $First) { break }
        $Delta = $Slot - $First
        if ($Delta -lt 0 -or $Delta % 8 -ne 0 -or $Delta -gt 524288 -or -not $Lookup) { continue }
        $Valid = $true
        for ($Index = 0; $Index -le $Delta / 8; $Index++) {
            $Thunk = Resolve-RepairRva $Image ($Lookup + $Index * 8) 8
            $Name = [BitConverter]::ToUInt64($Image.bytes, $Thunk)
            if ($Name -eq 0) { $Valid = $false; break }
        }
        if (-not $Valid -or $Name -gt [uint32]::MaxValue) { continue }
        $NameOffset = Resolve-RepairRva $Image ([long]$Name + 2) 1
        $End = $NameOffset
        while ($End -lt $Image.bytes.Length -and $End - $NameOffset -lt 256 -and $Image.bytes[$End] -ne 0) { $End++ }
        if ($End -ge $Image.bytes.Length -or $End - $NameOffset -ge 256) { throw 'Invalid import name' }
        $Result = [Text.Encoding]::ASCII.GetString($Image.bytes, $NameOffset, $End - $NameOffset)
        $Image.importCache[$Slot] = $Result
        return $Result
    }
    throw 'Unresolved import slot'
}
function Resolve-RepairCall($Image, [long]$Rva) {
    for ($Hop = 0; $Hop -lt 8; $Hop++) {
        $Offset = Resolve-RepairRva $Image $Rva 5 -Executable
        if ($Image.bytes[$Offset] -ne 233) { return $Rva }
        $Rva = $Rva + 5 + [BitConverter]::ToInt32($Image.bytes, $Offset + 1)
    }
    throw 'Unexpected call trampoline chain'
}
function New-LayoutPattern($Template) {
    $Parts = New-Object 'System.Collections.Generic.List[string]'
    $Relocations = @{}
    foreach ($Relocation in $Template.relocations) { $Relocations[[int]$Relocation.offset] = $true }
    for ($Index = 0; $Index -lt $Template.bytes.Length / 2; $Index++) {
        if ($Relocations.ContainsKey($Index)) { $Parts.Add('.{4}'); $Index += 3 }
        else { $Parts.Add('\x' + $Template.bytes.Substring($Index * 2, 2)) }
    }
    return ($Parts -join '')
}
function Test-RepairFunction($Image, [long]$Rva, $Template) {
    $Length = $Template.bytes.Length / 2
    $Offset = Resolve-RepairRva $Image $Rva $Length -Executable
    $Latin = [Text.Encoding]::GetEncoding(28591)
    $Pattern = '\A' + (New-LayoutPattern $Template) + '\z'
    if (-not [regex]::IsMatch($Latin.GetString($Image.bytes, $Offset, $Length), $Pattern, [Text.RegularExpressions.RegexOptions]::Singleline)) { throw 'Function layout changed' }
    # Exact RUNTIME_FUNCTION start/end: never patch an instruction sequence
    # embedded in data, or a fragment of a different function.
    $Table = Resolve-RepairRva $Image $Image.exceptions $Image.exceptionSize
    if ($Image.exceptionSize % 12 -ne 0) { throw 'Invalid exception table' }
    $Needle = $Latin.GetString([BitConverter]::GetBytes([uint32]$Rva) + [BitConverter]::GetBytes([uint32]($Rva + $Length)))
    $TableText = $Latin.GetString($Image.bytes, $Table, $Image.exceptionSize)
    $Position = $TableText.IndexOf($Needle, [StringComparison]::Ordinal)
    if ($Position -lt 0 -or $Position % 12 -ne 0 -or $Position + 12 -gt $Image.exceptionSize) { throw 'Function boundary changed' }
    $Unwind = Read-U32 $Image.bytes ($Table + $Position + 8)
    $UnwindOffset = Resolve-RepairRva $Image $Unwind 4
    if (($Image.bytes[$UnwindOffset] -band 7) -ne 1) { throw 'Unsupported unwind format' }
    $Targets = @{}
    foreach ($Relocation in $Template.relocations) {
        $Target = $Rva + $Relocation.next + [BitConverter]::ToInt32($Image.bytes, $Offset + $Relocation.offset)
        if ($Relocation.kind -eq 'call') { $Target = Resolve-RepairCall $Image $Target }
        elseif ($Relocation.kind -eq 'iat') {
            if ((Get-RepairImport $Image $Target) -cne $Relocation.name) { throw 'Imported function changed' }
        } else {
            $null = Resolve-RepairRva $Image $Target 1 -Virtual
            if ($Relocation.literalHex) {
                $Literal = Convert-Hex $Relocation.literalHex
                $LiteralOffset = Resolve-RepairRva $Image $Target $Literal.Length
                for ($Index = 0; $Index -lt $Literal.Length; $Index++) { if ($Image.bytes[$LiteralOffset + $Index] -ne $Literal[$Index]) { throw 'Storage path literal changed' } }
            }
        }
        $Targets[[int]$Relocation.offset] = $Target
    }
    return $Targets
}
function Find-AdaptiveRepair([byte[]]$Bytes) {
    $Image = New-RepairImage $Bytes
    $Pattern = New-LayoutPattern $StorageLayouts[0]
    $Regex = [regex]::new($Pattern, [Text.RegularExpressions.RegexOptions]::Singleline, [TimeSpan]::FromSeconds(5))
    $Candidates = @()
    foreach ($Section in $Image.sections) {
        if (($Section.flags -band 536870912) -eq 0 -or -not $Section.size) { continue }
        $Text = [Text.Encoding]::GetEncoding(28591).GetString($Bytes, $Section.offset, $Section.size)
        foreach ($Match in $Regex.Matches($Text)) {
            $Candidates += @{ rva = $Section.rva + $Match.Index; offset = $Section.offset + $Match.Index }
            if ($Candidates.Count -gt 1) { throw 'Ambiguous storage initializer' }
        }
    }
    if ($Candidates.Count -ne 1) { throw 'Storage initializer layout not recognized' }
    $Candidate = $Candidates[0]
    $Main = Test-RepairFunction $Image $Candidate.rva $StorageLayouts[0]
    $Constructor = Test-RepairFunction $Image $Main[150] $StorageLayouts[1]
    $null = Test-RepairFunction $Image $Main[47] $StorageLayouts[2]
    $null = Test-RepairFunction $Image $Main[34] $StorageLayouts[3]
    if ($Constructor[36] -ne $Main[47] -or $Constructor[15] -ne $Main[18] -or $Main[249] -ne $Main[281] -or $Main[249] -ne $Main[464] -or $Main[500] -ne $Main[506]) { throw 'Storage call relationships changed' }
    $Offset = [int]$Candidate.offset + 333
    $After = Convert-Hex $RepairProfiles[0].after
    $Before = New-Object byte[] $After.Length
    [Array]::Copy($Bytes, $Offset, $Before, 0, $Before.Length)
    $OriginalHash = Get-BytesHash $Bytes
    try {
        [Array]::Copy($After, 0, $Bytes, $Offset, $After.Length)
        $PatchedHash = Get-BytesHash $Bytes
    } finally { [Array]::Copy($Before, 0, $Bytes, $Offset, $Before.Length) }
    return [pscustomobject]@{ id = 'adaptive-storage-layout-v1'; uxp = 'recognized-x64-layout'; originalHash = $OriginalHash; patchedHash = $PatchedHash; offset = $Offset; size = $Bytes.Length; before = [BitConverter]::ToString($Before).Replace('-', '').ToLowerInvariant(); after = $RepairProfiles[0].after }
}
function Resolve-AdaptiveRepair([string]$Path, [string]$Hash) {
    try {
        $Found = Find-AdaptiveRepair ([IO.File]::ReadAllBytes($Path))
        if ($Found.originalHash -eq $Hash) { return $Found }
    } catch { $script:RecognitionDetail = $_.Exception.Message }
    # A patched adaptive binary is accepted only with its exact original backup.
    # Re-analyze that backup; never trust a receipt or a stored arbitrary offset.
    $Folder = Split-Path -Parent $Path
    $Prefix = [IO.Path]::GetFileName($Path) + '.typer-original-'
    foreach ($Backup in Get-ChildItem -LiteralPath $Folder -Filter ($Prefix + '*.bak') -File) {
        if ($Backup.Name -notmatch ('^' + [regex]::Escape($Prefix) + '([a-f0-9]{64})\.bak$')) { continue }
        $BackupHash = $Matches[1]
        if ((Get-Hash $Backup.FullName) -ne $BackupHash) { continue }
        try {
            $Found = Find-AdaptiveRepair ([IO.File]::ReadAllBytes($Backup.FullName))
            if ($Found.originalHash -eq $BackupHash -and $Found.patchedHash -eq $Hash) { $script:RecognitionDetail = ''; return $Found }
        } catch {}
    }
    return $null
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
    $Receipt = @{ status = $Status; detail = $Detail; session = $SessionId; photoshop = $PhotoshopPath; repair = $PatchedHash; original = $OriginalHash; observed = $CurrentHash; profile = $(if ($Profile) { $Profile.id } else { $null }); time = [DateTime]::UtcNow.ToString('o') }
    $ReceiptStage = $ReportPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllText($ReceiptStage, ($Receipt | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
        if (Test-Path -LiteralPath $ReportPath) { [IO.File]::Replace($ReceiptStage, $ReportPath, [NullString]::Value) }
        else { [IO.File]::Move($ReceiptStage, $ReportPath) }
    } finally { if (Test-Path -LiteralPath $ReceiptStage) { Remove-Item -LiteralPath $ReceiptStage -Force } }
}
function Quote-RepairArgument([string]$Value) { "'" + $Value.Replace("'", "''") + "'" }
function Get-RepairProgress([string]$Status, [bool]$French) {
    $Messages = @{
        preparing = @('Autorisez la réparation dans la demande Windows.', 'Allow the repair in the Windows permission prompt.')
        'saving-documents' = @('Enregistrement des documents. Complétez les fenêtres Enregistrer sous dans Photoshop.', 'Saving documents. Complete any Save As dialogs in Photoshop.')
        'closing-photoshop' = @('Fermeture de Photoshop. Si une boîte de dialogue est ouverte, terminez-la dans Photoshop.', 'Closing Photoshop. Complete any open dialog in Photoshop.')
        'waiting-for-photoshop' = @('Fermez les autres fenêtres Photoshop pour continuer.', 'Close the remaining Photoshop windows to continue.')
        'backing-up' = @('Sauvegarde du fichier Photoshop original...', 'Backing up the original Photoshop file...')
        repairing = @('Réparation de Photoshop...', 'Repairing Photoshop...')
        verifying = @('Vérification de la réparation...', 'Verifying the repair...')
        applied = @('Réparation vérifiée. Photoshop va redémarrer.', 'Repair verified. Photoshop will restart.')
        restarting = @('Redémarrage de Photoshop. Encore un instant...', 'Restarting Photoshop. Just a moment...')
        completed = @('Photoshop a été relancé. Vous pouvez retrouver TypeR dans le menu Plug-ins.', 'Photoshop has been launched. Open TypeR from the Plugins menu.')
        'restart-failed' = @('La réparation est terminée, mais Photoshop n''a pas pu redémarrer. Ouvrez-le manuellement.', 'Repair completed, but Photoshop could not restart. Open it manually.')
        failed = @('Réparation arrêtée. Consultez le détail ci-dessous.', 'Repair stopped. See the details below.')
        declined = @('Réparation annulée. Photoshop reste disponible.', 'Repair cancelled. Photoshop remains available.')
        'timed-out' = @('Photoshop est resté ouvert. La réparation est arrêtée.', 'Photoshop remained open. The repair has stopped.')
    }
    $Index = if ($French) { 0 } else { 1 }
    $Text = if ($Messages.ContainsKey($Status)) { $Messages[$Status][$Index] } else { $Status }
    $Stages = @{ preparing = 0; 'saving-documents' = 1; 'closing-photoshop' = 2; 'waiting-for-photoshop' = 2; 'backing-up' = 3; repairing = 3; verifying = 3; applied = 4; restarting = 4; completed = 5; 'restart-failed' = 4 }
    $Stage = if ($Stages.ContainsKey($Status)) { $Stages[$Status] } else { 0 }
    $Titles = if ($French) { @('Préparation', 'Enregistrement', 'Fermeture de Photoshop', 'Réparation', 'Redémarrage', 'Tout est prêt') }
        else { @('Getting ready', 'Saving your work', 'Closing Photoshop', 'Repairing', 'Restarting', 'All set') }
    $Title = $Titles[$Stage]
    if ($Status -eq 'restart-failed') { $Title = if ($French) { 'Réparation terminée' } else { 'Repair complete' } }
    elseif ($Status -in @('failed', 'timed-out')) { $Title = if ($French) { 'La réparation s''est arrêtée' } else { 'Repair stopped' } }
    elseif ($Status -eq 'declined') { $Title = if ($French) { 'Réparation annulée' } else { 'Repair cancelled' } }
    return [pscustomobject]@{ Text = $Text; Title = $Title; Stage = $Stage; Complete = ($Status -eq 'completed') }
}
function Initialize-RepairWindowTypes {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    if ('TypeRRepairTrack' -as [type]) { return }
    Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public sealed class TypeRRepairWindow : Form {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
    public static void Drag(Form window) { ReleaseCapture(); SendMessage(window.Handle, 0xA1, new IntPtr(2), IntPtr.Zero); }
    public TypeRRepairWindow() { SetCurrentProcessExplicitAppUserModelID("ScanR.TypeR.Repair"); DoubleBuffered = true; }
    protected override void Dispose(bool disposing) {
        var ownedIcon = disposing ? Icon : null;
        base.Dispose(disposing);
        if (ownedIcon != null) ownedIcon.Dispose();
    }
    protected override CreateParams CreateParams {
        get { var cp = base.CreateParams; cp.ClassStyle |= 0x20000; return cp; }
    }
    protected override void OnResize(EventArgs e) {
        base.OnResize(e);
        if (Width < 32 || Height < 32) return;
        using (var shape = new GraphicsPath()) {
            shape.AddArc(0, 0, 24, 24, 180, 90);
            shape.AddArc(Width - 24, 0, 24, 24, 270, 90);
            shape.AddArc(Width - 24, Height - 24, 24, 24, 0, 90);
            shape.AddArc(0, Height - 24, 24, 24, 90, 90);
            shape.CloseFigure();
            var old = Region;
            Region = new Region(shape);
            if (old != null) old.Dispose();
        }
    }
}
public sealed class TypeRRepairTrack : Control {
    private readonly Timer timer = new Timer();
    private float phase;
    public int Stage { get; set; }
    public bool Finished { get; set; }
    public bool Successful { get; set; }
    public bool French { get; set; }
    public TypeRRepairTrack() {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        timer.Interval = 30;
        timer.Tick += delegate { phase = (phase + 0.015f) % 1f; if (!Finished && Visible) Invalidate(); };
        timer.Start();
    }
    protected override void Dispose(bool disposing) { if (disposing) timer.Dispose(); base.Dispose(disposing); }
    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e);
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        float scale = Width / 540f;
        g.ScaleTransform(scale, scale);
        var accent = Color.FromArgb(165, 147, 255);
        var muted = Color.FromArgb(108, 111, 128);
        var green = Color.FromArgb(102, 216, 177);
        using (var track = new Pen(Color.FromArgb(49, 51, 67), 5)) {
            track.StartCap = track.EndCap = LineCap.Round;
            g.DrawLine(track, 4, 8, 536, 8);
        }
        if (Finished && Successful) {
            using (var fill = new Pen(green, 5)) { fill.StartCap = fill.EndCap = LineCap.Round; g.DrawLine(fill, 4, 8, 536, 8); }
        } else if (!Finished) {
            // A moving highlight signals activity; this never invents a percentage.
            float left = 4 + phase * 432;
            using (var fill = new Pen(accent, 5)) { fill.StartCap = fill.EndCap = LineCap.Round; g.DrawLine(fill, left, 8, left + 100, 8); }
        }
        string[] labels = French ? new[] { "Enregistrer", "Fermer", "Réparer", "Relancer" } : new[] { "Save", "Close", "Repair", "Restart" };
        using (var font = new Font("Segoe UI", 9f))
        using (var format = new StringFormat { Alignment = StringAlignment.Center }) {
            for (int i = 0; i < 4; i++) {
                float x = 67 + i * 135;
                bool done = Successful || Stage > i + 1;
                var color = done ? green : (!Finished && Stage == i + 1 ? accent : muted);
                using (var brush = new SolidBrush(color)) {
                    g.FillEllipse(brush, x - 3, 33, 6, 6);
                    g.DrawString(labels[i], font, brush, new RectangleF(x - 66, 48, 132, 24), format);
                }
            }
        }
    }
}
'@
}
function Get-RepairWindowIcon {
    # Embedded so standalone repair and every CCX route use the same TypeR icon.
    $Encoded = 'AAABAAEAQEAQAAAAAABoCgAAFgAAACgAAABAAAAAgAAAAAEABAAAAAAAAAoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACAAAAAgIAAgAAAAIAAgACAgAAAgICAAMDAwAAAAP8AAP8AAAD//wD/AAAA/wD/AP//AAD///8AAAAAAAAAAAAAB4iIcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHiIiHcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIiIiHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeIiIiHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHiIiIhwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeIiIiIcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHiIiIiHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeIiIiIhwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHiIiIiIcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeIiIiIiAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIiIiIiIcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeIiIiIiId3cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB3eIiIiIiIiIiHd3cAAAAAAAAAAAAAAAAAAAAAAAAAd4iIiIiIiIiIiIiIiHcAAAAAAAAAAAAAAAAAAAAAB3iIiIiIiIiIiIiIiIiIiIcAAAAAAAAAAAAAAAAAAAd4iIiIiIiIiIiIiIiIiIiIiHcAAAAAAAAAAAAAAAAHeIiIiIiIiIiIiIiIiIiIiIiIiHcAAAAAAAAAAAAAAHiIiIiIiIiIiIiIiIiIiIiIiIiIiHAAAAAAAAAAAAAHiIiIiIiIiIiIiIiIiIiIiIiIiIiIhwAAAAAAAAAAB3iIiIiIiIiIiIiIiIiIiIiIiIiIiIiIcAAAAAAAAAB3iIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiHAAAAAAAAB4iIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIhwAAAAAAB3iIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIcAAAAAAHiIiIiI/////////4iIiP/////4iI////iIiAAAAAAHiIiIiI+HeIiIiId4+IiId4iIh4+IiIiHj4iIcAAAAHiIiIiIj3dwAAAAB3j4iIiHAAAHj49wAAePiIiHAAAAeIiIiIiI//cAAACP/4iIiP8AAH/4+AAAf/iIiIcAAAeIiIiIiIiI+AAAAIiIiIiIj3AAf4iAAAD4iIiIiHAACIiIiIiIiIj4AAAAiIiIiIiPcAB/j3AACPiIiIiIcAB4iIiIiIiIiPgAAACIiIiIiI9wAH/3AAB/iIiIiIh3AHiIiIiIiIiI+AAAAIiIiIiIj3AAf4AAB/iIiIiIiIcAiIiIiIiIiIj4AAAAiIiIiIiPcAB/AAAI+IiIiIiIiAf4iIiIiIiIiPgAAACIiIiIiI9wAHcAAH+IiIiIiIiIB/iIiIiIiIiI+AAAAIiIiIiIj3AAB3AAB4+IiIiIiIgH+IiIiIiIiIj4AAAAiIiIiIiPcAB//3AACIiIiIiIiAf4iIiIiIiIiPgAAACIiIiIiI9wAH+I9wAH+IiIiIiIB/iIiIiIiIiI+AAAAIiIiIiIj3AAf4j3AAD4iIiIiIgH+IiIiIiIiIj4AAAAiIiIiIiPcAB/iPcAAPiIiIiIiAf4iIiIiIiIiPgAAACIiIiIiI9wAH+I9wAH+IiIiIiIB/iIiIiIiIiI+AAAAPiIiIiIj3AAf4/wAAj4iIiIiIgH+IiIiIiIiIj4AAAA///4iIj/AAB4iAAAf4iIiIiIiAf4iIiIiPiIiPgAAAD///iP+HcAAAAAAHj4iIiIiIiIAIiIiIiIiIiI+AAAAIiI+IiIiIiIiIiP/4iIiIiIiIcAeIiIiPd/iIj4AAAAiIiI94///////4iIiIiIiIiIhwB4iIiI9w+IiPgAAACIiI+Aj4iIiIiIiIiIiIiIiIhwAAiIiIj3CPiI+AAAAIiIj3CPiIiIiIiIiIiIiIiIiHAAB4iI+PcAj4j4AAAAiIj4AI+IiIiIiIiIiIiIiIiIAAAAiIj49wAIj/gAAAD/+HAAj4iIiIiIiIiIiIiIiIcAAAB4iI/3AAAAAAAAAAAAAACPiIiIiIiIiIiIiIiIcAAAAAeIj/h3d3d3d3d3d3d3d4+IiIiIiIiIiIiIiIhwAAAAB4iP////////////////iIiIiIiIiIiIiIiIhwAAAAAAeIj/+IiIiIiIiIiIiIiIiIiIiIiIiIiIiIhwAAAAAAAHiI//+IiIiIiIiIiIiIiIiIiIiIiIiIiIiAAAAAAAAAB4iIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiAAAAAAAAAAAeIiIiIiIiIiIiIiIiIiIiIiIiIiIiIhwAAAAAAAAAAAHiIiIiIiIiIiIiIiIiIiIiIiIiIiIhwAAAAAAAAAAAAB3iIiIiIiIiIiIiIiIiIiIiIiIiIhwAAAAAAAAAAAAAAB4iIiIiIiIiIiIiIiIiIiIiIiIcAAAAAAAAAAAAAAAAAd4iIiIiIiIiIiIiIiIiIiIiHcAAAAAAAAAAAAAAAAAAAd4iIiIiIiIiIiIiIiIiIh3AAAAAAAAAAAAAAAAAAAAAAB4iIiIiIiIiIiIiIiIdwAAAAAAAAAAAAAAAAAAAAAAAAAHeI////////+Id3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAd3d3d3d3d3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/////////////+f/////////+P/////////4f/////////wf/////////g/////////+B/////////4D/////////wH/////////AP////////8A/////////wB/////////AB////////8AAf//////8AAAD/////+AAAAB/////AAAAAB////4AAAAAD///+AAAAAAD///wAAAAAAH//+AAAAAAAP//wAAAAAAAf/+AAAAAAAA//wAAAAAAAF/+AAAAAAAAH/wAAAAAAAAP+AAAAAAAAA/4AAAAAAAAB/AAAAAAAAAD8AAAAAAAAAPwAAAAAAAAA/AAAAAAAAAD4AAAAAAAAAPQAAAAAAAAAdAAAAAAAAAB0AAAAAAAAAHQAAAAAAAAAdAAAAAAAAAB0AAAAAAAAAHQAAAAAAAAAdAAAAAAAAAD4AAAAAAAAAPwAAAAAAAAA/AAAAAAAAAD8AAAAAAAAAPwAAAAAAAAB/gAAAAAAAAP+AAAAAAAAA/8AAAAAAAAH/4AAAAAAAAf/gAAAAAAAD//QAAAAAAAf/+AAAAAAAD//8AAAAAAAf//4AAAAAAD///4AAAAAAf///wAAAAAH////wAAAAB/////gAAAAP/////wAAAH//////+P/P///////+AB/////////////////////////w=='
    $Stream = [IO.MemoryStream]::new([Convert]::FromBase64String($Encoded))
    try {
        $SourceIcon = [Drawing.Icon]::new($Stream)
        try { return $SourceIcon.Clone() } finally { $SourceIcon.Dispose() }
    } finally { $Stream.Dispose() }
}
function New-RepairProgressWindow {
    Initialize-RepairWindowTypes
    $French = [Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName -eq 'fr'
    $Form = New-Object TypeRRepairWindow
    $Form.Icon = Get-RepairWindowIcon
    $Form.ShowIcon = $true
    $Form.ShowInTaskbar = $true
    $Form.Text = 'TypeR'
    $Form.ClientSize = New-Object Drawing.Size(620, 440)
    $Form.BackColor = [Drawing.Color]::FromArgb(22, 23, 32)
    $Form.ForeColor = [Drawing.Color]::FromArgb(239, 240, 248)
    $Form.Font = New-Object Drawing.Font('Segoe UI', 10)
    $Form.AutoScaleMode = 'Dpi'
    $Form.StartPosition = 'CenterScreen'
    $Form.FormBorderStyle = 'None'
    $Form.ControlBox = $false
    $Form.Tag = [pscustomobject]@{ AllowClose = $false }
    $Form.Add_FormClosing({ param($Sender, $EventArgs) if (-not $Sender.Tag.AllowClose) { $EventArgs.Cancel = $true } })
    $Form.Add_MouseDown({ param($Sender, $EventArgs) if ($EventArgs.Button -eq 'Left' -and $EventArgs.Y -lt 64) { [TypeRRepairWindow]::Drag($Sender) } })
    $Brand = New-Object Windows.Forms.Label
    $Brand.SetBounds(80, 30, 500, 24)
    $Brand.Text = 'TypeR  /  PHOTOSHOP'
    $Brand.Font = New-Object Drawing.Font('Segoe UI Semibold', 10)
    $Brand.ForeColor = [Drawing.Color]::FromArgb(165, 147, 255)
    $Brand.Add_MouseDown({ param($Sender, $EventArgs) if ($EventArgs.Button -eq 'Left') { [TypeRRepairWindow]::Drag($Sender.FindForm()) } })
    $Logo = New-Object Windows.Forms.PictureBox
    $Logo.SetBounds(40, 26, 30, 30)
    $Logo.SizeMode = 'Zoom'
    $Logo.Image = $Form.Icon.ToBitmap()
    $Logo.Add_Disposed({ param($Sender, $EventArgs) if ($Sender.Image) { $Sender.Image.Dispose() } })
    $Title = New-Object Windows.Forms.Label
    $Title.SetBounds(36, 76, 548, 48)
    $Title.Font = New-Object Drawing.Font('Segoe UI Semibold', 22)
    $Title.Text = if ($French) { 'On s''occupe de tout.' } else { 'We''ll take it from here.' }
    $Label = New-Object Windows.Forms.Label
    $Label.SetBounds(40, 138, 540, 92)
    $Label.ForeColor = [Drawing.Color]::FromArgb(184, 187, 205)
    $Label.Font = New-Object Drawing.Font('Segoe UI', 11)
    $Progress = New-Object TypeRRepairTrack
    $Progress.SetBounds(40, 255, 540, 84)
    $Progress.French = $French
    $Hint = New-Object Windows.Forms.Label
    $Hint.SetBounds(40, 366, 320, 44)
    $Hint.ForeColor = [Drawing.Color]::FromArgb(120, 125, 148)
    $Hint.Font = New-Object Drawing.Font('Segoe UI', 9)
    $Hint.Text = if ($French) { 'Vos documents sont enregistrés avant toute fermeture.' } else { 'Your documents are saved before Photoshop closes.' }
    $Button = New-Object Windows.Forms.Button
    $Button.SetBounds(418, 364, 162, 42)
    $Button.FlatStyle = 'Flat'
    $Button.FlatAppearance.BorderSize = 0
    $Button.BackColor = [Drawing.Color]::FromArgb(165, 147, 255)
    $Button.ForeColor = [Drawing.Color]::FromArgb(22, 23, 32)
    $Button.Font = New-Object Drawing.Font('Segoe UI Semibold', 10)
    $Button.Cursor = [Windows.Forms.Cursors]::Hand
    $Button.Text = if ($French) { 'Terminer' } else { 'Done' }
    $Button.Visible = $false
    $Button.Add_Click({ param($Sender, $EventArgs) $Sender.FindForm().Close() })
    $Form.Controls.AddRange(@($Logo, $Brand, $Title, $Label, $Progress, $Hint, $Button))
    return [pscustomobject]@{ Form = $Form; Title = $Title; Label = $Label; Progress = $Progress; Hint = $Hint; Button = $Button }
}
function Update-RepairProgressWindow($Window, [string]$Status, [string]$Detail = '', [switch]$Finished) {
    $View = Get-RepairProgress $Status ([Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName -eq 'fr')
    $Window.Title.Text = $View.Title
    $Window.Label.Text = $View.Text + $(if ($Detail) { "`r`n`r`n" + $Detail } else { '' })
    $Window.Progress.Stage = $View.Stage
    $Window.Progress.Finished = [bool]$Finished
    $Window.Progress.Successful = $View.Complete
    if ($Finished) {
        $Window.Hint.Text = ''
        $Window.Button.Visible = $true
        $Window.Form.ControlBox = $true
        $Window.Form.Tag.AllowClose = $true
        $Window.Form.CancelButton = $Window.Button
    }
    $Window.Progress.Invalidate()
    [Windows.Forms.Application]::DoEvents()
}
function Get-RepairNotice([bool]$French, [bool]$AutomaticSave) {
    if ($French) {
        $Intro = 'TypeR a rencontré un problème d''affichage au démarrage. Cela peut être lié à une version modifiée ou crackée de Photoshop.'
        $Steps = if ($AutomaticSave) {
            'TypeR va enregistrer vos documents, fermer Photoshop, réparer le problème, puis redémarrer Photoshop automatiquement.'
        } else { 'Enregistrez vos documents et fermez Photoshop. TypeR réparera ensuite le problème et redémarrera Photoshop automatiquement.' }
        $Save = if ($AutomaticSave) { 'Pour un nouveau document, choisissez où l''enregistrer. Annuler l''enregistrement arrête la réparation.' } else { 'La progression restera visible pendant la réparation.' }
    } else {
        $Intro = 'TypeR encountered a display problem at startup. This can be related to a modified or cracked version of Photoshop.'
        $Steps = if ($AutomaticSave) { 'TypeR will save your documents, close Photoshop, repair the problem, then restart Photoshop automatically.' }
            else { 'Save your documents and close Photoshop. TypeR will then repair the problem and restart Photoshop automatically.' }
        $Save = if ($AutomaticSave) { 'For a new document, choose where to save it. Cancelling a save stops the repair.' } else { 'Progress will stay visible during the repair.' }
    }
    return $Intro + "`r`n`r`n" + $Steps + "`r`n`r`n" + $Save
}
function New-RepairConsentWindow([bool]$AutomaticSave) {
    $French = [Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName -eq 'fr'
    $Window = New-RepairProgressWindow
    $Window.Form.ClientSize = New-Object Drawing.Size(620, 530)
    $Window.Form.ControlBox = $true
    $Window.Form.Tag.AllowClose = $true
    $Window.Title.Text = if ($French) { 'Un souci au démarrage.' } else { 'A startup hiccup.' }
    $Window.Label.SetBounds(40, 138, 540, 202)
    $Window.Label.Text = Get-RepairNotice $French $AutomaticSave
    $Window.Progress.Visible = $false
    $Window.Hint.SetBounds(40, 360, 540, 62)
    $Window.Hint.Text = if ($French) { 'Une autorisation Windows sera demandée. La réparation modifiera un fichier Photoshop ; une copie de l''original sera conservée.' }
        else { 'Windows will ask for permission. The Photoshop file being changed will be backed up so it can be restored.' }
    $Window.Button.SetBounds(312, 448, 268, 44)
    $Window.Button.Text = if ($French) { 'Réparer et redémarrer' } else { 'Repair and restart' }
    $Window.Button.Visible = $true
    $Window.Button.DialogResult = 'OK'
    $Cancel = New-Object Windows.Forms.Button
    $Cancel.SetBounds(40, 448, 146, 44)
    $Cancel.FlatStyle = 'Flat'
    $Cancel.FlatAppearance.BorderColor = [Drawing.Color]::FromArgb(66, 69, 88)
    $Cancel.ForeColor = [Drawing.Color]::FromArgb(200, 202, 217)
    $Cancel.Text = if ($French) { 'Plus tard' } else { 'Not now' }
    $Cancel.Cursor = [Windows.Forms.Cursors]::Hand
    $Cancel.DialogResult = 'Cancel'
    $Window.Form.Controls.Add($Cancel)
    $Window.Form.CancelButton = $Cancel
    $Window.Form.ActiveControl = $Cancel
    return $Window
}
function Restart-RepairPhotoshop {
    # Auto runs as Photoshop's user. Never launch Photoshop from the elevated worker.
    Write-RepairStatus 'restarting'
    try {
        if (-not @(Get-RepairPhotoshopProcesses).Count) {
            $Restarted = Start-Process -FilePath $PhotoshopPath -WorkingDirectory (Split-Path -Parent $PhotoshopPath) -WindowStyle Normal -PassThru
            if (-not $Restarted) { throw 'Photoshop did not start.' }
        }
        Write-RepairStatus 'completed'
        return [pscustomobject]@{ status = 'completed'; detail = '' }
    } catch {
        Write-RepairStatus 'restart-failed' $_.Exception.Message
        return [pscustomobject]@{ status = 'restart-failed'; detail = $_.Exception.Message }
    }
}
function Get-RepairPhotoshopProcesses {
    @(Get-Process -Name Photoshop -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $PhotoshopPath })
}
function Save-AndCloseRepairPhotoshop {
    if (-not $ReportPath) { throw 'Automatic save requires a status path.' }
    $Targets = @(Get-RepairPhotoshopProcesses)
    if (-not $Targets.Count) { return }
    if ($Targets.Count -ne 1) { throw 'Multiple instances of this Photoshop are open. Close the other instance and retry.' }
    $Target = $Targets[0]
    $ResponsePath = $ReportPath + '.' + $SessionId + '.response.json'
    Write-RepairStatus 'saving-documents'
    $Deadline = [DateTime]::UtcNow.AddSeconds([Math]::Min($WaitSeconds, 600))
    while ($true) {
        $Response = $null
        if (Test-Path -LiteralPath $ResponsePath) {
            try { $Response = [IO.File]::ReadAllText($ResponsePath) | ConvertFrom-Json } catch {}
        }
        if ($Response -and $Response.session -eq $SessionId) {
            if ($Response.status -ne 'saved') { throw ('Enregistrement interrompu / Save stopped: ' + $Response.detail) }
            break
        }
        if ([DateTime]::UtcNow -ge $Deadline) { throw 'Enregistrement non confirmé / Save not confirmed. Photoshop reste ouvert / Photoshop stays open.' }
        Start-Sleep -Milliseconds 250
    }
    Write-RepairStatus 'closing-photoshop'
    $Target.Refresh()
    if (-not $Target.HasExited -and -not $Target.CloseMainWindow()) { throw 'Photoshop could not close normally. Close it manually and retry.' }
    # A normal close preserves Photoshop's own last-chance save dialogs. Never kill it.
    $Deadline = [DateTime]::UtcNow.AddSeconds([Math]::Min($WaitSeconds, 120))
    while (-not $Target.HasExited) {
        if ([DateTime]::UtcNow -ge $Deadline) { throw 'Fermeture annulée ou bloquée / Photoshop close cancelled or blocked. DLL unchanged.' }
        Start-Sleep -Milliseconds 250
        $Target.Refresh()
    }
}
function Show-AutomaticRepairFailure {
    $Message = if ([Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName -eq 'fr') {
        "La réparation de Photoshop n'a pas pu se terminer. Vous pouvez relancer Photoshop : TypeR utilisera son interface de secours. Contactez le support TypeR avec le fichier status.json de la réparation."
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
    $ProgressWindow = $null
    $Completion = $null
    try {
        try { $Acquired = $Mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $Acquired = $true }
        if (-not $Acquired) { return }
        if ($State -eq 'experimental-applied') { Write-RepairStatus 'applied'; return }
        if ($State -ne 'original-supported') { Write-RepairStatus 'unsupported' ('Unrecognized layout: ' + $RecognitionDetail + '; SHA256: ' + $CurrentHash); return }
        if (Test-Path -LiteralPath $DisabledPath) { Write-RepairStatus 'disabled'; return }
        if (-not $Retry -and $ReportPath -and (Test-Path -LiteralPath $ReportPath)) {
            try { $Previous = [IO.File]::ReadAllText($ReportPath) | ConvertFrom-Json } catch { $Previous = $null }
            if ($Previous -and $Previous.photoshop -eq $PhotoshopPath -and $Previous.repair -eq $PatchedHash -and
                $Previous.status -in @('declined', 'failed', 'timed-out')) { return }
        }
        Write-RepairStatus 'preparing'
        $ConsentWindow = New-RepairConsentWindow ([bool]$SessionId)
        try { $Consent = $ConsentWindow.Form.ShowDialog() } finally { $ConsentWindow.Form.Dispose() }
        if ($Consent -ne [Windows.Forms.DialogResult]::OK) { Write-RepairStatus 'declined'; return }
        $ProgressWindow = New-RepairProgressWindow
        Update-RepairProgressWindow $ProgressWindow 'preparing'
        $ProgressWindow.Form.Show()
        $ThisScript = $PSCommandPath
        $ScriptHash = Get-Hash $ThisScript
        $Command = '$ErrorActionPreference = ''Stop''; if ((Get-FileHash -LiteralPath ' + (Quote-RepairArgument $ThisScript) + ').Hash -ne ' + (Quote-RepairArgument $ScriptHash) + ') { throw ''Repair script changed'' }; & ' +
            (Quote-RepairArgument $ThisScript) + ' -Action Apply -WaitForExit -WaitSeconds ' + $WaitSeconds +
            ' -PhotoshopPath ' + (Quote-RepairArgument $PhotoshopPath)
        if ($ReportPath) { $Command += ' -ReportPath ' + (Quote-RepairArgument $ReportPath) }
        if ($SessionId) { $Command += ' -SessionId ' + (Quote-RepairArgument $SessionId) }
        $Encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Command))
        try {
            $Worker = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $Encoded) -Verb RunAs -WindowStyle Hidden -PassThru
        } catch {
            if ($_.Exception.NativeErrorCode -eq 1223 -or $_.Exception.InnerException.NativeErrorCode -eq 1223) { Write-RepairStatus 'declined' }
            else { Write-RepairStatus 'failed' $_.Exception.Message }
            return
        }
        while (-not $Worker.HasExited) {
            if ($ReportPath -and (Test-Path -LiteralPath $ReportPath)) {
                try {
                    $ProgressReceipt = [IO.File]::ReadAllText($ReportPath) | ConvertFrom-Json
                    Update-RepairProgressWindow $ProgressWindow $ProgressReceipt.status $ProgressReceipt.detail
                } catch {}
            }
            [Windows.Forms.Application]::DoEvents()
            Start-Sleep -Milliseconds 100
            $Worker.Refresh()
        }
        if ((Get-Hash $DllPath) -eq $PatchedHash) {
            Update-RepairProgressWindow $ProgressWindow 'restarting'
            $Completion = Restart-RepairPhotoshop
        }
        else {
            # Preserve a worker's precise reason (especially a wait timeout).
            $WorkerStatus = $null
            if ($ReportPath -and (Test-Path -LiteralPath $ReportPath)) {
                try { $WorkerStatus = [IO.File]::ReadAllText($ReportPath) | ConvertFrom-Json } catch {}
            }
            if (-not $WorkerStatus -or $WorkerStatus.status -notin @('failed', 'timed-out')) {
                Write-RepairStatus 'failed' ('Repair worker exited without the expected DLL: ' + $Worker.ExitCode)
            }
        }
    } catch { Write-RepairStatus 'failed' $_.Exception.Message; if (-not $ProgressWindow) { Show-AutomaticRepairFailure } }
    finally {
        if ($ProgressWindow) {
            try {
                $FinalReceipt = $Completion
                if (-not $FinalReceipt -and $ReportPath -and (Test-Path -LiteralPath $ReportPath)) { $FinalReceipt = [IO.File]::ReadAllText($ReportPath) | ConvertFrom-Json }
                $FinalStatus = if ($FinalReceipt) { $FinalReceipt.status } elseif ((Get-Hash $DllPath) -eq $PatchedHash) { 'applied' } else { 'failed' }
                Update-RepairProgressWindow $ProgressWindow $FinalStatus $FinalReceipt.detail -Finished
                $ProgressWindow.Form.Activate()
                while ($ProgressWindow.Form.Visible) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
            } finally { $ProgressWindow.Form.Dispose() }
        }
        if ($Acquired) { $Mutex.ReleaseMutex() }; $Mutex.Dispose()
    }
}

$PhotoshopPath = [IO.Path]::GetFullPath($PhotoshopPath)
if (-not (Test-Path -LiteralPath $PhotoshopPath -PathType Leaf)) { throw "Photoshop not found: $PhotoshopPath" }
$DllPath = Join-Path (Split-Path -Parent $PhotoshopPath) 'dynamic-torqnative.dll'
$CurrentHash = Get-Hash $DllPath
$Profile = $RepairProfiles | Where-Object { $_.originalHash -eq $CurrentHash -or $_.patchedHash -eq $CurrentHash } | Select-Object -First 1
$RecognitionDetail = ''
if (-not $Profile) { $Profile = Resolve-AdaptiveRepair $DllPath $CurrentHash }
$OriginalHash = if ($Profile) { $Profile.originalHash } else { '' }
$PatchedHash = if ($Profile) { $Profile.patchedHash } else { '' }
$PatchOffset = if ($Profile) { $Profile.offset } else { 0 }
$BeforeHex = if ($Profile) { $Profile.before } else { '' }
$AfterHex = if ($Profile) { $Profile.after } else { '' }
$BackupPath = if ($Profile) { $DllPath + '.typer-original-' + $OriginalHash + '.bak' } else { $null }
$DisabledPath = $DllPath + '.typer-repair-disabled'
$State = if ($CurrentHash -eq $OriginalHash) { 'original-supported' } elseif ($CurrentHash -eq $PatchedHash) { 'experimental-applied' } else { 'unsupported' }
if ($Action -eq 'Inspect') {
    [pscustomobject]@{ recognitionDetail = $RecognitionDetail; state = $State; dll = $DllPath; sha256 = $CurrentHash; backup = $BackupPath; profile = $(if ($Profile) { $Profile.id } else { $null }); uxp = $(if ($Profile) { $Profile.uxp } else { $null }); backupExists = ($BackupPath -and (Test-Path -LiteralPath $BackupPath -PathType Leaf)); automaticRepairDisabled = (Test-Path -LiteralPath $DisabledPath) }
    return
}
if ($Action -eq 'Auto') { Start-AutomaticRepair; return }
if ($State -eq 'unsupported') { throw 'Unsupported DLL hash. No reviewed hash or compatible Windows x64 storage layout was found. Nothing changed; use TypeR''s native panel and provide the Inspect report to support.' }
# Serialize explicit Apply/Restore too. This is separate from Auto's coordinator
# mutex, which stays held while its elevated worker runs.
$MutationHasher = [Security.Cryptography.SHA256]::Create()
try { $MutationKey = [BitConverter]::ToString($MutationHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($DllPath.ToLowerInvariant()))).Replace('-', '') }
finally { $MutationHasher.Dispose() }
$MutationMutex = [Threading.Mutex]::new($false, ('Local\TypeR-WebView-Write-' + $MutationKey))
$MutationAcquired = $false
try {
try { $MutationAcquired = $MutationMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $MutationAcquired = $true }
if (-not $MutationAcquired) { throw 'Another repair is applying or restoring this Photoshop installation.' }
if ($Action -eq 'Apply' -and $WaitForExit -and $SessionId) { Save-AndCloseRepairPhotoshop }
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
    Write-RepairStatus 'applied'
    return
}
if ($Action -eq 'Restore' -and $State -eq 'original-supported') {
    [IO.File]::WriteAllText($DisabledPath, 'Automatic TypeR WebView repair disabled by Restore. Explicit Apply re-enables it.')
    Write-Output 'Original DLL already in place.'
    Write-RepairStatus 'restored'
    return
}

# The reviewed x64 initializer has the same stack layout in UXP 9.3 and 9.4.1.
# The cold branch of WebViewManager initialization normally waits for a user hash.
# When that stack-local std::string is empty, give ONLY that copy the storage name
# "typer-offline", then resume the existing locked storage constructor path.
# The user provider, licensing, createWebView null check and nonempty-hash path
# are untouched. The scope is Photoshop's WebView manager, including other plugins.
$StagePath = $DllPath + '.typer-stage-' + [Guid]::NewGuid().ToString('N')
try {
    if ($Action -eq 'Apply') {
        Write-RepairStatus 'backing-up'
        if (Test-Path -LiteralPath $BackupPath) {
            if ((Get-Hash $BackupPath) -ne $OriginalHash) { throw 'Existing backup has the wrong hash; refusing to overwrite it.' }
        } else {
            [IO.File]::Copy($DllPath, $BackupPath, $false)
            if ((Get-Hash $BackupPath) -ne $OriginalHash) { throw 'Backup verification failed; DLL unchanged.' }
        }
        $Bytes = [IO.File]::ReadAllBytes($DllPath)
        Write-RepairStatus 'repairing'
        if ($Bytes.Length -ne $Profile.size) { throw 'Unexpected DLL size; DLL unchanged.' }
        $Before = Convert-Hex $BeforeHex
        $After = Convert-Hex $AfterHex
        if ($Before.Length -ne $After.Length -or $PatchOffset -lt 0 -or $PatchOffset + $Before.Length -gt $Bytes.Length) { throw 'Invalid repair profile; DLL unchanged.' }
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
    Write-RepairStatus 'verifying'
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
} catch {
    # Do not replace a timeout receipt with a generic failure.
    if ($MutationAcquired -and $_.Exception.Message -ne 'Photoshop stayed open; DLL unchanged.') { Write-RepairStatus 'failed' $_.Exception.Message }
    throw
} finally {
    if ($MutationAcquired) { $MutationMutex.ReleaseMutex() }
    $MutationMutex.Dispose()
}
