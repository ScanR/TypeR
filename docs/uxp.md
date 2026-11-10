# TypeR UXP plugin

The UXP plugin is the same TypeR application as the CEP extension. Only the
runtime around it differs:

| | CEP extension | UXP plugin |
| --- | --- | --- |
| Panel | `app_src` in CEP's Chromium | `app_src` in a UXP WebView (WebKit on macOS, WebView2 on Windows) |
| Photoshop calls | `app_src/host.js`, ExtendScript | `uxp-src/host/photoshop.js`, batchPlay |
| Files, dialogs, Node features | `cep.fs`, `cep_node` | the plugin host, through messages |
| Global keyboard state | ScriptUI | `uxp-src/native` keyboard reader |
| User data | the extension folder | `~/Library/Application Support/TypeR/UXP`, `%APPDATA%\TypeR\UXP` |

## Layout

- `uxp-src/manifest.json` — plugin manifest; the version comes from `package.json`.
- `uxp-src/index.html`, `uxp-src/host/` — the plugin host, bundled into `uxp/host.js`.
  - `main.js` — entry points, the WebView, the message bridge, Photoshop events, theme, dialogs.
  - `photoshop.js` — the port of `host.js`. Same function names, arguments and string results.
  - `jamText.js` — `jamText.toLayerTextObject` / `fromLayerTextObject` on actionJSON.
  - `files.js` — TypeR's storage files, the one-time import of a CEP install's storage (copied into
    `.cep-import`, marked complete, then moved in, so an import cut short is finished or retried at the
    next start).
  - `services.js` — file dialogs, files the user picks, font files, font installation, updates, fetch.
  - `keysHelper.js` (Windows and macOS), `keyboard.js` — start and follow the keyboard reader. `keysAddon.js`
    is the native addon's reader, built only for its preview package.
  - `jsx.js` — the few ExtendScript calls UXP cannot replace (`app.system`, `app.refreshFonts`).
  - `devChannel.js` — development builds only, see *Testing in Photoshop*.
- `uxp-src/web/` — the panel's entry: rebuilds the CEP environment the application expects
  (`CSInterface`, `cep.fs`, `cep.util`, `__adobe_cep__`) before loading `app_src/index.jsx`,
  plus `webkit.scss` for the few places WebKit lays the same CSS out differently.
- `uxp-src/native/` — the Windows reader (`typer-keys.cs`, packed as `typer-keys-win.json`), the native
  addon kept for its preview package (`addon/`) and the macOS external reader
  (`typer-keys.m`, packed as `typer-keys.json`). On macOS the reader counts
  as Photoshop for privacy: without Input Monitoring for Photoshop, it only sees modifiers and keys
  such as Return, Tab or function keys. Asking from it does not add Photoshop to that list, so it
  reports the permission in `<state file>.access` and the panel offers to open the pane
  (`app_src/keyboardAccess.js`). Once it is granted the reader exits and the plugin starts a new one,
  which sees every key: Photoshop needs no restart.
- `webpack.uxp.config.js`, `scripts/buildUxp.js` — build and packaging.

## How a host call travels

`csInterface.evalScript("setActiveLayerText({...})", callback)` in the panel becomes a message to the
host. `uxp-src/host/evalScript.js` parses the call (it is never evaluated), `main.js` runs the method of
`photoshop.js` with the same name, and the string result goes back to the callback. Host calls are
queued and run one at a time, as ExtendScript did. An exception answers `"EvalScript error."`, like CEP;
so does a call still running after its time limit (60 s, 2 min for the smart paste, 10 min for scans,
document opening and font lists, none for dialogs). Nothing can cancel that call and Photoshop may still
finish it, so the next calls wait until it settles; each gets its own time limit meanwhile, and a call
that times out while waiting never runs. The smart paste answers `{"ok":false,"code":"timeout"}`
instead, and the panel then does not fall back to the classic paste.

