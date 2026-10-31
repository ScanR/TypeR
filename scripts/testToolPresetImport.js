const assert = require("assert");
const loadAppModule = require("./helpers/loadAppModule")();

const {
  NO_TEXT_PRESETS,
  getPresetDisplayName,
  parseToolPresets,
  toolPresetFileToImportData,
  toolPresetToStyle,
} = loadAppModule("app_src/toolPresetImport.js");

// Minimal writer for the .tpl layout measured on files saved by Photoshop 27.7
const uint32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
};
const float64 = (value) => {
  const buffer = Buffer.alloc(8);
  buffer.writeDoubleBE(value);
  return buffer;
};
const key = (name) => (name.length === 4
  ? Buffer.concat([uint32(0), Buffer.from(name, "latin1")])
  : Buffer.concat([uint32(name.length), Buffer.from(name, "latin1")]));
const unicode = (text) => {
  const chars = [...text, "\0"];
  const buffer = Buffer.alloc(4 + chars.length * 2);
  buffer.writeUInt32BE(chars.length);
  chars.forEach((char, index) => buffer.writeUInt16BE(char.charCodeAt(0), 4 + index * 2));
  return buffer;
};
const type = (name) => Buffer.from(name, "latin1");
const points = (value) => Buffer.concat([type("UntF"), type("#Pnt"), float64(value)]);
const doub = (value) => Buffer.concat([type("doub"), float64(value)]);
const long = (value) => Buffer.concat([type("long"), uint32(value)]);
const bool = (value) => Buffer.concat([type("bool"), Buffer.from([value ? 1 : 0])]);
const text = (value) => Buffer.concat([type("TEXT"), unicode(value)]);
const enumerated = (enumType, value) => Buffer.concat([type("enum"), key(enumType), key(value)]);
const descriptor = (className, entries) => Buffer.concat([
  unicode(""),
  key(className),
  uint32(entries.length),
  ...entries.map(([name, value]) => Buffer.concat([key(name), value])),
]);
const object = (className, entries) => Buffer.concat([type("Objc"), descriptor(className, entries)]);

const preset = (name, className, entries) => Buffer.concat([unicode(name), uint32(16), descriptor(className, entries)]);
const block = (tag, payload) => {
  const padding = Buffer.alloc((4 - (payload.length % 4)) % 4);
  return Buffer.concat([Buffer.from("8BIM", "latin1"), type(tag), uint32(payload.length), payload, padding]);
};
const file = (blocks, version = 2) => Buffer.concat([Buffer.from("8BTP", "latin1"), uint32(version), uint32(blocks.length), ...blocks]);
const presetsBlock = (records) => block("tptp", Buffer.concat([uint32(records.length), ...records]));

const textPreset = (name, overrides = {}) => {
  const fields = {
    fontPostScriptName: text("CCWildWords-Roman"),
    FntN: text("CC Wild Words"),
    FntS: text("Roman"),
    Scrp: long(0),
    FntT: long(1),
    "Sz  ": points(11.5),
    HrzS: doub(100),
    VrtS: doub(95.00000238),
    syntheticBold: bool(false),
    syntheticItalic: bool(true),
    autoLeading: bool(true),
    Trck: long(20),
    Bsln: points(0),
    AtKr: enumerated("AtKr", "opticalKern"),
    fontCaps: enumerated("fontCaps", "Nrml"),
    baseline: enumerated("baseline", "Nrml"),
    Undl: enumerated("Undl", "underlineOff"),
    ligature: bool(true),
    "Clr ": object("RGBC", [["Rd  ", doub(200.4)], ["Grn ", doub(30)], ["Bl  ", doub(10)]]),
    strokeColor: object("RGBC", [["Rd  ", doub(1)], ["Grn ", doub(2)], ["Bl  ", doub(3)]]),
    AntA: long(16),
    ...overrides,
  };
  return preset(name, "typeCreateOrEditTool", [
    ["textToolParagraphOptions", object("textToolParagraphOptions", [
      ["paragraphStyle", object("paragraphStyle", [
        ["Algn", enumerated("Alg ", "Cntr")],
        ["startIndent", points(2)],
        ["autoLeadingPercentage", doub(1.2000000476837158)],
        ["hyphenate", bool(false)],
        ["singleWordJustification", enumerated("Alg ", "JstA")],
        // The tool's defaults for new paragraphs, not this preset's own style
        ["defaultStyle", object("TxtS", [["fontPostScriptName", text("MyriadPro-Regular")], ["Sz  ", points(99)]])],
      ])],
      ["Ornt", enumerated("Ornt", "Hrzn")],
    ])],
    ["textToolCharacterOptions", object("textToolCharacterOptions", [
      ["TxtS", object("TxtS", Object.entries(fields))],
      ["textGridding", enumerated("textGridding", "None")],
    ])],
  ]);
};

