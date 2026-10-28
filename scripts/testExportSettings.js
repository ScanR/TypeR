const assert = require('assert');
const React = require('react');
const createLoader = require('./helpers/loadAppModule');
const preferences = {
  smartPaste: false, pasteOnClick: true, smartPasteAutoClean: true,
  smartPasteDistribute: false, smartPasteMinScale: 0.8, smartPasteHyphenation: 'fr',
  refontRules: [{ marker: '!', fontPostScriptName: 'Example' }],
};
const profile = { folders: [], styles: [], ...preferences };
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
  console.log('Active profile export preferences regression passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
