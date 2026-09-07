# TypeR 3.0.0 release acceptance

## Automated coverage

The release fixes address audit findings A01 through A17: storage recovery, hidden tabs, installation integrity and rollback, document-bound selections, atomic batches, compatible builds, import validation, page headings, complete exports, automatic locale, stable update selection, acknowledged PSD navigation, modal guards, export errors and checked packaging.

`npm run release` runs all regression suites, builds both runtimes, checks required chunks and their inventory, verifies ES5 syntax for the legacy runtime, then writes `Releases/TypeR.zip` and `Releases/TypeR.zip.sha256`. The ZIP includes installation scripts, README, changelog and license. Never package a development watch build: its inventory may be stale.

The build toolchain requires Node 22.12+ (Node 24 is pinned for development and CI). This requirement is separate from Photoshop's embedded Node runtime.

## Runtime selection

The ES5 launcher reads the Photoshop major version and the Chromium user agent. Photoshop 21+ (2020+) with Chromium 74+ uses `modern.html`; all other hosts use `legacy.html`. Both are built from the same source and have the same storage format and features. The legacy build adds fetch, ResizeObserver, CSS variable and layout fallbacks. Old io.js runtimes use compatible Buffer, home-directory and filesystem helpers.

The minimum in the manifest remains Photoshop 16 / CEP 6. Adobe documents Chromium 41 and io.js 1.2 for CEP 6.1 in the [CEP cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md). Runtime selection falls back conservatively if detection fails. ES5 syntax validation is a build check, not a substitute for running the extension in old Photoshop.

## Data and update recovery

Application data remains in `storage*` at the extension root. Each valid save retains `.bak`; damaged originals recovered from a backup are retained as `.corrupt-*`. Import creates `.before-import`. An export from the current profile is not a full backup of every profile: with Photoshop closed, copy all `storage*` files and directories to back up the entire workspace.

Integrated updates check identity, expected version and every inventory checksum before writing. They stage files in `.typer-update-*` and journal replacements in `.typer-update-journal.json`. A failed write restores earlier files. Recovery files are retained if restoration fails. A subsequent integrated installation first retries journal recovery; if the panel cannot start after an abrupt process or power interruption, close Photoshop and run the packaged native installer to restore the complete application. Keep any reported recovery folder until TypeR has been verified.

Offline installers validate and stage the four application directories, then replace only those directories. Keep Photoshop closed for these installations. User storage is left in place. The standalone updater uses the locally shipped installer and rejects old packages lacking the 3.0 inventory. Checksums detect missing/corrupt/mixed files; they do not authenticate an untrusted release producer.

## Local verification on 2026-09-05

The 36 regression suites, both production builds, artifact/inventory checks and ES5 parsing passed locally. `npm audit` reported zero vulnerabilities. `./install_mac.sh` completed successfully and `Releases/TypeR.zip` was generated and verified.

On macOS with Photoshop 2026 (27.7.0, CEP 12 / Chromium 99), the installed panel reopened, restored the existing tabs/styles and loaded its settings dialog at approximately 340 × 430. The live TextShapeR preview reacted to switching to an empty temporary document and back. The two existing unsaved PSDs were kept open. This was a startup/read-only bridge smoke check, not a successful end-to-end layer-creation test. Keyboard focus and selection automation did not yield a reliable manual test, so the full host-operation and keyboard gates below remain open.

## Manual release gates

Record Photoshop, CEP, OS and architecture for each test. Do not infer a passed gate from unit tests.

- [ ] Photoshop CC 2015 on Windows: panel startup, settings and themes, font import/export, shortcuts.
- [ ] Photoshop CC 2015 on macOS where the OS can run it: startup and core workflow.
- [ ] Photoshop 2020+ on Windows and macOS: automatic modern/legacy selection, installation and update restart.
- [ ] At 500 × 700 and a smaller panel: editor overlay, dialogs, RTL, style hierarchy and resizable layout.
- [ ] Real PSD: selection-based creation, text replacement, alignment, point/box text, batch failure recovery and undo.
- [ ] Page headings with colon/title/brackets; rapid forward/back navigation; missing PSD and cancelled save.
- [ ] Toggle multi-tab off, restart, then on; verify scripts and current positions.
- [ ] Save, restart, switch profiles and restore an export with nested folders and unsorted styles.
- [ ] Long typesetting session with TextShapeR scans and repeated undo/redo; verify responsiveness and persistence.
- [ ] Test Windows native installer failure/rollback and update from the previous stable version.
- [ ] Replace or re-record the older video guide if it is promoted with this release.

Publishing the GitHub release/tag and uploading the ZIP are separate from pushing these changes.
