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
  - `files.js` — TypeR's storage files, the one-time import of a CEP install's storage.
  - `services.js` — file dialogs, files the user picks, font files, font installation, updates, fetch.
  - `keysHelper.js`, `keyboard.js` — start and follow the keyboard reader.
  - `jsx.js` — the few ExtendScript calls UXP cannot replace (`app.system`, `app.refreshFonts`).
  - `devChannel.js` — development builds only, see *Testing in Photoshop*.
- `uxp-src/web/` — the panel's entry: rebuilds the CEP environment the application expects
  (`CSInterface`, `cep.fs`, `cep.util`, `__adobe_cep__`) before loading `app_src/index.jsx`,
  plus `webkit.scss` for the few places WebKit lays the same CSS out differently.
- `uxp-src/native/` — keyboard readers: `typer-keys.m` (macOS, shipped prebuilt as
  `typer-keys.json` because a `.ccx` may not carry a bare executable) and `typer-keys.ps1` (Windows).
- `webpack.uxp.config.js`, `scripts/buildUxp.js` — build and packaging.

## How a host call travels

`csInterface.evalScript("setActiveLayerText({...})", callback)` in the panel becomes a message to the
host. `uxp-src/host/evalScript.js` parses the call (it is never evaluated), `main.js` runs the method of
`photoshop.js` with the same name, and the string result goes back to the callback. Host calls are
queued and run one at a time, as ExtendScript did. An exception answers `"EvalScript error."`, like CEP;
so does a call still running after its time limit (60 s, 10 min for scans, document opening and font
lists, none for dialogs), and the queue goes on.

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
by the host (atomic rename, newest content only when writes pile up). Any other path, and the file
dialogs, return promises: their call sites `await` them, which changes nothing in CEP.

Code that needs the plugin host checks `window.typerUXP` (set by `uxp-src/web/cepShim.js`): font files
in a `.zip` export, font installation, update installation and the mouse side buttons. `<input
type="file">` opens the host's dialog and receives File-like objects with a `path`, as in CEP. A fetch
the WebView refuses because of CORS (GitHub release downloads) is made again by the host.

## Keyboard reader

The CEP panel polls `getHotkeyPressed()`; in UXP the keyboard reader writes the state to
`<data>/keys/state`, the host reads it every 25 ms and pushes each change to the panel, which matches it
at once (`typerUXP.onKeys`), so a short press is not lost between two polls. The reader is started
through ExtendScript's `app.system`, receives Photoshop's process id and exits with it. It writes
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

- The offer opens a few seconds after startup, once no other window is open, when Photoshop is 2025
  (26.0) or later, Creative Cloud's plugin installer is present and TypeR UXP is not installed. It is
  shown only to existing users with update checks on. "Later" asks again a week later, "Don't ask
  again" stops it, and Settings > General > Updates keeps a button.
- The panel downloads `TypeR-UXP.ccx` from the latest release, checks that it is a TypeR plugin, and
  hands it to the plugin installer through the panel's Node.js (`child_process.execFile`, no
  ExtendScript). Photoshop loads a first installation at once.
- TypeR UXP imports the Legacy styles, profiles and settings on its first start. The Legacy version
  stays installed; the panel offers to close it.
- Without Creative Cloud's plugin installer (Photoshop installed without the Creative Cloud app),
  nothing is offered: TypeR UXP could not update itself either.

Every release must therefore publish `TypeR.zip` and `TypeR-UXP.ccx`, and no other `.zip` whose name
contains "typer".

Test it without publishing anything: `npm run package:uxp`, then `npm run test:uxp-migration` serves
a local release holding the `.ccx` and writes `.typer-update-test.json` (`forceUxpMigration`) into
the installed Legacy extension. The Legacy panel then offers the switch whatever the Photoshop version
or the installed plugins. Ctrl+C removes the test file.

## Building

```sh
npm run build:uxp       # uxp/: the plugin folder
npm run package:uxp     # Releases/TypeR-UXP.ccx, added to TypeR.zip by scripts/buildRelease.js
npm run test:uxp        # the UXP suites (also run by npm test)
```

Changing `uxp-src/native/typer-keys.m` on macOS rebuilds `typer-keys.json`; commit it.

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
