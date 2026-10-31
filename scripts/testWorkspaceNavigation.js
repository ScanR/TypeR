const assert = require('assert');
const { parsePageMarker } = require('./helpers/loadAppModule')()('app_src/pageMarker.js');
assert.strictEqual(parsePageMarker(' Page 12 '), 12);
assert.strictEqual(parsePageMarker('page\t003'), 3);
for (const heading of ['Page 12 :', 'Page 12:', 'Page 12 -', 'Page 12.', '[Page 12]', '## Page 12', '### Page 12 ###', 'Page 12 : Title', 'Page 12 - End', 'Page 12 \u2013 Title']) assert.strictEqual(parsePageMarker(heading), 12);
for (const text of ['Read Page 12 now', 'Page 0', 'Page 3 notes', 'Page 9007199254740992', null]) assert.strictEqual(parsePageMarker(text), null);
const { reducer, initial } = require('./helpers/loadContext')();
let state = reducer(initial, { type: 'setText', text: 'Read Page 12 now\nPage 2\nDialogue' });
assert.strictEqual(!!state.lines[0].ignore, false);
assert.strictEqual(!!state.lines[1].ignore, true);
state = reducer(state, { type: 'addTab', data: { text: 'Second script' } });
const tabs = state.tabs;
const activeId = state.currentTabId;
assert.strictEqual(state.tabs.length, tabs.length);
assert.strictEqual(state.currentTabId, activeId);
// A new tab brings a hidden tab bar back, or it could not be reached.
state = reducer(state, { type: 'setUiLayout', layout: { visible: { tabBar: false } } });
assert.strictEqual(state.uiLayout.visible.tabBar, false);
state = reducer(state, { type: 'addTab', data: { text: 'Third script' } });
assert.notStrictEqual(state.uiLayout.visible.tabBar, false);
// Bubbles captured on one page must not be batched after switching page.
state = reducer(state, { type: 'setLastOpenedImagePath', path: '/scans/01.psd' });
state = reducer(state, { type: 'addSelectionBatch', entries: [{ selection: { left: 0, top: 0, right: 10, bottom: 10 } }] });
assert.strictEqual(state.storedSelections.length, 1);
state = reducer(state, { type: 'setLastOpenedImagePath', path: '/scans/01.psd' });
assert.strictEqual(state.storedSelections.length, 1, 'reopening the same page keeps its bubbles');
state = reducer(state, { type: 'setLastOpenedImagePath', path: '/scans/02.psd' });
assert.deepStrictEqual(state.storedSelections, []);
// The multi-tab switch turned off becomes a hidden tab bar, once.
const migrated = require('./helpers/loadContext')({ multiTabEnabled: false, middleEast: true, pageLineColor: '#112233', autoScrollStyle: false });
assert.strictEqual(migrated.initial.uiLayout.visible.tabBar, false);
const cleaned = migrated.writes.map(([data]) => data).find((data) => 'multiTabEnabled' in data);
assert.strictEqual(cleaned.uiLayout.visible.tabBar, false);
['multiTabEnabled', 'middleEast', 'pageLineColor', 'autoScrollStyle'].forEach((field) => assert.strictEqual(cleaned[field], undefined));
assert.strictEqual(require('./helpers/loadContext')({}).writes.some(([data]) => 'multiTabEnabled' in data), false);
console.log('Workspace navigation regression tests passed');
