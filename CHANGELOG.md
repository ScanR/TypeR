# Changelog

## 3.0.0

### UXP plugin

- Add the new TypeR, a UXP plugin for Photoshop 2025 and later (`TypeR-UXP.ccx`), which runs natively on Apple Silicon without Rosetta. It is the same application as the CEP extension, with the same features, layout and saved styles.
- Import the styles, profiles and settings of an installed CEP TypeR on first start, and keep the plugin's data outside Photoshop's version-specific folders.
- Keep the global shortcuts through a small keyboard reader, which also reports mouse buttons 4 and 5 on macOS.
- Read bubble and selection shapes from the selection mask, leave no history state for reads, and fix size changes on layers with floating-point colors, size changes on rich text and FontScanR on documents with a background layer.
- Install updates from the panel through Creative Cloud's plugin installer, or by hand when it is missing or fails. Through the installer, the panel reloads with the new version without restarting Photoshop.
- The UXP plugin no longer needs Creative Cloud: without its plugin installer, the installers, the panel's updates and the switch from Legacy extract the package and register it in Photoshop themselves, and Photoshop loads it at its next start.
- The installers start with a menu to choose the new TypeR (UXP) or the Legacy (CEP) version with the arrow keys. It finds the installed Photoshop and marks the version made for it as recommended. The release archive contains the UXP plugin, so it installs offline.
- Install in one command: `curl -fsSL https://raw.githubusercontent.com/ScanR/TypeR/master/get.sh | bash` on macOS, `irm https://raw.githubusercontent.com/ScanR/TypeR/master/get.ps1 | iex` on Windows. The archive also has `install_mac.command` to double-click on macOS, and its macOS scripts no longer need `chmod`.
- A Finder `.DS_Store` file no longer breaks a release build or the Legacy installation on macOS.
- The installers no longer call Creative Cloud's plugin installer when the Creative Cloud app is missing, and stop waiting for it after a minute. On Windows, an installer that cannot start now falls back to the direct installation instead of failing.
- The Legacy panel first offers the switch to the new TypeR (UXP), before What's new, when Photoshop can run it (2025 or later): one click installs it, and it imports the styles, profiles and settings.
- Once the new TypeR is installed, the Legacy panel is called "TypeR (old)" in Photoshop from its next start, and says at each start, before What's new, that the new version opens from Plug-ins > TypeR.

### Smart paste

- Paste fits the translation to the bubble's real outline: the style size is kept when the text fits and shrinks
  as little as possible otherwise, down to a minimum size (75% by default), the lines follow the bubble's silhouette, the ink is centred
  inside the outline, and one French or English hyphen is allowed only as a last resort.
- Black bubbles get white text without a stroke. A style can be marked as the Shout or Narration style of its
  folder; spiky bubbles and narration boxes selected with the Magic Wand then use it, unless the script line has
  its own prefix style. A rectangle marquee or a lasso keeps the line's style.
- Double and triple bubbles receive the next script lines in their other chambers, in one history state. Every chamber gets its line, centred, even if it has to overflow: the style size comes before the padding, which no longer applies along the invisible limit between two chambers.
- Automatic hyphenation follows the script's language instead of the interface's, and a word with an apostrophe can break ("quel-qu'un").
- Optional Auto clean paints the bubble under the text on a `TypeR Clean` layer (solid white or black only).
- Conditional refont rules give the text between two markers another style's font.
- A bubble too small for the padding keeps the text inside it: the padding gives way, then the margin. When the text still cannot be placed, the classic paste runs and a short notice explains why.
- Center after paste is now a setting of the classic paste only: the footer toggle is gone, and the setting is greyed out while smart paste is on (it still applies when smart paste falls back to the classic paste).
- Multi-bubble batches select each stored bubble again and paste it with the smart paste.
- Align knows double and triple bubbles: each selected text is centred in its own chamber instead of on the
  neck of the whole bubble, and a single text goes to the chamber it sits in (or the nearest one).

### Paste on click

