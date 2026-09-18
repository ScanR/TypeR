// TypeR's saved styles use JAM's simplified JSON format. This module converts
// that data to Photoshop actionJSON without loading the ExtendScript runtime.
const enumNames = {
  antiAlias: 'antiAliasType', alignment: 'alignmentType', singleWordJustification: 'alignmentType',
  warpRotate: 'orientation', justificationMethodType: 'justificationMethodType',
};
const enums = new Set(('warpStyle textGridding orientation textType frameBaselineAlignment autoKern fontCaps baseline otbaseline strikethrough underline figureStyle baselineDirection textLanguage japaneseAlternate gridAlignment wariChuJustification lineCap lineJoin leadingType burasagari preferredKinsokuOrder pathTypeEffect pathTypeAlignment pathTypeAlignTo mojiKumiName kinsokuSetName digitSet directionType textComposerEngine').split(' '));
const units = new Set(('rowGutter columnGutter spacing firstBaselineMinimum size leading baselineShift impliedFontSize impliedBaselineShift underlineOffset lineWidth miterLimit firstLineIndent startIndent endIndent spaceBefore spaceAfter diacXOffset markYDistFromBaseline').split(' '));
const classes = {bounds: 'rectangle', boundingBox: 'rectangle', textClickPoint: 'point', base: 'point', defaultStyle: 'textStyle', tRange: 'range'};
const clone = (value) => JSON.parse(JSON.stringify(value));
const number = (value) => typeof value === 'object' && value !== null ? value._value : value;

function toActionJSON(value, typeUnit = 'pointsUnit', key = '') {
  if (Array.isArray(value)) return value.map(item => toActionJSON(item, typeUnit, key));
  if (value !== null && typeof value === 'object') {
    if (value._enum || value._unit || value._obj) return clone(value);
    let objectClass = classes[key] || key;
    if (key === 'color' || key === 'strokeColor') {
      objectClass = 'gray' in value ? 'grayscale' : 'cyan' in value ? 'CMYKColorClass' : 'hue' in value ? 'HSBColorClass' : 'luminance' in value ? 'labColor' : 'RGBColor';
    }
    const output = objectClass ? {_obj: objectClass} : {};
    for (const [property, item] of Object.entries(value)) {
      if (item === null || item === undefined || property.startsWith('_')) continue;
      output[property === 'green' && (key === 'color' || key === 'strokeColor') ? 'grain' : property] = toActionJSON(item, typeUnit, property);
    }
    return output;
  }
  if (typeof value === 'string' && (enums.has(key) || enumNames[key])) return {_enum: enumNames[key] || key, _value: value};
  if (typeof value === 'number' && units.has(key)) return {_unit: typeUnit, _value: value};
  return value;
}

function fromActionJSON(value) {
  if (Array.isArray(value)) return value.map(fromActionJSON);
  if (value !== null && typeof value === 'object') {
    if ('_enum' in value || '_unit' in value) return value._value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('_')).map(([key, item]) => [key === 'grain' ? 'green' : key, fromActionJSON(item)]));
  }
  return value;
}

const textStyleKeep = new Set([
  'fontPostScriptName', 'fontName', 'fontStyleName',
  'size', 'leading', 'autoLeading', 'tracking', 'baselineShift',
  'horizontalScale', 'verticalScale', 'syntheticBold', 'syntheticItalic',
  'autoKern', 'fontCaps', 'baseline', 'otbaseline', 'strikethrough', 'underline',
  'figureStyle', 'color', 'ligature', 'contextualLigatures', 'textLanguage', 'noBreak',
]);
const paragraphKeep = new Set([
  'alignment', 'hyphenate', 'leadingType', 'firstLineIndent', 'startIndent', 'endIndent',
  'spaceBefore', 'spaceAfter', 'burasagari', 'singleWordJustification', 'directionType',
  'textComposerEngine', 'justificationMethodType',
]);

function pick(object, keep) {
  if (!object || typeof object !== 'object') return object;
  const output = {};
  for (const [key, value] of Object.entries(object)) {
    if (keep.has(key) && value != null) output[key] = value;
  }
  return output;
}

function sanitizeTextStyle(style) {
  const cleaned = pick(style, textStyleKeep);
  delete cleaned.impliedFontSize;
  delete cleaned.impliedBaselineShift;
  return cleaned;
}

function sanitizeParagraph(style) {
  const source = {...(style || {})};
  if (source.align && !source.alignment) source.alignment = source.align;
  return pick(source, paragraphKeep);
}

