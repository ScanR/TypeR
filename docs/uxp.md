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
  - `keysHelper.js`, `keyboard.js` — start and follow the keyboard reader.
  - `jsx.js` — the few ExtendScript calls UXP cannot replace (`app.system`, `app.refreshFonts`).
  - `devChannel.js` — development builds only, see *Testing in Photoshop*.
- `uxp-src/web/` — the panel's entry: rebuilds the CEP environment the application expects
  (`CSInterface`, `cep.fs`, `cep.util`, `__adobe_cep__`) before loading `app_src/index.jsx`,
  plus `webkit.scss` for the few places WebKit lays the same CSS out differently.
- `uxp-src/native/` — keyboard readers, shipped prebuilt because a `.ccx` may not carry a bare
  executable: `typer-keys.m` (macOS, packed as `typer-keys.json`) and `typer-keys.cs` (Windows, a
  .NET Framework 4.8 Windows application packed as `typer-keys-win.json`). On macOS the reader counts
  as Photoshop for privacy: without Input Monitoring for Photoshop, it only sees modifiers and keys
  such as Return, Tab or function keys. `CGRequestListenEventAccess` shows no dialog from it.
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
  a work path. The CEP host's path sampler returns inconsistent rows in Photoshop 2026; the mask gives
  the shape its slower legacy sampler measured, without temporary channels or paths.
- Reads (rendered line breaks, shape scans) leave no `TyperTools Read Shape(s)` history state, and a
  failed or empty operation leaves no empty history state.
- Text colors Photoshop reports as unit floats (`redFloat`…) are read and written as 0–255 RGB. The CEP
  host wrote them back empty, which made the size buttons fail on such layers ("program error").
- FontScanR reads every layer of a document with a background layer; the CEP host missed the topmost.
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

## Keyboard reader

