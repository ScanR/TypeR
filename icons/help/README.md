# Help illustrations

Drop animated GIFs here to illustrate the Help window sections, and add each
file's name (without `.gif`) to `HELP_MEDIA` in
`app_src/components/modal/help.jsx`. A section whose name is not in that list
renders without an illustration and asks for no file.

| File | Section |
| --- | --- |
| `styles.gif` | Styles and folders |
| `script.gif` | Script and lines |
| `preview.gif` | Preview and size |
| `paste.gif` | Paste and align |
| `multibubble.gif` | Multi-bubble |

Guidelines:

- The panel is often used at ~350-500px wide, so keep the GIF around
  **600px wide max** and reasonably short (3-8s loop) to keep the file small.
- Images are displayed full width of the section, height is automatic.
- Captions come from the locale files (`helpSection*Media` keys), not from the
  file name.

To add a new illustrated section, set `media: '<name>'` on the section in
`app_src/components/modal/help.jsx`, add `<name>` to `HELP_MEDIA` and drop
`<name>.gif` in this folder, then build. This folder is copied as-is by the
Legacy install and packaging scripts; the UXP build does not copy it yet
(`scripts/buildUxp.js`), so an illustration needs that step added too.