- A Magic Wand click, a rectangle or a lasso can paste the current line at once (footer toggle and shortcut).
- Undoing a TypeR paste in Photoshop puts the script line back (live in UXP, checked lazily in Legacy).
- Clicking a bubble again right after it got one line splits it: TypeR undoes that paste and pastes the line and the next one, one per chamber, for double bubbles it did not detect (bubbles clipped by the panel frame, offset boxes).

### Workspace and typesetting

- macOS (UXP): TypeR detects that Photoshop lacks Input Monitoring and offers to open the right pane, once at startup and in Settings > Shortcuts.
- Simplify the settings: the guide and What's new open from Help, the Middle Eastern style fields follow the right-to-left text direction, the style list always scrolls to the selected style, and turning tips back on replays them. The page line color now belongs to themes, and the cache section only shows where a cache exists.
- Add a shortcut to assign that turns the selected style's stroke on or off, keeping its size and color. A style with an active stroke shows a frame of that color in the list.
- Fix the + and - size buttons on text layers resized with Ctrl+T: + made the text smaller, and now both change the displayed size by one step and keep the line breaks.
- Add a style option that sets lines made only of punctuation, like `?!` or `!!`, at twice or three times the size.
- Add contextual alternates and the single-line composer to the style editor, and turn on standard and contextual ligatures for new styles.
- Preview fonts in the style editor: the font and weight lists show each entry in its own font, and the font list has a search field (word order, spaces and accents are optional).
- Keep every script tab and the active tab when the tab bar is hidden. The separate multi-tab switch is gone: Settings > Appearance hides the tab bar.
- Reorder the script tabs by dragging them.
- Name the script tabs by themselves: a tab takes the name of its PSD folder (`105`, `starblo 39`), otherwise the chapter heading of its script (`Chapitre 105`), otherwise its first sentence, and follows its content until it is renamed by hand. New empty tabs use the first free number. Tabs named by hand are never changed.
- Keep the script's page and line highlights on their text: they no longer drift by one or more rows after the panel is resized, on bold or italic lines close to the wrap limit, or on scripts containing stray carriage returns.
- Recognize complete page headings, including `Page 12 :`, `Page 12 : title`, `Page 12 - title`, `[Page 12]` and Markdown headings. Mentions of a page inside dialogue remain dialogue.
- Serialize PSD navigation and record the opened page only after Photoshop confirms success.
- Bind captured bubble selections to the current Photoshop document and session.
- Validate a batch before creating layers and restore Photoshop history if a batch fails.
- Preserve undo history during temporary TextShapeR scans.
- TextShapeR ranks shapes from about 3,000 hand-lettered bubbles: the first proposal follows how letterers actually break lines, and the previous ranking's favourites stay in the list as alternatives.
- TextShapeR keeps the hyphen of real compound words ("Dis-moi", "Qu'est-ce") when rejoining split text, can break a line at that hyphen, and offers cesures on short words and after an elision, without letting one lead when a clean shape exists.
- TextShapeR detects the language of the text and breaks words by its rules (French, English, Spanish, Portuguese, Italian, German, Turkish, Russian and Ukrainian); scripts that do not hyphenate, such as Arabic, are never cut. The interface language only settles texts too short to tell.
- Fix TextShapeR's learning, which could suddenly degrade the suggestions after many lessons.
- Refine compact panel settings, the active-size modifier and keyboard workflows.
- Select styles 1 through 9 in the current folder with the numeric keypad while the panel has focus and no text field or modal is active.
- Fix right-to-left text (Arabic): the Text direction setting now reaches Photoshop. Before, the paragraph direction was dropped on every write, so layers went back to left-to-right. Pasting into the current layer also sets right-to-left when the panel is set to RTL, styles keep their direction, composer and Arabic digits, and TextShapeR keeps the diacritic offsets.

### Data and interface