`photoshop.js` keeps the structure and helper names of `host.js`. ActionManager calls are synchronous
`batchPlay` calls with `dialogOptions: "silent"` (`"dontDisplay"` still shows Photoshop's alerts).
`app.activeDocument.suspendHistory(name, fn)` becomes an `executeAsModal` scope with
`hostControl.suspendHistory`; reads and scans that only need Photoshop to compute something run in a
suspension that is rolled back, so they leave no history state.

**When `host.js` changes, port the change to `photoshop.js`.** `scripts/testUxpHost.js` compares the
pure helpers of both files (default style, selection maths, sample counts…) and fails when they drift.

## Deliberate differences with the CEP host

Each one fixes something the CEP host gets wrong in Photoshop 2026:

- Bubble and selection shapes are sampled from the selection mask (`imaging.getSelection`) instead of
  a work path: the same rows, without temporary channels or paths. (The CEP host's path sampler used
  to return wrong rows in Photoshop: ExtendScript misread its scanline test and the path's handles were
  paired the wrong way round. Both are fixed and it now agrees with its slower legacy sampler.)
- Reads (rendered line breaks, shape scans) leave no `TyperTools Read Shape(s)` history state, and a
  failed or empty operation leaves no empty history state.
- Text colors Photoshop reports as unit floats (`redFloat`…) are read and written as 0–255 RGB. The CEP
  host wrote them back empty, which made the size buttons fail on such layers ("program error").
- Redundant commands are skipped: a temporary channel is only deleted when it exists, and the Middle
  East overrides are only set when the layer does not already have the values (each costs a relayout).

## Panel environment

The WebView's message bridge is `localAndRemote`: with `localOnly`, Photoshop 26.6 no longer delivers the
host's messages to the panel. The bridge gives no origin to check, so the host ignores the messages of any
page that is not the panel: when the WebView starts loading another page, the host loads the panel again
and opens a web address in the browser.

Synchronous CEP file calls on TypeR's own files (`storage*`, `.typer-update-test.json`, `locale/…`)
are answered from a mirror the host sends at start; writes update the mirror at once and are persisted
by the host (atomic rename, newest content only when writes pile up). Windows cannot rename over a file:
the original is moved aside, put back if the new file cannot replace it, and restored at the next start
if a crash left it aside. A failed write is reported, never written in place. Any other path, and the file
dialogs, return promises: their call sites `await` them, which changes nothing in CEP.

Code that needs the plugin host checks `window.typerUXP` (set by `uxp-src/web/cepShim.js`): font files
in a `.zip` export, font installation, update installation and the mouse side buttons. `<input
type="file">` opens the host's dialog and receives File-like objects with a `path`, as in CEP. A fetch
the WebView refuses because of CORS (GitHub release downloads) is made again by the host.

## When the WebView does not start

`uxp-src/host/panelStartup.js` watches startup from the native host. A cold WebView gets
30 seconds to establish its message bridge, without reassigning its address after 5 seconds.
`loadstart` and `loadstop` do not prove the application can communicate: when the deadline is
exhausted, or a `loaderror` occurs before a bridge exists, the host starts the native panel fallback.
Hidden panels suspend the deadline; zero-sized views get another waiting period. Application errors
and the 15-second initialization deadline after the first bridge message keep their diagnostics:
switching renderers would not fix a failing host/storage operation. The native **Reload TypeR**
button preserves pending settings writes.

One cause is established (2026-11-03): no WebView2 runtime Photoshop can start. UXP tries the copy
Adobe installs in `C:\Program Files\Common Files\Adobe\Microsoft\EdgeWebView` (its log says so) and
Microsoft's Evergreen runtime in `C:\Program Files (x86)\Microsoft\EdgeWebView\Application` (the one
that actually runs here, 156, with the Adobe copy at 140 — both display TypeR). With neither usable,
Photoshop's UXP log (`<AppData>\Adobe\Adobe Photoshop <year>\Logs\UXPLogs_<date>_<time>_<n>.log`, one
per session) says `Failed to create WebView for plugin: com.scanr.typer` 2 s after the panel opens,
no load event ever reaches the host page, and Photoshop's own Home screen fails the same way: exactly
the users' notice (`start=false, stop=false, bridge=false`). Reproduced locally by starting Photoshop
with `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` set to a missing folder (`.update-test/webview-runtime-probe.ps1
-Name missing -Folder C:\TypeR-no-runtime`; `-Name normal` restores the usual start). So when the deadline
needs diagnostic details on Windows, `main.js` reads the UXP log identified by its own attempt marker: with
that line, the notice drops the waiting hint, quotes the line, says the WebView2 component is missing or
damaged, and the help button becomes **Install WebView2**, which opens Microsoft's download page (then
restart Photoshop). The notice also reports what else that log says (`panelStart.readUxpLogFacts`): the folder UXP
says it uses, the `WebView2BrowserVersion` that started in the session (none when no WebView ran at all)
and the other plugins whose WebView failed (the Home screen, `com.adobe.ccx.start`, named for the user).
The collector of the debug build reads the whole log (not its tail: the decisive lines are written in the
first seconds of a session), leaves out the Home screen's `[console]` lines, and ends with a verdict built
from the same facts. `install.ps1` warns after a UXP install when no runtime exists in any of the folders
or in Microsoft's registry.