The CEP panel polls `getHotkeyPressed()`; in UXP the keyboard reader writes the state to
`<data>/keys/state`, the host reads it every 25 ms and pushes each change to the panel, which matches it
at once (`typerUXP.onKeys`), so a short press is not lost between two polls. On macOS the reader is
started through ExtendScript's `app.system`, receives Photoshop's process id and exits with it. On
Windows `app.system` goes through `cmd.exe`, whose console window flashes on screen, so the reader is a
windowed application without any window, `<data>/keys/TypeR Shortcuts.exe` (named, described and
with TypeR's icon in the Task Manager), started through ExtendScript's `File.execute()` as a double
click would; it finds its state file next to itself and exits once Photoshop is gone. A new build
asks the running one to stop before replacing its locked `.exe`. It writes
`<state>|<beat>` and moves the beat at least once a second: a beat frozen for 2.5 s counts as no key
held, and after 6 s the reader is started again. A start that fails (Photoshop in a modal state while it
starts up) is retried after 2, 5, 10, then every 30 s, up to 10 times without a report. It only reports
keys while Photoshop is the frontmost application; on macOS a release stays at least 100 ms so a quick
tap or a double tap reaches the panel. Key names follow ScriptUI's
(`LEFT`, `ENTER`, …) and are followed by the names the shortcut recorder uses (`ARROWLEFT`), so
bindings recorded in either version match; the recorder keeps the first name. On macOS it also reports
mouse buttons 4 and 5, which the CEP version only supported on Windows.

## Moving Legacy users to UXP

Versions up to 2.5.0 update themselves to the Legacy package only: their updater installs the first
`.zip` asset of a release whose name contains "typer" (`TypeR.zip`). So the switch is offered by the
Legacy panel once it is updated (`app_src/uxpMigration.js`, `components/modal/uxpMigration.jsx`).

- The offer opens first at startup, before What's new, when Photoshop is 2025 (26.0) or later and
  TypeR UXP is not installed. It is shown only to existing users with update checks on. "Later" asks
  again a week later, "Don't ask again" stops it, and Settings > General > Updates keeps a button.
- The panel downloads `TypeR-UXP.ccx` from the latest release, checks that it is a TypeR plugin, and
  hands it to Creative Cloud's plugin installer through the panel's Node.js (`child_process.execFile`,
  no ExtendScript). Photoshop loads a first installation at once. Without that installer, the panel
  installs the package by hand (see below) and asks to restart Photoshop.
- TypeR UXP imports the Legacy styles, profiles and settings on its first start. The Legacy version
  stays installed; the panel offers to close it.
- While TypeR UXP is installed, the Legacy panel is called "TypeR (old)" in Photoshop: `<Menu>` in its
  installed `CSXS/manifest.xml`, which Photoshop reads at its start (`app_src/legacyPanelName.js`). The
  installers apply it, the UXP plugin at each start (whichever way it was installed), and the Legacy
  panel at each start and after installing the plugin, which also restores "TypeR" once the plugin is
  removed. The packaged manifest keeps "TypeR", so a Legacy update resets it until the next check.
- Each start of the Legacy panel then says first, before the walkthrough and What's new, that the new
  version opens from Plug-ins > TypeR, until "Don't show again". Those windows follow when it closes.
  Photoshop versions older than 26.0 cannot run the plugin and get no such notice.

Every release must therefore publish `TypeR.zip` and `TypeR-UXP.ccx`, and no other `.zip` whose name
contains "typer".

Test it without publishing anything: `npm run package:uxp`, then `npm run test:uxp-migration` serves
a local release holding the `.ccx` and writes `.typer-update-test.json` (`forceUxpMigration`) into
the installed Legacy extension. The Legacy panel then offers the switch whatever the Photoshop version
or the installed plugins. Ctrl+C removes the test file.

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
(`app_src/uxpManualInstall.js`, `install_mac.sh`, `install.ps1`):

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

Test it with Creative Cloud installed: `TYPER_INSTALL_NO_UPIA=1 ./install_uxp_mac.sh`
(`$env:TYPER_INSTALL_NO_UPIA='1'` on Windows; `TYPER_UXP_ROOT` installs to another folder), or
`npm run test:uxp-migration -- --manual` for the Legacy panel's switch. `forceManualPluginInstall` in
the update test file does the same for the panels.

## The installers' menu

`get.sh` and `get.ps1` download the latest `TypeR.zip`, check it against `TypeR.zip.sha256` when the
release has one, and start its installer. They are read from `master`, so they work as soon as they are
merged there, and install whatever the latest release contains.

Without `--uxp` / `--legacy` (`-Uxp` / `-Legacy`), an interactive console shows the menu; a scripted run
still installs Legacy without asking. The installer finds each Photoshop and the newest one decides:
version 26 or later recommends UXP, an older one Legacy, and none found (or an unreadable version)
recommends nothing, with the cursor on UXP. The other choice stays selectable, for someone about to
upgrade. On Windows, the search reads the registry and `Program Files\Adobe` on every drive; on macOS,
`/Applications`, `~/Applications` and Spotlight.

`scripts/testInstallers.js` covers these rules. The keys need a terminal: to try them without installing
anything, run the script with `TYPER_INSTALL_PROBE=choice`, which prints the choice and stops, and
`TYPER_PHOTOSHOP_VERSIONS="Photoshop 2024=25.0.0"`, which replaces the search.

## Building

```sh
npm run build:uxp       # uxp/: the plugin folder
npm run package:uxp     # Releases/TypeR-UXP.ccx, added to TypeR.zip by scripts/buildRelease.js
npm run test:uxp        # the UXP suites (also run by npm test)
```

Changing `uxp-src/native/typer-keys.m` on macOS rebuilds `typer-keys.json`, and changing
`typer-keys.cs`, `typer-keys.csproj` or `typer-keys.ico` on a system with the .NET SDK rebuilds `typer-keys-win.json`;
commit them.

## Testing in Photoshop

`npm run build:uxp:dev` builds `Releases/TypeR-UXP-dev.ccx`, which can run test code through
`uxp-src/host/devChannel.js` (files under `/private/tmp/typer-uxp-dev`). Install it with Creative
Cloud's plugin installer, which needs no developer mode:

```sh
UPIA="/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"
cp Releases/TypeR-UXP-dev.ccx /tmp/ && "$UPIA" --remove "TypeR"; "$UPIA" --install /tmp/TypeR-UXP-dev.ccx
```

Photoshop loads a first installation at once; an upgrade of an installed version only at its next
start, hence the removal. The package is copied to `/tmp` first: from `~/Desktop` or `~/Downloads`
macOS asks for Creative Cloud's permission. Never ship a dev package.

The behaviour of `photoshop.js` was checked against `host.js` by running both on identical documents
in Photoshop 2026 (the CEP host through `osascript … do javascript`) and comparing the resulting
layers, text descriptors, selection and history: styles, paste, multi-bubble batches, multi-layer
paste and rollback, centering with and without the magic wand, size changes, TextShapeR, rendered
lines, cleaning layers, undo, FontScanR and font lists.
