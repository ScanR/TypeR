# Changelog

## 3.0.0

### UXP plugin

- Add the new TypeR, a UXP plugin for Photoshop 2025 and later (`TypeR-UXP.ccx`), which runs natively on Apple Silicon without Rosetta. It is the same application as the CEP extension, with the same features, layout and saved styles.
- Import the styles, profiles and settings of an installed CEP TypeR on first start, and keep the plugin's data outside Photoshop's version-specific folders.
- Keep the global shortcuts through a small keyboard reader, which also reports mouse buttons 4 and 5 on macOS.
- Read bubble and selection shapes from the selection mask, leave no history state for reads, and fix size changes on layers with floating-point colors, size changes on rich text and FontScanR on documents with a background layer.
- Install updates from the panel through Creative Cloud's plugin installer.
- The installers start by asking whether to install the new TypeR (UXP) or the Legacy (CEP) version, and the release archive contains the UXP plugin, so it installs offline.
- The Legacy panel offers the switch to the new TypeR (UXP) when Photoshop can run it (2025 or later, with the Creative Cloud app): one click installs it, and it imports the styles, profiles and settings.

### Smart paste

- Paste fits the translation to the bubble's real outline: the style size is kept when the text fits and shrinks
  as little as possible otherwise, down to a minimum size (85% by default), the lines follow the bubble's silhouette, the ink is centred
  inside the outline, and one French or English hyphen is allowed only as a last resort.
- Black bubbles get white text without a stroke. A style can be marked as the Shout or Narration style of its
  folder; spiky bubbles and rectangles then use it, unless the script line has its own prefix style.
- Double and triple bubbles receive the next script lines in their other chambers, in one history state.
- Optional Auto clean paints the bubble under the text on a `TypeR Clean` layer (solid white or black only).
- Conditional refont rules give the text between two markers another style's font.
- When the text cannot be placed, the classic paste runs and a short notice explains why.
- Multi-bubble batches select each stored bubble again and paste it with the smart paste.
- Align knows double and triple bubbles: each selected text is centred in its own chamber instead of on the
  neck of the whole bubble, and a single text goes to the chamber it sits in (or the nearest one).

### Paste on click

- A Magic Wand click, a rectangle or a lasso can paste the current line at once (footer toggle and shortcut).
- Undoing a TypeR paste in Photoshop puts the script line back (live in UXP, checked lazily in Legacy).
- Clicking a bubble again right after it got one line splits it: TypeR undoes that paste and pastes the line and the next one, one per chamber, for double bubbles it did not detect (bubbles clipped by the panel frame, offset boxes).

### Workspace and typesetting

- Add a shortcut to assign that turns the selected style's stroke on or off, keeping its size and color. A style with an active stroke shows a frame of that color in the list.
- Fix the + and - size buttons on text layers resized with Ctrl+T: + made the text smaller, and now both change the displayed size by one step and keep the line breaks.
- Add a style option that sets lines made only of punctuation, like `?!` or `!!`, at twice or three times the size.
- Add contextual alternates and the single-line composer to the style editor, and turn on standard and contextual ligatures for new styles.
- Preview fonts in the style editor: the font and weight lists show each entry in its own font, and the font list has a search field (word order, spaces and accents are optional).
- Keep every script tab and the active tab when multi-tab mode is hidden.
- Keep the script's page and line highlights on their text: they no longer drift by one or more rows after the panel is resized, on bold or italic lines close to the wrap limit, or on scripts containing stray carriage returns.
- Recognize complete page headings, including `Page 12 :`, `Page 12 : title`, `Page 12 - title`, `[Page 12]` and Markdown headings. Mentions of a page inside dialogue remain dialogue.
- Serialize PSD navigation and record the opened page only after Photoshop confirms success.
- Bind captured bubble selections to the current Photoshop document and session.
- Validate a batch before creating layers and restore Photoshop history if a batch fails.
- Preserve undo history during temporary TextShapeR scans.
- Refine compact panel settings, the active-size modifier and keyboard workflows.
- Select styles 1 through 9 in the current folder with the numeric keypad while the panel has focus and no text field or modal is active.
- Fix right-to-left text (Arabic): the Text direction setting now reaches Photoshop. Before, the paragraph direction was dropped on every write, so layers went back to left-to-right. Pasting into the current layer also sets right-to-left when the panel is set to RTL, styles keep their direction, composer and Arabic digits, and TextShapeR keeps the diacritic offsets.

### Data and interface

