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
// The plugin writes the time (ms since the epoch) to "<state file>.focus" when
// the keyboard focus must leave the panel's WebView (see ReleaseWebViewFocus):
// the reader gives it to Photoshop's own windows and answers in
// "<state file>.focus.ack".
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
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

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

  // Caps Lock (0x14) is a key of its own, Ctrl+Caps Lock being a shortcut of 2.x
  static readonly int[] namedKeys = {
    0x08, 0x09, 0x0D, 0x14, 0x1B, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E,
    0x6A, 0x6B, 0x6D, 0x6E, 0x6F, 0xBB, 0xBD, 0xBC, 0xBE, 0xBF, 0xBA, 0xDE,
  };
  static readonly string[] keyNames = {
    "BACKSPACE", "TAB", "ENTER", "CAPSLOCK", "ESCAPE", "SPACE", "PAGEUP", "PAGEDOWN", "END", "HOME",
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

  // The focus window of Photoshop's UI thread, and its class
  static IntPtr FocusWindow(uint thread) {
    GuiThreadInfo info = new GuiThreadInfo();
    info.Size = Marshal.SizeOf(typeof(GuiThreadInfo));
    return thread != 0 && GetGUIThreadInfo(thread, ref info) ? info.Focus : IntPtr.Zero;
  }

  static bool IsWebView(IntPtr handle) {
    return handle != IntPtr.Zero && ClassName(handle).StartsWith("Chrome_", StringComparison.Ordinal);
  }

  // The panel's WebView (WebView2: "Chrome_WidgetWin_1" and its render window,
  // created by msedgewebview2.exe and parented into the panel) keeps the
  // keyboard focus after a click on a TextShapeR shape, Insert or a style, and
  // forwards no key to Photoshop: the tool keys die until the Windows key or a
  // document switch. Nothing in the plugin's process reaches that focus (UXP's
  // blur and app.bringToFront leave it), so the plugin asks this reader, which
  // attaches to Photoshop's UI thread and sets the focus the way a window
  // activation does: on the main window first (what the Windows key ends with),
  // then on the panel's own view (where a click on the document leaves it) if
  // the main window handed it back to the WebView. Only on request, only while
  // the request is fresh and Photoshop is in front, and only while a WebView
  // holds the focus: the plugin decides when the user is not typing in it.
  // The answer ("<time> <class before> > <class after>", or the reason it was
  // skipped) goes to the plugin's debug view.
  static string ReleaseWebViewFocus(string request, IntPtr foreground, bool front) {
    long requested;
    if (!long.TryParse(request, out requested)) return null;
    long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    if (Math.Abs(now - requested) > 2000) return request + " stale";
    if (!front) return request + " background";
    uint thread = GetWindowThreadProcessId(foreground, IntPtr.Zero);
    IntPtr focus = FocusWindow(thread);
    if (focus == IntPtr.Zero) return request + " no focus";
    string before = ClassName(focus);
    if (!IsWebView(focus)) return request + " kept " + before;
    IntPtr root = GetAncestor(focus, 2); // GA_ROOT
    uint rootPid, foregroundPid;
    GetWindowThreadProcessId(root, out rootPid);
    GetWindowThreadProcessId(foreground, out foregroundPid);
    if (root == IntPtr.Zero || rootPid != foregroundPid) return request + " kept " + before + " (not Photoshop's)";
    IntPtr panel = focus;
    while (panel != IntPtr.Zero && IsWebView(panel)) panel = GetAncestor(panel, 1); // GA_PARENT
    uint self = GetCurrentThreadId();
    bool attached = self != thread && AttachThreadInput(self, thread, true);
    string after;
    try {
      SetFocus(root);
      after = ClassName(FocusWindow(thread));
      if (IsWebView(FocusWindow(thread)) && panel != IntPtr.Zero && panel != root) {
        SetFocus(panel);
        after = ClassName(FocusWindow(thread));
      }
    } finally {
      if (attached) AttachThreadInput(self, thread, false);
    }
    return request + " " + before + " > " + (after == "" ? "none" : after);
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
    string focusPath = statePath + ".focus";
    string focusAckPath = statePath + ".focus.ack";
    string self = Process.GetCurrentProcess().Id.ToString();
    File.WriteAllText(ownerPath, self);

    string previous = "";
    string lastFocusRequest = "";
    int focusReads = 0;
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
      // The plugin asks for the focus to leave its WebView (ReleaseWebViewFocus).
      // A request half written reads as nothing: tried again on the next pass,
      // a few times
      if (File.Exists(focusPath)) {
        string request = ReadTrimmed(focusPath);
        string answer = null;
        bool done = request != null && request != "" && request == lastFocusRequest;
        if (!done && request != null && request != "") {
          answer = ReleaseWebViewFocus(request, handle, front);
          done = answer != null;
        }
        if (done || ++focusReads > 5) {
          focusReads = 0;
          if (request != null && request != "") lastFocusRequest = request;
          try { File.Delete(focusPath); } catch {}
          if (answer != null) WriteAtomic(focusAckPath, answer);
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