A second cause was found in a user's log on 2026-11-04 and established on 2026-11-07 (Photoshop 27.9.1,
UXP 9.3, reproduced on a test machine): `WebViewManager::createWebView() failed to create WebView because
webViewDataStorage_ is not available`. UXP builds the WebView data storage of third-party plugins
(`<AppData>\Adobe\UXP\PluginsStorage\PHSP\<major>\WebView\<user hash>\3P`) from the signed-in Adobe
user; a Photoshop without one (Feature Restricted Licensing, `FRL user. No access token present` in the
same log; offline or modified installations) never has it, and every third-party WebView is refused, on
any runtime and with any WebView2 variable. Since then **TypeR runs without a WebView** when it has to:
the same application, built a second time for UXP's own panel DOM (`uxp/inpanel/`), is started in the
panel by `uxp-src/host/inPanel.js` with a direct message channel instead of postMessage. The host
checks the UXP log at 1.5, 7 and 15 seconds. Only the log containing this host's unique console marker
is considered. Two observations and a 15-second grace period are required for an early switch, so a
transient Adobe identity delay can recover. Other renderer failures use the policy above. The first cause (no runtime) ends the same way: TypeR no longer
needs a runtime to open. Everything about it (cause, evidence, the mode, UXP's DOM limits and the crash
it avoids, tests) is in `docs/uxp-webview-refused.md`. The support bundle's
`installer/webview_rescue_win.ps1` (`3-WebView-Rescue.cmd`) still runs the ways out of a refused WebView
one by one and reads the session's UXP log after each (`createWebView() create new for thirdparty plugin`
= created; the failure lines = refused); `-Analyze <log>` prints what a log says without running anything.
Likely on cracked/repacked installations without the Adobe copy, on a Windows without the Evergreen
runtime (nothing else installed it); untested: a runtime present but damaged, or blocked by a policy.
Users report the same computer working with Photoshop 27.4: the runtime selection is the same in every
UXP from Photoshop 2025 (26.x) to the Beta 28 (same log lines), but each UXP links a newer WebView2 SDK,
whose loader refuses a runtime older than its minimum ("skipped an incompatible version"), so an old
copy (the Adobe folder held 127 from September 2024 before 140) that 27.4's UXP accepted is not enough
for 27.7's (UXP 9.3). The notice says "too old" for that reason; Microsoft's Evergreen runtime updates
itself. Not reproduced for lack of an old fixed runtime on disk.

`npm run package:uxp:debug` writes `Releases/TypeR-DEBUG-Windows-EN.zip`: the support build adds an independent
startup journal, an **Export diagnostic** button and a read-only Windows collector. It uses the normal plugin
ID and preserves its data, without enabling developer code execution. Reinstall the normal build afterwards.

`npm run package:uxp:trace-kit` writes `Releases/TypeR-debug.zip`, for deeper crash/WebView investigation on Windows. Double-clicking
`TypeR-debug.cmd` installs the crash trace build through `install.ps1`, then `scripts/debug-kit/collect.ps1`
writes `TypeR-debug-report.txt` on the Desktop: Photoshop installations and the WebView2 files they hold, runtime
folders and registry, the running WebView processes, Windows errors and the trace. In that build, a panel still
silent after 15 s runs `uxp-src/host/panelProbe.js`, which hides it and opens small WebViews instead. A red box is
one that painted nothing. The probes are removed on recovery, reload, hiding or closing the panel. A trace
or debug build's `uxp/` folder must not be shipped: run `npm run build:uxp` afterwards.

## Keyboard reader

### Windows: TypeR Shortcuts.exe

