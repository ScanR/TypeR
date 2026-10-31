// Photoshop tool preset (.tpl) import. Pure functions, no CEP dependency, unit-testable.
// File layout: "8BTP", version, block count, then "8BIM" blocks aligned on 4 bytes.
// The "tptp" block holds a preset count, then for each preset its UTF-16 name, a
// descriptor version and an action descriptor. Presets have no length of their
// own: a descriptor that cannot be read ends the walk.

const NO_TEXT_PRESETS = "tplNoTextPresets";

// Photoshop writes a four-character code when a key has one
const KEY_NAMES = {
  FntN: "fontName",
  FntS: "fontStyleName",
  Scrp: "fontScript",
  FntT: "fontTechnology",
  "Sz  ": "size",
  HrzS: "horizontalScale",
  VrtS: "verticalScale",
  Ldng: "leading",
  Trck: "tracking",
  Bsln: "baselineShift",
  AtKr: "autoKern",
  Undl: "underline",
  "Clr ": "color",
  "Rd  ": "red",
  "Grn ": "green",
  "Bl  ": "blue",
  AntA: "antiAlias",
  Algn: "alignment",
};

const ENUM_NAMES = {
  Left: "left",
  Cntr: "center",
  Rght: "right",
  JstA: "justifyAll",
  JstF: "justifyFull",
  Nrml: "normal",
  None: "none",
  "Mnl ": "manual",
};

// Measured on Photoshop 27.7: the values of a text tool's anti-aliasing option
const ANTI_ALIAS_NAMES = {
  0: "antiAliasNone",
  1: "antiAliasCrisp",
  2: "antiAliasStrong",
  8: "antiAliasSmooth",
  16: "antiAliasSharp",
};

const TEXT_STYLE_KEYS = [
  "fontPostScriptName", "fontName", "fontStyleName", "fontScript", "fontTechnology",
  "size", "horizontalScale", "verticalScale", "syntheticBold", "syntheticItalic",
  "autoLeading", "leading", "tracking", "baselineShift", "autoKern", "fontCaps",
  "baseline", "otbaseline", "strikethrough", "underline", "ligature", "altligature",
  "contextualLigatures", "connectionForms", "baselineDirection", "textLanguage",
];

const PARAGRAPH_STYLE_KEYS = [
  "alignment", "firstLineIndent", "startIndent", "endIndent", "spaceBefore", "spaceAfter",
  "autoLeadingPercentage", "leadingType", "hyphenate", "hyphenateWordSize", "hyphenatePreLength",
  "hyphenatePostLength", "hyphenateLimit", "hyphenationZone", "hyphenateCapitalized",
  "hyphenationPreference", "justificationWordMinimum", "justificationWordDesired",
  "justificationWordMaximum", "justificationLetterMinimum", "justificationLetterDesired",
  "justificationLetterMaximum", "justificationGlyphMinimum", "justificationGlyphDesired",
  "justificationGlyphMaximum", "singleWordJustification", "hangingRoman", "burasagari",
  "preferredKinsokuOrder", "textEveryLineComposer",
];

// Photoshop stores 32-bit floats as doubles: 1.2 comes back as 1.2000000476
const roundValue = (value) => Math.round(value * 10000) / 10000;

const createReader = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let position = 0;

  const skip = (length) => {
    if (position + length > bytes.length) throw new RangeError("tpl: unexpected end of file");
    position += length;
  };
  const uint32 = () => {
    const value = view.getUint32(position);
    position += 4;
    return value;
  };
  const int32 = () => {
    const value = view.getInt32(position);
    position += 4;
    return value;
  };
  const float64 = () => {
    const value = view.getFloat64(position);
    position += 8;
    return value;
  };
  const ascii = (length) => {
    const start = position;
    skip(length);
    return String.fromCharCode.apply(null, bytes.subarray(start, position));
  };
  const unicode = () => {
    const length = uint32();
    let text = "";
    for (let i = 0; i < length; i++) {
      text += String.fromCharCode(view.getUint16(position));
      position += 2;
    }
    return text.replace(/\0+$/, "");
  };
  // A zero length means a four-character code
  const key = () => ascii(uint32() || 4);

  const reference = () => {
    const count = uint32();
    for (let i = 0; i < count; i++) {
      const form = ascii(4);
      if (form === "prop") { unicode(); key(); key(); }
      else if (form === "Clss") { unicode(); key(); }
      else if (form === "Enmr") { unicode(); key(); key(); key(); }
      else if (form === "rele") { unicode(); key(); skip(4); }
      else if (form === "Idnt" || form === "indx") skip(4);
      else if (form === "name") { unicode(); key(); unicode(); }
      else throw new Error("tpl: unknown reference form");
    }
    return null;
  };

  const value = () => {
    const type = ascii(4);
    switch (type) {
      case "Objc":
      case "GlbO":
        return descriptor();
      case "VlLs": {
        const count = uint32();
        const list = [];
        for (let i = 0; i < count; i++) list.push(value());
        return list;
      }
      case "doub":
        return roundValue(float64());
      case "UntF":
        skip(4);
        return roundValue(float64());
      case "UnFl": {
        skip(4);
        const count = uint32();
        skip(count * 8);
        return null;
      }
      case "TEXT":
        return unicode();
      case "enum": {
        key();
        const name = key();
        return ENUM_NAMES[name] || name;
      }
      case "long":
        return int32();
      case "comp":
        skip(8);
        return null;
      case "bool":
        skip(1);
        return bytes[position - 1] !== 0;
      case "type":
      case "GlbC":
        unicode();
        key();
        return null;
      case "tdta":
      case "alis":
      case "Pth ":
        skip(uint32());
        return null;
      case "obj ":
        return reference();
      default:
        throw new Error("tpl: unknown value type");
    }
  };

  const descriptor = () => {
    unicode();
    const result = { _class: key() };
    const count = uint32();
    for (let i = 0; i < count; i++) {
      const name = key();
      result[KEY_NAMES[name] || name] = value();
    }
    return result;
  };

  return {
    ascii,
    uint32,
    unicode,
    descriptor,
    skip,
    remaining: () => bytes.length - position,
    tell: () => position,
    seek: (next) => { position = next; },
  };
};

