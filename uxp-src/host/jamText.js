// Port of jamText.toLayerTextObject / fromLayerTextObject (app_src/lib/jam/
// jamText.jsxinc) onto Photoshop's actionJSON. Saved TypeR styles keep JAM's
// simplified layer text format, so both directions must produce exactly what
// the CEP host produced: the same key whitelist on write, the same unit
// detection and the same key names on read.
//
// actionJSON spells a few ids differently from JAM's "meaningful" names, which
// is what the stored styles use: 'Algn' comes back as "align", 'TEXT' as
// "char", 'Pnt ' as "paint" and 'Grn ' as "grain". Writing needs no mapping,
// since both names resolve to the same id; reading renames them.

const READ_KEY_NAMES = {
  align: "alignment",
  char: "textType",
  grain: "green",
};

const READ_ENUM_VALUES = {
  // 'TEXT' enumeration of textShape: point text is 'Pnt ', read as "paint"
  textType: { paint: "point" },
};

const BOOLEAN_KEYS = new Set([
  "rowMajorOrder", "syntheticBold", "syntheticItalic", "autoLeading", "ligature", "altligature",
  "contextualLigatures", "alternateLigatures", "oldStyle", "fractions", "ordinals", "swash", "titling",
  "connectionForms", "stylisticAlternates", "ornaments", "proportionalMetrics", "kana", "italics", "ruby",
  "enableWariChu", "noBreak", "fill", "stroke", "fillFirst", "fillOverPrint", "strokeOverPrint", "hyphenate",
  "hyphenateCapitalized", "hangingRoman", "keepTogether", "kurikaeshiMojiShori", "textEveryLineComposer", "flip",
]);
const STRING_KEYS = new Set(["textKey", "fontPostScriptName", "fontName", "fontStyleName", "book", "name"]);
const INTEGER_KEYS = new Set([
  "rowCount", "columnCount", "from", "to", "fontScript", "fontTechnology", "tracking", "wariChuCount",
  "wariChuLineGap", "wariChuWidow", "wariChuOrphan", "tcyUpDown", "tcyLeftRight", "jiDori", "bookID",
  "dropCapMultiplier", "hyphenateWordSize", "hyphenatePreLength", "hyphenatePostLength", "hyphenateLimit",
  "autoTCY", "kerning", "pathTypeSpacing",
]);
const DOUBLE_KEYS = new Set([
  "warpValue", "warpPerspective", "warpPerspectiveOther", "xx", "xy", "yx", "yy", "tx", "ty", "top", "left",
  "bottom", "right", "horizontalScale", "verticalScale", "characterRotation", "mojiZume", "wariChuScale", "a",
  "b", "black", "blue", "brightness", "cyan", "gray", "green", "luminance", "magenta", "red", "saturation",
  "yellowColor", "lineDashoffset", "autoLeadingPercentage", "hyphenationZone", "hyphenationPreference",
  "justificationWordMinimum", "justificationWordDesired", "justificationWordMaximum",
  "justificationLetterMinimum", "justificationLetterDesired", "justificationLetterMaximum",
  "justificationGlyphMinimum", "justificationGlyphDesired", "justificationGlyphMaximum", "defaultTabWidth",
  "start", "end", "leftAki", "rightAki",
]);
// Keys stored without unit in the simplified format: their unit is the
// layer's typeUnit
const TYPE_UNIT_KEYS = new Set([
  "rowGutter", "columnGutter", "spacing", "firstBaselineMinimum", "size", "leading", "baselineShift",
  "underlineOffset", "lineWidth", "miterLimit", "firstLineIndent", "startIndent", "endIndent", "spaceBefore",
  "spaceAfter",
]);
// fromLayerTextObject also reads the unit off these (CS-era keys)
const READ_UNIT_KEYS = new Set([...TYPE_UNIT_KEYS, "leftAki", "rightAki"]);
const SELF_ENUM_KEYS = new Set([
  "warpStyle", "textGridding", "orientation", "textType", "frameBaselineAlignment", "autoKern", "fontCaps",
  "baseline", "otbaseline", "strikethrough", "underline", "figureStyle", "baselineDirection", "textLanguage",
  "japaneseAlternate", "gridAlignment", "wariChuJustification", "lineCap", "lineJoin", "leadingType",
  "burasagari", "preferredKinsokuOrder", "pathTypeEffect", "pathTypeAlignment", "pathTypeAlignTo",
  "mojiKumiName", "kinsokuSetName",
]);
const LIST_KEYS = new Set(["textShape", "textStyleRange", "paragraphStyleRange", "kerningRange"]);
const SELF_OBJECT_KEYS = new Set(["warp", "transform", "textStyle", "paragraphStyle"]);