const cropPreset = preset("$$$/Presets/Tools/Crop=Crop A4", "cropTool", [
  ["Wdth", points(595)],
  ["Pth ", Buffer.concat([type("tdta"), uint32(3), Buffer.from([1, 2, 3])])],
  ["list", Buffer.concat([type("VlLs"), uint32(2), long(1), doub(2)])],
]);

const toBase64 = (buffer) => buffer.toString("base64");

// Adobe presets carry a localization key, the user's own names are kept whole
assert.strictEqual(getPresetDisplayName("$$$/Presets/Tools/Text_tpl/Key=Horizontal Type 12 pt"), "Horizontal Type 12 pt");
assert.strictEqual(getPresetDisplayName("Bulle = normale"), "Bulle = normale");

// A real layout: text presets between other tools, in a version 3 file with extra blocks
{
  const bytes = file([
    block("tppa", Buffer.from([0, 0, 0, 0, 1])),
    presetsBlock([cropPreset, textPreset("Dialogue"), cropPreset, textPreset("Cri")]),
  ], 3);
  const { presets, complete } = parseToolPresets(new Uint8Array(bytes));
  assert.strictEqual(complete, true);
  assert.strictEqual(presets.length, 4);
  assert.deepStrictEqual(presets.map((item) => item.descriptor._class), ["cropTool", "typeCreateOrEditTool", "cropTool", "typeCreateOrEditTool"]);

  const data = toolPresetFileToImportData(toBase64(bytes), "/Users/me/Presets/Manga FR.tpl");
  assert.strictEqual(data.name, "Manga FR");
  assert.strictEqual(data.incomplete, false);
  assert.deepStrictEqual(data.exportedStyles.map((style) => style.name), ["Dialogue", "Cri"]);
  assert.strictEqual(toolPresetFileToImportData(toBase64(bytes), "C:\\Presets\\Scan.TPL").name, "Scan");
}

// The conversion reads the character style, not the paragraph's defaultStyle
{
  const [item] = parseToolPresets(new Uint8Array(file([presetsBlock([textPreset("Dialogue")])]))).presets;
  const style = toolPresetToStyle(item);
  const layerText = style.textProps.layerText;
  const textStyle = layerText.textStyleRange[0].textStyle;
  const paragraphStyle = layerText.paragraphStyleRange[0].paragraphStyle;

  assert.strictEqual(style.textProps.typeUnit, "pointsUnit", "tool presets store points");
  assert.strictEqual(textStyle.fontPostScriptName, "CCWildWords-Roman");
  assert.strictEqual(textStyle.fontName, "CC Wild Words");
  assert.strictEqual(textStyle.fontStyleName, "Roman");
  assert.strictEqual(textStyle.size, 11.5);
  assert.strictEqual(textStyle.impliedFontSize, 11.5);
  assert.strictEqual(textStyle.verticalScale, 95, "float noise is rounded away");
  assert.strictEqual(textStyle.syntheticItalic, true);
  assert.strictEqual(textStyle.tracking, 20);
  assert.strictEqual(textStyle.autoKern, "opticalKern");
  assert.strictEqual(textStyle.fontCaps, "normal");
  assert.strictEqual(textStyle.underline, "underlineOff");
  assert.strictEqual(textStyle.autoLeading, true);
  assert.strictEqual(textStyle.leading, undefined);
  assert.deepStrictEqual(textStyle.color, { red: 200, green: 30, blue: 10 });
  assert.strictEqual(paragraphStyle.alignment, "center");
  assert.strictEqual(paragraphStyle.startIndent, 2);
  assert.strictEqual(paragraphStyle.autoLeadingPercentage, 1.2);
  assert.strictEqual(paragraphStyle.hyphenate, false);
  assert.strictEqual(paragraphStyle.singleWordJustification, "justifyAll");
  assert.strictEqual(paragraphStyle.defaultStyle, undefined);
  assert.strictEqual(layerText.orientation, "horizontal");
  assert.strictEqual(layerText.textGridding, "none");
  assert.strictEqual(layerText.antiAlias, "antiAliasSharp");
  assert.strictEqual(style.stroke.enabled, false, "tool presets hold no layer effects");
  assert.deepStrictEqual(style.prefixes, []);
}