// Returns {presets: [{name, descriptor}], complete}. Non-text presets are read
// too, they sit between the text ones. complete is false when the walk stopped
// on something unreadable, what came before it is still returned.
const parseToolPresets = (bytes) => {
  const reader = createReader(bytes);
  if (bytes.length < 12 || reader.ascii(4) !== "8BTP") throw new Error("tpl: not a tool preset file");
  reader.skip(8);
  const presets = [];
  let complete = true;

  while (reader.remaining() >= 12) {
    if (reader.ascii(4) !== "8BIM") break;
    const tag = reader.ascii(4);
    const length = reader.uint32();
    const start = reader.tell();
    if (tag === "tptp") {
      try {
        const count = reader.uint32();
        for (let i = 0; i < count; i++) {
          const name = reader.unicode();
          reader.skip(4);
          presets.push({ name, descriptor: reader.descriptor() });
        }
      } catch (error) {
        complete = false;
      }
    }
    const end = start + length;
    if (end > bytes.length) {
      complete = false;
      break;
    }
    reader.seek(Math.min(bytes.length, end + ((4 - (end % 4)) % 4)));
  }
  return { presets, complete };
};

// Adobe's own presets are named "$$$/Presets/Tools/Key=Display name"
const getPresetDisplayName = (name) => {
  if (name.indexOf("$$$/") !== 0) return name;
  const separator = name.indexOf("=");
  return separator === -1 ? name : name.slice(separator + 1);
};

const pickKeys = (source, keys) => {
  const result = {};
  keys.forEach((key) => {
    if (source[key] !== undefined && source[key] !== null) result[key] = source[key];
  });
  return result;
};

// A tool preset keeps its sizes in points, whatever the ruler units: 12 reads as
// 50 px at 300 ppi. The style keeps that unit so it renders like the preset.
const toolPresetToStyle = (preset) => {
  const characterOptions = preset.descriptor.textToolCharacterOptions;
  const source = characterOptions && (characterOptions.TxtS || characterOptions.textStyle);
  if (!source || !(source.fontPostScriptName || source.fontName) || !(source.size > 0)) return null;

  const paragraphOptions = preset.descriptor.textToolParagraphOptions || {};
  const textStyle = pickKeys(source, TEXT_STYLE_KEYS);
  textStyle.impliedFontSize = textStyle.size;
  if (textStyle.baselineShift !== undefined) textStyle.impliedBaselineShift = textStyle.baselineShift;
  if (textStyle.autoLeading === false && textStyle.leading > 0) {
    textStyle.impliedLeading = textStyle.leading;
  } else {
    textStyle.autoLeading = true;
    delete textStyle.leading;
  }
  const color = source.color || {};
  textStyle.color = {
    red: Math.round(color.red || 0),
    green: Math.round(color.green || 0),
    blue: Math.round(color.blue || 0),
  };

  return {
    name: getPresetDisplayName(preset.name),
    prefixes: [],
    stroke: { enabled: false, size: 0, opacity: 100, position: "outer", color: { r: 255, g: 255, b: 255 } },
    textProps: {
      layerText: {
        textGridding: characterOptions.textGridding || "none",
        // TypeR only creates horizontal text, vertical type presets included
        orientation: "horizontal",
        antiAlias: ANTI_ALIAS_NAMES[source.antiAlias] || "antiAliasSmooth",
        textStyleRange: [{ from: 0, to: 100, textStyle }],
        paragraphStyleRange: [{
          from: 0,
          to: 100,
          paragraphStyle: pickKeys(paragraphOptions.paragraphStyle || {}, PARAGRAPH_STYLE_KEYS),
        }],
      },
      typeUnit: "pointsUnit",
    },
  };
};

const base64ToBytes = (base64) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const getFileBaseName = (path) => String(path).split(/[\\/]/).pop().replace(/\.[^.]*$/, "");

// The folder export format, so a .tpl goes through the regular style import
const toolPresetFileToImportData = (base64, path) => {
  const { presets, complete } = parseToolPresets(base64ToBytes(base64));
  const exportedStyles = presets.map(toolPresetToStyle).filter(Boolean);
  if (!exportedStyles.length) throw new Error(complete ? NO_TEXT_PRESETS : "tpl: unreadable file");
  return { name: getFileBaseName(path), exportedStyles, incomplete: !complete };
};

export { NO_TEXT_PRESETS, getPresetDisplayName, parseToolPresets, toolPresetFileToImportData, toolPresetToStyle };
