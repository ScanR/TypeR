// TypeR keyboard reader for the UXP plugin (Windows).
//
// The CEP panel polled ScriptUI.environment.keyboardState through ExtendScript
// to see shortcuts pressed while Photoshop's canvas has the focus. UXP has no
// such API: this program polls the keyboard with GetAsyncKeyState and writes
// the state, in the same "aWINaCTRLaKa" format, to the file the plugin reads.
// Keys are reported only while Photoshop is the foreground application, and
// the mouse side buttons as "<id> MB|<5|6>|<modifiers>|<process>" lines in
// "<state file>.mouse", the format of the CEP panel's watcher. It exits when
// Photoshop does.
// The file holds "<state>|<beat>": the beat moves on every write and about
// once a second, so the plugin can tell a quiet keyboard from a dead reader
// (uxp-src/host/keysHelper.js restarts it). A restarted reader writes its
// process id to "<state file>.owner"; an older one still running sees it and
// exits, so two readers never write the same file.
//
// Built as a .NET Framework 4.8 Windows application (part of Windows 10 and
// 11): no console window ever opens. The plugin starts it with ExtendScript's
// File.execute(), which passes no argument, so the state file defaults to
// "state" next to the program.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class TypeRKeys {
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool MoveFileEx(string from, string to, uint flags);

  const uint MOVEFILE_REPLACE_EXISTING = 1;

  static readonly int[] namedKeys = {
    0x08, 0x09, 0x0D, 0x1B, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E,
    0x6A, 0x6B, 0x6D, 0x6E, 0x6F, 0xBB, 0xBD, 0xBC, 0xBE, 0xBF, 0xBA, 0xDE,
  };
  static readonly string[] keyNames = {
    "BACKSPACE", "TAB", "ENTER", "ESCAPE", "SPACE", "PAGEUP", "PAGEDOWN", "END", "HOME",
    "LEFTaARROWLEFT", "UPaARROWUP", "RIGHTaARROWRIGHT", "DOWNaARROWDOWN", "INSERT", "DELETE",
    "MULTIPLY", "PLUS", "MINUS", "DECIMAL", "DIVIDE", "EQUALaPLUS", "MINUS", "COMMA", "PERIOD",
    "SLASHaDIVIDE", "SEMICOLON", "QUOTEaAPOSTROPHE",
  };

  static bool Down(int vk) {
    return (GetAsyncKeyState(vk) & 0x8000) != 0;
  }

  static string KeyName() {
    for (int i = 0; i < namedKeys.Length; i++) if (Down(namedKeys[i])) return keyNames[i];
    for (int i = 0; i < 24; i++) if (Down(0x70 + i)) return "F" + (i + 1);
    for (int i = 0; i < 10; i++) if (Down(0x60 + i)) return i.ToString();
    for (int vk = 0x30; vk <= 0x5A; vk++) {
      if ((vk <= 0x39 || vk >= 0x41) && Down(vk)) return ((char)vk).ToString();
    }
    return "";
  }

  static string ProcessName(IntPtr handle) {
    uint pid;
    GetWindowThreadProcessId(handle, out pid);
    try {
      using (Process process = Process.GetProcessById((int)pid)) return process.ProcessName;
    } catch {
      return "";
    }
  }

  static bool PhotoshopRunning() {
    Process[] found = Process.GetProcessesByName("Photoshop");
    foreach (Process process in found) process.Dispose();
    return found.Length > 0;
  }

  // Written next to the target, then moved over it: the plugin never reads
  // half a line. A failed write (file busy) is tried again on the next pass.
  static bool WriteAtomic(string path, string text) {
    try {
      File.WriteAllText(path + ".tmp", text, new UTF8Encoding(false));
      return MoveFileEx(path + ".tmp", path, MOVEFILE_REPLACE_EXISTING);
    } catch {
      return false;
    }
  }

  static string ReadTrimmed(string path) {
    try {
      return File.ReadAllText(path).Trim();
    } catch {
      return null;
    }
  }

  [STAThread]
  static void Main(string[] args) {
    try {
      Run(args);
    } catch {
      // A Windows application must never show an error dialog
    }
  }

  static void Run(string[] args) {
    string statePath = args.Length > 0 && args[0] != ""
      ? args[0]
      : Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "state");
    string mousePath = statePath + ".mouse";
    string ownerPath = statePath + ".owner";
    string self = Process.GetCurrentProcess().Id.ToString();
    File.WriteAllText(ownerPath, self);

    string previous = "";
    int beat = 0;
    int sinceWrite = 1000;
    IntPtr lastHandle = IntPtr.Zero;
    string foreground = "";
    int presses = 0;
    long tick = 0;
    // Clears the "pressed since the last call" bits of the side buttons
    GetAsyncKeyState(5);
    GetAsyncKeyState(6);

    while (true) {
      tick++;
      if (tick % 40 == 0) {
        if (!PhotoshopRunning()) break;
        string owner = ReadTrimmed(ownerPath);
        if (owner != null && owner != self) return;
      }
      IntPtr handle = GetForegroundWindow();
      if (handle != lastHandle || foreground == "") {
        lastHandle = handle;
        foreground = ProcessName(handle);
      }
      bool front = foreground.IndexOf("photoshop", StringComparison.OrdinalIgnoreCase) >= 0;
      bool win = Down(0x5B) || Down(0x5C);
      bool ctrl = Down(0x11);
      bool alt = Down(0x12);
      bool shift = Down(0x10);
      string state = "a";
      if (front) {
        if (win) state += "WINa";
        if (ctrl) state += "CTRLa";
        if (alt) state += "ALTa";
        if (shift) state += "SHIFTa";
        string key = KeyName();
        if (key != "") state += key + "a";
      }
      sinceWrite++;
      if (state != previous || sinceWrite >= 25) {
        beat++;
        if (WriteAtomic(statePath, state + "|" + beat)) {
          previous = state;
          sinceWrite = 0;
        }
      }
      for (int button = 5; button <= 6; button++) {
        if ((GetAsyncKeyState(button) & 1) != 0 && front) {
          presses++;
          string mods = (win ? "W" : "") + (ctrl ? "C" : "") + (alt ? "A" : "") + (shift ? "S" : "");
          WriteAtomic(mousePath, self + "-" + presses + " MB|" + button + "|" + mods + "|" + foreground);
        }
      }
      Thread.Sleep(30);
    }
    try {
      File.Delete(statePath);
    } catch {}
  }
}
