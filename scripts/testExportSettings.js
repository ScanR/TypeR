const assert = require('assert');
const React = require('react');
const createLoader = require('./helpers/loadAppModule');
const preferences = {
  smartPaste: false, pasteOnClick: true, smartPasteAutoClean: true,
  smartPasteDistribute: false, smartPasteMinScale: 0.8, smartPasteHyphenation: 'fr',
  refontRules: [{ marker: '!', fontPostScriptName: 'Example' }],
  // Every preference of the Settings window travels, not only the script's
  shortcut: { add: ['CTRL', 'ENTER'] }, direction: 'rtl', autoCenterMode: 'visual', internalPadding: 12,
  interpretMarkdown: true, styleSizeStep: 0.5, uiLayout: { blocks: ['text', 'styles'] }, customThemes: [{ id: 'custom-1' }],
  checkUpdates: false, showTips: false,
};
// A work session and the tips already seen stay out of the file
const session = { text: 'script', tabs: [{ id: 'a' }], images: [{ path: '/page.psd' }], currentLineIndex: 4, seenFeatureTips: { pageSync: true }, textShapeRTuning: { samples: 3 }, backgroundImage: { name: 'photo' } };
const profile = { folders: [], styles: [], ...preferences, ...session, editorTheme: 'custom-image' };
let saved;
let stateIndex = 0;
const load = createLoader({
  react: { ...React, memo: fn => fn, useMemo: fn => fn(), useEffect() {}, useRef: value => ({ current: value }),
    useState: value => [stateIndex++ === 3 ? true : value, () => {}],
  },
  '../../utils': { locale: {}, nativeAlert: () => { throw new Error('Unexpected export error'); } },
  '../../context': { useContext: select => ({ state: select(profile), dispatch() {} }) },
  '../../profileStorage': { getProfileRegistry: () => ({ activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }) },
  '../../fontFileExport': {},
});
global.window = { cep: { fs: {
  showSaveDialogEx: async () => ({ data: '/out/profile.json' }),
  writeFile: async (path, text) => { saved = JSON.parse(text); return { err: 0 }; },
} } };
const tree = load('app_src/components/modal/export.jsx').default();
function findForm(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'form') return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const found = findForm(child);
    if (found) return found;
  }
  return null;
}
(async () => {
  await findForm(tree).props.onSubmit({ preventDefault() {} });
  assert(saved && saved.includesSettings);
  for (const key of Object.keys(preferences)) assert.deepStrictEqual(saved[key], preferences[key], key + ' must be exported from the active profile');
  for (const key of Object.keys(session)) assert.strictEqual(saved[key], undefined, key + ' is not a setting');
  assert.strictEqual(saved.editorTheme, undefined, 'the custom image theme needs its picture, which is not in the file');
  assert.strictEqual(saved.pastePointText, false);
  // Everything exported is something the importer stores
  const contextSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'app_src', 'context.jsx'), 'utf8');
  const stored = /const storeFields = \[([\s\S]*?)\];/.exec(contextSource)[1].match(/"[^"]+"/g).map(name => name.slice(1, -1));
  const { EXPORTED_SETTINGS } = load('app_src/librarySerialization.js');
  EXPORTED_SETTINGS.forEach(field => assert.ok(stored.includes(field), field + ' is exported but never imported'));
  console.log('Active profile export preferences regression passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
