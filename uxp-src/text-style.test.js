const {test} = require('node:test');
const assert = require('node:assert/strict');
const {toActionJSON, fromActionJSON, defaultStyle, makeTextDescriptor, bounds, sanitizeTextStyle, sanitizeParagraph} = require('./text-style');

test('captured Photoshop styles drop parent-sheet fields that cancel set', () => {
  const result = makeTextDescriptor({
    text: 'Hello',
    style: {textProps: {typeUnit: 'pointsUnit', layerText: {
      textDynamicMagicPath: false,
      textStyleRange: [{textStyle: {
        styleSheetHasParent: true,
        fontAvailable: true,
        fontPostScriptName: 'VillainTeam-Up',
        size: 30,
        impliedFontSize: 30,
        color: {red: 0, green: 0, blue: 0},
        baseParentStyle: {fontPostScriptName: 'MyriadPro-Regular'},
      }}],
      paragraphStyleRange: [{paragraphStyle: {styleSheetHasParent: true, align: 'center', hyphenate: false}}],
    }}},
  });
  assert.equal(result.textStyleRange[0].textStyle.fontPostScriptName, 'VillainTeam-Up');
  assert.equal(result.textStyleRange[0].textStyle.size._value, 30);
  assert.equal(result.textStyleRange[0].textStyle.styleSheetHasParent, undefined);
  assert.equal(result.textStyleRange[0].textStyle.baseParentStyle, undefined);
  assert.equal(result.textStyleRange[0].textStyle.fontAvailable, undefined);
  assert.deepEqual(result.paragraphStyleRange[0].paragraphStyle.alignment, {_enum: 'alignmentType', _value: 'center'});
  assert.equal(result.textDynamicMagicPath, undefined);
});

test('legacy style preserves units, enum values, false flags and RGB channels', () => {
  const style = {size: 36, autoLeading: false, leading: 38, syntheticBold: false, fontCaps: 'allCaps', color: {red: 1, green: 127, blue: 255}};
  const actual = toActionJSON(style, 'pixelsUnit', 'textStyle');
  assert.deepEqual(actual.size, {_unit: 'pixelsUnit', _value: 36});
  assert.deepEqual(actual.fontCaps, {_enum: 'fontCaps', _value: 'allCaps'});
  assert.equal(actual.color.grain, 127);
  assert.deepEqual(fromActionJSON(actual), style);
});

test('applying a captured style keeps target geometry and does not alter the saved style', () => {
  const style = defaultStyle();
  style.textProps.layerText.textShape = [{textType: 'box', bounds: {left: 99, top: 99, right: 999, bottom: 999}}];
  style.textProps.layerText.transform = {xx: 5};
  const before = JSON.stringify(style);
  const previous = {textKey: 'old', textShape: [{_obj: 'textShape', bounds: {_obj: 'rectangle', left: 1, top: 2, right: 30, bottom: 40}}], transform: {_obj: 'transform', xx: 1}};
  const result = makeTextDescriptor({style, text: 'Salut'}, previous);
  assert.deepEqual(result.textShape, previous.textShape);
  assert.deepEqual(result.transform, previous.transform);
  assert.equal(JSON.stringify(style), before);
  assert.equal(result.textStyleRange[0].to, 6);
});

test('a style-only apply keeps the layer text instead of erasing it', () => {
  const style = defaultStyle();
  style.textProps.layerText.textStyleRange[0].textStyle.fontPostScriptName = 'VillainTeam-Up';
  const previous = {textKey: 'Bonjour\rle monde', textStyleRange: [{textStyle: {size: {_unit: 'pointsUnit', _value: 12}}}]};
  const result = makeTextDescriptor({style, text: ''}, previous);
  assert.equal(result.textKey, 'Bonjour\rle monde');
  assert.equal(result.textStyleRange[0].to, previous.textKey.length + 1);
  assert.equal(result.paragraphStyleRange[0].to, previous.textKey.length + 1);
  assert.equal(result.textStyleRange[0].textStyle.fontPostScriptName, 'VillainTeam-Up');
});

test('a style that carries its own text still wins over an empty apply', () => {
  const style = defaultStyle();
  delete style.textProps.layerText.textKey;
  const result = makeTextDescriptor({style, text: ''}, {textKey: 'ignore me'});
  assert.equal(result.textKey, 'ignore me');
  assert.equal(makeTextDescriptor({text: 'Remplacement'}, {textKey: 'ignore me'}).textKey, 'Remplacement');
});

test('markdown uses UTF-16 offsets and preserves line breaks', () => {
  const result = makeTextDescriptor({text: 'é😊\nfin', richTextRuns: [{text: 'é😊', bold: true}, {text: '\nfin', italic: true}]});
  assert.equal(result.textKey, 'é😊\rfin');
  assert.deepEqual(result.textStyleRange.map(r => [r.from, r.to]), [[0, 3], [3, 8]]);
  assert.equal(result.textStyleRange[0].textStyle.syntheticBold, true);
  assert.equal(result.textStyleRange[1].textStyle.syntheticItalic, true);
  assert.throws(() => makeTextDescriptor({text: 'a', richTextRuns: [{text: 'too long'}]}));
});

test('adaptive size converts points to saved pixel units without changing leading', () => {
  const style = defaultStyle();
  delete style.textProps.layerText.textStyleRange[0].textStyle.size;
  style.textProps.layerText.textStyleRange[0].textStyle.leading = 40;
  const previous = {textKey: 'test', textStyleRange: [{textStyle: {size: {_unit: 'pointsUnit', _value: 12}}}]};
  const result = makeTextDescriptor({style}, previous, 20, 300);
  assert.deepEqual(result.textStyleRange[0].textStyle.size, {_unit: 'pixelsUnit', _value: 50});
  assert.equal(result.textStyleRange[0].textStyle.leading._value, 40);
});

test('bounds reject missing and inverted rectangles and keep subpixels', () => {
  assert.equal(bounds(null), null);
  assert.equal(bounds({left: 4, top: 1, right: 2, bottom: 5}), null);
  const rect = bounds({left: {_value: 10.5}, top: 5, right: 40, bottom: 25});
  assert.equal(rect.xMid, 25.25);
  assert.equal(rect.height, 20);
});
