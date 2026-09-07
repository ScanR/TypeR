const createLoader = require('./loadAppModule');
module.exports = (data = {}) => {
  const writes = [];
  const load = createLoader({
    './utils': { locale: {}, readStorage: () => ({ data }), writeToStorage: (...args) => { writes.push(args); return true; }, scrollToLine() {}, scrollToStyle() {}, nativeAlert() {} },
    './lib/themeManager': { applyThemeState() {} },
    './perfDebug': { perfMeasure: (a, b, fn) => fn() },
    './themePresets': { normalizeCustomThemes: x => x || [], normalizeEditorTheme: x => x || 'system', normalizePageLineColor: x => x || null, setCustomEditorThemes: x => x },
    './backgroundImage': { normalizeBackgroundImage: x => x || null },
  });
  const { baseReducer: reducer, initialState } = load('app_src/context.jsx', 'export { baseReducer, initialState };');
  return { reducer, initial: reducer(initialState, { type: 'init' }), writes };
};
