# Repository Guidelines
TypeR - Photoshop extension for manga typesetters
## Project Structure & Module Organization
- `app_src/`: React source. Key files: `index.jsx` (entry + hotkeys), `context.jsx` (global state), `components/main/main.jsx` (three-panel layout), `utils.js` (CSInterface bridge), `lib/jam/` (ExtendScript helpers).
- `app/`: Build output (cleaned and regenerated). Do not edit.
- `CSXS/manifest.xml`: CEP manifest and host targets.
- `locale/`: Translations. Add new languages using the existing key structure.
- Theme files are copied by the build step (see `copyThemes.js` for paths).

## Build, Test, and Development Commands
- Build: run the package script that triggers `clean.js → webpack → copyThemes.js` (e.g., `npm run build`; see `package.json`). This clears `app/`, bundles from `app_src/`, and copies themes. Note: Building is not necessary unless you intend to load the CEP in Photoshop.
- Dev/watch: if available, use the watch script (e.g., `npm run watch`) to iterate on `app_src/` with faster feedback.
- Tests: none mandated yet. If added, expose via `npm test`.

## Coding Style & Naming Conventions
- Indentation: 2 spaces. Comments in English.
- React: functional components, hooks, and context reducer pattern.
- Naming: `PascalCase` for components, `camelCase` for variables/functions, `kebab-case` for SCSS files.
- SCSS/PostCSS: design for a small panel (~500×700). Favor responsive, compact UI; avoid oversized paddings/margins. Prefer component-scoped styles and BEM-like class names.
- ExtendScript: ES3-compatible syntax in host scripts.

## Testing Guidelines
- Primary: manual validation in Photoshop (CC 2015+). Include page switching, style matching, and auto-centering flows.
- Unit tests (when introduced): target pure logic in `app_src/` (e.g., line parsing, style resolution). Use `*.test.js(x)` colocated with modules; mock CSInterface.

## Commit & Pull Request Guidelines
- Commits: concise, imperative subject (e.g., “Fix style matching on import”). Group small related changes.
- PRs: include a clear summary, linked issues, before/after screenshots of the panel, and manual test steps (Photoshop version, pages used). Note localization/theme impacts when relevant.

## Architecture Notes
- State via React Context + reducer; styles organized by folders with prefix-based matching and priority.
- CEP bridge: `utils.js` with CSInterface; Photoshop automation in `app/host.jsx` (generated) and `app_src/lib/jam/`.
- Assets: fonts embedded via base64 loader.

## Security & Configuration Tips
- Do not commit certificates, Adobe IDs, or debug/signing files. Avoid network-dependent code inside the panel. Keep bundle size reasonable for CEP.