function defaultStyle(font = 'ArialMT') {
  return {textProps: {typeUnit: 'pixelsUnit', layerText: {
    textGridding: 'none', orientation: 'horizontal', antiAlias: 'antiAliasSmooth',
    textStyleRange: [{from: 0, to: 1, textStyle: {fontPostScriptName: font, size: 20, autoLeading: true, horizontalScale: 100, verticalScale: 100, tracking: 0, color: {red: 0, green: 0, blue: 0}}}],
    paragraphStyleRange: [{from: 0, to: 1, paragraphStyle: {alignment: 'center', hyphenate: false}}],
  }}};
}

function makeTextDescriptor(payload, previous, fallbackSize = 20, resolution = 72) {
  const supplied = payload.style && payload.style.textProps;
  const source = clone(supplied || (previous && {layerText: fromActionJSON(previous), typeUnit: previous.textStyleRange?.[0]?.textStyle?.size?._unit || 'pointsUnit'}) || defaultStyle().textProps);
  const layer = source.layerText;
  // An empty text means "apply the style only": the layer must keep its own
  // contents. Treating "" as authoritative erased the layer, which is exactly
  // what a font change on an existing text layer does.
  const text = typeof payload.text === 'string' && payload.text.length
    ? payload.text.replace(/\r\n|\n/g, '\r')
    : (previous?.textKey || layer.textKey || '');
  const base = sanitizeTextStyle(layer.textStyleRange?.[0]?.textStyle || defaultStyle().textProps.layerText.textStyleRange[0].textStyle);
  if (base.size == null) {
    const oldSize = previous?.textStyleRange?.[0]?.textStyle?.size;
    base.size = number(oldSize) || fallbackSize;
    if (oldSize && oldSize._unit !== source.typeUnit) {
      if (oldSize._unit === 'pointsUnit' && source.typeUnit === 'pixelsUnit') base.size *= resolution / 72;
      if (oldSize._unit === 'pixelsUnit' && source.typeUnit === 'pointsUnit') base.size *= 72 / resolution;
    }
  }
  // Implied values are read-only derivatives of size and transform.
  delete base.impliedFontSize;
  delete base.impliedBaselineShift;
  layer.textKey = text;
  layer.textStyleRange = [{from: 0, to: text.length + 1, textStyle: base}];
  if (payload.richTextRuns?.length) {
    let offset = 0;
    layer.textStyleRange = payload.richTextRuns.filter(run => run.text).map(run => {
      const start = offset;
      offset += run.text.replace(/\r\n|\n/g, '\r').length;
      return {from: start, to: offset, textStyle: {...base, syntheticBold: !!(base.syntheticBold || run.bold), syntheticItalic: !!(base.syntheticItalic || run.italic)}};
    });
    if (offset !== text.length) throw new Error('Les plages de texte ne correspondent pas au texte.');
    layer.textStyleRange[layer.textStyleRange.length - 1].to += 1;
  }
  const paragraph = sanitizeParagraph(layer.paragraphStyleRange?.[0]?.paragraphStyle || {alignment: 'center'});
  if (payload.direction) {
    paragraph.directionType = payload.direction === 'rtl' ? 'dirRightToLeft' : 'dirLeftToRight';
    paragraph.textComposerEngine = 'textOptycaComposer';
  }
  layer.paragraphStyleRange = [{from: 0, to: text.length + 1, paragraphStyle: paragraph}];
  // Geometry from a captured style must never move or distort another layer.
  for (const key of ['textShape', 'textClickPoint', 'transform', 'bounds', 'boundingBox', 'warp', 'kerningRange', 'textDynamicMagicPath']) delete layer[key];
  const descriptor = toActionJSON(layer, source.typeUnit || 'pointsUnit', 'textLayer');
  if (previous) {
    for (const key of ['textShape', 'textClickPoint', 'transform', 'warp']) if (previous[key]) descriptor[key] = clone(previous[key]);
  }
  return descriptor;
}

function bounds(value) {
  if (!value) return null;
  const {top, left, right, bottom} = Object.fromEntries(['top', 'left', 'right', 'bottom'].map(key => [key, number(value[key])]));
  if (![top, left, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
  return {top, left, right, bottom, width: right - left, height: bottom - top, xMid: (left + right) / 2, yMid: (top + bottom) / 2};
}

module.exports = {clone, number, toActionJSON, fromActionJSON, defaultStyle, makeTextDescriptor, bounds, sanitizeTextStyle, sanitizeParagraph};
