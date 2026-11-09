# "No response from the WebView": Photoshop refuses the WebView, TypeR runs without it

Fix shipped in 3.0.2. Investigated and verified on 2026-11-07 on a Windows 11 VM (build 26300)
where the bug reproduced every time: Photoshop 2026 **27.9.1**, UXP **9.3.0**, Microsoft Edge
WebView2 Evergreen 156/157 installed, Adobe's own WebView2 copy 140.0.3485.94.

## Symptom

The new (UXP) TypeR panel stays empty, then shows after 15 s:

```
TypeR could not display its interface.
No response from the WebView (15 s).
Photoshop 27.9.1 / UXP uxp-9.3.0-uxp / win32
WebView load: start=false, stop=false, bridge=false
```

Not a single load event reaches the host page, and Reload TypeR or restarting Photoshop never helps.
The Legacy (CEP) panel works on the same computer.

## Root cause

UXP **never creates any third-party WebView** in such a Photoshop. Its UXP log
(`%APPDATA%\Adobe\Adobe Photoshop 2026\Logs\UXPLogs_<date>_<time>_<n>.log`) says, at each
attempt, the instant TypeR's `<webview>` asks for one:

```
[Warn] [general] WebViewManager::createWebView() failed to create WebView because webViewDataStorage_ is not available
```

`webViewDataStorage_` is the WebView data storage UXP keeps per Adobe user for third-party plugins,
`%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\<major>\WebView\<user hash>\3P`. UXP builds it from the
**signed-in Adobe user's id**. A Photoshop without an Adobe user never gets it, so every
third-party WebView is refused for the whole session.

Such Photoshops: **Feature Restricted Licensing** (FRL: enterprise/education offline, isolated or
LAN licences), and offline or modified ("repacked") installations. The same UXP log says so through
Photoshop's own panels:

```
[console] ... [HS] [imsBridge] FRL user. No access token present
[console] [DP] UXP-IMS Error: Error fetching IMS access token {"message":"There is no valid user profile to get an access token"}
```

A signed-in user whose identity arrives a few seconds after Photoshop starts can hit the same refusal
for a WebView asked for in those seconds (the user's log of 2026-11-04: refused 4 s after launch, a
reload later worked). That variant could not be reproduced here (no Adobe account on the VM).

### Evidence

