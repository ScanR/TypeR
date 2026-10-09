# Changelog

## 3.0.0

### UXP plugin

- Add a UXP plugin for Photoshop 2025 and later (`TypeR-UXP.ccx`), which runs natively on Apple Silicon without Rosetta. It is the same application as the CEP extension, with the same features, layout and saved styles.
- Import the styles, profiles and settings of an installed CEP TypeR on first start, and keep the plugin's data outside Photoshop's version-specific folders.
- Keep the global shortcuts through a small keyboard reader, which also reports mouse buttons 4 and 5 on macOS.
- Read bubble and selection shapes from the selection mask, leave no history state for reads, and fix size changes on layers with floating-point colors, size changes on rich text and FontScanR on documents with a background layer.
- Install updates from the panel through Creative Cloud's plugin installer.

### Workspace and typesetting

- Keep every script tab and the active tab when multi-tab mode is hidden.
- Recognize complete page headings, including `Page 12 :`, `Page 12 : title`, `Page 12 - title`, `[Page 12]` and Markdown headings. Mentions of a page inside dialogue remain dialogue.
- Serialize PSD navigation and record the opened page only after Photoshop confirms success.
- Bind captured bubble selections to the current Photoshop document and session.
- Validate a batch before creating layers and restore Photoshop history if a batch fails.
- Preserve undo history during temporary TextShapeR scans.
- Refine compact panel settings, the active-size modifier and keyboard workflows.
- Select styles 1 through 9 in the current folder with the numeric keypad while the panel has focus and no text field or modal is active.

### Data and interface

- Save through temporary files with a last-valid backup; preserve corrupt originals and expose save failures with recovery export.
- Block profile switching when pending changes cannot be saved.
- Validate imports before merging them, reject cyclic folder hierarchies and create a pre-import backup.
- Preserve size presets, disabled prefixes and all supported style export fields; include styles without a folder.
- Report failed JSON exports and keep the export dialog open.
- Respect automatic localization and modal close guards; apply Middle East settings only when saved.

### Compatibility and distribution

- Ship modern and compatibility builds in one package. Photoshop 2020+ with Chromium 74+ loads the modern build; older or unknown hosts load the compatibility build.
- Keep Photoshop CC 2015 / version 16.0 as the declared minimum. The compatibility build uses ES5 JavaScript, legacy layout fallbacks and browser/Node compatibility helpers.
- Validate release identity, version and SHA-256 inventories before installation. Stage files and restore the previous installation on failure without replacing user storage.
- Keep old content-addressed chunks available to an already running panel during an integrated update.
- Use stable, installable releases only; compare prerelease versions correctly and distinguish update-check failures from an up-to-date result.
- Bound network requests, including response body downloads.
- Produce `Releases/TypeR.zip` and its checksum after tests and artifact checks, with the README and license included.
- Run regression tests and release checks in CI on Windows, macOS and Linux; update build dependencies.

### Validation limits

Automated host tests simulate Photoshop operations. They do not certify every Photoshop/OS pair. Release acceptance still requires real CEP testing on CC 2015 and a current Photoshop version, on both Windows and macOS, including a long typesetting session. The existing video guide describes an older workflow; use the in-panel walkthrough for the current interface.