- Import Photoshop tool presets: the import button in the settings also takes `.tpl` files. Each file becomes a style folder with one style per text preset, keeping its font, size, leading, tracking, color, anti-aliasing and alignment. A `.tpl` holds no layer effects, so its styles come without a stroke, and vertical type presets become horizontal text.
- Add a hands-on What's new tour (about 4 and a half minutes, 7 chapters), shown once to users updating from an earlier version and available from Help and Settings > General. It opens a practice page with numbered bubbles in Photoshop, read from right to left like a manga, and a practice script in its own tab, and checks each exercise from the panel: smart paste, paste on click and undo, a rectangle on the art, black and double bubbles, auto clean, shout bubbles and narration boxes with their own styles, TextShapeR, tabs, size presets, FontScanR with its missing font lookup, and Font FindeR. The user does every gesture: a blue ring shows the real control to use and darkens the rest of the panel (footer toggle, Paste button, script line, tab, style, settings tab) along with the user's own shortcut, the guide can be dragged anywhere by its header and moves out of the way when it covers the ring, and a window the tour sends the user to (settings, style editor) shows the step's tip at its bottom. It floats over the panel, can be folded away, keeps the shortcuts working and comes back after those windows. Its progress is kept when it or Photoshop closes: reopening it offers to resume where the user left off or to start over. A step only passes on a gesture made during the run: a line pasted or a Shout style made in an earlier run does not count, and a footer toggle already on is shown for a moment, then passes by itself. What the TextShapeR star learns during the tour is undone when the user leaves that chapter, so their own learning is left as it was. The tour goes in order: Next and the later chapters open once the chapter is done, and a finished chapter moves on to the next one right away. A Skip button on the current step moves on without doing it, for users who already know it; a skipped step counts toward its chapter, and clicking its number opens it again. The basics walkthrough has the same Skip button.
- Replace the first-time walkthrough with a hands-on basics walkthrough (8 chapters) built on the same guide as the What's new tour, shown to new users and available from Help and Settings > General. It opens its own practice page (four numbered spots) and a practice script with a page marker and a translator note, and checks each exercise from the panel: picking the current line and moving to the next one, creating a dialogue style, pasting into bubbles with the button and the shortcut, a rectangle outside the bubbles, a Shout style picked by a tag at the start of the line, Align, applying a style to an existing layer, linking the PSD files of a chapter and a JSON backup. The guide rings the real control and never does the gesture itself, and its progress is kept apart from the What's new tour's. For new users it is one guide with What's new: the chapters of the tour follow the basics, on their own practice page and script, with one list of chapters (15, about 11 and a half minutes), and What's new does not open afterwards, including for an existing user who finishes the full walkthrough from Help before seeing it. Existing users, Legacy or UXP, and users moving from Legacy to UXP only get the What's new tour; Help and Settings > General keep both.
- Show Help, Settings and page import as icon buttons in the footer, apart from the mode toggles, which switch to icons in a narrow panel instead of being cut off. Settings > Appearance > Interface layout > Footer can keep the icons at any panel width.
- Reorganize the settings into General, Insertion, Script, Styles, Shortcuts, Appearance, Profiles and Font FindeR: each setting sits next to the ones acting on the same thing (all of centering under Insertion, the default style and refont under Styles, import/export and reset under Profiles), options that depend on a checkbox appear indented under it, and shortcuts are grouped by what they do. The settings reopen on the last tab used, Insertion the first time.
- Rework Settings > Appearance > Interface layout: a bar picks the panel to edit (with the number of hidden elements), each element has its own switch, and hidden elements stay outlined in the preview so one click brings them back. Each footer mode toggle (TextShapeR, Multi-bubble, Click paste, Auto clean) can now be hidden on its own, with its current state shown next to it; a hidden toggle keeps its state and shortcut. The interface scale has its own row with a reset button.
- Look up missing fonts on Font FindeR: FontScanR results and style folder or library imports search each font that is not installed (several searches, from the exact PostScript name to the name without its style, vendor tags or extra words, each result scored against it) and offer to install the matching family with all its variants in one click, or all the matches at once. A close but not identical match is marked as such, and a font Font FindeR does not have gets a button that searches "<name> font" on Google.
- Font FindeR's Random button draws from the whole catalogue, or from the current search and filters, instead of the fonts already loaded, which mostly started with A.
- The export button of a folder includes its subfolders and their styles; importing the file rebuilds the hierarchy. It now asks for the format in a small window, styles only (`.json`) or styles with the `.ttf` and `.otf` files of their fonts (`.zip`), instead of the Ctrl+Click shortcut and its tip.
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