// Anti-aliasing values measured in Photoshop, and manual leading
{
  const convert = (overrides) => {
    const { presets } = parseToolPresets(new Uint8Array(file([presetsBlock([textPreset("x", overrides)])])));
    return toolPresetToStyle(presets[0]).textProps.layerText;
  };
  const expected = { 0: "antiAliasNone", 1: "antiAliasCrisp", 2: "antiAliasStrong", 8: "antiAliasSmooth", 16: "antiAliasSharp", 77: "antiAliasSmooth" };
  Object.keys(expected).forEach((value) => {
    assert.strictEqual(convert({ AntA: long(Number(value)) }).antiAlias, expected[value]);
  });

  const manual = convert({ autoLeading: bool(false), Ldng: points(14) }).textStyleRange[0].textStyle;
  assert.strictEqual(manual.autoLeading, false);
  assert.strictEqual(manual.leading, 14);
  assert.strictEqual(manual.impliedLeading, 14);

  const noLeading = convert({ autoLeading: bool(false) }).textStyleRange[0].textStyle;
  assert.strictEqual(noLeading.autoLeading, true, "manual leading without a value falls back to auto");
}

// A file without text presets is reported as such, other files as unreadable
{
  assert.throws(
    () => toolPresetFileToImportData(toBase64(file([presetsBlock([cropPreset])])), "a.tpl"),
    (error) => error.message === NO_TEXT_PRESETS
  );
  assert.throws(() => toolPresetFileToImportData(toBase64(Buffer.from("not a preset file")), "a.tpl"), (error) => error.message !== NO_TEXT_PRESETS);
  assert.throws(() => toolPresetFileToImportData(toBase64(Buffer.alloc(0)), "a.tpl"), (error) => error.message !== NO_TEXT_PRESETS);
}

// An unknown value ends the walk: the styles before it are kept and flagged
{
  const broken = preset("Broken", "cropTool", [["Wdth", Buffer.concat([type("????"), uint32(0)])]]);
  const bytes = file([presetsBlock([textPreset("Dialogue"), broken, textPreset("Never reached")])]);
  const data = toolPresetFileToImportData(toBase64(bytes), "a.tpl");
  assert.strictEqual(data.incomplete, true);
  assert.deepStrictEqual(data.exportedStyles.map((style) => style.name), ["Dialogue"]);

  // Same in a file cut short, and nothing readable at all is an error
  const whole = file([presetsBlock([textPreset("Dialogue"), textPreset("Cut")])]);
  const cut = toolPresetFileToImportData(toBase64(whole.subarray(0, whole.length - 200)), "a.tpl");
  assert.strictEqual(cut.incomplete, true);
  assert.deepStrictEqual(cut.exportedStyles.map((style) => style.name), ["Dialogue"]);
  assert.throws(() => toolPresetFileToImportData(toBase64(whole.subarray(0, 60)), "a.tpl"), (error) => error.message !== NO_TEXT_PRESETS);
}

console.log("tool preset import tests passed");
