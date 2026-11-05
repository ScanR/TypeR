// TypeR keyboard reader for the UXP plugin (Windows).
//
// The CEP panel polled ScriptUI.environment.keyboardState through ExtendScript
// to see shortcuts pressed while Photoshop's canvas has the focus. UXP has no
// such API: this program polls the keyboard with GetAsyncKeyState and writes
// the state, in the same "aWINaCTRLaKa" format, to the file the plugin reads.
// Keys are reported only while Photoshop is the foreground application, and
// the mouse side buttons as "<id> MB|<5|6>|<modifiers>|<process>" lines in
// "<state file>.mouse", the format of the CEP panel's watcher. Some mice send
// their side buttons as the browser's Back and Forward keys: they count as
// buttons 4 and 5 too. It exits when Photoshop does.
// The file holds "<state>|<beat>", followed by "|F" while one of Photoshop's
// tooltips holds the keyboard focus (see FocusStolen): the plugin then gives
// the focus back to the document. The beat moves on every write and about
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
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint command);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr hWnd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int index);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder name, int size);

  [StructLayout(LayoutKind.Sequential)]
  struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  struct GuiThreadInfo {
    public int Size;
    public uint Flags;
    public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
    public Rect CaretRect;
  }
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

  static string ClassName(IntPtr handle) {
    StringBuilder name = new StringBuilder(64);
    return GetClassName(handle, name, name.Capacity) > 0 ? name.ToString() : "";
  }

  // Photoshop's rich tooltips (the contextual task bar's, among others) are
  // dialog-class popups shown without WS_EX_NOACTIVATE: on Windows they take
  // the keyboard focus, and every shortcut dies until the user clicks the
  // document or switches applications. Such a tooltip has no caption, is
  // layered and is owned by the still enabled main window. A real dialog,
  // Photoshop's (PSFloatC) or UXP's, has a caption and disables its owner.
  // Read only: GetGUIThreadInfo and the window queries work from any process.
  static bool FocusStolen(IntPtr foreground) {
    const int WS_CAPTION = 0x00C00000;
    const int WS_EX_LAYERED = 0x00080000;
    const int WS_EX_NOACTIVATE = 0x08000000;
    uint thread = GetWindowThreadProcessId(foreground, IntPtr.Zero);
    GuiThreadInfo info = new GuiThreadInfo();
    info.Size = Marshal.SizeOf(typeof(GuiThreadInfo));
    if (thread == 0 || !GetGUIThreadInfo(thread, ref info) || info.Focus == IntPtr.Zero) return false;
    IntPtr root = GetAncestor(info.Focus, 2); // GA_ROOT
    if (root == IntPtr.Zero || ClassName(root) != "#32770") return false;
    int style = GetWindowLong(root, -16); // GWL_STYLE
    int exStyle = GetWindowLong(root, -20); // GWL_EXSTYLE
    if ((style & WS_CAPTION) != 0 || (exStyle & WS_EX_LAYERED) == 0 || (exStyle & WS_EX_NOACTIVATE) != 0) return false;
    IntPtr owner = GetWindow(root, 4); // GW_OWNER
    return owner != IntPtr.Zero && ClassName(owner) == "Photoshop" && IsWindowEnabled(owner);
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
    // Clears the "pressed since the last call" bits of the side buttons, and
    // of the browser's Back and Forward keys some mice send instead
    GetAsyncKeyState(5);
    GetAsyncKeyState(6);
    GetAsyncKeyState(0xA6);
    GetAsyncKeyState(0xA7);

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
      bool stolen = front && FocusStolen(handle);
      if (front) {
        if (win) state += "WINa";
        if (ctrl) state += "CTRLa";
        if (alt) state += "ALTa";
        if (shift) state += "SHIFTa";
        string key = KeyName();
        if (key != "") state += key + "a";
      }
      sinceWrite++;
      string report = state + (stolen ? "|F" : "");
      if (report != previous || sinceWrite >= 25) {
        beat++;
        if (WriteAtomic(statePath, state + "|" + beat + (stolen ? "|F" : ""))) {
          previous = report;
          sinceWrite = 0;
        }
      }
      for (int button = 5; button <= 6; button++) {
        // Both read on every pass: each read clears its own "pressed" bit
        bool side = (GetAsyncKeyState(button) & 1) != 0;
        bool browser = (GetAsyncKeyState(button + 0xA1) & 1) != 0;
        if ((side || browser) && front) {
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