| Check | Result |
| --- | --- |
| Photoshop restarted normally, TypeR open at launch | Refused at once and at TypeR's +5 s retry; no `WebView2BrowserVersion` line in the whole session (no WebView started); no `msedgewebview2.exe` child of Photoshop |
| Previous session left running for 17 hours | Never a single `createWebView() create new for thirdparty plugin`: not a race, the storage never comes |
| Photoshop started with `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` on Microsoft's Evergreen 157 | Same refusal, same timing: **not** a WebView2 runtime problem, the check happens before any runtime is touched |
| `%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\` | Only `External` and `Internal`: the `WebView` folder is never created |
| UXP log of the session | `FRL user. No access token present`, `There is no valid user profile` |
| A working machine's log (`.update-test/webview-storage-baseline`) | `WebView2BrowserVersion: 156.0.4314.58` then `createWebView() create new for thirdparty plugin`, 6 s after launch |

In `dynamic-torqnative.dll` 9.3.0.0 (Photoshop 27.9.1), disassembled:

- `WebViewManager::createWebView` (RVA `0x23edc00`) starts with `cmp qword ptr [this+0x50], 0`:
  when the storage member is null, it logs the line above, **queues the request** (vector at
  `this+0x150`) and returns no WebView. Nothing is sent back to the plugin: no `loaderror`, no event,
  hence `start=false, stop=false, bridge=false`.
- The storage path is built from `"WebView"`, a user hash and `"/1P"` / `"/3P/"` (RVA `0x23e8d80`,
  `0x23ed780`). The DLL exports `UserInfoController::hashUserId` and logs
  `UserId is not available from the UserInfoProvider.` when there is no user.
- UXP 9.3 gives third-party plugins no `uxp.userInfo`, so a plugin can neither read the user id
  nor provide one.

No manifest setting, environment variable, runtime or folder tested here makes unmodified UXP create
the WebView. TypeR can work without it. The native storage repair below additionally fixes the
initialization on explicitly reviewed Windows DLLs; it is not a universal UXP binary patch.

The earlier causes stay what `docs/uxp.md` says (no WebView2 runtime Photoshop can start:
`Failed to create WebView for plugin: com.scanr.typer`). The fix below covers them too.

## The fix: TypeR in the panel itself

The panel's application never depended on the WebView as such. It talks to the plugin host only
through `uxp-src/web/bridge.js` (JSON messages). UXP's own panel DOM can run React. So the same
application is built a second time for that DOM and started in the panel when the WebView is
refused.

### How it switches

`uxp-src/host/main.js`:

1. The WebView is asked for as before (`attachView`, `showPanelPage`).
2. **Windows:** a unique console marker identifies the current WebView attempt in the actual
   Photoshop session log. `watchWebViewRefusal` reads it at 1.5, 7 and 15 seconds. Two observations
   of a refusal, no bridge, a visible nonzero view and 15 seconds of grace are required to switch.
   A refusal from another installation or before the marker cannot authorize a repair. Hiding the
   panel invalidates pending reads; showing it starts a fresh visible grace period, including when
   Photoshop created the panel hidden long before it was opened.
3. **Every platform:** a WebView with no bridge after **30 seconds** uses the native panel, even if
   it emitted `loadstart`/`loadstop`. Explicit `loaderror` before the bridge also uses the fallback.
   There is no forced navigation at 5 seconds. Application errors and a bridge whose host init
   stalls retain their diagnostics instead of being misidentified as a renderer failure. Diagnostic
   log failures do not delay fallback. A zero-sized view is allowed another waiting period.
4. `enterInPanel` removes the `<webview>`, bumps the view generation (late WebView messages are
   ignored) and calls `inPanel.startInPanel`. From then on `post()` delivers to the application
   directly, and its messages go through the same `handlePanelMessage` as the WebView's (requests,
   ready, appReady, errors, de-duplication of request ids).
5. Once in the panel, TypeR stays there for the life of the plugin. When Photoshop destroys and
   recreates the panel, a new instance starts in it (`restartInPanel`) without asking for a WebView
   again. `window.location.reload()` (Reload, after an update) reloads the plugin page: the host
   starts over and switches again within seconds (checked).

### The second build

`webpack.uxp.config.js`, `inPanelConfig` → `uxp/inpanel/inpanel.js` + `inpanel.css` (Windows and
macOS packages alike; `scripts/buildUxp.js` requires both in the .ccx):

- Entry `uxp-src/web/inpanel/entry.js` = the WebView entry, plus the stylesheet for UXP's layout
  engine and the element replacements.
- **One file**: lazy chunks folded in (`LimitChunkCountPlugin`). UXP's `require()` loads it.
- **Re-runnable**: wrapped as `module.exports = function startTypeRInPanel() { ... }`, because
  `require()` caches. Each call is a fresh webpack runtime.
- `window.require` is defined as `undefined` for the application. In the panel, the global `require`
  is UXP's, and the application would otherwise take it for CEP's Node (storage writes through
  `openSync` failed and showed "TypeR could not safely read or save your data").
- `exportsPresence: "error"`: an icon imported by `app_src` without its replacement fails the build.
- No `eval` and no `new Function` reached: the release manifest does not allow code generation.

`uxp-src/host/inPanel.js` inserts the stylesheet, the page elements the application expects
(`#topcoat`, `#hostStyle`, `#app`) and the channel `window.__typerInPanel`. It requires the bundle and
runs it. Both directions go through `setTimeout(0)`, like postMessage.

`uxp-src/web/bridge.js` uses that channel when it exists (`runsInPanel`). `entry.js` marks
`html.typer-inpanel` and skips the fetch fallback (UXP's fetch has no CORS, and the host's `fetchUrl`
uses it: the fallback would call itself).

