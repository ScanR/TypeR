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
queued and run one at a time, as ExtendScript did. An exception answers `"EvalScript error."`, like CEP.

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
- A size change keeps every style range (bold and italic runs) instead of flattening them to the first.
- FontScanR reads every layer of a document with a background layer; the CEP host missed the topmost.
- Redundant commands are skipped: a temporary channel is only deleted when it exists, and the Middle
  East overrides are only set when the layer does not already have the values (each costs a relayout).

## Panel environment

Synchronous CEP file calls on TypeR's own files (`storage*`, `.typer-update-test.json`, `locale/…`)
are answered from a mirror the host sends at start; writes update the mirror at once and are persisted
by the host (atomic rename, newest content only when writes pile up). Any other path, and the file
dialogs, return promises: their call sites `await` them, which changes nothing in CEP.

Code that needs the plugin host checks `window.typerUXP` (set by `uxp-src/web/cepShim.js`): font files
in a `.zip` export, font installation, update installation and the mouse side buttons. `<input
type="file">` opens the host's dialog and receives File-like objects with a `path`, as in CEP. A fetch
the WebView refuses because of CORS (GitHub release downloads) is made again by the host.

## Keyboard reader

The panel polls `getHotkeyPressed()`; in UXP the answer is the last state the keyboard reader wrote
(`<data>/keys/state`, read every 25 ms), so polling costs nothing. The reader is started once per
Photoshop session through ExtendScript's `app.system`, receives Photoshop's process id and exits with
it. It only reports keys while Photoshop is the frontmost application. Key names follow ScriptUI's
(`LEFT`, `ENTER`, …) and are followed by the names the shortcut recorder uses (`ARROWLEFT`), so
bindings recorded in either version match; the recorder keeps the first name. On macOS it also reports
mouse buttons 4 and 5, which the CEP version only supported on Windows.

## Building

```sh
npm run build:uxp       # uxp/: the plugin folder
npm run package:uxp     # Releases/TypeR-UXP.ccx
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
