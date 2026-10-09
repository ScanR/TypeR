# TypeR keyboard reader for the UXP plugin (Windows).
#
# The CEP panel polled ScriptUI.environment.keyboardState through ExtendScript
# to see shortcuts pressed while Photoshop's canvas has the focus. UXP has no
# such API: this script polls the keyboard with GetAsyncKeyState and writes
# the state, in the same "aWINaCTRLaKa" format, to the file the plugin reads.
# Keys are reported only while Photoshop is the foreground application, and
# the mouse side buttons as "<id> MB|<5|6>|<modifiers>|<process>" lines in
# "<state file>.mouse", the format of the CEP panel's watcher. The script
# exits when Photoshop does.
param([string]$StatePath)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TypeRKeys {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetKeyboardLayout(uint thread);
  [DllImport("user32.dll")] public static extern uint MapVirtualKeyEx(uint code, uint mapType, IntPtr layout);
}
'@

$names = @{
  0x08 = 'BACKSPACE'; 0x09 = 'TAB'; 0x0D = 'ENTER'; 0x1B = 'ESCAPE'; 0x20 = 'SPACE';
  0x21 = 'PAGEUP'; 0x22 = 'PAGEDOWN'; 0x23 = 'END'; 0x24 = 'HOME';
  0x25 = 'LEFTaARROWLEFT'; 0x26 = 'UPaARROWUP'; 0x27 = 'RIGHTaARROWRIGHT'; 0x28 = 'DOWNaARROWDOWN';
  0x2D = 'INSERT'; 0x2E = 'DELETE';
  0x6A = 'MULTIPLY'; 0x6B = 'PLUS'; 0x6D = 'MINUS'; 0x6E = 'DECIMAL'; 0x6F = 'DIVIDE';
  0xBB = 'EQUALaPLUS'; 0xBD = 'MINUS'; 0xBC = 'COMMA'; 0xBE = 'PERIOD'; 0xBF = 'SLASHaDIVIDE'; 0xBA = 'SEMICOLON'; 0xDE = 'QUOTEaAPOSTROPHE'
}
for ($i = 0; $i -lt 24; $i++) { $names[0x70 + $i] = 'F' + ($i + 1) }
for ($i = 0; $i -lt 10; $i++) { $names[0x60 + $i] = [string]$i }

function Test-Down([int]$vk) { return ([TypeRKeys]::GetAsyncKeyState($vk) -band 0x8000) -ne 0 }

function Get-ForegroundName {
  $handle = [TypeRKeys]::GetForegroundWindow()
  $processId = [uint32]0
  [void][TypeRKeys]::GetWindowThreadProcessId($handle, [ref]$processId)
  try { return (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch { return '' }
}

$mousePath = $StatePath + '.mouse'
$previous = ''
$lastHandle = [IntPtr]::Zero
$foreground = ''
$presses = 0
$tick = 0
[void][TypeRKeys]::GetAsyncKeyState(5); [void][TypeRKeys]::GetAsyncKeyState(6)

while ($true) {
  $tick++
  if (($tick % 40) -eq 0 -and -not (Get-Process -Name 'Photoshop' -ErrorAction SilentlyContinue)) { break }
  $handle = [TypeRKeys]::GetForegroundWindow()
  if ($handle -ne $lastHandle -or $foreground -eq '') { $lastHandle = $handle; $foreground = Get-ForegroundName }
  $front = $foreground -match 'photoshop'
  $win = (Test-Down 0x5B) -or (Test-Down 0x5C)
  $ctrl = Test-Down 0x11
  $alt = Test-Down 0x12
  $shift = Test-Down 0x10
  $state = 'a'
  if ($front) {
    if ($win) { $state += 'WINa' }
    if ($ctrl) { $state += 'CTRLa' }
    if ($alt) { $state += 'ALTa' }
    if ($shift) { $state += 'SHIFTa' }
    $key = ''
    foreach ($vk in $names.Keys) { if (Test-Down $vk) { $key = $names[$vk]; break } }
    if (-not $key) {
      for ($vk = 0x30; $vk -le 0x5A; $vk++) {
        if (($vk -le 0x39 -or $vk -ge 0x41) -and (Test-Down $vk)) { $key = [string][char]$vk; break }
      }
    }
    if ($key) { $state += $key + 'a' }
  }
  if ($state -ne $previous) {
    [System.IO.File]::WriteAllText($StatePath + '.tmp', $state)
    Move-Item -LiteralPath ($StatePath + '.tmp') -Destination $StatePath -Force
    $previous = $state
  }
  foreach ($button in 5, 6) {
    if (([TypeRKeys]::GetAsyncKeyState($button) -band 1) -ne 0 -and $front) {
      $presses++
      $mods = ''
      if ($win) { $mods += 'W' }; if ($ctrl) { $mods += 'C' }; if ($alt) { $mods += 'A' }; if ($shift) { $mods += 'S' }
      [System.IO.File]::WriteAllText($mousePath + '.tmp', "$PID-$presses MB|$button|$mods|$foreground")
      Move-Item -LiteralPath ($mousePath + '.tmp') -Destination $mousePath -Force
    }
  }
  Start-Sleep -Milliseconds 30
}
Remove-Item -LiteralPath $StatePath -ErrorAction SilentlyContinue