### What UXP's panel DOM does differently (measured in Photoshop 27.9.1)

| UXP behaviour | Consequence | Handling |
| --- | --- | --- |
| `<button>` is a native widget showing only its text: an `<svg>` child is laid out at 0×0, and it is drawn above the page | Every icon button empty | `uxp-src/web/inpanel/elements.js` renders the application's buttons as `<div role="button" class="typer-button">` (click, Enter/Space, `disabled`, `type="submit"`); `scripts/inPanelCss.js` rewrites `button` selectors to `.typer-button` and `:disabled` to `[disabled]` |
| A `<div>` standing for a button has none of Chromium's button defaults: centred text and content, inline-block, 13.33 px system font | Icons above their label and to the left, labels in Tahoma | `style.scss` starts with Chromium's button defaults on `.typer-button` (one class: the application's rules, later, win as they win over a browser's) |
| `<svg>` is `display: block`, and an inline one sits at the top of its line, where a browser's button centres its content; an 18 px icon overflowing a 27 px padded square starts on the left instead of centred | Paste, Align, Add folder, Add style: icon over the label; arrow buttons off centre | `svg { display: inline-block; vertical-align: middle }` (element selector); no side padding on the square icon buttons |
| SVG: no strokes at all, `fill="none"` ignored on the `<svg>` root (shapes filled black), `currentColor` is black; `fill` from a stylesheet rule, `var()` included, works | Feather (`fi`), Tabler (`tb`) and the Font FindeR logo turn into black blobs; one fixed icon colour is invisible on the white sheet (line icons) | Aliased to Remix "Line" fill icons (`iconsFi.js`, `iconsTb.js`, `fontFinderLogo.jsx`). `svg[fill="currentColor"] { fill: var(--typer-icon) }`, and `currentColor` is emulated: every `color` of the stylesheet sets `--typer-icon` too (`inPanelCss.js`), as do the theme's colours (`themeManager.js`) and inline colours (`elements.js`); a custom property inherits as the colour does. Material's empty `fill="none"` framing path renders correctly |
| A native field paints any background that is not opaque — `rgba(0,0,0,.22)` of the dark theme, `transparent` of fields drawn inside a frame — in **black**; an inline `!important` loses to a stylesheet `!important` | Black boxes: size field, searches of Settings and Help, style editor fields | `elements.js` composes, at run time, the field's translucent background over the backgrounds under it up to the first opaque one (as a browser shows it) and sets that colour inline; on render, focus changes and once a second (theme). The fields' background rules lose `!important` (`inPanelCss.js`) |
| A flex item does not shrink to its min-content width | The line arrows side by side instead of one above the other | `.preview-nav` is a column |
| `mouseout`/`mouseover` carry no `relatedTarget` (the `pointerout`/`pointerover` UXP sends just before them do): React takes every `mouseout` for the pointer leaving the window and fires `onMouseLeave` on every ancestor | Dragging a divider (text/styles, preview) stopped at once: the panel body ends the drag on `mouseleave`; hover states flickered | `elements.js` gives each `mouseout`/`mouseover`, in place, the `relatedTarget` of the pointer event of the same move, before React reads it. Nothing is dispatched again: **a synthetic event's dispatch is asynchronous in UXP and sometimes throws inside it** (`dispatchNativeEvent … reading 'detail'`, a first version that re-sent `mouseout` did that at every hover) |
| `window` gets a trusted `resize` at every layout change, the panel's size unchanged | During a divider's drag the blocks jumped back to their saved size at each hover (the application lays its blocks out again on `resize`) | Dropped while a mouse button is held. The others go through on purpose: UXP lays a page out after the script that changed it (a new element measures 0×0), and those events make the application measure again what it measured too early (dropping them all left the footer in its compact, labelless mode) |
| `click` goes to the element the button was released over, wherever it was pressed (a browser sends it to the nearest element holding both) | A divider dragged and released over a folder's title folded the folder; any drag ending on a button pressed it | `elements.js` retargets the `click` in place to the nearest common ancestor of the press and the release, before React reads it. A click that slides within a button stays a click on it |
| `<input>`, `<textarea>`, `<select>` are native fields, opaque, drawn above every element (windows included); they ignore `left`/`right` with `width: auto` | The script editor's transparent textarea hides the highlighted lines; fields of the panel show through windows | The editor shows its lines and opens a plain textarea over the visible sheet on click (`textBlock.jsx`, `IN_PANEL`), with its box set in pixels; `modal.jsx` sets `body.typer-modal-open` and the panel's own fields are hidden under a window |
| Hit testing goes to the sheet, not to the layers drawn over it | A click on the text did not start editing | The `mousedown` is listened to on the sheet itself |
| No CSSOM (`style.sheet` undefined) | `themeManager.addRule` threw at startup | Rules rewritten into the `<style>` text, one value per selector and property, only when it changes |
| No `MutationObserver`; `Range` without `selectNodeContents` | The bold/italic toolbar's position threw | Guarded; falls back to the selected span's box |
| No sibling combinator (`~`) | | Body class instead |
| React's development build cannot report component errors (its fake-event trick) | Only in dev builds | Test with `--mode=production --env dev` |
| **Crash:** an empty `<input type="number" class="topcoat-text-input--large" placeholder="…">` with the application's `::placeholder` rules brings Photoshop down a few seconds later (access violation `0xc0000005`, `dynamic-torqnative.dll+0x433f94`). Found by bisecting the style editor's leading field | Opening **Add style** killed Photoshop | `scripts/inPanelCss.js` drops every rule about placeholders from the in-panel stylesheet (only the hint text's colour is lost). Proven on the real stylesheet: same field, rules removed → no crash |

`scripts/legacyCss.js` (gaps for old Chromium) runs on the in-panel stylesheet too.

### What is different for the user in that mode

Everything works the same: script, lines, pages, styles, folders, Paste, Align, TextShapeR, smart
paste, settings, keyboard shortcuts (TypeR Shortcuts.exe; Settings > Debug shows the samples),
storage, reload. Differences:

- The script is edited in a plain field that opens on a click on the sheet (caret on the clicked
  line) and closes when it loses focus. The coloured lines are shown the rest of the time.
- Text fields, number fields and lists are Photoshop's native ones: the same colours, but UXP draws
  its own frame around every field (the size field next to Paste/Align shows one where the WebView
  shows none) and lists are a little taller.
- Some icons are their Remix equivalents. Placeholders keep their default colour.

The panel was compared with the WebView panel of a real Windows (same theme): buttons, icons,
arrows, line icons, style list, footer, settings match; the differences left are the ones above.

## Verified on the VM (release package `UXP-Windows.ccx`, the build that ships)

- Start with Photoshop: refusal in the log, switch to the panel about 2 s later, application ready.
- Script pasted with Ctrl+V into the editor, parsed (page markers, comment prefix, numbering),
  kept across a Photoshop restart.
- Line selected, **Paste** with a selection: `smartPaste` → `createTextLayerInSelection`, the text
  layer "And here is a second line of dialogue." created, TypeR moves to the next line.
- TextShapeR previews, tooltips, feature tips, Did-you-know notices.
- **Add style** (whole window, including the field that used to crash), **Settings** (all 9 tabs:
  themes, interface layout, sliders, toggles, Debug with the keyboard reader running), Close.
- `location.reload()` → host restarted → back in the panel with the same state.
- Dragging the divider between the script and the styles (300 px kept after a restart); style
  created in the editor and shown in its folder; side by side with the WebView panel of a real
  Windows.
- Development builds: dev channel `.update-test/dev-eval.ps1`, panel target included.

Regression tests include `scripts/testUxpStartup.js` (confirmed session-log refusal → panel; 30 s without a
bridge → panel; a refusal older than the WebView ignored; messages, requests run once,
replies, visibility; destroyed and recreated panel; load events without a bridge still recover; application errors keep the notice; a late
report cannot replace a recovered WebView) and `scripts/testUxpInPanel.js` (log line times, refusal
detection, stylesheet rewrite including the placeholder rules, every stroke icon of `app_src`
replaced by an existing Remix icon).

## Not verified

- **macOS**: same UXP code and the same in-panel build in `TypeR-UXP.ccx`, but not run on a Mac.
  There, without the log reading, the switch happens at the 30 s deadline or on an explicit pre-bridge load error.
- The signed-in user whose identity arrives late: TypeR switches to the panel instead of waiting
  for a WebView that might come a few seconds later. It works, in the panel mode, for that session.
- Windows other than the ones the application opens in this check (font viewer, FontScanR, export,
  folder editor, update): they rendered as part of the same components, without crash, but were not
  each opened by hand. Any new crash found in UXP's DOM is handled like the placeholder one: bisect
  with CSS (`display: none`) in a development build, then reproduce with a single element.

## Native storage repair in 3.0.2 (Windows)

Verified on this VM on 2026-11-07: Photoshop 27.9.1, UXP 9.3, Windows x64. The original DLL's
SHA256 is `cded92ca1e7563126e1433ecbca50cb9a8e141f48a15d1a4c6739c44f8d9f714`; the repaired
SHA256 is `c2974a41e0a479fb588308f500e6548870fa758115b3f5c16beb523ebec78440`.

`installer/repair_uxp_webview_win.ps1` replaces 45 bytes at file offset 37673245 (RVA `0x23ee51d`).
This is the empty-storage-name branch of the initializer at RVA `0x23ee3d0`, not the null-pointer
guard in `createWebView`. It fills only the initializer's stack-local empty `std::string` with
`typer-offline`, then rejoins the existing locked constructor path at RVA `0x23ee420`. The real
storage object is constructed, preloading and queued requests use the existing UXP code, and the
null-storage guard stays intact. Nonempty storage names take their original path. The user provider
and Adobe sign-in/licensing functions are not modified. This affects Photoshop's WebView manager,
including other plugins, rather than only TypeR.

After the repair, the native log showed `WebView2BrowserVersion: 157.0.4341.42` and third-party
WebView creation while the Adobe panels still reported FRL/no access token. TypeR's page reached
`app` at 1264 ms and `painted` at 1274 ms after page navigation, reported `typer-uxp` without
`typer-inpanel`, and a request through its real WebView bridge returned Photoshop's document/history
state. The first cold launch still exceeded TypeR's 15-second limit and used the fallback; a subsequent
restart displayed the WebView normally. These page timings are not total Photoshop launch times.

### Additional DLL profiles (2026-11-09)

The user supplied DLLs under folders `27.7`, `27.9`, and `27.10`. Their embedded versions are
UXP 9.3.0, 9.3.0 and 9.4.1 respectively. The supplied `27.9/dynamic-torqnative.dll` was already
patched; its accompanying verified `.bak` was used as the original. No supplied file was modified.

The initializer's 640-byte region is identical in the 27.7 and original 27.9 DLLs. The 27.10
initializer retains the same stack-local string (`rsp+0x48`, length at `rsp+0x58`), empty-name branch,
locked storage construction, and cleanup. Its call relocations and addresses differ. Each profile
records full original/patched SHA256, length, patch bytes, offset and the analyzed function region.

| Supplied version | File patch offset | Initializer RVA | Resume RVA | Original SHA256 | Patched SHA256 |
| --- | --- | --- | --- | --- | --- |
| 27.7 | `0x23ed91d` | `0x23ee3d0` | `0x23ee420` | `2a57cb50444945b9d3a7f05b5ee40970930e31dd80e5de132a026e1068b7cded` | `5dedd8c31986a87e18b29aac41d51fd70264bbba1762383e1a0bfcd6365acc22` |
| 27.9 | `0x23ed91d` | `0x23ee3d0` | `0x23ee420` | `cded92ca1e7563126e1433ecbca50cb9a8e141f48a15d1a4c6739c44f8d9f714` | `c2974a41e0a479fb588308f500e6548870fa758115b3f5c16beb523ebec78440` |
| 27.10 | `0x3ace57d` | `0x3acf030` | `0x3acf080` | `45c7e9b7c4512f2322bbc7ba7c5efb1786a51f666977ce2da511d9ce6473ca2a` | `951afe306f43e8849532ac5d28d19e01e91121f1dc775b0bc7a63d36fcb01aef` |

The existing 45-byte replacement can be used for each reviewed profile because the stack layout
and relative jump back to the constructor are identical. It still modifies ONLY the empty-name
branch. The real user-info provider, licensing and the createWebView null check are unchanged.
Version strings and short instruction patterns alone never authorize a repair.

### Structural recognition for subsequent builds

An unknown hash can also be recognized by `adaptive-storage-layout-v1`. The helper locates a unique
511-byte initializer in executable x64 PE sections, then verifies its complete storage constructor
(446 bytes), string-copy function (195 bytes), and user-info provider (291 bytes). These four function
layouts match across the supplied originals after normalizing only relative call/RIP displacements.
Opcodes, stack offsets, constants and internal branches must match exactly. The helper also checks
PE exception-table function boundaries, mapped call/data destinations, expected imported function
names, the UTF-16 `WebView` literal and shared call/data relationships. Call trampolines are followed
with a bounded limit. Ambiguous matches, changed logic and unsupported architectures are refused.

This supports relocation and unrelated binary changes without adding each new SHA256 to the catalog.
It does not prove compatibility with every future Photoshop: a compiler or implementation change can
require a new reviewed layout, and unchanged callers do not prove all their dependencies unchanged.
The confirmed current-session storage refusal remains required for the automatic offer.

The adaptive profile computes full original and expected patched hashes before writing and uses the
same staged replacement and exact-backup checks as catalog profiles. Recognizing an already patched
adaptive DLL requires its verified original backup, re-analyzed from scratch; a receipt alone never
authorizes restoration. An Adobe update that changes the installed patched hash is never overwritten
with an older backup. `Inspect` reports the selected profile or a structural refusal reason.

Regression fixtures exercise relocated functions, changed headers, incompatible function bodies,
imports, storage literals, call relationships, function boundaries, ambiguous matches, trampoline
loops, wrong architecture and truncated files. Adaptive Apply/Restore is also tested on disposable
copies of the supplied originals with changed unused DOS-header bytes to force an unknown hash:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/testUxpWebViewRepair.ps1 -ProfileId photoshop-27.10-win-x64 -OriginalDll 'D:\copies\dynamic-torqnative.dll' -Adaptive
```

Validation for the added profiles: disassembly and actual PowerShell Apply/Restore tests on temporary
copies of all three originals, including exact output hashes, byte-identical restoration and backup
failure cases. These tests run on macOS with PowerShell 7; they do **not** validate Windows UAC or
actual Photoshop 27.7/27.10 execution. The earlier 27.9.1 VM results above remain separate evidence.

To test a reviewed original without modifying the installation or the input file:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/testUxpWebViewRepair.ps1 -ProfileId photoshop-27.10-win-x64 -OriginalDll 'D:\copies\dynamic-torqnative.dll'
```

Without `-OriginalDll`, the test uses a disposable synthetic fixture. `npm test` runs every profile
on Windows; on another OS, set `TYPER_POWERSHELL` to the PowerShell executable to enable these tests.

Adobe confirmed the same FRL failure as **UXP-24381**, fixed in **UXP 9.5**, on
[2026-10-15](https://forums.creativeclouddeveloper.com/t/uxp-webview-component-doenst-work/12307/14).
That announcement is not evidence that every Photoshop already contains the fix. Prefer Adobe's
fixed runtime when available; retain the native fallback for older or otherwise failing renderers.

### All installation and update routes

`webViewRepair.js` is part of the common plugin host. Webpack embeds the same repair script and its
source hash in Windows, cross-platform/macOS and addon builds (the script only runs on Windows).
There is no bare PS1 or Adobe DLL in a CCX. This means even an older updater that knows nothing about
the repair installs a plugin that can perform it. Direct CCX, manual/local installation, CEP migration,
UXP updates and the automatic Windows package swap converge on this same detection at first launch.

Only a current-session native `webViewDataStorage_` refusal triggers it. A runtime failure, generic
timeout or macOS does not. The fallback starts after the confirmed refusal grace period; repair is offered only after its
`appReady` message. A generic timeout never authorizes a DLL write. The helper:

1. Identifies the Photoshop executable that actually hosts TypeR and checks the entire DLL hash.
2. For unknown hashes, requires the complete compatible storage layout above; otherwise leaves the binary unchanged without requesting elevation.
3. Explains that it changes a Photoshop file, offers Cancel, requests Windows UAC only after OK, and waits for Photoshop to close normally (up to 24 hours).
4. Verifies and preserves an exact original backup, stages and verifies the repaired file, checks
   Photoshop is still closed and the original unchanged, then replaces the DLL and verifies it again.
5. Reports completion before the user restarts Photoshop. It never closes or kills Photoshop or documents.

A per-user/per-installation mutex prevents overlapping helpers. A separate mutation mutex serializes
Apply and Restore, including explicit support commands. Worker failure/timeout receipts are preserved. Receipts under
`%APPDATA%\TypeR\UXP\webview-repair\<script hash>\<path key>\status.json` record the outcome.
Declined UAC, failures and timeouts are not retried automatically by the same helper revision.
An already repaired DLL needs no UAC or restart. Tests cover original/repaired/unknown binaries,
exact restoration, missing/corrupt backups, wait timeout, quoted paths, concurrency in the host,
bounded launch retries and all package build variants. The automatic path was also tested on the VM:
restore original -> launch new host -> refusal/fallback -> UAC -> wait for normal exit -> repaired hash.

### Restore / support

With Photoshop closed, in an administrator PowerShell at the repository/extracted release root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer/repair_uxp_webview_win.ps1 -Action Inspect
powershell -NoProfile -ExecutionPolicy Bypass -File installer/repair_uxp_webview_win.ps1 -Action Restore
# Custom installation: add -PhotoshopPath 'E:\Adobe\Photoshop\Photoshop.exe'
```

`Apply` is also available for support. `Auto -Retry` explicitly retries a previously declined/failed
automatic attempt; supply the same `-ReportPath` to update its receipt. Restore refuses to overwrite
a DLL that changed since the experiment, including an Adobe update, or to use a damaged backup.
Restore also writes an opt-out marker beside the DLL so the plugin will not automatically reapply
the repair. An explicit `Apply` re-enables it. This opt-out is independent of the plugin/helper version.

Limits: exact catalog hashes and strictly recognized Windows x64 layouts are supported. Unrecognized
Photoshop/UXP binaries and macOS keep the fallback. Patching changes the DLL's signed contents, and Adobe updates may replace it.
Late Adobe sign-in/account switching, all other plugins, and other native builds have not been
validated. The empty-name path no longer waits for a late identity: testing those transitions is
required before claiming universal compatibility.

## Reproduce / investigate

The VM tooling used (`.update-test/dev-eval.ps1` runs code in the host or the panel of a development
build):

```powershell
# Development build with production React (React's dev build hides component errors in UXP)
npx webpack --config webpack.uxp.config.js --mode=production --env dev
node scripts/buildUxp.js --dev
# Mirror uxp\ over the installed plugin folder, restart Photoshop, then:
.\.update-test\dev-eval.ps1 -Id 1 -Target panel -Code "return document.documentElement.className"
# → "typer-uxp typer-inpanel" when TypeR runs without its WebView
```

The UXP log lines that tell the state of a session:

| Line | Meaning |
| --- | --- |
| `WebViewManager::createWebView() failed to create WebView because webViewDataStorage_ is not available` | No WebView storage (no Adobe user): every third-party WebView refused |
| `Failed to create WebView for plugin: com.scanr.typer` | No WebView2 runtime Photoshop can start |
| `WebView2BrowserVersion: …` then `createWebView() create new for thirdparty plugin` | WebViews work |
| `TypeR: no WebView (…), running in the panel itself` | TypeR switched, with the reason |