`UXP-Windows.ccx` reads the keyboard with "TypeR Shortcuts.exe", a .NET Framework 4.8
Windows application (`uxp-src/native/typer-keys.cs`, part of Windows 10 and 11): no
console window, no hook, no network. A .ccx may not carry an executable, so the program
ships base64-encoded in `native/typer-keys-win.json`; `keysHelper.js` writes it to the
`keys` folder of TypeR's storage and starts it with ExtendScript's `File.execute()`.
It polls `GetAsyncKeyState` every 30 ms while Photoshop is in front, writes the state
(`<state>|<beat>`) and the mouse side buttons (`<state file>.mouse`), and exits with
Photoshop. A reader whose beat stops is started again. Some mice send their side buttons
as the browser's Back and Forward keys: they count as buttons 4 and 5 too.

Microsoft cleared the 3.0.0 program of Defender's detection (submission of 1 November
2026, "Incorrect detection"), so 3.0.2 went back to it from the native addon of 3.0.1.

The reader also reports a focus theft (issue #214), as `|F` after the beat in its state file. Photoshop's rich tooltips, the
contextual task bar's among them, are dialog-class (`#32770`) layered popups shown
without `WS_EX_NOACTIVATE`: on Windows they take the keyboard focus, and every
shortcut (tool keys, `Ctrl+T`) dies until the user clicks the document or switches
applications. After a paste on click or TextShapeR, that bar settles under the
cursor with the new text layer, so its tooltip opens at once. The reader reads the
focus window of the foreground thread (`GetGUIThreadInfo`, read only) and reports a
captionless layered `#32770` owned by the enabled main window; a real dialog,
Photoshop's (`PSFloatC`) or UXP's, has a caption and disables its owner.
`keysHelper.js` reports a theft once, then once a second while it lasts, and
`main.js` gives the focus back with `app.bringToFront()` from a modal scope: the
only call that restored it in the live tests (`performMenuCommand` 1208 and a
document `select` did nothing; focusing the panel's own DOM also worked but moved
the focus to the panel). Photoshop busy (a text being edited, a dialog) leaves the
focus as it was, like before. macOS has no such reader and no report of the bug.

The panel's WebView is the second thief, on every Photoshop version (seen live on
27.7, where the tooltips take no focus): a click on a TextShapeR shape, on Insert
or on a style leaves the keyboard focus in the WebView (`Chrome_WidgetWin_1`), and
unlike a CEP panel a WebView forwards no key to Photoshop, so the tool keys die
until the Windows key or, usually, a click on the document (not always: once the
clicks did not move it either). No reader rule can tell that focus from the user
typing in the panel, so `main.js` restores the focus as every `evalScript`
call that changes the document starts, and once more after it (the `set` entries
of `DOCUMENT_CHANGING_CALLS`): those are the panel actions after which the user
works in the document, a style applied to a TextShapeR layer lasts long enough for
the next tool key to arrive before its end, and a restore while the document
already holds the focus changes nothing. The page asks
for the same restore when the pointer leaves it with nothing being edited
(`web/focus.js`, below), and tells the host whether an editor has the focus
(`focusState`): a change made by a shortcut while typing keeps the caret.

On Windows, `view.blur()` and `app.bringToFront()` do not take the focus out of
the WebView: the WebView2 windows (`Chrome_WidgetWin_1` and its render window) are
created by msedgewebview2.exe and parented into the panel, and Photoshop, already
the active window, moves nothing (seen on 27.x: the tool keys stayed dead until the
user switched documents). `restoreFocus` asks the keyboard reader there, through
its state folder (`keysHelper.requestFocusRelease` writes the time to
`state.focus`): if a WebView still holds the focus of Photoshop's UI thread, the
reader attaches to that thread (`AttachThreadInput`) and sets the focus the way a
window activation does, on the main window (what the Windows key ends with), then
on the panel's own view if the main window handed it back to the WebView
(`ReleaseWebViewFocus` in `typer-keys.cs`). The reader ignores a request older than
2 s (one it finds after a restart), acts only while Photoshop is in front, and
answers in `state.focus.ack` (`<time> <class before> > <class after>`, or why it
was skipped), which Settings > Debug shows as `focusRelease`.

