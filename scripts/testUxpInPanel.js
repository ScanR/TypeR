// TypeR without a WebView (docs/uxp-webview-refused.md): the reading of
// Photoshop's UXP log that decides it, the stylesheet rewrite for UXP's layout
// engine and the replacement of every stroke icon the application imports.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const panelStart = require('../uxp-src/host/panelStart');
const inPanelCss = require('./inPanelCss');

const root = path.join(__dirname, '..');

(async () => {
  // Log line times, local and to the second
  assert.strictEqual(panelStart.logLineTime('[2026-11-07_19-25-25][2984][Warn] [general] x'), new Date(2026, 10, 7, 19, 25, 25).getTime());
  assert.strictEqual(panelStart.logLineTime('    at addRule (inpanel.js:1:1)'), null);

  const appData = 'C:\\Users\\ana\\AppData\\Roaming';
  const reader = (text) => ({
    appData, pluginId: 'com.scanr.typer',
    listFolder: async (folder) => {
      if (folder === appData + '\\Adobe') return [{ name: 'Adobe Photoshop 2026', isFolder: true }];
      if (folder === appData + '\\Adobe\\Adobe Photoshop 2026\\Logs') return [{ name: 'UXPLogs_2026-11-07_19-25-23_260492.log', isFolder: false }];
      throw new Error('no such folder ' + folder);
    },
    readText: async () => text,
  });
  const since = new Date(2026, 10, 7, 19, 25, 25).getTime();
  const storage = '[2026-11-07_19-25-25][2984][Warn] [general] WebViewManager::createWebView() failed to create WebView because webViewDataStorage_ is not available';
  const found = await panelStart.findWebViewRefusalSince(Object.assign(reader('[2026-11-07_19-25-23][2984][Info] [general] start\r\n' + storage + '\r\n'), { since }));
  assert.strictEqual(found.kind, 'storage');
  assert.strictEqual(found.line, storage);
  // A second of tolerance: the log has whole seconds
  assert.ok(await panelStart.findWebViewRefusalSince(Object.assign(reader(storage), { since: since + 900 })));
  assert.strictEqual(await panelStart.findWebViewRefusalSince(Object.assign(reader(storage), { since: since + 1500 })), null, 'a refusal older than the WebView does not count');
  const creation = await panelStart.findWebViewRefusalSince(Object.assign(reader('[2026-11-07_19-25-26][1][Warn] [general] Failed to create WebView for plugin: com.scanr.typer'), { since }));
  assert.strictEqual(creation.kind, 'creation');
  assert.strictEqual(await panelStart.findWebViewRefusalSince(Object.assign(reader('[2026-11-07_19-25-26][1][Warn] [general] Failed to create WebView for plugin: com.adobe.ccx.start'), { since })), null, 'another plugin\'s failure is not TypeR\'s');
  assert.strictEqual(await panelStart.findWebViewRefusalSince(Object.assign(reader('[2026-11-07_19-25-26][1][Error] [console] ' + storage.slice(storage.indexOf('WebViewManager'))), { since })), null, 'console output may quote anything');
  const unreadable = reader('');
  unreadable.readText = async () => { throw new Error('locked'); };
  assert.strictEqual(await panelStart.findWebViewRefusalSince(Object.assign(unreadable, { since })), null);

  // Stylesheet of the panel's own DOM
  const css = (await postcss([inPanelCss()]).process([
    '.footer button:hover > svg { opacity: 1 }',
    'button.topcoat-button--large:disabled { opacity: .3 }',
    '.topcoat-button--large { color: red }',
    '.dark-theme .topcoat-text-input--large::placeholder { color: hsla(0,0%,100%,.35) }',
    '.x::-webkit-input-placeholder, .y { color: red }',
    '@keyframes spin { from { opacity: 0 } to { opacity: 1 } }',
  ].join('\n'), { from: undefined })).css;
  assert.match(css, /\.footer \.typer-button:hover > svg/);
  assert.match(css, /\.typer-button\.topcoat-button--large\[disabled\]/);
  assert.match(css, /\.topcoat-button--large \{ color: red; --typer-icon: red \}/, 'class names that contain "button" stay');
  assert.doesNotMatch(css, /placeholder/, 'placeholder rules crash Photoshop 27.9 next to an empty number field');
  assert.match(css, /@keyframes spin \{ from \{ opacity: 0 \} to \{ opacity: 1 \} \}/);

  // Icons follow the text colour (no currentColor in UXP's SVG); a field's
  // background gives up !important for its opaque run-time colour
  const colors = (await postcss([inPanelCss()]).process([
    '.a { color: #777 }',
    '.b:hover { color: rgba(0,0,0,.5) !important }',
    '.c { color: inherit }',
    '.d { color: red; --typer-icon: blue }',
    '.settings-search INPUT { background: transparent !important; color: #fff }',
    '.box { background: transparent !important }',
  ].join('\n'), { from: undefined })).css;
  assert.match(colors, /\.a \{ color: #777; --typer-icon: #777 \}/);
  assert.match(colors, /\.b:hover \{ color: rgba\(0,0,0,\.5\) !important; --typer-icon: rgba\(0,0,0,\.5\) !important \}/);
  assert.match(colors, /\.c \{ color: inherit \}/, 'an inherited colour leaves the inherited icon colour');
  assert.match(colors, /\.d \{ color: red; --typer-icon: blue \}/, 'an icon colour set on purpose stays');
  assert.match(colors, /\.settings-search INPUT \{ background: transparent; color: #fff; --typer-icon: #fff \}/);
  assert.match(colors, /\.box \{ background: transparent !important \}/, 'only fields lose !important');

  // The in-panel stylesheet starts with a browser's defaults for buttons and
  // icons, so that the application's rules, later, win over them
  const style = fs.readFileSync(path.join(root, 'uxp-src/web/inpanel/style.scss'), 'utf8');
  assert.ok(style.indexOf('.typer-button {') < style.indexOf('html.typer-inpanel {'));
  assert.match(fs.readFileSync(path.join(root, 'uxp-src/web/inpanel/entry.js'), 'utf8'), /^import "\.\/style\.scss";$/m);

  // Every stroke icon the application imports has a fill replacement
  const replaced = { fi: 'iconsFi.js', tb: 'iconsTb.js' };
  const ri = require('react-icons/ri');
  const imports = {};
  const walk = (folder) => fs.readdirSync(folder).forEach((name) => {
    const file = path.join(folder, name);
    if (fs.statSync(file).isDirectory()) return walk(file);
    if (!/\.(jsx?|mjs)$/.test(name)) return;
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/import\s*\{([^}]*)\}\s*from\s*["']react-icons\/(\w+)["']/g)) {
      const set = imports[match[2]] = imports[match[2]] || new Set();
      match[1].split(',').map((item) => item.trim().split(/\s+as\s+/)[0]).filter(Boolean).forEach((item) => set.add(item));
    }
  });
  walk(path.join(root, 'app_src'));
  for (const [set, file] of Object.entries(replaced)) {
    const source = fs.readFileSync(path.join(root, 'uxp-src/web/inpanel', file), 'utf8');
    const mapped = new Map(Array.from(source.matchAll(/(Ri\w+) as (\w+)/g), (match) => [match[2], match[1]]));
    for (const name of imports[set] || []) {
      assert.ok(mapped.has(name), name + ' has no replacement in ' + file);
      assert.strictEqual(typeof ri[mapped.get(name)], 'function', mapped.get(name) + ' is not a Remix icon');
    }
  }
  // The other sets the application uses are drawn with fills. UXP honours
  // fill="none" on a shape (Material's empty framing path, checked in
  // Photoshop 27.9), not on the <svg> root, and draws no stroke at all.
  const strokeSets = Object.keys(imports).filter((set) => !replaced[set]).filter((set) => {
    const icons = require('react-icons/' + set);
    return Array.from(imports[set]).some((name) => /"tag":"svg","attr":\{[^}]*"fill":"none"|"stroke":|"strokeWidth":/.test(icons[name].toString()));
  });
  assert.deepStrictEqual(strokeSets, [], 'stroke icons outside fi and tb need a replacement too');
  console.log('UXP in-panel log reading, stylesheet and icon tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