- Add a hands-on What's new tour (about 4 and a half minutes, 7 chapters), shown once to users updating from an earlier version and available from Help and Settings > General. It opens a practice page with numbered bubbles in Photoshop, read from right to left like a manga, and a practice script in its own tab, and checks each exercise from the panel: smart paste, paste on click and undo, a rectangle on the art, black and double bubbles, auto clean, shout bubbles and narration boxes with their own styles, TextShapeR, tabs, auto-center, size presets and Font FindeR. The user does every gesture: a blue ring shows the real control to use and darkens the rest of the panel (footer toggle, Paste button, script line, tab, style, settings tab) along with the user's own shortcut, the guide can be dragged anywhere by its header and moves out of the way when it covers the ring, and a window the tour sends the user to (settings, style editor) shows the step's tip at its bottom. It floats over the panel, can be folded away, keeps the shortcuts working and comes back after those windows. Its progress is kept when it or Photoshop closes: reopening it offers to resume where the user left off or to start over. A step only passes on a gesture made during the run: a line pasted or a Shout style made in an earlier run does not count, and a footer toggle already on is shown for a moment, then passes by itself. What the TextShapeR star learns during the tour is undone when the user leaves that chapter, so their own learning is left as it was. The tour goes in order: no step can be skipped, Next and the later chapters open once the chapter is done, and a finished chapter moves on to the next one right away.
- Show Help, Settings and page import as icon buttons in the footer, apart from the mode toggles, which switch to icons in a narrow panel instead of being cut off.
- The export button of a folder includes its subfolders and their styles (and their fonts in the Ctrl+Click .zip); importing the file rebuilds the hierarchy.
- Save through temporary files with a last-valid backup; preserve corrupt originals and expose save failures with recovery export.
- Block profile switching when pending changes cannot be saved.
- Validate imports before merging them, reject cyclic folder hierarchies and create a pre-import backup.
- Preserve size presets, disabled prefixes and all supported style export fields; include styles without a folder.
- Report failed JSON exports and keep the export dialog open.
- Respect automatic localization and modal close guards; apply Middle East settings only when saved.

### Compatibility and distribution

- Add a Rosetta launcher on Apple Silicon. Photoshop 2026 only loads CEP extensions in its Intel code and recent macOS ignores "Open using Rosetta"; the macOS installer and the new `fix_mac_rosetta.sh` create a launcher that opens Photoshop with Rosetta, install Rosetta if needed and remove the download quarantine.
- Ship modern and compatibility builds in one package. Photoshop 2020+ with Chromium 74+ loads the modern build; older or unknown hosts load the compatibility build.
- Keep Photoshop CC 2015 / version 16.0 as the declared minimum. The compatibility build uses ES5 JavaScript, legacy layout fallbacks and browser/Node compatibility helpers.
- Validate release identity, version and SHA-256 inventories before installation. Stage files and restore the previous installation on failure without replacing user storage.
- Keep old content-addressed chunks available to an already running panel during an integrated update.
- Use stable, installable releases only; compare prerelease versions correctly and distinguish update-check failures from an up-to-date result.
- Bound network requests, including response body downloads.
- Produce `Releases/TypeR.zip` and its checksum after tests and artifact checks, with the README and license included.
- Run regression tests and release checks in CI on Windows, macOS and Linux; update build dependencies.

### Shortcuts

- Shortcuts made of modifier keys only (Paste `Win+Ctrl`, Apply `Win+Shift`, Center `Win+Alt`) now run when you release them, and not if another key joined them. `Cmd+Shift+Z`, `Cmd+Opt+I` and every other Photoshop shortcut starting with these keys no longer run a TypeR action on the way, and a custom shortcut can extend them.
- The keep-size modifier works in any press order.
- Change the defaults Photoshop also reacts to: previous line is `Ctrl+Shift+Enter` (was `Ctrl+Tab`, which also changed document), next page is `Ctrl+Alt+Enter` (was `Shift+X`, which also swapped the colors), text size is `Ctrl+Alt+U` and `Ctrl+Alt+D` (was `Ctrl+Shift+Plus` and `Minus`, where Plus also changed the layer's blending mode), inserting the text is `Ctrl+Alt+L` (was `Win+Shift+V`, which also ran Paste in Place). Unchanged old defaults move to the new ones; customized shortcuts are kept.
- `=` and `+` count as the same key, so a Plus shortcut also works in Legacy, whose keyboard reader only reports Equal for that key.
- macOS: the UXP keyboard reader also reports the physical letter on layouts without Latin letters, so the default shortcuts work on them. Photoshop must be added to Input Monitoring in the system settings, or macOS hides letters, digits and symbols from the reader.

### Validation limits

Automated host tests simulate Photoshop operations. They do not certify every Photoshop/OS pair. Release acceptance still requires real CEP testing on CC 2015 and a current Photoshop version, on both Windows and macOS, including a long typesetting session. The existing video guide describes an older workflow; use the in-panel walkthrough for the current interface.