Nothing else moves the focus on Windows. 3.0.2 and 3.0.3 also gave it to an element
of the panel's own DOM (`focusSink`, a `tabindex` element) before asking the reader,
at every restore, the document holding the focus or not. A UXP panel that holds the
focus on Windows keeps Photoshop's keys for itself (Adobe's developer forum, threads
2240, 2379, 4196 and 7570: tool keys dead after a click in any UXP panel, Windows
only, until a click on the document), and the reader then found the focus outside
any WebView and left it there: after a paste by shortcut, with the focus in the
document, the tool keys and the actions' shortcuts died until a click on the
document (three reports within hours of 3.0.3, none with the Legacy panel). So the
sink is gone, and a restore asked by a call (`"call"`) is skipped on Windows while
the page does not hold the focus (`focusState`'s `focused`, `document.hasFocus()`
in the page): that paste leaves the focus in the document, as up to 3.0.1. macOS
keeps restoring after every call. Not verified on a Windows computer yet: the
reader's release is the only thing left that takes the focus out of the WebView
there, and 3.0.2 and 3.0.3 may never have reached it, the sink moving the focus
first.

Settings > Debug displays the reader in use (TypeR Helper for TypeR Shortcuts.exe, UXP Addon
in the addon preview package), live held keys, the last combination, sample count,
foreground status and loading errors. TypeR shortcuts are suspended while settings
are open; click the Photoshop canvas to test detection without panel focus.