// Photoshop 2026 reports some RGB text colors as unit floats (redFloat,
// greenFloat, blueFloat) instead of 0-255 components. Neither jamText nor the
// panel knows those keys: the CEP host wrote such a color back empty, which
// Photoshop refuses ("program error", e.g. on a size change), and the style
// editor showed it black. They are read and written as 0-255 RGB.
function normalizeFloatColor(value) {
  if (!value || typeof value !== "object" || !("redFloat" in value) || "red" in value) return value;
  const channel = (component) => {
    const number = Number(component);
    if (!isFinite(number)) return 0;
    return Math.max(0, Math.min(255, number * 255));
  };
  const result = {};
  for (const key in value) {
    if (key === "redFloat") result.red = channel(value.redFloat);
    else if (key === "greenFloat") result.green = channel(value.greenFloat);
    else if (key === "blueFloat") result.blue = channel(value.blueFloat);
    else result[key] = value[key];
  }
  return result;
}

function colorClass(value) {
  if (("book" in value && "name" in value) || ("bookID" in value && "bookKey" in value)) return "bookColor";
  if ("cyan" in value && "magenta" in value && "yellowColor" in value && "black" in value) return "CMYKColorClass";
  if ("gray" in value) return "grayscale";
  if ("hue" in value && "saturation" in value && "brightness" in value) return "HSBColorClass";
  if ("luminance" in value && "a" in value && "b" in value) return "labColor";
  if ("red" in value && "green" in value && "blue" in value) return "RGBColor";
  return undefined;
}

// ActionDescriptor.putInteger truncates, so does this
const toInteger = (value) => (typeof value === "number" && isFinite(value) ? Math.trunc(value) : value);

function restoreDesc(desc, typeUnit, hintUnit) {
  const restored = {};
  for (const key in desc) {
    if (!Object.prototype.hasOwnProperty.call(desc, key)) continue;
    const value = desc[key];
    let typed;
    if (key === "bookKey") typed = { _rawData: value };
    else if (BOOLEAN_KEYS.has(key) || STRING_KEYS.has(key)) typed = value;
    else if (INTEGER_KEYS.has(key)) typed = toInteger(value);
    else if (DOUBLE_KEYS.has(key)) typed = value;
    else if (TYPE_UNIT_KEYS.has(key)) typed = typeUnit ? { _unit: typeUnit, _value: value } : value;
    else if (key === "horizontal" || key === "vertical") typed = hintUnit ? { _unit: hintUnit, _value: value } : value;
    else if (key === "hue") typed = { _unit: "angleUnit", _value: value };
    else if (SELF_ENUM_KEYS.has(key)) typed = { _enum: key, _value: value };
    else if (key === "antiAlias") typed = { _enum: "antiAliasType", _value: value };
    else if (key === "warpRotate") typed = { _enum: "orientation", _value: value };
    else if (key === "alignment" || key === "singleWordJustification") typed = { _enum: "alignmentType", _value: value };
    else if (LIST_KEYS.has(key)) {
      typed = [];
      for (let i = 0; i < value.length; i++) {
        typed.push(Object.assign({ _obj: key }, restoreDesc(value[i], typeUnit)));
      }
    } else if (SELF_OBJECT_KEYS.has(key)) typed = Object.assign({ _obj: key }, restoreDesc(value, typeUnit));
    else if (key === "defaultStyle") typed = Object.assign({ _obj: "textStyle" }, restoreDesc(value, typeUnit));
    else if (key === "color" || key === "strokeColor") {
      const color = normalizeFloatColor(value);
      typed = Object.assign({ _obj: colorClass(color) }, restoreDesc(color, typeUnit));
      if (typed._obj === undefined) delete typed._obj;
    } else if (key === "textClickPoint") typed = Object.assign({ _obj: "point" }, restoreDesc(value, typeUnit, "percentUnit"));
    else if (key === "base") typed = Object.assign({ _obj: "point" }, restoreDesc(value, typeUnit));
    else if (key === "bounds") typed = Object.assign({ _obj: "rectangle" }, restoreDesc(value, typeUnit));
    else if (key === "tRange") typed = Object.assign({ _obj: "range" }, restoreDesc(value, typeUnit));
    else if (key === "textLayer") typed = Object.assign({ _obj: "textLayer" }, restoreDesc(value, typeUnit));
    else if (key === "path") typed = undefined; // text on a path: not produced by TypeR styles
    if (typed !== undefined && typed !== null) restored[key] = typed;
  }
  return restored;
}