The build is reproducible: `dotnet build` of the same `typer-keys.cs`, `.csproj`, `.ico`
and `.manifest` gives the same bytes on macOS and Windows. The manifest is fixed because
the SDK's default one has CRLF line endings on Windows and LF elsewhere, and
`.gitattributes` keeps these sources byte for byte through `core.autocrlf`.
`npm run build:uxp` rebuilds `typer-keys-win.json` when those sources changed and the .NET
SDK is installed; otherwise it ships the committed one and warns if it is older. Every
new program has a new hash: submit it to Microsoft
(https://www.microsoft.com/wdsi/filesubmission) and check it on VirusTotal before a release.

The native addon (`uxp-src/native/addon/`, `keysAddon.js`) is kept for its preview
package (`npm run package:uxp:addon`) and is no longer in the release. Its prebuilt
AMD64 DLL and its source/binary checksums are committed under
uxp-src/native/addon/win-x64/: ordinary builds need neither the Adobe SDK nor a C++
compiler. If the addon's sources or build script change, rebuild it on Windows (Visual
Studio C++ Build Tools, Windows SDK and Adobe's UXP Hybrid Plugin SDK, not committed) and
commit both the binary and build.json:

```powershell
$env:UXP_HYBRID_SDK = 'C:\SDKs\uxp-hybrid-plugin-sdk'
npm run build:keys-addon
npm run test:keys-addon:native
```

### Separate platform packages

npm run package:uxp builds and verifies both packages:
- Releases/UXP-Windows.ccx: Windows, manifest v5, with TypeR Shortcuts.exe (packed).
- Releases/TypeR-UXP.ccx: macOS with the external reader, manifest v5. It also runs on Windows, only to replace itself (see below).

The updater, the installers and Legacy-to-UXP migration choose the platform's exact
asset name. Both CCX files are included in TypeR.zip by the release command. Publish
both CCX files and their checksums. The Windows manifest must not be installed on
macOS: Adobe requires a native binary for the target platform. This is not a
Marketplace hybrid package. No release is published by these build commands.

**Upgrade from 3.0.0:** the 3.0.0 clients cannot change, and they do not look at the
platform. Its panel installs the first asset ending in `.ccx` with "typer" in its name;
its Legacy panel and standalone updaters ask for `TypeR-UXP.ccx` by name. So:

- `TypeR-UXP.ccx` must keep that name and run on every system.
- `UXP-Windows.ccx` must not have "typer" in its name, so that they skip it whatever the
  order of the assets. Never publish another `.ccx` with "typer" in its name
  (`TypeR-UXP-addon-win.ccx`, `TypeR-UXP-debug.ccx`…): a 3.0.0 panel could take it.
- On Windows, `TypeR-UXP.ccx` starts no keyboard reader and its panel at once installs
  `UXP-Windows.ccx` from the release of its own version
  (`app_src/uxpPlatformPackage.js`), through the ordinary update path. It says so if
  Photoshop must restart or if it failed, and tries again at the next start. A release's
  tag must therefore be its version.
- Without Creative Cloud's installer, the package of the running version goes to
  `com.scanr.typer_<version>.win`: the running folder cannot be replaced on Windows.

`npm run test:uxp-update -- --platform-package` runs this swap on any system.

npm run package:uxp:addon:installer retains the standalone Windows installation
kit at Releases/TypeR-Addon-Windows.zip. Extract all files, quit Photoshop and run
Installer-TypeR-Addon.cmd. It verifies checksums and the native DLL, then invokes
the transactional local installer without Creative Cloud. It preserves settings
and backs up replaced plugin files. The older addon command and CCX filename remain
as aliases for this kit; the panel is now labelled TypeR, without Preview.

### macOS external reader

macOS keeps typer-keys.m, packed in native/typer-keys.json. It starts through
ExtendScript app.system, receives Photoshop's PID and exits with Photoshop.
The host follows its state file and heartbeat, drops stale keys and retries a
stopped reader. Input Monitoring permission for Photoshop is still required.

Adobe reference: https://developer.adobe.com/uxp/guides/how-to/hybrid-plugins/build.

## Moving Legacy users to UXP

Versions up to 2.5.0 update themselves to the Legacy package only: their updater installs the first
`.zip` asset of a release whose name contains "typer" (`TypeR.zip`). So the switch is offered by the
Legacy panel once it is updated (`app_src/uxpMigration.js`, `components/modal/uxpMigration.jsx`).

- The offer opens first at startup, before What's new, when Photoshop is 2025 (26.0) or later and
  TypeR UXP is not installed. It is shown only to existing users with update checks on. "Later" asks
  again a week later, "Don't ask again" stops it, and Settings > General > Updates keeps a button.
- The panel downloads `UXP-Windows.ccx` on Windows or `TypeR-UXP.ccx` on macOS from the latest release, checks that it is a TypeR plugin, and
  hands it to Creative Cloud's plugin installer through the panel's Node.js (`child_process.execFile`,
  no ExtendScript). Photoshop loads a first installation at once. Without that installer, the panel
  installs the package by hand (see below) and asks to restart Photoshop.
- TypeR UXP imports the Legacy styles, profiles and settings on its first start. The Legacy version
  stays installed; the panel offers to close it.
- The Legacy panel is called "TypeR (CEP)" in Photoshop, and "TypeR (old)" while TypeR UXP is installed: `<Menu>` in its
  installed `CSXS/manifest.xml`, which Photoshop reads at its start (`app_src/legacyPanelName.js`). The
  installers apply it, the UXP plugin at each start (whichever way it was installed), and the Legacy
  panel at each start and after installing the plugin, which also restores "TypeR (CEP)" once the plugin is
  removed. The packaged manifest has "TypeR (CEP)", so a Legacy update resets it until the next check.
- Each start of the Legacy panel then says first, before the walkthrough and What's new, that the new
  version opens from Plug-ins > TypeR, until "Don't show again". Those windows follow when it closes.
  Photoshop versions older than 26.0 cannot run the plugin and get no such notice.

Every release must therefore publish `TypeR.zip`, `TypeR-UXP.ccx` and `UXP-Windows.ccx`, and no other `.zip` whose name
contains "typer".

Test it without publishing anything: `npm run package:uxp`, then `npm run test:uxp-migration` serves
a local release holding the `.ccx` and writes `.typer-update-test.json` (`forceUxpMigration`) into
the installed Legacy extension. The Legacy panel then offers the switch whatever the Photoshop version
or the installed plugins. Ctrl+C removes the test file.

The standalone updaters (`installer/update_typer_mac.sh`, `installer/update_typer_win.cmd`) follow the same goal. They download
`TypeR.zip`, which holds the plugin, then update what is installed: the plugin, and Legacy too when both
are there. Without the plugin, a Photoshop that can run it gets the installers' menu, with UXP
recommended; Q leaves everything as it was. An older Photoshop, or a scripted run (no console, or
`--silent` on Windows), updates Legacy as before. Their messages are the installers' ones. The plugin
always comes from the downloaded archive, never from a package left next to the script.

## Updating without a restart

Creative Cloud's plugin installer (UPIA) leaves a running plugin alone: after `--install` of a newer
version, the old code keeps running until Photoshop's next start. After `--remove` then `--install`,
Photoshop stops the old code and runs the new one within a second. Installing, removing and installing
again also works, but leaves two entries in `PS.json`.

The removal stops the plugin itself, so `services.installUpdatePackage` writes a script and starts it in
the background (`app_src/uxpUpdateScript.js`), from `TypeR/UXP/update`, which is outside the plugin:

- The plugin is removed and the new version installed. Photoshop swaps them and the call never returns.
- The removal fails, as on a hand-made install: the script runs `--install` alone and reports it. The
  panel asks to restart Photoshop.
- The installer fails after the removal: the script tries twice more, then copies the files prepared in
  `update/fallback` and a `PS.json` with the new version, which Photoshop loads at its next start.
- The script does not start within 20 s, or fails while the plugin runs: the panel installs by hand.

The next start of the plugin deletes the folder. The Windows script holds no user path, because cmd.exe
reads a batch file in the console's code page: it finds its folder through `%~dp0` and the rest through
`%APPDATA%`. A new permission in the manifest may still need a restart.

The Legacy panel replaces its files in place, loads the new `host.jsx` with `$.evalFile` and reloads
(`utils.downloadAndInstallUpdate`). Only a changed `CSXS/manifest.xml`, other than its version and panel
name, makes it ask for a restart.

Test it without publishing anything: `npm run build:uxp`, then `npm run test:uxp-update` serves the
built plugin as the next version. The panel updates itself the next time it loads, and its new version
reports to the server once it runs. `npm run test:update:prepare` and `npm run test:update:server` do
the same for the Legacy panel on Windows. This was checked on macOS with Photoshop 2026, with both panels
open: Windows remains to be run, and the script's stand-in test (`scripts/testUxpUpdateScript.js`) only
runs on macOS and Linux.

## Installing without Creative Cloud

The installers, the panel's updates and the switch from Legacy all use Creative Cloud's plugin
installer (UPIA) when it is there and works. Its exit code does not tell: a failure can still exit
with 0, so its output is read too. The two install scripts also skip it when the Creative Cloud app
itself is missing, since UPIA can be left behind without it, and stop waiting for it after a minute
(`TYPER_INSTALL_UPIA_TIMEOUT`, in seconds). Otherwise, they install the package by hand
(`app_src/uxpManualInstall.js`, `installer/install_mac.sh`, `installer/install.ps1`):

1. Extract the `.ccx`, a plain zip, to `Plugins/External/com.scanr.typer_<version>`, through a
   `.installing` staging folder.
2. Add the plugin to `PluginsInfo/v1/PS.json`, keeping the other plugins. Photoshop ignores a folder
   that is not registered there. An unreadable file stops the installation rather than being replaced.

Both are in `~/Library/Application Support/Adobe/UXP` on macOS and `%APPDATA%\Adobe\UXP` on Windows, so
no administrator rights are needed. Photoshop reads `PS.json` at its start: the plugin appears after a
restart, and a registration added while Photoshop runs is kept. After an update installed this way,
the previous version's folder stays until Photoshop runs the new one
(`services.removeStalePluginFolders`). UPIA's `--remove` fails on such an install (status -406), while
its `--install` of the same version replaces it.

This was checked on macOS with Photoshop 2026, with UPIA set aside rather than uninstalled. On Windows,
only `install.ps1`'s logic ran, under PowerShell 7 on macOS: the `$localPlugins` path format in PS.json
is the one seen on macOS and remains to be confirmed there.

Open question: with a hand-made install and the panel open, Photoshop 2026 under Rosetta sometimes stays
in `exit()` after quitting (windows closed, UXP terminated, process still there), which delays its next
launch. It was seen in some quits and not in others, and its cause is not established: the same
quit was not compared on a Creative Cloud install.

Reports from other developers: copying to `Plugins/External` and editing `PluginsInfo` was described
for Windows in [this 2021 thread](https://forums.creativeclouddeveloper.com/t/install-uxp-plugin-with-own-installer/3846),
and unzipping the `.ccx` into Photoshop's own `Plug-ins` folder is
[confirmed by several users on Reddit](https://www.reddit.com/r/photoshop/comments/xm9pe4/comment/l04qrnj/).
TypeR does not use that folder: it can need administrator rights on Windows, is tied to one Photoshop
version, and the panel's updates would not reach it. It remains the thing to try by hand if a build
ignores `PS.json`.

Test it with Creative Cloud installed: `TYPER_INSTALL_NO_UPIA=1 bash install_mac.command --uxp`
(`$env:TYPER_INSTALL_NO_UPIA='1'` on Windows; `TYPER_UXP_ROOT` installs to another folder), or
`npm run test:uxp-migration -- --manual` for the Legacy panel's switch. `forceManualPluginInstall` in
the update test file does the same for the panels.

## The installers' menu

The archive has one file to run per system at its root, `install_win.cmd` and `install_mac.command`. They
only start `installer/install.ps1` and `installer/install_mac.sh`, which read the package from the
parent of their folder. That folder also holds the standalone updaters and `fix_mac_rosetta.sh`.

`get.sh` and `get.ps1` download the latest `TypeR.zip`, check it against `TypeR.zip.sha256` when the
release has one, and start its installer. They are read from `master`, so they work as soon as they are
merged there, and install whatever the latest release contains.

Without `--uxp` / `--legacy` (`-Uxp` / `-Legacy`), an interactive console shows the menu; a scripted run
still installs Legacy without asking. The installer finds each Photoshop and the newest one decides:
version 26 or later recommends UXP, an older one Legacy, and none found (or an unreadable version)
recommends nothing, with the cursor on UXP. The other choice stays selectable, for someone about to
upgrade. On Windows, the search reads the registry and `Program Files\Adobe` on every drive; on macOS,
`/Applications`, `~/Applications` and Spotlight.

When TypeR is already installed, the installer reads each version it finds (`CSXS/manifest.xml` for Legacy; for
the plugin, the `com.scanr.typer_<version>` folders on macOS, and the manifest of every copy on Windows, where
copies can also be in Photoshop's `Plug-ins` folders; the newest counts) and says under that option whether it updates it,
is up to date, or is newer than the archive. It then says what changed at the end.

`scripts/testInstallers.js` covers these rules. The keys need a terminal: to try them without installing
anything, run the script with `TYPER_INSTALL_PROBE=choice`, which prints the choice and stops, and
`TYPER_PHOTOSHOP_VERSIONS="Photoshop 2024=25.0.0"`, which replaces the search.

## Building

```sh
npm run build:uxp       # uxp/: Windows plugin
npm run build:uxp:mac   # uxp-mac/: macOS plugin
npm run package:uxp     # Windows + macOS CCX, both added to TypeR.zip
npm run test:uxp        # the UXP suites (also run by npm test)
```

Changing `uxp-src/native/typer-keys.m` on macOS rebuilds `typer-keys.json`; commit it.
For the Windows addon rebuild instructions, see Keyboard reader above.

The WebView also releases passive focus after the pointer leaves its document.
A focused input is retained while typing; a real Photoshop layer/document or
canvas selection made outside the WebView releases it. The release is armed by a
click in the WebView, or by an editor taking the focus, and disarmed after one
release or native focus loss, so ordinary Photoshop selections do not open modal
scopes. A bare window focus does not arm it: Photoshop focuses a panel it has just
shown, and a panel expanded from a collapsed icon dock collapses when the restore
activates the main window (3.0.2 report on Windows: the panel "closed by itself"
about a second after opening, as the pointer left it). Plugin-generated events, IME composition, drags and switching applications
do not request this restore. Switching applications preserves the editor caret.
This lives in `web/focus.js`; the in-panel renderer keeps its native focus path.
The page also reports whether it holds the focus and whether an editor has it
(`focusState`), which the host's `restoreFocus` reads. On Windows the host's restore
goes through the keyboard reader, and only while the page holds the focus (see
Keyboard reader above): still to be confirmed live on a Windows host where the tool
keys stayed dead until a document switch.

## Testing in Photoshop

`npm run build:uxp:mac:dev` builds `Releases/TypeR-UXP-mac-dev.ccx` on macOS (`build:uxp:dev` targets Windows), which can run test code through
`uxp-src/host/devChannel.js` (files under `/private/tmp/typer-uxp-dev`). Install it with Creative
Cloud's plugin installer, which needs no developer mode:

```sh
UPIA="/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"
cp Releases/TypeR-UXP-mac-dev.ccx /tmp/ && "$UPIA" --remove "TypeR"; "$UPIA" --install /tmp/TypeR-UXP-mac-dev.ccx
```

Photoshop loads a first installation at once; an upgrade of an installed version only at its next
start, hence the removal. The package is copied to `/tmp` first: from `~/Desktop` or `~/Downloads`
macOS asks for Creative Cloud's permission. Never ship a dev package.

The behaviour of `photoshop.js` was checked against `host.js` by running both on identical documents
in Photoshop 2026 (the CEP host through `osascript … do javascript`) and comparing the resulting
layers, text descriptors, selection and history: styles, paste, multi-bubble batches, multi-layer
paste and rollback, centering with and without the magic wand, size changes, TextShapeR, rendered
lines, cleaning layers, undo, FontScanR and font lists.