// Simplified layer text JSON ({layerText, typeUnit}) -> actionJSON textLayer
function toLayerTextObject(layerText) {
  const typeUnit = layerText && "typeUnit" in layerText ? layerText.typeUnit : undefined;
  return restoreDesc({ textLayer: layerText.layerText }, typeUnit).textLayer;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// actionJSON -> JAM simplified value, the way jamEngine.simplifyObject reads a
// descriptor with meaningful ids
function simplifyValue(value, key, state) {
  if (Array.isArray(value)) return value.map((item) => simplifyValue(item, key, state));
  if (!isPlainObject(value)) return value;
  if ("_enum" in value && "_value" in value) {
    const enumType = READ_KEY_NAMES[value._enum] || value._enum;
    const renames = READ_ENUM_VALUES[enumType];
    return renames && renames[value._value] ? renames[value._value] : value._value;
  }
  if ("_unit" in value && "_value" in value) return value._value;
  if ("_class" in value && Object.keys(value).length === 1) return value._class;
  if ("_path" in value) return value._path;
  if ("_rawData" in value) return value._rawData;
  if ("_ref" in value || "_target" in value) return value;
  if ((key === "color" || key === "strokeColor") && "redFloat" in value) {
    return normalizeFloatColor(simplifyDesc(value, state));
  }
  return simplifyDesc(value, state);
}

function simplifyDesc(desc, state) {
  const simplified = {};
  for (const rawKey in desc) {
    if (!Object.prototype.hasOwnProperty.call(desc, rawKey) || rawKey.charAt(0) === "_") continue;
    const key = READ_KEY_NAMES[rawKey] || rawKey;
    const value = desc[rawKey];
    if (key === "path") {
      // jamHelpers.fromPathComponentList: text on a path is out of TypeR's
      // scope, keep the raw components so nothing is lost on a round trip
      simplified[key] = value;
      continue;
    }
    if (state && !state.typeDone && READ_UNIT_KEYS.has(key)) {
      if (isPlainObject(value) && "_unit" in value) state.typeUnit = value._unit;
      state.typeDone = true;
    }
    simplified[key] = simplifyValue(value, key, state);
  }
  return simplified;
}

// actionJSON textKey descriptor -> {layerText, typeUnit}
function fromLayerTextObject(layerTextObject) {
  const state = { typeUnit: undefined, typeDone: false };
  const result = { layerText: simplifyDesc(layerTextObject, state) };
  if (state.typeUnit) result.typeUnit = state.typeUnit;
  return result;
}

// Generic simplification for non-text descriptors (selection bounds, layer
// effects), without the type unit hook
function simplifyObject(object) {
  return simplifyDesc(object, null);
}

module.exports = { toLayerTextObject, fromLayerTextObject, simplifyObject };
